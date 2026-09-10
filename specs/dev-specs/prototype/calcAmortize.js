/**
 * POC1 · 摊销边界与尾差残值（Node 验证原型）
 *
 * 依据：specs/dev-specs/poc/POC1_摊销边界与尾差残值.md
 * 严格实现：月摊销=round(原值/总月数) / 末月尾差倒挤 / 两端含 / 提前终止残值
 * 金额内部一律用「分」(整数) 计算，展示 ÷100。
 *
 * 本文件是「本机验证锚点」原型，证明算法 100% 命中 POC1 验收锚点。
 * 最终以 inscode 生成的云函数版本 + GitHub 同步为准，本文件可作参考基线。
 */

function toFen(yuan) { return Math.round(yuan * 100); }
function toYuan(fen) { return fen / 100; }

// "YYYY-MM" -> 绝对月份序号（便于加减运算）
function parseMonth(str) {
  const [y, m] = str.split('-').map(Number);
  return y * 12 + (m - 1);
}
function fmtMonth(idx) {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

// 计算实际摊销区间 [start, end]，两端都含
function getRange(asset) {
  const start = parseMonth(asset.startMonth);
  const naturalEnd = start + asset.totalMonths - 1; // 自然到期月
  let end = naturalEnd;
  if (asset.terminateMonth) {
    const term = parseMonth(asset.terminateMonth);
    if (term < naturalEnd) end = term; // 提前终止
  }
  return { start, end, naturalEnd };
}

// 返回指定年月的摊销额（单位：分）
function calcAmortizeFen(asset, month) {
  const { start, end, naturalEnd } = getRange(asset);
  const mi = parseMonth(month);
  if (mi < start || mi > end) return 0; // 区间外 = 0
  const k = mi - start + 1;          // 第几期 (1-based)
  const N = end - start + 1;         // 实际总期数
  const base = Math.round(asset.valueFen / asset.totalMonths); // 月摊销(分)
  if (k === N) {
    // 末月
    if (end === naturalEnd) {
      // 自然到期末月：尾差倒挤，保证 N 期总和严格等于原值
      return asset.valueFen - base * (N - 1);
    } else {
      // 提前终止末月：仍是 base（剩余未摊余额作为残值单独计，不摊进最后一期）
      return base;
    }
  }
  return base;
}

function calcAmortize(asset, month) {
  return toYuan(calcAmortizeFen(asset, month));
}

// 残值（提前终止时 = 原值 - 已摊合计；自然到期 = 0），返回分
function calcResidualFen(asset) {
  const { start, end } = getRange(asset);
  if (end >= start + asset.totalMonths - 1) return 0; // 自然到期无残值
  let sum = 0;
  for (let mi = start; mi <= end; mi++) sum += calcAmortizeFen(asset, fmtMonth(mi));
  return asset.valueFen - sum;
}

// 逐月摊销表
function calcAmortizeSchedule(asset) {
  const { start, end } = getRange(asset);
  const rows = [];
  let sum = 0;
  for (let mi = start; mi <= end; mi++) {
    const amt = calcAmortizeFen(asset, fmtMonth(mi));
    sum += amt;
    rows.push({ month: fmtMonth(mi), amountYuan: toYuan(amt) });
  }
  return {
    rows,
    totalAmortizedYuan: toYuan(sum),
    residualYuan: toYuan(calcResidualFen(asset)),
  };
}

module.exports = { calcAmortize, calcAmortizeFen, calcAmortizeSchedule, calcResidualFen, parseMonth, fmtMonth, getRange };
