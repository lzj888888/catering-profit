// cloudfunctions/calcAmortize/service.js —— 批次 2 · POC1 摊销边界与尾差残值（Service 层纯计算）
//
// ⚠️ 分层铁律：本文件是「纯函数」，只做计算，绝不：
//   · require('wx-server-sdk') / 触碰数据库（批次 0 约定 Service 层禁止引入云开发 SDK）
//   · 接触前端请求对象
// 输入必须是 Controller 校验、清洗、read 好台账之后的「干净数据」（asset 数组 + 目标月）。
//
// 口径（对应 specs/core/开发规范v1.0_ModuleM1 §M1.2 摊销直线法，锚点见任务书 §5）：
//   1) 月摊销额 = round(原值 ÷ 总月数) —— 在「分」层面即 Math.round(total_value / total_months)
//   2) 末月摊销额 = 原值 − 前(N−1)期合计 —— 尾差倒挤，保证 N 期总和严格 === 原值
//      ⚠️ 仅「自然到期的末月」倒挤；「提前终止的末月」仍用 base（未摊余额作为残值单独计，见规则 5）
//   3) 实际摊销区间 = [摊销开始月, 截止月]，两端都含
//   4) 四条推论：开始当月即摊 / 终止当月仍摊 / 到期当月仍摊 / 次月起停止
//   5) 提前终止：未摊余额 = 原值 − 已摊合计，作为处置/报废损失一次性计入当期，不继续摊
//   6) 区间外月份摊销额 = 0
//   7) 多资产并行：每个资产独立计算末月尾差倒挤，绝不合并多个资产后统一算总尾差。
//   8) 软删资产由 DataAdapter 层过滤（is_deleted=false），Service 无需关心。
//
// ⏱️ 时间工具复用（强约束）：月份增减 / 月份区间一律经批次 0 utilTime.monthAnchor + toMonth
//    往返 —— 二者均以 UTC 为准（monthAnchor=UTC 月中 15 号 12:00 锚点；toMonth 用 UTC 字段输出
//    YYYY-MM）。本文件不引入任何自定义时区/格式/月中基准，确保与批次 0 全局一致。
//
// 金额一律「分」整数（INT）。返回结构含 total_amount（分）+ details（各资产明细），可直接喂给
// 批次 1 calcMonthlyProfit 的 amortizeFen 输入。

const { utilTime } = require('./common');         // 扁平分发副本（sync_common 生成），仅用纯函数工具
const { monthAnchor, toMonth } = utilTime;        // 批次 0 时间工具（UTC 口径）

// ===================== 月份工具（统一经批次 0 utilTime 往返） =====================

// "YYYY-MM" → 绝对月序号（year*12 + monthIndex0）。纯字符串结构解析，不涉时区。
function parseMonthIndex(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return y * 12 + (m - 1);
}

// 绝对月序号 → "YYYY-MM"。
// 关键：经批次 0 utilTime.monthAnchor 构造 UTC 月中锚点（monthIndex0 即 month-1），
//      再用 utilTime.toMonth 输出（toMonth 用 getUTCFullYear/getUTCMonth 取 UTC 字段）。
//      这样月份算术的返回与批次 0 的时间口径在时区、格式、月中基准时刻上**完全一致**。
function formatMonthIndex(idx) {
  const y = Math.floor(idx / 12);
  const mIndex = idx % 12;
  const anchor = monthAnchor(y, mIndex); // 批次 0 锚点：UTC 当年当月 15 号 12:00
  return toMonth(anchor);                // 批次 0 输出：YYYY-MM（UTC 字段）
}

// 月份增减：一律经批次 0 锚点往返，禁止自造月份加法。
function addMonths(ym, delta) {
  return formatMonthIndex(parseMonthIndex(ym) + delta);
}

// ===================== 区间 =====================

// 实际摊销区间 [start, end]（绝对月序号），两端都含。
// 截止月 = 若设了「终止年月」且早于自然到期 → 取终止年月；否则 = 摊销开始月 + 总月数 − 1（自然到期月）。
function getRangeIndex(asset) {
  const start = parseMonthIndex(asset.start_month);
  const naturalEnd = start + asset.total_months - 1; // 自然到期月
  let end = naturalEnd;
  if (asset.terminate_month) {
    const t = parseMonthIndex(asset.terminate_month);
    if (t < naturalEnd) end = t; // 提前终止（不晚于自然到期的终止不改变区间；起止仍含两端）
  }
  return { start, end, naturalEnd };
}

// ===================== 单资产单月摊销 =====================

// 月摊销额（分，整数）= round(原值 ÷ 总月数)。原值/总月数均为正整数分/正整数。
function baseMonthlyFen(asset) {
  return Math.round(asset.total_value / asset.total_months);
}

/**
 * 单资产在指定年月的摊销额（分，整数）。
 * @param {object} asset 干净资产 { total_value(分), start_month, total_months, terminate_month }（由 Controller 读台账映射）
 * @param {string} month YYYY-MM
 * @returns {number} 摊销额分（区间外 = 0）
 *
 * ⚠️ 末月尾差倒挤是金额正确性的硬逻辑，绝不放在任何可控开关之后。
 *    变异回验（证明判据有鉴别力）改由 selftest 用「base×N ≠ 原值」对照完成，本文件不留测试钩子（R33）。
 */
function amountForMonthFen(asset, month) {
  const { start, end, naturalEnd } = getRangeIndex(asset);
  const mi = parseMonthIndex(month);
  if (mi < start || mi > end) return 0;   // 区间外 = 0（推论 ④ 次月停止等）
  const k = mi - start + 1;               // 第几期（1-based）
  const N = end - start + 1;              // 实际总期数
  const base = baseMonthlyFen(asset);
  if (k < N) return base;                 // 非末月：按 base
  // ===== 末月（k === N）=====
  if (end === naturalEnd) {
    // 自然到期的末月：【尾差倒挤】原值 − 前(N−1)期合计，保证 N 期总和严格 === 原值
    return asset.total_value - base * (N - 1);
  }
  // 提前终止的末月：仍按 base（未摊余额作为残值单独计，见 calcResidualFen，不把残值摊进末月）
  return base;
}

// ===================== 残值 / 已摊合计 =====================

// 已摊销合计（分）：start..end 逐期累加。用于「提前终止残值」与「已摊合计锚点」。
function amortizedTotalFen(asset) {
  const { start, end } = getRangeIndex(asset);
  let sum = 0;
  for (let mi = start; mi <= end; mi++) sum += amountForMonthFen(asset, formatMonthIndex(mi));
  return sum;
}

// 未摊余额残值（分）：原值 − 已摊合计。自然到期（end >= naturalEnd）→ 0。
function calcResidualFen(asset) {
  const { end, naturalEnd } = getRangeIndex(asset);
  if (end >= naturalEnd) return 0; // 自然到期无残值
  return asset.total_value - amortizedTotalFen(asset);
}

// ===================== 主入口（多资产并行） =====================

/**
 * 当月摊销总费用计算（Service 层纯函数）。
 * 多资产**逐个独立**算当月摊销 + 独立尾差倒挤，绝不合并资产后统一算总尾差（规则 7）。
 * @param {Array} assets 干净资产数组（Controller 读台账后映射，已经 DataAdapter 软删过滤）
 * @param {string} targetMonth YYYY-MM
 * @returns {{ total_amount:number, details:Array }} total_amount=当月摊销总费用(分整数)；
 *          details 每项 { asset_id, name, amount_fen, start_month, total_months, terminate_month,
 *                         in_period, residual_loss };
 *          total_amount 与 details[].amount_fen 的数值格式与批次 1「当月摊销总费用」输入直接对齐。
 */
function calcAmortize(assets, targetMonth) {
  const list = (assets && Array.isArray(assets)) ? assets : [];
  const details = [];
  let total = 0;
  for (const asset of list) {
    const amountFen = amountForMonthFen(asset, targetMonth);
    total += amountFen;
    details.push({
      asset_id: asset.asset_id,
      name: asset.name || '',
      amount_fen: amountFen,
      start_month: asset.start_month,
      total_months: asset.total_months,
      terminate_month: asset.terminate_month || '',
      in_period: amountFen !== 0,          // 目标月是否在该资产摊销区间内
      residual_loss: calcResidualFen(asset), // 提前终止时的未摊残值（处置损失）；自然到期=0
    });
  }
  return { total_amount: total, details };
}

// 逐月摊销表（自测/审计用）：start..end 逐期金额 + 总摊销 + 残值。
function calcAmortizeSchedule(asset) {
  const { start, end, naturalEnd } = getRangeIndex(asset);
  const rows = [];
  let sum = 0;
  for (let mi = start; mi <= end; mi++) {
    const m = formatMonthIndex(mi);
    const amount = amountForMonthFen(asset, m);
    sum += amount;
    rows.push({ month: m, amount_fen: amount });
  }
  return { rows, total_amortized_fen: sum, residual_fen: calcResidualFen(asset), ended_early: end < naturalEnd };
}

module.exports = {
  calcAmortize,
  calcAmortizeSchedule,
  amountForMonthFen,
  calcResidualFen,
  amortizedTotalFen,
  // 月份工具（导出供 selftest 核对）
  parseMonthIndex,
  formatMonthIndex,
  addMonths,
};