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
sec('E · 喂参完整性（R737 交叉审计第一轮抓出的盲区）');
// 🔴 为什么单独立一段：上面 A/B 段测的是**副本函数本身**，它们全绿也挡不住「上游没把 month 传进来」。
//   本轮实测：getLedger/index.js 调引擎时漏传 month ⇒ 闸门恒 false ⇒
//     2026-11/12 的真实利润每月多算 5,277.78 元，而 service 层单测 100% 通过。
//   ⇒ 只测函数必漏，必须钉**每个调用点**。
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const CALL_SITES = [
  'cloudfunctions/calcMonthlyProfit/index.js',
  'cloudfunctions/saveLedger/index.js',
  'cloudfunctions/getLedger/index.js',
];
{
  const bad = [];
  const detail = [];
  CALL_SITES.forEach((rel) => {
    const src = stripComments(read(rel));
    // 两种调用形态都要支持：
    //   ① calcMonthlyProfit({ month: ..., ... })      —— 字面量直接传
    //   ② calcMonthlyProfit(clean)                    —— 传组装好的变量（calcMonthlyProfit/index.js 就是这样）
    // 只认 ①、遇到 ② 就判「命中 0 处」⇒ 这条检查会空转恒绿（第一版就这么写的，当场被自己抓到）。
    const re = /calcMonthlyProfit\(\s*(\{[^)]*?\}|[A-Za-z_$][\w$]*)\s*\)/g;
    let m;
    let hit = 0;
    while ((m = re.exec(src)) !== null) {
      hit++;
      const arg = m[1];
      let body = arg;
      if (!arg.startsWith('{')) {
        // 传的是变量 ⇒ 找到它的定义块
        const defRe = new RegExp('(?:const|let|var)\\s+' + arg.replace(/\$/g, '\\$') + '\\s*=\\s*\\{');
        const dm = defRe.exec(src);
        body = dm ? src.slice(dm.index, src.indexOf('};', dm.index) + 2) : '';
        if (!body) { bad.push(rel + ' #' + hit + '（传变量 ' + arg + ' 但找不到定义）'); continue; }
      }
      if (!/\bmonth\s*:/.test(body)) bad.push(rel + ' #' + hit + '（' + arg.slice(0, 20) + '）');
    }
    detail.push(rel.split('/').slice(1).join('/') + '=' + hit);
    ck('E-① ' + rel + ' 存在 calcMonthlyProfit 调用点', hit > 0, '命中 ' + hit + ' 处');
  });
  ck('E-② 每个调用点都传了 month（漏传 = 该链路时间闸门失效，且行为测试抓不到）',
    bad.length === 0, bad.length ? ('漏传：' + bad.join(' / ')) : detail.join(' '));
}

// E-③ 出参的「开关」必须报**生效值**，不能回传快照原值。
//   为什么单独钉字面：前端（摊销页页首 / 结果页 amortView / 输入页摘要）读的都是这个字段，
//   它一旦回传快照原值，v2 月份页面就会显示「未计入 / 未开启摊销」，而钱其实扣了 ——
//   R735 那个「同月两页互相打脸」就是这个字段惹的。
{
  const sched = stripComments(read('cloudfunctions/getAmortSchedule/index.js'));
  const ledger = stripComments(read('cloudfunctions/getLedger/index.js'));
  const e3 = [];
  if (!/amortize_switch_on:\s*amortV2\s*\?\s*true\s*:/.test(sched)) {
    e3.push('getAmortSchedule/index.js: amortize_switch_on 未按 v2 修正');
  }
  if (!/const\s+amortV2\s*=\s*amortRuleV2\(\s*v\.month\s*\)/.test(sched)) {
    e3.push('getAmortSchedule/index.js: 没有 amortV2 = amortRuleV2(v.month)');
  }
  if (!/amort_rule_v2:\s*amortV2/.test(sched)) {
    e3.push('getAmortSchedule/index.js: 未透出 amort_rule_v2（前端无法区分「老月份未计入」与「新规则已计入」）');
  }
  if (!/switch_on:\s*result\.amortRuleV2\s*\?\s*true\s*:/.test(ledger)) {
    e3.push('getLedger/index.js: amort_extra.switch_on 未按 v2 修正');
  }
  if (!/amortizeSwitchOn:\s*result\.amortRuleV2\s*\?\s*true\s*:/.test(ledger)) {
    e3.push('getLedger/index.js: switches.amortizeSwitchOn 未按 v2 修正');
  }
  ck('E-③ 两处出参都报「生效值」（前端读的就是这个字段，回传快照原值 = 页面撒谎）',
    e3.length === 0, e3.length ? e3.join(' / ') : '5 个点位全对');
}

// E-④ 归档月**不许重算**摊销 —— 「v2 要重算」与「归档只读」冲突时，归档赢。
//   反例（本轮实测出来的）：2026-11 归档后老板删掉一条资产 ⇒ 若无此保护，
//     封账月的摊销与利润会被今天的台账倒灌改写 ⇒「已归档=只读」第四次变成假话
//     （前三次分别栽在开关快照 R257、归档快照 R735、结果位 R735）。
{
  const gl = stripComments(read('cloudfunctions/getLedger/index.js'));
  const ex = stripComments(read('cloudfunctions/exportData/index.js'));
  const miss = [];
  if (!/amortV2Now\s*&&\s*!isArchiveNow/.test(gl)) miss.push('getLedger: 未加 !isArchiveNow 保护');
  if (!/const\s+isArchiveNow\s*=\s*!!\(acct\s*&&\s*acct\.is_archive\);\s*\n\s*const\s+amortizeFen\s*=/.test(gl)) {
    miss.push('getLedger: isArchiveNow 未在摊销取数**之前**声明（顺序错 ⇒ 保护失效）');
  }
  // ⚠️ 必须钉**摊销取数那一行**的形态，不能只要求「文件里某处出现过 !isArchiveRow」——
  //   第一版判据就是后者，我变异掉 `const amort = ...` 那一行、留着 realP/diffFen 两处，
  //   断言照样绿（假绿，当场被自己抓到）。判据要收在**真正决定金额的那一行**上。
  if (!/const\s+amort\s*=\s*\(amortV2\s*&&\s*!isArchiveRow\)\s*\?/.test(ex)) {
    miss.push('exportData: 摊销取数那一行缺 !isArchiveRow 保护（会与页面打架）');
  }
  ck('E-④ 归档月不重算摊销（归档只读优先于 v2 重算；两处都要有，缺一处就打架）',
    miss.length === 0, miss.length ? miss.join(' / ') : 'getLedger + exportData 双双在位');
}

// ============================================================================
sec('F · 导出件口径（R737 第二轮：导出件与页面必须同数）');
// 症状（本轮 fixture 实测）：R736 部署前保存的 2026-11（落库摊销 0、快照 false），
//   页面走重算显示 5,277.78，导出件念落库 0 ⇒ 老板拿导出件对账，认定系统算错，
//   且利润表「经营参考 − 摊销」跟「全要素真实利润」差一整笔，表内不平。
{
  const Module = require('module');
  const _origLoad = Module._load;
  const dbStub = {
    command: { in: (x) => x, eq: (x) => x },
    serverDate: () => 0,
    collection: () => ({ where: () => ({ get: async () => ({ data: [] }) }) }),
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return { init() {}, DYNAMIC_CURRENT_ENV: 'stub', database: () => dbStub };
    return _origLoad.apply(this, arguments);
  };
  const EXP = require(path.join(ROOT, 'cloudfunctions/exportData/index.js'));
  Module._load = _origLoad;

  const ASSETS_T = [
    { asset_id: 'a1', name: '装修', mode: 'amort', start_month: '2026-09', total_months: 36, total_value: 13000000 },
    { asset_id: 'a2', name: '设备', mode: 'amort', start_month: '2026-10', total_months: 24, total_value: 4000000 },
    { asset_id: 'a3', name: '转让费', mode: 'lump', start_month: '2026-09', total_months: 1, total_value: 5000000 },
  ];
  const LEDGER_1011 = 361111 + 166667;   // 2026-10/11 台账应摊（手算，不用被测代码）
  function mkRow(month, savedAmort, savedOn) {
    const inc = 10000000, exp = 3000000, real = 2000000, lump = 5000000;
    const opRef = inc - exp - real - lump;
    return {
      month, income_items: [], expense_items: [],
      income_total_fen: inc, expense_total_fen: exp,
      direct_consume_fen: real, real_consume_fen: real,
      amortize_fen: savedAmort, lump_sum_fen: lump,
      operation_ref_profit_fen: opRef,
      total_factor_real_profit_fen: opRef - savedAmort,
      profit_diff_fen: savedAmort,
      gross_profit_fen: inc - real, gross_margin_pct: 80,
      ref_material_source: 'direct',
      switch_used: { inventorySwitchOn: false, amortizeSwitchOn: savedOn },
    };
  }
  // 金额列位置随表而变（利润表 [1]、摊销来源表最后一列）⇒ 从右往左找第一个数字
  function rowFen(row) {
    if (!row) return NaN;
    for (let i = row.length - 1; i >= 0; i--) {
      const c = row[i];
      if (c === '' || c == null) continue;
      const n = Number(c);
      if (Number.isFinite(n)) return Math.round(n * 100);
    }
    return NaN;
  }
  function findRow(rows, key) {
    return (rows || []).find((r) => (r || []).some(
      (c) => String(c == null ? '' : c).replace(/[\s　]/g, '').indexOf(key) >= 0));
  }
  function build(month, savedAmort, savedOn) {
    return EXP.buildMonthlySheets({
      shopName: 'T', month, stamp: 0, row: mkRow(month, savedAmort, savedOn), assets: ASSETS_T,
    });
  }

  // F-① v2 月份，部署前保存的账：摊销必须按台账重算，不许念落库 0
  {
    const sh = build('2026-11', 0, false);
    const rows = sh.find((s) => s.name === '利润表').rows;
    const amort = rowFen(findRow(rows, '减：当月摊销'));
    ck('F-① v2 月份导出件摊销 = 台账应摊 5,277.78（不念落库 0）',
      amort === LEDGER_1011, '实得 ' + amort);
    // F-② 表内恒等式：真实利润 = 经营参考 − 消耗差异 − 摊销（本 fixture 消耗差异为 0）
    const realP = rowFen(findRow(rows, '全要素真实利润'));
    const opRef = rowFen(findRow(rows, '经营参考利润'));
    ck('F-② 导出件表内加减必须成立（老板拿计算器核这张表）',
      realP === opRef - amort, '真实=' + realP + ' 参考−摊销=' + (opRef - amort));
    // F-③ v2 月份不得出现「台账应收摊销（开关关闭…）」差异行
    const hasDiff = !!findRow(sh.find((s) => s.name === '摊销来源').rows, '台账应收摊销');
    ck('F-③ v2 月份不得出现「开关关闭·本月未计入」差异行（会让老板以为没扣）', !hasDiff, '差异行存在');
    // F-④ 口径说明表写「不适用」而不是「关」
    const amRow = findRow(sh.find((s) => s.name === '口径说明').rows, '摊销开关');
    ck('F-④ 口径说明表对 v2 月份写「不适用」', /不适用/.test(String(amRow[1])), String(amRow[1]));
  }
  // F-⑤ 老月份（2026-10）历史不许改：摊销仍读落库 0，且差异行照出
  {
    const sh = build('2026-10', 0, false);
    const rows = sh.find((s) => s.name === '利润表').rows;
    const amort = rowFen(findRow(rows, '减：当月摊销'));
    const diff = rowFen(findRow(sh.find((s) => s.name === '摊销来源').rows, '台账应收摊销'));
    ck('F-⑤ 老月份摊销仍为落库 0（历史一字不改），同时给出台账应收差异行',
      amort === 0 && diff === LEDGER_1011, '摊销=' + amort + ' 差异行=' + diff);
    const amRow = findRow(sh.find((s) => s.name === '口径说明').rows, '摊销开关');
    ck('F-⑥ 老月份口径说明如实写「关」', /^关$/.test(String(amRow[1])), String(amRow[1]));
  }
  // F-⑦ 尾差倒挤：36 期合计必须正好等于原值（一分不多一分不少）
  {
    const sh = build('2029-08', 0, false);   // 装修末月 = 2026-09 + 35
    const amort = rowFen(findRow(sh.find((s) => s.name === '利润表').rows, '减：当月摊销'));
    ck('F-⑦ 末月尾差倒挤（2029-08 装修末月 = 361,115 分；设备 24 期已摊完）',
      amort === 361115, '实得 ' + amort);
  }
}

// ============================================================================
sec('D · 自失效护栏（锚点漂移会让上面两条恒绿）');
ck('D-① 两个变异锚点在当前源码中都存在',
  SRC.main.indexOf("const AMORT_RULE_V2_FROM = '2026-11';") >= 0
  && SRC.main.indexOf('const effectiveAmortizeFen = (amortV2 || amortizeSwitchOn) ? fenRoundN(amortizeFen) : 0;') >= 0,
  '锚点在位');
ck('D-② 断言总数 ≥ 15（防本文件被掏空后仍报「全绿」）', pass + fail >= 15, String(pass + fail));
// D-③ R737：导出段的四个变异锚点也必须在位（不在位 ⇒ F 段是假绿）
{
  const expSrc = read('cloudfunctions/exportData/index.js');
  const anchors = [
    'const amort = (amortV2 && !isArchiveRow) ? amortLedger : nz(row.amortize_fen);',
    'const amOn = amortV2 ? true : !!sw.amortizeSwitchOn;',
    'if (end === naturalEnd) return asset.total_value - base * (N - 1);',
    'const realP = (amortV2 && !isArchiveRow) ? Math.round(opRef - gapFen - amort) : nz(row.total_factor_real_profit_fen);',
  ];
  const miss = anchors.filter((a) => expSrc.indexOf(a) < 0);
  ck('D-③ 导出段四个变异锚点在位（漂移 ⇒ F 段恒绿）', miss.length === 0, miss.length ? ('缺：' + miss.join(' / ')) : '四个都在');
}

// ============================================================================
console.log('\n摊销规则 v2（时间闸门）结果：' + pass + ' 通过 / ' + fail + ' 失败（共 ' + (pass + fail) + ' 条）');
if (fail) {
  console.log('\n—— 失败项 ——');
  fails.forEach((f) => console.log('  · ' + f));
}
process.exit(fail ? 1 : 0);
