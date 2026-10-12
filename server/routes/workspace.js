'use strict';

const express = require('express');
const { badRequest, readString, readInt, readId } = require('../util');
const { agentAuth } = require('./middleware');
const { normalizeVisitorProfile } = require('./visitor');

const STATUSES = ['bot', 'waiting', 'active', 'closed'];
// Conversations every agent can see, regardless of who is serving them.
const SHARED_STATUSES = ['bot', 'waiting'];

/** Endpoints shared by every logged-in agent. */
function workspaceRoutes({ store, service }) {
  const router = express.Router();
  router.use(agentAuth(store));

  router.get('/conversations', (req, res) => {
    const { user } = req;
    const status = req.query.status;
    if (!STATUSES.includes(status)) throw badRequest('status 参数无效');
    const options = {
      status,
      q: readString(req.query.q, { field: '搜索关键词', max: 100 }),
      limit: readInt(req.query.limit, { field: 'limit', min: 1, max: 200 }) ?? 50,
      offset: readInt(req.query.offset, { field: 'offset', min: 0 }) ?? 0,
    };
    // Agents only see their own conversations outside the shared queue and AI conversations.
    if (!SHARED_STATUSES.includes(status)) {
      if (user.role !== 'admin' || req.query.mine === '1') options.agentId = user.id;
      else if (req.query.agent_id) options.agentId = readId(req.query.agent_id);
    }
    const conversations = store.listConversations(options).map((c) => service.conversationView(c));
    res.json({ conversations });
  });

  router.get('/conversations/:id', (req, res) => {
    const conv = service.requireViewable(req.user, readId(req.params.id));
    res.json({
      conversation: service.conversationView(conv),
      visitor: service.visitorView(store.getVisitor(conv.visitor_id)),
    });
  });

  router.get('/conversations/:id/messages', (req, res) => {
    const conv = service.requireViewable(req.user, readId(req.params.id));
    const messages = store.listMessages(conv.id, {
      before: readInt(req.query.before, { field: 'before', min: 1 }),
      limit: readInt(req.query.limit, { field: 'limit', min: 1, max: 200 }) ?? 100,
    });
    res.json({ messages: messages.map((m) => service.messageView(m)) });
  });

  router.post('/conversations/:id/messages', (req, res) => {
    const message = service.sendAgentMessage(req.user, readId(req.params.id), req.body);
    res.status(201).json({ message: service.messageView(message) });
  });

  router.post('/conversations/:id/accept', (req, res) => {
    const conv = service.acceptConversation(req.user, readId(req.params.id));
    res.json({ conversation: service.conversationView(conv) });
  });

  router.post('/conversations/:id/transfer', (req, res) => {
    const targetId = readInt(req.body.agent_id, { field: '目标客服', min: 1, required: true });
    const conv = service.transferConversation(req.user, readId(req.params.id), targetId);
    res.json({ conversation: service.conversationView(conv) });
  });

  router.post('/conversations/:id/close', (req, res) => {
    const conv = service.closeByAgent(req.user, readId(req.params.id));
    res.json({ conversation: service.conversationView(conv) });
  });

  router.post('/conversations/:id/read', (req, res) => {
    service.markRead(req.user, readId(req.params.id));
    res.json({ ok: true });
  });

  router.patch('/conversations/:id/visitor', (req, res) => {
    const conv = service.requireViewable(req.user, readId(req.params.id));
    const fields = normalizeVisitorProfile(req.body);
    fields.note = readString(req.body.note, { field: '备注', max: 1000 });
    // Allow clearing a field by sending an empty string.
    for (const key of ['name', 'email', 'phone', 'note']) {
      if (req.body[key] === '') fields[key] = null;
    }
    store.updateVisitor(conv.visitor_id, fields);
    const updated = store.getConversation(conv.id);
    service.publishConversation(updated, [], { toVisitor: false });
    res.json({ visitor: service.visitorView(store.getVisitor(conv.visitor_id)) });
  });

  router.get('/agents', (req, res) => {
    res.json({ agents: store.listUsers().map((u) => service.agentView(u)) });
  });

  router.get('/quick-replies', (req, res) => {
    res.json({ quick_replies: store.listQuickReplies() });
  });

  router.get('/settings', (req, res) => {
    res.json({ settings: store.getSettings() });
  });

  return router;
}

module.exports = { workspaceRoutes };
