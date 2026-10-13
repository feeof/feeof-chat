'use strict';

// The mobile app's own Socket.IO client (mobile/src/api/socket-client.mjs),
// exercised against the real server over Node's built-in WebSocket.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ADMIN_PASSWORD, tick } = require('./helpers');

let SocketClient;
let srv;
let admin;
const clients = [];

function nodeTransport(url, { onOpen, onMessage, onClose }) {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => onOpen());
  ws.addEventListener('message', (event) => onMessage(event.data));
  ws.addEventListener('close', () => onClose('transport close'));
  ws.addEventListener('error', () => onClose('transport error'));
  return { send: (text) => ws.send(text), close: () => ws.close() };
}

/** Creates a client that records every event it fires. */
function client(options) {
  const c = new SocketClient({ url: srv.base, transport: nodeTransport, minDelay: 20, maxDelay: 100, ...options });
  const events = [];
  const fire = c.fire.bind(c);
  c.fire = (event, ...args) => {
    events.push({ event, args });
    fire(event, ...args);
  };
  clients.push(c);
  return { c, events, waitFor: (event, predicate = () => true) => waitFor(events, event, predicate) };
}

function waitFor(events, event, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const found = events.find((e) => e.event === event && predicate(...e.args));
      if (found) return resolve(found.args[0]);
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for "${event}"`));
      return setTimeout(check, 10);
    };
    check();
  });
}

test.before(async () => {
  ({ SocketClient } = await import('../mobile/src/api/socket-client.mjs'));
  srv = await startServer();
  admin = await srv.login('admin', ADMIN_PASSWORD);
});

test.after(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await srv.stop();
});

test('receives workspace events and sends typing over the real server', async () => {
  const { c, events, waitFor: wait } = client({ auth: () => ({ token: admin.token }) });
  c.connect();
  await wait('connect');
  assert.equal(c.connected, true);

  const v = await srv.newVisitor();
  const visitorSocket = srv.socket({ visitorToken: v.token });
  await visitorSocket.ready;
  const sent = await srv.request('POST', '/api/visitor/messages', { visitorToken: v.token, body: { content: '你好' } });
  assert.equal(sent.status, 201);
  const conversationId = sent.data.message.conversation_id;

  // The admin is online, so the new conversation is assigned to them.
  const conv = await wait('conversation:update', (c2) => c2.id === conversationId && c2.status === 'active');
  assert.equal(conv.agent_id, admin.user.id);
  const msg = await wait('message', (m) => m.conversation_id === conversationId && m.sender_type === 'visitor');
  assert.equal(msg.content, '你好');

  assert.equal(c.emit('typing', { conversation_id: conversationId }), true);
  const typing = await visitorSocket.waitFor('typing', (p) => p.from === 'agent');
  assert.equal(typing.conversation_id, conversationId);

  assert.ok(!events.some((e) => e.event === 'connect_error'));
  c.disconnect();
  assert.equal(c.connected, false);
});

test('reconnects after the connection drops', async () => {
  const { c, events, waitFor: wait } = client({ auth: () => ({ token: admin.token }) });
  c.connect();
  await wait('connect');
  c.conn.close();
  await wait('disconnect');
  await wait('reconnecting');
  await waitFor(events, 'connect', () => events.filter((e) => e.event === 'connect').length === 2);
  assert.equal(c.connected, true);
  c.disconnect();
});

test('a rejected token stops reconnecting', async () => {
  const { c, events, waitFor: wait } = client({ auth: () => ({ token: 'not-a-real-token' }) });
  c.connect();
  assert.equal(await wait('connect_error'), 'unauthorized');
  await tick(150);
  assert.equal(c.active, false);
  assert.equal(c.connected, false);
  assert.ok(!events.some((e) => e.event === 'reconnecting'));
  assert.ok(!events.some((e) => e.event === 'connect'));
});

test('a server-side disconnect (logout) does not reconnect', async () => {
  const session = await srv.login('admin', ADMIN_PASSWORD);
  const { c, events, waitFor: wait } = client({ auth: () => ({ token: session.token }) });
  c.connect();
  await wait('connect');
  const out = await srv.request('POST', '/api/auth/logout', { token: session.token });
  assert.equal(out.status, 200);
  assert.equal(await wait('disconnect'), 'io server disconnect');
  await tick(150);
  assert.equal(c.active, false);
  assert.ok(!events.some((e) => e.event === 'reconnecting'));
});

// ---- protocol details, against a scripted transport ----

function scripted() {
  const sockets = [];
  const transport = (url, handlers) => {
    const socket = { url, handlers, sent: [], closed: false };
    socket.send = (text) => socket.sent.push(text);
    socket.close = () => {
      socket.closed = true;
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, transport };
}

test('protocol: handshake, ping/pong, events with ack ids and heartbeat timeout', async () => {
  const { sockets, transport } = scripted();
  const c = new SocketClient({ url: 'https://chat.example.com/', auth: { token: 't' }, transport, minDelay: 10, random: () => 1 });
  const seen = [];
  c.on('message', (payload) => seen.push(payload));
  const reconnects = [];
  c.on('reconnecting', (info) => reconnects.push(info));
  c.connect();

  const [s] = sockets;
  assert.equal(s.url, 'wss://chat.example.com/socket.io/?EIO=4&transport=websocket');
  s.handlers.onOpen();
  s.handlers.onMessage('0{"sid":"x","upgrades":[],"pingInterval":40,"pingTimeout":20,"maxPayload":1000000}');
  assert.deepEqual(s.sent, ['40{"token":"t"}']);
  assert.equal(c.emit('typing', {}), false, 'nothing is sent before the namespace connects');

  s.handlers.onMessage('40{"sid":"y"}');
  assert.equal(c.connected, true);
  s.handlers.onMessage('2');
  assert.equal(s.sent.at(-1), '3');
  s.handlers.onMessage('42["message",{"id":1}]');
  s.handlers.onMessage('4217["message",{"id":2}]');
  s.handlers.onMessage('42/admin,["message",{"id":3}]');
  s.handlers.onMessage('not a packet');
  assert.deepEqual(seen, [{ id: 1 }, { id: 2 }]);
  assert.equal(c.emit('typing', { conversation_id: 5 }), true);
  assert.equal(s.sent.at(-1), '42["typing",{"conversation_id":5}]');

  // No ping within pingInterval + pingTimeout: the connection is considered dead.
  await tick(120);
  assert.equal(s.closed, true);
  assert.equal(c.connected, false);
  assert.equal(reconnects.length, 1);
  await tick(30);
  assert.equal(sockets.length, 2, 'a new connection is opened');

  // Backoff doubles per failed attempt and is capped.
  sockets[1].handlers.onClose('error');
  assert.equal(reconnects[1].delay, 20);
  c.disconnect();
  await tick(50);
  assert.equal(sockets.length, 2, 'no reconnect after disconnect()');
});
