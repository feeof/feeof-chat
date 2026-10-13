// Formatting helpers shared by every page (same rules as the web workspace).

const pad = (n) => String(n).padStart(2, '0');

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

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

export function formatNumber(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

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

export function stars(rating) {
  if (!rating) return '';
  return '★★★★★'.slice(0, rating) + '☆☆☆☆☆'.slice(0, 5 - rating);
}

export const STATUS_LABEL = { online: '在线', away: '离开', offline: '离线' };
export const STATUS_DESC = {
  online: '在线 · 自动分配新会话',
  away: '离开 · 暂停分配',
  offline: '离线 · 不接待',
};
export const CONVERSATION_STATUS = { bot: 'AI 接待', waiting: '排队中', active: '进行中', closed: '已结束' };
