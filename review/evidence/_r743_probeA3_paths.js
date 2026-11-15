#!/usr/bin/env node
// _r743_probeA3_paths.js —— M1 独立审计：① 坏资产(start_month 空) 跨四处读点打架 ② 幂等写路径覆盖
// 运行：node review/evidence/_r743_probeA3_paths.js
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '../..');
const F = (p) => path.join(ROOT, p);
const Y = 100;

let DATA = {};
function eqMatch(row, cond) { for (const k in cond) if (row[k] !== cond[k]) return false; return true; }
function makeDb() {
  return { collection(name) {
    const rows = () => (DATA[name] ||= []);
    return { where(cond) { const hit = () => rows().filter((r) => eqMatch(r, cond || {}));
        return { limit(n) { return { get: async () => ({ data: hit().slice(0, n) }) }; },
          skip(k) { return { limit(n) { return { get: async () => ({ data: hit().slice(k, k + n) }) }; } }; },
          get: async () => ({ data: hit() }), count: async () => ({ total: hit().length }) }; },
      doc(id) { return { get: async () => { const r = rows().find((x) => x._id === id); if (!r) throw new Error('no doc'); return { data: r }; },
        update: async ({ data }) => { const r = rows().find((x) => x._id === id); if (r) Object.assign(r, data); return {}; } }; },
      add: async ({ data }) => { const r = Object.assign({ _id: 'gen_' + Math.random().toString(36).slice(2) }, data); rows().push(r); return { _id: r._id }; } };
  } };
}
const fakeCloud = { DYNAMIC_CURRENT_ENV: 'stub', init() {}, database() { return makeDb(); }, getWXContext() { return {}; } };
const origLoad = Module._load;
Module._load = function (req, parent, isMain) { if (req === 'wx-server-sdk') return fakeCloud; return origLoad.call(this, req, parent, isMain); };
function patchCommon(dir) {
  const c = require(F('cloudfunctions/' + dir + '/common.js'));
  c.resolveAuth = async () => ({ user: { id: 'u' } });
  c.assertShopOwner = async () => ({ error: null });
  c.hasFeature = async () => true;
  if (c.rateLimit) c.rateLimit.makeDbRateLimiter = () => async () => ({ limited: false });
  c.dataAdapter.makeAdapter = () => {
    const list = (coll, where, extra) => { const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
      return Promise.resolve({ data: (DATA[coll] || []).filter((r) => eqMatch(r, cond)).slice(0, 1000) }); };
    return { list, listAll: async (...a) => ({ data: (await list(...a)).data, truncated: false }),
      get: async (coll, id) => (DATA[coll] || []).find((r) => r._id === id || r.shop_id === id || r.asset_id === id || r.account_id === id) || null,
      insert: async (coll, d) => { const r = Object.assign({ _id: 'gen_' + Math.random().toString(36).slice(2), is_deleted: false }, d); (DATA[coll] = DATA[coll] || []).push(r); return { _id: r._id }; },
      listIncludingDeleted: list, countActive: async () => ({ total: 0 }), softDelete: async () => ({}) };
  };
  return c;
}
['getLedger', 'getAmortSchedule', 'exportData', 'saveLedger', 'saveAsset'].forEach(patchCommon);
const getLedger = require(F('cloudfunctions/getLedger/index.js'));
const getAmortSchedule = require(F('cloudfunctions/getAmortSchedule/index.js'));
const exportData = require(F('cloudfunctions/exportData/index.js'));
const saveLedger = require(F('cloudfunctions/saveLedger/index.js'));
const saveAsset = require(F('cloudfunctions/saveAsset/index.js'));

function reset(assets) {
  DATA = {
    shop_amortize: JSON.parse(JSON.stringify(assets)),
    shop_switch: [{ shop_id: 's1', switch_key: 'inventory_switch', enabled: false, is_deleted: false },
                  { shop_id: 's1', switch_key: 'amortize_switch', enabled: false, is_deleted: false }],
    shop_monthly_account: [{ _id: 'acc1', account_id: 'acc1', shop_id: 's1', month: '2026-11',
      is_archive: false, archived_at: 0, is_deleted: false,
      income_items: [{ category: 'c', name: '收入', amount_fen: 1000000, sub_items: [] }],
      expense_items: [{ category: 'c', name: '费用', amount_fen: 300000, sub_items: [] }],
      income_total_fen: 1000000, expense_total_fen: 300000, direct_consume_fen: 200000,
      inventory: { openingFen: 0, purchaseFen: 0, closingFen: 0 },
      switch_used: { inventorySwitchOn: false, amortizeSwitchOn: true },
      amortize_fen: 0, lump_sum_fen: 0, operation_ref_profit_fen: 500000, total_factor_real_profit_fen: 500000,
      profit_diff_fen: 0, gross_profit_fen: 800000, gross_margin_pct: 80,
      ref_material_fen: 200000, ref_material_source: 'direct', real_consume_fen: 200000,
      traffic_count: null, old_customer_count: null, member_sales_fen: null }],
    shop: [{ _id: 's1', shop_id: 's1', biz_type: 'dining', city_tier: 'tier23', is_deleted: false }],
    audit_log: [],
  };
}
const yuan = (f) => (Number(f) / 100).toFixed(2);

(async () => {
  console.log('==============================================================');
  console.log(' §A  坏资产(start_month="") 在四处读点的分歧（真跑 main）');
  console.log('==============================================================');
  const dirty = [{ _id: 'bad', asset_id: 'bad', shop_id: 's1', name: '老数据(空起摊月)', mode: 'amort',
    value_fen: 3600 * Y, start_month: '', total_months: 12, terminate_month: '', is_deleted: false }];
  reset(dirty);

  const gl = (await getLedger.main({ shop_id: 's1', month: '2026-11' })).data;
  const ga = (await getAmortSchedule.main({ shop_id: 's1', month: '2026-11' })).data;
  const exp = exportData.buildMonthlySheets({ shopName: 's', month: '2026-11', stamp: 1,
    row: DATA.shop_monthly_account[0], assets: DATA.shop_amortize });
  const expAmort = (exp.find((s) => s.name === '利润表').rows.find((r) => r[0] === '　减：当月摊销') || [])[1];
  // 重存一次账（saveLedger 会把坏资产算进落库）
  const sv = await saveLedger.main({ shop_id: 's1', month: '2026-11',
    income_items: [{ category: 'c', name: '收入', amount_fen: 1000000 }],
    expense_items: [{ category: 'c', name: '费用', amount_fen: 300000 }],
    direct_consume_fen: 200000, inventory: { opening_fen: 0, purchase_fen: 0, closing_fen: 0 } });
  console.log(`  saveLedger 落库 amortize_fen = ${yuan(sv.data.amortize_fen)} 元  profit_true = ${yuan(sv.data.profit_true)} 元`);
  console.log(`  getAmortSchedule 页首 total_amount_fen = ${yuan(ga.total_amount_fen)} 元`);
  console.log(`  getLedger 结果页 amortize_fen = ${yuan(gl.amortize_fen)} 元  真实利润 = ${yuan(gl.result.total_factor_real_profit_fen)} 元`);
  console.log(`  exportData 利润表 减:当月摊销 = ${expAmort} 元`);
  console.log(`  ⇒ 同一笔坏资产：落库/摊销页计入 ${yuan(sv.data.amortize_fen)} 元，结果页/导出件计入 0 ⇒ 差 ${yuan(sv.data.amortize_fen)} 元`);
  console.log('    且 saveLedger 返回的 profit_true 与 getLedger 显示值不一致（老板保存完立刻看到两个数）');

  console.log('\n==============================================================');
  console.log(' §B  幂等：同一 client_request_id 顺序重复 / 空 crid 重复 / 并发窗口');
  console.log('==============================================================');
  // B1 顺序重复（带 crid）
  reset([]);
  const mkAsset = (crid) => ({ shop_id: 's1', client_request_id: crid,
    asset: { name: '新设备', value_fen: 1200 * Y, start_month: '2026-11', total_months: 12, mode: 'amort' } });
  await saveAsset.main(mkAsset('REQ-1'));
  const n1 = DATA.shop_amortize.length;
  await saveAsset.main(mkAsset('REQ-1'));
  const n2 = DATA.shop_amortize.length;
  console.log(`  B1 带 crid 顺序重复：第一次后 ${n1} 行，第二次后 ${n2} 行  ⇒ ${n1 === n2 ? '✅ 被 findPriorResult 挡住' : '❌ 重复插入'}`);

  // B2 空 crid 重复（双击/重试但前端没带 crid）
  reset([]);
  await saveAsset.main(mkAsset(''));
  const m1 = DATA.shop_amortize.length;
  await saveAsset.main(mkAsset(''));
  const m2 = DATA.shop_amortize.length;
  console.log(`  B2 空 crid 顺序重复：第一次后 ${m1} 行，第二次后 ${m2} 行  ⇒ ${m1 === m2 ? '一致' : '❌ 重复插入（摊销翻倍）'}`);
  console.log('     根因：common/idempotency.js:42-43 shopKey 空 crid 返回空串；:68 findPriorResult 直接 return null');

  // B3 并发窗口：两个请求都过了预检，才各自落库
  reset([]);
  const p1 = saveAsset.main(mkAsset('REQ-C'));
  const p2 = saveAsset.main(mkAsset('REQ-C'));
  await Promise.all([p1, p2]);
  const c = DATA.shop_amortize.length;
  console.log(`  B3 并发两个同 crid：落库 ${c} 行  ⇒ ${c === 1 ? '被挡住' : '❌ 两个请求都过了预检，各 INSERT 一笔 ⇒ 摊销翻倍'}`);
  console.log('     根因：预检(index.js:85) 与 登记(index.js:150-160) 之间无唯一约束，audit_log 是异步后写');

  // B4 删除分支是否也过幂等（静态：预检在 exports.main 开头，所有分支共用）
  console.log('  B4 删除/编辑/新增三分支：幂等预检位于 index.js:84-86（分支之前），覆盖全部写路径 ✅');
  console.log('     但空 crid 时三分支一律不设防（同 B2）');
})();
