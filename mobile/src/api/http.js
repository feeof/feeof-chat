import { session } from '../store/session';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onAuthExpired = () => {};

/** Called when a request with a token gets 401 (logged out elsewhere, password changed, disabled). */
export function setAuthExpiredHandler(fn) {
  onAuthExpired = fn;
}

function authHeader() {
  return session.token ? { Authorization: `Bearer ${session.token}` } : {};
}

export function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const header = authHeader();
    let verb = method;
    // Mini programs cannot send PATCH; the server accepts this override instead.
    if (method === 'PATCH') {
      verb = 'POST';
      header['X-HTTP-Method-Override'] = 'PATCH';
    }
    if (data !== undefined) header['Content-Type'] = 'application/json';
    const hadToken = Boolean(session.token);
    uni.request({
      url: session.server + path,
      method: verb,
      data,
      header,
      timeout: 30000,
      success(res) {
        const body = res.data && typeof res.data === 'object' ? res.data : {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }
        if (res.statusCode === 401 && hadToken && !path.endsWith('/login')) onAuthExpired();
        reject(new ApiError(res.statusCode, body.error || `请求失败（${res.statusCode}）`));
      },
      fail() {
        reject(new ApiError(0, '网络连接失败，请检查网络和服务器地址'));
      },
    });
  });
}

export const get = (path) => request('GET', path);
export const post = (path, data = {}) => request('POST', path, data);
export const put = (path, data) => request('PUT', path, data);
export const patch = (path, data) => request('PATCH', path, data);
export const del = (path) => request('DELETE', path);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Uploads a local image (from uni.chooseImage) and resolves with its server path. */
export function uploadImage(filePath) {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${session.server}/api/uploads`,
      filePath,
      name: 'file',
      header: authHeader(),
      success(res) {
        let body = {};
        try {
          body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data || {};
        } catch {
          /* non-JSON error page */
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && body.url) resolve(body.url);
        else reject(new ApiError(res.statusCode, body.error || `上传失败（${res.statusCode}）`));
      },
      fail() {
        reject(new ApiError(0, '图片上传失败，请检查网络'));
      },
    });
  });
}

/** Shows an error from a failed request as a toast. */
export function showError(err) {
  uni.showToast({ title: (err && err.message) || '操作失败', icon: 'none', duration: 2500 });
}
