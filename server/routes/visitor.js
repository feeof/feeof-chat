'use strict';

const express = require('express');
const { generateToken, hashToken } = require('../auth');
const { HttpError, badRequest, readString, readInt, RateLimiter } = require('../util');
const { visitorAuth } = require('./middleware');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-() ]{5,30}$/;

/** Validates visitor-supplied contact fields; unknown or empty fields are left undefined. */
function normalizeVisitorProfile(body) {
  const name = readString(body.name, { field: '称呼', max: 50 });
  const email = readString(body.email, { field: '邮箱', max: 100 });
  const phone = readString(body.phone, { field: '电话', max: 30 });
  if (email && !EMAIL_RE.test(email)) throw badRequest('邮箱格式不正确');
  if (phone && !PHONE_RE.test(phone)) throw badRequest('电话格式不正确');
  return { name, email, phone };
}

/**
 * Page metadata comes from whatever site embeds the widget, so it is
 * truncated or dropped instead of rejected - a long page title must not
 * stop a visitor from chatting.
 */
function lenientString(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function lenientProfile(body) {
  const email = lenientString(body.email, 100);
  const phone = lenientString(body.phone, 30);
  return {
    name: lenientString(body.name, 50),
    email: email && EMAIL_RE.test(email) ? email : undefined,
    phone: phone && PHONE_RE.test(phone) ? phone : undefined,
  };
}

/** Keeps only http(s) URLs so they are safe to render as links. */
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 1000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function visitorRoutes({ store, service, config }) {
  const router = express.Router();
  const newVisitorLimiter = new RateLimiter({ limit: 60, windowMs: 60 * 1000 });
  const messageLimiter = new RateLimiter({ limit: 20, windowMs: 30 * 1000 });

  function widgetConfig() {
    const settings = store.getSettings();
    return {
      site_name: settings.site_name,
      welcome_message: settings.welcome_message,
      theme_color: settings.theme_color,
      online: service.isServiceOnline(),
      max_message_length: config.maxMessageLength,
    };
  }

  function visitorProfile(visitor) {
    return { id: visitor.id, name: visitor.name, email: visitor.email, phone: visitor.phone };
  }

  router.get('/widget/config', (req, res) => {
    // Read by widget.js from the host site, so it must be readable cross-origin.
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ config: widgetConfig() });
  });

  // Creates a visitor identity, or resumes one from a stored token.
  router.post('/visitor/session', (req, res) => {
    const body = req.body;
    const fields = {
      ...lenientProfile(body),
      ip: req.ip,
      user_agent: (req.get('user-agent') || '').slice(0, 500),
      page_url: safeUrl(body.page_url),
      page_title: lenientString(body.page_title, 200),
      referrer: safeUrl(body.referrer),
      last_seen_at: Date.now(),
    };
    let token = typeof body.token === 'string' ? body.token : null;
    let visitor = token ? store.getVisitorByTokenHash(hashToken(token)) : null;
    if (visitor) {
      // Never let page parameters overwrite contact info the visitor or an agent already set.
      for (const key of ['name', 'email', 'phone']) if (visitor[key]) delete fields[key];
      store.updateVisitor(visitor.id, fields);
      visitor = store.getVisitor(visitor.id);
    } else {
      if (!newVisitorLimiter.hit(req.ip)) throw new HttpError(429, '请求过于频繁，请稍后再试');
      token = generateToken();
      visitor = store.createVisitor(hashToken(token), fields);
    }
    res.json({
      token,
      visitor: visitorProfile(visitor),
      conversation: service.visitorConversationView(store.getLatestConversation(visitor.id)),
      messages: store.listVisitorMessages(visitor.id, { limit: 50 }).map((m) => service.messageView(m)),
      config: widgetConfig(),
    });
  });

  router.use('/visitor', visitorAuth(store));

  router.get('/visitor/messages', (req, res) => {
    const messages = store.listVisitorMessages(req.visitor.id, {
      before: readInt(req.query.before, { field: 'before', min: 1 }),
      after: readInt(req.query.after, { field: 'after', min: 0 }),
      limit: readInt(req.query.limit, { field: 'limit', min: 1, max: 200 }) ?? 50,
    });
    res.json({
      messages: messages.map((m) => service.messageView(m)),
      conversation: service.visitorConversationView(store.getLatestConversation(req.visitor.id)),
    });
  });

  router.post('/visitor/messages', (req, res) => {
    if (!messageLimiter.hit(String(req.visitor.id))) throw new HttpError(429, '发送太频繁了，请稍后再试');
    const message = service.sendVisitorMessage(req.visitor, req.body);
    res.status(201).json({ message: service.messageView(message) });
  });

  router.post('/visitor/close', (req, res) => {
    const conv = service.closeByVisitor(req.visitor);
    res.json({ conversation: service.visitorConversationView(conv) });
  });

  router.post('/visitor/rate', (req, res) => {
    const conversationId = readInt(req.body.conversation_id, { field: '会话', min: 1, required: true });
    const rating = readInt(req.body.rating, { field: '评分', min: 1, max: 5, required: true });
    const comment = readString(req.body.comment, { field: '评价内容', max: 500 });
    const conv = service.rateConversation(req.visitor, conversationId, { rating, comment });
    res.json({ conversation: service.visitorConversationView(conv) });
  });

  router.patch('/visitor/profile', (req, res) => {
    store.updateVisitor(req.visitor.id, normalizeVisitorProfile(req.body));
    const conv = store.getOpenConversation(req.visitor.id);
    if (conv) service.publishConversation(conv, [], { toVisitor: false });
    res.json({ visitor: visitorProfile(store.getVisitor(req.visitor.id)) });
  });

  return router;
}

module.exports = { visitorRoutes, normalizeVisitorProfile };
