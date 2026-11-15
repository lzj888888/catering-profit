#!/usr/bin/env node
// review/evidence/r739_rollforward_probe.js —— R739 探针：摊销跨月延续到底怎么走
//
// 李老师问的四件事，全部用**真链路**回答（桩 db，真跑 getAmortSchedule / getLedger 的 exports.main）：
//   ① 10 月录的 36 期资产，11 月会自动带过去吗？
//   ② 一直摊到摊完，会自动停吗？数据会跟着月份变吗？
//   ③ 中途再新增摊销资产 / 一次性资产，能正常叠加显示吗？
//   ④ 「还剩多少期未摊」有没有、对不对？
//
// 手法：内存假 db + 真 index.js（不重写任何公式，只喂数据）。
// 运行：node review/evidence/r739_rollforward_probe.js

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '../..');
const F = (p) => path.join(ROOT, p);
const Y = 100; // 元 → 分

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
          const api = {
            limit(n) { return { get: async () => ({ data: hit().slice(0, n) }) }; },
            skip(k) {
              return { limit(n) { return { get: async () => ({ data: hit().slice(k, k + n) }) }; } };
            },
            get: async () => ({ data: hit() }),
            count: async () => ({ total: hit().length }),
          };
          return api;
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

// ======================= 替换 common 的鉴权与适配器 =======================
function patchCommon(dir) {
  const c = require(F('cloudfunctions/' + dir + '/common.js'));
  c.resolveAuth = async () => ({ user: { id: 'u_stub' } });
  c.assertShopOwner = async () => ({ error: null });
  c.dataAdapter.makeAdapter = () => {
    const db = makeDb();
    function list(coll, where, extra) {
      const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
      const rows = (DATA[coll] || []).filter((r) => eqMatch(r, cond));
      return Promise.resolve({ data: rows.slice(0, 1000) });
    }
    async function get(coll, id) {
      const rows = DATA[coll] || [];
      return rows.find((r) => r._id === id) || rows.find((r) => r.shop_id === id) || null;
    }
    return { list, listAll: list, get, add: async () => ({}), update: async () => ({}) };
  };
  return c;
}
patchCommon('getLedger');
patchCommon('getAmortSchedule');

const getLedger = require(F('cloudfunctions/getLedger/index.js'));
const getAmortSchedule = require(F('cloudfunctions/getAmortSchedule/index.js'));

// ======================= fixture：李老师描述的场景 =======================
// 2026-10 起摊 36 期（装修）—— 用户说的「10 月份有摊销资产，要摊 36 个月」
const ASSETS = [
  { _id: 'a1', asset_id: 'a1', shop_id: 's1', name: '门店装修', mode: 'amort',
    value_fen: 36000 * Y, start_month: '2026-10', total_months: 36, terminate_month: '', is_deleted: false },
  // 2026-12 中途再投一台设备（12 期）
  { _id: 'a2', asset_id: 'a2', shop_id: 's1', name: '厨房设备', mode: 'amort',
    value_fen: 12000 * Y, start_month: '2026-12', total_months: 12, terminate_month: '', is_deleted: false },
  // 2027-01 中途再投加盟费（24 期，不整除 ⇒ 有尾差）
  { _id: 'a3', asset_id: 'a3', shop_id: 's1', name: '加盟费', mode: 'amort',
    value_fen: 50000 * Y, start_month: '2027-01', total_months: 24, terminate_month: '', is_deleted: false },
  // 2027-03 一笔一次性（不进摊销）
  { _id: 'l1', asset_id: 'l1', shop_id: 's1', name: '开业推广费', mode: 'lump',
    value_fen: 5000 * Y, start_month: '2027-03', total_months: 1, terminate_month: '', is_deleted: false },
];

function reset(extra) {
  DATA = {
    shop_amortize: JSON.parse(JSON.stringify(ASSETS)),
    shop_switch: [
      { shop_id: 's1', switch_key: 'amortize_switch', enabled: false, is_deleted: false },
      { shop_id: 's1', switch_key: 'inventory_switch', enabled: false, is_deleted: false },
    ],
    shop_monthly_account: (extra && extra.accts) || [],
    shop: [{ _id: 's1', shop_id: 's1', biz_type: 'dining', city_tier: 'tier23', is_deleted: false }],
  };
}

// ======================= 逐月跑 =======================
function monthRange(from, to) {
  const idx = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
  const fmt = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
  const out = [];
  for (let i = idx(from); i <= idx(to); i++) out.push(fmt(i));
  return out;
}

async function probe(month) {
  reset();
  const sched = await getAmortSchedule.main({ shop_id: 's1', month });
  const led = await getLedger.main({ shop_id: 's1', month });
  const s = sched.data, l = led.data;
  return {
    month,
    sched_total_fen: s.total_amount_fen,
    sched_switch: s.amortize_switch_on,
    v2: s.amort_rule_v2,
    lump_total_fen: s.lump_total_fen,
    lumps: (s.lumps || []).map((x) => x.name),
    per_asset: (s.assets || []).map((a) => ({ name: a.name, this_fen: (s.details || []).find((d) => d.asset_id === a.asset_id).amount_fen,
      paid_months: a.paid_months, total_periods: a.total_periods, remaining_fen: a.remaining_fen, end_month: a.end_month })),
    ledger_amort_fen: l.amortize_fen,
    ledger_effective_fen: l.result.effective_amortize_fen,
    ledger_switch_on: l.amort_extra.switch_on,
    remain_periods: l.amort_extra.remaining_periods,
    end_month: l.amort_extra.end_month,
    profit_after_amort_fen: l.result.total_factor_real_profit_fen,
  };
}

(async () => {
  const months = monthRange('2026-09', '2029-10');
  const rows = [];
  for (const m of months) rows.push(await probe(m));

  const yuan = (fen) => (fen / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  console.log('\n===== ① 逐月摊销额（真跑 getAmortSchedule + getLedger）=====');
  console.log('月份      | 台账应摊额 | 台账总额(两页) | 引擎生效额 | 剩余期数 | 各笔本月 | 剩余未摊(A1) | 状态');
  for (const r of rows) {
    const per = r.per_asset.map((a) => `${a.name}:${(a.this_fen / 100).toFixed(2)}`).join(' + ') || '—';
    const a1 = r.per_asset.find((a) => a.name === '门店装修');
    console.log(
      `${r.month} | ${yuan(r.sched_total_fen).padStart(11)} | ${yuan(r.ledger_amort_fen).padStart(13)} | `
      + `${yuan(r.ledger_effective_fen).padStart(10)} | ${String(r.remain_periods).padStart(8)} | `
      + `${per} | ${a1 ? yuan(a1.remaining_fen) : '—'} | ${r.lump_total_fen ? '一次性 ' + yuan(r.lump_total_fen) : ''}`
    );
  }

  // ---------- 检验 1：闭包（一分不多、一分不少）----------
  const sumAll = rows.reduce((s, r) => s + r.sched_total_fen, 0);
  const sumLedger = rows.reduce((s, r) => s + r.ledger_effective_fen, 0);
  const sumValue = ASSETS.filter((a) => a.mode === 'amort').reduce((s, a) => s + a.value_fen, 0);
  console.log('\n===== ② 闭包检验（摊销总额 vs 资产原值）=====');
  console.log(`资产原值合计      ：${yuan(sumValue)}`);
  console.log(`台账逐月求和      ：${yuan(sumAll)}  差额 ${yuan(sumAll - sumValue)}`);
  console.log(`引擎生效额求和     ：${yuan(sumLedger)}  差额 ${yuan(sumLedger - sumValue)}`);

  // ---------- 检验 2：两页一致性 ----------
  console.log('\n===== ③ 两页是否说同一个数（摊销页 vs 结果页）=====');
  const bad = rows.filter((r) => r.sched_total_fen !== r.ledger_effective_fen);
  console.log(`不一致月份：${bad.length} 个`);
  bad.slice(0, 6).forEach((r) => console.log(`  ${r.month}  摊销页 ${yuan(r.sched_total_fen)} / 结果页 ${yuan(r.ledger_effective_fen)}  (v2=${r.v2} 开关=${r.sched_switch})`));

  // ---------- 检验 3：一次性只出现在当月 ----------
  console.log('\n===== ④ 一次性资产是否只在当月 ---------=');
  rows.filter((r) => r.lump_total_fen).forEach((r) => console.log(`  ${r.month}  一次性 ${yuan(r.lump_total_fen)}  [${r.lumps.join(',')}]`));

  // ---------- 检验 4：期数口径 ----------
  console.log('\n===== ⑤ 期数口径（已摊 + 剩余 是否 = 总期数）=====');
  for (const m of ['2026-10', '2026-11', '2026-12', '2027-01', '2028-12']) {
    const r = rows.find((x) => x.month === m);
    const a1 = r.per_asset.find((a) => a.name === '门店装修');
    console.log(`  ${m}  A1 已摊 ${a1.paid_months}/${a1.total_periods}，页面「剩余期数」${r.remain_periods}  ⇒ 已摊+剩余=${a1.paid_months + r.remain_periods}（应=总期数 ${a1.total_periods}）`);
  }
})();
