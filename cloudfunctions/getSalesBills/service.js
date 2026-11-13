// cloudfunctions/getSalesBills/service.js —— 已导入账单聚合（纯函数 · 零 db）
//
// 🔴 R252 立：本文件是「已导入账单列表」口径的**唯一算法层**，可被守卫独立 require 复算。
//   输入 = `external_sales_daily` 的原始行（含软删标记）；输出 = 按 `_id` 形态分组的可读记录。
//
// 口径（与 importSalesBill 的落库形态一一对应）：
//   · `BILL_<shop>_<platform>_<bizDate>`  ⇒ 账单级（外卖账单合计，`dish_key=''`，1 行 = 1 条记录）
//   · `SALE_<shop>_<platform>_<bizDate>_<seq>` ⇒ 菜品级（堂食形态A / 外卖形态C）
//     ⇒ 按 (kind, platform, biz_date) **聚合成 1 条**（row_count / qty / amount 求和）
//   ⇒ 用户看到的是「淘宝闪购 2026-10-08 · 51 道菜 · 118 份 · ¥1823.08」，不是 51 行原始数据。
//
// 🔴 为什么不逐行返回：`external_sales_daily` 是**流水表**（一表多天 + 一天多菜），
//   逐行返回在上限 20000 面前既占带宽又不可读；用户真正要回答的是
//   「**我导过哪几份、哪天、多少行**」——那是 (kind, platform, biz_date) 粒度的。
//
// 🔴 形态解析**必须**走单源 `common/salesBillId.js::parseSalesBillId`（本文件由 sync_common
//   派生为 `cx_salesBillId.js`）—— 与 clearSalesBills 共用同一口径（分叉 = 看得见删不掉）。
const { parseSalesBillId } = require('./cx_salesBillId');

/**
 * 聚合已导入账单。
 * @param {Array<object>} rows `external_sales_daily` 行（可含软删）
 * @param {object} [opts] { includeCleared?:boolean }
 * @returns {{list:Array, summary:object, unknownCount:number}}
 */
function buildBillList(rows, opts) {
  const o = opts || {};
  const includeCleared = !!o.includeCleared;
  const map = new Map();
  let unknownCount = 0;

  (rows || []).forEach((r) => {
    if (!r) return;
    const cleared = r.is_deleted === true;
    if (cleared && !includeCleared) return;
    const id = r._id != null ? r._id : r.id;
    const meta = parseSalesBillId(id);
    if (meta.kind === 'unknown') { unknownCount++; return; }

    const key = meta.kind + '|' + meta.platform + '|' + meta.bizDate;
    let g = map.get(key);
    if (!g) {
      g = {
        bill_id: id,
        kind: meta.kind,
        platform: meta.platform,
        biz_date: meta.bizDate,
        row_count: 0,
        qty: 0,
        amount_fen: 0,
        cleared: false,
        cleared_at: '',
      };
      map.set(key, g);
    }
    g.row_count += 1;
    g.qty += Number(r.qty) || 0;
    g.amount_fen += Number(r.amount) || 0;
    // 组内任一行被软删 ⇒ 该组标 cleared（并取最晚的 delete_at）
    if (cleared) {
      g.cleared = true;
      const at = r.delete_at || '';
      if (String(at) > String(g.cleared_at)) g.cleared_at = at;
    }
  });

  const list = [...map.values()].sort((a, b) => {
    if (a.biz_date !== b.biz_date) return a.biz_date < b.biz_date ? 1 : -1;  // 新日期在前
    if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1;
    return a.kind < b.kind ? -1 : 1;
  });

  const active = list.filter((x) => !x.cleared);
  const clearedList = list.filter((x) => x.cleared);
  const platforms = [...new Set(active.map((x) => x.platform))].sort();

  const summary = {
    active_bills: active.length,
    cleared_bills: clearedList.length,
    active_rows: active.reduce((s, x) => s + x.row_count, 0),
    active_qty: active.reduce((s, x) => s + x.qty, 0),
    active_amount_fen: active.reduce((s, x) => s + x.amount_fen, 0),
    platforms,
  };

  return { list, summary, unknownCount };
}

/**
 * R728 S1/S2：菜品级销量明细（供「按销量加权」的标准毛利率用）。
 *
 * 与 buildBillList 的分工：那条按 (kind, platform, biz_date) 聚合成「我导过哪几份」；
 *   这条按 dish_key 聚合成「每道菜卖了几份」—— 是**权重表**，不是给用户看的列表，
 *   所以不违背文件头「不逐行返回」（本函数返回的是聚合后的 map，不是 51 行原始流水）。
 *
 * 🔴 半开区间：只取 biz_date >= from && biz_date < to（to = 下月 01 号）。
 *   对账页月份 YYYY-MM 由调用方转成 from/to 两个 YYYY-MM-DD，服务层强制必传，
 *   缺参直接回 reason='missing_range' 且 qtyByDish 为空 —— 绝不退回「读全表」（R301 静默错数）。
 * 🔴 granularity：堂食《菜品销售统计》是**区间汇总表**（一行代表整段 7 天，biz_date 只是
 *   区间末日）。区间行必须 period_from/period_to 都落在 [from,to) 内才计入；
 *   跨月的区间行**排除并如实上报** interval_cross_month_rows，绝不静默归到某一边。
 * 🔴 qty 取整：schema 要求 integer，但真实 POS 有 3280.3（称重菜）。权重用**原值**不取整
 *   —— 加权是相对权重，取整反而引入偏差；只如实上报 fractional_qty_rows 供复核。
 * 🔴 不按 platform 去重：external_sales_daily 每行本就是独立销量行（_id 幂等），
 *   按 platform 分组反会丢跨平台销量。同一 dish_key 直接累加 qty（含负 qty 退货）。
 *
 * @param {Array<object>} rows external_sales_daily 原始行（含软删标记）
 * @param {object} opts { biz_date_from, biz_date_to, includeCleared? }
 * @returns {{qtyByDish:object, dish_count:number, total_qty:number, matched_rows:number,
 *            unmatched_rows:number, fractional_qty_rows:number, interval_rows:number,
 *            interval_cross_month_rows:number, reason:string}}
 */
function buildDishDetail(rows, opts) {
  const o = opts || {};
  const from = String(o.biz_date_from || '');
  const to = String(o.biz_date_to || '');
  const includeCleared = !!o.includeCleared;
  const out = {
    qtyByDish: {}, dish_count: 0, total_qty: 0, matched_rows: 0,
    unmatched_rows: 0, fractional_qty_rows: 0, interval_rows: 0,
    interval_cross_month_rows: 0, reason: '',
  };
  if (!from || !to || from >= to) { out.reason = 'missing_range'; return out; }

  for (const r of (rows || [])) {
    if (!r) continue;
    const cleared = r.is_deleted === true;
    if (cleared && !includeCleared) continue;

    const bd = String(r.biz_date || '');
    // 半开区间：>= 月初 且 < 下月 01
    if (!(bd >= from && bd < to)) continue;

    // 区间汇总行：两端都必须落在本月内，跨月则排除（绝不静默归边）
    if (r.granularity === 'interval') {
      out.interval_rows++;
      const pf = String(r.period_from || bd), pt = String(r.period_to || bd);
      if (!(pf >= from && pt < to)) { out.interval_cross_month_rows++; continue; }
    }

    const key = String(r.dish_key || '').trim();
    if (!key) { out.unmatched_rows++; continue; }  // 账单级行（dish_key=''）不计入菜品权重

    const q = Number(r.qty);
    if (!Number.isFinite(q)) { out.unmatched_rows++; continue; }
    if (!Number.isInteger(q)) out.fractional_qty_rows++;

    out.qtyByDish[key] = (out.qtyByDish[key] || 0) + q;
    out.total_qty += q;
    out.matched_rows++;
  }
  out.dish_count = Object.keys(out.qtyByDish).length;
  if (out.matched_rows === 0) out.reason = 'no_dish_rows';
  return out;
}

module.exports = { buildBillList, buildDishDetail };
