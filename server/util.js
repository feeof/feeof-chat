'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const badRequest = (message) => new HttpError(400, message);
const forbidden = (message = '无权执行此操作') => new HttpError(403, message);
const notFound = (message = '资源不存在') => new HttpError(404, message);
const conflict = (message) => new HttpError(409, message);

/** Validates an optional/required string field and returns it trimmed. */
function readString(value, { field, max = 200, min = 0, required = false, trim = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field}不能为空`);
    return undefined;
  }
  if (typeof value !== 'string') throw badRequest(`${field}格式不正确`);
  const result = trim ? value.trim() : value;
  if (required && !result) throw badRequest(`${field}不能为空`);
  if (result.length > max) throw badRequest(`${field}不能超过 ${max} 个字符`);
  if (result.length < min) throw badRequest(`${field}至少需要 ${min} 个字符`);
  return result;
}

function readInt(value, { field, min = -Infinity, max = Infinity, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field}不能为空`);
    return undefined;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw badRequest(`${field}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return num;
}

function readId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
}

/** Fixed-window in-memory rate limiter keyed by an arbitrary string. */
class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** Records a hit and returns false when the key is over its limit. */
  hit(key, now = Date.now()) {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  reset(key) {
    this.hits.delete(key);
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.hits) {
      if (now - entry.start >= this.windowMs) this.hits.delete(key);
    }
  }
}

module.exports = {
  HttpError,
  badRequest,
  forbidden,
  notFound,
  conflict,
  readString,
  readInt,
  readId,
  RateLimiter,
};
