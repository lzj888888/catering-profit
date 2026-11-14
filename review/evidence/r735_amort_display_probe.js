#!/usr/bin/env node
// review/evidence/r735_amort_display_probe.js —— R735 · 摊销页「开关关了还显示数值」取证
//
// 【李老师原话】
//   「管理摊销资产 启用和不启用分期分摊 这个开关，貌似 数值都按摊销算。比如 最上面本月摊销合计
//    开关关闭 不计入利润 有数值显示，不知道正不正常。设备 月摊销 也显示数值。
//    摊销这块你处理完，务必多几轮审计。」
//
// 【要回答的三个问题（只认数字，不认注释）】
//   Q1 开关关掉后，**钱到底有没有被扣**？（这是老板真正怕的事）
//   Q2 页面上那个数字是"本月扣了多少"还是"台账每月该摊多少"？
//   Q3 如果是后者，页面该不该在开关关闭时显示它？
//
// 【方法】真引擎跑，不读源码猜：
//   · 台账应摊 —— 真实 require getAmortSchedule/service.js 的 amortizeForMonth
//   · 真实利润 —— 真实 require calcMonthlyProfit/service.js，开关双侧
//   · 页面 data —— 桩 Page/wx/api 后真跑 amortize.js 的 load()，读出 totalYuan / amountYuan
//
// 用法：node review/evidence/r735_amort_display_probe.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FEN = 100;

// ── 与 R732 同一套业务数据（保持可比）──
// 台账：装修 12 万 ÷ 36 月 = 3,333.33 / 月；设备 6 万 ÷ 60 月 = 1,000 / 月 ⇒ 合计 4,333.33
const YUAN = 100;
const ASSETS = [
  { asset_id: 'a1', name: '装修', total_value: 120000 * YUAN, start_month: '2026-01', total_months: 36 },
  { asset_id: 'a2', name: '设备', total_value: 60000 * YUAN, start_month: '2026-01', total_months: 60 },
];
const MONTH = '2026-10';
const LEDGER_MONTHLY = (120000 * YUAN) / 36 + (60000 * YUAN) / 60; // 应为 433333.33… 分

const R = [];
function ck(name, pass, detail) {
  R.push({ name, pass: !!pass, detail: detail || '' });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  —— ' + detail : ''}`);
}

// ══════════ 真引擎 ══════════
const sched = require(path.join(ROOT, 'cloudfunctions/getAmortSchedule/service.js'));
const { calcMonthlyProfit } = require(path.join(ROOT, 'cloudfunctions/calcMonthlyProfit/service.js'));

const schedOut = sched.amortizeForMonth(ASSETS, MONTH);
const LEDGER_TOTAL = schedOut.total_amount_fen;
const detailSum = (schedOut.details || []).reduce((s, d) => s + (d.amount_fen || 0), 0);

console.log('\n══ 台账侧（getAmortSchedule 真实出参）══');
console.log(`  台账应摊合计 total_amount_fen = ${LEDGER_TOTAL} 分 = ¥${(LEDGER_TOTAL / FEN).toFixed(2)}`);
(schedOut.details || []).forEach((d) => {
  console.log(`    · ${d.name || d.asset_id}  月摊销 ${d.amount_fen} 分 = ¥${(d.amount_fen / FEN).toFixed(2)}`);
});

// 利润侧：同一份业务数据，只切开关
const INCOME = [{ category: 'a', name: '堂食', amountFen: 6400000 }];
const EXPENSE = [
  { category: 'rent', name: '房租', amountFen: 1800000 },
  { category: 'labor', name: '人工', amountFen: 1484000 },
];
const DIRECT_CONSUME = 2200000;  // 直接填的食材消耗
const LUMP = 300000;             // 本月一次算清 3,000

function runProfit(amortOn) {
  return calcMonthlyProfit({
    incomeItems: INCOME,
    expenseItems: EXPENSE,
    directConsumeFen: DIRECT_CONSUME,
    inventory: {},
    lumpSumFen: LUMP,
    amortizeFen: Math.round(LEDGER_TOTAL),
    amortizeSwitchOn: amortOn,
    inventorySwitchOn: false,
  });
}
const OFF = runProfit(false);
const ON = runProfit(true);

console.log('\n══ 利润侧（calcMonthlyProfit 真实出参）══');
console.log(`  开关关：effectiveAmortizeFen=${OFF.effectiveAmortizeFen}  真实利润=${OFF.totalFactorRealProfitFen} 分`);
console.log(`  开关开：effectiveAmortizeFen=${ON.effectiveAmortizeFen}  真实利润=${ON.totalFactorRealProfitFen} 分`);
console.log(`  两侧利润差=${ON.totalFactorRealProfitFen - OFF.totalFactorRealProfitFen} 分 = ¥${((ON.totalFactorRealProfitFen - OFF.totalFactorRealProfitFen) / FEN).toFixed(2)}`);

// ══════════ A 组：Q1「钱到底有没有被扣」 ══════════
console.log('\n══ A 组 · 开关关掉后钱到底扣没扣 ══');
ck('A-① 开关关 ⇒ 真正计入利润的摊销 effectiveAmortizeFen === 0（钱没被扣）',
  OFF.effectiveAmortizeFen === 0, `实得 ${OFF.effectiveAmortizeFen} 分`);
ck('A-② 开关开 ⇒ effectiveAmortizeFen === 台账应摊（证明 A-① 不是引擎根本不读这个字段）',
  ON.effectiveAmortizeFen === Math.round(LEDGER_TOTAL), `实得 ${ON.effectiveAmortizeFen} vs 台账 ${Math.round(LEDGER_TOTAL)}`);
ck('A-③ 两侧真实利润差的**绝对值** === 台账月应摊（一分不多一分不少）⇒ 开关动的就是这一笔，不是别的',
  Math.abs(Math.abs(ON.totalFactorRealProfitFen - OFF.totalFactorRealProfitFen) - LEDGER_TOTAL) <= 1,
  `|差| ${Math.abs(ON.totalFactorRealProfitFen - OFF.totalFactorRealProfitFen)} vs 应摊 ${LEDGER_TOTAL.toFixed(2)}`);
ck('A-④ 开关关 ⇒ 一次性投入仍照扣（开关不牵连别的减项）',
  OFF.effectiveLumpSumFen === LUMP || OFF.lumpSumFen === LUMP,
  `effectiveLumpSum=${OFF.effectiveLumpSumFen}`);

// ══════════ B 组：Q2「页面那个数是哪个口径」 ══════════
console.log('\n══ B 组 · 页面那个数是「本月扣的」还是「台账该摊的」══');
ck('B-① 台账出参 total_amount_fen 与开关无关（getAmortSchedule 不读开关 ⇒ 恒为台账应摊）',
  Math.abs(LEDGER_TOTAL - LEDGER_MONTHLY) <= 1,
  `出参 ${LEDGER_TOTAL.toFixed(2)} vs 算式 ${LEDGER_MONTHLY.toFixed(2)}`);
ck('B-② 台账应摊 ≠ 实际计入（两者相差正好一整笔）⇒ 页首大数字若照搬台账值，就是在报「没扣的钱」',
  Math.abs((LEDGER_TOTAL - OFF.effectiveAmortizeFen) - LEDGER_TOTAL) < 1,
  `台账 ${LEDGER_TOTAL.toFixed(2)} / 实扣 ${OFF.effectiveAmortizeFen}`);
ck('B-③ details 明细之和 === total_amount_fen（表内自洽，不是拼错）',
  Math.abs(detailSum - LEDGER_TOTAL) <= 1, `明细和 ${detailSum} / 合计 ${LEDGER_TOTAL}`);

// ══════════ C 组：页面真跑（桩 wx/api 后调真 load）══════════
console.log('\n══ C 组 · 摊销页真跑（开关关着）══');
let pageCfg = null;
global.Page = (c) => { pageCfg = c; };
global.getApp = () => ({ globalData: { shop_id: 's1', switches: {} } });

// 构造 getAmortSchedule 的**真实结构**出参（字段名与 index.js 的 ok({...}) 完全一致）
function mockScheduleResp(amortOn) {
  return {
    shop_id: 's1', month: MONTH,
    assets: ASSETS.map((a) => ({
      asset_id: a.asset_id, name: a.name, value_fen: a.total_value,
      start_month: a.start_month, total_months: a.total_months, terminate_month: '',
      group_id: '', batch_seq: 1,
      paid_months: 10, total_periods: a.total_months, paid_fen: 0,
      remaining_fen: a.total_value, end_month: '2029-12',
    })),
    lumps: [],
    lump_total_fen: 0,
    is_archive: false,
    amortize_switch_on: amortOn,
    total_amount_fen: Math.round(LEDGER_TOTAL),
    details: schedOut.details,
    client_request_id: '',
  };
}

let currentOn = false;
const cloudCalls = [];
global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, safeArea: { bottom: 667 } }),
  showToast: () => {}, showModal: () => {}, hideLoading: () => {}, showLoading: () => {},
  navigateTo: () => {}, switchTab: () => {}, reLaunch: () => {}, redirectTo: () => {},
  setNavigationBarTitle: () => {},
  getCurrentPages: () => [{ route: 'subpkg/biz/month/amortize' }],
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: (cb) => cb && cb([]) }) }) }),
  nextTick: (f) => f && f(), vibrateShort: () => {},
  stopPullDownRefresh: () => {},
};

// 拦截 api.call：只对 getAmortSchedule 吐出构造好的真实结构
const apiPath = path.join(ROOT, 'utils/api.js');
const apiMod = require(apiPath);
apiMod.call = async (name) => {
  cloudCalls.push(name);
  if (name === 'getAmortSchedule') return mockScheduleResp(currentOn);
  return {};
};
apiMod.ensureShop = async () => {};
apiMod.toastError = () => {};

require(path.join(ROOT, 'subpkg/biz/month/amortize.js'));
const page = Object.assign({}, pageCfg);
page.data = JSON.parse(JSON.stringify(pageCfg.data));
page.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
page.data.month = MONTH;

(async () => {
  // —— 开关关 ——
  currentOn = false;
  await page.load();
  const offShown = page.data.shownTotalYuan;
  const offLedger = page.data.totalYuan;
  const offNote = page.data.offNote;
  const offAssetMonths = (page.data.assets || []).map((a) => `${a.name}=¥${a.amountYuan}`);
  console.log(`  开关关：页首大数字 shownTotalYuan = 「¥${offShown}」  amortizeOn=${page.data.amortizeOn}`);
  console.log(`    台账额 totalYuan = 「¥${offLedger}」  附注 = 「${offNote}」`);
  console.log(`    资产行：${offAssetMonths.join('  ')}`);

  ck('C-① 开关关时页面确实拿到 amortizeOn=false（不是开关状态没刷新）',
    page.data.amortizeOn === false, `amortizeOn=${page.data.amortizeOn}`);
  ck('C-② 【本轮修复点】开关关时页首大数字 === 0.00（本月确实没扣这笔钱）',
    String(offShown) === '0.00', `实得「${offShown}」`);
  ck('C-③ 开关关时台账应摊额仍在附注里（信息不丢，老板要知道这笔钱每月该摊多少）',
    String(offLedger) === '4333.33' && offNote.indexOf('4333.33') >= 0,
    `台账「${offLedger}」/ 附注「${offNote}」`);
  ck('C-④ 附注明确写了「不计入」（不能只有数字没有口径）',
    offNote.indexOf('不计入') >= 0, `附注「${offNote}」`);
  ck('C-⑤ 开关关时每笔资产「月摊销」仍有值（**台账属性，必须保留** —— 设备 = 1000.00）',
    (page.data.assets || []).every((a) => Number(a.amountYuan) > 0),
    (page.data.assets || []).map((a) => a.amountYuan).join(','));
  ck('C-⑥ 开关关时区块标题走「台账口径」版（整块标注不进本月利润，行内数字就不用逐个化妆）',
    String(page.data.t.amortSectionTitleOff).indexOf('不计入') >= 0,
    `标题「${page.data.t.amortSectionTitleOff}」`);

  // —— 开关开（对照组）——
  currentOn = true;
  await page.load();
  const onShown = page.data.shownTotalYuan;
  const onLedger = page.data.totalYuan;
  console.log(`  开关开：页首大数字 shownTotalYuan = 「¥${onShown}」  amortizeOn=${page.data.amortizeOn}  附注 = 「${page.data.offNote}」`);
  ck('C-⑦ 【对照组】开关开时页首大数字 === 台账应摊额（证明 C-② 不是恒为 0）',
    String(onShown) === '4333.33', `实得「${onShown}」`);
  ck('C-⑧ 开关开时附注为空（开着就不用解释"没扣"，少一句是一句）',
    page.data.offNote === '', `实得「${page.data.offNote}」`);
  ck('C-⑨ 台账额两侧完全相同（⇒ 变的只有"计不计入"这一层，台账事实没被改动）',
    String(onLedger) === String(offLedger), `开「${onLedger}」/ 关「${offLedger}」`);
  ck('C-⑩ 开关开时 amortizeOn=true（对照，证明 C-① 不是恒真）',
    page.data.amortizeOn === true, `amortizeOn=${page.data.amortizeOn}`);

  // ══════════ E 组：归档月口径（第二轮审计挖出的连带缺陷）══════════
// 起因：摊销页读**实时**开关，结果页/月报列表经 getLedger 读**归档快照** ⇒ 归档后改开关，
//   同一月份摊销页说「未扣」、结果页说「扣了」。R735 页首数字跟开关走后，这个矛盾变成显性错误。
console.log('\n══ E 组 · 归档月必须用落库快照（与 getLedger 同口径）══');
const amortSvc = require(path.join(ROOT, 'cloudfunctions/getAmortSchedule/service.js'));
const glSvc = require(path.join(ROOT, 'cloudfunctions/getLedger/service.js'));

const E_SNAPSHOT_ON_LIVE_OFF = {
  isArchive: true,
  switchUsed: { inventorySwitchOn: false, amortizeSwitchOn: true },  // 封账时是开的
  liveInventorySwitchOn: false,
  liveAmortizeSwitchOn: false,                                        // 今天关掉了
};
const eArch = amortSvc.resolveArchiveSwitches(E_SNAPSHOT_ON_LIVE_OFF);
ck('E-① 归档月：今天关掉开关，该月仍按封账快照（开）⇒ 历史月不被今天的操作改动',
  eArch.amortizeSwitchOn === true && eArch.source === 'snapshot',
  `amort=${eArch.amortizeSwitchOn} source=${eArch.source}`);

const eLive = amortSvc.resolveArchiveSwitches(Object.assign({}, E_SNAPSHOT_ON_LIVE_OFF, { isArchive: false }));
ck('E-② 未归档月：用实时开关（开关是实时控件，改了该立刻看到效果）——证明 E-① 不是恒真',
  eLive.amortizeSwitchOn === false && eLive.source === 'live',
  `amort=${eLive.amortizeSwitchOn} source=${eLive.source}`);

const eNoSnap = amortSvc.resolveArchiveSwitches({ isArchive: true, switchUsed: null, liveInventorySwitchOn: false, liveAmortizeSwitchOn: true });
ck('E-③ 归档但快照缺失 ⇒ fail-open 回落实时并**标明来源**（上线前归档的老月仍可看，不硬拒）',
  eNoSnap.amortizeSwitchOn === true && eNoSnap.source === 'live_no_snapshot',
  `amort=${eNoSnap.amortizeSwitchOn} source=${eNoSnap.source}`);

// 逐字一致：防「两处各算一套」漂移（同 terms.js 双副本治理手法）
function grabFn(src, name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) return '';
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') { d++; started = true; }
    else if (src[k] === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  return src.slice(i);
}
const fnA = grabFn(read('cloudfunctions/getAmortSchedule/service.js'), 'resolveArchiveSwitches');
const fnB = grabFn(read('cloudfunctions/getLedger/service.js'), 'resolveArchiveSwitches');
ck('E-④ getAmortSchedule 与 getLedger 的 resolveArchiveSwitches **正文逐字一致**（防两处各立一套口径）',
  fnA.length > 100 && fnA === fnB, `长度 ${fnA.length} vs ${fnB.length}，逐字相同=${fnA === fnB}`);

const gsIdx = read('cloudfunctions/getAmortSchedule/index.js');
ck('E-⑤ getAmortSchedule 真的用上了快照函数（不是只定义没接线），且出参带 switch_source',
  /resolveArchiveSwitches\s*\(/.test(gsIdx) && /switch_source:\s*sw\.source/.test(gsIdx),
  'index.js 调用 + 透出来源');
ck('E-⑥ getAmortSchedule 里不再有「直接读实时开关就返回」的老写法（防回退）',
  !/amortizeSwitchOn\s*=\s*!!\(\(swRows\.find/.test(gsIdx),
  '老的 `!!((swRows.find(...)||{}).enabled)` 已移除');
// 🔴 E-⑦：**本轮变异回灌暴露的断言缺口，补上**
//   只验「快照函数被调用」不够 —— 变异回灌实测：把出参改回 `swGet('amortize_switch')`（调用照旧、
//   结果被覆盖）时，E-⑤ 仍绿 ⇒ 断言测不到接线。必须直接钉住**赋值来源**。
ck('E-⑦ 出参开关**取自快照结果** sw.amortizeSwitchOn，且全文不得再出现 `= swGet(\'amortize_switch\')`',
  /amortizeSwitchOn\s*=\s*sw\.amortizeSwitchOn/.test(gsIdx)
    && !/amortizeSwitchOn\s*=\s*swGet\(\s*['"]amortize_switch['"]\s*\)/.test(gsIdx),
  '赋值来源正确且无实时覆盖');

// ── 汇总 ──
  const pass = R.filter((x) => x.pass).length;
  const fail = R.length - pass;
  console.log(`\n摊销页数值口径取证结果：${pass} 通过 / ${fail} 失败（共 ${R.length} 条）`);
  console.log('\n【结论】');
  console.log('  Q1 钱有没有被扣？—— 没有。effectiveAmortizeFen = 0，两侧利润差正好一整笔台账应摊。');
  console.log('  Q2 页面那个数是哪个？—— 原先是「台账每月该摊多少」，与开关无关（开关开/关页面数字一模一样）。');
  console.log('  Q3 修正后 —— 页首大数字跟开关走（关 ⇒ ¥0.00），台账额进附注；');
  console.log('     每笔资产「月摊销」保留（台账属性），区块标题标注台账口径。');
  process.exit(fail === 0 ? 0 : 1);
})();
