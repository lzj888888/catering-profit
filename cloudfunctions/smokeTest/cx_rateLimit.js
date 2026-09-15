// cloudfunctions/common/rateLimit.js
// 按 openid 维度限流（批次 0 §2.2.5）：写操作 60 次/分钟，超限返回 RATE_LIMITED。
const { ERROR_CODES } = require('./cx_errors');

const WINDOW_MS = 60 * 1000;
const MAX_WRITES = 60;

// store 由调用方注入（云环境可用云函数内存 / Redis；演示用内存 Map）
function makeRateLimiter(store) {
  const _store = store || new Map();
  return async function check(openid) {
    const now = Date.now();
    const arr = (_store.get(openid) || []).filter((t) => now - t < WINDOW_MS);
    arr.push(now);
    _store.set(openid, arr);
    if (arr.length > MAX_WRITES) {
      return { limited: true, code: ERROR_CODES.RATE_LIMITED };
    }
    return { limited: false };
  };
}

module.exports = { makeRateLimiter, WINDOW_MS, MAX_WRITES };
