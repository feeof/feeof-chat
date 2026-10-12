'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase, MIGRATIONS } = require('../server/db');

test('v1 databases upgrade in place without losing data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feeof-migrate-'));
  const file = path.join(dir, 'chat.db');
  try {
    const v1 = new DatabaseSync(file);
    v1.exec(MIGRATIONS[0]);
    v1.exec('PRAGMA user_version = 1');
    v1.exec(`
      INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (1, 'a', 'x', 'A', 'admin', 1);
      INSERT INTO visitors (id, token_hash, created_at, last_seen_at) VALUES (1, 't', 1, 1);
      INSERT INTO conversations (id, visitor_id, agent_id, status, created_at, last_message_at, rating)
        VALUES (7, 1, 1, 'closed', 1, 2, 5);
      INSERT INTO messages (conversation_id, sender_type, content, created_at) VALUES (7, 'visitor', 'hello', 1);
    `);
    v1.close();

    const db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    const conv = db.prepare('SELECT * FROM conversations WHERE id = 7').get();
    assert.equal(conv.rating, 5);
    assert.equal(conv.handoff_at, null);
    assert.equal(db.prepare('SELECT content FROM messages WHERE conversation_id = 7').get().content, 'hello');

    // New values are accepted and the one-open-conversation rule still holds.
    db.exec("INSERT INTO conversations (visitor_id, status, created_at, last_message_at) VALUES (1, 'bot', 3, 3)");
    db.exec("INSERT INTO messages (conversation_id, sender_type, content, created_at) VALUES (7, 'bot', 'hi', 3)");
    assert.throws(() =>
      db.exec("INSERT INTO conversations (visitor_id, status, created_at, last_message_at) VALUES (1, 'waiting', 4, 4)"),
    );
    // Cascades still work after the rebuild.
    db.exec('DELETE FROM conversations WHERE id = 7');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 7').get().n, 0);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
