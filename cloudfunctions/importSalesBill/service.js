// cloudfunctions/importSalesBill/service.js —— xlsx → 矩阵 → 解析 → 甲级门禁（纯逻辑，仅本函数）
//
// ⚠️ 云函数独立打包、不能 require 小程序侧 utils/，故本文件**内联**了
//   utils/billParse.js（detectPlatform/guessHeader/parseBillMatrix/toNum）与
//   utils/gradeGate.js（SALES_SCHEMA/checkGradeA）的**同源实现**。
//   自测 tools/selftest_bill_parse.js / selftest_grade_gate.js 直接 require utils/ 那份，
//   本份是云函数侧的等价副本（口径一致，锚点由自测守）。
const XLSX = require('xlsx');

// ===================== 通用：字符串 → 数值（移植 parse_bill.py::to_num）=====================
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

// ===================== 单元格格式化 =====================
function fmtCell(cell) {
  if (cell == null) return '';
  if (cell instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${cell.getFullYear()}-${p(cell.getMonth() + 1)}-${p(cell.getDate())}`;
  }
  return String(cell).trim();
}

/**
 * xlsx Buffer → matrix.json 同构结构 { sheets: { 表名: { rows, max_row, max_col } } }。
 */
function bufferToMatrix(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const rows = (aoa || []).map((row) => (Array.isArray(row) ? row.map(fmtCell) : []));
    sheets[name] = { rows, max_row: rows.length, max_col: rows.length ? rows[0].length : 0 };
  }
  return { sheets };
}

// ===================== billParse 同源（utils/billParse.js）=====================
const COL = {
  taobao: { billDate: '账单日期', net: '结算金额', orderType: '订单类型', refund: '退单' },
  meituan: { billDate: '账单日期', net: '商家应收款', bizType: '交易类型', order: '外卖订单' },
};
const SHEET = { taobao: '外卖账单明细', meituan: '订单明细' };

function detectPlatform(header) {
  if (!Array.isArray(header)) return null;
  const cols = header.filter(Boolean).map((s) => String(s).trim());
  if (cols.indexOf(COL.taobao.net) >= 0) return 'taobao';
  if (cols.indexOf(COL.meituan.net) >= 0) return 'meituan';
  return null;
}

function guessHeader(rows) {
  let best = -1, bi = 0;
  const n = Math.min((rows || []).length, 5);
  for (let i = 0; i < n; i++) {
    const row = rows[i] || [];
    let txt = 0;
    for (const v of row) if (v && toNum(v) === null) txt++;
    if (txt > best) { best = txt; bi = i; }
  }
  return bi;
}

function parseBillMatrix(matrix, opts) {
  const platform = (opts && opts.platform) || null;
  const sheets = (matrix && matrix.sheets) || {};
  const sheet = sheets[SHEET[platform]];
  const allRows = (sheet && sheet.rows) || [];
  const headerRow = guessHeader(allRows);
  const header = (allRows[headerRow] || []).map((s) => (s == null ? '' : String(s).trim()));

  const colIdx = {};
  header.forEach((h, i) => { if (h) colIdx[h] = i; });
  const c = COL[platform];

  let excludedRows = 0;
  const orders = [];
  for (let i = headerRow + 1; i < allRows.length; i++) {
    const row = allRows[i] || [];
    if (platform === 'taobao') {
      const net = toNum(row[colIdx[c.net]]);
      if (net == null) continue;
      const bizDate = (row[colIdx[c.billDate]] || '').trim();
      const orderType = (row[colIdx[c.orderType]] || '').trim();
      const isRefund = orderType === c.refund;
      orders.push({ bizDate, qty: isRefund ? 0 : 1, amountFen: Math.round(net * 100) });
    } else {
      const bizType = (row[colIdx[c.bizType]] || '').trim();
      if (bizType !== c.order) { excludedRows++; continue; }
      const net = toNum(row[colIdx[c.net]]);
      if (net == null) continue;
      const bizDate = (row[colIdx[c.billDate]] || '').trim();
      orders.push({ bizDate, qty: 1, amountFen: Math.round(net * 100) });
    }
  }

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
    rowCount: orders.length,
  };
  const months = Array.from(new Set(rows.map((r) => String(r.bizDate).slice(0, 7)))).sort();

  return {
    platform, headerRow, header, rows, totals, months,
    excluded: { rows: excludedRows, reason: excludedRows > 0 ? (platform === 'taobao' ? c.refund : '非外卖订单（广告/保险）') : '' },
  };
}

// ===================== gradeGate 同源（utils/gradeGate.js）=====================
const SALES_SCHEMA = {
  fields: {
    shop_id: { type: 'string', required: true },
    biz_date: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    external_ref_id: { type: 'string', required: true },
    dish_key: { type: 'string', required: true },
    qty: { type: 'number', required: true, integer: true, min: 0 },
    amount: { type: 'number', required: true, integer: true },
    platform: { type: 'string', required: true, enum: ['taobao', 'meituan', 'eleme', 'pos', 'other'] },
    source: { type: 'string', required: true, enum: ['oauth', 'excel', 'manual'] },
    created_at: { type: 'number', required: true, integer: true },
  },
};

function checkGradeA(input, schema) {
  const s = schema || SALES_SCHEMA;
  const fields = s.fields || {};
  const failures = [];
  const { platform, rows, totals } = input || {};
  const rowList = Array.isArray(rows) ? rows : [];

  if (rowList.length === 0) failures.push({ code: 'CHANNEL_EMPTY', field: 'rows', msg: '未解析到任何数据行' });
  if (!totals || totals.amountFen == null || !Number.isFinite(totals.amountFen)) {
    failures.push({ code: 'CHANNEL_TOTAL_MISSING', field: 'totals.amountFen', msg: '合计金额缺失或非法' });
  }

  const platformEnum = (fields.platform && fields.platform.enum) || [];
  if (!platform || platformEnum.indexOf(platform) < 0) {
    failures.push({ code: 'SCHEMA_PLATFORM', field: 'platform', msg: `平台未知：${platform}` });
  }
  for (let i = 0; i < rowList.length; i++) {
    const r = rowList[i] || {};
    const pat = (fields.biz_date && fields.biz_date.pattern) || /^\d{4}-\d{2}-\d{2}$/;
    if (typeof r.bizDate !== 'string' || !pat.test(r.bizDate)) {
      failures.push({ code: 'SCHEMA_BIZDATE', field: `rows[${i}].bizDate`, msg: `账单日期格式错误：${r.bizDate}` });
    }
    if (typeof r.amountFen !== 'number' || !Number.isInteger(r.amountFen)) {
      failures.push({ code: 'SCHEMA_AMOUNT', field: `rows[${i}].amountFen`, msg: `金额不是整数分：${r.amountFen}` });
    }
    if (typeof r.qty !== 'number' || !Number.isInteger(r.qty) || r.qty < (fields.qty ? fields.qty.min : 0)) {
      failures.push({ code: 'SCHEMA_QTY', field: `rows[${i}].qty`, msg: `订单数非法：${r.qty}` });
    }
  }

  if (input.shopId === undefined || input.shopId === null || input.shopId === '') {
    failures.push({ code: 'REQUIRED_SHOP_ID', field: 'shop_id', msg: '门店 ID 为空' });
  }
  for (let i = 0; i < rowList.length; i++) {
    if (!rowList[i] || rowList[i].bizDate == null || rowList[i].bizDate === '') {
      failures.push({ code: 'REQUIRED_BIZDATE', field: `rows[${i}].bizDate`, msg: '账单日期为空' });
    }
  }
  if (!totals || totals.amountFen == null) {
    failures.push({ code: 'REQUIRED_AMOUNT', field: 'amount', msg: '金额为空' });
  }

  return { pass: failures.length === 0, level: 'A', failures };
}

// ===================== M3.33 单品毛利复盘（批次 G） 表形态解析 =====================
//
// 依据 specs/dev-specs/core/开发规范v1.6_ModuleM3增量_M3.33阶段二解析与清洗定案.md：
//   三种表形态（§3.4 fail-closed，零命中/多命中不许猜）+ 堂食《菜品销售统计》解析（§4）。
// 🔴 引擎四函数（netUnitCostWan / lineNetCostYuan / calcCostCard / wouldCreateCycle）零改动 —— 本段纯上层。

// 表形态（§2.1.1 / §3）
const DISH_SHAPES = {
  A: 'dish_sales',    // 堂食《菜品销售统计》（美团收银 POS）—— 主路径
  B: 'combo_detail',  // 团购《套餐销售明细》—— 仅交叉校验，不入库
  C: 'waimai_goods',  // 外卖「商品销量」—— 预留，待样例
};

// 形态 A 表结构常量（§2.1.2 实测 · 六项必核）
const DISH_A_STRUCT = {
  headerRow1: 3,        // R3 一级表头（1-based）
  headerRow2: 4,        // R4 二级表头（「销售额构成」/「菜品收入构成」各横跨 3 列）
  dataStartRow: 5,      // 数据 R5 起
  totalLabel: '合计',   // 末行首列 = 合计 ⇒ 必须排除（§4.2）
  // 列序（1-based）：名称 / 数量 / 销售额(元) / 收入(元) / 优惠(元)
  colName: 1, colQty: 2, colSales: 4, colIncome: 6, colDiscount: 8,
};

// 名称归一：trim + NFKC（全角字母/数字 → 半角）后作 dish_key；保留规格后缀与括号（§4.4/§4.7）
function normalizeDishName(name) {
  if (name == null) return '';
  let s = String(name).trim();
  try { s = s.normalize('NFKC'); } catch (e) { /* 老运行时无 normalize 则原样 */ }
  return s;
}

// 单 sheet 形态判定（§3.4 fail-closed）。sheetRows：0-based 二维 cells。
// A ← 有 '菜品名称' + '销售数量' 且 R2 含 '销售方式'；B ← 有 '套餐' + '单品名称'；C ← 有 '商品名称' + '商品销量'。
function detectDishShape(sheetRows) {
  const rows = sheetRows || [];
  const hdr = (rows[2] || []).map((x) => (x == null ? '' : String(x).trim()));  // R3
  const r2 = (rows[1] || []).map((x) => (x == null ? '' : String(x))).join('');  // R2 参数自述
  const has = (c) => hdr.indexOf(c) >= 0;
  if (has('菜品名称') && has('销售数量') && r2.indexOf('销售方式') >= 0) return DISH_SHAPES.A;
  if (has('套餐') && has('单品名称')) return DISH_SHAPES.B;
  if (has('商品名称') && has('商品销量')) return DISH_SHAPES.C;
  return null;
}

// 从矩阵里找第一个可识别的菜品表（供入口分流用）。返回 { shape, sheet }；识别不出 ⇒ shape null。
function detectDishMatrix(matrix) {
  const sheets = (matrix && matrix.sheets) || {};
  for (const name of Object.keys(sheets)) {
    const shape = detectDishShape((sheets[name] || {}).rows);
    if (shape) return { shape, sheet: name };
  }
  return { shape: null, sheet: '' };
}

// 从 R2 参数行提取营业日期（取「至」= 结束日，确定性 ⇒ 幂等）。返回 YYYY-MM-DD，取不到返回 ''。
function extractBizDate(sheetRows) {
  const r2 = ((sheetRows || [])[1] || []).map((x) => (x == null ? '' : String(x))).join('');
  const dates = r2.match(/\d{4}[/\-]\d{1,2}[/\-]\d{1,2}/g) || [];
  if (!dates.length) return '';
  const last = dates[dates.length - 1];
  const m = last.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/);
  if (!m) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
}

// external_ref_id 编码（§5.1）：必含 dish_key 段 —— 否则唯一索引 (shop_id, biz_date, external_ref_id)
//   会让同平台同天所有菜共用同一三元组 ⇒ 只落得下 1 条。
function dishRefId(platform, bizDate, dishKey) {
  return 'DISH:' + platform + ':' + bizDate + ':' + dishKey;
}

// _id 确定性形态（§2.2）：SALE_<shop>_<platform>_<biz_date>_<seq> ⇒ 同表重导覆盖同一文档（幂等）。
function saleDocId(shopId, platform, bizDate, seq) {
  return 'SALE_' + shopId + '_' + platform + '_' + bizDate + '_' + seq;
}

const round1 = (n) => Math.round(n * 10) / 10;

// 解析形态 A（堂食《菜品销售统计》）。
// 返回 { shape, bizDate, rows, totals, nonInt, unmatched }。
//   · rows：{ name, dishKey, qty(整数), amountFen(收入元→分整数), salesFen, discountFen, rawQty, nonInt }
//   · amountFen 取「菜品收入(元)」列（= 销售额 − 优惠，§5.3 实际收入口径），不用毛销售额
//   · qty = Math.round(原始 qty)（§5.2）；非整数行进 nonInt（解析报告单列，不静默）
//   · 合计行（首列 == 合计）排除（§4.2）
function parseDishSales(sheetRows, opts) {
  const rows = sheetRows || [];
  const c = DISH_A_STRUCT;
  const out = [];
  const nonInt = [];
  const unmatched = [];
  for (let i = c.dataStartRow - 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name0 = (r[0] == null ? '' : String(r[0])).trim();
    if (name0 === c.totalLabel) break;                 // 合计行，排除且停（恰在末行）
    const rawQty = toNum(r[c.colQty - 1]);
    const income = toNum(r[c.colIncome - 1]);
    const sales = toNum(r[c.colSales - 1]);
    const discount = toNum(r[c.colDiscount - 1]);
    if (name0 === '' && rawQty == null && income == null && sales == null) continue; // 全空行跳过
    const qty = rawQty == null ? 0 : Math.round(rawQty);   // §5.2 恒整数
    const isNonInt = rawQty != null && !Number.isInteger(rawQty);
    if (isNonInt) nonInt.push({ name: name0, raw: rawQty, rounded: qty });
    const amountFen = Math.round((income == null ? 0 : income) * 100);       // 收入元→分整数
    const salesFen = Math.round((sales == null ? 0 : sales) * 100);
    const discountFen = Math.round((discount == null ? 0 : discount) * 100);
    const dishKey = normalizeDishName(name0);
    // 菜名 '-' 或空（外卖未建映射 / 空行）⇒ 归未匹配（§1.3-2 / 红线 17），不落为菜名
    if (dishKey === '' || dishKey === '-') { unmatched.push({ name: name0, dishKey, rawQty, qty, amountFen }); continue; }
    out.push({
      name: name0, dishKey, qty, amountFen, salesFen, discountFen,
      rawQty: rawQty == null ? 0 : rawQty, nonInt: isNonInt,
    });
  }
  const totals = {
    qty: round1(out.reduce((s, x) => s + x.rawQty, 0)),
    sales: round1(out.reduce((s, x) => s + x.salesFen / 100, 0)),
    income: round1(out.reduce((s, x) => s + x.amountFen / 100, 0)),
    discount: round1(out.reduce((s, x) => s + x.discountFen / 100, 0)),
    amountFen: out.reduce((s, x) => s + x.amountFen, 0),
    rowCount: out.length,
  };
  return {
    shape: DISH_SHAPES.A,
    bizDate: extractBizDate(rows),
    rows: out,
    totals,
    nonInt,
    unmatched,
  };
}

module.exports = {
  bufferToMatrix, detectPlatform, guessHeader, parseBillMatrix, checkGradeA, SALES_SCHEMA, toNum,
  DISH_SHAPES, DISH_A_STRUCT, normalizeDishName, detectDishShape, detectDishMatrix,
  extractBizDate, dishRefId, saleDocId, parseDishSales,
};
