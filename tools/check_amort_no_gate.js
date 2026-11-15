#!/usr/bin/env node
// tools/check_amort_no_gate.js —— 摊销「无闸门」守卫（R740）
//
// 【它取代了谁】
//   本文件取代 `check_amort_rule_v2.js`（R736 立的 31 条「时间闸门守卫」）。
//   那个文件的每一条断言都在确认"闸门存在且生效"；R740 把闸门拆了，
//   于是它的每一条都变成了"确认一个已经不存在的东西"。
//
// 【为什么拆闸门】
//   R736 留闸门的理由是「历史月份一个字都不许改」。但实测下来：
//     · 小程序尚未上线，不存在「别的老板已经看过的历史数字」；
//     · 被挡住的月份不是「延后扣」，是**永久蒸发** —— 36 期资产逐月求和会少掉整个闸门区间
//       （2026-08 起摊的 36,000 元装修：带闸门 36 期求和 33,000，摊完也补不回来）；
//     · 开关早已从 UI 删除，用户**没有任何界面**能为历史月表达「这笔我要摊」。
//   冻结职责从此**只由「归档」承担**（is_archive ⇒ 读落库快照）。归档是用户主动动作、
//   语义明确、可撤销；日期闸门是代码里写死的常量，用户看不见也动不了。
//
// 【本守卫的五层】
//   A · 结构：五份文件里再也找不到闸门（常量/函数/判据/变量全无）
//   B · 行为：三份引擎副本对任何月份、任何开关值都一律计入
//   C · 闭包：逐月求和 ≡ 资产原值（闸门时代这里会少一截，是本轮最硬的判据）
//   D · 接线：四个调用点都按台账取数、都传 month；归档优先仍在
//   E · 变异回灌：把判据塞回去 / 把归档判据摘掉，上面的断言必须转红
//
// 用法：node tools/check_amort_no_gate.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');
const Y = 100;

const R = [];
let curGroup = '';
function group(name) { curGroup = name; }
function ck(name, pass, detail) {
  R.push({ group: curGroup, name, pass: !!pass, detail: detail || '' });
}
const yuan = (fen) => (fen / Y).toFixed(2);

// ===================== 被测文件 =====================
const FILES = {
  main: 'cloudfunctions/calcMonthlyProfit/service.js',
  get: 'cloudfunctions/getLedger/service.js',
  save: 'cloudfunctions/saveLedger/service.js',
  sched: 'cloudfunctions/getAmortSchedule/service.js',
  exp: 'cloudfunctions/exportData/index.js',
  glIdx: 'cloudfunctions/getLedger/index.js',
  slIdx: 'cloudfunctions/saveLedger/index.js',
  schIdx: 'cloudfunctions/getAmortSchedule/index.js',
};
const SRC = {};
for (const k in FILES) SRC[k] = read(FILES[k]);

// 三份引擎副本（纯函数，可直接 require）
const ENGINES = [
  ['calcMonthlyProfit', require(F('cloudfunctions/calcMonthlyProfit/service.js')).calcMonthlyProfit],
  ['getLedger', require(F('cloudfunctions/getLedger/service.js')).calcMonthlyProfit],
  ['saveLedger', require(F('cloudfunctions/saveLedger/service.js')).calcMonthlyProfit],
];
const sched = require(F('cloudfunctions/getAmortSchedule/service.js'));

// 业务数据：装修 120,000 / 36 期 + 设备 60,000 / 60 期 ⇒ 月摊 4,333.33
const LEDGER_MONTHLY = Math.round((120000 * Y) / 36 + (60000 * Y) / 60); // 433333
const INCOME = [{ amountFen: 800000 }];
const EXPENSE = [{ amountFen: 360000 }];
const DIRECT = 120000;
const LUMP = 0;

// ==================================================================
group('A · 结构：闸门在五份文件里彻底不存在');
// ==================================================================

const hasGateConst = Object.keys(FILES).filter((k) => SRC[k].indexOf('AMORT_RULE_V2_FROM') >= 0);
ck('A-① 八份文件都不含 AMORT_RULE_V2_FROM（常量已删，不是"改成很早的日期"）',
  hasGateConst.length === 0, hasGateConst.length ? '仍有：' + hasGateConst.join(',') : '全部已清除');

const hasGateFn = Object.keys(FILES).filter((k) => /amortRuleV2/.test(SRC[k]));
ck('A-② 八份文件都不含 amortRuleV2 标识符（含注释，防止"注释里还留着一份判据"误导后人）',
  hasGateFn.length === 0, hasGateFn.length ? '仍有：' + hasGateFn.join(',') : '全部已清除');

// 三份引擎：effectiveAmortizeFen 必须是无条件单行
const ENG_LINE = {
  main: /const effectiveAmortizeFen = fenRoundN\(amortizeFen\);/,
  get: /const effectiveAmortizeFen = Math\.round\(amortizeFen\);/,
  save: /const effectiveAmortizeFen = Math\.round\(amortizeFen\);/,
};
const badEng = Object.keys(ENG_LINE).filter((k) => !ENG_LINE[k].test(SRC[k]));
ck('A-③ 三份引擎的 effectiveAmortizeFen 都是**无条件**单行赋值（无三元、无 if）',
  badEng.length === 0, badEng.length ? '不合形：' + badEng.join(',') : '三份同形');

const withSwitchVar = ['main', 'get', 'save'].filter((k) => /const amortizeSwitchOn\s*=/.test(SRC[k]));
ck('A-④ 三份引擎都不再定义 amortizeSwitchOn 局部变量（开关已退出计算链）',
  withSwitchVar.length === 0, withSwitchVar.length ? '仍有：' + withSwitchVar.join(',') : '已清除');

// 归档优先判据必须保留（这是唯一该留的冻结机制）
// 🔴 R744：不再钉"三元逐字长这样" —— 处置损失并入后，未归档分支多一项，
//   旧的精确正则会把**等价改写**判假红（gate-suite-checklist §13 反向伤害第二型：形态窄）。
//   改判语义：① 有 isArchiveNow 三元 ② 归档分支读 acct.amortize_fen ③ 未归档分支含台账求和。
//   方向不变（仍要求"归档读落库 / 未归档读台账"），只是容许等价的表达式形态。
const A5_PASS = (src) => /isArchiveNow\s*\?/.test(src)
  && /\(\(acct && acct\.amortize_fen\) \|\| 0\)/.test(src)
  && /amortizeTotalForMonth\(amortRows, v\.month\)/.test(src);
ck('A-⑤ getLedger 保留「归档读落库 / 未归档读台账」两分支',
  A5_PASS(SRC.glIdx),
  '三元形态在位（归档读快照 + 未归档台账求和）');
// R744：语义化判据必须自证非恒真 —— 摘掉「归档读快照」这一侧，判据必须转红
ck('A-⑤b 变异回灌：归档分支改读台账 ⇒ A-⑤ 当场转红（证明语义判据有牙）',
  !A5_PASS(SRC.glIdx.replace(/\(\(acct && acct\.amortize_fen\) \|\| 0\)/,
    'amortizeTotalForMonth(amortRows, v.month)')),
  '已检出');
ck('A-⑥ exportData 保留「归档读落库 / 未归档读台账」两分支',
  /const amort = isArchiveRow \? nz\(row\.amortize_fen\) : amortLedger;/.test(SRC.exp),
  '三元形态在位');

ck('A-⑦ getAmortSchedule 出参 amortize_switch_on 恒为字面量 true',
  /amortize_switch_on:\s*true\s*,/.test(SRC.schIdx), '字面量在位');
ck('A-⑧ getAmortSchedule 不再返回 amort_rule_v2（前端从不读它，留着就是死字段）',
  SRC.schIdx.indexOf('amort_rule_v2') < 0, '已移除');
ck('A-⑨ getLedger 出参 switch_on / switches 恒为 true',
  /switch_on:\s*true/.test(SRC.glIdx) && /amortizeSwitchOn:\s*true/.test(SRC.glIdx),
  '两处恒真');

// ==================================================================
group('B · 行为：无论月份、无论开关，一律计入');
// ==================================================================

function runOne(fn, month, switchOn) {
  return fn({
    month, incomeItems: INCOME, expenseItems: EXPENSE, directConsumeFen: DIRECT,
    inventory: {}, lumpSumFen: LUMP, amortizeFen: LEDGER_MONTHLY,
    amortizeSwitchOn: switchOn, inventorySwitchOn: false,
  });
}

for (const [label, month, expectDesc] of [
  ['B-①', '2026-08', '闸门时代最早的那个月'],
  ['B-②', '2026-10', '闸门最后挡住的月份（R735 的验收月）'],
  ['B-③', '2026-11', '闸门原生效月'],
  ['B-④', '2027-05', '闸门之后'],
]) {
  const r = runOne(ENGINES[0][1], month, false);
  ck(`${label} ${month}（${expectDesc}）⇒ effective = ${yuan(LEDGER_MONTHLY)}（不管开关是 false）`,
    r.effectiveAmortizeFen === LEDGER_MONTHLY, `实得 ${yuan(r.effectiveAmortizeFen)}`);
}

{
  const r = runOne(ENGINES[0][1], '', false);
  ck('B-⑤ month 为空 ⇒ 仍全额计入（旧版这里 fail-safe 归零，现在没有"未知月份"这回事）',
    r.effectiveAmortizeFen === LEDGER_MONTHLY, `实得 ${yuan(r.effectiveAmortizeFen)}`);
}

{
  const off = runOne(ENGINES[0][1], '2026-10', false);
  const on = runOne(ENGINES[0][1], '2026-10', true);
  ck('B-⑥ 开关 false / true 两态金额完全相同（开关对钱零影响）',
    off.effectiveAmortizeFen === on.effectiveAmortizeFen
    && off.totalFactorRealProfitFen === on.totalFactorRealProfitFen,
    `off=${yuan(off.effectiveAmortizeFen)} on=${yuan(on.effectiveAmortizeFen)}`);
}

{
  const detail = ENGINES.map(([n, fn]) => {
    const r = runOne(fn, '2026-10', false);
    return `${n}=${r.effectiveAmortizeFen}`;
  }).join(' / ');
  const vals = ENGINES.map(([, fn]) => runOne(fn, '2026-10', false).effectiveAmortizeFen);
  ck('B-⑦ 三份引擎副本同参同结果（逐字同源的行为面证据）',
    vals.every((v) => v === vals[0] && v === LEDGER_MONTHLY), detail);
}

// ==================================================================
group('C · 闭包：逐月求和 ≡ 资产原值（闸门时代这里会少一截）');
// ==================================================================

const DECOR = { asset_id: 'a1', name: '装修', total_value: 36000 * Y, start_month: '2026-08', total_months: 36 };

function monthsBetween(a, b) {
  const out = [];
  let i = sched.monthIndex(a), end = sched.monthIndex(b);
  for (; i <= end; i++) out.push(sched.fmtMonthIdx(i));
  return out;
}

const SPAN = monthsBetween('2026-08', '2029-07');   // 36 期
const sumAll = SPAN.reduce((s, m) => s + sched.amountForMonth(DECOR, m), 0);

ck('C-① 36 期逐月求和 === 36,000（一分不多一分不少；R739 只验了"摊完即停"，没验"总和等于原值"）',
  sumAll === 36000 * Y, `${yuan(sumAll)} vs 36,000.00`);

ck('C-② 闸门若还在，同一区间求和只有 33,000 —— 差额 3,000 是永久蒸发（本轮的立项依据）',
  sumAll - 3 * 1000 * Y === 33000 * Y, `${yuan(sumAll - 3000 * Y)}`);

ck('C-③ 起摊月之前 = 0，摊完后的月份 = 0',
  sched.amountForMonth(DECOR, '2026-07') === 0 && sched.amountForMonth(DECOR, '2029-08') === 0,
  `2026-07=${sched.amountForMonth(DECOR, '2026-07')} / 2029-08=${sched.amountForMonth(DECOR, '2029-08')}`);

ck('C-④ 末月尾差倒挤（36 期均摊 1000，末月恰为 1000，不多不少）',
  sched.amountForMonth(DECOR, '2029-07') === 1000 * Y, `${yuan(sched.amountForMonth(DECOR, '2029-07'))}`);

// ==================================================================
group('D · 接线：四个调用点都按台账取数、都传 month');
// ==================================================================

// 所有 calcMonthlyProfit( 调用点逐个核对是否传了 month。
//   ⚠️ 两种形态都要认：`calcMonthlyProfit({ month: ... })`（对象字面量）
//   与 `calcMonthlyProfit(clean)`（先组装 clean）。后者要看 clean 的构造处。
function callSites(src) {
  const out = [];
  let idx = 0;
  while (true) {
    const i = src.indexOf('calcMonthlyProfit(', idx);
    if (i < 0) break;
    // 跳过函数定义 `function calcMonthlyProfit(`
    const before = src.slice(Math.max(0, i - 12), i);
    if (before.indexOf('function ') < 0) {
      const tail = src.slice(i, i + 900);
      const end = tail.indexOf('});');
      const endParen = tail.indexOf(');');
      const cut = end >= 0 ? end : (endParen >= 0 ? endParen : tail.length);
      out.push(tail.slice(0, cut));
    }
    idx = i + 10;
  }
  return out;
}

{
  const FILE_SRC = {
    'calcMonthlyProfit/index.js': read('cloudfunctions/calcMonthlyProfit/index.js'),
    'getLedger/index.js': SRC.glIdx,
    'saveLedger/index.js': SRC.slIdx,
  };
  const missing = [];
  let total = 0;
  for (const n in FILE_SRC) {
    const list = callSites(FILE_SRC[n]);
    total += list.length;
    for (const c of list) {
      // 对象字面量形态：片段里必须有 month
      // 变量形态（calcMonthlyProfit(clean)）：片段里没有 month，但文件里组装 clean 时必须有 month: 字段
      if (!/month:/.test(c) && !/month:\s*v\.input\.month/.test(FILE_SRC[n])) missing.push(n);
    }
    if (list.length === 0) missing.push(n + '(未找到调用点)');
  }
  ck('D-① 三个云函数的每个 calcMonthlyProfit 调用点都传了 month（台账按月定位这一期）',
    missing.length === 0, missing.length ? '有问题：' + missing.join(',') : `共 ${total} 个调用点`);
}

ck('D-② getLedger 未归档月的 amortizeFen 来自 amortizeTotalForMonth（不是落库值）',
  /isArchiveNow\s*\n?\s*\?/.test(SRC.glIdx) && /amortizeTotalForMonth\(amortRows, v\.month\)/.test(SRC.glIdx),
  '台账取数在位');

// 🔴 R744：同上 —— 处置损失并入后，amortizeFen 是「台账求和 + 处置损失」两行组装，
//   旧判据钉整行字面会假红。改判语义：存在无条件（非 if 包裹）的台账求和，且不在归档分支里。
ck('D-③ saveLedger 一律从台账求和（无 if 分支包裹；R744 允许后续并入处置损失）',
  /amortizeTotalForMonth\(ledgerRows\.filter\(\(a\) => a\.mode !== 'lump'\), v\.month\)/.test(SRC.slIdx)
  && !/if\s*\([^)]*\)\s*\{[^}]*amortizeTotalForMonth\(ledgerRows/.test(SRC.slIdx),
  '无条件取数在位');

ck('D-④ exportData 未归档月用 _amortizeTotalForMonth 重算',
  /const amort = isArchiveRow \? nz\(row\.amortize_fen\) : amortLedger;/.test(SRC.exp)
  && /_amortizeTotalForMonth\(/.test(SRC.exp), '台账取数在位');

ck('D-⑤ 五个摊销取数点都过滤了 mode !== \'lump\'（一次性投入不许进摊销合计）',
  /mode !== 'lump'/.test(SRC.glIdx) && /mode !== 'lump'/.test(SRC.slIdx) && /mode !== 'lump'/.test(SRC.schIdx),
  '三处明确过滤；exportData 走 assets 列表已在上游过滤');

// ==================================================================
group('E · 变异回灌：把判据塞回去，上面的断言必须转红');
// ==================================================================

const Module = require('module');
function loadMutant(relFile, from, to) {
  const abs = F(relFile);
  const src = fs.readFileSync(abs, 'utf8');
  if (src.indexOf(from) < 0) return { err: '变异锚点未找到（源码已改，请同步本守卫）' };
  const M = new Module(abs, module);
  M.filename = abs;
  M.paths = Module._nodeModulePaths(path.dirname(abs));
  M._compile(src.replace(from, to), abs);
  return { exp: M.exports };
}

{
  const ANCHOR = 'const effectiveAmortizeFen = fenRoundN(amortizeFen);';
  const mut = loadMutant(FILES.main, ANCHOR,
    "const effectiveAmortizeFen = (String((clean && clean.month) || '') >= '2026-11') ? fenRoundN(amortizeFen) : 0;");
  let caught = false, detail = mut.err || '';
  if (mut.exp) {
    const r = mut.exp.calcMonthlyProfit({
      month: '2026-10', incomeItems: INCOME, expenseItems: EXPENSE, directConsumeFen: DIRECT,
      inventory: {}, lumpSumFen: LUMP, amortizeFen: LEDGER_MONTHLY,
      amortizeSwitchOn: false, inventorySwitchOn: false,
    });
    caught = r.effectiveAmortizeFen === 0;
    detail = `变异后 2026-10 effective=${yuan(r.effectiveAmortizeFen)}（0.00 ⇒ B-② 会红）`;
  }
  ck('E-① 变异回灌：把「month >= 2026-11」判据塞回引擎 ⇒ 2026-10 归零，B-② 当场转红',
    caught, detail);
}

{
  // ⚠️ 不能 loadMutant exportData —— 它 `require('wx-server-sdk')`，本地跑不起来。
  //   改为**纯文本变异**：把归档三元改成无条件读台账，确认那行确实是"唯一决定来源"的地方。
  const ANCHOR = 'const amort = isArchiveRow ? nz(row.amortize_fen) : amortLedger;';
  const MUTATED = 'const amort = amortLedger;';
  const mutSrc = SRC.exp.replace(ANCHOR, MUTATED);
  ck('E-② 变异（文本）：摘掉 exportData 的归档判据后，归档月会被台账倒灌（A-⑥ 钉的是活代码）',
    SRC.exp.indexOf(ANCHOR) >= 0 && mutSrc !== SRC.exp
    && mutSrc.indexOf(MUTATED) >= 0 && mutSrc.indexOf(ANCHOR) < 0,
    '锚点存在且可替换 ⇒ A-⑥ 非恒真');
}

{
  const ANCHOR = 'const amortizeFen = isArchiveNow';
  ck('E-③ 自失效护栏：getLedger 的归档三元仍是代码里唯一决定摊销来源的地方（锚点在场）',
    SRC.glIdx.indexOf(ANCHOR) >= 0, `锚点 ${ANCHOR}`);
}

// ==================================================================
group('F · 自失效护栏');
// ==================================================================

ck('F-① 断言数下界 ≥ 22（防本文件被掏空后仍报「全绿」）', R.length + 1 >= 22, `当前 ${R.length + 1}`);
ck('F-② 结构段扫描的八份文件全部读到了（少读一份就会让 A 段恒绿）',
  Object.keys(SRC).every((k) => SRC[k].length > 500),
  Object.keys(SRC).map((k) => `${k}:${SRC[k].length}`).join(' '));

// ==================================================================
// 输出
// ==================================================================
console.log('\n===== R740 · 摊销无闸门守卫 =====\n');
let lastG = '', pass = 0, fail = 0;
const fails = [];
for (const r of R) {
  if (r.group !== lastG) { console.log('\n【' + r.group + '】'); lastG = r.group; }
  const mark = r.pass ? '✅' : '❌';
  if (r.pass) pass++; else { fail++; fails.push(r); }
  console.log(`  ${mark} ${r.name}${r.detail ? '   « ' + r.detail + ' »' : ''}`);
}
console.log(`\n摊销无闸门守卫结果：${pass} 通过 / ${fail} 失败（共 ${R.length} 条）`);
if (fails.length) {
  console.log('\n—— 失败项 ——');
  fails.forEach((f) => console.log(`  · ${f.name}\n      ${f.detail}`));
}
process.exit(fail ? 1 : 0);
