// cloudfunctions/clearSalesBills/service.js —— 清除目标匹配（纯函数 · 零 db）
//
// 🔴 R252：把「哪些行该被清除」抽成纯函数，守卫可独立复算（不 require wx-server-sdk）。
//   形态解析必须走**单源** `common/salesBillId.js::parseSalesBillId`（本文件由 sync_common
//   派生为 `common.js`，故 require('./common')）—— 与 `getSalesBills` 同一口径。
//   两侧分叉 ⇒ 「列表里看得见、清除时删不掉」（**静默失效**，R252 冒烟已实测到同族 bug）。
const { parseSalesBillId } = require('./cx_salesBillId');

/**
 * 从行集合里挑出命中 targets 的行。
 *
 * 匹配语义（三条，缺一即错）：
 *   · `all:true`            ⇒ 全部命中（未软删的行）
 *   · `kind` 指定（bill/dish）⇒ 仅该形态命中
 *   · `kind` 缺省            ⇒ **两种形态都命中**（用户说「清掉淘宝 10-08」时，
 *                              账单级与菜品级应当一起清 —— 否则留下"半条"更难解释）
 *
 * @param {Array<object>} rows `external_sales_daily` 行（调用方应已滤掉 is_deleted:true）
 * @param {Array<{platform,biz_date,kind?}>} targets
 * @param {object} [opts] { all?:boolean }
 * @returns {{hits:Array<{_id:string,platform:string,biz_date:string,kind:string}>}}
 */
function matchTargets(rows, targets, opts) {
  const o = opts || {};
  const all = !!o.all;
  const list = targets || [];

  // 预构匹配表：**kind 缺省 ⇒ 展开成两种形态**（别在循环里现推，易错）
  const want = new Set();
  list.forEach((t) => {
    const kinds = t.kind ? [t.kind] : ['bill', 'dish'];
    kinds.forEach((k) => want.add(k + '|' + t.platform + '|' + t.biz_date));
  });

  const hits = [];
  (rows || []).forEach((r) => {
    if (!r) return;
    const id = r._id != null ? r._id : r.id;
    if (!id) return;
    const meta = parseSalesBillId(id);
    if (meta.kind === 'unknown') return;      // 形态认不出 ⇒ **不误删**（fail-closed）

    const hit = all || want.has(meta.kind + '|' + meta.platform + '|' + meta.bizDate);
    if (hit) hits.push({ _id: id, platform: meta.platform, biz_date: meta.bizDate, kind: meta.kind });
  });

  return { hits };
}

module.exports = { matchTargets };
