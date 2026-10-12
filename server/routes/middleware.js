'use strict';

const { hashToken } = require('../auth');
const { HttpError, forbidden } = require('../util');

function bearerToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  return match ? match[1] : null;
}

/** Resolves the logged-in agent from `Authorization: Bearer <token>`. */
function agentAuth(store) {
  return (req, res, next) => {
    const token = bearerToken(req);
    if (!token) return next(new HttpError(401, '请先登录'));
    const tokenHash = hashToken(token);
    const user = store.getSessionUser(tokenHash);
    if (!user) return next(new HttpError(401, '登录已过期，请重新登录'));
    req.user = user;
    req.tokenHash = tokenHash;
    return next();
  };
}

/** Resolves the visitor from the `X-Visitor-Token` header. */
function visitorAuth(store) {
  return (req, res, next) => {
    const token = req.get('x-visitor-token');
    const visitor = token ? store.getVisitorByTokenHash(hashToken(token)) : null;
    if (!visitor) return next(new HttpError(401, '访客身份无效，请刷新页面'));
    req.visitor = visitor;
    return next();
  };
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return next(forbidden('需要管理员权限'));
  return next();
}

module.exports = { agentAuth, visitorAuth, requireAdmin, bearerToken };
