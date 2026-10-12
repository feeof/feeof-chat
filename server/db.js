'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Each entry upgrades the schema by one version (tracked in PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
    status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'away', 'offline')),
    max_concurrent INTEGER NOT NULL DEFAULT 5,
    disabled INTEGER NOT NULL DEFAULT 0,
    last_assigned_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE visitors (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT,
    email TEXT,
    phone TEXT,
    note TEXT,
    ip TEXT,
    user_agent TEXT,
    page_url TEXT,
    page_title TEXT,
    referrer TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'closed')),
    created_at INTEGER NOT NULL,
    assigned_at INTEGER,
    first_response_at INTEGER,
    closed_at INTEGER,
    closed_by TEXT,
    rating INTEGER,
    rating_comment TEXT,
    last_message_at INTEGER NOT NULL,
    last_message_preview TEXT NOT NULL DEFAULT '',
    agent_unread INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_conversations_status ON conversations(status, last_message_at);
  CREATE INDEX idx_conversations_agent ON conversations(agent_id, status);
  CREATE INDEX idx_conversations_created ON conversations(created_at);
  -- A visitor can have at most one open (waiting/active) conversation.
  CREATE UNIQUE INDEX idx_conversations_visitor_open
    ON conversations(visitor_id) WHERE status != 'closed';
  CREATE INDEX idx_conversations_visitor ON conversations(visitor_id);

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'agent', 'system')),
    sender_id INTEGER,
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_conversation ON messages(conversation_id, id);

  CREATE TABLE quick_replies (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // v2: AI customer service. SQLite cannot alter CHECK constraints, so the
  // conversations and messages tables are rebuilt (the documented 12-step
  // procedure; foreign keys are switched off around it by migrate()).
  `
  CREATE TABLE conversations_v2 (
    id INTEGER PRIMARY KEY,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('bot', 'waiting', 'active', 'closed')),
    created_at INTEGER NOT NULL,
    assigned_at INTEGER,
    first_response_at INTEGER,
    closed_at INTEGER,
    closed_by TEXT,
    rating INTEGER,
    rating_comment TEXT,
    last_message_at INTEGER NOT NULL,
    last_message_preview TEXT NOT NULL DEFAULT '',
    agent_unread INTEGER NOT NULL DEFAULT 0,
    handoff_at INTEGER,
    handoff_reason TEXT
  );
  INSERT INTO conversations_v2 (
    id, visitor_id, agent_id, status, created_at, assigned_at, first_response_at, closed_at, closed_by,
    rating, rating_comment, last_message_at, last_message_preview, agent_unread
  )
  SELECT
    id, visitor_id, agent_id, status, created_at, assigned_at, first_response_at, closed_at, closed_by,
    rating, rating_comment, last_message_at, last_message_preview, agent_unread
  FROM conversations;
  DROP TABLE conversations;
  ALTER TABLE conversations_v2 RENAME TO conversations;
  CREATE INDEX idx_conversations_status ON conversations(status, last_message_at);
  CREATE INDEX idx_conversations_agent ON conversations(agent_id, status);
  CREATE INDEX idx_conversations_created ON conversations(created_at);
  CREATE UNIQUE INDEX idx_conversations_visitor_open
    ON conversations(visitor_id) WHERE status != 'closed';
  CREATE INDEX idx_conversations_visitor ON conversations(visitor_id);

  CREATE TABLE messages_v2 (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'agent', 'bot', 'system')),
    sender_id INTEGER,
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  INSERT INTO messages_v2 SELECT id, conversation_id, sender_type, sender_id, type, content, created_at FROM messages;
  DROP TABLE messages;
  ALTER TABLE messages_v2 RENAME TO messages;
  CREATE INDEX idx_messages_conversation ON messages(conversation_id, id);
  CREATE INDEX idx_messages_created ON messages(created_at);

  CREATE TABLE kb_articles (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version >= MIGRATIONS.length) return;
  // Table rebuilds require foreign key enforcement to be off; it can only be
  // toggled outside a transaction.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (let i = version; i < MIGRATIONS.length; i++) {
      transaction(db, () => {
        db.exec(MIGRATIONS[i]);
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length) throw new Error(`migration ${i + 1} broke ${violations.length} foreign keys`);
        db.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction, MIGRATIONS };
