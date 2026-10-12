'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { hashToken } = require('../auth');
const { HttpError, badRequest, RateLimiter } = require('../util');
const { bearerToken } = require('./middleware');

/** Detects the image format from its magic bytes; never trust the client's Content-Type. */
function detectImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
}

function uploadRoutes({ store, config }) {
  const router = express.Router();
  const limiter = new RateLimiter({ limit: 20, windowMs: 60 * 1000 });
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  // Both agents (Bearer token) and visitors (X-Visitor-Token) may upload.
  function uploader(req, res, next) {
    const token = bearerToken(req);
    if (token) {
      const user = store.getSessionUser(hashToken(token));
      if (user) {
        req.uploaderKey = `agent:${user.id}`;
        return next();
      }
    }
    const visitorToken = req.get('x-visitor-token');
    const visitor = visitorToken && store.getVisitorByTokenHash(hashToken(visitorToken));
    if (visitor) {
      req.uploaderKey = `visitor:${visitor.id}`;
      return next();
    }
    return next(new HttpError(401, '请先登录'));
  }

  router.post(
    '/uploads',
    uploader,
    (req, res, next) => {
      if (!limiter.hit(req.uploaderKey)) return next(new HttpError(429, '上传太频繁了，请稍后再试'));
      return next();
    },
    express.raw({ type: () => true, limit: config.maxUploadBytes }),
    (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('请选择要上传的图片');
      const ext = detectImageType(req.body);
      if (!ext) throw badRequest('仅支持 PNG、JPG、GIF、WebP 格式的图片');
      const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(config.uploadsDir, name), req.body);
      res.status(201).json({ url: `/uploads/${name}` });
    },
  );

  return router;
}

module.exports = { uploadRoutes, detectImageType };
