#!/usr/bin/env node
// _r743_probeA1_lump.js —— M1 独立审计：一次性投入(lump) 与 分期摊销(amort) 取数口径是否对称
//
// 手法：内存假 db + 真云函数 exports.main（不重写任何公式，只喂数据）。
// 场景（完全可达）：老板先在录入页保存了 2026-11 的账（此刻台账里两笔资产都还没登记），
//   然后到【摊销资产页】登记了 ① 一笔分期摊销 ② 一笔一次算清，两者 start_month 都是 2026-11。
//   saveAsset 只写 shop_amortize，从不碰 shop_monthly_account ⇒ 账本里的
//   amortize_fen / lump_sum_fen / 两个利润 仍是保存那一刻的旧值。
//   随后老板打开【结果页】/【摊销页】/【导出月报】，看三者说的是不是同一个数。
//
// 运行：node review/evidence/_r743_probeA1_lump.js
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '../..');
const F = (p) => path.join(ROOT, p);
const Y = 100;

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
            update: async ({ data }) => {
              const r = rows().find((x) => x._id === id);
              if (r) Object.assign(r, data);
              return { stats: { updated: 1 } };
            },
          };
        },
        add: async ({ data }) => {
          const r = Object.assign({ _id: 'new_' + Math.random() }, data);
          rows().push(r); return { _id: r._id };
        },
      };
    },
  };
}

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
  c.hasFeature = async () => true;
  if (c.rateLimit) c.rateLimit.makeDbRateLimiter = () => async () => ({ limited: false });
  c.dataAdapter.makeAdapter = () => {
    function list(coll, where, extra) {
      const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
      const rows = (DATA[coll] || []).filter((r) => eqMatch(r, cond));
      return Promise.resolve({ data: rows.slice(0, 1000) });
    }
    async function listAll(coll, where, extra) { return { data: (await list(coll, where, extra)).data, truncated: false }; }
    async function get(coll, id) {
      const rows = DATA[coll] || [];
      return rows.find((r) => r._id === id) || rows.find((r) => r.shop_id === id) || null;
    }
    async function insert(coll, data) {
      const r = Object.assign({ _id: 'new_' + Math.random(), created_at: 0, updated_at: 0, is_deleted: false }, data);
      (DATA[coll] = DATA[coll] || []).push(r); return { _id: r._id };
    }
    return { list, listAll, get, insert,
      listIncludingDeleted: list, countActive: async () => ({ total: 0 }),
      softDelete: async () => ({}) };
  };
  return c;
}
['getLedger', 'getAmortSchedule', 'exportData', 'saveLedger'].forEach(patchCommon);

const getLedger = require(F('cloudfunctions/getLedger/index.js'));
const getAmortSchedule = require(F('cloudfunctions/getAmortSchedule/index.js'));
const exportData = require(F('cloudfunctions/exportData/index.js'));
const saveLedger = require(F('cloudfunctions/saveLedger/index.js'));

// ======================= fixture =======================
// 两笔资产都是【保存账本之后】才登记的（start_month 都是本月）。
const ASSETS = [
  { _id: 'a1', asset_id: 'a1', shop_id: 's1', name: '厨房设备(分期12期)', mode: 'amort',
    value_fen: 3600 * Y, start_month: '2026-11', total_months: 12, terminate_month: '', is_deleted: false },
  { _id: 'l1', asset_id: 'l1', shop_id: 's1', name: '开业推广费(一次算清)', mode: 'lump',
    value_fen: 1000 * Y, start_month: '2026-11', total_months: 1, terminate_month: '', is_deleted: false },
];
// 账本：保存那一刻台账里两笔都还没有 ⇒ 快照 amortize_fen=0 / lump_sum_fen=0
const ACCT = {
  _id: 'acc1', account_id: 'acc1', shop_id: 's1', month: '2026-11',
  is_archive: false, archived_at: 0, is_deleted: false,
  income_items: [{ category: '堂食', name: '营业收入', amount_fen: 10000 * Y, sub_items: [] }],
  expense_items: [{ category: '房租', name: '房租', amount_fen: 3000 * Y, sub_items: [] }],
  income_total_fen: 10000 * Y, expense_total_fen: 3000 * Y,
  direct_consume_fen: 2000 * Y, real_consume_fen: 2000 * Y,
  gross_profit_fen: 8000 * Y, gross_margin_pct: 80,
  amortize_fen: 0, lump_sum_fen: 0,
  operation_ref_profit_fen: 5000 * Y, total_factor_real_profit_fen: 5000 * Y, profit_diff_fen: 0,
  ref_material_fen: 2000 * Y, ref_material_source: 'direct', profit_caliber_version: 'm1_v2',
  switch_used: { inventorySwitchOn: false, amortizeSwitchOn: true },
  inventory: { openingFen: 0, purchaseFen: 0, closingFen: 0 },
  traffic_count: null, old_customer_count: null, member_sales_fen: null,
};
function reset(archive) {
  DATA = {
    shop_amortize: JSON.parse(JSON.stringify(ASSETS)),
    shop_switch: [
      { shop_id: 's1', switch_key: 'amortize_switch', enabled: false, is_deleted: false },
      { shop_id: 's1', switch_key: 'inventory_switch', enabled: false, is_deleted: false },
    ],
    shop_monthly_account: [Object.assign({}, ACCT, { is_archive: !!archive, archived_at: archive ? 1700000000000 : 0 })],
    shop: [{ _id: 's1', shop_id: 's1', name: '测试店', biz_type: 'dining', city_tier: 'tier23', is_deleted: false }],
    audit_log: [],
  };
}
const yuan = (f) => (Number(f) / 100).toFixed(2);

async function run(archive) {
  reset(archive);
  const sched = (await getAmortSchedule.main({ shop_id: 's1', month: '2026-11' })).data;
  const led = (await getLedger.main({ shop_id: 's1', month: '2026-11' })).data;
  const sheets = exportData.buildMonthlySheets({
    shopName: '测试店', month: '2026-11', stamp: 1700000000000,
    row: DATA.shop_monthly_account[0], assets: DATA.shop_amortize,
  });
  const profitTable = sheets.find((s) => s.name === '利润表').rows;
  const assetTable = sheets.find((s) => s.name === '摊销来源').rows;
  const pick = (label) => (profitTable.find((r) => r[0] === label) || [])[1];
  return {
    archive,
    sched_amort: sched.total_amount_fen,
    sched_lump: sched.lump_total_fen,
    sched_lumps: (sched.lumps || []).map((x) => x.name),
    led_amort: led.amortize_fen,
    led_lump: led.lump_sum_fen,
    led_opRef: led.result.operation_ref_profit_fen,
    led_realP: led.result.total_factor_real_profit_fen,
    exp_amort: pick('　减：当月摊销'),
    exp_lump: pick('减：一次性投入（本月）'),
    exp_opRef: pick('＝ 经营参考利润'),
    exp_realP: pick('＝ 全要素真实利润'),
    assetTableLumpRows: assetTable.filter((r) => String(r[1]).indexOf('一次') >= 0 || String(r[0]).indexOf('一次') >= 0),
  };
}

(async () => {
  for (const archive of [false, true]) {
    const r = await run(archive);
    console.log('\n==============================================================');
    console.log(` 场景：账本已保存，之后才在台账登记两笔资产 | is_archive=${archive}`);
    console.log('==============================================================');
    console.log(` 台账实况：分期摊销本月应摊 ${yuan(3600 * Y / 12)} 元；一次算清 ${yuan(1000 * Y)} 元`);
    console.log(` 账本快照：amortize_fen=0，lump_sum_fen=0（保存时两笔都还没登记）\n`);
    console.log(' 【摊销页 getAmortSchedule /index.js:108,134】');
    console.log(`   total_amount_fen(本月摊销) = ${yuan(r.sched_amort)} 元`);
    console.log(`   lump_total_fen(本月一次性) = ${yuan(r.sched_lump)} 元  lumps=${JSON.stringify(r.sched_lumps)}`);
    console.log(' 【结果页 getLedger /index.js:157,159】');
    console.log(`   amortize_fen  = ${yuan(r.led_amort)} 元   ← ${r.led_amort === 3600 * Y / 12 ? '台账实时重算：扣了' : '未实时重算'}`);
    console.log(`   lump_sum_fen  = ${yuan(r.led_lump)} 元   ← ${r.led_lump === 0 ? '读快照：没扣' : '扣了'}`);
    console.log(`   经营参考利润  = ${yuan(r.led_opRef)} 元   全要素真实利润 = ${yuan(r.led_realP)} 元`);
    console.log(' 【导出月报 exportData /index.js:184,185,206,276-300】');
    console.log(`   利润表 减:当月摊销        = ${r.exp_amort} 元`);
    console.log(`   利润表 减:一次性投入      = ${r.exp_lump} 元`);
    console.log(`   利润表 ＝经营参考利润      = ${r.exp_opRef} 元`);
    console.log(`   利润表 ＝全要素真实利润    = ${r.exp_realP} 元`);
    console.log('   摊销来源表里与「一次性」有关的行：');
    r.assetTableLumpRows.forEach((x) => console.log(`     ${JSON.stringify(x)}`));
    console.log('\n >>> 判据');
    console.log(`   摊销页一次性 ${yuan(r.sched_lump)} 元  vs  结果页一次性 ${yuan(r.led_lump)} 元  ⇒ ${r.sched_lump !== r.led_lump ? '❌ 两页打架' : '一致'}`);
    console.log(`   正确应扣一次性 = ${yuan(1000 * Y)} 元；实际利润少扣 ${yuan(1000 * Y - r.led_lump)} 元 ⇒ 利润虚高 ${yuan(1000 * Y - r.led_lump)} 元`);
  }

  // ===== 附加证据：老板重存一次账，数字才变对（说明现状确实是"漏扣"）=====
  reset(false);
  const before = (await getLedger.main({ shop_id: 's1', month: '2026-11' })).data;
  const saved = await saveLedger.main({
    shop_id: 's1', month: '2026-11',
    income_items: [{ category: '堂食', name: '营业收入', amount_fen: 10000 * Y }],
    expense_items: [{ category: '房租', name: '房租', amount_fen: 3000 * Y }],
    direct_consume_fen: 2000 * Y,
    inventory: { opening_fen: 0, purchase_fen: 0, closing_fen: 0 },
  });
  const after = (await getLedger.main({ shop_id: 's1', month: '2026-11' })).data;
  console.log('\n==============================================================');
  console.log(' 附加证据：同一份数据，只是"重新保存一次账"，利润就变了');
  console.log('==============================================================');
  console.log(` saveLedger 返回 profit_true = ${yuan(saved.data.profit_true)} 元`);
  console.log(` 重存前 getLedger 真实利润   = ${yuan(before.result.total_factor_real_profit_fen)} 元（lump_sum_fen=${yuan(before.lump_sum_fen)}）`);
  console.log(` 重存后 getLedger 真实利润   = ${yuan(after.result.total_factor_real_profit_fen)} 元（lump_sum_fen=${yuan(after.lump_sum_fen)}）`);
  console.log(` 差额 = ${yuan(before.result.total_factor_real_profit_fen - after.result.total_factor_real_profit_fen)} 元  ← 这就是未重存时老板多看的利润`);
})();
