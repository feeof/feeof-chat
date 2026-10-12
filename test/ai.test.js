'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ADMIN_PASSWORD, PNG_1PX, tick } = require('./helpers');
const { echoableContent } = require('../server/ai/assistant');
const { isHandoffRequest } = require('../server/service');

// ---- a scripted stand-in for the Anthropic client ----

function fakeClaude(handler) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(JSON.parse(JSON.stringify(params)));
          return handler(params, calls.length);
        },
      },
    },
  };
}

const THINKING = { type: 'thinking', thinking: '', signature: 'sig' };
const reply = (text) => ({ stop_reason: 'end_turn', content: [THINKING, { type: 'text', text }] });
const toolCall = (name, input, text) => ({
  stop_reason: 'tool_use',
  content: [THINKING, ...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id: 'toolu_1', name, input }],
});

const ARTICLES = [
  { title: '退货政策', content: '商品签收后 7 天内可申请无理由退货，退货运费由买家承担，质量问题除外。' },
  { title: '发货时间', content: '下单后 48 小时内发货，默认使用顺丰快递。' },
  { title: '发票说明', content: '支持开具电子普通发票和增值税专用发票，请在订单详情页申请开票。' },
];

async function setup(t, { reply: handler, settings = {}, ai } = {}) {
  const claude = fakeClaude(handler || (() => reply('您好！')));
  const srv = await startServer({ aiClient: claude, ...(ai ? { ai } : {}) });
  t.after(() => srv.stop());
  const admin = await srv.login('admin', ADMIN_PASSWORD);
  // Keep the admin out of routing unless a test brings an agent online.
  await srv.request('PUT', '/api/auth/me/status', { token: admin.token, body: { status: 'offline' } });
  await srv.request('PUT', '/api/admin/settings', { token: admin.token, body: { ai_enabled: true, ...settings } });
  await srv.request('POST', '/api/admin/kb/import', { token: admin.token, body: { articles: ARTICLES } });
  return { srv, admin, claude };
}

async function visitorSays(srv, visitor, content) {
  const res = await srv.request('POST', '/api/visitor/messages', { visitorToken: visitor.token, body: { content } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.message;
}

async function conversation(srv, admin, id) {
  return (await srv.request('GET', `/api/conversations/${id}`, { token: admin.token })).data.conversation;
}

// ---- unit pieces ----

test('handoff phrases are recognised only as whole short messages', () => {
  for (const text of ['人工', '转人工！', ' 人工客服 ', 'Human', 'agent']) assert.ok(isHandoffRequest(text), text);
  for (const text of ['人工智能是什么', '我要退货', '客服电话多少']) assert.ok(!isHandoffRequest(text), text);
});

test('content before a refusal-fallback boundary is reduced to text', () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 'a' },
    { type: 'text', text: 'partial' },
    { type: 'tool_use', id: 't0', name: 'x', input: {} },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'thinking', thinking: '', signature: 'b' },
    { type: 'tool_use', id: 't1', name: 'y', input: {} },
  ];
  assert.deepEqual(
    echoableContent(content).map((b) => b.type),
    ['text', 'thinking', 'tool_use'],
  );
  assert.deepEqual(echoableContent([THINKING, { type: 'text', text: 'x' }]).length, 2);
});

// ---- conversation flows ----

test('the AI answers from the knowledge base with a cache-friendly request', async (t) => {
  const { srv, admin, claude } = await setup(t, { reply: () => reply('签收后 7 天内可以无理由退货。') });
  const visitor = await srv.newVisitor();
  assert.equal(visitor.config.ai_enabled, true);
  assert.equal(visitor.config.online, true, 'the AI counts as someone online');
  const vs = srv.socket({ visitorToken: visitor.token });
  await vs.ready;

  const first = await visitorSays(srv, visitor, '怎么退货？');
  const answer = await vs.waitFor('message', (m) => m.sender_type === 'bot');
  assert.equal(answer.content, '签收后 7 天内可以无理由退货。');
  assert.equal(answer.sender_name, '智能客服');
  assert.equal((await conversation(srv, admin, first.conversation_id)).status, 'bot');

  const [call] = claude.calls;
  assert.equal(call.model, 'claude-opus-5-5');
  assert.deepEqual(call.output_config, { effort: 'low' });
  assert.equal(call.thinking, undefined, 'thinking is left adaptive (it cannot be disabled on this model)');
  assert.deepEqual(call.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(call.fallbacks, 'default');
  assert.equal(call.tool_choice, undefined);
  assert.deepEqual(call.tools.map((tool) => tool.name), ['transfer_to_human']);
  assert.equal(call.tools[0].strict, true);
  // Small knowledge base: sent whole, inside the cached system block.
  assert.equal(call.system.length, 1);
  assert.deepEqual(call.system[0].cache_control, { type: 'ephemeral' });
  for (const a of ARTICLES) assert.ok(call.system[0].text.includes(a.content));
  assert.deepEqual(call.messages, [{ role: 'user', content: [{ type: 'text', text: '怎么退货？' }] }]);

  // Follow-up: same cached prefix, history replayed as text turns.
  await visitorSays(srv, visitor, '运费谁出？');
  await vs.waitFor('message', (m) => m.sender_type === 'bot' && m.id !== answer.id);
  const second = claude.calls[1];
  assert.equal(second.system[0].text, call.system[0].text);
  assert.deepEqual(second.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(second.messages[1].content[0].text, '签收后 7 天内可以无理由退货。');

  const stats = await srv.request('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(stats.data.overview.ai_conversations, 1);
  assert.equal(stats.data.overview.unanswered, 0);
  assert.equal(stats.data.current.bot, 1);
});

test('large knowledge bases are searched per question, and the AI can search again', async (t) => {
  const { srv, claude } = await setup(t, {
    ai: { fullKnowledgeMaxChars: 10 },
    reply: (params, n) => (n === 1 ? toolCall('search_knowledge_base', { query: '发票' }) : reply('可以在订单详情页申请开票。')),
  });
  const visitor = await srv.newVisitor();
  const vs = srv.socket({ visitorToken: visitor.token });
  await vs.ready;
  await visitorSays(srv, visitor, '退货运费谁承担？另外能开发票吗');
  await vs.waitFor('message', (m) => m.sender_type === 'bot');

  const [first, second] = claude.calls;
  assert.deepEqual(first.tools.map((tool) => tool.name), ['search_knowledge_base', 'transfer_to_human']);
  assert.ok(!first.system[0].text.includes('<knowledge_base>'));
  assert.equal(first.system[1].cache_control, undefined, 'retrieved articles sit after the cache breakpoint');
  assert.ok(first.system[1].text.includes('退货政策'));
  assert.ok(!first.system[1].text.includes('发货时间'));

  // The tool round trip is appended verbatim and the prefix stays identical.
  assert.deepEqual(second.system, first.system);
  const [assistantTurn, toolTurn] = second.messages.slice(-2);
  assert.deepEqual(assistantTurn.content.map((b) => b.type), ['thinking', 'tool_use']);
  assert.equal(toolTurn.content[0].type, 'tool_result');
  assert.equal(toolTurn.content[0].tool_use_id, 'toolu_1');
  assert.ok(toolTurn.content[0].content.includes('发票说明'));
});

test('the AI hands off through its tool and the conversation reaches an agent', async (t) => {
  const { srv, admin, claude } = await setup(t, {
    reply: () => toolCall('transfer_to_human', { reason: '访客申请退款' }, '好的，正在为您转接人工客服。'),
  });
  await srv.createAgent(admin.token, { username: 'amy', password: 'amy-pass', display_name: 'Amy' });
  const amy = await srv.login('amy', 'amy-pass');
  const as = srv.socket({ token: amy.token });
  await as.ready;

  const visitor = await srv.newVisitor();
  const vs = srv.socket({ visitorToken: visitor.token });
  await vs.ready;
  const msg = await visitorSays(srv, visitor, '我要退款');
  await vs.waitFor('message', (m) => m.sender_type === 'bot' && m.content.includes('转接'));
  await vs.waitFor('message', (m) => m.sender_type === 'system' && m.content.includes('转接人工'));
  const assigned = await vs.waitFor('conversation', (c) => c.status === 'active');
  assert.equal(assigned.agent_name, 'Amy');

  const conv = await conversation(srv, admin, msg.conversation_id);
  assert.equal(conv.agent_id, amy.user.id);
  assert.equal(conv.handoff_reason, '访客申请退款');
  assert.ok(conv.handoff_at);

  await visitorSays(srv, visitor, '订单号 123');
  await tick(50);
  assert.equal(claude.calls.length, 1, 'the AI stays out once a human has the conversation');
});

test('visitors can ask for a human by keyword or button without calling the AI', async (t) => {
  const { srv, admin, claude } = await setup(t);
  const visitor = await srv.newVisitor();
  const vs = srv.socket({ visitorToken: visitor.token });
  await vs.ready;

  const none = await srv.request('POST', '/api/visitor/handoff', { visitorToken: visitor.token });
  assert.equal(none.status, 409);

  await visitorSays(srv, visitor, '你好');
  await vs.waitFor('message', (m) => m.sender_type === 'bot');
  const msg = await visitorSays(srv, visitor, '转人工');
  await vs.waitFor('message', (m) => m.content.includes('不在线'));
  assert.equal(claude.calls.length, 1);
  const conv = await conversation(srv, admin, msg.conversation_id);
  assert.equal(conv.status, 'waiting');
  assert.equal(conv.handoff_reason, '访客要求人工服务');

  const other = await srv.newVisitor();
  const otherMsg = await visitorSays(srv, other, '你好');
  await srv.chat.service.aiIdle();
  const button = await srv.request('POST', '/api/visitor/handoff', { visitorToken: other.token });
  assert.equal(button.status, 200);
  assert.equal(button.data.conversation.status, 'waiting');
  assert.equal((await conversation(srv, admin, otherMsg.conversation_id)).handoff_reason, '访客点击了转人工');
});

test('API errors and refusals fall back to a human, and the error is reported', async (t) => {
  const { srv, admin } = await setup(t, {
    reply: (params, n) => {
      if (n === 1) throw new Error('connection reset');
      return { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] };
    },
  });
  const a = await srv.newVisitor();
  const m1 = await visitorSays(srv, a, '你好');
  await srv.chat.service.aiIdle();
  const c1 = await conversation(srv, admin, m1.conversation_id);
  assert.equal(c1.status, 'waiting');
  assert.equal(c1.handoff_reason, 'AI 服务暂时不可用');
  const status = await srv.request('GET', '/api/admin/ai/status', { token: admin.token });
  assert.match(status.data.status.last_error.message, /connection reset/);

  const b = await srv.newVisitor();
  const m2 = await visitorSays(srv, b, '你好');
  await srv.chat.service.aiIdle();
  assert.equal((await conversation(srv, admin, m2.conversation_id)).handoff_reason, 'AI 无法处理该问题');
});

test('an agent can take over while the AI is still replying', async (t) => {
  let release;
  const { srv, admin, claude } = await setup(t, {
    reply: () => new Promise((resolve) => (release = () => resolve(reply('稍等，我帮您查一下。')))),
  });
  const visitor = await srv.newVisitor();
  const msg = await visitorSays(srv, visitor, '我的快递到哪了');
  await tick(20);
  assert.equal(claude.calls.length, 1);

  // Every agent sees AI conversations; any of them may take one over.
  const queue = await srv.request('GET', '/api/conversations?status=bot', { token: admin.token });
  assert.deepEqual(queue.data.conversations.map((c) => c.id), [msg.conversation_id]);
  const takeover = await srv.request('POST', `/api/conversations/${msg.conversation_id}/accept`, { token: admin.token });
  assert.equal(takeover.status, 200);
  assert.equal(takeover.data.conversation.status, 'active');
  assert.match(takeover.data.conversation.handoff_reason, /主动接管/);

  release();
  await srv.chat.service.aiIdle();
  const history = await srv.request('GET', `/api/conversations/${msg.conversation_id}/messages`, { token: admin.token });
  assert.ok(!history.data.messages.some((m) => m.sender_type === 'bot'), 'the late AI reply is dropped');
});

test('a visitor message during an AI reply gets answered in a follow-up pass', async (t) => {
  const releases = [];
  const { srv, claude } = await setup(t, {
    reply: (params, n) => new Promise((resolve) => releases.push(() => resolve(reply(`回复 ${n}`)))),
  });
  const visitor = await srv.newVisitor();
  await visitorSays(srv, visitor, '第一个问题');
  await tick(20);
  await visitorSays(srv, visitor, '第二个问题');
  await tick(20);
  assert.equal(claude.calls.length, 1, 'no overlapping replies');
  releases[0]();
  await tick(20);
  // The first reply only saw one question, so it is dropped and both are answered together.
  assert.equal(claude.calls.length, 2);
  assert.deepEqual(claude.calls[1].messages, [
    { role: 'user', content: [{ type: 'text', text: '第一个问题' }, { type: 'text', text: '第二个问题' }] },
  ]);
  releases[1]();
  await srv.chat.service.aiIdle();
  const history = await srv.request('GET', '/api/visitor/messages', { visitorToken: visitor.token });
  assert.deepEqual(
    history.data.messages.filter((m) => m.sender_type === 'bot').map((m) => m.content),
    ['回复 2'],
  );
});

test('offline mode uses the AI only when no agent can take the conversation', async (t) => {
  const { srv, admin } = await setup(t, { settings: { ai_mode: 'offline' } });
  const v1 = await srv.newVisitor();
  const m1 = await visitorSays(srv, v1, '你好');
  assert.equal((await conversation(srv, admin, m1.conversation_id)).status, 'bot');

  await srv.request('PUT', '/api/auth/me/status', { token: admin.token, body: { status: 'online' } });
  await srv.socket({ token: admin.token }).ready;
  const v2 = await srv.newVisitor();
  const m2 = await visitorSays(srv, v2, '你好');
  assert.equal((await conversation(srv, admin, m2.conversation_id)).status, 'active');
  await srv.chat.service.aiIdle();
});

test('turning the AI off hands its open conversations to humans', async (t) => {
  const { srv, admin } = await setup(t);
  const visitor = await srv.newVisitor();
  const msg = await visitorSays(srv, visitor, '你好');
  await srv.chat.service.aiIdle();
  await srv.request('PUT', '/api/admin/settings', { token: admin.token, body: { ai_enabled: false } });
  const conv = await conversation(srv, admin, msg.conversation_id);
  assert.equal(conv.status, 'waiting');
  assert.equal(conv.handoff_reason, 'AI 客服已关闭');

  const config = await srv.request('GET', '/api/widget/config');
  assert.equal(config.data.config.ai_enabled, false);
});

test('recent visitor images are passed to the model', async (t) => {
  const { srv, claude } = await setup(t);
  const visitor = await srv.newVisitor();
  const up = await srv.request('POST', '/api/uploads', {
    visitorToken: visitor.token,
    body: PNG_1PX,
    headers: { 'content-type': 'image/png' },
  });
  await srv.request('POST', '/api/visitor/messages', {
    visitorToken: visitor.token,
    body: { type: 'image', content: up.data.url },
  });
  await srv.chat.service.aiIdle();
  const block = claude.calls[0].messages[0].content[0];
  assert.equal(block.type, 'image');
  assert.equal(block.source.media_type, 'image/png');
  assert.equal(block.source.data, PNG_1PX.toString('base64'));
});

test('without credentials the AI stays out even when enabled', async (t) => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  t.after(() => {
    if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  });
  const srv = await startServer();
  t.after(() => srv.stop());
  const admin = await srv.login('admin', ADMIN_PASSWORD);
  await srv.request('PUT', '/api/admin/settings', { token: admin.token, body: { ai_enabled: true } });
  const visitor = await srv.newVisitor();
  const msg = await visitorSays(srv, visitor, '你好');
  assert.equal((await conversation(srv, admin, msg.conversation_id)).status, 'waiting');
  const status = await srv.request('GET', '/api/admin/ai/status', { token: admin.token });
  assert.equal(status.data.status.configured, false);
  const testCall = await srv.request('POST', '/api/admin/ai/test', { token: admin.token, body: { question: '你好' } });
  assert.equal(testCall.status, 400);
});

// ---- knowledge base administration ----

test('knowledge base management API', async (t) => {
  const { srv, admin, claude } = await setup(t, { reply: () => reply('7 天内可以退货。') });
  const list = await srv.request('GET', '/api/admin/kb', { token: admin.token });
  assert.equal(list.data.total, 3);
  assert.equal(list.data.ai.knowledge_mode, 'full');
  assert.equal(list.data.ai.knowledge_articles, 3);

  const created = await srv.request('POST', '/api/admin/kb', {
    token: admin.token,
    body: { title: '营业时间', content: '在线客服服务时间为每天 9:00-21:00。' },
  });
  assert.equal(created.status, 201);
  const id = created.data.article.id;
  assert.equal((await srv.request('POST', '/api/admin/kb', { token: admin.token, body: { title: 'x' } })).status, 400);
  const badImport = await srv.request('POST', '/api/admin/kb/import', {
    token: admin.token,
    body: { articles: [{ title: 'ok', content: 'ok' }, { title: '', content: 'x' }] },
  });
  assert.equal(badImport.status, 400);
  assert.match(badImport.data.error, /第 2 条/);

  const search = await srv.request('GET', `/api/admin/kb/search?q=${encodeURIComponent('几点上班')}`, { token: admin.token });
  assert.equal(search.data.results.length, 0);
  const search2 = await srv.request('GET', `/api/admin/kb/search?q=${encodeURIComponent('客服服务时间')}`, { token: admin.token });
  assert.equal(search2.data.results[0].id, id);

  const disabled = await srv.request('PATCH', `/api/admin/kb/${id}`, { token: admin.token, body: { enabled: false } });
  assert.equal(disabled.data.article.enabled, false);
  const afterDisable = await srv.request('GET', `/api/admin/kb/search?q=${encodeURIComponent('客服服务时间')}`, { token: admin.token });
  assert.ok(!afterDisable.data.results.some((r) => r.id === id), 'disabled articles are not used');
  assert.equal((await srv.request('DELETE', `/api/admin/kb/${id}`, { token: admin.token })).status, 200);
  assert.equal((await srv.request('DELETE', `/api/admin/kb/${id}`, { token: admin.token })).status, 404);

  const tried = await srv.request('POST', '/api/admin/ai/test', { token: admin.token, body: { question: '怎么退货' } });
  assert.equal(tried.status, 200);
  assert.equal(tried.data.result.action, 'answer');
  assert.equal(tried.data.result.text, '7 天内可以退货。');
  assert.equal(claude.calls.length, 1);

  await srv.createAgent(admin.token, { username: 'bea', password: 'bea-pass' });
  const bea = await srv.login('bea', 'bea-pass');
  assert.equal((await srv.request('GET', '/api/admin/kb', { token: bea.token })).status, 403);
  assert.equal((await srv.request('POST', '/api/admin/ai/test', { token: bea.token, body: { question: 'x' } })).status, 403);

  const badMode = await srv.request('PUT', '/api/admin/settings', { token: admin.token, body: { ai_mode: 'sometimes' } });
  assert.equal(badMode.status, 400);
});
