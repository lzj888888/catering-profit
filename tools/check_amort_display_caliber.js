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
// 🔴 R740：服务端**恒报 `amortize_switch_on: true`**（摊销一律计入，开关已退役）。
//   这里不再调用任何 `amortRuleV2` —— 那个函数连同时间闸门已经在 R740 拆掉了。
//   桩若继续"按月派生开关"，测的就是一个生产环境不存在的世界（R737 的教训：
//   桩按引擎的样子造数据，而不是按库的样子造 ⇒ 断言再严也必然假绿）。
let scheduleMonth = MONTH;
// 🔴 R741：归档月场景桩。null = 未归档（默认，保持既有断言不变）。
//   非 null 时返回「封账值 snapshot ≠ 现算值 recomputed」的真实出参形态 ——
//   **出参字段名必须与 getAmortSchedule/index.js 一致**（R737 教训：桩按引擎的样子造
//   而不是按库/接口的样子造 ⇒ 断言再严也必然假绿）。
let scheduleArchive = null;
apiMod.call = async (name) => {
  if (name === 'getAmortSchedule') {
    const monthOut = scheduleMonth;
    const snap = scheduleArchive ? scheduleArchive.snapshot : Math.round(LEDGER_TOTAL);
    const recomputed = scheduleArchive ? scheduleArchive.recomputed : Math.round(LEDGER_TOTAL);
    return {
      shop_id: 's1', month: monthOut,
      assets: ASSETS.map((a) => ({
        asset_id: a.asset_id, name: a.name, value_fen: a.total_value,
        start_month: a.start_month, total_months: a.total_months, terminate_month: '',
        group_id: '', batch_seq: 1, paid_months: 10, total_periods: a.total_months,
        remaining_fen: a.total_value, end_month: '2029-12',
      })),
      lumps: [], lump_total_fen: 0,
      is_archive: !!scheduleArchive,
      // R740：恒 true —— 与 getAmortSchedule/index.js 的真实出参一致
      amortize_switch_on: true,
      switch_source: scheduleArchive ? 'snapshot' : 'live',
      total_amount_fen: snap,
      // R741：新增的两个出参，与生产同名字段
      recomputed_total_fen: recomputed,
      caliber_drift_fen: scheduleArchive ? (recomputed - snap) : 0,
      details: schedOut.details,
      client_request_id: '',
    };
  }
  return {};
};
apiMod.ensureShop = async () => {};
apiMod.toastError = () => {};

// 允许用**变异后的源码**加载页面（内存编译，不落盘 —— 同 check_amort_switch_matrix 的 loadMutant 手法）
function loadPage(src, month) {
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
  p.data.month = month || MONTH;
  return p;
}
const PAGE_SRC = read('subpkg/biz/month/amortize.js');

async function runPage(switchOn, src, month, archive) {
  scheduleSwitchOn = switchOn;
  scheduleMonth = month || MONTH;
  scheduleArchive = archive || null;
  const p = loadPage(src || PAGE_SRC, month);
  await p.load();
  return p;
}

(async () => {
  // ==================================================================
  group('H · 页首结果位：恒等于台账应摊额（R740 拆闸门后不分月份、不看开关）');
  // ==================================================================
  // 🔴 R740 推翻 R735 的 H 段口径。原判据是「开关关 ⇒ 页首报 0.00」，那是开关还活着时的规则；
  //   R736 删了开关、R740 拆了月份闸门之后，服务端恒报 `amortize_switch_on: true`，
  //   页面**任何情况下**都必须显示台账应摊额。若某天页面又报 0.00，说明有人在页面里
  //   重新加回了开关/月份判据 —— 那正是本段要抓的。
  const off = await runPage(false);
  const on = await runPage(true);

  ck('H-① 页首大数字 shownTotalYuan === 台账应摊额 4333.33（一律计入，不问开关、不问月份）',
    String(off.data.shownTotalYuan) === '4333.33', `实得「${off.data.shownTotalYuan}」`);
  ck('H-② 附注为空（既然一律计入，就不该再解释"本月没扣"）',
    off.data.offNote === '', `实得「${off.data.offNote}」`);
  ck('H-③ 每笔资产「月应摊额」仍有值（台账属性，不许被顺手清零：设备 = 1000.00）',
    (off.data.assets || []).every((a) => Number(a.amountYuan) > 0)
      && (off.data.assets || []).some((a) => a.amountYuan === '1000.00'),
    (off.data.assets || []).map((a) => a.amountYuan).join(','));
  ck('H-④ 页首台账额 === 引擎算出的台账合计（页面不许自己另算一套口径）',
    Math.round(Number(String(off.data.totalYuan).replace(/,/g, '')) * 100) === Math.round(LEDGER_TOTAL),
    `页面「${off.data.totalYuan}」/ 引擎 ${LEDGER_TOTAL / 100}`);
  ck('H-⑤ 页面拿到的开关值恒 true（服务端权威；若变 false 说明有人把出参改回了快照值）',
    off.data.amortizeOn === true && on.data.amortizeOn === true,
    `关=${off.data.amortizeOn} 开=${on.data.amortizeOn}`);
  const m08 = await runPage(false, null, '2026-08');
  const m10 = await runPage(false, null, '2026-10');
  const m11 = await runPage(false, null, '2026-11');
  ck('H-⑥ 历史月份（2026-08，闸门时代本该报"未计入"的月）页首同样报全额',
    String(m08.data.shownTotalYuan) === '4333.33', `实得「${m08.data.shownTotalYuan}」`);
  ck('H-⑦ 三个月（2026-08 / 2026-10 / 2026-11）页首完全一致 —— 结构上已无月份判据',
    String(m08.data.shownTotalYuan) === String(m10.data.shownTotalYuan)
    && String(m10.data.shownTotalYuan) === String(m11.data.shownTotalYuan),
    `08「${m08.data.shownTotalYuan}」/ 10「${m10.data.shownTotalYuan}」/ 11「${m11.data.shownTotalYuan}」`);

  // 源码锁：wxml 的大数字必须绑 shownTotalYuan（防改回 totalYuan）
  const amWxml = read('subpkg/biz/month/amortize.wxml');
  const numLine = (amWxml.split('\n').find((l) => l.indexOf('result-num') >= 0) || '');
  ck('H-⑧ wxml 页首大数字绑的是 shownTotalYuan（若改回 totalYuan，H-① 会绿在假数据上）',
    numLine.indexOf('shownTotalYuan') >= 0, numLine.trim());

  // 变异回灌：把桩改成「服务端报未计入」⇒ H-① 必须当场转红
  {
    const realCall = apiMod.call;
    apiMod.call = async (name) => {
      const out = await realCall(name);
      if (name === 'getAmortSchedule' && out && out.amortize_switch_on !== undefined) out.amortize_switch_on = false;
      return out;
    };
    let mutOut;
    try { mutOut = await runPage(false); } finally { apiMod.call = realCall; }
    ck('H-⑨ 变异回灌：服务端报「未计入」⇒ 页面退回报 0.00（证明 H-① 真在测这条链路）',
      String(mutOut.data.shownTotalYuan) === '0.00',
      `变异后「${mutOut.data.shownTotalYuan}」（0.00 = 已退回老逻辑，说明 H-① 会红）`);
  }

  // ---- K 段（R737）已并入上面的 H 段 ----
  //   原 K 段测的是「2026-11 起服务端恒报已计入，页面不许再报 0」。R740 拆掉月份闸门后，
  //   **所有月份**都满足这条，K 段变成了 H 段的特例 ⇒ 合并（H-⑥/H-⑦ 已覆盖月份维度）。
  //   同时删掉的还有 K-⑦ 的变异锚点 `sched.amortRuleV2` —— 那个生产函数本身已随闸门删除。

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
  ck('I-⑦ 出参开关恒为字面量 true（R740：摊销一律计入，不再从快照/实时读开关）',
    /amortize_switch_on:\s*true\s*,/.test(gsIdx)
      && !/amortizeSwitchOn\s*=\s*sw\.amortizeSwitchOn/.test(gsIdx)
      && !/amortizeSwitchOn\s*=\s*swGet\(/.test(gsIdx),
    '恒 true 且无快照/实时覆盖');

  // ==================================================================
  group('L · 归档月「金额」维度（R741 三司会诊 D-5：守卫必须钉钱，不能只钉开关参数）');
  // ==================================================================
  // 🔴 立项：R735 修过「同月两页互相打脸」，R740 拆闸门时把 `getAmortSchedule` 的
  //   `total_amount_fen` 写成恒 `sched.total_amount_fen`（台账现算），而 getLedger 归档月读
  //   `acct.amortize_fen` 快照 ⇒ 归档月一旦漂移，摊销页报 A、结果页报 B。
  //   **而本脚本 I 段测的是 `amortize_switch_on`（参数），桩里 `is_archive` 硬编码 false** ⇒
  //   一个断言都没碰过「归档月页首到底显示多少钱」。守参数不守金额，是这条回归能活下来的原因。
  const ARCH = { snapshot: 0, recomputed: Math.round(LEDGER_TOTAL) };   // 封账 0 / 现算 4333.33

  // 页首赋值行 —— L-⑥ 与 J-① 共用同一个锚点（两处必须钉同一行，否则一个变异灵一个不灵）。
  //   提出到这里是因为 L 段在 J 段之前，`const` 在 J 段里声明会撞 TDZ（实测报错过一次）。
  const H_ANCHOR = "shownTotalYuan: amortOn ? ledgerYuan : '0.00',";

  // L-① 静态：服务端出参必须真的从落库快照取（否则页面再怎么显示都是错源）
  ck('L-① 服务端 getAmortSchedule 归档月 total_amount_fen 取自落库快照（isArchive ? snapshot : 现算）',
    /const\s+totalAmountFen\s*=\s*isArchive\s*\?\s*snapshotFen\s*:\s*recomputedTotalFen/.test(gsIdx)
      && /acc\.amortize_fen/.test(gsIdx)
      && /total_amount_fen:\s*totalAmountFen/.test(gsIdx),
    '三元在位 + acc.amortize_fen + 出参接线');

  // L-② 静态：现算值必须作为「对照」一起返回（否则披露只有「可见」没有「可比」）
  ck('L-② 出参同时给 recomputed_total_fen 与 caliber_drift_fen（披露的「可比」条件）',
    /recomputed_total_fen:\s*recomputedTotalFen/.test(gsIdx)
      && /caliber_drift_fen:\s*caliberDriftFen/.test(gsIdx),
    '两个对照字段都在');

  const archPage = await runPage(true, null, MONTH, ARCH);
  ck('L-③ 归档月页首 = **封账值** 0.00（不是现算 4333.33）—— 页面绝不用重算值替换封账数',
    String(archPage.data.shownTotalYuan) === '0.00',
    `实得「${archPage.data.shownTotalYuan}」`);

  ck('L-④ 归档月出差异说明，且三个金额都在（封账 0.00 / 现算 4333.33 / 差额 4333.33）',
    archPage.data.hasArchiveDrift === true
      && /0\.00/.test(archPage.data.archiveDriftNote || '')
      && /4333\.33/.test(archPage.data.archiveDriftNote || '')
      && /取消归档/.test(archPage.data.archiveDriftNote || ''),
    `note=「${archPage.data.archiveDriftNote}」`);

  const livePage = await runPage(true, null, MONTH, null);
  ck('L-⑤ 【对照】未归档月不出差异说明（证明 L-④ 不是恒真）',
    livePage.data.hasArchiveDrift === false && !livePage.data.archiveDriftNote,
    `hasArchiveDrift=${livePage.data.hasArchiveDrift}`);

  // L-⑥ 变异回灌：把页首改成用「重算值」（= 偷偷改封账数）⇒ L-③ 必须转红
  //   ⚠️ 锚点必须选 `shownTotalYuan` 那一行本身 —— 我第一版把变异插在同一个 setData 的
  //     `totalFen:` 处，结果被紧随其后的 `shownTotalYuan:` 覆盖 ⇒ 变异体跑出来还是 0.00，
  //     看着像"断言不灵"，实际是"变异没生效"（同 R740 G-③ 的坑：变异没编进生效路径）。
  let l6 = { caught: false, detail: '变异锚点未找到（源码已改，请同步本守卫）' };
  if (PAGE_SRC.indexOf(H_ANCHOR) >= 0) {
    const mutSrc = PAGE_SRC.replace(
      H_ANCHOR,
      "shownTotalYuan: amortOn ? api.fenToYuan(d.recomputed_total_fen || 0, 2) : '0.00',"
    );
    const mp = await runPage(true, mutSrc, MONTH, ARCH);
    l6 = {
      caught: String(mp.data.shownTotalYuan) !== '0.00',
      detail: `变异后归档月页首=「${mp.data.shownTotalYuan}」（期望 ≠0.00 ⇒ L-③ 会红）`,
    };
  }
  ck('L-⑥ 变异回灌：页首改用「重算值」⇒ L-③ 当场转红（证明守的是钱，不是参数）', l6.caught, l6.detail);

  // ==================================================================
  group('J · 反恒真（证明 H/I 测得到东西）');
  // ==================================================================
  // J-① 变异：把页首口径改成「恒报 0.00」（= 有人又加回了开关/月份判据），H-① 必须转红。
  //   🔴 R740 改向：R735 时变异方向是「改成直接报台账额」（那时正常态是 0）；
  //   现在正常态就是台账额，所以变异方向反过来 —— 否则变异前后都是同一个数，J-① 会假绿。
  //   🔴 R741：锚点 `H_ANCHOR` 已上移到 L 段开头声明（两段共用）。
  let j1 = { caught: false, detail: '变异锚点未找到（源码已改，请同步本守卫）' };
  if (PAGE_SRC.indexOf(H_ANCHOR) >= 0) {
    const mutSrc = PAGE_SRC.replace(H_ANCHOR, "shownTotalYuan: '0.00',");
    const mp = await runPage(false, mutSrc);
    j1 = {
      caught: String(mp.data.shownTotalYuan) !== '4333.33',
      detail: `变异后 off.shownTotalYuan=「${mp.data.shownTotalYuan}」（期望 ≠4333.33 ⇒ H-① 会红）`,
    };
  }
  ck('J-① 变异回灌：页首改成「恒报 0.00」⇒ H-① 当场转红（非恒真）', j1.caught, j1.detail);

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
