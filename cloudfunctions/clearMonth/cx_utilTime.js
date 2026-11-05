// cloudfunctions/common/utilTime.js
// 服务端 UTC 时间工具（批次 0 §2.5）。⚠️ 禁止使用前端传入时间。
// 铁律：时间统一 Unix 毫秒 BIGINT / UTC；月份 YYYY-MM 字符串。

// 当前服务端 UTC 毫秒
function nowUtc() {
  return Date.now();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 月中固定锚点：用 UTC 中午 15 号，防时区/夏令时跳变（批次 0 §2.5 原意 new Date(year, month, 15, 12, 0, 0)）
function monthAnchor(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0, 15, 12, 0, 0));
}

// 任意 Date / 毫秒 → YYYY-MM（统一用 UTC 字段，避免月末边界跳变）
function toMonth(input) {
  const d = input == null ? new Date() : (typeof input === 'number' ? new Date(input) : input);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

module.exports = { nowUtc, toMonth, monthAnchor };
