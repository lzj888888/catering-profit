#!/usr/bin/env node
// tools/check_amort_display_caliber.js —— 摊销「结果位显示口径」守卫（R735）
//
// 【为什么要有这个守卫】
//   李老师原话：「管理摊销资产 启用和不启用分期分摊 这个开关，貌似 数值都按摊销算。
//   比如 最上面本月摊销合计 开关关闭 不计入利润 有数值显示，不知道正不正常。
//   设备 月摊销 也显示数值。摊销这块你处理完，务必多轮审计。」
//
//   这是「开关生效」问题的**第三次换皮出现**：
//     R732 → 录入页摘要/导出件/摊销页标题没跟开关（引擎是对的，呈现层漏）
//     R733 → 功能入口被开关当闸门（页内成立、入口被封）
//     R735 → **结果位**仍报台账额（名字叫"合计"，读起来就是"本月扣了这么多"）
//   三次同一个病根：**引擎算对了，页面没说清"这个数进没进利润"**。
//   前两次都只修了当时看见的那几处，没把"结果位必须跟开关走"立成判据 ⇒ 这次立。
//
// 【判据分三层】
//   H · 页首结果位：真跑摊销页 load()，读 data —— 开关关掉时大数字必须是 ¥0.00，
//       台账应摊额只能在**附注**里；每笔资产的「月摊销」是台账属性，**必须保留**（防我过度清零）
//   I · 归档月快照：归档月的开关必须用落库快照（与 getLedger 同口径），
//       否则「摊销页说没扣、结果页说扣了」——同一月份两个页面互相打脸
//   J · 反恒真：把页首口径与快照口径**分别改坏**，H-①/I-① 必须当场转红
//
// 【铁律】只看行为（真跑页面 / 真调函数），源码锁只用来钉"接线点没被改回去"。
//
// 用法：node tools/check_amort_display_caliber.js

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');
const FEN = 100;

const R = [];
let curGroup = '';
function group(name) { curGroup = name; }
function ck(name, pass, detail) {
  R.push({ group: curGroup, name, pass: !!pass, detail: detail || '' });
}

// ── 与 R732 同一套业务数据，保持可比 ──
const YUAN = 100;
const ASSETS = [
  { asset_id: 'a1', name: '装修', total_value: 120000 * YUAN, start_month: '2026-01', total_months: 36 },
  { asset_id: 'a2', name: '设备', total_value: 60000 * YUAN, start_month: '2026-01', total_months: 60 },
];
const MONTH = '2026-10';
const LEDGER_MONTHLY = (120000 * YUAN) / 36 + (60000 * YUAN) / 60;   // 433333.33… 分

const sched = require(F('cloudfunctions/getAmortSchedule/service.js'));
const schedOut = sched.amortizeForMonth(ASSETS, MONTH);
const LEDGER_TOTAL = schedOut.total_amount_fen;

// ── 页面真跑用的桩 ──
global.getApp = () => ({ globalData: { shop_id: 's1', switches: {} } });
global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, safeArea: { bottom: 667 } }),
  showToast: () => {}, showModal: () => {}, hideLoading: () => {}, showLoading: () => {},
  navigateTo: () => {}, switchTab: () => {}, reLaunch: () => {}, redirectTo: () => {},
  setNavigationBarTitle: () => {},
  getCurrentPages: () => [{ route: 'subpkg/biz/month/amortize' }],
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: (cb) => cb && cb([]) }) }) }),
  nextTick: (f) => f && f(), vibrateShort: () => {}, stopPullDownRefresh: () => {},
};

// api 只保留 call / ensureShop / toastError / fenToYuan（其余走真实现）
const apiMod = require(F('utils/api.js'));
let scheduleSwitchOn = false;
apiMod.call = async (name) => {
  if (name === 'getAmortSchedule') {
    return {
      shop_id: 's1', month: MONTH,
      assets: ASSETS.map((a) => ({
        asset_id: a.asset_id, name: a.name, value_fen: a.total_value,
        start_month: a.start_month, total_months: a.total_months, terminate_month: '',
        group_id: '', batch_seq: 1, paid_months: 10, total_periods: a.total_months,
        remaining_fen: a.total_value, end_month: '2029-12',
      })),
      lumps: [], lump_total_fen: 0, is_archive: false,
      amortize_switch_on: scheduleSwitchOn,
      switch_source: 'live',
      total_amount_fen: Math.round(LEDGER_TOTAL),
      details: schedOut.details,
      client_request_id: '',
    };
  }
  return {};
};
apiMod.ensureShop = async () => {};
apiMod.toastError = () => {};

// 允许用**变异后的源码**加载页面（内存编译，不落盘 —— 同 check_amort_switch_matrix 的 loadMutant 手法）
function loadPage(src) {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  const abs = F('subpkg/biz/month/amortize.js');
  const M = new Module(abs, module);
  M.filename = abs;
  M.paths = Module._nodeModulePaths(path.dirname(abs));
  M._compile(src, abs);
  if (!cfg) return null;
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p.data.month = MONTH;
  return p;
}
const PAGE_SRC = read('subpkg/biz/month/amortize.js');

async function runPage(switchOn, src) {
  scheduleSwitchOn = switchOn;
  const p = loadPage(src || PAGE_SRC);
  await p.load();
  return p;
}

(async () => {
  // ==================================================================
  group('H · 页首结果位（开关关掉后大数字必须报"本月没扣"）');
  // ==================================================================
  const off = await runPage(false);
  const on = await runPage(true);

  ck('H-① 开关关 ⇒ 页首大数字 shownTotalYuan === 「0.00」（本月确实没扣这笔钱）',
    String(off.data.shownTotalYuan) === '0.00', `实得「${off.data.shownTotalYuan}」`);
  ck('H-② 开关关 ⇒ 台账应摊额仍在附注里（信息不丢：老板要知道这笔钱每月该摊多少）',
    String(off.data.totalYuan) === '4333.33' && String(off.data.offNote).indexOf('4333.33') >= 0,
    `台账「${off.data.totalYuan}」/ 附注「${off.data.offNote}」`);
  ck('H-③ 开关关 ⇒ 附注明确写了「不计入」（不能只有数字没有口径）',
    String(off.data.offNote).indexOf('不计入') >= 0, `附注「${off.data.offNote}」`);
  ck('H-④ 开关关 ⇒ 每笔资产「月摊销」**仍有值**（台账属性，不许被我顺手清零：设备 = 1000.00）',
    (off.data.assets || []).every((a) => Number(a.amountYuan) > 0)
      && (off.data.assets || []).some((a) => a.amountYuan === '1000.00'),
    (off.data.assets || []).map((a) => a.amountYuan).join(','));
  ck('H-⑤ 开关关 ⇒ 分期摊销区块标题走「台账口径」版（整块标注不进本月利润，行内数字不必逐个化妆）',
    String(off.data.t.amortSectionTitleOff).indexOf('不计入') >= 0,
    `标题「${off.data.t.amortSectionTitleOff}」`);
  ck('H-⑥ 【对照组】开关开 ⇒ 页首大数字 === 台账应摊额（证明 H-① 不是恒 0）',
    String(on.data.shownTotalYuan) === '4333.33', `实得「${on.data.shownTotalYuan}」`);
  ck('H-⑦ 开关开 ⇒ 附注为空（开着就别解释"没扣"，少一句是一句）',
    on.data.offNote === '', `实得「${on.data.offNote}」`);
  ck('H-⑧ 台账额两侧完全相同（⇒ 变的只有"计不计入"这一层，台账事实没被改动）',
    String(on.data.totalYuan) === String(off.data.totalYuan),
    `开「${on.data.totalYuan}」/ 关「${off.data.totalYuan}」`);
  ck('H-⑨ 页面拿到的开关值确实跟随出参（不是读前端缓存导致"弹回"）',
    off.data.amortizeOn === false && on.data.amortizeOn === true,
    `关=${off.data.amortizeOn} 开=${on.data.amortizeOn}`);

  // 源码锁：wxml 的大数字必须绑 shownTotalYuan（防改回 totalYuan）
  const amWxml = read('subpkg/biz/month/amortize.wxml');
  const numLine = (amWxml.split('\n').find((l) => l.indexOf('result-num') >= 0) || '');
  ck('H-⑩ wxml 页首大数字绑的是 shownTotalYuan（若改回 totalYuan，H-① 会绿在假数据上）',
    numLine.indexOf('shownTotalYuan') >= 0, numLine.trim());

  // ==================================================================
  group('I · 归档月快照（与 getLedger 同口径，防"同月两页互相打脸"）');
  // ==================================================================
  const glSvc = require(F('cloudfunctions/getLedger/service.js'));
  const SNAP_ON_LIVE_OFF = {
    isArchive: true,
    switchUsed: { inventorySwitchOn: false, amortizeSwitchOn: true },   // 封账时是开的
    liveInventorySwitchOn: false,
    liveAmortizeSwitchOn: false,                                        // 今天关掉了
  };
  const iArch = sched.resolveArchiveSwitches(SNAP_ON_LIVE_OFF);
  ck('I-① 归档月：今天关掉开关，该月仍按封账快照（开）⇒ 历史月不被今天的操作改动',
    iArch.amortizeSwitchOn === true && iArch.source === 'snapshot',
    `amort=${iArch.amortizeSwitchOn} source=${iArch.source}`);
  const iLive = sched.resolveArchiveSwitches(Object.assign({}, SNAP_ON_LIVE_OFF, { isArchive: false }));
  ck('I-② 【对照】未归档月用实时开关（开关是实时控件，改了该立刻看到效果）—— 证明 I-① 不是恒真',
    iLive.amortizeSwitchOn === false && iLive.source === 'live',
    `amort=${iLive.amortizeSwitchOn} source=${iLive.source}`);
  const iNoSnap = sched.resolveArchiveSwitches({ isArchive: true, switchUsed: null, liveInventorySwitchOn: false, liveAmortizeSwitchOn: true });
  ck('I-③ 归档但快照缺失 ⇒ fail-open 回落实时并**标明来源**（上线前归档的老月仍可看，不硬拒）',
    iNoSnap.amortizeSwitchOn === true && iNoSnap.source === 'live_no_snapshot',
    `amort=${iNoSnap.amortizeSwitchOn} source=${iNoSnap.source}`);

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
  ck('I-④ getAmortSchedule 与 getLedger 的 resolveArchiveSwitches **正文逐字一致**（防两处各立一套口径）',
    fnA.length > 100 && fnA === fnB, `长度 ${fnA.length} vs ${fnB.length}，逐字相同=${fnA === fnB}`);

  const gsIdx = read('cloudfunctions/getAmortSchedule/index.js');
  ck('I-⑤ getAmortSchedule 真的用上了快照函数，且出参透出 switch_source（便于排查"按哪份算的"）',
    /resolveArchiveSwitches\s*\(/.test(gsIdx) && /switch_source:\s*sw\.source/.test(gsIdx),
    'index.js 调用 + 透出来源');
  ck('I-⑥ 老写法 `!!((swRows.find(...)||{}).enabled)`（直接读实时就返回）已移除',
    !/amortizeSwitchOn\s*=\s*!!\(\(swRows\.find/.test(gsIdx), '已移除');
  // 🔴 I-⑦：**变异回灌暴露的断言缺口，本轮补上**
  //   只验「快照函数被调用」不够 —— 实测把出参改回 `swGet('amortize_switch')`（调用照旧、结果被覆盖）
  //   时 I-⑤ 仍绿 ⇒ 必须直接钉住**赋值来源**。
  ck('I-⑦ 出参开关**取自快照结果** sw.amortizeSwitchOn，全文不得再出现 `= swGet(\'amortize_switch\')`',
    /amortizeSwitchOn\s*=\s*sw\.amortizeSwitchOn/.test(gsIdx)
      && !/amortizeSwitchOn\s*=\s*swGet\(\s*['"]amortize_switch['"]\s*\)/.test(gsIdx),
    '赋值来源正确且无实时覆盖');

  // ==================================================================
  group('J · 反恒真（证明 H/I 测得到东西）');
  // ==================================================================
  // J-① 变异：把页首口径改回「直接报台账额」（R732 的老写法），H-① 必须转红
  const H_ANCHOR = "shownTotalYuan: amortOn ? ledgerYuan : '0.00',";
  let j1 = { caught: false, detail: '变异锚点未找到（源码已改，请同步本守卫）' };
  if (PAGE_SRC.indexOf(H_ANCHOR) >= 0) {
    const mutSrc = PAGE_SRC.replace(H_ANCHOR, 'shownTotalYuan: ledgerYuan,');
    const mp = await runPage(false, mutSrc);
    j1 = {
      caught: String(mp.data.shownTotalYuan) !== '0.00',
      detail: `变异后 off.shownTotalYuan=「${mp.data.shownTotalYuan}」（期望 ≠0.00）`,
    };
  }
  ck('J-① 变异回灌：把页首口径改回「直接报台账额」⇒ H-① 当场转红（非恒真）', j1.caught, j1.detail);

  // J-② 变异：把快照判据摘掉（永远用实时），I-① 必须转红
  const I_ANCHOR = "if (!inp.isArchive) return Object.assign({ source: 'live' }, LIVE);";
  let j2 = { caught: false, detail: '变异锚点未找到（源码已改，请同步本守卫）' };
  if (fnA.indexOf(I_ANCHOR) >= 0) {
    const mutFnSrc = read('cloudfunctions/getAmortSchedule/service.js')
      .replace(I_ANCHOR, "return Object.assign({ source: 'live' }, LIVE);");
    const abs = F('cloudfunctions/getAmortSchedule/service.js');
    const M = new Module(abs, module);
    M.filename = abs;
    M.paths = Module._nodeModulePaths(path.dirname(abs));
    M._compile(mutFnSrc, abs);
    if (M.exports && M.exports.resolveArchiveSwitches) {
      const r = M.exports.resolveArchiveSwitches(SNAP_ON_LIVE_OFF);
      j2 = { caught: r.amortizeSwitchOn === false, detail: `变异后归档月 amort=${r.amortizeSwitchOn}（期望=false）` };
    }
  }
  ck('J-② 变异回灌：摘掉"归档用快照"判据 ⇒ I-① 当场转红（非恒真）', j2.caught, j2.detail);

  // J-③ 自失效护栏：扫描面非退化（源文件都读到了，锚点都在场）
  ck('J-③ 自失效护栏：两个变异锚点均在当前源码中存在（否则上面两条会恒绿）',
    PAGE_SRC.indexOf(H_ANCHOR) >= 0 && fnA.indexOf(I_ANCHOR) >= 0,
    `H锚点=${PAGE_SRC.indexOf(H_ANCHOR) >= 0} I锚点=${fnA.indexOf(I_ANCHOR) >= 0}`);

  // ==================================================================
  // 输出
  // ==================================================================
  console.log('\n===== R735 · 摊销结果位显示口径 =====\n');
  let lastG = '', pass = 0, fail = 0;
  const fails = [];
  for (const r of R) {
    if (r.group !== lastG) { console.log('\n【' + r.group + '】'); lastG = r.group; }
    const mark = r.pass ? '✅' : '❌';
    if (r.pass) pass++; else { fail++; fails.push(r); }
    console.log(`  ${mark} ${r.name}${r.detail ? '   « ' + r.detail + ' »' : ''}`);
  }
  console.log(`\n摊销结果位显示口径结果：${pass} 通过 / ${fail} 失败（共 ${R.length} 条）`);
  if (fails.length) {
    console.log('\n—— 失败项（= 页面报的钱跟开关不符，需修）——');
    fails.forEach((f) => console.log(`  · ${f.name}\n      ${f.detail}`));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('守卫自身异常：', e && e.stack || e);
  process.exit(1);
});
