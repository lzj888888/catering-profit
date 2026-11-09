// utils/lossSummary.js —— 月底「这个月卖了 N 道菜，M 道在亏」的唯一算法（R661 · M3 Phase 2b）
//
// 为什么单独抽出来：
//   ① 口径必须**可测**。写在页面方法里只能靠 grep 字符串，测不到「N=2 到底出不出句」。
//   ② 它有三个"边界决定成败"的规则，全都容易被后来人改错：
//      · 亏 = 负毛利（`marginAlert.isLossMaking` 单源）—— 0% 保本、未定价都**不算亏**；
//      · N < 3 不出句 —— 两道菜里一道亏就下结论，老板会反问"就两道也算？"，反而不可信；
//      · 截断就不出 —— 宁可不说，也不能用半份数据给结论。
//
// ⚠️ 本函数**只算与拼句，不取数**（取数在页面 loadLossSummary）。

const M = require('./marginAlert.js');
const { TERMS } = require('../miniprogram/i18n/terms.js');

const MIN_SAMPLE = 3;   // 样本下界：<3 道不出句

/**
 * @param {Array} rows  getDishReview 的 `dine_in`（每条含 marginPct）
 * @param {boolean} truncated  数据是否被截断
 * @returns {{n:number, m:number, text:string, hasLoss:boolean}}
 */
function buildLossSummary(rows, truncated) {
  const list = Array.isArray(rows) ? rows : [];
  const n = list.length;
  // 口径单源：这里**绝不**自己写 `marginPct < 0`（那等于在本文件定义第二套"什么算亏"）
  const m = list.filter((x) => M.isLossMaking(x.marginPct)).length;

  if (truncated) return { n, m, text: '', hasLoss: false };
  if (n < MIN_SAMPLE) return { n, m, text: '', hasLoss: false };

  const text = m > 0 ? TERMS.resultPage.lossSummary(n, m) : TERMS.resultPage.lossSummaryOk(n);
  return { n, m, text, hasLoss: m > 0 };
}

module.exports = { buildLossSummary, MIN_SAMPLE };
