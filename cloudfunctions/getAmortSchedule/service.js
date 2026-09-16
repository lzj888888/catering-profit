// cloudfunctions/getAmortSchedule/service.js —— 内嵌批次 2 calcAmortize 摊销引擎（与 calcAmortize/service.js 同源）。
// 供摊销资产管理页展示当月摊销合计 / 末月尾差倒挤（S3：装修末月 3,333.45）。
const { ERROR_CODES } = require('./common');

function monthIndex(ym) { const [y, m] = String(ym || '').split('-').map(Number); return y * 12 + (m - 1); }
function fmtMonthIdx(idx) { const y = Math.floor(idx / 12), m = idx % 12; return `${y}-${String(m + 1).padStart(2, '0')}`; }

// 单资产某月摊销（分整数；区间外=0；到期末月尾差倒挤；提前终止末月仍按 base）
function amountForMonth(asset, month) {
  const start = monthIndex(asset.start_month);
  const naturalEnd = start + asset.total_months - 1;
  let end = naturalEnd;
  if (asset.terminate_month) { const t = monthIndex(asset.terminate_month); if (t < naturalEnd) end = t; }
  const mi = monthIndex(month);
  if (mi < start || mi > end) return 0;
  const k = mi - start + 1, N = end - start + 1;
  const base = asset.total_months > 0 ? Math.round(asset.total_value / asset.total_months) : 0;
  if (k < N) return base;
  if (end === naturalEnd) return asset.total_value - base * (N - 1);
  return base;
}

// 当月摊销总费用 + 各资产明细
function amortizeForMonth(assets, month) {
  const total = (assets || []).reduce((s, a) => s + amountForMonth(a, month), 0);
  const details = (assets || []).map((a) => ({
    asset_id: a.asset_id, name: a.name,
    amount_fen: amountForMonth(a, month),
    in_period: amountForMonth(a, month) !== 0,
  }));
  return { total_amount_fen: total, details };
}

module.exports = { amortizeForMonth, amountForMonth, fmtMonthIdx, monthIndex, ERROR_CODES };