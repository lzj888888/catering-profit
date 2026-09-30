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
    platform: { type: 'string', required: true, enum: ['taobao', 'meituan', 'eleme', 'other'] },
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

module.exports = { bufferToMatrix, detectPlatform, guessHeader, parseBillMatrix, checkGradeA, SALES_SCHEMA, toNum };
