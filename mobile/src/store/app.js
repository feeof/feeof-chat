import { SocketClient } from '../api/socket-client.mjs';
import { get, post, setAuthExpiredHandler } from '../api/http';
import { session, setToken } from './session';
import { state, isMine } from './state';
import { upsertConversation, syncWorkspace, refreshAgents, refreshBadge, clearWorkspace } from './workspace';

let client = null;
let connectedBefore = false;
let appVisible = true;
let hiddenAt = 0;

/** uni.connectSocket wrapped as a SocketClient transport (works in the App, H5 and mini programs). */
function uniTransport(url, handlers) {
  // Passing a callback makes uni return the SocketTask instead of a Promise.
  const task = uni.connectSocket({ url, complete() {} });
  task.onOpen(() => handlers.onOpen());
  task.onMessage((res) => handlers.onMessage(res.data));
  task.onClose((res) => handlers.onClose((res && res.reason) || 'transport close'));
  task.onError(() => handlers.onClose('transport error'));
  return {
    send: (data) => task.send({ data, fail() {} }),
    close: () => task.close({ fail() {} }),
  };
}

// ---- notifications ----

function alertAgent(title, body, conversationId) {
  if (appVisible && state.openConversationId === conversationId) return;
  if (state.vibrate) uni.vibrateLong({ fail() {} });
  if (appVisible) {
    uni.showToast({ title: `${title}：${body}`.slice(0, 60), icon: 'none', duration: 3000 });
    return;
  }
  // #ifdef APP-PLUS
  // System notification while the App is in the background (needs the Push module, see mobile/README.md).
  if (typeof uni.createPushMessage === 'function') {
    uni.createPushMessage({ title, content: body, payload: { conversation_id: conversationId }, fail() {} });
  }
  // #endif
}

function notifyForConversation(conv, previous) {
  const preview = conv.last_message_preview || '';
  if (conv.status === 'waiting' && previous && previous.status === 'bot') {
    alertAgent('访客需要人工服务', conv.handoff_reason ? `${conv.visitor_name}（${conv.handoff_reason}）` : conv.visitor_name, conv.id);
  } else if (conv.status === 'waiting' && !previous) {
    alertAgent('新访客咨询', `${conv.visitor_name}：${preview}`, conv.id);
  } else if (conv.status === 'active' && isMine(conv) && (!previous || previous.agent_id !== state.me.id)) {
    alertAgent('新会话已分配给你', `${conv.visitor_name}：${preview}`, conv.id);
  }
}

function notifyForMessage(msg) {
  if (msg.sender_type !== 'visitor') return;
  const conv = state.live[msg.conversation_id];
  if (!conv || conv.status !== 'active' || !isMine(conv)) return;
  alertAgent(conv.visitor_name, msg.type === 'image' ? '[图片]' : msg.content, conv.id);
}

// ---- realtime ----

async function resync() {
  try {
    await syncWorkspace();
    uni.$emit('ws:resync');
  } catch {
    /* the next reconnect or pull-to-refresh retries */
  }
}

function connectRealtime() {
  disconnectRealtime();
  connectedBefore = false;
  client = new SocketClient({
    url: session.server,
    auth: () => ({ token: session.token }),
    transport: uniTransport,
  });
  client.on('connect', () => {
    state.connected = true;
    // Catch up on anything missed while disconnected.
    if (connectedBefore) resync();
    connectedBefore = true;
  });
  client.on('disconnect', (reason) => {
    state.connected = false;
    // The server ends sockets when a login is revoked; reconnecting tells us whether this one still works.
    if (reason === 'io server disconnect') {
      const current = client;
      setTimeout(() => current === client && current.connect(), 1000);
    }
  });
  client.on('connect_error', (message) => {
    state.connected = false;
    if (message === 'unauthorized') authExpired();
  });
  client.on('conversation:update', (conv) => {
    const previous = upsertConversation(conv);
    notifyForConversation(conv, previous);
  });
  client.on('message', (msg) => {
    uni.$emit('ws:message', msg);
    notifyForMessage(msg);
  });
  client.on('typing', (payload) => uni.$emit('ws:typing', payload));
  client.on('agent:presence', ({ id, status }) => {
    const agent = state.agents.find((a) => a.id === id);
    if (agent) agent.status = status;
    else refreshAgents().catch(() => {});
    if (state.me && state.me.id === id) state.me.status = status;
  });
  client.connect();
}

function disconnectRealtime() {
  if (client) client.disconnect();
  client = null;
  state.connected = false;
}

/** Sends an ephemeral event (typing) when connected. */
export function sendRealtime(event, data) {
  return client ? client.emit(event, data) : false;
}

// ---- app lifecycle ----

/** Loads the workspace for the logged-in agent (state.me) and connects realtime. */
export async function startApp() {
  const [settings, replies] = await Promise.all([get('/api/settings'), get('/api/quick-replies')]);
  state.settings = settings.settings;
  state.quickReplies = replies.quick_replies;
  await syncWorkspace();
  connectRealtime();
  state.ready = true;
}

function endSession() {
  disconnectRealtime();
  setToken('');
  state.me = null;
  state.ready = false;
  state.openConversationId = null;
  clearWorkspace();
  refreshBadge();
}

export async function logout() {
  try {
    await post('/api/auth/logout');
  } catch {
    /* the session is discarded locally either way */
  }
  endSession();
  uni.reLaunch({ url: '/pages/login/login' });
}

export function authExpired() {
  if (!session.token) return;
  endSession();
  uni.reLaunch({ url: '/pages/login/login?expired=1' });
}

setAuthExpiredHandler(authExpired);

export function appShown() {
  appVisible = true;
  if (!client) return;
  client.reconnectNow();
  // Mobile systems suspend background sockets: refresh after a longer absence.
  if (hiddenAt && Date.now() - hiddenAt > 10 * 1000 && state.ready) resync();
  hiddenAt = 0;
}

export function appHidden() {
  appVisible = false;
  hiddenAt = Date.now();
}

export function networkChanged(connected) {
  if (connected && client) client.reconnectNow();
}
