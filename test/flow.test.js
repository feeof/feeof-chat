'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ADMIN_PASSWORD, tick } = require('./helpers');

test('full conversation lifecycle: queue, auto-assign, chat, transfer, close, rate', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  const admin = await srv.login('admin', ADMIN_PASSWORD);
  await srv.createAgent(admin.token, { username: 'alice', password: 'alice-pass', display_name: 'Alice' });
  await srv.createAgent(admin.token, { username: 'bob', password: 'bob-pass', display_name: 'Bob' });
  // The admin is not connected, so it does not take part in routing.
  await srv.request('PUT', '/api/auth/me/status', { token: admin.token, body: { status: 'offline' } });

  // 1. A visitor writes while nobody is online: the conversation waits and gets the offline notice.
  const visitor = await srv.newVisitor({ name: '张三', page_url: 'https://shop.example.com/item/1' });
  const vs = srv.socket({ visitorToken: visitor.token });
  await vs.ready;
  const sent = await srv.request('POST', '/api/visitor/messages', {
    visitorToken: visitor.token,
    body: { content: '你好，我想咨询订单' },
  });
  assert.equal(sent.status, 201);
  const conversationId = sent.data.message.conversation_id;
  const offlineNotice = await vs.waitFor('message', (m) => m.sender_type === 'system');
  assert.match(offlineNotice.content, /不在线/);

  const queue = await srv.request('GET', '/api/conversations?status=waiting', { token: admin.token });
  assert.equal(queue.data.conversations.length, 1);
  assert.equal(queue.data.conversations[0].status, 'waiting');
  assert.equal(queue.data.conversations[0].visitor_name, '张三');
  assert.equal(queue.data.conversations[0].agent_unread, 1);

  // 2. Alice comes online and is assigned the waiting conversation automatically.
  const alice = await srv.login('alice', 'alice-pass');
  const as = srv.socket({ token: alice.token });
  await as.ready;
  const assigned = await vs.waitFor('conversation', (c) => c.status === 'active');
  assert.equal(assigned.id, conversationId);
  assert.equal(assigned.agent_name, 'Alice');
  await vs.waitFor('message', (m) => m.content.includes('Alice'));

  // 3. Typing indicators flow both ways.
  vs.client.emit('typing');
  await as.waitFor('typing', (p) => p.conversation_id === conversationId && p.from === 'visitor');
  as.client.emit('typing', { conversation_id: conversationId });
  await vs.waitFor('typing', (p) => p.from === 'agent');

  // 4. Alice replies; the visitor receives it in real time.
  const reply = await srv.request('POST', `/api/conversations/${conversationId}/messages`, {
    token: alice.token,
    body: { content: '您好，请提供订单号' },
  });
  assert.equal(reply.status, 201);
  const received = await vs.waitFor('message', (m) => m.sender_type === 'agent');
  assert.equal(received.content, '您好，请提供订单号');
  assert.equal(received.sender_name, 'Alice');

  // 5. Visitor messages reach Alice and count as unread until she reads them.
  await srv.request('POST', '/api/visitor/messages', { visitorToken: visitor.token, body: { content: '订单号 123' } });
  await as.waitFor('message', (m) => m.content === '订单号 123');
  await as.waitFor('conversation:update', (c) => c.id === conversationId && c.agent_unread === 1);
  await srv.request('POST', `/api/conversations/${conversationId}/read`, { token: alice.token });
  await as.waitFor('conversation:update', (c) => c.id === conversationId && c.agent_unread === 0);

  // 6. Bob can neither read nor answer Alice's conversation.
  const bob = await srv.login('bob', 'bob-pass');
  const bs = srv.socket({ token: bob.token });
  await bs.ready;
  const bobView = await srv.request('GET', `/api/conversations/${conversationId}`, { token: bob.token });
  assert.equal(bobView.status, 403);
  const bobSend = await srv.request('POST', `/api/conversations/${conversationId}/messages`, {
    token: bob.token,
    body: { content: 'hi' },
  });
  assert.equal(bobSend.status, 403);
  const bobTransfer = await srv.request('POST', `/api/conversations/${conversationId}/transfer`, {
    token: bob.token,
    body: { agent_id: bob.user.id },
  });
  assert.equal(bobTransfer.status, 403);

  // 7. Alice transfers to Bob.
  const transfer = await srv.request('POST', `/api/conversations/${conversationId}/transfer`, {
    token: alice.token,
    body: { agent_id: bob.user.id },
  });
  assert.equal(transfer.status, 200);
  assert.equal(transfer.data.conversation.agent_id, bob.user.id);
  await bs.waitFor('conversation:update', (c) => c.id === conversationId && c.agent_id === bob.user.id);
  await as.waitFor('conversation:update', (c) => c.id === conversationId && c.agent_id === bob.user.id);
  await vs.waitFor('message', (m) => m.content.includes('转接至客服 Bob'));
  const aliceView = await srv.request('GET', `/api/conversations/${conversationId}`, { token: alice.token });
  assert.equal(aliceView.status, 403);

  // 8. Bob closes; the visitor can rate once.
  const earlyRate = await srv.request('POST', '/api/visitor/rate', {
    visitorToken: visitor.token,
    body: { conversation_id: conversationId, rating: 5 },
  });
  assert.equal(earlyRate.status, 409);
  const closed = await srv.request('POST', `/api/conversations/${conversationId}/close`, { token: bob.token });
  assert.equal(closed.data.conversation.status, 'closed');
  await vs.waitFor('conversation', (c) => c.status === 'closed');
  const rate = await srv.request('POST', '/api/visitor/rate', {
    visitorToken: visitor.token,
    body: { conversation_id: conversationId, rating: 5, comment: '很满意' },
  });
  assert.equal(rate.status, 200);
  assert.equal(rate.data.conversation.rating, 5);
  const rateAgain = await srv.request('POST', '/api/visitor/rate', {
    visitorToken: visitor.token,
    body: { conversation_id: conversationId, rating: 1 },
  });
  assert.equal(rateAgain.status, 409);

  // 9. A new message after closing starts a new conversation.
  const again = await srv.request('POST', '/api/visitor/messages', {
    visitorToken: visitor.token,
    body: { content: '还有一个问题' },
  });
  assert.notEqual(again.data.message.conversation_id, conversationId);

  // The visitor's history spans both conversations.
  const history = await srv.request('GET', '/api/visitor/messages', { visitorToken: visitor.token });
  const ids = new Set(history.data.messages.map((m) => m.conversation_id));
  assert.equal(ids.size, 2);

  // Closed conversations appear in Bob's history but not Alice's.
  const bobHistory = await srv.request('GET', '/api/conversations?status=closed', { token: bob.token });
  assert.deepEqual(bobHistory.data.conversations.map((c) => c.id), [conversationId]);
  const aliceHistory = await srv.request('GET', '/api/conversations?status=closed', { token: alice.token });
  assert.equal(aliceHistory.data.conversations.length, 0);
  const search = await srv.request('GET', `/api/conversations?status=closed&q=${encodeURIComponent('订单号')}`, {
    token: admin.token,
  });
  assert.deepEqual(search.data.conversations.map((c) => c.id), [conversationId]);

  // Stats reflect the rated conversation.
  const stats = await srv.request('GET', '/api/admin/stats?range=7d', { token: admin.token });
  assert.equal(stats.status, 200);
  assert.equal(stats.data.overview.conversations, 2);
  assert.equal(stats.data.overview.avg_rating, 5);
  assert.equal(stats.data.daily.length, 7);
  assert.equal(stats.data.daily.at(-1).conversations, 2);
});

test('routing respects capacity and drains the queue when an agent frees up', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  const admin = await srv.login('admin', ADMIN_PASSWORD);
  await srv.request('PUT', '/api/auth/me/status', { token: admin.token, body: { status: 'offline' } });
  await srv.createAgent(admin.token, { username: 'carol', password: 'carol-pass', max_concurrent: 1 });
  const carol = await srv.login('carol', 'carol-pass');
  await srv.socket({ token: carol.token }).ready;

  const v1 = await srv.newVisitor();
  const v2 = await srv.newVisitor();
  const m1 = await srv.request('POST', '/api/visitor/messages', { visitorToken: v1.token, body: { content: 'A' } });
  const m2 = await srv.request('POST', '/api/visitor/messages', { visitorToken: v2.token, body: { content: 'B' } });
  const c1 = m1.data.message.conversation_id;
  const c2 = m2.data.message.conversation_id;

  const get = async (id) => (await srv.request('GET', `/api/conversations/${id}`, { token: admin.token })).data.conversation;
  assert.equal((await get(c1)).status, 'active');
  assert.equal((await get(c2)).status, 'waiting');

  // While queued, the second visitor gets the queue notice (an agent is online, just busy).
  const v2Messages = await srv.request('GET', '/api/visitor/messages', { visitorToken: v2.token });
  assert.match(v2Messages.data.messages.at(-1).content, /稍候/);

  await srv.request('POST', `/api/conversations/${c1}/close`, { token: carol.token });
  const second = await get(c2);
  assert.equal(second.status, 'active');
  assert.equal(second.agent_id, carol.user.id);
});

test('away agents are skipped; manual accept works and is exclusive', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  const admin = await srv.login('admin', ADMIN_PASSWORD);
  await srv.request('PUT', '/api/auth/me/status', { token: admin.token, body: { status: 'away' } });
  await srv.socket({ token: admin.token }).ready;
  await srv.createAgent(admin.token, { username: 'dave', password: 'dave-pass' });
  const dave = await srv.login('dave', 'dave-pass');
  await srv.request('PUT', '/api/auth/me/status', { token: dave.token, body: { status: 'away' } });
  await srv.socket({ token: dave.token }).ready;

  const v = await srv.newVisitor();
  const m = await srv.request('POST', '/api/visitor/messages', { visitorToken: v.token, body: { content: 'hi' } });
  const id = m.data.message.conversation_id;

  const config = await srv.request('GET', '/api/widget/config');
  assert.equal(config.data.config.online, false);

  const accept = await srv.request('POST', `/api/conversations/${id}/accept`, { token: dave.token });
  assert.equal(accept.status, 200);
  assert.equal(accept.data.conversation.agent_id, dave.user.id);
  const acceptAgain = await srv.request('POST', `/api/conversations/${id}/accept`, { token: admin.token });
  assert.equal(acceptAgain.status, 409);
});

test('idle active conversations are closed automatically', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  const admin = await srv.login('admin', ADMIN_PASSWORD);
  await srv.socket({ token: admin.token }).ready;
  await srv.request('PUT', '/api/admin/settings', { token: admin.token, body: { auto_close_minutes: 5 } });

  const v = await srv.newVisitor();
  const vs = srv.socket({ visitorToken: v.token });
  await vs.ready;
  const m = await srv.request('POST', '/api/visitor/messages', { visitorToken: v.token, body: { content: 'hi' } });
  const id = m.data.message.conversation_id;

  assert.equal(srv.chat.service.closeIdleConversations(Date.now() + 60 * 1000), 0);
  assert.equal(srv.chat.service.closeIdleConversations(Date.now() + 6 * 60 * 1000), 1);
  const closed = await vs.waitFor('conversation', (c) => c.id === id && c.status === 'closed');
  assert.equal(closed.id, id);
  const detail = await srv.request('GET', `/api/conversations/${id}`, { token: admin.token });
  assert.equal(detail.data.conversation.closed_by, 'system');
});

test('disabling an agent signs them out and requeues their conversations', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  const admin = await srv.login('admin', ADMIN_PASSWORD);
  await srv.request('PUT', '/api/auth/me/status', { token: admin.token, body: { status: 'offline' } });
  const erin = await srv.createAgent(admin.token, { username: 'erin', password: 'erin-pass' });
  const session = await srv.login('erin', 'erin-pass');
  const es = srv.socket({ token: session.token });
  await es.ready;

  const v = await srv.newVisitor();
  const m = await srv.request('POST', '/api/visitor/messages', { visitorToken: v.token, body: { content: 'hi' } });
  const id = m.data.message.conversation_id;

  const disable = await srv.request('PATCH', `/api/admin/agents/${erin.id}`, {
    token: admin.token,
    body: { disabled: true },
  });
  assert.equal(disable.status, 200);
  assert.equal(disable.data.agent.disabled, true);
  await tick();
  assert.equal(es.client.connected, false);

  const me = await srv.request('GET', '/api/auth/me', { token: session.token });
  assert.equal(me.status, 401);
  const relogin = await srv.request('POST', '/api/auth/login', { body: { username: 'erin', password: 'erin-pass' } });
  assert.equal(relogin.status, 403);

  const detail = await srv.request('GET', `/api/conversations/${id}`, { token: admin.token });
  assert.equal(detail.data.conversation.status, 'waiting');
  assert.equal(detail.data.conversation.agent_id, null);
});
