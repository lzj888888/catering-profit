// utils/importSanity.js —— R303 · 形态 C（外卖商品销量）导入的「**一级校验**」（纯函数）
//
// 🔴 为什么立它（R300 §5.5 定案 / §6.2 分级校验设计）：
//   李老师 2026-10-17 口供「**京东、美团提供的表不准确**」⇒ 拿不准的底表会直接产出**看起来确定的**
//   单品毛利榜（本仓最高危害类：**静默错账**）。而「二级校验」（与 M1 该平台外卖营收对拍）**需要读 M1**，
//   与「M3 是独立模块」的前提冲突（见 §6.2：M1 那条腿是**可选加强项**，取不到就降级、不阻断）。
//   ⇒ 先把**一级校验**做扎实：**零外部依赖** —— 只用导入表自身就能自证的错。
//
// 一级校验能自证什么（每一条都是"这张表本身就不对"）：
//   ① **跨月**：表里出现多个月份 —— 复盘是按月看的，跨月表会把数据分到两个月，容易被误读成"某月少了"
//   ② **量级异常**：均价（金额 ÷ 销量）落在常识区间外 ⇒ 高度疑似"销量列与金额列被写反"
//   ③ **没有可用日期** / **销售额合计为 0**：有行但没数
//
// ⚠️ **故意不做"只覆盖 N 天不是整月"**（一开始想做的第一条）：导入是**按日落库**的，
//   导一周的数据**本来就是合法操作**；"把这个月只有 N 天数据"这件事**该在复盘时讲**，
//   而复盘页 R301 已经用 `range.days` + 期间标注讲清了（那里才有"目标月"这个概念）。
//   ⇒ 在导入侧判"不是整月"= 把合法的操作报成错误（假红），只会训练老板忽略提示。
//
// 🔴 纪律：本函数**只给结论、不改数、不阻断**（与 A.11.7 配平校验同一条：最坏结果只能是"多一句提示"）。
//   页面据此提示，导不导由老板决定（他可能**有意**只导一段）。
//
// 🔴 本层零中文：返回 `code` + 数值，人话在 terms 单源里（页面拼装）。

/** 常识均价区间（元）——超出即高度可疑。取值依据：外卖单品均价极少 < 1 元或 > 500 元。 */
const AVG_PRICE_MIN_YUAN = 1;
const AVG_PRICE_MAX_YUAN = 500;

/**
 * @param {object} p {
 *   groupDates:   Array<string>,  // 该表覆盖的营业日（'YYYY-MM-DD'）—— 传 `groups[].bizDate`
 *   totalQty:     number,         // 销量合计（份）
 *   totalAmountFen:number,        // 销售额合计（分）
 * }
 *   ⚠️ **不传 `months`**：形态 C 的云函数出参里没有 `months`（那是账单分支的字段）
 *   ⇒ 月份由本函数从 `groupDates` 前 7 位**自己派生**（少一个可能传错/传漏的入参）。
 * @returns {Array<{code:string, value:number, unit:string}>} 空数组 = 一级校验没发现问题
 */
function checkImportShape(p) {
  const o = p || {};
  const out = [];
  const dates = Array.isArray(o.groupDates) ? o.groupDates.filter((d) => !!d) : [];
  const months = Array.from(new Set(dates.map((d) => String(d).slice(0, 7)))).filter((m) => !!m);
  const qty = Number(o.totalQty) || 0;
  const amountFen = Number(o.totalAmountFen) || 0;

  // ① 没有可用日期 ⇒ 这张表没解析出东西
  if (!dates.length) out.push({ code: 'noDays', value: 0, unit: '' });

  // ② 跨月（有月份信息时才判）
  if (months.length > 1) out.push({ code: 'crossMonth', value: months.length, unit: 'month' });

  // ③ 有行但金额全 0 —— 明显不对（不是"这个月没卖"这种合法 0）
  if (dates.length && qty > 0 && amountFen === 0) out.push({ code: 'zeroTotal', value: 0, unit: '' });

  // ④ 量级：均价落在常识区间外。只报"均价是多少"，**不猜**是哪一列反了（页面给两种可能让人自己核）
  if (qty > 0 && amountFen > 0) {
    const avgYuan = amountFen / 100 / qty;
    if (avgYuan < AVG_PRICE_MIN_YUAN || avgYuan > AVG_PRICE_MAX_YUAN) {
      out.push({ code: 'oddAvgPrice', value: Math.round(avgYuan * 100) / 100, unit: 'yuan' });
    }
  }

  return out;
}

/**
 * 该表覆盖的天数（去重）。形态 C 的 `groups` 已按 `bizDate` 升序排（云函数保证），但**不去重**，
 * 所以这里显式去重 —— 否则同一天多条记录会被算成多天，"覆盖 N 天"这个数就是假的。
 * @param {Array<{bizDate:string}>} groups
 * @returns {Array<string>} 升序去重后的日期
 */
function coveredDates(groups) {
  const set = new Set();
  for (const g of (Array.isArray(groups) ? groups : [])) {
    const d = g && g.bizDate ? String(g.bizDate) : '';
    if (d) set.add(d);
  }
  return Array.from(set).sort();
}

module.exports = { checkImportShape, coveredDates, AVG_PRICE_MIN_YUAN, AVG_PRICE_MAX_YUAN };
