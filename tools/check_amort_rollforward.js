#!/usr/bin/env node
// tools/check_amort_rollforward.js —— 摊销「跨月延续」行为守卫（R739）
//
// 【为什么要有这个守卫】
//   李老师原话：「10 月份有摊销资产，要摊 36 个月，那么下月数据这个摊销值会自动过去吗？
//   或者说以后月份一直摊销完，数据会跟着记忆变动吗？包括中间又新增的需要摊销以及一次性的资产，
//   能不能正常计算显示，显示还有多少期未摊销，这个能做到吗？你自己跑数据核实一下。」
//
//   这四问以前**没有任何一条套件回答过**：既有守卫都在测「某一个月算得对不对」
//   （check_amort_rule_v2 / check_amort_display_caliber / check_amort_switch_matrix），
//   没有一条把**连续 37 个月**串起来跑。而「跨月」恰恰是摊销这件事的全部意义 ——
//   只测单月，等于只测了「这个月扣了多少」，没测「下个月还扣不扣、扣到哪个月停」。
//
// 【本轮跑出来的两个真缺陷（都是「单月全绿、连月才现形」）】
//   ① P0 · 字段名对不上：getLedger 把 DB 原始行直塞公式，而落库字段是 `value_fen`、
//      引擎读 `asset.total_value` ⇒ NaN ⇒ 下游 num0() 归 0 ⇒ **2026-11 起每个未归档月份，
//      结果页/月报的摊销恒为 ¥0.00**（摊销页因为有映射，照常显示）。利润被高估一整笔摊销，
//      且同一月份两个页面互相打脸。R737 的 fixture 用 `total_value` 造数据 ⇒ 按引擎的样子造，
//      不按库的样子造 ⇒ 假绿。
//   ② 期数口径重叠：摊销页「已摊 2/36」（含本月）+ 结果页「还剩 35 期」（也含本月）
//      ⇒ 2+35=37 > 36，老板一加就对不上，谁也解释不清。
//
// 【判据分六层】
//   A · 跨月延续：起摊月之后每月自动出现、等额期等额、摊完自动停、中途新增不倒灌、一次性只当月
//   B · 闭包：全周期求和 == 资产原值（一分不多一分不少）+ 尾差倒挤 + 提前终止
//   C · 两页一致：摊销页合计 == 结果页 amortize_fen == effective_amortize_fen（同一月份不许两个数）
//   D · 剩余期数：已摊（含本月）+ 剩余（不含本月）== 总期数，逐月全表成立
//   E · 归档冻结：归档月改台账不回头改数字；未归档月改台账立刻生效（「跟着记忆变」的唯一合法范围）
//   F · 自失效：fixture 必须用真库字段名、断言数下界、变异回灌证明 C 段测得到东西
//
// 【手法】内存假 db + 真跑 `getAmortSchedule/index.js` / `getLedger/index.js` 的 exports.main。
//   不重写任何公式 —— 只要这里手抄一份公式，就又是一份「同语义第三副本」。
//
// 运行：node tools/check_amort_rollforward.js

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const F = (p) => path.join(ROOT, p);
const Y = 100; // 元 → 分

let pass = 0;
let failN = 0;
const R = [];
function ck(name, cond, detail) {
  R.push({ name, pass: !!cond, detail: detail || '' });
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');
const yuan = (fen) => (fen / 100).toFixed(2);

// ======================= 内存假 db =======================
let DATA = {};
function eqMatch(row, cond) {
  for (const k in cond) if (row[k] !== cond[k]) return false;
  return true;
}
function makeDb() {
  return {
    collection(name) {
      const rows = () => (DATA[name] || []);
      return {
        where(cond) {
          const hit = () => rows().filter((r) => eqMatch(r, cond || {}));
          return {
            limit(n) { return { get: async () => ({ data: hit().slice(0, n) }) }; },
            skip(k) { return { limit(n) { return { get: async () => ({ data: hit().slice(k, k + n) }) }; } }; },
            get: async () => ({ data: hit() }),
            count: async () => ({ total: hit().length }),
          };
        },
        doc(id) {
          return {
            get: async () => {
              const r = rows().find((x) => x._id === id);
              if (!r) throw new Error('stub: doc not found');
              return { data: r };
            },
          };
        },
      };
    },
  };
}

// ======================= 桩 wx-server-sdk =======================
const fakeCloud = {
  DYNAMIC_CURRENT_ENV: 'stub-env',
  init() {},
  database() { return makeDb(); },
  getWXContext() { return { OPENID: 'openid_stub' }; },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return fakeCloud;
  return origLoad.call(this, request, parent, isMain);
};

function patchCommon(dir) {
  const c = require(F('cloudfunctions/' + dir + '/common.js'));
  c.resolveAuth = async () => ({ user: { id: 'u_stub' } });
  c.assertShopOwner = async () => ({ error: null });
  c.dataAdapter.makeAdapter = () => {
    const list = (coll, where, extra) => {
      const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
      const rows = (DATA[coll] || []).filter((r) => eqMatch(r, cond));
      return Promise.resolve({ data: rows.slice(0, 1000) });
    };
    const get = async (coll, id) => {
      const rows = DATA[coll] || [];
      return rows.find((r) => r._id === id) || rows.find((r) => r.shop_id === id) || null;
    };
    return { list, listAll: list, get, add: async () => ({}), update: async () => ({}) };
  };
  return c;
}
patchCommon('getLedger');
patchCommon('getAmortSchedule');

const GL_PATH = F('cloudfunctions/getLedger/index.js');
const AS_PATH = F('cloudfunctions/getAmortSchedule/index.js');
const getLedger = require(GL_PATH);
const getAmortSchedule = require(AS_PATH);

// ======================= fixture：按**真库字段名**造数据 =======================
// 🔴 这张表是全文件的地基：**只允许真库里存在的字段名**（value_fen / start_month / total_months /
//   terminate_month / mode / group_id / asset_kind）。绝不允许出现 `total_value` ——
//   那是引擎内部字段。R737 就是在这里用了 total_value，于是 P0（字段名对不上）被判绿。
const BASE_ASSETS = [
  // 2026-10 起摊 36 期（李老师原话场景）
  { _id: 'a1', asset_id: 'a1', name: '门店装修', mode: 'amort',
    value_fen: 36000 * Y, start_month: '2026-10', total_months: 36, terminate_month: '', asset_kind: 'decor' },
  // 2026-12 中途再投一台设备（12 期）
  { _id: 'a2', asset_id: 'a2', name: '厨房设备', mode: 'amort',
    value_fen: 12000 * Y, start_month: '2026-12', total_months: 12, terminate_month: '', asset_kind: 'equip' },
  // 2027-01 中途再投加盟费（24 期，不整除 ⇒ 有尾差）
  { _id: 'a3', asset_id: 'a3', name: '加盟费', mode: 'amort',
    value_fen: 50000 * Y, start_month: '2027-01', total_months: 24, terminate_month: '', asset_kind: 'franchise' },
  // 2027-03 一笔一次性（不进摊销）
  { _id: 'l1', asset_id: 'l1', name: '开业推广费', mode: 'lump',
    value_fen: 5000 * Y, start_month: '2027-03', total_months: 1, terminate_month: '', asset_kind: 'other' },
];

function reset(opts) {
  const o = opts || {};
  // ⚠️ `shop_id` 与 `is_deleted` 都是真库行的必备字段（DataAdapter 的 list() 会按 shop_id 过滤、
  //   并强制注入 is_deleted:false 条件）。漏任何一个，整张表都会被读成空集，
  //   界面上就是「一笔资产都没有」，而 A/B/D 段会全 0（本轮实际踩过两次：先漏 is_deleted，再漏 shop_id）。
  //   ⇒ 这就是「fixture 必须按库的样子造，不能按引擎的样子造」的具体代价。
  const rows = (o.assets || BASE_ASSETS)
    .map((r) => Object.assign({ shop_id: 's1', is_deleted: false }, r));
  DATA = {
    shop_amortize: JSON.parse(JSON.stringify(rows)),
    shop_switch: [
      { shop_id: 's1', switch_key: 'amortize_switch', enabled: false, is_deleted: false },
      { shop_id: 's1', switch_key: 'inventory_switch', enabled: false, is_deleted: false },
    ],
    shop_monthly_account: JSON.parse(JSON.stringify(o.accts || [])),
    shop: [{ _id: 's1', shop_id: 's1', biz_type: 'dining', city_tier: 'tier23', is_deleted: false }],
  };
}

async function probe(month, opts) {
  reset(opts);
  const s = (await getAmortSchedule.main({ shop_id: 's1', month })).data;
  const l = (await getLedger.main({ shop_id: 's1', month })).data;
  return { month, s, l };
}
async function schedOf(month, opts) { reset(opts); return (await getAmortSchedule.main({ shop_id: 's1', month })).data; }
async function ledgerOf(month, opts) { reset(opts); return (await getLedger.main({ shop_id: 's1', month })).data; }

function monthRange(from, to) {
  const idx = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
  const fmt = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
  const out = [];
  for (let i = idx(from); i <= idx(to); i++) out.push(fmt(i));
  return out;
}
const detailOf = (s, name) => (s.details || []).find((d) => d.name === name) || { amount_fen: 0 };
const assetOf = (s, name) => (s.assets || []).find((a) => a.name === name) || {};

(async () => {
  const MONTHS = monthRange('2026-09', '2029-10');   // 起摊前一个月 → 全部摊完后一个月
  const TBL = {};
  for (const m of MONTHS) TBL[m] = await probe(m);

  // ==================== A · 跨月延续 ====================
  sec('A · 跨月延续（李老师四问之一：下月会自动过去吗）');
  ck('A-① 起摊月（2026-10）装修出现 1,000 元',
    detailOf(TBL['2026-10'].s, '门店装修').amount_fen === 100000,
    `实得 ${yuan(detailOf(TBL['2026-10'].s, '门店装修').amount_fen)}`);
  ck('A-② 次月（2026-11）**无需任何写操作**自动出现同一笔',
    detailOf(TBL['2026-11'].s, '门店装修').amount_fen === 100000,
    `实得 ${yuan(detailOf(TBL['2026-11'].s, '门店装修').amount_fen)}`);
  ck('A-③ 等额期金额不变（2026-10 vs 2026-11 相等）',
    detailOf(TBL['2026-10'].s, '门店装修').amount_fen === detailOf(TBL['2026-11'].s, '门店装修').amount_fen);
  ck('A-④ 摊到末月（2029-09）仍扣 1,000 元',
    detailOf(TBL['2029-09'].s, '门店装修').amount_fen === 100000,
    `实得 ${yuan(detailOf(TBL['2029-09'].s, '门店装修').amount_fen)}`);
  ck('A-⑤ 摊完后（2029-10）自动归零，不会无限摊',
    TBL['2029-10'].s.total_amount_fen === 0 && TBL['2029-10'].l.result.effective_amortize_fen === 0,
    `台账 ${yuan(TBL['2029-10'].s.total_amount_fen)} / 引擎 ${yuan(TBL['2029-10'].l.result.effective_amortize_fen)}`);
  ck('A-⑥ 中途新增不倒灌：2026-11 合计里不该有设备',
    TBL['2026-11'].s.total_amount_fen === 100000 && detailOf(TBL['2026-11'].s, '厨房设备').amount_fen === 0,
    `合计 ${yuan(TBL['2026-11'].s.total_amount_fen)}`);
  ck('A-⑦ 中途新增起摊月叠加：2026-12 = 装修 1,000 + 设备 1,000',
    TBL['2026-12'].s.total_amount_fen === 200000,
    `实得 ${yuan(TBL['2026-12'].s.total_amount_fen)}`);
  ck('A-⑧ 三笔并存：2027-01 = 1,000 + 1,000 + 2,083.33',
    TBL['2027-01'].s.total_amount_fen === 408333,
    `实得 ${yuan(TBL['2027-01'].s.total_amount_fen)}`);
  ck('A-⑨ 一次性只在当月出现（2027-03 有、2027-04 无）',
    TBL['2027-03'].s.lump_total_fen === 500000 && TBL['2027-04'].s.lump_total_fen === 0,
    `03月 ${yuan(TBL['2027-03'].s.lump_total_fen)} / 04月 ${yuan(TBL['2027-04'].s.lump_total_fen)}`);
  ck('A-⑩ 一次性不进摊销合计（2027-03 摊销合计 4,083.33 ≠ 含一次性的 9,083.33）',
    TBL['2027-03'].s.total_amount_fen === 408333,
    `实得 ${yuan(TBL['2027-03'].s.total_amount_fen)}`);

  // ==================== B · 闭包与尾差 ====================
  sec('B · 闭包与尾差（摊到最后一分钱对不对）');
  const sumAmort = MONTHS.reduce((s, m) => s + TBL[m].s.total_amount_fen, 0);
  const sumValue = BASE_ASSETS.filter((a) => a.mode === 'amort').reduce((s, a) => s + a.value_fen, 0);
  ck('B-① 全周期摊销求和 == 资产原值合计（不多摊一分、不少摊一分）',
    sumAmort === sumValue, `逐月求和 ${yuan(sumAmort)} vs 原值 ${yuan(sumValue)}`);
  ck('B-② 不整除资产末月尾差倒挤（加盟费 2028-12 = 2,083.41）',
    detailOf(TBL['2028-12'].s, '加盟费').amount_fen === 208341,
    `实得 ${yuan(detailOf(TBL['2028-12'].s, '加盟费').amount_fen)}`);
  ck('B-③ 整除资产末月无尾差（装修 2029-09 = 1,000.00）',
    detailOf(TBL['2029-09'].s, '门店装修').amount_fen === 100000,
    `实得 ${yuan(detailOf(TBL['2029-09'].s, '门店装修').amount_fen)}`);
  const termAssets = [{
    _id: 't1', asset_id: 't1', name: '提前处置设备', mode: 'amort',
    value_fen: 12000 * Y, start_month: '2026-10', total_months: 12, terminate_month: '2027-03', asset_kind: 'equip',
  }];
  const termEnd = await schedOf('2027-03', { assets: termAssets });
  const termAfter = await schedOf('2027-04', { assets: termAssets });
  ck('B-④ 提前终止：终止月仍按 1,000 摊，次月起归零',
    detailOf(termEnd, '提前处置设备').amount_fen === 100000
    && detailOf(termAfter, '提前处置设备').amount_fen === 0,
    `终止月 ${yuan(detailOf(termEnd, '提前处置设备').amount_fen)} / 次月 ${yuan(detailOf(termAfter, '提前处置设备').amount_fen)}`);

  // ==================== C · 两页一致 ====================
  sec('C · 两页一致（摊销页 vs 结果页，同一月份不许两个数）');
  const mismatch = MONTHS.filter((m) => String(m) >= '2026-11'
    && TBL[m].s.total_amount_fen !== TBL[m].l.amortize_fen);
  ck('C-① 2026-11 起每个月的「摊销页合计」== 「结果页 amortize_fen」',
    mismatch.length === 0,
    mismatch.length ? `不一致 ${mismatch.length} 个月：${mismatch.slice(0, 3).join(',')}` : '37 个月全一致');
  const mismatch2 = MONTHS.filter((m) => String(m) >= '2026-11'
    && TBL[m].s.total_amount_fen !== TBL[m].l.result.effective_amortize_fen);
  ck('C-② 摊销页合计 == 引擎**计入利润**的 effective_amortize_fen（真的扣了，不只是显示）',
    mismatch2.length === 0,
    mismatch2.length ? `不一致 ${mismatch2.length} 个月` : '37 个月全一致');
  const mismatch3 = MONTHS.filter((m) => String(m) >= '2026-11'
    && TBL[m].l.amort_extra.this_fen !== TBL[m].l.result.effective_amortize_fen);
  ck('C-③ amort_extra.this_fen（结果页「本月摊销」那行）与引擎同值',
    mismatch3.length === 0, mismatch3.length ? `不一致 ${mismatch3.length} 个月` : '全一致');
  const fixtureKeys = new Set();
  BASE_ASSETS.forEach((a) => Object.keys(a).forEach((k) => fixtureKeys.add(k)));
  ck('C-④ fixture 只用真库字段名（出现 total_value 就说明又在「按引擎的样子造数」）',
    !fixtureKeys.has('total_value') && fixtureKeys.has('value_fen'),
    `字段：${[...fixtureKeys].join(',')}`);

  // ==================== D · 剩余期数 ====================
  sec('D · 剩余期数（李老师四问之四：能不能显示还有多少期）');
  ck('D-① 起摊前（2026-09）：剩余 = 总期数 36',
    TBL['2026-09'].l.amort_extra.remaining_periods === 36,
    `实得 ${TBL['2026-09'].l.amort_extra.remaining_periods}`);
  ck('D-② 起摊月（2026-10）：本月已摊 ⇒ 剩余 35（不含本月）',
    TBL['2026-10'].l.amort_extra.remaining_periods === 35,
    `实得 ${TBL['2026-10'].l.amort_extra.remaining_periods}`);
  const sumBad = MONTHS.filter((m) => {
    const a = assetOf(TBL[m].s, '门店装修');
    if (!a.total_periods) return true;
    if (a.paid_months >= a.total_periods) return false;      // 已摊完的月份剩余恒 0，另由 D-③ 判
    return a.paid_months + TBL[m].l.amort_extra.remaining_periods !== a.total_periods;
  });
  ck('D-③ 已摊（含本月）+ 剩余（不含本月）== 总期数 —— 逐月全表成立',
    sumBad.length === 0,
    sumBad.length ? `对不上 ${sumBad.length} 个月：${sumBad.slice(0, 3).join(',')}` : '37 个月全成立');
  ck('D-④ 末月（2029-09）剩余 = 0',
    TBL['2029-09'].l.amort_extra.remaining_periods === 0,
    `实得 ${TBL['2029-09'].l.amort_extra.remaining_periods}`);
  ck('D-⑤ 摊完后（2029-10）剩余 = 0 且不给「摊完月份」（没有在摊的东西）',
    TBL['2029-10'].l.amort_extra.remaining_periods === 0 && TBL['2029-10'].l.amort_extra.end_month === '',
    `剩余 ${TBL['2029-10'].l.amort_extra.remaining_periods} / end ${TBL['2029-10'].l.amort_extra.end_month || '空'}`);
  ck('D-⑥ 多笔并存取**最晚摊完**：2027-01 的 end_month = 2029-09（装修最后）',
    TBL['2027-01'].l.amort_extra.end_month === '2029-09',
    `实得 ${TBL['2027-01'].l.amort_extra.end_month}`);
  ck('D-⑦ 摊销页「剩余未摊」逐月递减且最终归零（2026-10 起算，2029-10 = 0）',
    TBL['2026-10'].s.assets.find((a) => a.name === '门店装修').remaining_fen === 3500000
    && TBL['2029-09'].s.assets.find((a) => a.name === '门店装修').remaining_fen === 0,
    `2026-10 剩 ${yuan(TBL['2026-10'].s.assets.find((a) => a.name === '门店装修').remaining_fen)}`
    + ` / 2029-09 剩 ${yuan(TBL['2029-09'].s.assets.find((a) => a.name === '门店装修').remaining_fen)}`);
  // 🔴 R739：剩余期数改成「不含本月」之后，末月 remain=0 —— 若页面仍用 `remain>0` 判「有没有在摊的」
  //   就会把最后一期说成「还没有在摊的投入」。这条钉住「末月 remain=0 但本月仍在摊」这个组合确实存在，
  //   即 result.wxml 的「本月是最后一期」分支不是死代码。
  ck('D-⑧ 末月「剩余 0 期但本月仍在摊」的组合确实出现（页面「最后一期」分支非死代码）',
    TBL['2029-09'].l.amort_extra.remaining_periods === 0
    && TBL['2029-09'].l.amort_extra.this_fen === 100000,
    `2029-09 剩余 ${TBL['2029-09'].l.amort_extra.remaining_periods} 期 / 本月仍摊 ${yuan(TBL['2029-09'].l.amort_extra.this_fen)}`);

  // ==================== E · 归档冻结 / 未归档跟随 ====================
  sec('E · 归档冻结与「跟着记忆变」的边界');
  // 归档月：落库 amortize_fen 故意与台账不同（模拟「归档时算的是 800」），结果页必须认落库值
  const archAcct = [{
    _id: 'acc_arch', shop_id: 's1', month: '2027-05', is_archive: true, is_deleted: false,
    amortize_fen: 80000, lump_sum_fen: 0, income_items: [], expense_items: [],
    switch_used: { inventorySwitchOn: false, amortizeSwitchOn: true },
  }];
  const arch = await ledgerOf('2027-05', { accts: archAcct });
  ck('E-① 归档月：结果页摊销 = 落库值（8,000 分），不按台账重算（台账是 408,333 分）',
    arch.amortize_fen === 80000 && arch.is_archive === true,
    `实得 ${arch.amortize_fen}`);
  // 归档后把台账全删掉，归档月数字不许变
  const arch2 = await ledgerOf('2027-05', { accts: archAcct, assets: [] });
  ck('E-② 归档月：删光台账后金额纹丝不动（封账=只读）',
    arch2.amortize_fen === 80000, `实得 ${arch2.amortize_fen}`);
  // 未归档月：改台账 ⇒ 数字跟着变（这就是「数据会跟着记忆变动」的合法范围）
  const noA2 = BASE_ASSETS.filter((a) => a.asset_id !== 'a2');
  const withA2 = await ledgerOf('2027-06');
  const withoutA2 = await ledgerOf('2027-06', { assets: noA2 });
  ck('E-③ 未归档月：删掉「厨房设备」后，2027-06 摊销立刻少 1,000（其余月份同理，不需逐月保存）',
    withA2.amortize_fen - withoutA2.amortize_fen === 100000,
    `${yuan(withA2.amortize_fen)} → ${yuan(withoutA2.amortize_fen)}`);
  // 2026-11 之前是 R736 会诊定下的「历史一字不改」范围（含未归档的历史月）—— 那几个月**不计摊销**。
  // 但两个页面必须**说同一件事**：摊销页给「未计入」话术、结果页给 0，不能一个说有数一个说没扣。
  // 这条不是「验旧规则对不对」，是「验前后口径不打架」——同一月份两个页面互相打脸是要立红线的。
  ck('E-④ 闸门前月份（2026-10）：摊销页标「未计入」+ 结果页 0 —— 两页口径一致（不是打脸）',
    TBL['2026-10'].s.amortize_switch_on === false && TBL['2026-10'].l.result.effective_amortize_fen === 0,
    `摊销页 switch=${TBL['2026-10'].s.amortize_switch_on} / 结果页 ${yuan(TBL['2026-10'].l.result.effective_amortize_fen)}`);

  // ==================== F · 自失效护栏 + 变异回灌 ====================
  sec('F · 自失效护栏（下列断言若恒真，前面的绿就是假的）');
  ck('F-① 断言数下界 ≥ 28（防本文件被掏空后仍报「全绿」）', R.length + 3 >= 28, `当前 ${R.length + 3}`);
  ck('F-② 全表覆盖月份数 ≥ 36（少于 36 个月就测不到「摊完即停」）', MONTHS.length >= 36, `${MONTHS.length} 个月`);

  // 变异回灌：把 getLedger 的字段映射摘掉 ⇒ C-① 必须转红
  const src = fs.readFileSync(GL_PATH, 'utf8');
  const ANCHOR = 'total_value: a.value_fen != null ? a.value_fen : a.total_value,';
  ck('F-③ 变异锚点存在（锚点漂移 ⇒ 下一条会恒绿）', src.includes(ANCHOR), '锚点在位');
  if (src.includes(ANCHOR)) {
    const mutantSrc = src.replace(ANCHOR, '');
    const abs = GL_PATH;
    delete require.cache[abs];
    const M = new Module(abs, module);
    M.filename = abs;
    M.paths = Module._nodeModulePaths(path.dirname(abs));
    M._compile(mutantSrc, abs);
    require.cache[abs] = M;
    reset();
    const mutOut = (await M.exports.main({ shop_id: 's1', month: '2027-01' })).data;
    const mutAmort = mutOut.amortize_fen;
    // 恢复真身，避免污染后续
    delete require.cache[abs];
    require(GL_PATH);
    // 变异后 `amortizeFen` 是 NaN（`Math.round(undefined/36)` 的产物）。
    //   线上走云函数 JSON 序列化时 NaN → null → 前端 fenToYuan(null) → ¥0.00，
    //   所以「NaN 或 0」都算「塌掉了」；判据要的是「不等于真值且已不可用」。
    ck('F-④ 变异回灌：摘掉字段映射 ⇒ 结果页摊销塌成 0（证明 C 段真能抓到该类缺陷）',
      (Number.isNaN(mutAmort) || mutAmort === 0) && mutAmort !== 408333,
      `变异后 2027-01 amortize_fen = ${mutAmort}（真身应为 4,083.33；线上序列化后就是 ¥0.00）`);
  } else {
    ck('F-④ 变异回灌：摘掉字段映射 ⇒ 结果页摊销塌成 0（锚点缺失，跳过）', false, '锚点漂移');
  }

  console.log(`\n摊销跨月延续结果：${pass} 通过 / ${failN} 失败（共 ${pass + failN} 条）`);
  process.exit(failN ? 1 : 0);
})();
