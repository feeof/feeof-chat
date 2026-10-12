'use strict';

const express = require('express');
const { hashPassword, verifyPassword, generateToken, hashToken } = require('../auth');
const { HttpError, badRequest, readString, RateLimiter } = require('../util');
const { agentAuth } = require('./middleware');

const STATUSES = ['online', 'away', 'offline'];

function authRoutes({ store, service, config }) {
  const router = express.Router();
  const loginLimiter = new RateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });

  router.post('/login', async (req, res) => {
    const username = readString(req.body.username, { field: '用户名', required: true, max: 64 });
    const password = readString(req.body.password, { field: '密码', required: true, max: 200, trim: false });
    const limitKey = `${req.ip}|${username.toLowerCase()}`;
    if (!loginLimiter.hit(limitKey)) throw new HttpError(429, '登录尝试过于频繁，请 15 分钟后再试');

    const user = store.getUserByUsername(username);
    const valid = await verifyPassword(password, user && user.password_hash);
    if (!user || !valid) throw new HttpError(401, '用户名或密码错误');
    if (user.disabled) throw new HttpError(403, '该账号已被禁用');
    loginLimiter.reset(limitKey);

    const token = generateToken();
    store.createSession(hashToken(token), user.id, Date.now() + config.sessionTtlMs);
    const current = user.status === 'offline' ? service.setAgentStatus(user, 'online') : user;
    res.json({ token, user: service.agentView(current) });
  });

  router.use(agentAuth(store));

  router.get('/me', (req, res) => {
    res.json({ user: service.agentView(req.user) });
  });

  router.post('/logout', async (req, res) => {
    store.deleteSession(req.tokenHash);
    await service.disconnectAgent(req.user.id, { only: req.tokenHash });
    res.json({ ok: true });
  });

  router.patch('/me', async (req, res) => {
    const fields = {};
    const displayName = readString(req.body.display_name, { field: '显示名称', max: 32 });
    if (displayName !== undefined) fields.display_name = displayName;
    const newPassword = readString(req.body.new_password, { field: '新密码', min: 6, max: 200, trim: false });
    if (newPassword !== undefined) {
      const current = readString(req.body.current_password, { field: '当前密码', required: true, trim: false });
      if (!(await verifyPassword(current, req.user.password_hash))) throw badRequest('当前密码不正确');
      fields.password_hash = await hashPassword(newPassword);
    }
    store.updateUser(req.user.id, fields);
    if (fields.password_hash) {
      // Sign out every other device once the password changes.
      store.deleteUserSessions(req.user.id, { except: req.tokenHash });
      await service.disconnectAgent(req.user.id, { except: req.tokenHash });
    }
    res.json({ user: service.agentView(store.getUser(req.user.id)) });
  });

  router.put('/me/status', (req, res) => {
    const { status } = req.body;
    if (!STATUSES.includes(status)) throw badRequest('状态无效');
    res.json({ user: service.agentView(service.setAgentStatus(req.user, status)) });
  });

  return router;
}

module.exports = { authRoutes };
