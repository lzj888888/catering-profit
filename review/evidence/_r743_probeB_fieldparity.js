#!/usr/bin/env node
// _r743_probeB_fieldparity.js —— R743 独立审计探针 C：读侧字段映射 / 过滤一致性（R739 只修了「读不到」，没修「读得不一样」）
// 只读：fs.readFileSync + new Function 复现源码映射表达式 + 真跑引擎，绝不修改任何现有文件。
// 运行： node review/evidence/_r743_probeB_fieldparity.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');
const GL = require(F('cloudfunctions/getLedger/service.js')); // 4 份朴素版引擎已证全等，取其一

const R = [];
const ck = (name, pass, detail) => { R.push({ name, pass: !!pass, detail: detail || '' }); };
console.log('==== R743 · 探针C · 读侧字段优先级 / start_month 过滤一致性 ====\n');

// 从源码中抓「映射表达式」（抓的是**实际代码行**，不是注释自述）
function grabExpr(rel, re) {
  const src = read(rel);
  const m = src.match(re);
  return m ? m[1].trim() : null;
}
const MAP = [
  { tag: 'getLedger/index.js:143',      rel: 'cloudfunctions/getLedger/index.js',        re: /total_value:\s*(a\.value_fen != null \? a\.value_fen : a\.total_value)/ },
  { tag: 'saveLedger/index.js:106',     rel: 'cloudfunctions/saveLedger/index.js',       re: /total_value:\s*(a\.value_fen != null \? a\.value_fen : a\.total_value)/ },
  { tag: 'getAmortSchedule/index.js:93',rel: 'cloudfunctions/getAmortSchedule/index.js', re: /total_value:\s*(a\.value_fen != null \? a\.value_fen : a\.total_value)/ },
  { tag: 'exportData/index.js:177(引擎)',rel: 'cloudfunctions/exportData/index.js',      re: /total_value:\s*(a\.total_value != null \? a\.total_value : \(a\.value_fen \|\| 0\))/ },
  { tag: 'exportData/index.js:277(表3)', rel: 'cloudfunctions/exportData/index.js',      re: /const valFen =\s*(a\.value_fen != null \? nz\(a\.value_fen\) : nz\(a\.total_value\))/ },
  { tag: 'calcAmortize/validate.js:64',rel: 'cloudfunctions/calcAmortize/validate.js',  re: /const total =\s*(\(doc\.total_value != null\) \? doc\.total_value : doc\.value_fen)/ },
];

// ===================== 1. 双字段并存：value_fen(新) vs total_value(旧) =====================
console.log('【表1 · 双字段并存资产：{ value_fen:12000000(新/页面该用), total_value:6000000(旧/种子残留) }】');
// 可达路径：seed_demo.js:198 落 total_value；saveAsset/index.js:116 编辑后补写 value_fen ⇒ 两字段并存且值不同
const DUAL = { asset_id: 'x', name: '装修', value_fen: 12000000, total_value: 6000000, start_month: '2026-01', total_months: 36, mode: 'amort' };
console.log(`  取证：specs/dev-specs/prototype/seed_demo.js:198 写 total_value；saveAsset/index.js:116,137 写 value_fen（不删 total_value）`);
const vals = {};
for (const m of MAP) {
  const expr = grabExpr(m.rel, m.re);
  if (!expr) { console.log(`  ${m.tag.padEnd(36)} 抓不到表达式`); continue; }
  // 表3 用 nz()，提供一个等价 nz
  const nz = (x) => Number(x) || 0;
  let v;
  try { v = new Function('a', 'doc', 'nz', 'return ' + expr)(DUAL, DUAL, nz); }
  catch (e) { v = 'ERR:' + e.message; }
  vals[m.tag] = v;
  // 用该值喂引擎算 2026-01 当月摊销
  const asset = Object.assign({}, DUAL, { total_value: v });
  const amt = GL.amountForMonth(asset, '2026-01');
  console.log(`  ${m.tag.padEnd(36)} 取到=${String(v).padEnd(10)} ⇒ 2026-01 当月摊销=${amt} 分`);
}
const pageVal = vals['getLedger/index.js:143'];
const expVal = vals['exportData/index.js:177(引擎)'];
const expTblVal = vals['exportData/index.js:277(表3)'];
console.log(`  ⇒ 页面(getLedger/saveLedger/getAmortSchedule) 取 ${pageVal}；exportData 引擎取 ${expVal}；exportData 表3 又取 ${expTblVal}`);
ck('C-1 双字段并存时 exportData 引擎与页面三处取到【不同原值】', pageVal !== expVal, `page=${pageVal} exp=${expVal}`);
ck('C-2 exportData 同一个文件内 :177 与 :277 优先级相反 ⇒ 表内自相矛盾', expVal !== expTblVal, `:177=${expVal} :277=${expTblVal}`);
ck('C-3 calcAmortize/validate.js 与页面三处优先级也相反', vals['calcAmortize/validate.js:64'] !== pageVal,
  `POC=${vals['calcAmortize/validate.js:64']} page=${pageVal}`);
console.log('');

// ===================== 2. start_month 脏/缺失：四条取数链路是否分叉 =====================
console.log('【表2 · start_month 缺失的脏行（mode=amort）在各取数链路的当月摊销合计】');
const DIRTY = [
  { asset_id: 'd1', name: '脏行', value_fen: 12000000, start_month: '', total_months: 36, mode: 'amort' },
];
const FILTERS = [
  { tag: 'getLedger/index.js:141',   hasStart: true,  re: /filter\(\(a\) => a\.mode !== 'lump' && a\.start_month\)/ },
  { tag: 'saveLedger/index.js:114',  hasStart: false, re: /ledgerRows\.filter\(\(a\) => a\.mode !== 'lump'\)/ },
  { tag: 'getAmortSchedule/index.js:105', hasStart: false, re: /const assets = rows\.filter\(\(a\) => a\.mode !== 'lump'\)/ },
  { tag: 'exportData/index.js:147',  hasStart: true,  re: /filter\(\(a\) => a\.mode !== 'lump' && a\.start_month\)/ },
];
const chainTotals = {};
for (const f of FILTERS) {
  const srcHas = f.re.test(read('cloudfunctions/' + f.tag.split('/')[0] + '/index.js'));
  const kept = f.hasStart ? DIRTY.filter((a) => a.mode !== 'lump' && a.start_month) : DIRTY.filter((a) => a.mode !== 'lump');
  const total = kept.reduce((s, a) => s + GL.amountForMonth(Object.assign({}, a, { total_value: a.value_fen }), '2026-01'), 0);
  chainTotals[f.tag] = total;
  console.log(`  ${f.tag.padEnd(36)} 过滤含 a.start_month = ${String(f.hasStart).padEnd(5)}(源码命中=${srcHas})  保留行数=${kept.length}  当月摊销合计=${total} 分`);
}
const distinct = new Set(Object.values(chainTotals));
console.log(`  ⇒ 四条链路当月摊销合计的不同取值数 = ${distinct.size}（${[...distinct].join(' / ')}）`);
ck('C-4 start_month 缺失脏行导致 4 条取数链路结果分叉（2 条计 0、2 条计入 base）',
  distinct.size === 2, `取值=${[...distinct].join(',')}`);
ck('C-5 saveLedger 会把 start_month 缺失行算出 base 并落库（而 getLedger 未归档月重算显示 0）',
  chainTotals['saveLedger/index.js:114'] > 0 && chainTotals['getLedger/index.js:141'] === 0,
  `save=${chainTotals['saveLedger/index.js:114']} get=${chainTotals['getLedger/index.js:141']}`);
console.log('');

// ===================== 3. total_months 字符串脏：读侧无类型守卫 =====================
console.log('【表3 · total_months = 字符串 "36"（脏数据）在引擎里的行为】');
const STR = { asset_id: 's', name: '字符串月数', total_value: 12000000, start_month: '2026-01', total_months: '36', mode: 'amort' };
const a1 = GL.amountForMonth(STR, '2026-01');
const a2031 = GL.amountForMonth(STR, '2031-12');
const a2099 = GL.amountForMonth(STR, '2099-01');
console.log(`  2026-01=${a1} 分  2031-12=${a2031} 分  2099-01=${a2099} 分（正常 36 期资产 2029-01 起应为 0）`);
ck('C-6 total_months 为字符串 ⇒ 区间被字符串拼接放大，资产【永不摊完】且末月尾差倒挤失效',
  a2031 > 0 && a2099 > 0, `2031=${a2031} 2099=${a2099}`);
// 读侧是否有类型守卫：calcAmortize/validate.js 有 docToAsset；4 个主 Controller 只有映射无校验
const mainCtrlGuarded = ['getLedger', 'saveLedger', 'getAmortSchedule', 'exportData']
  .some((n) => /typeof a\.total_months|Number\.isInteger\(a\.total_months/.test(read('cloudfunctions/' + n + '/index.js')));
console.log(`  4 个主 Controller 读侧对 total_months 有类型守卫 = ${mainCtrlGuarded}（calcAmortize/validate.js::docToAsset 有，但主链路不用它）`);
ck('C-7 主取数链路（getLedger/saveLedger/getAmortSchedule/exportData）读侧无字段类型守卫，仅有写侧 validate 兜底',
  !mainCtrlGuarded, `guarded=${mainCtrlGuarded}`);
console.log('');

// ===================== 5. 汇总 =====================
const pass = R.filter((r) => r.pass).length;
console.log('==== 断言汇总 ====');
for (const r of R) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
console.log(`\n合计 ${pass}/${R.length} PASS（PASS 均表示「不一致/缺陷存在被复现」）`);
process.exitCode = pass === R.length ? 0 : 1;
