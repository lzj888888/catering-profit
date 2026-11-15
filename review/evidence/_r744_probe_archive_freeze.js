#!/usr/bin/env node
// R744 归档冻结取证：归档月读落库快照，新口径不得倒灌旧账
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
const F = (p) => path.join(ROOT, p);
const Y = 100;
const yuan = (f) => (f / Y).toFixed(2);
let DATA = {};
const eq = (r, c) => { for (const k in c) if (r[k] !== c[k]) return false; return true; };
function makeDb() {
  return { collection(n) { const rows = () => DATA[n] || []; return {
    where(c) { const hit = () => rows().filter((r) => eq(r, c || {})); return {
      limit(x) { return { get: async () => ({ data: hit().slice(0, x) }) }; },
      skip(k) { return { limit(x) { return { get: async () => ({ data: hit().slice(k, k + x) }) }; } }; },
      get: async () => ({ data: hit() }), count: async () => ({ total: hit().length }),
    }; },
    doc(id) { return { get: async () => ({ data: rows().find((r) => r._id === id) }) }; },
  }; } };
}
const origLoad = Module._load;
Module._load = function (q) { if (q === 'wx-server-sdk') return { DYNAMIC_CURRENT_ENV: 'stub', init() {}, database() { return makeDb(); }, getWXContext() { return { OPENID: 'u' }; } }; return origLoad.apply(this, arguments); };
for (const d of ['getLedger', 'getAmortSchedule', 'exportData', 'saveLedger']) {
  const c = require(F('cloudfunctions/' + d + '/common.js'));
  c.resolveAuth = async () => ({ user: { id: 'u' } });
  c.assertShopOwner = async () => ({ error: null });
  c.dataAdapter.makeAdapter = () => ({
    list: (coll, where, extra) => Promise.resolve({ data: (DATA[coll] || []).filter((r) => eq(r, Object.assign({}, extra || {}, where || {}, { is_deleted: false }))).slice(0, 1000) }),
    listAll: (coll, where, extra) => Promise.resolve({ data: (DATA[coll] || []).filter((r) => eq(r, Object.assign({}, extra || {}, where || {}, { is_deleted: false }))).slice(0, 1000) }),
    get: async (coll, id) => (DATA[coll] || []).find((r) => r._id === id) || null,
  });
}
const getLedger = require(F('cloudfunctions/getLedger/index.js'));
const getAmortSchedule = require(F('cloudfunctions/getAmortSchedule/index.js'));

// 归档月：落库快照里 **没有** disposal_loss_fen（老账），且 amortize_fen / lump_sum_fen 是旧口径值
const ACCT = {
  _id: 'acc', shop_id: 's1', month: '2026-08', is_archive: true,
  income_items: [{ category: 'food', name: '营收', amount_fen: 500000 }], expense_items: [],
  direct_consume_fen: 0, inventory: { openingFen: 0, purchaseFen: 0, closingFen: 0 },
  amortize_fen: 33333, lump_sum_fen: 0, switch_used: { inventorySwitchOn: false, amortizeSwitchOn: true },
  is_deleted: false,
};
// 台账里有一笔 2026-08 提前报废的资产（新口径现算会多出 9333.36）
const AIR = { _id: 'air', asset_id: 'air', shop_id: 's1', name: '旧空调', mode: 'amort',
  value_fen: 1200000, start_month: '2026-01', total_months: 36, terminate_month: '2026-08', is_deleted: false };

(async () => {
  console.log('===== R744 归档冻结取证 =====\n');
  DATA = { shop_amortize: [AIR], shop_monthly_account: [ACCT],
    shop_switch: [], shop: [{ _id: 's1', shop_id: 's1', biz_type: 'dining', city_tier: 'tier23', is_deleted: false }] };

  const g = await getLedger.main({ shop_id: 's1', month: '2026-08' });
  const s = await getAmortSchedule.main({ shop_id: 's1', month: '2026-08' });
  const gd = (g && g.data) || {}, sd = (s && s.data) || {};
  console.log(`结果页 amortize_fen      = ${yuan(gd.amortize_fen || 0)}  （期望 333.33 = 落库快照，不被处置损失倒灌）`);
  console.log(`结果页 disposal_loss_fen = ${yuan(gd.disposal_loss_fen || 0)}  （期望 0.00 = 老账无此字段，不追历史）`);
  console.log(`摊销页 total_amount_fen  = ${yuan(sd.total_amount_fen || 0)}  （期望 333.33 = 同一快照）`);
  console.log(`摊销页 recomputed        = ${yuan(sd.recomputed_total_fen || 0)}  （新口径现算 = 9666.69）`);
  console.log(`摊销页 caliber_drift_fen  = ${yuan(sd.caliber_drift_fen || 0)}  （差额，供前端披露）\n`);
  const frozen = gd.amortize_fen === 33333 && gd.disposal_loss_fen === 0 && sd.total_amount_fen === 33333;
  console.log(`归档冻结：${frozen ? '✅ 成立 —— 新口径未倒灌已封账月' : '❌ 破 —— 旧账被改'}`);
  console.log(`两页一致：${gd.amortize_fen === sd.total_amount_fen ? '✅ 成立' : '❌ 打架'}`);
  console.log(`漂移披露：${sd.caliber_drift_fen > 0 ? '✅ 差额可见（R741 纪律）' : '❌ 未披露'}`);
  console.log('\n===== 结论：历史不追、差额披露、两页不打架 =====');
})();
