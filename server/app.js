'use strict';

const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { Store } = require('./store');
const { Presence } = require('./presence');
const { ChatService } = require('./service');
const { KnowledgeBase } = require('./ai/knowledge');
const { AiAssistant } = require('./ai/assistant');
const { setupRealtime } = require('./realtime');
const { hashPassword, generatePassword } = require('./auth');
const { HttpError } = require('./util');
const { authRoutes } = require('./routes/auth');
const { workspaceRoutes } = require('./routes/workspace');
const { adminRoutes } = require('./routes/admin');
const { visitorRoutes } = require('./routes/visitor');
const { uploadRoutes } = require('./routes/upload');

const BASE_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
];

function securityHeaders(config) {
  return (req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Only the visitor chat page may be embedded by other sites (via widget.js).
    const embeddable = req.path === '/chat.html';
    const ancestors = embeddable ? config.widgetFrameAncestors : "'self'";
    res.set('Content-Security-Policy', [...BASE_CSP, `frame-ancestors ${ancestors}`].join('; '));
    if (!embeddable) res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  };
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '上传内容过大' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '请求格式不正确' });
  console.error(err);
  return res.status(500).json({ error: '服务器内部错误' });
}

async function ensureAdmin(store, config) {
  if (store.countUsers() > 0) return;
  const password = config.adminPassword || generatePassword();
  store.createUser({
    username: config.adminUsername,
    passwordHash: await hashPassword(password),
    displayName: '管理员',
    role: 'admin',
  });
  if (!config.adminPassword) {
    console.log('\n========================================================');
    console.log(' 已创建初始管理员账号（请登录后尽快修改密码）');
    console.log(`   用户名: ${config.adminUsername}`);
    console.log(`   密  码: ${password}`);
    console.log('========================================================\n');
  }
}

/**
 * `overrides` may set any config value; `aiClient` replaces the Anthropic
 * client (tests pass a scripted fake).
 */
function createApp({ aiClient, ...overrides } = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config.dbFile);
  const store = new Store(db);
  const presence = new Presence();
  const knowledge = new KnowledgeBase(store);
  const ai = new AiAssistant({ store, knowledge, config, client: aiClient });
  const service = new ChatService({ store, presence, config, ai });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders(config));

  const deps = { store, service, config, ai, knowledge };
  app.use('/api', express.json({ limit: '100kb' }), (req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });
  app.use('/api', uploadRoutes(deps));
  app.use('/api', visitorRoutes(deps));
  app.use('/api/auth', authRoutes(deps));
  app.use('/api/admin', adminRoutes(deps));
  app.use('/api', workspaceRoutes(deps));
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

  app.use(
    '/uploads',
    express.static(config.uploadsDir, {
      immutable: true,
      maxAge: '30d',
      setHeaders(res) {
        res.set('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    }),
  );
  app.use(express.static(config.publicDir, { extensions: ['html'] }));
  app.use(errorHandler);

  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 1e5 });
  service.attach(io);
  setupRealtime(io, { store, service, presence });

  let maintenanceTimer = null;
  function runMaintenance() {
    try {
      service.closeIdleConversations();
      store.purgeExpiredSessions();
    } catch (err) {
      console.error('[maintenance]', err);
    }
  }

  async function start(port = config.port, host = config.host) {
    await ensureAdmin(store, config);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    maintenanceTimer = setInterval(runMaintenance, config.maintenanceIntervalMs);
    maintenanceTimer.unref();
    return server.address();
  }

  async function stop() {
    clearInterval(maintenanceTimer);
    // Let in-flight AI replies finish writing before the database closes.
    let timer;
    await Promise.race([service.aiIdle(), new Promise((resolve) => (timer = setTimeout(resolve, 5000)))]);
    clearTimeout(timer);
    await new Promise((resolve) => io.close(() => resolve()));
    db.close();
  }

  return { app, server, io, store, service, presence, config, ai, knowledge, start, stop };
}

module.exports = { createApp };
