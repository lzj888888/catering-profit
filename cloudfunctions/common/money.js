// cloudfunctions/common/money.js
// 金额工具。铁律：金额一律「分」整数（INT），计算在云函数完成，前端传来结果一律丢弃。
const { ERROR_CODES } = require('./errors');

// 元 → 分（整数）。非数/非有限 → 抛 INVALID_PARAM。
function yuanToFen(yuan) {
  if (typeof yuan !== 'number' || !isFinite(yuan)) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: 'yuan must be a finite number' };
  }
  return Math.round(yuan * 100);
}

// 分 → 元（展示用）。必须整数分。
function fenToYuan(fen) {
  if (!Number.isInteger(fen)) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: 'fen must be integer' };
  }
  return fen / 100;
}

// 分到分（对齐生产精度：先四舍五入至分再反推毛利率/毛利，参见 core/14 精度纪律）
function fenRound(fen) {
  return Math.round(fen);
}

// 尾差倒挤：把分配后的零散分倒挤到最后一项，保证 sum(out) === totalFen。
// 用于多资产/多行摊销等"先整除再补差"的场景（见 POC1 尾差倒挤锚点）。
function tailDifference(allocation, totalFen) {
  const out = (allocation || []).slice();
  if (out.length === 0) return out;
  const sum = out.reduce((a, b) => a + (Number(b) || 0), 0);
  const diff = totalFen - sum;
  out[out.length - 1] += diff; // 尾差倒挤到最后一项
  return out;
}

module.exports = { yuanToFen, fenToYuan, fenRound, tailDifference };
