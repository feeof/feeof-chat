'use strict';

const { transaction } = require('./db');

const DEFAULT_SETTINGS = {
  site_name: 'Feeof 在线客服',
  welcome_message: '您好，欢迎咨询！请问有什么可以帮您？',
  offline_message: '当前客服不在线，请留下您的问题和联系方式，我们会尽快回复您。',
  queue_message: '正在为您接入人工客服，请稍候…',
  theme_color: '#2563eb',
  auto_assign: true,
  auto_close_minutes: 30,
  // AI customer service
  ai_enabled: false,
  // 'always': AI answers every new conversation first;
  // 'offline': AI answers only when no human agent can take the conversation.
  ai_mode: 'always',
  ai_name: '智能客服',
  ai_instructions: '',
  ai_handoff_message: '正在为您转接人工客服，请稍候…',
};

const CONVERSATION_SELECT = `
  SELECT c.*, v.name AS visitor_name, u.display_name AS agent_name
  FROM conversations c
  JOIN visitors v ON v.id = c.visitor_id
  LEFT JOIN users u ON u.id = c.agent_id`;

const MESSAGE_SELECT = `
  SELECT m.*, u.display_name AS sender_name
  FROM messages m
  LEFT JOIN users u ON m.sender_type = 'agent' AND u.id = m.sender_id`;

const USER_COLUMNS = ['display_name', 'password_hash', 'role', 'status', 'max_concurrent', 'disabled', 'last_assigned_at'];
const VISITOR_COLUMNS = ['name', 'email', 'phone', 'note', 'ip', 'user_agent', 'page_url', 'page_title', 'referrer', 'last_seen_at'];
const CONVERSATION_COLUMNS = [
  'agent_id', 'status', 'assigned_at', 'first_response_at', 'closed_at', 'closed_by',
  'rating', 'rating_comment', 'agent_unread', 'handoff_at', 'handoff_reason',
];
const KB_COLUMNS = ['title', 'content', 'enabled'];

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function messagePreview(type, content) {
  if (type === 'image') return '[图片]';
  return content.replace(/\s+/g, ' ').slice(0, 100);
}

class Store {
  constructor(db) {
    this.db = db;
    this.statements = new Map();
    this.settingsCache = null;
    // Bumped on every knowledge base change so derived indexes know to rebuild.
    this.kbVersion = 0;
  }

  prepare(sql) {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  get(sql, ...params) {
    return this.prepare(sql).get(...params);
  }

  all(sql, ...params) {
    return this.prepare(sql).all(...params);
  }

  run(sql, ...params) {
    return this.prepare(sql).run(...params);
  }

  tx(fn) {
    return transaction(this.db, fn);
  }

  /** Builds and runs an UPDATE restricted to whitelisted columns. */
  updateRow(table, allowed, id, fields) {
    const keys = Object.keys(fields).filter((key) => allowed.includes(key) && fields[key] !== undefined);
    if (keys.length === 0) return;
    const assignments = keys.map((key) => `${key} = ?`).join(', ');
    this.run(`UPDATE ${table} SET ${assignments} WHERE id = ?`, ...keys.map((key) => fields[key]), id);
  }

  // ---- settings ----

  getSettings() {
    if (!this.settingsCache) {
      const settings = { ...DEFAULT_SETTINGS };
      for (const row of this.all('SELECT key, value FROM settings')) {
        if (row.key in DEFAULT_SETTINGS) settings[row.key] = JSON.parse(row.value);
      }
      this.settingsCache = Object.freeze(settings);
    }
    return this.settingsCache;
  }

  updateSettings(patch) {
    this.settingsCache = null;
    this.tx(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
        this.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          key,
          JSON.stringify(value),
        );
      }
    });
    return this.getSettings();
  }

  // ---- users (agents & admins) ----

  countUsers() {
    return this.get('SELECT COUNT(*) AS n FROM users').n;
  }

  createUser({ username, passwordHash, displayName, role = 'agent', maxConcurrent = 5 }) {
    const { lastInsertRowid } = this.run(
      `INSERT INTO users (username, password_hash, display_name, role, max_concurrent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      username,
      passwordHash,
      displayName,
      role,
      maxConcurrent,
      Date.now(),
    );
    return this.getUser(Number(lastInsertRowid));
  }

  getUser(id) {
    return this.get('SELECT * FROM users WHERE id = ?', id);
  }

  getUserByUsername(username) {
    return this.get('SELECT * FROM users WHERE username = ?', username);
  }

  listUsers() {
    return this.all(`
      SELECT u.*,
        (SELECT COUNT(*) FROM conversations c WHERE c.agent_id = u.id AND c.status = 'active') AS active_count
      FROM users u
      ORDER BY u.id`);
  }

  updateUser(id, fields) {
    this.updateRow('users', USER_COLUMNS, id, fields);
  }

  // ---- sessions ----

  createSession(tokenHash, userId, expiresAt) {
    this.run(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      tokenHash,
      userId,
      Date.now(),
      expiresAt,
    );
  }

  getSessionUser(tokenHash, now = Date.now()) {
    return this.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
      tokenHash,
      now,
    );
  }

  deleteSession(tokenHash) {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  deleteUserSessions(userId, { except } = {}) {
    this.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', userId, except || '');
  }

  purgeExpiredSessions(now = Date.now()) {
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now);
  }

  // ---- visitors ----

  createVisitor(tokenHash, fields) {
    const now = Date.now();
    const { lastInsertRowid } = this.run(
      'INSERT INTO visitors (token_hash, created_at, last_seen_at) VALUES (?, ?, ?)',
      tokenHash,
      now,
      now,
    );
    const id = Number(lastInsertRowid);
    this.updateVisitor(id, fields);
    return this.getVisitor(id);
  }

  getVisitor(id) {
    return this.get('SELECT * FROM visitors WHERE id = ?', id);
  }

  getVisitorByTokenHash(tokenHash) {
    return this.get('SELECT * FROM visitors WHERE token_hash = ?', tokenHash);
  }

  updateVisitor(id, fields) {
    this.updateRow('visitors', VISITOR_COLUMNS, id, fields);
  }

  countVisitorConversations(visitorId) {
    return this.get('SELECT COUNT(*) AS n FROM conversations WHERE visitor_id = ?', visitorId).n;
  }

  // ---- conversations ----

  getConversation(id) {
    return this.get(`${CONVERSATION_SELECT} WHERE c.id = ?`, id);
  }

  getOpenConversation(visitorId) {
    return this.get(`${CONVERSATION_SELECT} WHERE c.visitor_id = ? AND c.status != 'closed'`, visitorId);
  }

  getLatestConversation(visitorId) {
    return this.get(`${CONVERSATION_SELECT} WHERE c.visitor_id = ? ORDER BY c.id DESC LIMIT 1`, visitorId);
  }

  createConversation(visitorId, now = Date.now(), status = 'waiting') {
    const { lastInsertRowid } = this.run(
      `INSERT INTO conversations (visitor_id, status, created_at, last_message_at)
       VALUES (?, ?, ?, ?)`,
      visitorId,
      status,
      now,
      now,
    );
    return this.getConversation(Number(lastInsertRowid));
  }

  updateConversation(id, fields) {
    this.updateRow('conversations', CONVERSATION_COLUMNS, id, fields);
  }

  incrementAgentUnread(id) {
    this.run('UPDATE conversations SET agent_unread = agent_unread + 1 WHERE id = ?', id);
  }

  listWaitingConversations() {
    return this.all(`${CONVERSATION_SELECT} WHERE c.status = 'waiting' ORDER BY c.created_at, c.id`);
  }

  listActiveConversationsForAgent(agentId) {
    return this.all(`${CONVERSATION_SELECT} WHERE c.status = 'active' AND c.agent_id = ?`, agentId);
  }

  /** Conversations someone is serving (an agent or the AI) that went quiet. */
  listIdleConversations(cutoff) {
    return this.all(`${CONVERSATION_SELECT} WHERE c.status IN ('active', 'bot') AND c.last_message_at < ?`, cutoff);
  }

  countBotMessages(conversationId) {
    return this.get(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_type = 'bot'",
      conversationId,
    ).n;
  }

  listBotConversations() {
    return this.all(`${CONVERSATION_SELECT} WHERE c.status = 'bot'`);
  }

  /**
   * Lists conversations for the agent workspace.
   * status: 'waiting' | 'active' | 'closed'; agentId restricts to one agent;
   * q searches visitor contact info, the conversation id and message text.
   */
  listConversations({ status, agentId, q, limit = 50, offset = 0 }) {
    const where = [];
    const params = [];
    if (status) {
      where.push('c.status = ?');
      params.push(status);
    }
    if (agentId !== undefined) {
      where.push('c.agent_id = ?');
      params.push(agentId);
    }
    if (q) {
      const like = `%${escapeLike(q)}%`;
      where.push(`(
        v.name LIKE ? ESCAPE '\\' OR v.email LIKE ? ESCAPE '\\' OR v.phone LIKE ? ESCAPE '\\'
        OR CAST(c.id AS TEXT) = ?
        OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.type = 'text' AND m.content LIKE ? ESCAPE '\\')
      )`);
      params.push(like, like, like, q, like);
    }
    const order = {
      waiting: 'c.created_at ASC, c.id ASC',
      closed: 'c.closed_at DESC, c.id DESC',
    }[status] || 'c.last_message_at DESC, c.id DESC';
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.all(
      `${CONVERSATION_SELECT} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
  }

  // ---- messages ----

  /** Inserts a message and updates the conversation's activity fields. */
  addMessage({ conversationId, senderType, senderId = null, type = 'text', content, now = Date.now() }) {
    const { lastInsertRowid } = this.run(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      conversationId,
      senderType,
      senderId,
      type,
      content,
      now,
    );
    if (senderType === 'system') {
      this.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', now, conversationId);
    } else {
      this.run(
        'UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?',
        now,
        messagePreview(type, content),
        conversationId,
      );
    }
    return this.getMessage(Number(lastInsertRowid));
  }

  getMessage(id) {
    return this.get(`${MESSAGE_SELECT} WHERE m.id = ?`, id);
  }

  listMessages(conversationId, { before, limit = 100 } = {}) {
    const rows = this.all(
      `${MESSAGE_SELECT} WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
      conversationId,
      before || Number.MAX_SAFE_INTEGER,
      limit,
    );
    return rows.reverse();
  }

  /** Messages across all of a visitor's conversations (the widget shows one continuous thread). */
  listVisitorMessages(visitorId, { before, after, limit = 100 } = {}) {
    if (after) {
      return this.all(
        `${MESSAGE_SELECT} JOIN conversations c ON c.id = m.conversation_id
         WHERE c.visitor_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`,
        visitorId,
        after,
        limit,
      );
    }
    const rows = this.all(
      `${MESSAGE_SELECT} JOIN conversations c ON c.id = m.conversation_id
       WHERE c.visitor_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
      visitorId,
      before || Number.MAX_SAFE_INTEGER,
      limit,
    );
    return rows.reverse();
  }

  // ---- quick replies ----

  listQuickReplies() {
    return this.all('SELECT * FROM quick_replies ORDER BY sort, id');
  }

  getQuickReply(id) {
    return this.get('SELECT * FROM quick_replies WHERE id = ?', id);
  }

  createQuickReply({ title, content, sort = 0 }) {
    const { lastInsertRowid } = this.run(
      'INSERT INTO quick_replies (title, content, sort, created_at) VALUES (?, ?, ?, ?)',
      title,
      content,
      sort,
      Date.now(),
    );
    return this.getQuickReply(Number(lastInsertRowid));
  }

  updateQuickReply(id, fields) {
    this.updateRow('quick_replies', ['title', 'content', 'sort'], id, fields);
    return this.getQuickReply(id);
  }

  deleteQuickReply(id) {
    return this.run('DELETE FROM quick_replies WHERE id = ?', id).changes > 0;
  }

  // ---- knowledge base ----

  listKbArticles({ q, limit = 50, offset = 0 } = {}) {
    const where = q ? `WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'` : '';
    const params = q ? [`%${escapeLike(q)}%`, `%${escapeLike(q)}%`] : [];
    return {
      articles: this.all(`SELECT * FROM kb_articles ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset),
      total: this.get(`SELECT COUNT(*) AS n FROM kb_articles ${where}`, ...params).n,
    };
  }

  listEnabledKbArticles() {
    return this.all('SELECT * FROM kb_articles WHERE enabled = 1 ORDER BY id');
  }

  getKbArticle(id) {
    return this.get('SELECT * FROM kb_articles WHERE id = ?', id);
  }

  createKbArticles(list) {
    const now = Date.now();
    const ids = this.tx(() =>
      list.map(({ title, content, enabled = 1 }) =>
        Number(
          this.run(
            'INSERT INTO kb_articles (title, content, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            title,
            content,
            enabled ? 1 : 0,
            now,
            now,
          ).lastInsertRowid,
        ),
      ),
    );
    this.kbVersion += 1;
    return ids.map((id) => this.getKbArticle(id));
  }

  updateKbArticle(id, fields) {
    const changes = { ...fields };
    if (changes.enabled !== undefined) changes.enabled = changes.enabled ? 1 : 0;
    this.updateRow('kb_articles', KB_COLUMNS, id, changes);
    this.run('UPDATE kb_articles SET updated_at = ? WHERE id = ?', Date.now(), id);
    this.kbVersion += 1;
    return this.getKbArticle(id);
  }

  deleteKbArticle(id) {
    const deleted = this.run('DELETE FROM kb_articles WHERE id = ?', id).changes > 0;
    if (deleted) this.kbVersion += 1;
    return deleted;
  }

  // ---- statistics ----

  stats(from, to) {
    const overview = this.get(
      `SELECT
         COUNT(*) AS conversations,
         COUNT(DISTINCT visitor_id) AS visitors,
         COALESCE(SUM(status = 'closed'), 0) AS closed,
         COALESCE(SUM(first_response_at IS NULL AND NOT EXISTS (
           SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'bot'
         )), 0) AS unanswered,
         COALESCE(SUM(EXISTS (
           SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'bot'
         )), 0) AS ai_conversations,
         COALESCE(SUM(status = 'closed' AND handoff_at IS NULL AND EXISTS (
           SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'bot'
         )), 0) AS ai_resolved,
         COUNT(handoff_at) AS handoffs,
         AVG(first_response_at - created_at) AS avg_first_response_ms,
         AVG(CASE WHEN closed_at IS NOT NULL AND assigned_at IS NOT NULL THEN closed_at - assigned_at END) AS avg_duration_ms,
         AVG(rating) AS avg_rating,
         COUNT(rating) AS rated,
         COALESCE(SUM(rating >= 4), 0) AS satisfied
       FROM conversations c WHERE created_at >= ? AND created_at < ?`,
      from,
      to,
    );
    overview.messages = this.get(
      `SELECT COUNT(*) AS n FROM messages
       WHERE sender_type != 'system' AND created_at >= ? AND created_at < ?`,
      from,
      to,
    ).n;
    const current = this.get(
      `SELECT COALESCE(SUM(status = 'waiting'), 0) AS waiting, COALESCE(SUM(status = 'active'), 0) AS active,
         COALESCE(SUM(status = 'bot'), 0) AS bot
       FROM conversations WHERE status != 'closed'`,
    );
    const agents = this.all(
      `SELECT u.id, u.display_name, u.role, u.status, u.disabled,
         COUNT(c.id) AS conversations,
         COALESCE(SUM(c.status = 'closed'), 0) AS closed,
         AVG(c.first_response_at - c.created_at) AS avg_first_response_ms,
         AVG(c.rating) AS avg_rating,
         COUNT(c.rating) AS rated,
         (SELECT COUNT(*) FROM messages m
            WHERE m.sender_type = 'agent' AND m.sender_id = u.id AND m.created_at >= ? AND m.created_at < ?) AS messages
       FROM users u
       LEFT JOIN conversations c ON c.agent_id = u.id AND c.created_at >= ? AND c.created_at < ?
       GROUP BY u.id
       ORDER BY conversations DESC, u.id`,
      from,
      to,
      from,
      to,
    );
    const daily = this.all(
      `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS conversations
       FROM conversations WHERE created_at >= ? AND created_at < ?
       GROUP BY day ORDER BY day`,
      from,
      to,
    );
    return { overview, current, agents, daily };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, messagePreview };
