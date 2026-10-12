import { h, clear, formatTime, renderText, isComposing } from '/shared/dom.js';
import { icon } from '/shared/icons.js';

const params = new URLSearchParams(location.search);
const embedded = params.get('embed') === '1' && window.parent !== window;
const TOKEN_KEY = 'feeof_chat_visitor_token';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TIME_GAP_MS = 5 * 60 * 1000;

const state = {
  token: null,
  config: null,
  visitor: null,
  conversation: null,
  messageIds: new Set(),
  firstId: null,
  lastId: 0,
  lastTime: 0,
  hasMore: false,
  visible: !embedded,
  unread: 0,
  socket: null,
  typingTimer: null,
  lastTypingSent: 0,
  ratingFor: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  siteName: $('site-name'),
  logo: $('chat-logo'),
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  actions: $('chat-actions'),
  profile: $('profile-panel'),
  messages: $('messages'),
  typing: $('typing'),
  rating: $('rating'),
  input: $('input'),
  send: $('btn-send'),
  image: $('btn-image'),
  file: $('file-input'),
};

// ---- storage & api ----

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage unavailable (private mode / blocked third-party storage) */
    }
  },
};

async function api(method, url, body) {
  const headers = {};
  if (state.token) headers['x-visitor-token'] = state.token;
  let payload;
  if (body instanceof Blob) {
    payload = body;
    headers['content-type'] = body.type || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(text) {
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

function postToParent(message) {
  if (embedded) window.parent.postMessage(message, '*');
}

// ---- header ----

function readableTextColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111827' : '#ffffff';
}

function applyConfig(config) {
  state.config = config;
  document.title = config.site_name;
  els.siteName.textContent = config.site_name;
  if (/^#[0-9a-f]{6}$/i.test(config.theme_color)) {
    document.documentElement.style.setProperty('--brand', config.theme_color);
    document.documentElement.style.setProperty('--brand-contrast', readableTextColor(config.theme_color));
  }
  els.input.maxLength = config.max_message_length || 2000;
  renderStatus();
}

function renderStatus() {
  const conv = state.conversation;
  const humans = Boolean(state.config && state.config.online);
  const ai = Boolean(state.config && state.config.ai_enabled);
  let text;
  if (conv && conv.status === 'bot') text = `${state.config.ai_name} 为您服务`;
  else if (conv && conv.status === 'active') text = `客服 ${conv.agent_name || ''} 正在为您服务`;
  else if (conv && conv.status === 'waiting') text = humans ? '正在为您接入客服…' : '客服暂时离线，您可以先留言';
  else text = humans || ai ? '客服在线' : '客服离线，可以留言';
  els.statusText.textContent = text;
  const live = conv && conv.status !== 'closed' && conv.status !== 'waiting';
  els.statusDot.classList.toggle('online', Boolean(live || (conv && conv.status === 'waiting' ? humans : humans || ai)));
  renderActions();
}

function renderActions() {
  clear(els.actions);
  const open = state.conversation && state.conversation.status !== 'closed';
  if (state.conversation && state.conversation.status === 'bot') {
    els.actions.append(h('button', { type: 'button', class: 'text-btn', title: '转接人工客服', onclick: requestHuman }, '转人工'));
  }
  els.actions.append(
    h('button', { type: 'button', title: '留下联系方式', 'aria-label': '留下联系方式', onclick: toggleProfile }, icon('user')),
  );
  if (open) {
    els.actions.append(
      h('button', { type: 'button', title: '结束会话', 'aria-label': '结束会话', onclick: endConversation }, icon('power')),
    );
  }
  if (embedded) {
    els.actions.append(
      h(
        'button',
        { type: 'button', title: '最小化', 'aria-label': '最小化', onclick: () => postToParent({ type: 'feeof:minimize' }) },
        icon('minus'),
      ),
    );
  }
}

// ---- messages ----

function avatarText(name) {
  return (name || '客').trim().slice(0, 1).toUpperCase();
}

function messageContent(msg) {
  if (msg.type === 'image') {
    const img = h('img', { src: msg.content, alt: '图片', loading: 'lazy' });
    img.addEventListener('load', () => scrollToBottom(false), { once: true });
    return h('div', { class: 'bubble image' }, h('a', { href: msg.content, target: '_blank', rel: 'noopener' }, img));
  }
  return h('div', { class: 'bubble' }, renderText(msg.content));
}

function renderMessage(msg) {
  if (msg.sender_type === 'system') {
    return h('div', { class: 'sys', dataset: { id: msg.id } }, h('span', null, msg.content));
  }
  const mine = msg.sender_type === 'visitor';
  return h(
    'div',
    { class: `msg${mine ? ' mine' : ''}`, dataset: { id: msg.id } },
    mine ? null : h('div', { class: 'msg-avatar' }, avatarText(msg.sender_name)),
    h(
      'div',
      { class: 'msg-body' },
      mine
        ? null
        : h(
            'div',
            { class: 'msg-name' },
            msg.sender_name || '客服',
            msg.sender_type === 'bot' ? h('span', { class: 'ai-tag' }, 'AI') : null,
          ),
      messageContent(msg),
    ),
  );
}

function timeSeparator(ts) {
  return h('div', { class: 'time-sep' }, formatTime(ts));
}

function isNearBottom() {
  const el = els.messages;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(force = true) {
  if (force || isNearBottom()) els.messages.scrollTop = els.messages.scrollHeight;
}

function welcomeNode() {
  const text = state.config && state.config.welcome_message;
  if (!text) return null;
  const ai = state.config.ai_enabled;
  return renderMessage({
    id: 'welcome',
    sender_type: ai ? 'bot' : 'agent',
    sender_name: ai ? state.config.ai_name : state.config.site_name,
    type: 'text',
    content: text,
  });
}

function renderAll(messages) {
  clear(els.messages);
  state.messageIds.clear();
  state.lastTime = 0;
  state.hasMore = messages.length >= 50;
  state.firstId = messages.length ? messages[0].id : null;
  if (state.hasMore) {
    els.messages.append(h('button', { type: 'button', class: 'load-more', onclick: loadOlder }, '查看更早的消息'));
  }
  const welcome = welcomeNode();
  if (welcome && !state.hasMore) els.messages.append(welcome);
  for (const msg of messages) appendMessage(msg, { notify: false });
  scrollToBottom();
}

function appendMessage(msg, { notify = true } = {}) {
  if (state.messageIds.has(msg.id)) return false;
  const pending = msg.sender_type === 'visitor' ? matchPending(msg) : null;
  if (pending) {
    settlePending(pending, msg);
    return true;
  }
  state.messageIds.add(msg.id);
  state.lastId = Math.max(state.lastId, msg.id);
  const stick = isNearBottom();
  if (msg.created_at - state.lastTime > TIME_GAP_MS) els.messages.append(timeSeparator(msg.created_at));
  state.lastTime = msg.created_at;
  els.messages.append(renderMessage(msg));
  scrollToBottom(stick || msg.sender_type === 'visitor');
  if (notify && msg.sender_type !== 'visitor' && !state.visible) {
    state.unread += 1;
    postToParent({ type: 'feeof:unread', count: state.unread });
  }
  return true;
}

async function loadOlder(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { messages } = await api('GET', `/api/visitor/messages?before=${state.firstId}&limit=50`);
    const previousHeight = els.messages.scrollHeight;
    const frag = document.createDocumentFragment();
    let lastTime = 0;
    for (const msg of messages) {
      if (state.messageIds.has(msg.id)) continue;
      state.messageIds.add(msg.id);
      if (msg.created_at - lastTime > TIME_GAP_MS) frag.append(timeSeparator(msg.created_at));
      lastTime = msg.created_at;
      frag.append(renderMessage(msg));
    }
    if (messages.length) state.firstId = messages[0].id;
    state.hasMore = messages.length >= 50;
    button.after(frag);
    if (!state.hasMore) {
      const welcome = welcomeNode();
      button.replaceWith(welcome || '');
    }
    els.messages.scrollTop += els.messages.scrollHeight - previousHeight;
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}

/** Fetches anything missed while the socket was disconnected. */
async function catchUp() {
  try {
    const { messages, conversation } = await api('GET', `/api/visitor/messages?after=${state.lastId}&limit=200`);
    for (const msg of messages) appendMessage(msg);
    setConversation(conversation);
  } catch {
    /* next reconnect will retry */
  }
}

// ---- sending ----

// Messages being sent. The socket echo of a message can arrive before the
// HTTP response, so whichever comes first settles the bubble in place.
const pendingMessages = [];

function pendingBubble(content) {
  const status = h('div', { class: 'msg-state' }, '发送中…');
  const el = h('div', { class: 'msg mine pending' }, h('div', { class: 'msg-body' }, content, status));
  els.messages.append(el);
  scrollToBottom();
  const pending = { el, status, body: null };
  pendingMessages.push(pending);
  return pending;
}

function settlePending(pending, msg) {
  pendingMessages.splice(pendingMessages.indexOf(pending), 1);
  if (state.messageIds.has(msg.id)) {
    pending.el.remove();
    return;
  }
  state.messageIds.add(msg.id);
  state.lastId = Math.max(state.lastId, msg.id);
  state.lastTime = msg.created_at;
  pending.el.replaceWith(renderMessage(msg));
}

/** Finds the in-flight bubble an echoed visitor message belongs to. */
function matchPending(msg) {
  return pendingMessages.find((p) => p.body && p.body.type === msg.type && p.body.content === msg.content);
}

async function deliver(body, pending) {
  pending.body = body;
  try {
    const { message } = await api('POST', '/api/visitor/messages', body);
    if (pendingMessages.includes(pending)) settlePending(pending, message);
  } catch (err) {
    pending.body = null;
    pending.el.classList.remove('pending');
    pending.status.textContent = `${err.message}，点击重试`;
    pending.status.className = 'msg-state error';
    pending.status.onclick = () => {
      pending.status.onclick = null;
      pending.status.className = 'msg-state';
      pending.status.textContent = '发送中…';
      pending.el.classList.add('pending');
      deliver(body, pending);
    };
  }
}

function sendText() {
  const content = els.input.value.trim();
  if (!content) return;
  els.input.value = '';
  autosize();
  state.lastTypingSent = 0; // the next keystroke starts a new message, announce it right away
  deliver({ type: 'text', content }, pendingBubble(h('div', { class: 'bubble' }, content)));
}

async function sendImage(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('仅支持 PNG、JPG、GIF、WebP 图片');
  if (file.size > MAX_IMAGE_BYTES) return toast('图片不能超过 5MB');
  const preview = URL.createObjectURL(file);
  const pending = pendingBubble(h('div', { class: 'bubble image' }, h('img', { src: preview, alt: '图片' })));
  try {
    const { url } = await api('POST', '/api/uploads', file);
    await deliver({ type: 'image', content: url }, pending);
  } catch (err) {
    pendingMessages.splice(pendingMessages.indexOf(pending), 1);
    pending.el.remove();
    toast(err.message);
  } finally {
    URL.revokeObjectURL(preview);
  }
}

function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight + 2, 120)}px`;
}

function notifyTyping() {
  const now = Date.now();
  if (!state.socket || now - state.lastTypingSent < 2000) return;
  state.lastTypingSent = now;
  state.socket.emit('typing');
}

// ---- conversation state ----

function setConversation(conv) {
  const previous = state.conversation;
  state.conversation = conv;
  renderStatus();
  // Only invite a rating when we saw this conversation close live, not on page load.
  const justClosed = conv && previous && previous.id === conv.id && previous.status !== 'closed' && conv.status === 'closed';
  if (justClosed && !conv.rating) showRating(conv);
  else if (!conv || conv.id !== state.ratingFor) hideRating();
}

function hideRating() {
  els.rating.hidden = true;
  state.ratingFor = null;
}

function showRating(conv) {
  state.ratingFor = conv.id;
  let score = 0;
  const stars = [1, 2, 3, 4, 5].map((n) =>
    h('button', { type: 'button', 'aria-label': `${n} 星`, onclick: () => pick(n) }, icon('star', { size: 26 })),
  );
  const comment = h('textarea', { maxlength: 500, placeholder: '说说您的感受（选填）' });
  const submit = h('button', { type: 'button', class: 'btn-primary', disabled: true, onclick: send }, '提交评价');
  const labels = ['', '非常不满意', '不满意', '一般', '满意', '非常满意'];
  const label = h('div', { class: 'msg-state' }, '请为本次服务打分');

  function pick(n) {
    score = n;
    stars.forEach((star, i) => star.classList.toggle('on', i < n));
    label.textContent = labels[n];
    submit.disabled = false;
  }

  async function send() {
    submit.disabled = true;
    try {
      await api('POST', '/api/visitor/rate', { conversation_id: conv.id, rating: score, comment: comment.value.trim() });
      clear(els.rating, h('div', { class: 'rating-done' }, '感谢您的评价！'));
      setTimeout(() => {
        if (state.ratingFor === conv.id) hideRating();
      }, 2500);
    } catch (err) {
      toast(err.message);
      submit.disabled = false;
    }
  }

  clear(els.rating,
    h('div', { class: 'rating-title' }, '本次服务您还满意吗？'),
    h('div', { class: 'stars' }, stars),
    label,
    comment,
    h(
      'div',
      { class: 'row' },
      h('button', { type: 'button', class: 'btn-text', onclick: hideRating }, '跳过'),
      submit,
    ),
  );
  els.rating.hidden = false;
  scrollToBottom();
}

async function requestHuman() {
  try {
    const { conversation } = await api('POST', '/api/visitor/handoff');
    setConversation(conversation);
  } catch (err) {
    toast(err.message);
  }
}

async function endConversation() {
  if (!window.confirm('确定要结束本次会话吗？')) return;
  try {
    const { conversation } = await api('POST', '/api/visitor/close');
    setConversation(conversation);
  } catch (err) {
    toast(err.message);
  }
}

function toggleProfile() {
  const form = els.profile;
  form.hidden = !form.hidden;
  if (!form.hidden) {
    for (const key of ['name', 'phone', 'email']) form.elements[key].value = (state.visitor && state.visitor[key]) || '';
    form.elements.name.focus();
  }
}

els.profile.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = els.profile;
  const body = {};
  for (const key of ['name', 'phone', 'email']) {
    const value = form.elements[key].value.trim();
    if (value) body[key] = value;
  }
  try {
    const { visitor } = await api('PATCH', '/api/visitor/profile', body);
    state.visitor = visitor;
    form.hidden = true;
    toast('联系方式已保存');
  } catch (err) {
    toast(err.message);
  }
});
$('profile-cancel').addEventListener('click', () => (els.profile.hidden = true));

// ---- realtime ----

function connectSocket() {
  const socket = window.io({ auth: { visitorToken: state.token } });
  state.socket = socket;
  let connectedBefore = false;

  socket.on('connect', () => {
    if (connectedBefore) catchUp();
    connectedBefore = true;
  });
  socket.on('connect_error', async (err) => {
    if (err.message === 'unauthorized') {
      // The stored identity is gone (e.g. data reset); start over with a fresh one.
      socket.disconnect();
      storage.set(TOKEN_KEY, null);
      state.token = null;
      await start();
    }
  });
  socket.on('message', (msg) => {
    if (appendMessage(msg) && msg.sender_type !== 'visitor') hideTyping();
  });
  socket.on('conversation', setConversation);
  socket.on('service:status', ({ online }) => {
    if (state.config) state.config.online = online;
    renderStatus();
  });
  socket.on('typing', ({ from }) => {
    if (from !== 'agent') return;
    els.typing.hidden = false;
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(hideTyping, 4000);
  });
}

function hideTyping() {
  els.typing.hidden = true;
  clearTimeout(state.typingTimer);
}

// ---- embedding ----

window.addEventListener('message', (event) => {
  if (!embedded || event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'feeof:visibility') {
    state.visible = Boolean(event.data.open);
    if (state.visible) {
      state.unread = 0;
      postToParent({ type: 'feeof:unread', count: 0 });
      scrollToBottom();
      els.input.focus({ preventScroll: true });
    }
  }
});

// ---- wiring ----

els.image.append(icon('image', { size: 20 }));
els.send.append(icon('send', { size: 18 }));
els.logo.append(icon('headphones', { size: 18 }));
els.send.addEventListener('click', sendText);
els.image.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => {
  sendImage(els.file.files[0]);
  els.file.value = '';
});
els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !isComposing(event)) {
    event.preventDefault();
    sendText();
  }
});
els.input.addEventListener('input', () => {
  autosize();
  if (els.input.value.trim()) notifyTyping();
});
els.input.addEventListener('paste', (event) => {
  const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    event.preventDefault();
    sendImage(file);
  }
});
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) sendImage(file);
});

async function start() {
  if (embedded) document.body.classList.add('embedded');
  const stored = storage.get(TOKEN_KEY);
  const data = await api('POST', '/api/visitor/session', {
    token: stored || undefined,
    name: params.get('name') || undefined,
    email: params.get('email') || undefined,
    page_url: params.get('ref') || document.referrer || undefined,
    page_title: params.get('title') || undefined,
    referrer: params.get('referrer') || undefined,
  });
  state.token = data.token;
  storage.set(TOKEN_KEY, data.token);
  state.visitor = data.visitor;
  state.conversation = data.conversation;
  applyConfig(data.config);
  renderAll(data.messages);
  connectSocket();
  postToParent({ type: 'feeof:ready' });
}

start().catch((err) => {
  els.statusText.textContent = '连接失败，请刷新重试';
  toast(err.message);
});
