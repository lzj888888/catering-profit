// review/evidence/r242_jd_bill/probe_jd_sku_parse.js —— 京东「SKU对账单」灌生产解析链实测（只读、不起模拟器）
// 重点验一件事：该表第 11 列叫「结算金额」，而 detectPlatform 把「结算金额」当淘宝独有特征 ⇒ 会不会误判成 taobao？
// 全程用**生产代码**：bufferToMatrix → guessHeader → detectPlatform → parseBillMatrix
// 运行：node probe_jd_sku_parse.js
const fs = require('fs');
const path = require('path');
const Module = require('module');
const WS = 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules';
const o = Module._resolveFilename;
Module._resolveFilename = function (r) { if (r === 'xlsx') return require.resolve(path.join(WS, 'xlsx')); return o.apply(this, arguments); };
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const S = require(path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js'));
const BP = require(path.join(ROOT, 'utils', 'billParse.js'));
const G = require(path.join(ROOT, 'utils', 'gradeGate.js'));

const F = path.join(__dirname, 'jd_sku_bill_20260930.xlsx');
const buf = fs.readFileSync(F);
console.log('文件 =', path.basename(F), '|', buf.length, 'B');

// 1) 解码成矩阵（生产 xlsx 路径）
const mx = S.bufferToMatrix(buf);
const names = Object.keys(mx.sheets);
console.log('\n[1] bufferToMatrix → sheets =', JSON.stringify(names));
const sheet = mx.sheets[names[0]];
const rows = sheet.rows;
console.log('    行数 =', rows.length, '· 最大列数 =', Math.max(...rows.map((r) => r.length)));
console.log('    R1 前 12 格 =', JSON.stringify((rows[0] || []).slice(0, 12)));

// 2) 生产 guessHeader 选哪一行当表头
const hi = BP.guessHeader(rows);
console.log('\n[2] guessHeader → 第', hi + 1, '行（0-based=' + hi + '）');

// 3) 🔴 关键：平台识别
const plat = BP.detectPlatform(rows[hi]);
console.log('\n[3] 🔴 detectPlatform(R1) →', JSON.stringify(plat));
console.log('    判据：COL.taobao.net = "结算金额"；本表第 11 列 =', JSON.stringify(rows[hi][10]));
console.log('    ⇒ 若返回 "taobao"，则京东 SKU 表被**误判为淘宝**（跨平台串味）');

// 4) 逐列对照：淘宝特征列 vs 本表列名
const COL_TAOBAO_NET = '结算金额';
const COL_MEITUAN_NET = '商家应收款';
const cols = (rows[hi] || []).filter(Boolean).map((s) => String(s).trim());
console.log('\n[4] 特征列命中对照：');
console.log('    taobao.net("' + COL_TAOBAO_NET + '") 命中 =', cols.indexOf(COL_TAOBAO_NET) >= 0);
console.log('    meituan.net("' + COL_MEITUAN_NET + '") 命中 =', cols.indexOf(COL_MEITUAN_NET) >= 0);
console.log('    本表还含「账单日期」? =', cols.indexOf('账单日期') >= 0, '（淘宝另一个特征列）');
console.log('    本表还含「订单类型」? =', cols.indexOf('订单类型') >= 0, '（淘宝另一个特征列）');

// 5) 生产 parseBillMatrix 会按谁解析？（整份文档入参）
const doc = { sheets: names.map((n) => ({ name: n, rows: mx.sheets[n].rows })) };
let parsed = null;
try { parsed = BP.parseBillMatrix(doc); } catch (e) { console.log('\n[5] parseBillMatrix 抛错：', e.message); }
console.log('\n[5] parseBillMatrix →', JSON.stringify(parsed && parsed.totals ? parsed.totals : parsed).slice(0, 400));

// 6) 甲级门禁（若平台被误判成 taobao，看它会不会 pass）
try {
  const gate = G.checkGradeA({ platform: plat, matrix: doc, totals: parsed && parsed.totals }, S.SALES_SCHEMA);
  console.log('\n[6] checkGradeA → pass =', gate.pass, '| level =', gate.level);
  console.log('    failures =', JSON.stringify(gate.failures));
} catch (e) {
  console.log('\n[6] checkGradeA → 抛错：', (e && e.message) || e);
}

// 7) 对照：订单级那份（上轮已测 = null）
console.log('\n[7] 对照（订单级 jd_bill_20260930.xlsx）：');
try {
  const mx2 = S.bufferToMatrix(fs.readFileSync(path.join(__dirname, 'jd_bill_20260930.xlsx')));
  const n2 = Object.keys(mx2.sheets)[0];
  const r2 = mx2.sheets[n2].rows;
  const h2 = BP.guessHeader(r2);
  console.log('    guessHeader=第' + (h2 + 1) + '行 · detectPlatform =', JSON.stringify(BP.detectPlatform(r2[h2])));
} catch (e) { console.log('    读订单级失败：', e.message); }
