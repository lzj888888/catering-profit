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

module.exports = { buildBillList };
