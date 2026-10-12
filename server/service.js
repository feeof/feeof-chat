'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { badRequest, forbidden, notFound, conflict, readString } = require('./util');

const IMAGE_URL_RE = /^\/uploads\/([a-f0-9]{32}\.(?:png|jpg|gif|webp))$/;

const CLOSE_TEXT = {
  agent: '客服已结束本次会话，感谢您的咨询！',
  visitor: '访客已结束会话',
  system: '由于长时间没有新消息，会话已自动结束',
};

/**
 * Conversation workflow: routing, assignment, messaging and the realtime
 * notifications that go with each state change.
 *
 * Socket.IO rooms used:
 *   agents        every connected agent (sees the waiting queue)
 *   admins        connected admins (see every conversation)
 *   agent:<id>    one agent's connections
 *   visitors      every connected visitor
 *   visitor:<id>  one visitor's connections
 */
class ChatService {
  constructor({ store, presence, config }) {
    this.store = store;
    this.presence = presence;
    this.config = config;
    this.io = null;
    this.draining = false;
  }

  attach(io) {
    this.io = io;
  }

  emit(rooms, event, payload) {
    if (this.io && rooms.length > 0) this.io.to(rooms).emit(event, payload);
  }

  // ---- views sent to clients ----

  conversationView(conv) {
    return {
      id: conv.id,
      status: conv.status,
      visitor_id: conv.visitor_id,
      visitor_name: conv.visitor_name || `访客 ${conv.visitor_id}`,
      visitor_online: this.presence.isVisitorOnline(conv.visitor_id),
      agent_id: conv.agent_id,
      agent_name: conv.agent_name || null,
      created_at: conv.created_at,
      assigned_at: conv.assigned_at,
      first_response_at: conv.first_response_at,
      closed_at: conv.closed_at,
      closed_by: conv.closed_by,
      rating: conv.rating,
      rating_comment: conv.rating_comment,
      last_message_at: conv.last_message_at,
      last_message_preview: conv.last_message_preview,
      agent_unread: conv.agent_unread,
    };
  }

  visitorConversationView(conv) {
    if (!conv) return null;
    return {
      id: conv.id,
      status: conv.status,
      agent_name: conv.agent_name || null,
      rating: conv.rating,
      rating_comment: conv.rating_comment,
      closed_at: conv.closed_at,
    };
  }

  messageView(msg) {
    return {
      id: msg.id,
      conversation_id: msg.conversation_id,
      sender_type: msg.sender_type,
      sender_id: msg.sender_id,
      sender_name: msg.sender_name || null,
      type: msg.type,
      content: msg.content,
      created_at: msg.created_at,
    };
  }

  agentView(user) {
    return {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      status: this.effectiveStatus(user),
      preferred_status: user.status,
      max_concurrent: user.max_concurrent,
      disabled: Boolean(user.disabled),
      active_count: user.active_count,
      created_at: user.created_at,
    };
  }

  visitorView(visitor) {
    return {
      id: visitor.id,
      name: visitor.name,
      display_name: visitor.name || `访客 ${visitor.id}`,
      email: visitor.email,
      phone: visitor.phone,
      note: visitor.note,
      ip: visitor.ip,
      user_agent: visitor.user_agent,
      page_url: visitor.page_url,
      page_title: visitor.page_title,
      referrer: visitor.referrer,
      created_at: visitor.created_at,
      last_seen_at: visitor.last_seen_at,
      online: this.presence.isVisitorOnline(visitor.id),
      conversation_count: this.store.countVisitorConversations(visitor.id),
    };
  }

  effectiveStatus(user) {
    if (user.disabled || !this.presence.isAgentOnline(user.id)) return 'offline';
    return user.status;
  }

  isServiceOnline() {
    return this.store.listUsers().some((u) => !u.disabled && u.status === 'online' && this.presence.isAgentOnline(u.id));
  }

  // ---- realtime publishing ----

  agentRooms(conv) {
    if (conv.status === 'waiting') return ['agents'];
    return conv.agent_id ? [`agent:${conv.agent_id}`, 'admins'] : ['admins'];
  }

  /**
   * Broadcasts a conversation's new state. `previousRooms` lets clients that
   * could see the old state (e.g. the queue, or the agent it was transferred
   * away from) drop it from their lists.
   */
  publishConversation(conv, previousRooms = [], { toVisitor = true } = {}) {
    const rooms = [...new Set([...this.agentRooms(conv), ...previousRooms])];
    this.emit(rooms, 'conversation:update', this.conversationView(conv));
    if (toVisitor) {
      this.emit([`visitor:${conv.visitor_id}`], 'conversation', this.visitorConversationView(conv));
    }
  }

  publishMessage(conv, msg) {
    const view = this.messageView(msg);
    this.emit(this.agentRooms(conv), 'message', view);
    this.emit([`visitor:${conv.visitor_id}`], 'message', view);
  }

  addSystemMessage(conv, text) {
    if (!text) return null;
    const msg = this.store.addMessage({ conversationId: conv.id, senderType: 'system', content: text });
    this.publishMessage(conv, msg);
    return msg;
  }

  // ---- access helpers ----

  requireConversation(id) {
    const conv = this.store.getConversation(id);
    if (!conv) throw notFound('会话不存在');
    return conv;
  }

  canView(user, conv) {
    return user.role === 'admin' || conv.status === 'waiting' || conv.agent_id === user.id;
  }

  requireViewable(user, id) {
    const conv = this.requireConversation(id);
    if (!this.canView(user, conv)) throw forbidden('无权查看该会话');
    return conv;
  }

  normalizeMessage({ type = 'text', content } = {}) {
    if (type === 'text') {
      return {
        type,
        content: readString(content, { field: '消息内容', max: this.config.maxMessageLength, required: true }),
      };
    }
    if (type === 'image') {
      const match = typeof content === 'string' && IMAGE_URL_RE.exec(content);
      if (!match || !fs.existsSync(path.join(this.config.uploadsDir, match[1]))) {
        throw badRequest('图片不存在，请重新上传');
      }
      return { type, content };
    }
    throw badRequest('不支持的消息类型');
  }

  // ---- routing ----

  /** Online agent with spare capacity and the lightest load, or null. */
  pickAgent() {
    const candidates = this.store
      .listUsers()
      .filter(
        (u) =>
          !u.disabled &&
          u.status === 'online' &&
          this.presence.isAgentOnline(u.id) &&
          u.active_count < u.max_concurrent,
      );
    candidates.sort(
      (a, b) => a.active_count - b.active_count || a.last_assigned_at - b.last_assigned_at || a.id - b.id,
    );
    return candidates[0] || null;
  }

  assign(conv, agent, { transfer = false } = {}) {
    const now = Date.now();
    const previousRooms = this.agentRooms(conv);
    this.store.tx(() => {
      this.store.updateConversation(conv.id, {
        status: 'active',
        agent_id: agent.id,
        assigned_at: conv.assigned_at ?? now,
      });
      this.store.updateUser(agent.id, { last_assigned_at: now });
    });
    const updated = this.store.getConversation(conv.id);
    this.publishConversation(updated, previousRooms);
    this.addSystemMessage(
      updated,
      transfer ? `会话已转接至客服 ${agent.display_name}` : `客服 ${agent.display_name} 正在为您服务`,
    );
    return updated;
  }

  tryAutoAssign(conv) {
    if (!this.store.getSettings().auto_assign) return false;
    const agent = this.pickAgent();
    if (!agent) return false;
    this.assign(conv, agent);
    return true;
  }

  /** Hands waiting conversations to available agents, oldest first. */
  drainQueue() {
    if (this.draining || !this.store.getSettings().auto_assign) return;
    this.draining = true;
    try {
      for (const conv of this.store.listWaitingConversations()) {
        const agent = this.pickAgent();
        if (!agent) break;
        this.assign(conv, agent);
      }
    } finally {
      this.draining = false;
    }
  }

  close(conv, closedBy) {
    const previousRooms = this.agentRooms(conv);
    this.store.updateConversation(conv.id, {
      status: 'closed',
      closed_at: Date.now(),
      closed_by: closedBy,
      agent_unread: 0,
    });
    this.addSystemMessage(this.store.getConversation(conv.id), CLOSE_TEXT[closedBy]);
    const updated = this.store.getConversation(conv.id);
    this.publishConversation(updated, previousRooms);
    this.drainQueue();
    return updated;
  }

  /** Puts an agent's active conversations back in the queue (e.g. the agent was disabled). */
  requeueAgentConversations(agentId) {
    for (const conv of this.store.listActiveConversationsForAgent(agentId)) {
      const previousRooms = this.agentRooms(conv);
      this.store.updateConversation(conv.id, { status: 'waiting', agent_id: null });
      const updated = this.store.getConversation(conv.id);
      this.publishConversation(updated, previousRooms);
      this.addSystemMessage(updated, '正在为您重新分配客服，请稍候…');
    }
    this.drainQueue();
  }

  // ---- visitor actions ----

  sendVisitorMessage(visitor, input) {
    const { type, content } = this.normalizeMessage(input);
    const now = Date.now();
    const { conversation, message, created } = this.store.tx(() => {
      let conv = this.store.getOpenConversation(visitor.id);
      const isNew = !conv;
      if (isNew) conv = this.store.createConversation(visitor.id, now);
      const msg = this.store.addMessage({
        conversationId: conv.id,
        senderType: 'visitor',
        senderId: visitor.id,
        type,
        content,
        now,
      });
      this.store.incrementAgentUnread(conv.id);
      this.store.updateVisitor(visitor.id, { last_seen_at: now });
      return { conversation: this.store.getConversation(conv.id), message: msg, created: isNew };
    });
    this.publishConversation(conversation);
    this.publishMessage(conversation, message);
    if (created && !this.tryAutoAssign(conversation)) {
      const settings = this.store.getSettings();
      this.addSystemMessage(conversation, this.isServiceOnline() ? settings.queue_message : settings.offline_message);
    }
    return message;
  }

  closeByVisitor(visitor) {
    const conv = this.store.getOpenConversation(visitor.id);
    if (!conv) throw conflict('当前没有进行中的会话');
    return this.close(conv, 'visitor');
  }

  rateConversation(visitor, conversationId, { rating, comment }) {
    const conv = this.store.getConversation(conversationId);
    if (!conv || conv.visitor_id !== visitor.id) throw notFound('会话不存在');
    if (conv.status !== 'closed') throw conflict('会话结束后才能评价');
    if (conv.rating) throw conflict('您已经评价过本次会话');
    this.store.updateConversation(conv.id, { rating, rating_comment: comment || null });
    const updated = this.store.getConversation(conv.id);
    this.publishConversation(updated);
    return updated;
  }

  visitorTyping(visitorId) {
    const conv = this.store.getOpenConversation(visitorId);
    if (conv) this.emit(this.agentRooms(conv), 'typing', { conversation_id: conv.id, from: 'visitor' });
  }

  visitorConnectionChanged(visitorId) {
    this.store.updateVisitor(visitorId, { last_seen_at: Date.now() });
    const conv = this.store.getOpenConversation(visitorId);
    if (conv) this.publishConversation(conv, [], { toVisitor: false });
  }

  // ---- agent actions ----

  acceptConversation(user, conversationId) {
    const conv = this.requireConversation(conversationId);
    if (conv.status === 'active') throw conflict('该会话已被其他客服接入');
    if (conv.status === 'closed') throw conflict('该会话已结束');
    return this.assign(conv, user);
  }

  transferConversation(user, conversationId, targetId) {
    const conv = this.requireConversation(conversationId);
    if (conv.status === 'closed') throw conflict('该会话已结束');
    if (user.role !== 'admin' && conv.agent_id !== user.id) throw forbidden('只能转接自己接待的会话');
    const target = this.store.getUser(targetId);
    if (!target || target.disabled) throw badRequest('目标客服不存在或已被禁用');
    if (target.id === conv.agent_id) throw badRequest('该会话已由此客服接待');
    return this.assign(conv, target, { transfer: conv.status === 'active' });
  }

  closeByAgent(user, conversationId) {
    const conv = this.requireConversation(conversationId);
    if (conv.status === 'closed') return conv;
    if (conv.status === 'active' && user.role !== 'admin' && conv.agent_id !== user.id) {
      throw forbidden('只能结束自己接待的会话');
    }
    return this.close(conv, 'agent');
  }

  sendAgentMessage(user, conversationId, input) {
    const conv = this.requireConversation(conversationId);
    if (conv.status === 'closed') throw conflict('该会话已结束');
    if (conv.status === 'waiting') throw conflict('请先接入该会话');
    if (conv.agent_id !== user.id) throw forbidden('该会话由其他客服接待');
    const { type, content } = this.normalizeMessage(input);
    const now = Date.now();
    const message = this.store.tx(() => {
      const msg = this.store.addMessage({
        conversationId: conv.id,
        senderType: 'agent',
        senderId: user.id,
        type,
        content,
        now,
      });
      this.store.updateConversation(conv.id, { agent_unread: 0, first_response_at: conv.first_response_at ?? now });
      return msg;
    });
    const updated = this.store.getConversation(conv.id);
    this.publishConversation(updated);
    this.publishMessage(updated, message);
    return message;
  }

  markRead(user, conversationId) {
    const conv = this.requireViewable(user, conversationId);
    if (conv.agent_unread > 0 && conv.agent_id === user.id) {
      this.store.updateConversation(conv.id, { agent_unread: 0 });
      this.publishConversation(this.store.getConversation(conv.id), [], { toVisitor: false });
    }
  }

  agentTyping(userId, conversationId) {
    const conv = this.store.getConversation(conversationId);
    if (conv && conv.status === 'active' && conv.agent_id === userId) {
      this.emit([`visitor:${conv.visitor_id}`], 'typing', { conversation_id: conv.id, from: 'agent' });
    }
  }

  setAgentStatus(user, status) {
    this.store.updateUser(user.id, { status });
    const updated = this.store.getUser(user.id);
    this.publishAgentPresence(updated);
    if (status === 'online') this.drainQueue();
    return updated;
  }

  publishAgentPresence(user) {
    this.emit(['agents'], 'agent:presence', { id: user.id, status: this.effectiveStatus(user) });
    this.emit(['visitors'], 'service:status', { online: this.isServiceOnline() });
  }

  agentConnectionChanged(userId) {
    const user = this.store.getUser(userId);
    if (!user) return;
    this.publishAgentPresence(user);
    if (user.status === 'online' && this.presence.isAgentOnline(userId)) this.drainQueue();
  }

  /**
   * Drops an agent's live connections. `only` / `except` take a session
   * token hash to limit which login sessions are affected.
   */
  async disconnectAgent(userId, { only, except } = {}) {
    if (!this.io) return;
    const sockets = await this.io.in(`agent:${userId}`).fetchSockets();
    for (const socket of sockets) {
      const tokenHash = socket.data.tokenHash;
      if ((only && tokenHash !== only) || (except && tokenHash === except)) continue;
      socket.disconnect(true);
    }
  }

  // ---- maintenance ----

  closeIdleConversations(now = Date.now()) {
    const minutes = Number(this.store.getSettings().auto_close_minutes);
    if (!(minutes > 0)) return 0;
    const idle = this.store.listIdleActiveConversations(now - minutes * 60 * 1000);
    for (const conv of idle) this.close(conv, 'system');
    return idle.length;
  }
}

module.exports = { ChatService };
