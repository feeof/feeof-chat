'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ADMIN_PASSWORD, PNG_1PX } = require('./helpers');

let srv;
let admin;

test.before(async () => {
  srv = await startServer();
  admin = await srv.login('admin', ADMIN_PASSWORD);
});

test.after(() => srv.stop());

test('login, session and logout', async () => {
  const bad = await srv.request('POST', '/api/auth/login', { body: { username: 'admin', password: 'nope' } });
  assert.equal(bad.status, 401);
  const unknown = await srv.request('POST', '/api/auth/login', { body: { username: 'ghost', password: 'nope' } });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error, bad.data.error);

  const anon = await srv.request('GET', '/api/auth/me');
  assert.equal(anon.status, 401);

  const me = await srv.request('GET', '/api/auth/me', { token: admin.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.role, 'admin');
  assert.equal(me.data.user.password_hash, undefined);

  const second = await srv.login('admin', ADMIN_PASSWORD);
  const out = await srv.request('POST', '/api/auth/logout', { token: second.token });
  assert.equal(out.status, 200);
  const after = await srv.request('GET', '/api/auth/me', { token: second.token });
  assert.equal(after.status, 401);
});

test('admin manages agents; agents cannot use admin endpoints', async () => {
  const invalid = await srv.request('POST', '/api/admin/agents', {
    token: admin.token,
    body: { username: 'x y', password: 'secret1' },
  });
  assert.equal(invalid.status, 400);
  const shortPassword = await srv.request('POST', '/api/admin/agents', {
    token: admin.token,
    body: { username: 'frank', password: '123' },
  });
  assert.equal(shortPassword.status, 400);

  const frank = await srv.createAgent(admin.token, { username: 'frank', password: 'frank-pass', max_concurrent: 3 });
  assert.equal(frank.role, 'agent');
  assert.equal(frank.max_concurrent, 3);
  const dup = await srv.request('POST', '/api/admin/agents', {
    token: admin.token,
    body: { username: 'FRANK', password: 'whatever' },
  });
  assert.equal(dup.status, 409);

  const session = await srv.login('frank', 'frank-pass');
  for (const [method, url] of [
    ['POST', '/api/admin/agents'],
    ['PUT', '/api/admin/settings'],
    ['GET', '/api/admin/stats'],
    ['POST', '/api/admin/quick-replies'],
  ]) {
    const res = await srv.request(method, url, { token: session.token, body: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 403, `${method} ${url}`);
  }

  const agents = await srv.request('GET', '/api/agents', { token: session.token });
  assert.ok(agents.data.agents.some((a) => a.username === 'frank'));

  const selfDisable = await srv.request('PATCH', `/api/admin/agents/${admin.user.id}`, {
    token: admin.token,
    body: { disabled: true },
  });
  assert.equal(selfDisable.status, 400);

  const reset = await srv.request('PATCH', `/api/admin/agents/${frank.id}`, {
    token: admin.token,
    body: { password: 'new-frank-pass', display_name: '小 F' },
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.agent.display_name, '小 F');
  const old = await srv.request('GET', '/api/auth/me', { token: session.token });
  assert.equal(old.status, 401, 'password reset revokes existing sessions');
  await srv.login('frank', 'new-frank-pass');
});

test('agents can change their own password', async () => {
  await srv.createAgent(admin.token, { username: 'gina', password: 'gina-pass' });
  const s1 = await srv.login('gina', 'gina-pass');
  const s2 = await srv.login('gina', 'gina-pass');
  const wrong = await srv.request('PATCH', '/api/auth/me', {
    token: s1.token,
    body: { current_password: 'nope', new_password: 'gina-pass-2' },
  });
  assert.equal(wrong.status, 400);
  const ok = await srv.request('PATCH', '/api/auth/me', {
    token: s1.token,
    body: { current_password: 'gina-pass', new_password: 'gina-pass-2' },
  });
  assert.equal(ok.status, 200);
  assert.equal((await srv.request('GET', '/api/auth/me', { token: s1.token })).status, 200);
  assert.equal((await srv.request('GET', '/api/auth/me', { token: s2.token })).status, 401);
});

test('visitor sessions are resumable and sanitize page info', async () => {
  const first = await srv.newVisitor({ name: '李四', page_url: 'javascript:alert(1)', referrer: 'https://google.com/' });
  assert.ok(first.token);
  assert.equal(first.visitor.name, '李四');
  assert.equal(first.conversation, null);
  assert.deepEqual(first.messages, []);
  assert.equal(typeof first.config.welcome_message, 'string');

  const resumed = await srv.newVisitor({ token: first.token, name: 'Overwritten?' });
  assert.equal(resumed.token, first.token);
  assert.equal(resumed.visitor.id, first.visitor.id);
  assert.equal(resumed.visitor.name, '李四', 'existing contact info is kept');

  const bogus = await srv.newVisitor({ token: 'not-a-real-token' });
  assert.notEqual(bogus.visitor.id, first.visitor.id);
  assert.notEqual(bogus.token, 'not-a-real-token');

  await srv.request('POST', '/api/visitor/messages', { visitorToken: first.token, body: { content: 'hello' } });
  const conv = (await srv.request('GET', '/api/conversations?status=waiting', { token: admin.token })).data.conversations
    .find((c) => c.visitor_id === first.visitor.id);
  const detail = await srv.request('GET', `/api/conversations/${conv.id}`, { token: admin.token });
  assert.equal(detail.data.visitor.page_url, null);
  assert.equal(detail.data.visitor.referrer, 'https://google.com/');

  const profile = await srv.request('PATCH', '/api/visitor/profile', {
    visitorToken: first.token,
    body: { email: 'bad-email' },
  });
  assert.equal(profile.status, 400);
  const profileOk = await srv.request('PATCH', '/api/visitor/profile', {
    visitorToken: first.token,
    body: { email: 'li@example.com', phone: '+86 138-0000-0000' },
  });
  assert.equal(profileOk.data.visitor.email, 'li@example.com');

  const noteRes = await srv.request('PATCH', `/api/conversations/${conv.id}/visitor`, {
    token: admin.token,
    body: { note: 'VIP 客户', phone: '' },
  });
  assert.equal(noteRes.data.visitor.note, 'VIP 客户');
  assert.equal(noteRes.data.visitor.phone, null);
});

test('visitor session tolerates odd page metadata from the host site', async () => {
  const res = await srv.newVisitor({ page_title: 'T'.repeat(500), email: 'not-an-email', name: 'N'.repeat(80) });
  assert.equal(res.visitor.email, null);
  assert.equal(res.visitor.name.length, 50);
  await srv.request('POST', '/api/visitor/messages', { visitorToken: res.token, body: { content: 'hi' } });
  const conv = (await srv.request('GET', '/api/conversations?status=waiting', { token: admin.token })).data.conversations
    .find((c) => c.visitor_id === res.visitor.id);
  const detail = await srv.request('GET', `/api/conversations/${conv.id}`, { token: admin.token });
  assert.equal(detail.data.visitor.page_title.length, 200);
});

test('message validation', async () => {
  const v = await srv.newVisitor();
  const send = (body) => srv.request('POST', '/api/visitor/messages', { visitorToken: v.token, body });
  assert.equal((await send({ content: '   ' })).status, 400);
  assert.equal((await send({ content: 'x'.repeat(2001) })).status, 400);
  assert.equal((await send({ type: 'image', content: 'https://evil.example.com/a.png' })).status, 400);
  assert.equal((await send({ type: 'image', content: `/uploads/${'a'.repeat(32)}.png` })).status, 400);
  assert.equal((await send({ type: 'video', content: 'x' })).status, 400);
  assert.equal((await send({ content: 123 })).status, 400);
  const noAuth = await srv.request('POST', '/api/visitor/messages', { body: { content: 'hi' } });
  assert.equal(noAuth.status, 401);
  const malformed = await srv.request('POST', '/api/visitor/messages', {
    visitorToken: v.token,
    body: Buffer.from('{oops'),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(malformed.status, 400);
});

test('image upload accepts real images only and serves them safely', async () => {
  const v = await srv.newVisitor();
  const anon = await srv.request('POST', '/api/uploads', { body: PNG_1PX, headers: { 'content-type': 'image/png' } });
  assert.equal(anon.status, 401);

  const fake = await srv.request('POST', '/api/uploads', {
    visitorToken: v.token,
    body: Buffer.from('<svg onload="alert(1)"></svg>'),
    headers: { 'content-type': 'image/png' },
  });
  assert.equal(fake.status, 400);

  const tooBig = await srv.request('POST', '/api/uploads', {
    visitorToken: v.token,
    body: Buffer.concat([PNG_1PX, Buffer.alloc(6 * 1024 * 1024)]),
    headers: { 'content-type': 'image/png' },
  });
  assert.equal(tooBig.status, 413);

  const up = await srv.request('POST', '/api/uploads', {
    visitorToken: v.token,
    body: PNG_1PX,
    headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(up.status, 201);
  assert.match(up.data.url, /^\/uploads\/[a-f0-9]{32}\.png$/);

  const file = await fetch(srv.base + up.data.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('content-security-policy'), /sandbox/);

  const msg = await srv.request('POST', '/api/visitor/messages', {
    visitorToken: v.token,
    body: { type: 'image', content: up.data.url },
  });
  assert.equal(msg.status, 201);
  const conv = await srv.request('GET', `/api/conversations/${msg.data.message.conversation_id}`, { token: admin.token });
  assert.equal(conv.data.conversation.last_message_preview, '[图片]');

  const agentUpload = await srv.request('POST', '/api/uploads', {
    token: admin.token,
    body: PNG_1PX,
    headers: { 'content-type': 'image/png' },
  });
  assert.equal(agentUpload.status, 201);
});

test('POST with X-HTTP-Method-Override: PATCH works like PATCH (mini programs)', async () => {
  const res = await srv.request('POST', '/api/auth/me', {
    token: admin.token,
    headers: { 'x-http-method-override': 'patch' },
    body: { display_name: '超级管理员' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.display_name, '超级管理员');
  const other = await srv.request('POST', '/api/auth/me', {
    token: admin.token,
    headers: { 'x-http-method-override': 'DELETE' },
    body: {},
  });
  assert.equal(other.status, 404);
  await srv.request('PATCH', '/api/auth/me', { token: admin.token, body: { display_name: '管理员' } });
});

test('image upload accepts multipart form data (mobile app and mini programs)', async () => {
  const form = (blob) => {
    const data = new FormData();
    data.append('note', 'x');
    data.append('file', blob, 'photo.png');
    return data;
  };
  const upload = (body) => fetch(`${srv.base}/api/uploads`, { method: 'POST', headers: { authorization: `Bearer ${admin.token}` }, body });

  const ok = await upload(form(new Blob([PNG_1PX], { type: 'image/png' })));
  assert.equal(ok.status, 201);
  const { url } = await ok.json();
  assert.match(url, /^\/uploads\/[a-f0-9]{32}\.png$/);
  assert.deepEqual(Buffer.from(await (await fetch(srv.base + url)).arrayBuffer()), PNG_1PX);

  const fake = await upload(form(new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' })));
  assert.equal(fake.status, 400);

  const tooBig = await upload(form(new Blob([PNG_1PX, Buffer.alloc(6 * 1024 * 1024)], { type: 'image/png' })));
  assert.equal(tooBig.status, 413);

  const noFile = new FormData();
  noFile.append('note', 'x');
  assert.equal((await upload(noFile)).status, 400);

  const broken = await fetch(`${srv.base}/api/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'multipart/form-data' },
    body: 'oops',
  });
  assert.equal(broken.status, 400);
});

test('settings and quick replies', async () => {
  const badColor = await srv.request('PUT', '/api/admin/settings', { token: admin.token, body: { theme_color: 'red' } });
  assert.equal(badColor.status, 400);
  const badMinutes = await srv.request('PUT', '/api/admin/settings', {
    token: admin.token,
    body: { auto_close_minutes: -1 },
  });
  assert.equal(badMinutes.status, 400);

  const updated = await srv.request('PUT', '/api/admin/settings', {
    token: admin.token,
    body: { site_name: '测试商城客服', theme_color: '#10b981', welcome_message: '', auto_assign: false },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.settings.site_name, '测试商城客服');
  assert.equal(updated.data.settings.welcome_message, '');
  assert.equal(updated.data.settings.auto_assign, false);

  const config = await srv.request('GET', '/api/widget/config');
  assert.equal(config.data.config.site_name, '测试商城客服');
  assert.equal(config.data.config.theme_color, '#10b981');
  assert.equal(config.data.config.auto_assign, undefined, 'internal settings are not public');

  const created = await srv.request('POST', '/api/admin/quick-replies', {
    token: admin.token,
    body: { title: '问候', content: '您好，很高兴为您服务！' },
  });
  assert.equal(created.status, 201);
  const id = created.data.quick_reply.id;
  const missing = await srv.request('POST', '/api/admin/quick-replies', { token: admin.token, body: { title: 'x' } });
  assert.equal(missing.status, 400);
  const patched = await srv.request('PATCH', `/api/admin/quick-replies/${id}`, {
    token: admin.token,
    body: { content: '您好！' },
  });
  assert.equal(patched.data.quick_reply.content, '您好！');
  assert.equal(patched.data.quick_reply.title, '问候');
  const list = await srv.request('GET', '/api/quick-replies', { token: admin.token });
  assert.equal(list.data.quick_replies.length, 1);
  assert.equal((await srv.request('DELETE', `/api/admin/quick-replies/${id}`, { token: admin.token })).status, 200);
  assert.equal((await srv.request('DELETE', `/api/admin/quick-replies/${id}`, { token: admin.token })).status, 404);
});

test('unknown API routes and bad ids', async () => {
  assert.equal((await srv.request('GET', '/api/nope', { token: admin.token })).status, 404);
  assert.equal((await srv.request('GET', '/api/conversations/abc', { token: admin.token })).status, 404);
  assert.equal((await srv.request('GET', '/api/conversations/999999', { token: admin.token })).status, 404);
  assert.equal((await srv.request('GET', '/api/conversations?status=bogus', { token: admin.token })).status, 400);
});

test('sockets reject missing or invalid credentials', async () => {
  const anon = srv.socket({});
  await assert.rejects(anon.ready, /unauthorized/);
  const bad = srv.socket({ token: 'invalid' });
  await assert.rejects(bad.ready, /unauthorized/);
});

test('static pages: only the visitor chat page may be framed by other sites', async () => {
  const chat = await fetch(`${srv.base}/chat.html`);
  assert.equal(chat.status, 200);
  assert.match(chat.headers.get('content-security-policy'), /frame-ancestors \*/);
  assert.equal(chat.headers.get('x-frame-options'), null);

  const agent = await fetch(`${srv.base}/agent/`);
  assert.equal(agent.status, 200);
  assert.match(agent.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(agent.headers.get('x-frame-options'), 'SAMEORIGIN');

  const widget = await fetch(`${srv.base}/widget.js`);
  assert.equal(widget.status, 200);
  const config = await fetch(`${srv.base}/api/widget/config`);
  assert.equal(config.headers.get('access-control-allow-origin'), '*');
  const io = await fetch(`${srv.base}/socket.io/socket.io.js`);
  assert.equal(io.status, 200);
});
