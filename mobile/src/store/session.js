import { reactive } from 'vue';

const SERVER_KEY = 'feeof_server';
const TOKEN_KEY = 'feeof_token';

function read(key) {
  try {
    return uni.getStorageSync(key) || '';
  } catch {
    return '';
  }
}

function write(key, value) {
  try {
    if (value) uni.setStorageSync(key, value);
    else uni.removeStorageSync(key);
  } catch {
    /* storage unavailable: the session lasts until the app closes */
  }
}

/** The H5 build is served by the chat server itself (at /m/), so it defaults to the same origin. */
export function defaultServer() {
  let origin = '';
  // #ifdef H5
  origin = window.location.origin;
  // #endif
  return origin;
}

/** Server address and login token, persisted on the device. */
export const session = reactive({
  server: read(SERVER_KEY) || defaultServer(),
  token: read(TOKEN_KEY),
});

export function setServer(server) {
  session.server = server;
  write(SERVER_KEY, server);
}

export function setToken(token) {
  session.token = token || '';
  write(TOKEN_KEY, token);
}

const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Turns what the user typed into a base URL: "chat.example.com/" becomes
 * "https://chat.example.com"; LAN addresses default to http. Returns '' when invalid.
 */
export function normalizeServer(input) {
  let url = String(input || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split('/')[0];
    url = `${PRIVATE_HOST_RE.test(host) || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host) ? 'http' : 'https'}://${url}`;
  }
  return /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url) ? url : '';
}

/** Absolute URL for a server path such as an uploaded image ("/uploads/..."). */
export function serverUrl(path) {
  if (!path || /^https?:\/\//i.test(path)) return path;
  return session.server + path;
}
