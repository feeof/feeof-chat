import { reactive } from 'vue';

const VIBRATE_KEY = 'feeof_vibrate';

function readVibrate() {
  try {
    return uni.getStorageSync(VIBRATE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Workspace state shared by every page, kept current by the realtime connection. */
export const state = reactive({
  me: null,
  settings: {},
  quickReplies: [],
  agents: [],
  // Conversations in the live workspace (AI, queue, in progress), keyed by id.
  live: {},
  // The realtime connection is up.
  connected: false,
  // startApp() finished: the lists above are loaded.
  ready: false,
  // The conversation currently open in the chat page, if any (suppresses its notifications).
  openConversationId: null,
  vibrate: readVibrate(),
});

export function setVibrate(on) {
  state.vibrate = on;
  try {
    uni.setStorageSync(VIBRATE_KEY, on ? 'on' : 'off');
  } catch {
    /* not persisted */
  }
}

export function isAdmin() {
  return Boolean(state.me && state.me.role === 'admin');
}

export function isMine(conv) {
  return Boolean(state.me && conv.agent_id === state.me.id);
}
