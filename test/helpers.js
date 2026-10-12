'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../server/app');

const ADMIN_PASSWORD = 'admin-pass-123';

// A minimal valid 1x1 PNG.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function startServer(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feeof-chat-test-'));
  const chat = createApp({ dataDir, adminPassword: ADMIN_PASSWORD, ...overrides });
  const { port } = await chat.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const sockets = [];

  async function request(method, url, { body, token, visitorToken, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (visitorToken) init.headers['x-visitor-token'] = visitorToken;
    if (Buffer.isBuffer(body)) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(base + url, init);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }

  async function login(username, password) {
    const res = await request('POST', '/api/auth/login', { body: { username, password } });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.data)}`);
    return res.data;
  }

  async function createAgent(adminToken, fields) {
    const res = await request('POST', '/api/admin/agents', { token: adminToken, body: fields });
    if (res.status !== 201) throw new Error(`create agent failed: ${JSON.stringify(res.data)}`);
    return res.data.agent;
  }

  async function newVisitor(body = {}) {
    const res = await request('POST', '/api/visitor/session', { body });
    if (res.status !== 200) throw new Error(`visitor session failed: ${JSON.stringify(res.data)}`);
    return res.data;
  }

  /** Connects a socket and records every event it receives. */
  function socket(auth) {
    const client = connect(base, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    const events = [];
    client.onAny((event, payload) => events.push({ event, payload }));
    sockets.push(client);
    const ready = new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return { client, events, ready, waitFor: (event, predicate) => waitFor(events, event, predicate) };
  }

  async function stop() {
    for (const s of sockets) s.disconnect();
    await chat.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return { chat, base, request, login, createAgent, newVisitor, socket, stop };
}

/** Resolves with the first recorded (or future) event matching the predicate. */
function waitFor(events, event, predicate = () => true, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const found = events.find((e) => e.event === event && predicate(e.payload));
      if (found) return resolve(found.payload);
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for "${event}"`));
      return setTimeout(check, 10);
    };
    check();
  });
}

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { startServer, ADMIN_PASSWORD, PNG_1PX, tick };
