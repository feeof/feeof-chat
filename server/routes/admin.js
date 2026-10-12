'use strict';

const express = require('express');
const { hashPassword } = require('../auth');
const { badRequest, conflict, notFound, readString, readInt, readId } = require('../util');
const { agentAuth, requireAdmin } = require('./middleware');
const { knowledgeRoutes } = require('./knowledge');

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ROLES = ['admin', 'agent'];
const AI_MODES = ['always', 'offline'];
const RANGES = { today: 1, '7d': 7, '30d': 30 };

function localDay(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readRole(value) {
  if (value === undefined) return undefined;
  if (!ROLES.includes(value)) throw badRequest('角色无效');
  return value;
}

function adminRoutes(deps) {
  const { store, service } = deps;
  const router = express.Router();
  router.use(agentAuth(store), requireAdmin);
  router.use(knowledgeRoutes(deps));

  // ---- agents ----

  router.post('/agents', async (req, res) => {
    const username = readString(req.body.username, { field: '用户名', required: true, max: 32 });
    if (!USERNAME_RE.test(username)) throw badRequest('用户名只能包含字母、数字、下划线、点和短横线，长度 3-32');
    if (store.getUserByUsername(username)) throw conflict('用户名已存在');
    const password = readString(req.body.password, { field: '密码', required: true, min: 6, max: 200, trim: false });
    const user = store.createUser({
      username,
      passwordHash: await hashPassword(password),
      displayName: readString(req.body.display_name, { field: '显示名称', max: 32 }) || username,
      role: readRole(req.body.role) || 'agent',
      maxConcurrent: readInt(req.body.max_concurrent, { field: '最大接待数', min: 1, max: 100 }) ?? 5,
    });
    res.status(201).json({ agent: service.agentView({ ...user, active_count: 0 }) });
  });

  router.patch('/agents/:id', async (req, res) => {
    const id = readId(req.params.id);
    const target = store.getUser(id);
    if (!target) throw notFound('客服不存在');
    const fields = {
      display_name: readString(req.body.display_name, { field: '显示名称', max: 32 }),
      role: readRole(req.body.role),
      max_concurrent: readInt(req.body.max_concurrent, { field: '最大接待数', min: 1, max: 100 }),
    };
    if (req.body.disabled !== undefined) {
      if (typeof req.body.disabled !== 'boolean') throw badRequest('disabled 必须是布尔值');
      fields.disabled = req.body.disabled ? 1 : 0;
    }
    const password = readString(req.body.password, { field: '密码', min: 6, max: 200, trim: false });
    if (password !== undefined) fields.password_hash = await hashPassword(password);
    if (id === req.user.id && (fields.disabled === 1 || fields.role === 'agent')) {
      throw badRequest('不能禁用自己或取消自己的管理员权限');
    }

    store.updateUser(id, fields);
    const revokeSessions = fields.disabled === 1 || fields.password_hash || (fields.role && fields.role !== target.role);
    if (revokeSessions) {
      // Role is baked into socket rooms and password/disable must end existing logins.
      store.deleteUserSessions(id, { except: id === req.user.id ? req.tokenHash : undefined });
      await service.disconnectAgent(id, { except: id === req.user.id ? req.tokenHash : undefined });
    }
    if (fields.disabled === 1) service.requeueAgentConversations(id);
    if (fields.max_concurrent !== undefined || fields.disabled === 0) service.drainQueue();
    service.publishAgentPresence(store.getUser(id));

    const agent = store.listUsers().find((u) => u.id === id);
    res.json({ agent: service.agentView(agent) });
  });

  // ---- quick replies ----

  function readQuickReply(body, required) {
    return {
      title: readString(body.title, { field: '标题', required, max: 50 }),
      content: readString(body.content, { field: '内容', required, max: 2000 }),
      sort: readInt(body.sort, { field: '排序', min: 0, max: 9999 }),
    };
  }

  router.post('/quick-replies', (req, res) => {
    res.status(201).json({ quick_reply: store.createQuickReply(readQuickReply(req.body, true)) });
  });

  router.patch('/quick-replies/:id', (req, res) => {
    const id = readId(req.params.id);
    if (!store.getQuickReply(id)) throw notFound('快捷回复不存在');
    res.json({ quick_reply: store.updateQuickReply(id, readQuickReply(req.body, false)) });
  });

  router.delete('/quick-replies/:id', (req, res) => {
    if (!store.deleteQuickReply(readId(req.params.id))) throw notFound('快捷回复不存在');
    res.json({ ok: true });
  });

  // ---- settings ----

  router.put('/settings', (req, res) => {
    const body = req.body;
    const patch = {
      site_name: readString(body.site_name, { field: '站点名称', max: 50 }),
      welcome_message: readString(body.welcome_message, { field: '欢迎语', max: 500 }),
      offline_message: readString(body.offline_message, { field: '离线提示', max: 500 }),
      queue_message: readString(body.queue_message, { field: '排队提示', max: 500 }),
      theme_color: readString(body.theme_color, { field: '主题色', max: 7 }),
      auto_close_minutes: readInt(body.auto_close_minutes, { field: '自动结束时间', min: 0, max: 1440 }),
    };
    Object.assign(patch, {
      ai_name: readString(body.ai_name, { field: 'AI 客服名称', max: 20 }),
      ai_instructions: readString(body.ai_instructions, { field: 'AI 补充说明', max: 4000 }),
      ai_handoff_message: readString(body.ai_handoff_message, { field: '转人工提示', max: 200 }),
    });
    if (body.ai_mode !== undefined) {
      if (!AI_MODES.includes(body.ai_mode)) throw badRequest('AI 接待模式无效');
      patch.ai_mode = body.ai_mode;
    }
    // Message texts may be cleared on purpose (an empty string disables that message).
    for (const key of ['welcome_message', 'offline_message', 'queue_message', 'ai_instructions', 'ai_handoff_message']) {
      if (body[key] === '') patch[key] = '';
    }
    if (patch.theme_color !== undefined && !COLOR_RE.test(patch.theme_color)) {
      throw badRequest('主题色格式应为 #RRGGBB');
    }
    for (const key of ['auto_assign', 'ai_enabled']) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'boolean') throw badRequest(`${key} 必须是布尔值`);
      patch[key] = body[key];
    }
    const previous = store.getSettings();
    const settings = store.updateSettings(patch);
    service.settingsChanged(previous, settings);
    res.json({ settings });
  });

  // ---- statistics ----

  router.get('/stats', (req, res) => {
    const days = RANGES[req.query.range || 'today'];
    if (!days) throw badRequest('range 参数无效');
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const from = start.getTime();
    const to = Date.now() + 1;
    const stats = store.stats(from, to);

    // Fill days without conversations so the chart has a continuous axis.
    const counts = new Map(stats.daily.map((d) => [d.day, d.conversations]));
    const daily = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const day = localDay(date);
      daily.push({ day, conversations: counts.get(day) || 0 });
    }

    res.json({
      range: { from, to, days },
      overview: stats.overview,
      current: stats.current,
      agents: stats.agents.map((a) => ({
        ...a,
        disabled: Boolean(a.disabled),
        status: service.effectiveStatus(a),
      })),
      daily,
    });
  });

  return router;
}

module.exports = { adminRoutes };
