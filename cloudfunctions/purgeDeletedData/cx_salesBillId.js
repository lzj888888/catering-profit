// cloudfunctions/common/salesBillId.js —— `external_sales_daily` 文档 `_id` 的形态解析（**单源**）
//
// 🔴 R252 立（为什么必须单源）：
//   写入侧的 `_id` 构造在 `importSalesBill/service.js::saleDocId` 与 `index.js:109`（BILL_ 直接拼）；
//   读取侧（`getSalesBills`）与清除侧（`clearSalesBills`）都要**反向解析**出 (kind, platform, bizDate)。
//   若两侧各写一份解析 ⇒ 任一侧改规则 ⇒ 出现「列表里看得见、清除时删不掉」（**静默失效**，
//   与 R232 C-9/C-10 同族：口径分叉 + 环上零守卫）。
//
// 形态（与写入侧一一对应）：
//   BILL_<shop_id>_<platform>_<bizDate>        —— 账单级（外卖账单合计，dish_key=''）
//   SALE_<shop_id>_<platform>_<bizDate>_<seq>  —— 菜品级（堂食形态A / 外卖形态C）
//
// 🔴🔴 平台名**含下划线**（`jd_order` / `jd_sku`）⇒ **不能**用 `lastIndexOf('_')` 或 `split('_')`
//   盲切 —— 实测（R252 冒烟）：`BILL_..._jd_order_2026-10-08` 用 rightmost-`_` 取平台会得到
//   **`order`**（平台名被切掉前半），⇒ 列表里显示成不存在的平台、清除时**匹配不到目标**
//   （看得见删不掉，正是本单源要防的那类静默失效）。
//   ✅ 正解 = **按已知平台枚举做前缀匹配**（最长优先，`jd_order` 先于 `jd` 试），枚举取自
//      `importSalesBill/service.js:314` 的 `SALES_SCHEMA.platform.enum`（平台单源）。
//
// ⚠️ 解析必须**从两端夹取**：`shop_id` 形如 `shop_mu6j87v1itrs` **自身含 `_`** ⇒
//    只有首段（前缀）与末两段（bizDate[/seq]）位置确定，中间的 shop/platform 边界靠
//    「已知平台名」+ `bizDate` 形状共同兜住。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 平台枚举（与 `importSalesBill/service.js::SALES_SCHEMA.platform.enum` 同源；最长优先匹配）
const KNOWN_PLATFORMS = ['taobao', 'meituan', 'jd_order', 'jd_sku', 'eleme', 'pos', 'other'];
const PLATFORM_BY_LEN = KNOWN_PLATFORMS.slice().sort((a, b) => b.length - a.length);

/**
 * 从 `<shop>_<platform>_<bizDate>` 里切出 platform（已知枚举前缀匹配，最长优先）。
 * @param {string} head
 * @returns {string} 命中的平台名；认不出 ⇒ ''
 */
function pickPlatform(head) {
  for (const p of PLATFORM_BY_LEN) {
    if (head === p || head.endsWith('_' + p)) return p;
  }
  return '';
}

/**
 * 解析 `external_sales_daily` 的 `_id`。
 * @param {string} id
 * @returns {{kind:'bill'|'dish'|'unknown', platform:string, bizDate:string}}
 */
function parseSalesBillId(id) {
  const s = String(id == null ? '' : id);

  if (s.indexOf('BILL_') === 0) {
    const rest = s.slice(5);                 // <shop>_<platform>_<bizDate>
    const i = rest.lastIndexOf('_');
    if (i <= 0) return unknown();
    const bizDate = rest.slice(i + 1);
    if (!DATE_RE.test(bizDate)) return unknown();
    const platform = pickPlatform(rest.slice(0, i));   // = <shop>_<platform>
    if (!platform) return unknown();
    return { kind: 'bill', platform, bizDate };
  }

  if (s.indexOf('SALE_') === 0) {
    const rest = s.slice(5);                 // <shop>_<platform>_<bizDate>_<seq>
    const parts = rest.split('_');
    if (parts.length < 4) return unknown();
    const seq = parts[parts.length - 1];
    const bizDate = parts[parts.length - 2];
    if (!/^\d+$/.test(seq)) return unknown();
    if (!DATE_RE.test(bizDate)) return unknown();
    // platform 段 = 去掉首段(shop)与末两段(bizDate/seq)后剩下的（可能含 '_'，如 jd_order）
    const mid = parts.slice(1, parts.length - 2).join('_');
    const platform = pickPlatform(mid);
    if (!platform) return unknown();
    return { kind: 'dish', platform, bizDate };
  }

  return unknown();
}

function unknown() { return { kind: 'unknown', platform: '', bizDate: '' }; }

module.exports = { parseSalesBillId, DATE_RE, KNOWN_PLATFORMS, pickPlatform };
