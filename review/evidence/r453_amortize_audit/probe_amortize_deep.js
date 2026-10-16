// review/evidence/r453_amortize_audit/probe_amortize_deep.js —— 【R453】M1 摊销页人读深挖（#443 残面）
// 运行：NODE_OPTIONS="--require <gitcache_preload>" node review/evidence/r453_amortize_audit/probe_amortize_deep.js
//
// 为什么要它（缺口来自**源码自称**，不是推断）：
//   本仓摊销金额有 **3 份各自手写的实现**，每一份都在注释里自称"同源/同款/同口径"：
//     ① `cloudfunctions/calcAmortize/service.js`      （利润表侧，含残值）
//     ② `cloudfunctions/getAmortSchedule/service.js`  （摊销页展示）「与 calcAmortize/service.js 同源」
//     ③ `cloudfunctions/saveLedger/service.js`        （落账本快照）「与 calcAmortize/service.js 保持同源同口径」
//   而全仓 `tools/**` **没有任何一条断言比对三者的数值**（唯一沾边的是
//   `tools/selftest_batch8c.js:60`「末月尾差倒挤仍在」——它**只读了 calcAmortize 一份**）。
//   ⇒ 这正是本仓已抓七例的「同族病」母题的最大实例：**同一核心金额三处实现 + 自称同源 + 判据只守一半**。
//   后果链：利润表走 ①、摊销页展示走 ②、账本快照走 ③ ⇒ 一旦有人只改一份，
//   **页面显示 ≠ 账本 ≠ 利润表**，而门禁照绿。（摊销是 M1 利润表的核心减项。）
//
// 判据（分组，形态照 gate-suite-checklist §0）：
//   S 扫描面（fail-closed）：5 个目标文件在场非空 + 锚点在场（防路径写错得到"零命中"假绿）。
//   P 三份数值对拍（核心）：三份引擎在同一资产 × 同一月份上必须给出**同一个分整数**，全矩阵逐点两两对拍。
//   B 边界语义（行为级）：自然到期尾差闭合 / 提前终止仍按 base / 区间外=0 / S3 双侧锚点。
//   T 出参契约：details 与 assets 同源同序（⇒ 前端 findMonthAmount 不会串号）。
//   G 守卫盲区取证：证明"判据只守一半"是事实（不是我没找到）。
//   H 影子样本（反恒真）：篡改任一副本的尾差倒挤 ⇒ 对拍**必须**判不等；改回 ⇒ 全等。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const P = {
  profitSvc: path.join(ROOT, 'cloudfunctions', 'calcAmortize', 'service.js'),        // ① 利润表侧
  pageSvc: path.join(ROOT, 'cloudfunctions', 'getAmortSchedule', 'service.js'),      // ② 摊销页展示
  ledgerSvc: path.join(ROOT, 'cloudfunctions', 'saveLedger', 'service.js'),          // ③ 账本快照
  pageIdx: path.join(ROOT, 'cloudfunctions', 'getAmortSchedule', 'index.js'),
  pageValidate: path.join(ROOT, 'cloudfunctions', 'getAmortSchedule', 'validate.js'),
  feJs: path.join(ROOT, 'pages', 'month', 'amortize.js'),
  feWxml: path.join(ROOT, 'pages', 'month', 'amortize.wxml'),
  guard8c: path.join(ROOT, 'tools', 'selftest_batch8c.js'),
};

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };

// ============================================================
console.log('===== S 扫描面（fail-closed）=====');
const profitSvcSrc = read(P.profitSvc);
const pageSvcSrc = read(P.pageSvc);
const ledgerSvcSrc = read(P.ledgerSvc);
const pageIdxSrc = read(P.pageIdx);
const feJsSrc = read(P.feJs);
const feWxmlSrc = read(P.feWxml);

const FACE = [
  ['S-① calcAmortize/service.js（① 利润表侧引擎）', profitSvcSrc, 3000],
  ['S-② getAmortSchedule/service.js（② 摊销页展示引擎）', pageSvcSrc, 500],
  ['S-③ saveLedger/service.js（③ 账本快照引擎）', ledgerSvcSrc, 1500],
  ['S-④ getAmortSchedule/index.js（页面 Controller）', pageIdxSrc, 3000],
  ['S-⑤ pages/month/amortize.js（前端）', feJsSrc, 8000],
  ['S-⑥ pages/month/amortize.wxml（前端模板）', feWxmlSrc, 3000],
];
for (const [n, src, min] of FACE) check(n + ' 在场且非空', src.length > min, src.length + 'B');

check('S-⑦ 锚点：① 含 amountForMonthFen 定义', /function amountForMonthFen\s*\(/.test(profitSvcSrc));
check('S-⑧ 锚点：② 含 amountForMonth 定义', /function amountForMonth\s*\(/.test(pageSvcSrc));
check('S-⑨ 锚点：③ 含 amountForMonth 定义（账本快照用）', /function amountForMonth\s*\(/.test(ledgerSvcSrc));
check('S-⑩ 三份都自称与 calcAmortize 同源（缺口来自源码自称，非推断）',
  /同源/.test(pageSvcSrc) && /同源同口径/.test(ledgerSvcSrc),
  '②:' + /同源/.test(pageSvcSrc) + ' ③:' + /同源同口径/.test(ledgerSvcSrc));

// 真加载三份引擎（行为面必须走真品，不走源码文本）
let PROFIT = null, PAGE = null, LEDGER = null;
try { PROFIT = require(P.profitSvc); } catch (e) { console.log('   ⚠ require①失败: ' + e.message.split('\n')[0]); }
try { PAGE = require(P.pageSvc); } catch (e) { console.log('   ⚠ require②失败: ' + e.message.split('\n')[0]); }
try { LEDGER = require(P.ledgerSvc); } catch (e) { console.log('   ⚠ require③失败: ' + e.message.split('\n')[0]); }
check('S-⑪ ① 可加载并导出 amountForMonthFen', !!(PROFIT && typeof PROFIT.amountForMonthFen === 'function'));
check('S-⑫ ② 可加载并导出 amountForMonth', !!(PAGE && typeof PAGE.amountForMonth === 'function'));
check('S-⑬ ③ 可加载并导出 amountForMonth', !!(LEDGER && typeof LEDGER.amountForMonth === 'function'));

// ============================================================
console.log('\n===== P 三份数值对拍（同资产同月必须同值）=====');

// 样本：全部 total_months ≥ 1（validate 保证；见 P-⑦）
const CASES = [
  { name: '整除 12 月（1200 元）', value: 120000, months: 12, start: '2026-01', term: '' },
  { name: '不整除 3 月（S3 装修 10000 元）', value: 1000000, months: 3, start: '2026-01', term: '' },
  { name: '不整除 7 月（100000 元）', value: 10000000, months: 7, start: '2025-11', term: '' },
  { name: '单月 N=1', value: 88888, months: 1, start: '2026-03', term: '' },
  { name: '提前终止（12 月摊到第 5 月止）', value: 1200000, months: 12, start: '2026-01', term: '2026-05' },
  { name: '终止月晚于自然到期（应等同无终止）', value: 600000, months: 6, start: '2026-01', term: '2026-12' },
  { name: '跨年 13 月', value: 999999, months: 13, start: '2025-11', term: '' },
  { name: '小额 1 分 3 月（尾差极端）', value: 1, months: 3, start: '2026-01', term: '' },
  { name: '★S3 锚点 装修 12 万 / 36 月', value: 12000000, months: 36, start: '2026-01', term: '' },
];
const MONTHS = [
  '2025-01', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
  '2026-05', '2026-06', '2026-07', '2026-12', '2027-01', '2027-06', '2027-12',
  '2028-11', '2028-12', '2029-01',
];

const asAsset = (c, i) => ({
  asset_id: 'a' + i, name: c.name,
  total_value: c.value, start_month: c.start, total_months: c.months, terminate_month: c.term,
});

const trio = (a, m) => ({
  profit: PROFIT.amountForMonthFen(a, m),
  page: PAGE.amountForMonth(a, m),
  ledger: LEDGER.amountForMonth(a, m),
});

let mismatchTotal = 0;
const mismatchDetail = [];
for (let ci = 0; ci < CASES.length; ci++) {
  const c = CASES[ci];
  const a = asAsset(c, ci);
  let bad = 0;
  for (const m of MONTHS) {
    const t = trio(a, m);
    if (!(t.profit === t.page && t.page === t.ledger)) {
      bad++; mismatchTotal++;
      if (mismatchDetail.length < 5) mismatchDetail.push(`${c.name} @${m}: ①=${t.profit} ②=${t.page} ③=${t.ledger}`);
    }
  }
  check(`P · 「${c.name}」全 ${MONTHS.length} 月三份逐点对拍一致`, bad === 0, bad === 0 ? '0 处不等' : bad + ' 处不等');
}
check(`P-★ 全矩阵（${CASES.length} 资产 × ${MONTHS.length} 月 × 3 份）不等点数 = 0`,
  mismatchTotal === 0,
  mismatchTotal === 0
    ? `${CASES.length * MONTHS.length * 3}/${CASES.length * MONTHS.length * 3} 点一致`
    : mismatchTotal + ' 处：' + mismatchDetail.join(' | '));

// S3 锚点（双侧）：装修 12 万 / 36 月 ⇒ 2026-12 = 333,333；2028-12 尾差 = 333,345
{
  const decor = { asset_id: 'dec', name: '装修', total_value: 12000000, start_month: '2026-01', total_months: 36, terminate_month: '' };
  check('P-① S3 锚点：装修 2026-12 = 333,333 分（三份一致）',
    trio(decor, '2026-12').profit === 333333 && trio(decor, '2026-12').page === 333333 && trio(decor, '2026-12').ledger === 333333);
  check('P-② 🏆 S3 锚点：装修末月 2028-12 尾差倒挤 = 333,345 分（三份一致）',
    trio(decor, '2028-12').profit === 333345 && trio(decor, '2028-12').page === 333345 && trio(decor, '2028-12').ledger === 333345);
  const s3Months = monthsOf('2026-01', 36);
  check('P-③ S3 的起月 / 中间月 / 末月都在扫描集合内（⇒ 上面两条锚点是"对上了"，不是"没扫到"）',
    MONTHS.indexOf('2026-01') >= 0 && MONTHS.indexOf('2026-12') >= 0 && MONTHS.indexOf('2028-12') >= 0,
    '覆盖 ' + s3Months.length + ' 期，其中 ' + MONTHS.filter((m) => s3Months.indexOf(m) >= 0).length + ' 期在扫描面内');
  // 36 期全集逐点对拍（不依赖手写的 MONTHS 列表，避免"抽样看起来对"）
  let s3Bad = 0;
  for (const m of s3Months) { const t = trio(decor, m); if (!(t.profit === t.page && t.page === t.ledger)) s3Bad++; }
  check('P-④ S3 全 36 期逐点三份对拍一致（全集，非抽样）', s3Bad === 0, `${36 - s3Bad}/36 期一致`);
}

// 诚实标注：脏数据 total_months=0（validate 拦得住 ⇒ 不可达）
{
  const dirty = { asset_id: 'dirty', name: 'x', total_value: 100000, start_month: '2026-01', total_months: 0, terminate_month: '' };
  const t = trio(dirty, '2026-02');
  check('P-⑦ 脏数据 total_months=0 时三份仍一致（区间为空 ⇒ 先短路返回 0；① 的裸除法不触发）',
    t.profit === t.page && t.page === t.ledger, `①=${t.profit} ②=${t.page} ③=${t.ledger}`);
  check('P-⑧ 该态不可达：validate 强制 month 合法 + 入库 total_months ≥ 1',
    /MONTH_RE/.test(read(P.pageValidate)));
}

// ============================================================
console.log('\n===== B 边界语义（行为级）=====');
function monthsOf(start, n) {
  const [y0, m0] = start.split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = y0 * 12 + (m0 - 1) + i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}
function sumOver(engineFn, a, months) { return months.reduce((s, m) => s + engineFn(a, m), 0); }

for (const c of CASES.filter((x) => !x.term)) {
  const a = asAsset(c, 0);
  const all = monthsOf(c.start, c.months);
  const s1 = sumOver(PROFIT.amountForMonthFen, a, all);
  const s2 = sumOver(PAGE.amountForMonth, a, all);
  const s3 = sumOver(LEDGER.amountForMonth, a, all);
  check(`B-① 自然到期尾差闭合「${c.name}」Σ(N期) === 原值（三份一致）`,
    s1 === c.value && s2 === c.value && s3 === c.value, `${s1}/${s2}/${s3} vs ${c.value}`);
}

{
  const c = CASES[4];                      // 提前终止
  const a = asAsset(c, 4);
  const base = Math.round(c.value / c.months);
  check('B-② 提前终止的末月按 base（残值不摊进末月，三份一致）',
    PROFIT.amountForMonthFen(a, c.term) === base && PAGE.amountForMonth(a, c.term) === base && LEDGER.amountForMonth(a, c.term) === base,
    `①/②/③ = ${PROFIT.amountForMonthFen(a, c.term)} vs base ${base}`);
  check('B-③ 提前终止残值 > 0 且 === 原值 − 已摊（仅 ① 有此能力）',
    PROFIT.calcResidualFen(a) === c.value - sumOver(PROFIT.amountForMonthFen, a, monthsOf(c.start, 5)),
    'residual=' + PROFIT.calcResidualFen(a));
}

{
  const c = CASES[1];
  const a = asAsset(c, 1);
  check('B-④ 区间外（早于起摊月）= 0（三份一致）',
    PROFIT.amountForMonthFen(a, '2025-12') === 0 && PAGE.amountForMonth(a, '2025-12') === 0 && LEDGER.amountForMonth(a, '2025-12') === 0);
  check('B-⑤ 区间外（晚于截止月）= 0（三份一致）',
    PROFIT.amountForMonthFen(a, '2026-04') === 0 && PAGE.amountForMonth(a, '2026-04') === 0 && LEDGER.amountForMonth(a, '2026-04') === 0);
}

{
  const c = CASES[5];                      // 终止月晚于自然到期
  const a = asAsset(c, 5);
  const noTerm = asAsset(Object.assign({}, c, { term: '' }), 5);
  const all = monthsOf(c.start, c.months);
  check('B-⑥ 终止月晚于自然到期 ⇒ 逐月与"无终止"同值（三份一致）',
    PROFIT.amountForMonthFen(a, all[0]) === PROFIT.amountForMonthFen(noTerm, all[0]) &&
    sumOver(PAGE.amountForMonth, a, all) === sumOver(PAGE.amountForMonth, noTerm, all) &&
    sumOver(LEDGER.amountForMonth, a, all) === sumOver(LEDGER.amountForMonth, noTerm, all));
}

check('B-⑦ 能力差：① 有 calcResidualFen（残值），②③ 无（诚实登记：页面/账本不展示处置损失）',
  typeof PROFIT.calcResidualFen === 'function' &&
  typeof PAGE.calcResidualFen === 'undefined' && typeof LEDGER.calcResidualFen === 'undefined');

// ============================================================
console.log('\n===== T 出参契约（前端取数不会串号）=====');
{
  const assets = CASES.map((c, i) => asAsset(c, i));
  const sched = PAGE.amortizeForMonth(assets, '2026-02');
  check('T-① details.length === assets.length（无丢弃/无补位）',
    sched.details.length === assets.length, `${sched.details.length} vs ${assets.length}`);
  check('T-② details[i].asset_id === assets[i].asset_id 逐项同序（⇒ findMonthAmount 取到的是自己那行）',
    assets.every((a, i) => sched.details[i].asset_id === a.asset_id));
  check('T-③ total_amount_fen === Σ details[].amount_fen（合计与明细自洽）',
    sched.total_amount_fen === sched.details.reduce((s, d) => s + d.amount_fen, 0), sched.total_amount_fen + '');
  check('T-④ 页面 index.js 的 details 与 assets 同源（同一 sched 出参，非同源两算）',
    /amortizeForMonth\(assets,\s*v\.month\)/.test(pageIdxSrc) && /details:\s*sched\.details/.test(pageIdxSrc));
  check('T-⑤ 页面 Controller 的 progressOf 恒返回 total_periods（⇒ 前端 remainingOnly 仅 total_months=0 可达）',
    /total_periods:\s*asset\.total_months/.test(pageIdxSrc));
  check('T-⑥ 前端 findMonthAmount 按 asset_id 严格匹配（===，不隐式转换）',
    /x\.asset_id === assetId/.test(feJsSrc));
  check('T-⑦ 前端 groups 组键 = group_id || asset_id（老数据无 group_id 时自成一组）',
    /r\.group_id \|\| r\.asset_id/.test(feJsSrc));
  const t = [{ asset_id: 'A', amount_fen: 111 }, { asset_id: 'B', amount_fen: 222 }];
  const findLike = (details, aid) => { const row = (details || []).find((x) => x.asset_id === aid); return row ? (row.amount_fen || 0) : 0; };
  check('T-⑧ 影子样本：取 B 得 222、取 C 得 0（证明匹配判据有鉴别力，不是恒取首行）',
    findLike(t, 'B') === 222 && findLike(t, 'C') === 0, `${findLike(t, 'B')} / ${findLike(t, 'C')}`);
  // asset_id 恒非空 ⇒ "多个空 asset_id 撞成同一行" 不可达
  check('T-⑨ asset_id 恒非空（saveAsset 新增走 genId），⇒ findMonthAmount 无"空键撞车"风险',
    /const assetId = genId\('amort_'\)/.test(read(path.join(ROOT, 'cloudfunctions', 'saveAsset', 'index.js'))));
}

// ============================================================
console.log('\n===== G 守卫盲区取证（"没找到"≠"不存在"）=====');
const toolDir = path.join(ROOT, 'tools');
const toolFiles = (() => { try { return fs.readdirSync(toolDir).filter((f) => f.endsWith('.js')); } catch (e) { return []; } })();
check('G-① 扫描面达下界：tools/*.js 被枚举到（防目录写错导致"零命中"假绿）',
  toolFiles.length > 100, toolFiles.length + ' 个 .js');

// 判据分两层，避免"用 read() 读文本"冒充"数值对拍"：
//   · mention = 源码里**提到**几份引擎路径（read 文本也算）
//   · require = 源码里**require 进来**几份（这才是真能对拍的）
const CFN = ['calcAmortize', 'getAmortSchedule', 'saveLedger'];
const mentionMulti = [], requireMulti = [];
for (const f of toolFiles) {
  const s = read(path.join(toolDir, f));
  const mentioned = CFN.filter((cf) => s.indexOf('cloudfunctions/' + cf + '/service.js') >= 0);
  const required = CFN.filter((cf) => new RegExp('require\\([^)\\n]*' + cf).test(s));
  if (mentioned.length >= 2) mentionMulti.push(f + ':' + mentioned.join('+'));
  if (required.length >= 2) requireMulti.push(f + ':' + required.join('+'));
}
check('G-② 全 tools/ 无任何工具 **require** 两份以上摊销引擎（⇒ 不存在数值对拍）',
  requireMulti.length === 0, requireMulti.length ? requireMulti.join(' ; ') : '0 个文件');
check('G-②b 诚实报告：仅"提到"两份以上路径的工具（读文本 ≠ 对拍）',
  true, mentionMulti.length ? mentionMulti.join(' ; ') : '0 个文件仅提到路径');

// 精确缺口：batch8c 的护栏只守了 ①一份
{
  const g8c = read(P.guard8c);
  check('G-③ 既有护栏「末月尾差倒挤仍在」确实存在（⇒ 不是完全没护栏）',
    /末月尾差倒挤仍在/.test(g8c));
  const lines = g8c.split('\n').filter((l) => /末月尾差倒挤仍在/.test(l));
  check('G-④ 🔴 该护栏**只读了 ① calcAmortize 一份**（②③ 的同一句无人守）',
    lines.length === 1 && lines[0].indexOf('calcAmortize') >= 0 &&
    lines[0].indexOf('getAmortSchedule') < 0 && lines[0].indexOf('saveLedger') < 0,
    lines.length === 1 ? lines[0].trim().slice(0, 120) : lines.length + ' 条');
  check('G-⑤ 反向取证：②③ 源码里**确有**同一句尾差倒挤（⇒ 缺口真实存在，不是"它们没有这句"）',
    /total_value - base \* \(N - 1\)/.test(pageSvcSrc) && /total_value - base \* \(N - 1\)/.test(ledgerSvcSrc));
  const forLoop = g8c.split('\n').find((l) => /for \(const f of \[/.test(l)) || '';
  check('G-⑥ batch8c 的三文件循环里判据是「不含分组字段」（否定式），非数值等价',
    /不含分组字段/.test(g8c) && forLoop.indexOf('saveLedger') > 0,
    forLoop.trim().slice(0, 100));
}

// ============================================================
console.log('\n===== H 影子样本（反恒真：对拍判据必须有鉴别力）=====');
function loadStub(src, filename) {
  const sandbox = { module: { exports: {} }, exports: {}, console };
  sandbox.require = (id) => { if (id === './common') return { ERROR_CODES: {} }; throw new Error('unexpected require: ' + id); };
  vm.runInNewContext(src, sandbox, { filename });
  return sandbox.module.exports;
}
const TAIL = 'if (end === naturalEnd) return asset.total_value - base * (N - 1);';
check('H-① 篡改锚点句在三份源码里都在场（否则影子样本无效）',
  profitSvcSrc.split('if (end === naturalEnd) {')[1] && pageSvcSrc.indexOf(TAIL) >= 0 && ledgerSvcSrc.indexOf(TAIL) >= 0);

// 篡改 ② 的尾差句 → 三份对拍必须判不等
const tamperPage = loadStub(pageSvcSrc.replace(TAIL, 'if (end === naturalEnd) return base;'), 'tp.js');
let bad2 = 0, bad2Tail = 0, bad2Off = '';
for (const c of CASES.filter((x) => !x.term)) {
  const a = asAsset(c, 0);
  const tailMonth = monthsOf(c.start, c.months).slice(-1)[0];
  for (const m of MONTHS) {
    const x = tamperPage.amountForMonth(a, m);
    if (x !== PROFIT.amountForMonthFen(a, m)) {
      bad2++;
      if (m === tailMonth) bad2Tail++; else if (!bad2Off) bad2Off = `${c.name}@${m}`;
    }
  }
}
check('H-② 篡改 ② 的尾差倒挤 ⇒ 对拍**判不等**（⇒ 判据有鉴别力）', bad2 > 0, bad2 + ' 处不等');
check('H-③ 且**全部**不等点都落在该资产的自然到期末月（非区间外误报）',
  bad2 > 0 && bad2 === bad2Tail && !bad2Off, `末月 ${bad2Tail} / 非末月 ${bad2 ? bad2 - bad2Tail : 0}${bad2Off ? ' 首处 ' + bad2Off : ''}`);

// 提前终止样本：篡改尾差句后必须**零变化**（证明篡改只影响自然到期尾差路径）
{
  const c = CASES[4];
  const a = asAsset(c, 4);
  const changed = MONTHS.filter((m) => tamperPage.amountForMonth(a, m) !== PAGE.amountForMonth(a, m)).length;
  check('H-④ 提前终止样本篡改后**零变化**（⇒ 篡改只打到自然到期尾差路径，判据定位准确）',
    changed === 0, changed + ' 处变化');
}
// 篡改 ③ 也要被抓（证明不是只盯 ②）
const tamperLedger = loadStub(ledgerSvcSrc.replace(TAIL, 'if (end === naturalEnd) return base;'), 'tl.js');
let bad3 = 0;
for (const c of CASES.filter((x) => !x.term)) {
  const a = asAsset(c, 0);
  for (const m of MONTHS) if (tamperLedger.amountForMonth(a, m) !== PROFIT.amountForMonthFen(a, m)) bad3++;
}
check('H-⑤ 篡改 ③ 同样被抓（⇒ 三份任一漂移都逃不过）', bad3 > 0, bad3 + ' 处不等');
check('H-⑥ 真品在同一判据下全等（⇒ 判据不是恒红）', mismatchTotal === 0);

// ============================================================
console.log(`\n结果：${pass} 通过 / ${failN} 失败`);
process.exit(failN === 0 ? 0 : 1);
