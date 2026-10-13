import { get } from '../api/http';
import { state, isAdmin, isMine } from './state';

// Latest snapshot of every conversation seen, including closed ones.
const known = new Map();

function belongsInWorkspace(conv) {
  if (conv.status === 'closed') return false;
  return conv.status === 'waiting' || conv.status === 'bot' || isMine(conv) || isAdmin();
}

export function knownConversation(id) {
  return known.get(id) || null;
}

/** Stores a conversation snapshot, tells open pages ('ws:conversation') and returns the previous snapshot. */
export function upsertConversation(conv) {
  const previous = known.get(conv.id) || null;
  known.set(conv.id, conv);
  if (belongsInWorkspace(conv)) state.live[conv.id] = conv;
  else if (state.live[conv.id]) delete state.live[conv.id];
  uni.$emit('ws:conversation', { conv, previous });
  refreshBadge();
  return previous;
}

function setConversations(list) {
  const live = {};
  for (const conv of list) {
    known.set(conv.id, conv);
    if (belongsInWorkspace(conv)) live[conv.id] = conv;
  }
  state.live = live;
  refreshBadge();
}

export function clearWorkspace() {
  known.clear();
  state.live = {};
  state.agents = [];
}

/** Queue + my conversations with unread messages: the number on the 会话 tab. */
export function attentionCount() {
  let count = 0;
  for (const conv of Object.values(state.live)) {
    if (conv.status === 'waiting') count += 1;
    else if (conv.status === 'active' && isMine(conv) && conv.agent_unread > 0) count += 1;
  }
  return count;
}

export function refreshBadge() {
  const count = state.me ? attentionCount() : 0;
  // Fails harmlessly while a non-tab page is showing; tab pages call this again on show.
  if (count) uni.setTabBarBadge({ index: 0, text: count > 99 ? '99+' : String(count), fail() {} });
  else uni.removeTabBarBadge({ index: 0, fail() {} });
}

export async function refreshAgents() {
  const { agents } = await get('/api/agents');
  state.agents = agents;
}

/** Reloads the live workspace from the server (on start, reconnect and pull-to-refresh). */
export async function syncWorkspace() {
  const [bot, waiting, active, agents] = await Promise.all([
    get('/api/conversations?status=bot&limit=200'),
    get('/api/conversations?status=waiting&limit=200'),
    get('/api/conversations?status=active&limit=200'),
    get('/api/agents'),
  ]);
  state.agents = agents.agents;
  setConversations([...bot.conversations, ...waiting.conversations, ...active.conversations]);
}
