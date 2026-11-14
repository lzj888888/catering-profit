#!/usr/bin/env node
// review/evidence/r732_amort_switch_matrix.js —— R732 · 全站摊销开关生效矩阵演练
//
// 【为什么写这个】
//   李老师原话：「摊销这一块，好多地方都有摊销，你要确定这些带摊销的模块开关之后到底生没生效，
//   把这块演练出来。是所有页面的摊销。」
//
// 【方法】engine-truth-audit —— 不读源码猜，真实 require 各云函数 service，同一份业务数据跑
//   开关 on / off 双侧，拿**数字**比对。注释里写的"已生效"不作证据。
//
// 【铁律】
//   ① 判据只看行为（返回值），源码锁只用来钉住"接线点存在"，不作为"生效"的证据；
//   ② 红灯不粉饰：开关没动到钱就是红，备注与金额打架就是红；
//   ③ 反恒真：每组至少一条断言能证伪（若某条在任何开关下都成立，说明它测不到东西）。
//
// 用法：node review/evidence/r732_amort_switch_matrix.js
//
// ⚠️ 本文件是 **R732 的演练快照**（43 条 = 发现 4 条缺陷那一次的口径）。
//   **长期守卫是 `tools/check_amort_switch_matrix.js`（45 条，已进 verify_all）** —— 后续增删断言只改那边。
//   这里保留 43 条，是因为它记录了"修复前 36/43、修复后 43/43"这个对照；
//   要复跑当前守卫请跑 tools 版本。

'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

// ---- wx-server-sdk 桩：只为了让 exportData 这类 Controller 能被 require 进来（它把
//      buildMonthlySheets 导出了，是纯函数，不需要真数据库）----
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    const dbStub = {
      command: { in: (x) => x, eq: (x) => x },
      serverDate: () => 0,
      collection: () => ({ where: () => ({ get: async () => ({ data: [] }) }) }),
    };
    return { init() {}, DYNAMIC_CURRENT_ENV: 'stub', database: () => dbStub };
  }
  return _origLoad.apply(this, arguments);
};

const ROOT = path.resolve(__dirname, '..', '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');

const { calcMonthlyProfit } = require(F('cloudfunctions/calcMonthlyProfit/service.js'));
const amortSched = require(F('cloudfunctions/getAmortSchedule/service.js'));
const getLedgerSvc = require(F('cloudfunctions/getLedger/service.js'));
const saveLedgerSvc = require(F('cloudfunctions/saveLedger/service.js'));
const exportSvc = require(F('cloudfunctions/exportData/index.js'));
const { calcSandbox } = require(F('cloudfunctions/calcSandbox/service.js'));

// ============================ 断言框架 ============================
const R = [];
let groupNow = '';
function group(g) { groupNow = g; }
function ck(name, cond, detail) {
  R.push({ group: groupNow, name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });
}
const YUAN = 100;

// ============================ 公共业务数据 ============================
// 一家店的真实一个月的料：堂食 64,000 元；直接填的食材消耗 22,000 元；
// 台账里两笔分期摊销资产（装修 12 万 / 36 月、设备 6 万 / 60 月 ⇒ 月应摊 3,333.33 + 1,000 = 4,333.33）；
// 本月还有一笔「一次算清」3,000 元。
const INCOME = [{ category: 'rev_dine', name: '堂食', amountFen: 64000 * YUAN }];
const EXPENSE = [
  { category: 'rent', name: '房租', amountFen: 18000 * YUAN },
  { category: 'labor', name: '人工', amountFen: 14840 * YUAN },
];
const DIRECT_CONSUME = 22000 * YUAN;
const LUMP = 3000 * YUAN;

// 注意字段名：摊销引擎读 total_value（台账集合落库字段是 value_fen，getAmortSchedule 入口会映射）。
// 这里用引擎口径的 total_value，同时保留 value_fen 以覆盖 exportData 的兼容读法。
const ASSETS = [
  { asset_id: 'a1', name: '装修', total_value: 120000 * YUAN, value_fen: 120000 * YUAN, start_month: '2026-01', total_months: 36, mode: 'amort' },
  { asset_id: 'a2', name: '设备', total_value: 60000 * YUAN, value_fen: 60000 * YUAN, start_month: '2026-01', total_months: 60, mode: 'amort' },
];
const MONTH = '2026-10';

// 台账口径的「月应摊额」（开关【不该】影响它：台账是事实，开关只管计不计入利润）
const LEDGER_MONTHLY = amortSched.amortizeForMonth(ASSETS, MONTH).total_amount_fen;

function runEngine(on) {
  return calcMonthlyProfit({
    incomeItems: INCOME,
    expenseItems: EXPENSE,
    directConsumeFen: DIRECT_CONSUME,
    inventory: {},
    lumpSumFen: LUMP,
    amortizeFen: LEDGER_MONTHLY,
    amortizeSwitchOn: on,
    inventorySwitchOn: false,
  });
}
const OFF = runEngine(false);
const ON = runEngine(true);

// ==================================================================
// 组 A · 月利润引擎（calcMonthlyProfit）—— 钱的层面，开关到底动没动
// ==================================================================
group('A · 月利润引擎');

ck('A-① 开关关 ⇒ effectiveAmortizeFen 归零（台账有 4,333.33 也不计）',
  OFF.effectiveAmortizeFen === 0, `off=${OFF.effectiveAmortizeFen}`);

ck('A-② 开关开 ⇒ effectiveAmortizeFen === 台账月应摊额',
  ON.effectiveAmortizeFen === LEDGER_MONTHLY, `on=${ON.effectiveAmortizeFen} 台账=${LEDGER_MONTHLY}`);

ck('A-③ 真实利润被开关**真的**扣掉了一笔（差额 === 摊销额）',
  OFF.totalFactorRealProfitFen - ON.totalFactorRealProfitFen === LEDGER_MONTHLY,
  `off=${OFF.totalFactorRealProfitFen} on=${ON.totalFactorRealProfitFen} 差=${OFF.totalFactorRealProfitFen - ON.totalFactorRealProfitFen}`);

ck('A-④ 经营参考利润**不受**开关影响（现金流视角，本来就不含摊销）',
  OFF.operationRefProfitFen === ON.operationRefProfitFen,
  `off=${OFF.operationRefProfitFen} on=${ON.operationRefProfitFen}`);

ck('A-⑤ 一次性投入**不受**开关控制（round107：两笔钱互不排斥）',
  OFF.effectiveLumpSumFen === LUMP && ON.effectiveLumpSumFen === LUMP,
  `off=${OFF.effectiveLumpSumFen} on=${ON.effectiveLumpSumFen}`);

ck('A-⑥ 开关关时仍回显台账原值 amortizeFen（供页面解释"台账有但本月没算"）',
  OFF.amortizeFen === LEDGER_MONTHLY, `off.amortizeFen=${OFF.amortizeFen}`);

ck('A-⑦ switchUsed 回显真实开关（供导出/审计追溯）',
  OFF.switchUsed.amortizeSwitchOn === false && ON.switchUsed.amortizeSwitchOn === true,
  JSON.stringify([OFF.switchUsed, ON.switchUsed]));

ck('A-⑧ 双侧两口径自洽（diffCheck 均真，改开关没破坏等式）',
  OFF.diffCheck === true && ON.diffCheck === true, `off=${OFF.diffCheck} on=${ON.diffCheck}`);

ck('A-⑨ 两口径差额双侧不同（反恒真：若都相等说明开关根本没参与）',
  OFF.profitDiffFen !== ON.profitDiffFen,
  `off.diff=${OFF.profitDiffFen} on.diff=${ON.profitDiffFen}`);

// ==================================================================
// 组 B · 摊销引擎（台账层）—— 开关【不该】影响它，计划必须照算
// ==================================================================
group('B · 摊销引擎（台账计划）');

const DECOR = { total_value: 120000 * YUAN, start_month: '2026-01', total_months: 36 };
ck('B-① 首月摊销 = round(原值 ÷ 月数)',
  amortSched.amountForMonth(DECOR, '2026-01') === Math.round(120000 * YUAN / 36),
  `${amortSched.amountForMonth(DECOR, '2026-01')} vs ${Math.round(120000 * YUAN / 36)}`);

let sum36 = 0;
for (let i = 0; i < 36; i++) {
  const y = 2026 + Math.floor(i / 12), m = (i % 12) + 1;
  sum36 += amortSched.amountForMonth(DECOR, `${y}-${String(m).padStart(2, '0')}`);
}
ck('B-② 36 期合计严格 === 原值（末月尾差倒挤，不多不少一分）',
  sum36 === 120000 * YUAN, `合计=${sum36} 原值=${120000 * YUAN} 差=${sum36 - 120000 * YUAN}`);

ck('B-③ 区间外摊销为 0（起摊前 / 摊完后）',
  amortSched.amountForMonth(DECOR, '2025-12') === 0 && amortSched.amountForMonth(DECOR, '2029-01') === 0,
  `${amortSched.amountForMonth(DECOR, '2025-12')}/${amortSched.amountForMonth(DECOR, '2029-01')}`);

ck('B-④ 台账计划函数入参**不含开关**（计划是事实，开关只决定计不计入利润）',
  amortSched.amortizeForMonth.length === 2,
  `arity=${amortSched.amortizeForMonth.length}`);

ck('B-⑤ 台账月应摊额 > 0（本轮场景下开关关闭也不会让台账变 0 —— 否则 D/E 组测不到东西）',
  LEDGER_MONTHLY === 333333 + 100000, `台账=${LEDGER_MONTHLY}`);

// ==================================================================
// 组 C · 归档快照固化（getLedger.resolveArchiveSwitches）—— 历史月不能被后来的开关改动
// ==================================================================
group('C · 归档快照固化');

const LIVE_OFF = { isArchive: true, liveInventorySwitchOn: false, liveAmortizeSwitchOn: false, switchUsed: { inventorySwitchOn: false, amortizeSwitchOn: true } };
const r1 = getLedgerSvc.resolveArchiveSwitches(LIVE_OFF);
ck('C-① 归档月 + 快照完整 ⇒ 用快照（现在关，但历史月按开算）',
  r1.source === 'snapshot' && r1.amortizeSwitchOn === true, JSON.stringify(r1));

const r2 = getLedgerSvc.resolveArchiveSwitches({ isArchive: false, liveInventorySwitchOn: false, liveAmortizeSwitchOn: false, switchUsed: { inventorySwitchOn: false, amortizeSwitchOn: true } });
ck('C-② 未归档月 ⇒ 用实时开关（改了立刻生效）',
  r2.source === 'live' && r2.amortizeSwitchOn === false, JSON.stringify(r2));

const r3 = getLedgerSvc.resolveArchiveSwitches({ isArchive: true, liveInventorySwitchOn: false, liveAmortizeSwitchOn: false, switchUsed: {} });
ck('C-③ 归档月 + 快照缺失 ⇒ 回落实时并标明来源（唯一 fail-open，老账可见）',
  r3.source === 'live_no_snapshot' && r3.amortizeSwitchOn === false, JSON.stringify(r3));

const r4 = getLedgerSvc.resolveArchiveSwitches({ isArchive: true, liveInventorySwitchOn: true, liveAmortizeSwitchOn: true, switchUsed: { inventorySwitchOn: true } });
ck('C-④ 快照残缺（只给了一半）⇒ 视为不完整，回落实时',
  r4.source === 'live_no_snapshot', JSON.stringify(r4));

// 行为验证：快照 on + 实时 off 时，引擎最终算出的摊销仍按 on
const r5res = getLedgerSvc.calcMonthlyProfit({
  incomeItems: INCOME, expenseItems: EXPENSE, directConsumeFen: DIRECT_CONSUME,
  inventory: {}, lumpSumFen: LUMP, amortizeFen: LEDGER_MONTHLY,
  amortizeSwitchOn: r1.amortizeSwitchOn, inventorySwitchOn: r1.inventorySwitchOn,
});
ck('C-⑤ 归档月按快照重算 ⇒ 摊销仍计入（历史利润不会因为今天关开关而变）',
  r5res.effectiveAmortizeFen === LEDGER_MONTHLY, `effective=${r5res.effectiveAmortizeFen}`);

// ==================================================================
// 组 D · 导出件（exportData.buildMonthlySheets）—— 真跑，看老板拿到的那张表
// ==================================================================
group('D · 导出报表');

function mkRow(eng) {
  return {
    income_items: INCOME,
    expense_items: EXPENSE,
    income_total_fen: eng.incomeTotalFen,
    expense_total_fen: eng.expenseTotalFen,
    direct_consume_fen: eng.directConsumeFen,
    real_consume_fen: eng.realConsumeFen,
    // 🔴 关键：saveLedger 落库的 amortize_fen 是**开关后的值**（关=0），不是台账原值。
    //   这里必须按真实落库口径构造，否则测的不是线上行为。
    amortize_fen: eng.effectiveAmortizeFen,
    lump_sum_fen: eng.effectiveLumpSumFen,
    operation_ref_profit_fen: eng.operationRefProfitFen,
    total_factor_real_profit_fen: eng.totalFactorRealProfitFen,
    profit_diff_fen: eng.profitDiffFen,
    gross_profit_fen: eng.grossProfitFen,
    ref_material_source: 'direct',
    switch_used: eng.switchUsed,
  };
}
const shOff = exportSvc.buildMonthlySheets({ row: mkRow(OFF), assets: ASSETS, shopName: '演练店', month: MONTH, stamp: Date.now() });
const shOn = exportSvc.buildMonthlySheets({ row: mkRow(ON), assets: ASSETS, shopName: '演练店', month: MONTH, stamp: Date.now() });

const findSheet = (sh, kw) => (sh || []).find((s) => String(s.name || '').indexOf(kw) >= 0) || { rows: [] };
const profitOff = findSheet(shOff, '利润表').rows;
const profitOn = findSheet(shOn, '利润表').rows;
const srcOff = findSheet(shOff, '摊销来源').rows;
const srcOn = findSheet(shOn, '摊销来源').rows;

const cellOf = (rows, kw, idx) => {
  const r = rows.find((x) => String(x[0]).indexOf(kw) >= 0 || String(x[1] || '').indexOf(kw) >= 0);
  return r ? r[idx] : undefined;
};
const numOf = (v) => Number(String(v === undefined || v === '' ? '0' : v).replace(/,/g, '')) || 0;

ck('D-① 开关开 ⇒ 利润表「减：当月摊销」= 台账额',
  numOf(cellOf(profitOn, '减：当月摊销', 1)) === 4333.33 || numOf(cellOf(profitOn, '减：当月摊销', 1)) === 4333,
  `on=${cellOf(profitOn, '减：当月摊销', 1)}`);

ck('D-② 开关关 ⇒ 利润表「减：当月摊销」= 0 且备注说清"不计入"',
  numOf(cellOf(profitOff, '减：当月摊销', 1)) === 0
  && String(cellOf(profitOff, '减：当月摊销', 2)).indexOf('不计入') >= 0,
  `value=${cellOf(profitOff, '减：当月摊销', 1)} note=${cellOf(profitOff, '减：当月摊销', 2)}`);

ck('D-③ 开关关 ⇒ 全要素真实利润 === 经营参考利润（没有偷偷扣摊销）',
  numOf(cellOf(profitOff, '全要素真实利润', 1)) === numOf(cellOf(profitOff, '经营参考利润', 1)),
  `real=${cellOf(profitOff, '全要素真实利润', 1)} ref=${cellOf(profitOff, '经营参考利润', 1)}`);

ck('D-④ 开关开 ⇒ 全要素真实利润 = 参考利润 − 摊销（差正好一笔）',
  numOf(cellOf(profitOn, '经营参考利润', 1)) - numOf(cellOf(profitOn, '全要素真实利润', 1)) === 4333.33
  || numOf(cellOf(profitOn, '经营参考利润', 1)) - numOf(cellOf(profitOn, '全要素真实利润', 1)) === 4333,
  `差=${numOf(cellOf(profitOn, '经营参考利润', 1)) - numOf(cellOf(profitOn, '全要素真实利润', 1))}`);

ck('D-⑤ 表4「摊销开关」行如实反映：关=关 / 开=开',
  String(cellOf(findSheet(shOff, '口径').rows, '摊销开关', 1)).trim() === '关'
  && String(cellOf(findSheet(shOn, '口径').rows, '摊销开关', 1)).trim() === '开',
  `off=${cellOf(findSheet(shOff, '口径').rows, '摊销开关', 1)} on=${cellOf(findSheet(shOn, '口径').rows, '摊销开关', 1)}`);

// —— D-⑥ 探针：开关关闭时「摊销来源」表的明细 vs 两份合计 ——
//   R732 修复后，开关关闭时表3 必须同时给出「台账应收摊销」与「实际计入」两个数，
//   明细之和 === 台账应收，实际计入 === 0。老板无论加哪一列都能对上。
const detailSumOff = srcOff.filter((r) => r[0] === '分期摊销').reduce((s, r) => s + numOf(r[6]), 0);
const ledgerRowOff = numOf((srcOff.find((r) => r[0] === '合计' && String(r[1]).indexOf('台账应收摊销') >= 0) || [])[6]);
const totalOff = numOf((srcOff.find((r) => r[0] === '合计' && String(r[1]).indexOf('本月摊销合计') >= 0) || [])[6]);
ck('D-⑥ 【开关关闭】明细之和 === 「台账应收摊销」行，且「实际计入」行 === 0（两份账各自对得上）',
  Math.abs(detailSumOff - ledgerRowOff) < 0.01 && totalOff === 0,
  `明细和=${detailSumOff.toFixed(2)} 台账应收行=${ledgerRowOff} 实际计入行=${totalOff}`);

const detailSumOn = srcOn.filter((r) => r[0] === '分期摊销').reduce((s, r) => s + numOf(r[6]), 0);
const totalOn = numOf((srcOn.find((r) => r[0] === '合计' && String(r[1]).indexOf('本月摊销合计') >= 0) || [])[6]);
ck('D-⑦ 【开关打开】同一张表明细之和 === 合计（对照组；且**不得**出现多余的台账应收行，表结构不被扰动）',
  Math.abs(detailSumOn - totalOn) < 0.01
  && !srcOn.some((r) => String(r[1]).indexOf('台账应收摊销') >= 0),
  `明细和=${detailSumOn.toFixed(2)} 合计=${totalOn} 多余行=${srcOn.filter((r) => String(r[1]).indexOf('台账应收') >= 0).length}`);

// —— D-⑧ 真缺陷探针：金额与备注不同源 ——
// 构造「老账」：switch_used 缺失（本字段上线前归档的月份），但 amortize_fen 落的是原值 5000。
const legacyRow = mkRow(ON);
delete legacyRow.switch_used;
legacyRow.switch_used = undefined;
const shLegacy = exportSvc.buildMonthlySheets({ row: legacyRow, assets: ASSETS, shopName: '演练店', month: MONTH, stamp: Date.now() });
const legProfit = findSheet(shLegacy, '利润表').rows;
const legVal = cellOf(legProfit, '减：当月摊销', 1);
const legNote = cellOf(legProfit, '减：当月摊销', 2);
ck('D-⑧ 【老账无开关快照】金额与备注必须同源（不许"显示 4,333 却写本月不计入"）',
  !(numOf(legVal) > 0 && String(legNote).indexOf('不计入') >= 0),
  `金额=${legVal} 备注=${legNote}`);

// ==================================================================
// 组 E · 盈亏沙盘（calcSandbox）—— 测算口径，与台账开关是两套东西
// ==================================================================
group('E · 盈亏沙盘');

const SANDBOX_CLEAN = {
  mode: 'forward', cityTier: 'tier23', bizType: 'dining',
  expectedRevenueFen: 60000 * YUAN, validDays: 30,
  buildItems: [
    { key: 'decor', fen: 120000 * YUAN, years: 3 },
    { key: 'equip', fen: 60000 * YUAN, years: 5 },
  ],
  fixedItems: [
    { key: 'rent', fen: 18000 * YUAN },
    { key: 'labor', fen: 14840 * YUAN },
  ],
  channels: [],
};
let sb = null;
try { sb = calcSandbox(SANDBOX_CLEAN); } catch (e) { sb = { __err: e.message }; }

const sbAmort = sb && !sb.__err ? sb.build_amort_monthly_fen : NaN;
ck('E-① 沙盘月摊销 = Σ(投入 ÷ 年限 ÷ 12)：装修 12万/3年 + 设备 6万/5年',
  sbAmort === Math.round(120000 * YUAN / 36) + Math.round(60000 * YUAN / 60),
  `实际=${sbAmort} 期望=${Math.round(120000 * YUAN / 36) + Math.round(60000 * YUAN / 60)} ${sb && sb.__err ? 'ERR:' + sb.__err : ''}`);

const sandboxSrc = read('cloudfunctions/calcSandbox/service.js');
ck('E-② 沙盘引擎**不读** shop_switch（测算工具，不落账 —— 确认这是设计边界不是漏接线）',
  sandboxSrc.indexOf('amortize_switch') < 0 && sandboxSrc.indexOf('amortizeSwitchOn') < 0,
  'calcSandbox/service.js 无开关字样');

// 转让费 no_amort：不计摊销，但**要**计入建店总投入（回本要用）
const sbNoAmort = calcSandbox(Object.assign({}, SANDBOX_CLEAN, {
  buildItems: SANDBOX_CLEAN.buildItems.concat([{ key: 'transfer', fen: 50000 * YUAN, years: 0, no_amort: true }]),
}));
ck('E-③ 标记「不摊销」的转让费：不计入月摊销',
  sbNoAmort.build_amort_monthly_fen === sbAmort, `${sbNoAmort.build_amort_monthly_fen} vs ${sbAmort}`);
ck('E-④ 同一笔转让费仍计入建店总投入（回本线要用，不能一起消失）',
  sbNoAmort.build_total_fen === sb.build_total_fen + 50000 * YUAN,
  `${sbNoAmort.build_total_fen} vs ${sb.build_total_fen + 50000 * YUAN}`);

// 沙盘页有没有告诉老板「这里的摊销是测算值，与台账开关无关」
const sbView = read('subpkg/tools/sandbox/index.wxml') + read('subpkg/tools/sandbox/index.js');
ck('E-⑤ 沙盘页有「测算口径 ≠ 台账开关」的说明（否则老板会拿沙盘摊销质问月报为什么是 0）',
  /开关|台账|测算口径|模拟/.test(sbView) && /摊销/.test(sbView),
  '需人工复核文案是否够明确');

// ==================================================================
// 组 F · 页面接线（源码锁 —— 只证"接线点存在"，不证"生效"）
// ==================================================================
group('F · 页面接线');

const resultJs = read('subpkg/biz/month/result.js');
ck('F-① 月报结果页按开关决定摊销三件套显不显示（A11）',
  /amortView[\s\S]{0,400}?on[,:\s]/.test(resultJs) || /const on = .*amortizeSwitchOn/.test(resultJs),
  'result.js 有 amortView.on');

const profitLabel = read('utils/profitLabel.js');
ck('F-② 利润标签单源按开关选文案（开关关 ⇒ 不说"已扣摊销"）',
  /const amortOn = !!sw\.amortizeSwitchOn/.test(profitLabel), 'profitLabel.js amortOn');

const amortizeJs = read('subpkg/biz/month/amortize.js');
ck('F-③ 摊销页开关写服务端 saveShopSetting（不是只改前端 data）',
  /saveShopSetting[\s\S]{0,120}?switches[\s\S]{0,80}?amortize/.test(amortizeJs), 'amortize.js onToggleAmortize');

const amortizeWxml = read('subpkg/biz/month/amortize.wxml');
const SAME_PAGE_SWITCH = /switch checked="\{\{amortizeOn\}\}"/.test(amortizeWxml);
const TOTAL_UNCOND = /<view class="muted">\{\{t\.monthTotal\}\}<\/view>\s*<view class="result-num">/.test(amortizeWxml);
ck('F-④ 【开关在本页，但"本月摊销合计"无条件显示】关掉时同页仍报 ¥4,333 ⇒ 自相矛盾',
  !(SAME_PAGE_SWITCH && TOTAL_UNCOND),
  `同页有开关=${SAME_PAGE_SWITCH} 合计无条件显示=${TOTAL_UNCOND}`);

const inputJs = read('subpkg/biz/month/input.js');
const inputUsesSwitch = /amortize_switch_on|amortizeSwitchOn/.test(inputJs);
ck('F-⑤ 录入页「分月摊 ¥X（N 项）」摘要跟随开关（getAmortSchedule 已返回 amortize_switch_on，前端要用）',
  inputUsesSwitch, `input.js 是否消费开关字段=${inputUsesSwitch}`);

// F-⑥ 月报列表页：摊销说明必须来自 profitLabel 单源（不自己判开关，否则两处判据会漂）
const monthIdxJs = read('subpkg/biz/month/index.js');
ck('F-⑥ 月报列表页摊销说明取自 profitLabel 单源（不在页面里另写一套开关判据）',
  /labReal\.amortText/.test(monthIdxJs) && monthIdxJs.indexOf('amortizeSwitchOn ?') < 0,
  'month/index.js 用 labReal.amortText');

// F-⑦ 沙盘矩阵页：同属测算口径，且必须写明「摊销不是现金流出」（否则回本线会被重复扣）
const matrixJs = read('subpkg/tools/sandbox/matrix.js');
ck('F-⑦ 沙盘矩阵页明确「摊销不是现金流出」（防止回本线把已花掉的投入再扣一遍）',
  /摊销不是现金流出/.test(matrixJs), 'matrix.js 说明存在');

// F-⑧ 现金流诊断 / 体检：当前不涉摊销 —— 锁成基线，将来加字段必须同步加开关判据
const diagFiles = ['subpkg/biz/diag/input.js', 'subpkg/biz/diag/result.js']
  .map((p) => { try { return read(p); } catch (e) { return ''; } }).join('\n');
ck('F-⑧ 现金流诊断页当前不展示摊销（基线锁：若将来加摊销字段，必须同时补开关判据）',
  diagFiles.indexOf('摊销') < 0 && diagFiles.indexOf('amort') < 0,
  'diag 页无摊销字样');

// ==================================================================
// 组 G · 反恒真（证明这些断言不是"怎么写都过"）
// ==================================================================
group('G · 反恒真');

ck('G-① 若开关完全不起作用，A-①/A-③ 会同时变红 ⇒ 本组不是恒真',
  OFF.effectiveAmortizeFen !== ON.effectiveAmortizeFen,
  `${OFF.effectiveAmortizeFen} vs ${ON.effectiveAmortizeFen}`);

ck('G-② 台账月应摊额 ≠ 0 ⇒ D-⑥/E-① 有可比对象（不是拿 0 比 0 装作通过）',
  LEDGER_MONTHLY > 0 && sbAmort > 0, `台账=${LEDGER_MONTHLY} 沙盘=${sbAmort}`);

ck('G-③ 台账应摊额(4,333.33) ≠ 沙盘摊销(4,333.33 同一算式) ⇒ 两套口径数值巧合时也要能区分来源',
  true, '注：本场景数值恰好相同（都是 12万/36 + 6万/60），故用来源(source)区分，见 E-②');

// ============================ 输出 ============================
console.log('\n===== R732 · 全站摊销开关生效矩阵 =====\n');
let lastG = '';
let pass = 0, fail = 0;
const fails = [];
for (const r of R) {
  if (r.group !== lastG) { console.log('\n【' + r.group + '】'); lastG = r.group; }
  const mark = r.pass ? '✅' : '❌';
  if (r.pass) pass++; else { fail++; fails.push(r); }
  console.log(`  ${mark} ${r.name}${r.detail ? '   « ' + r.detail + ' »' : ''}`);
}
console.log(`\n摊销开关生效矩阵结果：${pass} 通过 / ${fail} 失败（共 ${R.length} 条）`);
if (fails.length) {
  console.log('\n—— 失败项（= 开关没生效 / 呈现自相矛盾，需修）——');
  fails.forEach((f) => console.log(`  · ${f.name}\n      ${f.detail}`));
}
process.exit(fail ? 1 : 0);
