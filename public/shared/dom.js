// Small DOM helpers shared by the visitor chat page and the agent workspace.
// User-provided text is only ever inserted as text nodes, never as HTML.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || typeof value === 'boolean') el[key] = value;
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Empties `el`, then appends `children` (arrays are flattened, null/false skipped). */
export function clear(el, ...children) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return append(el, children);
}

const pad = (n) => String(n).padStart(2, '0');

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "14:05" for today, "昨天 14:05", "10-03 14:05", or "2025-10-03" for earlier years. */
export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, now)) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Human readable duration: "45 秒", "3 分 20 秒", "2 小时 5 分". */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '-';
  if (ms < 1000) return '1 秒内';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} 分 ${s % 60} 秒` : `${m} 分钟`;
  const hours = Math.floor(m / 60);
  return m % 60 ? `${hours} 小时 ${m % 60} 分` : `${hours} 小时`;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'，。！？、）)]+/g;

/** Renders plain text with clickable http(s) links. */
export function renderText(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const match of String(text).matchAll(URL_RE)) {
    if (match.index > last) frag.append(text.slice(last, match.index));
    frag.append(h('a', { href: match[0], target: '_blank', rel: 'noopener noreferrer' }, match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/** Only http(s) URLs may become links. */
export function safeHref(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Rough browser / OS detection for the visitor info panel. */
export function describeUserAgent(ua) {
  if (!ua) return '-';
  const os =
    (/Windows NT/.test(ua) && 'Windows') ||
    (/iPhone|iPad|iPod/.test(ua) && 'iOS') ||
    (/Mac OS X/.test(ua) && 'macOS') ||
    (/Android/.test(ua) && 'Android') ||
    (/HarmonyOS/.test(ua) && 'HarmonyOS') ||
    (/Linux/.test(ua) && 'Linux') ||
    '未知系统';
  const browser =
    (/MicroMessenger/.test(ua) && '微信') ||
    (/Edg\//.test(ua) && 'Edge') ||
    (/OPR\//.test(ua) && 'Opera') ||
    (/Firefox\//.test(ua) && 'Firefox') ||
    (/Chrome\//.test(ua) && 'Chrome') ||
    (/Safari\//.test(ua) && 'Safari') ||
    '未知浏览器';
  return `${browser} · ${os}`;
}

export function isComposing(event) {
  // Enter confirms an IME candidate (Chinese/Japanese input) and must not send.
  return event.isComposing || event.keyCode === 229;
}
