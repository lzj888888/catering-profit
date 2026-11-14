#!/usr/bin/env node
// tools/check_amort_rule_v2.js —— R736：摊销规则 v2（时间闸门）常驻守卫
//
// 为什么需要它：
//   李老师 2026-11-15 拍板「摊销区不该有这个开关」——摊销资产填了总额和期数就是要摊，
//   再给一个开关去否掉它，等于同一个决定问两次。三家会诊（豆包 ×2 + DeepSeek）一致：
//   删掉用户可见开关，摊销一律按台账计入；「不摊」走「一次算清」（mode='lump'）。
//
//   但**历史月份一个字都不许改** —— 老板翻旧账发现利润少了 4,333，会认定系统算错。
//   ⇒ 用**时间闸门** `AMORT_RULE_V2_FROM`：该月起一律计入，更早的月份仍按老逻辑。
//
//   这个闸门必须出现在**四份文件**里（微信云函数独立打包，跨函数 require 在云端
//   MODULE_NOT_FOUND ⇒ 只能是多副本 + 守卫）：
//     ① cloudfunctions/calcMonthlyProfit/service.js   —— 主引擎
//     ② cloudfunctions/saveLedger/service.js          —— 写侧内嵌副本（落库）
//     ③ cloudfunctions/getLedger/service.js           —— 读侧内嵌副本（归档重算）
//     ④ cloudfunctions/getAmortSchedule/service.js    —— 摊销页出参
//   本轮实测**真的漏过一份**（②saveLedger/service.js），症状极阴：
//     页面按新规则报「已计入」，落库的 effective_amortize_fen 却是 0 ⇒ 导出月报与页面打架。
//   ⇒ 四条腿逐个点名，缺一条即红。
//
// 取证层级：L1 源码面 + **真跑四个生产函数**（行为面），外加变异回灌证明判据非恒真。
//
// 运行：node tools/check_amort_rule_v2.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FILES = {
  main: 'cloudfunctions/calcMonthlyProfit/service.js',
  save: 'cloudfunctions/saveLedger/service.js',
  get: 'cloudfunctions/getLedger/service.js',
  sched: 'cloudfunctions/getAmortSchedule/service.js',
};
const ENGINE3 = ['main', 'save', 'get'];

let pass = 0, fail = 0;
const fails = [];
function ck(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '   « ' + detail + ' »' : '')); }
  else { fail++; fails.push(name + (detail ? '  « ' + detail + ' »' : '')); console.log('  ❌ ' + name + (detail ? '   « ' + detail + ' »' : '')); }
}
const sec = (t) => console.log('\n【' + t + '】');

const SRC = {};
Object.keys(FILES).forEach((k) => { SRC[k] = read(FILES[k]); });

// ============================================================================
sec('A · 源码面（四份副本同源，缺一条腿即某条链路静默错账）');

// A-① 四份都有同一个常量，且值逐字相同
const RE_FROM = /const AMORT_RULE_V2_FROM = '(\d{4}-\d{2})';/;
const fromVals = {};
Object.keys(FILES).forEach((k) => {
  const m = SRC[k].match(RE_FROM);
  fromVals[k] = m ? m[1] : null;
});
const allSame = Object.values(fromVals).every((v) => v && v === fromVals.main);
ck('A-① 🔴 四份文件都有 AMORT_RULE_V2_FROM，且值逐字相同',
  allSame, JSON.stringify(fromVals));

// A-② 闸门判据形态一致：都是「字符串比较 >= 常量」（不许某一份改成 Date 比较/数字比较）
//   ⚠️ 不能写 `String\([^)]*\)` —— save/get 两份的括号里是 `(clean && clean.month) || ''`，
//     内层括号会提前闭合，正则匹配到一半就断（本轮 A-② 首跑就是这么红的，属判据写窄不是代码错）。
const RE_GATE = /String\([\s\S]{0,80}?\)\s*>=\s*AMORT_RULE_V2_FROM/;
const gateHit = {};
Object.keys(FILES).forEach((k) => {
  // getAmortSchedule 走的是具名函数 amortRuleV2，其余是就地写
  gateHit[k] = RE_GATE.test(SRC[k]) || /function amortRuleV2\(month\)\s*\{\s*return String\(month \|\| ''\) >= AMORT_RULE_V2_FROM/.test(SRC[k]);
});
ck('A-② 四份闸门判据同形（都是 month 字符串比较，不混用 Date/数字）',
  Object.values(gateHit).every(Boolean), JSON.stringify(gateHit));

// A-③ 三份引擎的归零腿都在：`(amortV2 || amortizeSwitchOn) ? ... : 0`
const legHit = ENGINE3.map((k) => /effectiveAmortizeFen\s*=\s*\(amortV2 \|\| amortizeSwitchOn\)\s*\?[^;]*:\s*0;/.test(SRC[k]));
ck('A-③ 三份引擎的「关掉 ⇒ 归 0」腿都在（老月份口径没被顺手删掉）',
  legHit.every(Boolean), JSON.stringify(legHit));

// A-④ 写侧/读侧的快照都报「生效值」（v2 月份恒 true），否则归档后两页互相打脸
const snapHit = ENGINE3.map((k) => /switchUsed:\s*\{[^}]*amortizeSwitchOn: amortV2 \? true : amortizeSwitchOn/.test(SRC[k]));
ck('A-④ 三份引擎的 switchUsed 都记「生效值」（v2 月份恒 true，防归档后读快照打架）',
  snapHit.every(Boolean), JSON.stringify(snapHit));

// A-⑤ 摊销页出参带 amort_rule_v2（前端据此渲染「旧规则未计入」说明）
const schedIdx = read('cloudfunctions/getAmortSchedule/index.js');
ck('A-⑤ getAmortSchedule 出参带 amort_rule_v2，且 amortize_switch_on 在 v2 月份恒 true',
  /amort_rule_v2:\s*amortV2/.test(schedIdx) && /amortize_switch_on:\s*amortV2 \? true : amortizeSwitchOn/.test(schedIdx),
  'index.js 命中=' + /amort_rule_v2:\s*amortV2/.test(schedIdx));

// A-⑥ 前端已无开关：模板无 switch 组件、页面无 onToggleAmortize 方法
const wxml = read('subpkg/biz/month/amortize.wxml');
const pageCode = read('subpkg/biz/month/amortize.js')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
ck('A-⑥ 🔴 摊销页已无开关入口（模板无 switch 组件 + 页面无 onToggleAmortize 方法；剥注释后判）',
  !/<switch[\s>]/.test(wxml) && !/onToggleAmortize\s*\(/.test(pageCode),
  'switch=' + /<switch[\s>]/.test(wxml) + ' 方法=' + /onToggleAmortize\s*\(/.test(pageCode));

// A-⑦ 数据库字段与读取逻辑**保留**（删字段等于改写历史）
ck('A-⑦ shop_switch.amortize_switch 的读取仍在（历史月份要靠它，不许一删了之）',
  /amortize_switch/.test(read('cloudfunctions/getLedger/index.js'))
  && /amortize_switch/.test(schedIdx),
  '读侧仍读该键');

// ============================================================================
sec('B · 行为面（真跑生产函数，不看字面）');

const mainExp = require(path.join(ROOT, FILES.main));
const saveExp = require(path.join(ROOT, FILES.save));
const getExp = require(path.join(ROOT, FILES.get));

const BASE = {
  incomeItems: [{ amountFen: 10000000 }],
  expenseItems: [{ amountFen: 3000000 }],
  directConsumeFen: 2000000,
  amortizeFen: 433333,
  amortizeSwitchOn: false,
  inventorySwitchOn: false,
  inventory: {},
  lumpSumFen: 0,
};
const run = (exp, month) => exp.calcMonthlyProfit(Object.assign({}, BASE, { month }));

const r10 = run(mainExp, '2026-10');
const r11 = run(mainExp, '2026-11');
const r12 = run(mainExp, '2027-01');
const rEmpty = run(mainExp, '');

ck('B-① 2026-10（生效月之前）+ 开关关 ⇒ 摊销不扣（历史口径原封不动）',
  r10.effectiveAmortizeFen === 0 && r10.amortRuleV2 === false,
  'effective=' + r10.effectiveAmortizeFen + ' v2=' + r10.amortRuleV2);
ck('B-② 🔴 2026-11（生效月）+ 开关关 ⇒ 摊销照样扣满（开关已无话语权）',
  r11.effectiveAmortizeFen === 433333 && r11.amortRuleV2 === true,
  'effective=' + r11.effectiveAmortizeFen + ' v2=' + r11.amortRuleV2);
ck('B-③ 生效月之后（2027-01）⇒ 仍然扣满（闸门不是只开一个月）',
  r12.effectiveAmortizeFen === 433333, 'effective=' + r12.effectiveAmortizeFen);
ck('B-④ month 为空 ⇒ 回落老逻辑（fail-safe：宁可少扣，不许凭空改写未知月份的账）',
  rEmpty.effectiveAmortizeFen === 0 && rEmpty.amortRuleV2 === false,
  'effective=' + rEmpty.effectiveAmortizeFen);
{
  const rOn = mainExp.calcMonthlyProfit(Object.assign({}, BASE, { month: '2026-10', amortizeSwitchOn: true }));
  ck('B-⑤ 【对照】2026-10 + 开关开 ⇒ effective = 433333（证明 B-① 不是恒 0，老逻辑没被搞坏）',
    rOn.effectiveAmortizeFen === 433333, 'effective=' + rOn.effectiveAmortizeFen);
}
ck('B-⑥ 🔴 三份引擎对同一输入给出**同一个数**（副本漂移 = 页面/落库/回读三套口径）',
  [saveExp, getExp].every((e) => run(e, '2026-11').effectiveAmortizeFen === r11.effectiveAmortizeFen),
  'main=' + r11.effectiveAmortizeFen
  + ' save=' + run(saveExp, '2026-11').effectiveAmortizeFen
  + ' get=' + run(getExp, '2026-11').effectiveAmortizeFen);
ck('B-⑦ 利润确实跟着变（不是只改了标签）：10 月真实利润比 11 月多 4,333.33',
  r10.totalFactorRealProfitFen - r11.totalFactorRealProfitFen === 433333,
  '差=' + (r10.totalFactorRealProfitFen - r11.totalFactorRealProfitFen));

// ============================================================================
sec('C · 变异回灌（证明 A/B 不是恒真）');

function loadMutant(rel, from, to) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, 'utf8');
  if (src.indexOf(from) < 0) return { err: '变异锚点未找到：' + from };
  const Module = require('module');
  const m = new Module(abs, module);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(src.replace(from, to), abs);
  return { exp: m.exports };
}

// C-① 把生效月推到 2099 ⇒ 2026-11 应回到「不扣」
{
  const mut = loadMutant(FILES.main, "const AMORT_RULE_V2_FROM = '2026-11';", "const AMORT_RULE_V2_FROM = '2099-01';");
  let caught = false, detail = mut.err || '';
  if (mut.exp) {
    const r = mut.exp.calcMonthlyProfit(Object.assign({}, BASE, { month: '2026-11' }));
    caught = r.effectiveAmortizeFen === 0;
    detail = '变异后 effective=' + r.effectiveAmortizeFen + '（期望 0）';
  }
  ck('C-① 变异：把生效月推到 2099 ⇒ B-② 当场转红（闸门真的在起作用）', caught, detail);
}

// C-② 摘掉闸门整条腿 ⇒ 2026-11 仍扣（说明闸门不是摆设）
{
  const mut = loadMutant(FILES.main,
    'const effectiveAmortizeFen = (amortV2 || amortizeSwitchOn) ? fenRoundN(amortizeFen) : 0;',
    'const effectiveAmortizeFen = fenRoundN(amortizeFen);');
  let caught = false, detail = mut.err || '';
  if (mut.exp) {
    const r = mut.exp.calcMonthlyProfit(Object.assign({}, BASE, { month: '2026-10' }));
    caught = r.effectiveAmortizeFen === 433333;
    detail = '变异后 10 月 effective=' + r.effectiveAmortizeFen + '（期望 433333，即旧口径被破坏）';
  }
  ck('C-② 变异：摘掉开关判据 ⇒ 2026-10 也照扣（B-① 能抓到旧口径被破坏）', caught, detail);
}

// ============================================================================
sec('D · 自失效护栏（锚点漂移会让上面两条恒绿）');
ck('D-① 两个变异锚点在当前源码中都存在',
  SRC.main.indexOf("const AMORT_RULE_V2_FROM = '2026-11';") >= 0
  && SRC.main.indexOf('const effectiveAmortizeFen = (amortV2 || amortizeSwitchOn) ? fenRoundN(amortizeFen) : 0;') >= 0,
  '锚点在位');
ck('D-② 断言总数 ≥ 15（防本文件被掏空后仍报「全绿」）', pass + fail >= 15, String(pass + fail));

// ============================================================================
console.log('\n摊销规则 v2（时间闸门）结果：' + pass + ' 通过 / ' + fail + ' 失败（共 ' + (pass + fail) + ' 条）');
if (fail) {
  console.log('\n—— 失败项 ——');
  fails.forEach((f) => console.log('  · ' + f));
}
process.exit(fail ? 1 : 0);
