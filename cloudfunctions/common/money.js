// cloudfunctions/common/money.js
// 金额工具。铁律：金额一律「分」整数（INT），计算在云函数完成，前端传来结果一律丢弃。
const { ERROR_CODES } = require('./errors');

// 元 → 分（整数）。非数/非有限 → 抛 INVALID_PARAM。
// 🔴 R298（B2）：**十进制安全**。原式 `Math.round(yuan * 100)` 在 IEEE754 下会因
//   「乘 100 后的二进制表示略小于十进制真值」而**少进 1 分** —— 实测三位小数全域 18 万点
//   错 1147 点（0.145→14 / 0.285→28 / 1.005→100 真值 101 …），方向恒为**偏小**。
//   两位小数（老板日常输入形态）穷举 100 万点原本就 0 错 ⇒ 本修法**对合法日常输入零漂移**。
//   `toFixed(10)` 只消掉 1e-13 量级的浮点噪声、不动真实半步 ⇒ x.xx5 恢复十进制语义。
//   ⚠️ 前端同源实现见 `utils/api.js::yuanToFen` —— 两份**必须同款**，否则两端算出的「分」不同。
//   伴侣守卫：tools/check_money_precision.js（A 组行为穷举 + B 组双副本等价）。
function yuanToFen(yuan) {
  if (typeof yuan !== 'number' || !isFinite(yuan)) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: 'yuan must be a finite number' };
  }
  return Math.round(Number((yuan * 100).toFixed(10)));
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
