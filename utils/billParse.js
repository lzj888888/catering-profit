// utils/billParse.js —— 批次 F 阶段① 账单导入纯解析模块（零依赖 · 不落库 · 不碰云）
//
// 移植自已实证解析器 review/evidence/r163_waimai/parse_bill.py + r177_meituan/mt_check.py，
// 口径照 PLAN_2026-10-01 §四 / §四-bis，两个零误差锚点：
//   淘宝闪购 2026-08：156 行 / 到手 3779.65 元
//   美团 2026-08：全 97 行 / 外卖订单筛后 50 行 / 应收 1826.64 元
//
// 🔴 铁律（违反即返工）：
//   ① detectPlatform 按**列名**判定，禁止看文件名；判据 = 签名列全中 + 排除列全不中（P1/R245）。
//   ② 美团「账单金额」≠ 外卖收入：必须按「交易类型==外卖订单」筛行（不筛=1747.95 错值）。
//      京东同理：必须按「订单类型==正向订单」筛行（不筛=482.65，那是扣完推广费/保险的净打款额）。
//   ③ 不许按「订单状态」筛（广告/保险行的状态同样写「订单完成/已处理/取消」）。
//   ④ 行键不能用「订单号」（同一单号会重复出现在外卖/广告/保险行）。
//   ⑤ 复合列×拆分列只取一组（到手/收入直接取净额列「结算金额」「商家应收款」「应结金额」）。
//   ⑥ 归月按账单日期/账期（不取结算日）；有效订单不含退单；qty 绝不进金额计算。
//   ⑦ 金额全部转「分」（round 到整数）。
//
// 🔴 P2~P6（R245）：京东秒送两形态接入（档案驱动，计算引擎零改动）：
//   jd_order 两级表头（R1 分组 / R2 真列名）· jd_sku 长表（一行一费项，订单数按单号去重）
//   两形态 sheet 名都不固定 ⇒ 改按**表头签名找 sheet**（不再硬编码表名）。

// 字符串 → 数值（去逗号/¥/￥；括号负数；空/-/-- → null）。移植 parse_bill.py::to_num。
function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').replace(/¥/g, '').replace(/￥/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  let neg = false, t = s;
  if (t.startsWith('(') && t.endsWith(')')) { neg = true; t = t.slice(1, -1); }
  const n = parseFloat(t);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

// ---- 平台档案（🔴 单源：识别条件 + 列名 + 筛选/计数规则，都只在这里写一次）----
const C_BILL_DATE  = '账单日期';
const C_TAOBAO_NET = '结算金额';
const C_MEITUAN_NET = '商家应收款';
const C_JD_ORDER_NET = '应结金额';
const C_JD_BIZ_TYPE  = '对账单业务类型';
const C_JD_ACCT      = '账期';         // 订单级：区间串 `20260901 00:00~20260901 00:00`
const C_JD_ACCT_TIME = '账期时间';     // SKU 级：`2026-09-01 00:00:00`
const C_JD_SKU_ORDER = '到家业务单号';
// 京东独有列：任一命中即排除淘宝/美团（🔴 加严判据前必须先确认它不在对方真表头里，见 selftest）
const JD_ONLY_COLS = [C_JD_ORDER_NET, C_JD_BIZ_TYPE, 'sku名称', '费用类型'];

const PLATFORM_PROFILE = {
  taobao: {
    sheet: '外卖账单明细',
    require: [C_BILL_DATE, C_TAOBAO_NET],   // 签名列：全部命中才算
    deny: JD_ONLY_COLS,                     // 排除列：命中任一即否决（防京东串味）
    billDate: C_BILL_DATE, net: C_TAOBAO_NET,
    orderType: '订单类型', refund: '退单',
    rowFilter: null,                        // 淘宝退单冲减，整表取
    qtyRule: 'perRow_exceptRefund',
    excludeLabel: '退单',
  },
  meituan: {
    sheet: '订单明细',
    require: [C_BILL_DATE, C_MEITUAN_NET],
    deny: [],
    billDate: C_BILL_DATE, net: C_MEITUAN_NET,
    bizType: '交易类型', order: '外卖订单',
    rowFilter: { col: '交易类型', eq: '外卖订单' },   // 🔴 不筛 = 1747.95 错值
    qtyRule: 'perRow',
    excludeLabel: '非外卖订单（广告/保险）',
  },
  // 京东秒送 · 订单级（两级表头；收入口径 = 正向订单，推广费/保险为另外的扣减行）
  jd_order: {
    sheet: null,                            // 🔴 表名不固定 ⇒ 按签名找
    require: [C_JD_ORDER_NET, C_JD_BIZ_TYPE],
    deny: [],
    billDate: C_JD_ACCT, net: C_JD_ORDER_NET,
    dateRule: 'acctRange',
    rowFilter: { col: '订单类型', eq: '正向订单' },
    qtyRule: 'perOrderNo',
    orderKey: '主订单号',
    excludeLabel: '非正向订单（推广费/保险单）',
  },
  // 京东秒送 · SKU 级（长表：一行一费项）
  jd_sku: {
    sheet: 'sku对账单下载',
    require: [C_TAOBAO_NET, 'sku名称', '费用类型'],   // ⚠️「结算金额」与淘宝同名，靠 deny 分家
    deny: [C_BILL_DATE],                             // 🔴 SKU 表无「账单日期」列
    billDate: C_JD_ACCT_TIME, net: C_TAOBAO_NET,
    dateRule: 'datetime',
    rowFilter: null,                                 // 长表全额计入（负值 = 扣项）
    qtyRule: 'perOrderNo',
    orderKey: C_JD_SKU_ORDER,
    excludeLabel: '',
  },
};
// 判定顺序：先淘宝后美团（沿用原语义），再京东两形态；全不中返回 null = fail-closed
const PLATFORM_ORDER = ['taobao', 'meituan', 'jd_order', 'jd_sku'];

// 🔴 R247：原此处的 `COL` / `SHEET` 两个映射表在 R245 平台档案化后**已零引用**
//   （sheet 名与列名全部收进 `PLATFORM_PROFILE[]`，`detectPlatform` / `pickSheet` 直接读档案）
//   ⇒ 作为残骸删除（与云函数副本 cloudfunctions/importSalesBill/service.js 同步）。

/**
 * 按表头列名判定平台。🔴 只看列名、不看文件名。
 * 判据 = 签名列（require）全中 且 排除列（deny）全不中；全不中返回 null（fail-closed）。
 * @param {string[]} header 表头（列名数组）
 * @returns {'taobao'|'meituan'|'jd_order'|'jd_sku'|null}
 */
function detectPlatform(header) {
  if (!Array.isArray(header)) return null;
  const cols = header.filter(Boolean).map((s) => String(s).trim());
  const has = (n) => cols.indexOf(n) >= 0;
  for (const p of PLATFORM_ORDER) {
    const prof = PLATFORM_PROFILE[p];
    if (!(prof.require || []).every(has)) continue;      // 签名列未全中
    if ((prof.deny || []).some(has)) continue;           // 命中任一排除列
    return p;
  }
  return null;
}

// 行 → 去空 trim 的列名数组
function rowCols(row) {
  return (row || []).map((v) => (v == null ? '' : String(v).trim()));
}

/**
 * 平台判定（**逐候选行试签名**）—— R250：修「两级表头 ⇒ 自动判定返 null」。
 *
 * 🔴 为什么不能写成 `detectPlatform(rows[guessHeader(rows)])`：
 *    京东《对账单下载》（订单级）是两级表头，R1 = 合并的组表头（"商家基础信息" × 5 /
 *    "订单基础信息" × 77，导出**逐格写满**），R2 = 真列名。两者非空文本格数都是 82 ⇒ 打平
 *    ⇒ guessHeader 的启发式（文本最多 + 严格大于 + 先到先得）取到 R1 ⇒ detectPlatform(R1)=null
 *    ⇒ **一张有 117 行数据的表被判「无法识别账单平台」**（fail-closed 误杀真数据）。
 *    （guessHeader 的注释早已写明"京东订单级 R1 是分组行"，但那只在**传入 platform** 时生效；
 *      自动判定这条路上 platform 还没有 ⇒ 走的正是纯启发式 ⇒ 盲区。）
 * ⇒ 平台判定**不该依赖"哪一行最像表头"**，直接前 5 行逐行试签名，与 pickSheet 的扫描口径一致。
 *
 * @param {Array<Array>} rows 定宽矩阵（行 = 数组）
 * @param {number} [limit] 候选行数上限（默认 5）
 * @returns {{platform:string, headerRow:number}|null}
 */
function detectPlatformInRows(rows, limit) {
  const list = rows || [];
  const n = Math.min(list.length, limit == null ? 5 : limit);
  for (let i = 0; i < n; i++) {
    const p = detectPlatform(list[i] || []);
    if (p) return { platform: p, headerRow: i };
  }
  return null;
}

// 矩阵级入口（与云端 service.js 同源）：逐 sheet、每 sheet 逐候选行试签名。
function detectPlatformInMatrix(matrix) {
  const sheets = (matrix && matrix.sheets) || {};
  for (const name of Object.keys(sheets)) {
    const hit = detectPlatformInRows((sheets[name] || {}).rows);
    if (hit) return { platform: hit.platform, headerRow: hit.headerRow, sheet: name };
  }
  return null;
}

/**
 * 表头行 = 前 5 行里「非空文本格最多」的那一行（移植 parse_bill.py::guess_header）。
 * 🔴 P3：给了 platform 时**优先用档案签名**定位（require 全中的第一行）——
 *    京东订单级 R1 是分组行、R2 才是真列名，纯启发式会在其中挑错。
 * @param {Array<Array>} rows 定宽矩阵（行 = 数组）
 * @param {string} [platform] 平台 key（可选）
 * @returns {number} 表头行下标（0-based）
 */
function guessHeader(rows, platform) {
  const list = rows || [];
  const prof = platform ? PLATFORM_PROFILE[platform] : null;
  if (prof && prof.require) {
    const lim = Math.min(list.length, 5);
    for (let i = 0; i < lim; i++) {
      const cols = rowCols(list[i]);
      if (prof.require.every((c) => cols.indexOf(c) >= 0)) return i;
    }
  }
  let best = -1, bi = 0;
  const n = Math.min(list.length, 5);
  for (let i = 0; i < n; i++) {
    const row = rows[i] || [];
    let txt = 0;
    for (const v of row) if (v && toNum(v) === null) txt++;   // 非空且非纯数字 = 文本格
    if (txt > best) { best = txt; bi = i; }
  }
  return bi;
}

/**
 * 选 sheet。🔴 P4 —— 京东表名不固定（`com.jd.o2o.settlement.domain.dt` / `sku对账单下载`），
 * 沿用硬编码表名会「找不到 sheet ⇒ 静默 0 行」。
 * 顺序：① 档案固定表名（若命中）→ ② 按表头签名找 → ③ 兜底返回档案表名（保持原语义）。
 * @returns {string|undefined}
 */
function pickSheet(sheets, platform) {
  const prof = PLATFORM_PROFILE[platform];
  if (!prof) return undefined;
  const names = Object.keys(sheets || {});
  if (prof.sheet && names.indexOf(prof.sheet) >= 0) return prof.sheet;
  for (const n of names) {
    const rows = (sheets[n] && sheets[n].rows) || [];
    const hi = guessHeader(rows, platform);
    const cols = rowCols(rows[hi]);
    const has = (c) => cols.indexOf(c) >= 0;
    if ((prof.require || []).every(has) && !(prof.deny || []).some(has)) return n;
  }
  return prof.sheet;
}

/**
 * 日期归一 → `YYYY-MM-DD`。
 * 🔴 只对档案里声明了 dateRule 的平台生效 —— 淘宝/美团保持**原样透传**，避免改动既有口径。
 */
function normDate(raw, rule) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || !rule) return s;
  let m;
  if (rule === 'acctRange') {                      // 20260901 00:00~20260901 00:00
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
  }
  if (rule === 'compact8') {                       // 20260910
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
  }
  // datetime / date：2026-09-01 00:00:00 · 2026/9/1
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);           // 兜底紧凑
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

/**
 * 解析账单矩阵（fixture 的 matrix.json 结构：{ sheets: { 表名: { rows: [[...],...] } } }）。
 * 🔴 入参必须是**对象**（键 = 表名）—— 传 `{sheets:[...]}` 数组或裸二维数组恒得 0（R242e 实测）。
 * @param {object} matrix matrix.json 结构
 * @param {{platform:'taobao'|'meituan'|'jd_order'|'jd_sku'}} opts
 * @returns {{
 *   platform, sheet, headerRow, header,
 *   rows: Array<{bizDate:string, qty:number, amountFen:number}>,
 *   totals: {amountFen:number, qty:number, rowCount:number},
 *   months: string[], excluded: {rows:number, reason:string},
 * }}
 */
function parseBillMatrix(matrix, opts) {
  const platform = (opts && opts.platform) || null;
  const prof = PLATFORM_PROFILE[platform];
  const sheets = (matrix && matrix.sheets) || {};
  if (!prof) {
    return {
      platform, sheet: null, headerRow: -1, header: [], rows: [],
      totals: { amountFen: 0, qty: 0, rowCount: 0 }, months: [],
      excluded: { rows: 0, reason: '未知平台' },
    };
  }

  const sheetKey = pickSheet(sheets, platform);
  const sheet = sheets[sheetKey];
  const allRows = (sheet && sheet.rows) || [];
  const headerRow = guessHeader(allRows, platform);
  const header = rowCols(allRows[headerRow]);

  // 列名 → 下标
  const colIdx = {};
  header.forEach((h, i) => { if (h) colIdx[h] = i; });
  const at = (row, name) => (name == null ? undefined : row[colIdx[name]]);

  let excludedRows = 0;
  const rf = prof.rowFilter;
  const orders = [];
  const seenOrder = new Set();

  for (let i = headerRow + 1; i < allRows.length; i++) {
    const row = allRows[i] || [];
    // ⑤ 行过滤（档案驱动：美团=交易类型；京东订单级=订单类型==正向订单）
    if (rf) {
      const v = String(at(row, rf.col) == null ? '' : at(row, rf.col)).trim();
      if (rf.eq != null && v !== rf.eq) { excludedRows++; continue; }
      if (rf.ne != null && v === rf.ne) { excludedRows++; continue; }
    }
    const net = toNum(at(row, prof.net));
    if (net == null) continue;                              // 空净额行跳过
    const bizDate = normDate(at(row, prof.billDate), prof.dateRule);
    // ⑥ qty 规则
    let qty = 0;
    if (prof.qtyRule === 'perRow_exceptRefund') {
      const ot = String(at(row, prof.orderType) == null ? '' : at(row, prof.orderType)).trim();
      qty = (ot === prof.refund) ? 0 : 1;                   // 🔴 退单不算有效订单
    } else if (prof.qtyRule === 'perRow') {
      qty = 1;
    } else if (prof.qtyRule === 'perOrderNo') {             // 🔴 长表/多行单：按单号去重
      const key = String(at(row, prof.orderKey) == null ? '' : at(row, prof.orderKey)).trim();
      if (key && key !== '-' && seenOrder.has(key)) {
        qty = 0;
      } else {
        if (key && key !== '-') seenOrder.add(key);
        qty = 1;
      }
    }
    orders.push({ bizDate, qty, amountFen: Math.round(net * 100) });
  }

  // 按日期归组 → 日汇总
  const byDate = new Map();
  for (const o of orders) {
    const d = byDate.get(o.bizDate) || { bizDate: o.bizDate, qty: 0, amountFen: 0 };
    d.qty += o.qty;
    d.amountFen += o.amountFen;
    byDate.set(o.bizDate, d);
  }
  const rows = Array.from(byDate.values()).sort((a, b) => (a.bizDate < b.bizDate ? -1 : 1));

  const totals = {
    amountFen: rows.reduce((s, r) => s + r.amountFen, 0),
    qty: rows.reduce((s, r) => s + r.qty, 0),
    rowCount: orders.length,                                 // 计费行数（含退单行）
  };
  const months = Array.from(new Set(rows.map((r) => String(r.bizDate).slice(0, 7)))).sort();

  const excludedReason = excludedRows > 0 ? (prof.excludeLabel || '') : '';

  return { platform, sheet: sheetKey, headerRow, header, rows, totals, months,
           excluded: { rows: excludedRows, reason: excludedReason } };
}

module.exports = { detectPlatform, guessHeader, parseBillMatrix, toNum, normDate, pickSheet, PLATFORM_PROFILE,
  detectPlatformInRows, detectPlatformInMatrix };   // R250：平台判定逐行试签名（两级表头 / 自动判定路径）
