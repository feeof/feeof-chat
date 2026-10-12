const TOKEN_KEY = 'feeof_agent_token';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const session = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set token(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(method, url, body) {
  const headers = {};
  const token = session.token;
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof Blob) {
    payload = body;
    headers['content-type'] = body.type || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !url.endsWith('/login')) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `请求失败（${res.status}）`);
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body) => api('PUT', url, body);
export const patch = (url, body) => api('PATCH', url, body);
export const del = (url) => api('DELETE', url);

export async function uploadImage(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new ApiError(400, '仅支持 PNG、JPG、GIF、WebP 图片');
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(400, '图片不能超过 5MB');
  const { url } = await api('POST', '/api/uploads', file);
  return url;
}
