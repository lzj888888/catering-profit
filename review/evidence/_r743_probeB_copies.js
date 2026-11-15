#!/usr/bin/env node
// _r743_probeB_copies.js —— R743 独立审计探针 A：摊销引擎「几份 + 逐字比对 + 行为比对」
// 只读：仅 fs.readFileSync + require 生产纯函数，绝不修改任何现有文件。
// 运行： node review/evidence/_r743_probeB_copies.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 12);

const R = [];
const ck = (name, pass, detail) => { R.push({ name, pass: !!pass, detail: detail || '' }); };
console.log('==== R743 · 探针A · 摊销引擎副本计数 / 逐字比对 / 行为比对 ====\n');

// ---------- 通用：按大括号配平抽函数体 ----------
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const j = src.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  return null;
}
// 归一化：把导出侧私有前缀抹平 + 折叠空白（对齐 tools/check_export_delivery.js:: _norm）
const norm = (s) => (s || '')
  .replace(/_amountForMonth/g, 'amountForMonth')
  .replace(/_monthIndex/g, 'monthIndex')
  .replace(/\s+/g, ' ').trim();

// ---------- 1. 全仓「摊销公式引擎」清点 ----------
const COPIES = [
  { tag: '① getLedger/service.js',        rel: 'cloudfunctions/getLedger/service.js',        fn: 'amountForMonth',  line: 98 },
  { tag: '② saveLedger/service.js',        rel: 'cloudfunctions/saveLedger/service.js',        fn: 'amountForMonth',  line: 76 },
  { tag: '③ getAmortSchedule/service.js', rel: 'cloudfunctions/getAmortSchedule/service.js',  fn: 'amountForMonth',  line: 44 },
  { tag: '④ exportData/index.js',          rel: 'cloudfunctions/exportData/index.js',          fn: '_amountForMonth', line: 131 },
  { tag: '⑤ calcAmortize/service.js(UTC)',rel: 'cloudfunctions/calcAmortize/service.js',     fn: 'amountForMonthFen', line: 84 },
];
console.log('【表1 · 摊销「单资产单月金额」函数清点】');
const bodies = {};
for (const c of COPIES) {
  const src = read(c.rel);
  const b = extractFn(src, c.fn);
  bodies[c.tag] = b;
  console.log(`  ${c.tag.padEnd(36)} ${c.rel}:${c.line}  ${c.fn.padEnd(18)} 存在=${!!b}  原文md5=${b ? md5(b) : '-'}  归一化md5=${b ? md5(norm(b)) : '-'}`);
}
console.log('');

// calcMonthlyProfit/service.js 是否藏了一份引擎？
const cmpSrc = read('cloudfunctions/calcMonthlyProfit/service.js');
const cmpHasAmount = /function\s+amountForMonth(Fen)?\s*\(/.test(cmpSrc);
const cmpHasAmortizeFen = /amortizeFen\s*=\s*num0\(clean/.test(cmpSrc);
console.log('【表2 · calcMonthlyProfit/service.js 是否内含摊销公式引擎】');
console.log(`  含 amountForMonth/amountForMonthFen 定义 = ${cmpHasAmount}`);
console.log(`  摊销额来源 = 入参 amortizeFen（num0 归一化），非自算：${cmpHasAmortizeFen}`);
ck('A-0 calcMonthlyProfit/service.js 不含摊销公式引擎（只有双利润引擎，amortizeFen 外部传入）', !cmpHasAmount, `hasAmountFn=${cmpHasAmount}`);
console.log('');

// ---------- 2. 逐字比对 ----------
console.log('【表3 · 逐字比对（以 ①getLedger 为基准）】');
const base = norm(bodies['① getLedger/service.js']);
for (const c of COPIES) {
  const mine = norm(bodies[c.tag]);
  const sameRaw = bodies[c.tag] === bodies['① getLedger/service.js'];
  const sameNorm = mine === base;
  console.log(`  ${c.tag.padEnd(36)} 原文逐字一致=${String(sameRaw).padEnd(5)}  归一化后逐字一致=${sameNorm}`);
}
ck('A-1 三份生产副本 amountForMonth 逐字一致（原文，不归一化）',
  bodies['① getLedger/service.js'] === bodies['② saveLedger/service.js']
  && bodies['① getLedger/service.js'] === bodies['③ getAmortSchedule/service.js'],
  'getLedger==saveLedger==getAmortSchedule');
ck('A-2 exportData 第⑤份经私有前缀归一化后与生产副本逐字一致',
  norm(bodies['④ exportData/index.js']) === base, '抹平 _amountForMonth/_monthIndex 后比对');
ck('A-3 calcAmortize(UTC 锚点版) 是独立实现，不逐字同源',
  norm(bodies['⑤ calcAmortize/service.js(UTC)']) !== base, '不同函数体（getRangeIndex/baseMonthlyFen/formatMonthIndex 辅助）');
console.log('');

// 归约函数（累加式）比对
console.log('【表4 · 归约/累加函数】');
const rGet = norm(extractFn(read('cloudfunctions/getLedger/service.js'), 'amortizeTotalForMonth'));
const rSave = norm(extractFn(read('cloudfunctions/saveLedger/service.js'), 'amortizeTotalForMonth'));
const rSched = norm(extractFn(read('cloudfunctions/getAmortSchedule/service.js'), 'amortizeForMonth'));
const rExp = norm(extractFn(read('cloudfunctions/exportData/index.js'), '_amortizeTotalForMonth'));
console.log(`  getLedger.amortizeTotalForMonth : ${rGet}`);
console.log(`  saveLedger.amortizeTotalForMonth: ${rSave}`);
console.log(`  getAmortSchedule.amortizeForMonth: ${rSched}`);
console.log(`  exportData._amortizeTotalForMonth: ${rExp}`);
ck('A-4 getLedger 与 saveLedger 的归约函数逐字一致', rGet === rSave, rGet === rSave ? '一致' : '不一致');
ck('A-5 exportData 归约函数自带 mode!=lump + start_month 过滤（与页面三处调用点等价）',
  /mode !== 'lump'/.test(rExp) && /start_month/.test(rExp), 'filter 内嵌');
console.log('');

// ---------- 3. 真跑引擎：五份逐月行为比对 ----------
const GL = require(F('cloudfunctions/getLedger/service.js'));
const SL = require(F('cloudfunctions/saveLedger/service.js'));
const GAS = require(F('cloudfunctions/getAmortSchedule/service.js'));
const POC = require(F('cloudfunctions/calcAmortize/service.js'));

// 用源码真构造 exportData 的两份内嵌纯函数（它 require wx-server-sdk，node 直 require 会炸）
const expSrc = read('cloudfunctions/exportData/index.js');
const expMake = new Function(
  extractFn(expSrc, '_monthIndex') + '\n' +
  extractFn(expSrc, '_amountForMonth') + '\n' +
  extractFn(expSrc, '_amortizeTotalForMonth') + '\n' +
  'return { _amountForMonth, _amortizeTotalForMonth };'
)();

function monthsBetween(a, b) {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  const out = [];
  for (let i = y1 * 12 + m1 - 1; i <= y2 * 12 + m2 - 1; i++) {
    out.push(`${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
  }
  return out;
}
const SPAN = monthsBetween('2025-01', '2031-12');
// 用引擎字段名 total_value（引擎读它；真库落 value_fen，由 Controller 映射）
const ASSETS = [
  { asset_id: 'a1', name: '装修36期', total_value: 12000000, start_month: '2026-01', total_months: 36 },
  { asset_id: 'a2', name: '提前终止', total_value: 6000000, start_month: '2026-03', total_months: 24, terminate_month: '2026-08' },
  { asset_id: 'a3', name: '尾差3期', total_value: 100000, start_month: '2026-01', total_months: 3 },
  { asset_id: 'a4', name: '单期跨年', total_value: 99999, start_month: '2027-12', total_months: 1 },
  { asset_id: 'a5', name: '终止早于起(脏)', total_value: 360000, start_month: '2026-05', total_months: 12, terminate_month: '2026-01' },
  { asset_id: 'a6', name: 'lump', total_value: 500000, start_month: '2026-10', total_months: 1, mode: 'lump' },
  { asset_id: 'a7', name: '0期脏数据', total_value: 100000, start_month: '2026-06', total_months: 0 },
];
let diffGL_SL = 0, diffGL_GAS = 0, diffGL_EXP = 0, diffGL_POC = 0;
const diffSamples = [];
for (const a of ASSETS) {
  for (const m of SPAN) {
    const vGL = GL.amountForMonth(a, m);
    const vSL = SL.amountForMonth(a, m);
    const vGAS = GAS.amountForMonth(a, m);
    const vEXP = expMake._amountForMonth(a, m);
    let vPOC; try { vPOC = POC.amountForMonthFen(a, m); } catch (e) { vPOC = 'THROW:' + (e && e.message); }
    if (vGL !== vSL) { diffGL_SL++; if (diffSamples.length < 8) diffSamples.push(`${a.name}@${m} GL=${vGL} SL=${vSL}`); }
    if (vGL !== vGAS) { diffGL_GAS++; if (diffSamples.length < 8) diffSamples.push(`${a.name}@${m} GL=${vGL} GAS=${vGAS}`); }
    if (vGL !== vEXP) { diffGL_EXP++; if (diffSamples.length < 8) diffSamples.push(`${a.name}@${m} GL=${vGL} EXP=${vEXP}`); }
    if (vGL !== vPOC) { diffGL_POC++; if (diffSamples.length < 8) diffSamples.push(`${a.name}@${m} GL=${vGL} POC=${vPOC}`); }
  }
}
const PTS = ASSETS.length * SPAN.length;
console.log('【表5 · 行为比对】资产 7 类 × 月份 ' + SPAN.length + ' 个 = ' + PTS + ' 点，逐点比对 amountForMonth(a,m)');
console.log(`  GL==SL  差异点=${diffGL_SL}`);
console.log(`  GL==GAS 差异点=${diffGL_GAS}`);
console.log(`  GL==EXP 差异点=${diffGL_EXP}`);
console.log(`  GL==POC(UTC版) 差异点=${diffGL_POC}`);
if (diffSamples.length) console.log('  差异样例: ' + diffSamples.join(' | '));
ck('A-6 四份「朴素版」(getLedger/saveLedger/getAmortSchedule/exportData) 全 ' + PTS + ' 点行为完全一致',
  diffGL_SL === 0 && diffGL_GAS === 0 && diffGL_EXP === 0,
  `SL=${diffGL_SL} GAS=${diffGL_GAS} EXP=${diffGL_EXP}`);
ck('A-7 calcAmortize(UTC锚点版) 对全部 ' + PTS + ' 点行为与朴素版一致（含脏边界）',
  diffGL_POC === 0, `差异=${diffGL_POC}  ${diffSamples.join(' | ')}`);
console.log('');

// 末月尾差倒挤（36 期求和 ≡ 原值）与提前终止残值
let sum36 = 0;
for (const m of monthsBetween('2026-01', '2028-12')) sum36 += GL.amountForMonth(ASSETS[0], m);
console.log('【表6 · 闭包/尾差】');
console.log(`  装修36期逐月求和=${sum36} 原值=${ASSETS[0].total_value} 相等=${sum36 === ASSETS[0].total_value}`);
ck('A-8 36 期逐月求和 ≡ 原值（末月尾差倒挤成立）', sum36 === ASSETS[0].total_value, `sum=${sum36}`);
console.log('');

// ---------- 4. mode='lump' 过滤：四个主调用点静态核验 ----------
console.log('【表7 · mode=lump 过滤（调用点静态取证）】');
const CALLERS = [
  { tag: 'getLedger/index.js:157',        rel: 'cloudfunctions/getLedger/index.js',        re: /amortizeTotalForMonth\(amortRows, v\.month\)/, filterRe: /filter\(\(a\) => a\.mode !== 'lump' && a\.start_month\)/ },
  { tag: 'saveLedger/index.js:114',        rel: 'cloudfunctions/saveLedger/index.js',       re: /amortizeTotalForMonth\(ledgerRows\.filter\(\(a\) => a\.mode !== 'lump'\), v\.month\)/, filterRe: /ledgerRows\.filter\(\(a\) => a\.mode !== 'lump'\)/ },
  { tag: 'getAmortSchedule/index.js:108',  rel: 'cloudfunctions/getAmortSchedule/index.js', re: /amortizeForMonth\(assets, v\.month\)/, filterRe: /const assets = rows\.filter\(\(a\) => a\.mode !== 'lump'\)/ },
  { tag: 'exportData/index.js:175',       rel: 'cloudfunctions/exportData/index.js',       re: /_amortizeTotalForMonth\(/, filterRe: /filter\(\(a\) => a\.mode !== 'lump' && a\.start_month\)/ },
];
for (const c of CALLERS) {
  const s = read(c.rel);
  const hit = c.re.test(s), filt = c.filterRe.test(s);
  console.log(`  ${c.tag.padEnd(34)} 调用点=${hit}  前置 mode!=lump 过滤=${filt}`);
  ck('A-9 ' + c.tag + ' 调用前已过滤 mode=lump', hit && filt, `hit=${hit} filt=${filt}`);
}
// calcAmortize/index.js（第4份引擎的 Controller）是否过滤？
const caIdx = read('cloudfunctions/calcAmortize/index.js');
const caNoFilter = /const assets = \(readRes && readRes\.data \|\| \[\]\)\.map\(docToAsset\)/.test(caIdx) && !/mode !== 'lump'/.test(caIdx);
console.log(`  calcAmortize/index.js:42  不过滤 mode=lump = ${caNoFilter}（POC 云函数，无 callFunction 调用方，不在 M1 主取数链路）`);
console.log('');

// ---------- 汇总 ----------
const pass = R.filter(r => r.pass).length;
console.log('==== 断言汇总 ====');
for (const r of R) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
console.log(`\n合计 ${pass}/${R.length} PASS`);
process.exitCode = pass === R.length ? 0 : 1;
