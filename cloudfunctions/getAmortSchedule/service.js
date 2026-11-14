// cloudfunctions/getAmortSchedule/service.js —— 内嵌批次 2 calcAmortize 摊销引擎（与 calcAmortize/service.js 同源）。
// 供摊销资产管理页展示当月摊销合计 / 末月尾差倒挤（S3：装修末月 3,333.45）。
const { ERROR_CODES } = require('./common');

function monthIndex(ym) { const [y, m] = String(ym || '').split('-').map(Number); return y * 12 + (m - 1); }
function fmtMonthIdx(idx) { const y = Math.floor(idx / 12), m = idx % 12; return `${y}-${String(m + 1).padStart(2, '0')}`; }

// ===== R735：归档月回读必须用「落库时的开关快照」 =====
// 🔴 **与 `cloudfunctions/getLedger/service.js::resolveArchiveSwitches` 逐字同源**
//   （守卫 `tools/check_amort_switch_matrix.js` C-⑥ 钉死两份正文一致，漂移即红）。
//   为什么不能只放一份：微信云开发每个云函数**独立打包**，跨函数 require 在云端 MODULE_NOT_FOUND
//   （见 tools/sync_common.js 头部实测记录）⇒ 现阶段只能是「同源双副本 + 守卫」。
//   将来若把开关口径收进 cloudfunctions/common/ 单源派生，请一并删除本副本并改守卫为单源断言。
//
// 起因（R735 摊销页真机反馈的连带审计）：摊销页读的是**实时** shop_switch，而结果页/月报列表
//   经 getLedger 读的是**归档快照**。归档后改开关 ⇒ 同一月份，摊销页说「未扣」、结果页说「扣了」。
// 口径（与 getLedger 完全一致，不许各立一套）：
//   · 归档月 + 快照完整 ⇒ 用快照（source='snapshot'）—— 归档=只读，含「算它用的参数」
//   · 未归档月           ⇒ 用实时（source='live'）—— 开关改了应立刻看到效果
//   · 归档月但快照缺失/残缺 ⇒ 回落实时（source='live_no_snapshot'，唯一 fail-open，有据）
function resolveArchiveSwitches(input) {
  const inp = input || {};
  const LIVE = {
    inventorySwitchOn: !!inp.liveInventorySwitchOn,
    amortizeSwitchOn: !!inp.liveAmortizeSwitchOn,
  };
  if (!inp.isArchive) return Object.assign({ source: 'live' }, LIVE);
  const su = inp.switchUsed;
  const complete = !!su && typeof su === 'object'
    && typeof su.inventorySwitchOn === 'boolean'
    && typeof su.amortizeSwitchOn === 'boolean';
  if (!complete) return Object.assign({ source: 'live_no_snapshot' }, LIVE);
  return {
    inventorySwitchOn: su.inventorySwitchOn,
    amortizeSwitchOn: su.amortizeSwitchOn,
    source: 'snapshot',
  };
}

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

module.exports = { amortizeForMonth, amountForMonth, resolveArchiveSwitches, fmtMonthIdx, monthIndex, ERROR_CODES };