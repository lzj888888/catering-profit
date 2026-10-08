// review/evidence/r242_mt_goods/probe_mt_goods.js
// R242b —— 真·美团「商品」销量表（CSV / GBK）灌**生产解析器**，判它今天到底进不进得来。
//
// 纪律：
//   · require 生产解析器（不手写等价公式 —— 那是第二个真相源）
//   · 走**生产同一条路**：bufferToMatrix（真 xlsx，非 stub）→ detectDishMatrix → 各判据
//   · 先跑正样本基线（证明脚本不是恒绿，R182 自失效护栏）
//   · 复现 index.js:56-74 的分支，不凭读代码下结论
//
// 运行： node probe_mt_goods.js [csv路径]

'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..', '..');
const WS = 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules';
const CSV = process.argv[2] || path.join(HERE, 'mt_goods_20260907_20260913.csv');

// ---- 让 require('xlsx') 解析到受管工作区的**真实副本**（不是 stub）----
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === 'xlsx') return require.resolve(path.join(WS, 'xlsx'));
  return origResolve.apply(this, arguments);
};
const XLSX = require(path.join(WS, 'xlsx'));
console.log('xlsx 版本 = ' + XLSX.version);

const S = require(path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js'));
const IDX = path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'index.js');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  ' + extra : '')); }
}

// ---- 0 白名单从 index.js 源码抽取（不手抄）----
const src = fs.readFileSync(IDX, 'utf8');
const m = src.match(/const\s+sheetNameByPlatform\s*=\s*\{([^}]*)\}/);
const sheetByPlatform = {};
if (m) {
  m[1].split(',').forEach(function (kv) {
    const p = kv.split(':');
    if (p.length < 2) return;
    const k = p[0].trim().replace(/^['"]|['"]$/g, '');
    const v = p.slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
    if (k) sheetByPlatform[k] = v;
  });
}
console.log('\n=== 0 生产源码现状（从 index.js 抽取）===');
console.log('  平台 → sheet 名 : ' + JSON.stringify(sheetByPlatform));

// ---- 1 正样本基线（自失效护栏）----
console.log('\n=== 1 正样本基线（证明判据不是恒 null）===');
const FAKE_TAOBAO = ['账单日期', '订单编号', '订单类型', '结算金额', '退单'];
const FAKE_MEITUAN = ['账单日期', '订单编号', '交易类型', '商家应收款', '账单金额'];
ok(S.detectPlatform(FAKE_TAOBAO) === 'taobao', '假淘宝表头 → taobao', '实得 ' + S.detectPlatform(FAKE_TAOBAO));
ok(S.detectPlatform(FAKE_MEITUAN) === 'meituan', '假美团表头 → meituan', '实得 ' + S.detectPlatform(FAKE_MEITUAN));
// 形态 C 正样本（R241 自测用的那套列名）
const FAKE_C = [['日期', '门店编号', '商品名称', '销量', '销售额'], ['2026-09-01', 'S1', '耙牛肉', '2', '88']];
ok(S.detectDishShape(FAKE_C) === 'waimai_goods', '标准列名表 → waimai_goods', '实得 ' + S.detectDishShape(FAKE_C));

// ---- 2 真样例：走生产同一条路 ----
console.log('\n=== 2 真·美团商品表（' + path.basename(CSV) + '）===');
const buf = fs.readFileSync(CSV);
console.log('  文件字节数 = ' + buf.length + '  md5 = ' + require('crypto').createHash('md5').update(buf).digest('hex'));

const matrix = S.bufferToMatrix(buf);
const sheetNames = Object.keys(matrix.sheets);
console.log('  bufferToMatrix ⇒ sheet 名 = ' + JSON.stringify(sheetNames));
const sname = sheetNames[0];
const rows = matrix.sheets[sname].rows;
console.log('  行数 = ' + rows.length + ' · R1 列数 = ' + (rows[0] || []).length);
console.log('  R1（引擎看到的表头）= ' + JSON.stringify(rows[0]));
if (rows[1]) console.log('  R2（引擎看到的首条数据）= ' + JSON.stringify(rows[1]));

// 2.1 🔴 编码：GBK 中文是否被 xlsx 解成乱码
const j1 = (rows[1] || [])[1];
const garbled = typeof j1 === 'string' && /[\uFFFD]/.test(j1);
console.log('\n  --- 2.1 编码（GBK 表经 xlsx 读 CSV）---');
console.log('      首条商品名 = ' + JSON.stringify(j1));
ok(j1 === '煮小酥肉', '中文未被解坏（期望「煮小酥肉」）', '实得 ' + JSON.stringify(j1));

// 2.2 形态识别
console.log('\n  --- 2.2 形态识别 ---');
const ddm = S.detectDishMatrix(matrix);
const dds = S.detectDishShape(rows);
console.log('      detectDishMatrix ⇒ ' + JSON.stringify(ddm));
console.log('      detectDishShape  ⇒ ' + JSON.stringify(dds));
ok(dds !== null, '能判出形态 C（waimai_goods）', '实得 ' + JSON.stringify(dds));

// 2.3 平台识别
console.log('\n  --- 2.3 平台识别 ---');
const hIdx = S.guessHeader(rows);
const hdr = (rows[hIdx] || []).map(function (x) { return String(x).trim(); });
const p = S.detectPlatform(hdr);
console.log('      guessHeader ⇒ R' + (hIdx + 1));
console.log('      detectPlatform ⇒ ' + JSON.stringify(p));
ok(p !== null, '能认出平台', '实得 ' + JSON.stringify(p));

// 2.4 复现 index.js 的分支
console.log('\n  --- 2.4 复现 index.js:56-74 分支 ---');
let verdict;
if (ddm.shape) {
  verdict = '走 handleDishImport（形态 ' + ddm.shape + '）';
} else {
  const whitelisted = p && sheetByPlatform[p] && matrix.sheets[sheetByPlatform[p]];
  verdict = whitelisted ? ('走 parseBillMatrix（' + p + '）')
    : '⛔ 阻断：「无法识别账单平台（请确认是淘宝闪购、美团外卖账单，或堂食《菜品销售统计》）」';
}
console.log('      判定 ⇒ ' + verdict);
ok(!!ddm.shape, '真样例应能进 handleDishImport（若为 ❌ 即「进不来」的机器判据）', '实得 shape=' + JSON.stringify(ddm.shape));

// 2.5 若强行喂给形态 C 解析器，会怎样
console.log('\n  --- 2.5 强行喂 parseDishSalesC（假设形态已过）---');
const pc = S.parseDishSalesC(rows, { platform: 'meituan' });
console.log('      groups 数 = ' + pc.groups.length + ' · rows 数 = ' + pc.rows.length
  + ' · unmatched 数 = ' + pc.unmatched.length);
console.log('      totals = ' + JSON.stringify(pc.totals));
console.log('      zeroAmountQty = ' + JSON.stringify(pc.zeroAmountQty));
console.log('      unmatched 前 3 = ' + JSON.stringify(pc.unmatched.slice(0, 3)));

// 2.6 日期归一
console.log('\n  --- 2.6 日期归一 normalizeDate ---');
[[ '20260910', '真美团紧凑 8 位' ], [ '2026-09-10', '标准' ], [ '2026/9/7', '斜杠' ]].forEach(function (t) {
  console.log('      normalizeDate(' + JSON.stringify(t[0]) + ') ⇒ ' + JSON.stringify(S.normalizeDate(t[0])) + '   // ' + t[1]);
});

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
