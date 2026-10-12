'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, ADMIN_PASSWORD } = require('./helpers');

// Each test file runs in its own process, so the developer's own keys can be cleared safely.
for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AI_API_KEY', 'OPENAI_API_KEY', 'AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL']) {
  delete process.env[key];
}

const ARTICLES = [
  { title: '退货政策', content: '商品签收后 7 天内可申请无理由退货，退货运费由买家承担。' },
  { title: '发票说明', content: '支持开具电子普通发票和增值税专用发票，请在订单详情页申请开票。' },
];

/** A local HTTP server standing in for an AI API; records every request. */
async function mockApi(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const entry = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
    requests.push(entry);
    const { status = 200, json } = await handler(entry, requests.length);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

const chatCompletion = (message, finish = 'stop') => ({
  json: { id: 'chatcmpl-1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }] },
});
const toolCallMessage = (name, args) =>
  chatCompletion({ content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');

async function setup(t, { connection, ai } = {}) {
  const srv = await startServer(ai ? { ai } : {});
  t.after(() => srv.stop());
  const admin = await srv.login('admin', ADMIN_PASSWORD);
  await srv.request('PUT', '/api/auth/me/status', { token: admin.token, body: { status: 'offline' } });
  if (connection) {
    const res = await srv.request('PUT', '/api/admin/ai/connection', { token: admin.token, body: connection });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  }
  await srv.request('PUT', '/api/admin/settings', { token: admin.token, body: { ai_enabled: true } });
  await srv.request('POST', '/api/admin/kb/import', { token: admin.token, body: { articles: ARTICLES } });
  return { srv, admin };
}

async function ask(srv, admin, visitor, content) {
  const sent = await srv.request('POST', '/api/visitor/messages', { visitorToken: visitor.token, body: { content } });
  await srv.chat.service.aiIdle();
  const id = sent.data.message.conversation_id;
  const conv = (await srv.request('GET', `/api/conversations/${id}`, { token: admin.token })).data.conversation;
  const { messages } = (await srv.request('GET', `/api/conversations/${id}/messages`, { token: admin.token })).data;
  return { conv, bot: messages.filter((m) => m.sender_type === 'bot').map((m) => m.content) };
}

test('connection settings are admin-only and never reveal the API key', async (t) => {
  const { srv, admin } = await setup(t);
  const defaults = (await srv.request('GET', '/api/admin/ai/connection', { token: admin.token })).data.connection;
  assert.equal(defaults.provider, 'anthropic');
  assert.equal(defaults.model, 'claude-opus-5-5');
  assert.equal(defaults.effort, 'low');
  assert.equal(defaults.api_key_set, false);
  assert.equal(defaults.default_base_url, 'https://api.anthropic.com');

  const secret = 'sk-secret-key-1234567890';
  const saved = await srv.request('PUT', '/api/admin/ai/connection', {
    token: admin.token,
    body: { provider: 'openai', base_url: 'https://api.deepseek.com/v1/', model: 'deepseek-chat', api_key: secret },
  });
  assert.equal(saved.status, 200);
  const conn = saved.data.connection;
  assert.equal(conn.provider, 'openai');
  assert.equal(conn.base_url, 'https://api.deepseek.com/v1');
  assert.equal(conn.model, 'deepseek-chat');
  assert.equal(conn.api_key_set, true);
  assert.equal(conn.api_key_source, 'settings');
  assert.equal(conn.api_key_hint, 'sk-se…7890');
  assert.equal(conn.effort, '', 'effort only applies to the Anthropic interface');
  assert.ok(!JSON.stringify(saved.data).includes(secret));

  // Ordinary agents can read general settings but never the connection or its key.
  await srv.createAgent(admin.token, { username: 'cara', password: 'cara-pass' });
  const cara = await srv.login('cara', 'cara-pass');
  const settings = await srv.request('GET', '/api/settings', { token: cara.token });
  assert.equal(settings.status, 200);
  assert.ok(!JSON.stringify(settings.data).includes(secret));
  assert.equal((await srv.request('GET', '/api/admin/ai/connection', { token: cara.token })).status, 403);
  assert.ok(!JSON.stringify((await srv.request('GET', '/api/admin/ai/status', { token: admin.token })).data).includes(secret));

  for (const body of [
    { provider: 'gemini' },
    { base_url: 'ftp://example.com' },
    { base_url: 'not a url' },
    { model: 'deepseek chat' },
    { effort: 'turbo' },
    { api_key: 'sk-a b' },
  ]) {
    const res = await srv.request('PUT', '/api/admin/ai/connection', { token: admin.token, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }

  const kept = await srv.request('PUT', '/api/admin/ai/connection', { token: admin.token, body: { api_key: '' } });
  assert.equal(kept.data.connection.api_key_set, true, 'an empty key keeps the saved one');
  const cleared = await srv.request('PUT', '/api/admin/ai/connection', { token: admin.token, body: { clear_api_key: true } });
  assert.equal(cleared.data.connection.api_key_set, false);

  // A local OpenAI-compatible server (e.g. Ollama) needs an address and a model, but no key.
  const status = (await srv.request('GET', '/api/admin/ai/status', { token: admin.token })).data.status;
  assert.equal(status.configured, true);
  assert.equal(status.provider, 'openai');
  assert.equal(status.base_url, 'https://api.deepseek.com/v1');
});

test('OpenAI-compatible APIs answer from the knowledge base and can hand off', async (t) => {
  const api = await mockApi(t, (req) => {
    const last = req.body.messages.at(-1).content;
    if (last.includes('退款')) return toolCallMessage('transfer_to_human', { reason: '访客要求退款' });
    return chatCompletion({ content: '<think>查一下发票条目</think>可以在订单详情页申请开票。' });
  });
  const { srv, admin } = await setup(t, {
    connection: { provider: 'openai', base_url: `${api.url}/v1`, model: 'deepseek-chat', api_key: 'test-key' },
  });
  const visitor = await srv.newVisitor();

  const first = await ask(srv, admin, visitor, '能开发票吗');
  assert.deepEqual(first.bot, ['可以在订单详情页申请开票。'], 'inline <think> reasoning is stripped');
  assert.equal(first.conv.status, 'bot');

  const [req] = api.requests;
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer test-key');
  assert.equal(req.body.model, 'deepseek-chat');
  assert.equal(req.body.max_tokens, 8000);
  assert.equal(req.body.messages[0].role, 'system');
  assert.ok(req.body.messages[0].content.includes('发票说明'));
  assert.deepEqual(req.body.messages[1], { role: 'user', content: '能开发票吗' });
  assert.deepEqual(req.body.tools.map((tool) => [tool.type, tool.function.name]), [['function', 'transfer_to_human']]);
  assert.equal(req.body.output_config, undefined);
  assert.equal(req.body.fallbacks, undefined);

  const second = await ask(srv, admin, visitor, '我要退款');
  assert.equal(second.conv.status, 'waiting');
  assert.equal(second.conv.handoff_reason, '访客要求退款');
  // The earlier answer is replayed as a plain assistant turn.
  assert.deepEqual(api.requests[1].body.messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
});

test('OpenAI-compatible tool calls round-trip through the search tool', async (t) => {
  const api = await mockApi(t, (req, n) =>
    n === 1 ? toolCallMessage('search_knowledge_base', { query: '发票' }) : chatCompletion({ content: '可以开具发票。' }),
  );
  const { srv, admin } = await setup(t, {
    ai: { fullKnowledgeMaxChars: 10 },
    connection: { provider: 'openai', base_url: `${api.url}/v1/chat/completions`, model: 'qwen-plus', api_key: 'k' },
  });
  const visitor = await srv.newVisitor();
  const { bot } = await ask(srv, admin, visitor, '退货运费谁出？顺便问下发票');
  assert.deepEqual(bot, ['可以开具发票。']);

  assert.equal(api.requests[0].url, '/v1/chat/completions', 'a full endpoint URL is used as is');
  assert.ok(api.requests[0].body.messages[0].content.includes('<retrieved_knowledge>'));
  assert.deepEqual(api.requests[0].body.tools.map((tool) => tool.function.name), ['search_knowledge_base', 'transfer_to_human']);
  const [assistantTurn, toolTurn] = api.requests[1].body.messages.slice(-2);
  assert.equal(assistantTurn.role, 'assistant');
  assert.equal(assistantTurn.tool_calls[0].id, 'call_1');
  assert.equal(toolTurn.role, 'tool');
  assert.equal(toolTurn.tool_call_id, 'call_1');
  assert.ok(toolTurn.content.includes('发票说明'));
});

test('OpenAI-compatible API errors are reported and the visitor goes to a human', async (t) => {
  let status = 401;
  const api = await mockApi(t, () => ({ status, json: { error: { message: 'Incorrect API key provided' } } }));
  const { srv, admin } = await setup(t, {
    connection: { provider: 'openai', base_url: api.url, model: 'gpt-x', api_key: 'wrong' },
  });
  const a = await ask(srv, admin, await srv.newVisitor(), '你好');
  assert.equal(a.conv.status, 'waiting');
  assert.equal(api.requests.length, 1, 'auth errors are not retried');
  const s1 = (await srv.request('GET', '/api/admin/ai/status', { token: admin.token })).data.status;
  assert.match(s1.last_error.message, /401.*Incorrect API key/);

  status = 503;
  await ask(srv, admin, await srv.newVisitor(), '你好');
  assert.equal(api.requests.length, 3, 'server errors are retried once');

  const ping = await srv.request('POST', '/api/admin/ai/ping', { token: admin.token });
  assert.equal(ping.data.result.ok, false);
  assert.match(ping.data.result.error, /503/);
});

test('Anthropic with a custom API address and key goes through the official SDK', async (t) => {
  const api = await mockApi(t, () => ({
    json: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: '您好，请问有什么可以帮您？' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 8 },
    },
  }));
  const { srv, admin } = await setup(t, {
    connection: {
      provider: 'anthropic',
      base_url: `${api.url}/v1`,
      model: 'claude-sonnet-5-5',
      api_key: 'sk-ant-test-key',
      effort: 'medium',
    },
  });
  const visitor = await srv.newVisitor();
  const { bot } = await ask(srv, admin, visitor, '你好');
  assert.deepEqual(bot, ['您好，请问有什么可以帮您？']);

  const [req] = api.requests;
  assert.match(req.url, /^\/v1\/messages/, 'a trailing /v1 in the address is not doubled');
  assert.equal(req.headers['x-api-key'], 'sk-ant-test-key');
  assert.ok(req.headers['anthropic-version']);
  assert.ok(!String(req.headers['anthropic-beta'] || '').includes('server-side-fallback'), 'no beta features against a proxy');
  assert.equal(req.body.fallbacks, undefined);
  assert.equal(req.body.model, 'claude-sonnet-5-5');
  assert.deepEqual(req.body.output_config, { effort: 'medium' });
  assert.deepEqual(req.body.system[0].cache_control, { type: 'ephemeral' });

  // "Not specified" leaves effort to the model (for models without effort support).
  await srv.request('PUT', '/api/admin/ai/connection', { token: admin.token, body: { effort: '' } });
  const ping = await srv.request('POST', '/api/admin/ai/ping', { token: admin.token });
  assert.equal(ping.data.result.ok, true);
  assert.equal(ping.data.result.reply, '您好，请问有什么可以帮您？');
  assert.equal(api.requests[1].body.output_config, undefined);
  assert.equal(api.requests[1].body.tools, undefined);
});

test('without any key or address the AI stays out', async (t) => {
  const { srv, admin } = await setup(t);
  const status = (await srv.request('GET', '/api/admin/ai/status', { token: admin.token })).data.status;
  assert.equal(status.configured, false);
  const { conv } = await ask(srv, admin, await srv.newVisitor(), '你好');
  assert.equal(conv.status, 'waiting');
  assert.equal((await srv.request('POST', '/api/admin/ai/ping', { token: admin.token })).status, 400);
});
