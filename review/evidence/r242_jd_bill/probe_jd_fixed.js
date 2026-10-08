// review/evidence/r242_jd_bill/probe_jd_fixed.js —— 修正版：用**正确结构**重测京东两表灌生产链
// 🔴 修正上一轮 probe_jd_parse.js 的两处**探针自身缺陷**：
//    ① 传 matrix 时用了 `{sheets: names.map(...)}`（数组）⇒ 生产是 `sheets[SHEET[platform]]` 按**字符串键**取
//       ⇒ 正确结构 = bufferToMatrix 的原样返回 `{ sheets: { 表名: {rows} } }`
//    ② checkGradeA 入参应是 `{ platform, rows, totals }`，上轮误传 `{ platform, matrix, totals }` ⇒ rows=undefined ⇒ 恒 CHANNEL_EMPTY
// 运行：node probe_jd_fixed.js
const fs = require('fs');
const path = require('path');
const Module = require('module');
const WS = 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules';
const o = Module._resolveFilename;
Module._resolveFilename = function (r) { if (r === 'xlsx') return require.resolve(path.join(WS, 'xlsx')); return o.apply(this, arguments); };
const XLSX = require(path.join(WS, 'xlsx'));
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const S = require(path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js'));
const BP = require(path.join(ROOT, 'utils', 'billParse.js'));
const G = require(path.join(ROOT, 'utils', 'gradeGate.js'));

const SHOP = 'shop_mu6j87v1itrs';

function runCase(label, mx, expect) {
  console.log('\n========== ' + label + ' ==========');
  const names = Object.keys(mx.sheets);
  const rows = mx.sheets[names[0]].rows;
  console.log('  sheet 名 =', JSON.stringify(names), '| 行数 =', rows.length);

  const hi = BP.guessHeader(rows);
  const plat = BP.detectPlatform(rows[hi]);
  console.log('  guessHeader = 第' + (hi + 1) + '行 · 该行前 4 格 =', JSON.stringify((rows[hi] || []).slice(0, 4)));
  console.log('  detectPlatform =', JSON.stringify(plat));

  const parsed = BP.parseBillMatrix(mx, { platform: plat });
  console.log('  parseBillMatrix(sheets 原样传入) → totals =', JSON.stringify(parsed.totals),
    '· months =', JSON.stringify(parsed.months));
  if (parsed.rows.length) console.log('     首行 =', JSON.stringify(parsed.rows[0]), '· 末行 =', JSON.stringify(parsed.rows[parsed.rows.length - 1]));

  const gate = G.checkGradeA({ platform: plat, rows: parsed.rows, totals: parsed.totals, shop_id: SHOP }, S.SALES_SCHEMA);
  console.log('  checkGradeA(正确入参) → pass =', gate.pass, '| failures =', JSON.stringify(gate.failures).slice(0, 300));

  if (expect) console.log('  ⚖️ 期望：', expect);
  return { names, rows, hi, plat, parsed, gate };
}

// ---------- A. 订单级真表 ----------
const mxA = S.bufferToMatrix(fs.readFileSync(path.join(__dirname, 'jd_bill_20260930.xlsx')));
const RA = runCase('A 订单级真表 jd_bill_20260930.xlsx', mxA, '基线：订单级 Σ应结 555.96 元 = 55596 分');

// ---------- B. 订单级真表 · 删掉 R1 分组表头（让 R2 当表头） ----------
const rowsA = mxA.sheets[Object.keys(mxA.sheets)[0]].rows;
const mxB = { sheets: {} };
mxB.sheets[Object.keys(mxA.sheets)[0]] = { rows: rowsA.slice(1) };
runCase('B 订单级 · 删掉分组行 R1（变体）', mxB, '看表头选对后能否解析');

// ---------- C. SKU 真表（空表） ----------
const mxC = S.bufferToMatrix(fs.readFileSync(path.join(__dirname, 'jd_sku_bill_20260930.xlsx')));
runCase('C SKU 真表（空）jd_sku_bill_20260930.xlsx', mxC, '零数据行 ⇒ 应 0/0/0');

// ---------- D. SKU 带数据变体（sheet 名 = 外卖账单明细） ----------
const mxD = S.bufferToMatrix(fs.readFileSync(path.join(__dirname, '_variant_jd_sku_withdata.xlsx')));
runCase('D SKU 带数据变体（sheet 名改成淘宝的"外卖账单明细"）', mxD, '正确口径：amountFen=15070 · qty=2 · bizDate=2026-09-30');

// ---------- E. SKU 带数据变体 · sheet 名保持京东原名 ----------
const raw = XLSX.read(fs.readFileSync(path.join(__dirname, '_variant_jd_sku_withdata.xlsx')), { type: 'buffer' });
const aoa = XLSX.utils.sheet_to_json(raw.Sheets[raw.SheetNames[0]], { header: 1, defval: null });
const wbE = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbE, XLSX.utils.aoa_to_sheet(aoa), 'sku对账单下载');
const tmpE = path.join(__dirname, '_variant_jd_sku_native.xlsx');
XLSX.writeFile(wbE, tmpE);
const mxE = S.bufferToMatrix(fs.readFileSync(tmpE));
runCase('E SKU 带数据变体（sheet 名保持京东原名"sku对账单下载"）', mxE, '验证"sheet 名不匹配"这道护栏是否真拦住');
