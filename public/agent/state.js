// Client-side store for the agent workspace, kept in sync by socket events.

export const state = {
  me: null,
  settings: {},
  agents: new Map(),
  // Conversations shown in the live workspace (queue + active).
  live: new Map(),
  // Latest snapshot of every conversation seen, including closed ones.
  known: new Map(),
  quickReplies: [],
};

const bus = new EventTarget();

export function on(type, fn) {
  const handler = (event) => fn(event.detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
}

export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function isAdmin() {
  return state.me && state.me.role === 'admin';
}

export function isMine(conv) {
  return conv.agent_id === state.me.id;
}

function belongsInWorkspace(conv) {
  if (conv.status === 'closed') return false;
  return conv.status === 'waiting' || conv.status === 'bot' || isMine(conv) || isAdmin();
}

/** Stores a conversation snapshot and notifies listeners with the previous one. */
export function upsertConversation(conv) {
  const previous = state.known.get(conv.id) || null;
  state.known.set(conv.id, conv);
  if (belongsInWorkspace(conv)) state.live.set(conv.id, conv);
  else state.live.delete(conv.id);
  emit('conversation', { conv, previous });
}

export function setConversations(list) {
  state.live.clear();
  for (const conv of list) {
    state.known.set(conv.id, conv);
    if (belongsInWorkspace(conv)) state.live.set(conv.id, conv);
  }
  emit('conversations');
}

/** Number shown on the nav badge and page title: queue + my unread. */
export function attentionCount() {
  let count = 0;
  for (const conv of state.live.values()) {
    if (conv.status === 'waiting') count += 1;
    else if (isMine(conv) && conv.agent_unread > 0) count += 1;
  }
  return count;
}
