import { h, clear } from '/shared/dom.js';
import { icon } from '/shared/icons.js';
import { get, post, put, patch, session } from './api.js';
import { state, emit, isAdmin, isMine, upsertConversation, setConversations, attentionCount } from './state.js';
import {
  avatar,
  button,
  toast,
  toastError,
  modal,
  field,
  popover,
  menu,
  statusDot,
  notifier,
  STATUS_LABEL,
} from './ui.js';
import { ChatsView, HistoryView } from './chat.js';
import { DashboardView, AgentsView, RepliesView, SettingsView } from './admin.js';
import { KnowledgeView } from './knowledge.js';

const root = document.getElementById('root');
const BASE_TITLE = 'Feeof 客服工作台';

const ROUTES = {
  chats: { label: '会话', icon: 'chat', view: ChatsView },
  history: { label: '历史', icon: 'history', view: HistoryView },
  dashboard: { label: '看板', icon: 'chart', view: DashboardView, admin: true },
  agents: { label: '客服', icon: 'users', view: AgentsView, admin: true },
  knowledge: { label: '知识库', icon: 'book', view: KnowledgeView, admin: true },
  replies: { label: '快捷回复', icon: 'zap', view: RepliesView, admin: true },
  settings: { label: '设置', icon: 'sliders', view: SettingsView, admin: true },
};

let currentView = null;
let layout = null;

// ---- login ----

function showLogin(message) {
  document.title = `登录 - ${BASE_TITLE}`;
  const username = h('input', { name: 'username', autocomplete: 'username', required: true, maxlength: 64 });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'login-error', role: 'alert' }, message || '');
  const submit = button('登录', { variant: 'primary', type: 'submit' });
  const form = h(
    'form',
    { class: 'login-card' },
    h('div', { class: 'login-logo' }, icon('headphones', { size: 28 })),
    h('h1', null, '客服工作台'),
    h('p', { class: 'login-sub' }, '登录后开始接待访客'),
    field('用户名', username),
    field('密码', password),
    error,
    submit,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    try {
      const { token, user } = await post('/api/auth/login', { username: username.value.trim(), password: password.value });
      session.token = token;
      state.me = user;
      notifier.request().catch(() => {});
      await startApp();
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
    }
  });
  clear(root, h('div', { class: 'login' }, form));
  username.focus();
}

// ---- app shell ----

function buildLayout() {
  const nav = h('nav', { class: 'rail-nav' });
  const statusBtn = h('button', { type: 'button', class: 'rail-btn', title: '切换状态', onclick: (e) => openStatusMenu(e.currentTarget) });
  const accountBtn = h('button', { type: 'button', class: 'rail-btn', title: '账号', onclick: (e) => openAccountMenu(e.currentTarget) });
  const banner = h('div', { class: 'conn-banner', hidden: true }, '连接已断开，正在重新连接…');
  const main = h('main', { class: 'main' });
  const rail = h(
    'aside',
    { class: 'rail' },
    h('div', { class: 'rail-logo', title: BASE_TITLE }, icon('headphones', { size: 22 })),
    nav,
    h('div', { class: 'rail-bottom' }, statusBtn, accountBtn),
  );
  clear(root, h('div', { class: 'app' }, rail, h('div', { class: 'main-wrap' }, banner, main)));
  layout = { nav, statusBtn, accountBtn, banner, main };
  renderNav();
  renderStatusButton();
  renderAccountButton();
}

function currentRoute() {
  const key = location.hash.replace(/^#\/?/, '');
  const route = ROUTES[key];
  if (!route || (route.admin && !isAdmin())) return 'chats';
  return key;
}

function renderNav() {
  const active = currentRoute();
  const count = attentionCount();
  clear(layout.nav,
    Object.entries(ROUTES)
      .filter(([, route]) => !route.admin || isAdmin())
      .map(([key, route]) =>
        h(
          'a',
          { href: `#/${key}`, class: `rail-item${key === active ? ' active' : ''}`, 'aria-current': key === active ? 'page' : null },
          icon(route.icon, { size: 20 }),
          h('span', null, route.label),
          key === 'chats' && count ? h('span', { class: 'rail-badge' }, count > 99 ? '99+' : String(count)) : null,
        ),
      ),
  );
  document.title = count ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
}

function renderStatusButton() {
  const status = state.me.preferred_status || state.me.status;
  clear(layout.statusBtn, statusDot(status), h('span', null, STATUS_LABEL[status]));
}

function renderAccountButton() {
  clear(layout.accountBtn, avatar(state.me.display_name, { size: 32 }));
}

function route() {
  const key = currentRoute();
  if (currentView) currentView.destroy();
  const View = ROUTES[key].view;
  currentView = new View();
  clear(layout.main, currentView.el);
  renderNav();
}

// ---- menus ----

function openStatusMenu(anchor) {
  const current = state.me.preferred_status;
  popover(
    anchor,
    menu(
      ['online', 'away', 'offline'].map((status) => ({
        label: { online: '在线 · 自动分配新会话', away: '离开 · 暂停分配', offline: '离线 · 不接待' }[status],
        prefix: statusDot(status),
        active: current === status,
        onClick: () => setStatus(status),
      })),
    ),
  );
}

async function setStatus(status) {
  try {
    const { user } = await put('/api/auth/me/status', { status });
    state.me = user;
    renderStatusButton();
  } catch (err) {
    toastError(err);
  }
}

function openAccountMenu(anchor) {
  const items = [
    { label: `${state.me.display_name}（${state.me.role === 'admin' ? '管理员' : '客服'}）`, icon: 'user', onClick: openProfile },
    { label: '修改密码', icon: 'key', onClick: openPassword },
  ];
  if (notifier.supported && !notifier.enabled) {
    items.push({
      label: '开启桌面通知',
      icon: 'bell',
      onClick: async () => {
        const ok = await notifier.request();
        toast(ok ? '桌面通知已开启' : '浏览器未允许通知，可在地址栏的网站设置中开启', ok ? 'success' : 'error');
      },
    });
  }
  items.push('-', { label: '退出登录', icon: 'logout', danger: true, onClick: logout });
  popover(anchor, menu(items));
}

function openProfile() {
  const name = h('input', { value: state.me.display_name, maxlength: 32, required: true });
  const form = h('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, field('显示名称', name, '访客在聊天窗口中看到的名称'), field('用户名', h('input', { value: state.me.username, disabled: true })));
  modal({
    title: '个人资料',
    body: form,
    actions: [
      { label: '取消' },
      {
        label: '保存',
        variant: 'primary',
        onClick: async () => {
          if (!form.reportValidity()) return false;
          const { user } = await patch('/api/auth/me', { display_name: name.value.trim() });
          state.me = user;
          renderAccountButton();
          toast('已保存', 'success');
          return true;
        },
      },
    ],
  });
}

function openPassword() {
  const current = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const next = h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' });
  const confirm = h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' });
  const form = h('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, field('当前密码', current), field('新密码', next, '至少 6 位'), field('确认新密码', confirm));
  modal({
    title: '修改密码',
    body: form,
    actions: [
      { label: '取消' },
      {
        label: '保存',
        variant: 'primary',
        onClick: async () => {
          if (!form.reportValidity()) return false;
          if (next.value !== confirm.value) {
            toast('两次输入的新密码不一致', 'error');
            return false;
          }
          await patch('/api/auth/me', { current_password: current.value, new_password: next.value });
          toast('密码已修改，其他设备上的登录已失效', 'success');
          return true;
        },
      },
    ],
  });
}

async function logout() {
  try {
    await post('/api/auth/logout');
  } catch {
    /* the session is discarded locally either way */
  }
  session.token = null;
  location.hash = '';
  location.reload();
}

// ---- realtime ----

function notifyForConversation(conv, previous) {
  if (conv.status === 'waiting' && previous && previous.status === 'bot') {
    const reason = conv.handoff_reason ? `（${conv.handoff_reason}）` : '';
    notifier.alert('访客需要人工服务', `${conv.visitor_name}${reason}`, () => (location.hash = '#/chats'));
  } else if (conv.status === 'waiting' && !previous) {
    notifier.alert('新访客咨询', `${conv.visitor_name}：${conv.last_message_preview || ''}`, () => (location.hash = '#/chats'));
  } else if (conv.status === 'active' && isMine(conv) && (!previous || previous.agent_id !== state.me.id)) {
    notifier.alert('新会话已分配给你', `${conv.visitor_name}：${conv.last_message_preview || ''}`, () => (location.hash = '#/chats'));
  }
}

function notifyForMessage(msg) {
  if (msg.sender_type !== 'visitor') return;
  const conv = state.live.get(msg.conversation_id);
  if (!conv || conv.status !== 'active' || !isMine(conv)) return;
  if (!document.hidden && currentRoute() === 'chats') return;
  notifier.alert(conv.visitor_name, msg.type === 'image' ? '[图片]' : msg.content, () => (location.hash = '#/chats'));
}

async function syncWorkspace() {
  const [bot, waiting, active, agents] = await Promise.all([
    get('/api/conversations?status=bot&limit=200'),
    get('/api/conversations?status=waiting&limit=200'),
    get('/api/conversations?status=active&limit=200'),
    get('/api/agents'),
  ]);
  state.agents = new Map(agents.agents.map((a) => [a.id, a]));
  setConversations([...bot.conversations, ...waiting.conversations, ...active.conversations]);
  emit('agents');
  renderNav();
}

function connectSocket() {
  const socket = window.io({ auth: { token: session.token } });
  state.socket = socket;
  let connectedBefore = false;

  socket.on('connect', () => {
    layout.banner.hidden = true;
    if (connectedBefore) {
      syncWorkspace()
        .then(() => emit('resync'))
        .catch(() => {});
    }
    connectedBefore = true;
  });
  socket.on('disconnect', () => {
    layout.banner.hidden = false;
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      socket.disconnect();
      window.dispatchEvent(new CustomEvent('auth:expired'));
    } else {
      layout.banner.hidden = false;
    }
  });
  socket.on('conversation:update', (conv) => {
    const previous = state.live.get(conv.id);
    upsertConversation(conv);
    notifyForConversation(conv, previous);
    renderNav();
  });
  socket.on('message', (msg) => {
    emit('message', msg);
    notifyForMessage(msg);
  });
  socket.on('typing', (payload) => emit('typing', payload));
  socket.on('agent:presence', ({ id, status }) => {
    const agent = state.agents.get(id);
    if (agent) state.agents.set(id, { ...agent, status });
    else get('/api/agents').then(({ agents }) => {
      state.agents = new Map(agents.map((a) => [a.id, a]));
      emit('agents');
    }).catch(() => {});
    emit('agents');
  });
}

async function startApp() {
  const [settings, replies] = await Promise.all([get('/api/settings'), get('/api/quick-replies')]);
  state.settings = settings.settings;
  state.quickReplies = replies.quick_replies;
  buildLayout();
  await syncWorkspace();
  connectSocket();
  route();
}

window.addEventListener('hashchange', () => {
  if (layout) route();
});

window.addEventListener('auth:expired', () => {
  if (state.socket) state.socket.disconnect();
  session.token = null;
  if (currentView) currentView.destroy();
  currentView = null;
  layout = null;
  state.me = null;
  showLogin('登录已失效，请重新登录');
});

async function boot() {
  if (!session.token) return showLogin();
  try {
    const { user } = await get('/api/auth/me');
    state.me = user;
    await startApp();
  } catch (err) {
    // A 401 already brought up the login form through the auth:expired handler.
    if (err.status !== 401) showLogin(err.message);
  }
}

boot();
