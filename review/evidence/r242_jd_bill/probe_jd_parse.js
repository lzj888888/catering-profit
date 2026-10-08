// review/evidence/r242_jd_bill/probe_jd_parse.js —— 京东「对账单下载」灌生产解析链实测（只读、不起模拟器）
// 全程用**生产代码**：bufferToMatrix → guessHeader → detectPlatform → parseBillMatrix → checkGradeA
// 运行：node probe_jd_parse.js
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

const F = path.join(__dirname, 'jd_bill_20260930.xlsx');
const buf = fs.readFileSync(F);
console.log('文件 =', path.basename(F), '|', buf.length, 'B');

// 1) 解码成矩阵（生产 xlsx 路径）
const mx = S.bufferToMatrix(buf);
const names = Object.keys(mx.sheets);
console.log('\n[1] bufferToMatrix → sheets =', JSON.stringify(names));
const sheet = mx.sheets[names[0]];
const rows = sheet.rows;
console.log('    行数 =', rows.length, '· 首行前 6 格 =', JSON.stringify((rows[0] || []).slice(0, 6)));

// 2) 生产 guessHeader 选哪一行当表头
const hi = BP.guessHeader(rows);
console.log('\n[2] guessHeader → 第', hi + 1, '行（0-based=' + hi + '）');
console.log('    该行前 10 格 =', JSON.stringify((rows[hi] || []).slice(0, 10)));

// 3) 平台识别
const plat = BP.detectPlatform(rows[hi]);
console.log('\n[3] detectPlatform(第' + (hi + 1) + '行) →', JSON.stringify(plat));

// 4) 试两种表头各自能不能被判出平台（确认不是"选错行"）
[0, 1].forEach((i) => {
  console.log('    对照：用第' + (i + 1) + '行当表头 → detectPlatform =', JSON.stringify(BP.detectPlatform(rows[i])));
});

// 5) 生产 parseBillMatrix（整份文档入参 = {sheets:[...]}）
const doc = { sheets: names.map((n) => ({ name: n, rows: mx.sheets[n].rows })) };
const parsed = BP.parseBillMatrix(doc);
console.log('\n[4] parseBillMatrix →', JSON.stringify(parsed && parsed.totals ? parsed.totals : parsed).slice(0, 400));

// 6) 甲级门禁
try {
  const gate = G.checkGradeA({ platform: plat, matrix: doc, totals: parsed && parsed.totals }, S.SALES_SCHEMA);
  console.log('\n[5] checkGradeA → pass =', gate.pass, '| level =', gate.level);
  console.log('    failures =', JSON.stringify(gate.failures));
} catch (e) {
  console.log('\n[5] checkGradeA → 抛错：', (e && e.message) || e);
}

// 7) 另测「跳过一级表头」的变体：把 R1 去掉，让 R2 当第 1 行
const rows2 = rows.slice(1);
const doc2 = { sheets: [{ name: names[0], rows: rows2 }] };
const hi2 = BP.guessHeader(rows2);
console.log('\n[6] 变体（删掉一级表头 R1）→ guessHeader 第', hi2 + 1, '行 · detectPlatform =',
  JSON.stringify(BP.detectPlatform(rows2[hi2])));
