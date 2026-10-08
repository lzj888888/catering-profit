// utils/billParse.js —— 批次 F 阶段① 账单导入纯解析模块（零依赖 · 不落库 · 不碰云）
//
// 移植自已实证解析器 review/evidence/r163_waimai/parse_bill.py + r177_meituan/mt_check.py，
// 口径照 PLAN_2026-10-01 §四 / §四-bis，两个零误差锚点：
//   淘宝闪购 2026-08：156 行 / 到手 3779.65 元
//   美团 2026-08：全 97 行 / 外卖订单筛后 50 行 / 应收 1826.64 元
//
// 🔴 铁律（违反即返工）：
//   ① detectPlatform 按**列名**判定，禁止看文件名。
//   ② 美团「账单金额」≠ 外卖收入：必须按「交易类型==外卖订单」筛行（不筛=1747.95 错值）。
//   ③ 不许按「订单状态」筛（广告/保险行的状态同样写「订单完成/已处理/取消」）。
//   ④ 行键不能用「订单号」（同一单号会重复出现在外卖/广告/保险行）。
//   ⑤ 复合列×拆分列只取一组（到手/收入直接取净额列「结算金额」「商家应收款」，不拆复合列）。
//   ⑥ 归月按账单日期（不取结算日）；有效订单不含退单；qty 绝不进金额计算。
//   ⑦ 金额全部转「分」（round 到整数）。

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

// ---- 平台档案（🔴 单源：平台识别条件 + 列名，两者都只在这里写一次）----
// 🔴 P1（R245）：识别从「单列特征」改为「签名列 require 全中 + 排除列 deny 全不中」。
//    原因：京东 SKU 级对账单第 11 列也叫「结算金额」（与淘宝同名）⇒ 单列判据把它误判成 taobao，
//    能走通并算出「qty 虚高、bizDate 全空」的错数（静默错账，比读不进来更危险）。
const C_BILL_DATE  = '账单日期';
const C_TAOBAO_NET = '结算金额';
const C_MEITUAN_NET = '商家应收款';
// 京东独有列：任一命中即排除淘宝/美团（🔴 加严判据必须先确认它不在对方真表头里，见 selftest）
const JD_ONLY_COLS = ['应结金额', '对账单业务类型', 'sku名称', '费用类型'];

const PLATFORM_PROFILE = {
  taobao: {
    sheet: '外卖账单明细',
    require: [C_BILL_DATE, C_TAOBAO_NET],   // 签名列：全部命中才算
    deny: JD_ONLY_COLS,                     // 排除列：命中任一即否决（防京东串味）
    billDate: C_BILL_DATE, net: C_TAOBAO_NET, orderType: '订单类型', refund: '退单',
  },
  meituan: {
    sheet: '订单明细',
    require: [C_BILL_DATE, C_MEITUAN_NET],
    deny: [],
    billDate: C_BILL_DATE, net: C_MEITUAN_NET, bizType: '交易类型', order: '外卖订单',
  },
};
// 判定顺序（沿用原「先淘宝后美团」语义；命中即返回，全不中返回 null = fail-closed）
const PLATFORM_ORDER = ['taobao', 'meituan'];

// 列名常量由档案派生（🔴 不重复写列名字面量）
const COL = {
  taobao: {
    billDate: PLATFORM_PROFILE.taobao.billDate, net: PLATFORM_PROFILE.taobao.net,
    orderType: PLATFORM_PROFILE.taobao.orderType, refund: PLATFORM_PROFILE.taobao.refund,
  },
  meituan: {
    billDate: PLATFORM_PROFILE.meituan.billDate, net: PLATFORM_PROFILE.meituan.net,
    bizType: PLATFORM_PROFILE.meituan.bizType, order: PLATFORM_PROFILE.meituan.order,
  },
};
const SHEET = {
  taobao: PLATFORM_PROFILE.taobao.sheet,
  meituan: PLATFORM_PROFILE.meituan.sheet,
};

/**
 * 按表头列名判定平台。🔴 只看列名、不看文件名。
 * 判据 = 签名列（require）全中 且 排除列（deny）全不中；全不中返回 null（fail-closed）。
 * @param {string[]} header 表头（列名数组）
 * @returns {'taobao'|'meituan'|null}
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

/**
 * 表头行 = 前 5 行里「非空文本格最多」的那一行（移植 parse_bill.py::guess_header）。
 * @param {Array<Array>} rows 定宽矩阵（行 = 数组）
 * @returns {number} 表头行下标（0-based）
 */
function guessHeader(rows) {
  let best = -1, bi = 0;
  const n = Math.min((rows || []).length, 5);
  for (let i = 0; i < n; i++) {
    const row = rows[i] || [];
    let txt = 0;
    for (const v of row) if (v && toNum(v) === null) txt++;   // 非空且非纯数字 = 文本格
    if (txt > best) { best = txt; bi = i; }
  }
  return bi;
}

/**
 * 解析账单矩阵（fixture 的 matrix.json 结构：{ sheets: { 表名: { rows: [[...],...] } } }）。
 * @param {object} matrix matrix.json 结构
 * @param {{platform:'taobao'|'meituan'}} opts
 * @returns {{
 *   platform, headerRow, header,
 *   rows: Array<{bizDate:string, qty:number, amountFen:number}>,
 *   totals: {amountFen:number, qty:number, rowCount:number},
 *   months: string[], excluded: {rows:number, reason:string},
 * }}
 */
function parseBillMatrix(matrix, opts) {
  const platform = (opts && opts.platform) || null;
  const sheets = (matrix && matrix.sheets) || {};
  const sheet = sheets[SHEET[platform]];
  const allRows = (sheet && sheet.rows) || [];
  const headerRow = guessHeader(allRows);
  const header = (allRows[headerRow] || []).map((s) => (s == null ? '' : String(s).trim()));

  // 列名 → 下标
  const colIdx = {};
  header.forEach((h, i) => { if (h) colIdx[h] = i; });
  const c = COL[platform];

  let excludedRows = 0;
  let excludedReason = '';

  // 逐订单行提取 {bizDate, qty, amountFen}
  const orders = [];
  for (let i = headerRow + 1; i < allRows.length; i++) {
    const row = allRows[i] || [];
    if (platform === 'taobao') {
      const net = toNum(row[colIdx[c.net]]);
      if (net == null) continue;                               // 空结算金额行跳过
      const bizDate = (row[colIdx[c.billDate]] || '').trim();
      const orderType = (row[colIdx[c.orderType]] || '').trim();
      const isRefund = orderType === c.refund;
      orders.push({
        bizDate,
        qty: isRefund ? 0 : 1,                                // 🔴 退单不算有效订单
        amountFen: Math.round(net * 100),                      // 到手 = 结算金额（含退单冲减，退单为负值）
      });
    } else { // meituan
      const bizType = (row[colIdx[c.bizType]] || '').trim();
      if (bizType !== c.order) { excludedRows++; continue; }   // 🔴 只取「外卖订单」，广告/保险排除
      const net = toNum(row[colIdx[c.net]]);
      if (net == null) continue;
      const bizDate = (row[colIdx[c.billDate]] || '').trim();
      orders.push({ bizDate, qty: 1, amountFen: Math.round(net * 100) });
    }
  }

  // 按账单日期归组 → 日汇总
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
    rowCount: orders.length,                                   // 订单行数（含退单行）
  };
  const months = Array.from(new Set(rows.map((r) => String(r.bizDate).slice(0, 7)))).sort();

  excludedReason = excludedRows > 0 ? (platform === 'taobao' ? c.refund : '非外卖订单（广告/保险）') : '';

  return {
    platform,
    headerRow,
    header,
    rows,
    totals,
    months,
    excluded: { rows: excludedRows, reason: excludedReason },
  };
}

module.exports = { detectPlatform, guessHeader, parseBillMatrix, toNum };
