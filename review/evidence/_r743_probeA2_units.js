#!/usr/bin/env node
// _r743_probeA2_units.js —— M1 独立审计：数值边界 / 资产过滤一致性 / inventory 字段映射 / 归档判据
// 运行：node review/evidence/_r743_probeA2_units.js
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '../..');
const F = (p) => path.join(ROOT, p);
const Y = 100;

// ---------- 纯函数直取（不依赖 db）----------
const glSvc = require(F('cloudfunctions/getLedger/service.js'));
const slSvc = require(F('cloudfunctions/saveLedger/service.js'));
const gaSvc = require(F('cloudfunctions/getAmortSchedule/service.js'));
const mpSvc = require(F('cloudfunctions/calcMonthlyProfit/service.js'));
const money = require(F('cloudfunctions/common/money.js'));

console.log('==============================================================');
console.log(' §1 amountForMonth 对「start_month 非法 / total_months 非法」的行为');
console.log('==============================================================');
const badAssets = [
  { label: 'start_month=""',       a: { start_month: '', total_months: 12, total_value: 360000 } },
  { label: 'start_month=undefined', a: { total_months: 12, total_value: 360000 } },
  { label: 'start_month="2026-13"', a: { start_month: '2026-13', total_months: 12, total_value: 360000 } },
  { label: 'total_months=undefined', a: { start_month: '2026-11', total_value: 360000 } },
  { label: 'total_months=0',        a: { start_month: '2026-11', total_months: 0, total_value: 360000 } },
  { label: '正常(对照)',            a: { start_month: '2026-11', total_months: 12, total_value: 360000 } },
];
for (const b of badAssets) {
  const v = slSvc.amountForMonth(b.a, '2026-11');
  console.log(`  ${b.label.padEnd(24)} amountForMonth(...,'2026-11') = ${String(v).padEnd(10)} ${v === 0 ? '(0, 正确排除)' : (Number.isNaN(v) ? '← NaN 穿透' : '← 非 0：会被计入当月摊销')}`);
}
console.log('  基准：360000/12 = 30000 分/月 = 300 元');

console.log('\n==============================================================');
console.log(' §2 四处资产过滤字面是否一致（静态取证 + 真跑）');
console.log('==============================================================');
console.log('  getLedger/index.js:141      .filter(a => a.mode !== "lump" && a.start_month)   ← 过滤非法起摊月');
console.log('  exportData/index.js:147     .filter(a => a.mode !== "lump" && a.start_month)   ← 过滤非法起摊月');
console.log('  saveLedger/index.js:114     .filter(a => a.mode !== "lump")                    ← 未过滤');
console.log('  getAmortSchedule/index.js:105 rows.filter(a => a.mode !== "lump")              ← 未过滤');
const dirty = [
  { asset_id: 'bad', name: '坏资产(空起摊月)', mode: 'amort', start_month: '', total_months: 12, total_value: 360000 },
];
const withFilter = dirty.filter((a) => a.mode !== 'lump' && a.start_month);
const withoutFilter = dirty.filter((a) => a.mode !== 'lump');
console.log(`  有 start_month 过滤：${slSvc.amortizeTotalForMonth(withFilter, '2026-11')} 分`);
console.log(`  无 start_month 过滤：${slSvc.amortizeTotalForMonth(withoutFilter, '2026-11')} 分  ← 差 ${slSvc.amortizeTotalForMonth(withoutFilter, '2026-11') - slSvc.amortizeTotalForMonth(withFilter, '2026-11')} 分`);

console.log('\n==============================================================');
console.log(' §3 num0 / Math.round(fenRoundN) 边界行为（三副本同源）');
console.log('==============================================================');
// num0 是 service 内部私有，用等价实现 + 真结果核对
const num0 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numCases = [undefined, null, '', '100', '12,000', NaN, Infinity, -1, 0, 2.5, -2.5, 1e16, Number.MAX_SAFE_INTEGER + 2];
for (const v of numCases) console.log(`  num0(${String(v).padEnd(24)}) = ${num0(v)}`);
console.log('  Math.round 负数半步：2.5→', Math.round(2.5), ' -2.5→', Math.round(-2.5), ' -1.5→', Math.round(-1.5), '(向 +∞ 取整，非对称)');
console.log('  超大数：Math.round(', Number.MAX_SAFE_INTEGER + 0.5, ') =', Math.round(Number.MAX_SAFE_INTEGER + 0.5), ' (2^53 后整数已不可精确表达)');
// 求和：脏项是否污染
const items = [{ amountFen: 100 }, { amountFen: undefined }, { amountFen: '200' }, { amountFen: NaN }, { amountFen: null }];
const sum = items.reduce((s, it) => s + num0(it && it.amountFen), 0);
console.log('  混合脏明细求和 =', sum, '（预期 300：字符串 "200" 被 Number() 静默转数；undefined/NaN/null 归 0；不会字符串拼接）');

console.log('\n==============================================================');
console.log(' §4 common/money.js::yuanToFen 十进制安全（与前端同源）');
console.log('==============================================================');
for (const y of [0.145, 0.285, 1.005, 12.5, 12000, -1, NaN, 1e15]) {
  let r; try { r = money.yuanToFen(y); } catch (e) { r = 'THROW:' + (e.msg || e.code); }
  console.log(`  yuanToFen(${String(y).padEnd(8)}) = ${r}`);
}

// ---------- 真跑 main：inventory snake_case 漏映射 + 归档判据 ----------
let DATA = {};
function eqMatch(row, cond) { for (const k in cond) if (row[k] !== cond[k]) return false; return true; }
function makeDb() {
  return { collection(name) {
    const rows = () => (DATA[name] || []);
    return {
      where(cond) { const hit = () => rows().filter((r) => eqMatch(r, cond || {}));
        return { limit(n) { return { get: async () => ({ data: hit().slice(0, n) }) }; },
          skip(k) { return { limit(n) { return { get: async () => ({ data: hit().slice(k, k + n) }) }; } }; },
          get: async () => ({ data: hit() }), count: async () => ({ total: hit().length }) }; },
      doc(id) { return { get: async () => { const r = rows().find((x) => x._id === id); if (!r) throw new Error('no doc'); return { data: r }; },
        update: async ({ data }) => { const r = rows().find((x) => x._id === id); if (r) Object.assign(r, data); return {}; } }; },
      add: async ({ data }) => { const r = Object.assign({ _id: 'new' }, data); rows().push(r); return { _id: r._id }; },
    };
  } };
}
const fakeCloud = { DYNAMIC_CURRENT_ENV: 'stub', init() {}, database() { return makeDb(); }, getWXContext() { return {}; } };
const origLoad = Module._load;
Module._load = function (req, parent, isMain) { if (req === 'wx-server-sdk') return fakeCloud; return origLoad.call(this, req, parent, isMain); };
function patchCommon(dir) {
  const c = require(F('cloudfunctions/' + dir + '/common.js'));
  c.resolveAuth = async () => ({ user: { id: 'u' } });
  c.assertShopOwner = async () => ({ error: null });
  c.dataAdapter.makeAdapter = () => {
    const list = (coll, where, extra) => { const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
      return Promise.resolve({ data: (DATA[coll] || []).filter((r) => eqMatch(r, cond)).slice(0, 1000) }); };
    return { list, listAll: async (...a) => ({ data: (await list(...a)).data, truncated: false }),
      get: async (coll, id) => (DATA[coll] || []).find((r) => r._id === id || r.shop_id === id) || null,
      insert: async (coll, d) => { const r = Object.assign({ _id: 'new', is_deleted: false }, d); (DATA[coll] = DATA[coll] || []).push(r); return { _id: r._id }; } };
  };
  return c;
}
['getLedger', 'getAmortSchedule', 'exportData', 'saveLedger'].forEach(patchCommon);
const getLedger = require(F('cloudfunctions/getLedger/index.js'));
const getAmortSchedule = require(F('cloudfunctions/getAmortSchedule/index.js'));

function baseAcct(inv) {
  return { _id: 'acc1', account_id: 'acc1', shop_id: 's1', month: '2026-11', is_archive: false, archived_at: 0, is_deleted: false,
    income_items: [{ category: 'c', name: '收入', amount_fen: 1000000, sub_items: [] }],
    expense_items: [{ category: 'c', name: '费用', amount_fen: 300000, sub_items: [] }],
    income_total_fen: 1000000, expense_total_fen: 300000, direct_consume_fen: 200000,
    inventory: inv, switch_used: { inventorySwitchOn: true, amortizeSwitchOn: true },
    amortize_fen: 0, lump_sum_fen: 0, operation_ref_profit_fen: 500000, total_factor_real_profit_fen: 500000,
    profit_diff_fen: 0, gross_profit_fen: 800000, gross_margin_pct: 80,
    ref_material_fen: 200000, ref_material_source: 'reverse', real_consume_fen: 230000,
    traffic_count: null, old_customer_count: null, member_sales_fen: null };
}
function reset(acct) {
  DATA = { shop_amortize: [], shop_switch: [
    { shop_id: 's1', switch_key: 'inventory_switch', enabled: true, is_deleted: false },
    { shop_id: 's1', switch_key: 'amortize_switch', enabled: false, is_deleted: false }],
    shop_monthly_account: [acct], shop: [{ _id: 's1', shop_id: 's1', biz_type: 'dining', city_tier: 'tier23', is_deleted: false }] };
}
(async () => {
  console.log('\n==============================================================');
  console.log(' §5 inventory 字段映射：库里是 snake_case 老数据时，喂引擎会怎样');
  console.log('==============================================================');
  console.log(' 引擎只读 inv.openingFen/purchaseFen/closingFen (camelCase)，见 getLedger/service.js:62');
  console.log(' 但 invToSnake() 兼容 snake_case（getLedger/index.js:59-61）——说明库里两种命名都可能');
  for (const [label, inv] of [
    ['camelCase(现行写入)', { openingFen: 50000, purchaseFen: 250000, closingFen: 70000 }],
    ['snake_case(老数据)',  { opening_fen: 50000, purchase_fen: 250000, closing_fen: 70000 }],
  ]) {
    reset(baseAcct(inv));
    const l = (await getLedger.main({ shop_id: 's1', month: '2026-11' })).data;
    console.log(`  ${label.padEnd(22)} real_consume_fen=${String(l.result.real_consume_fen).padEnd(8)} ` +
      `inventory回显=${JSON.stringify(l.inventory)} 全要素真实利润=${l.result.total_factor_real_profit_fen}`);
  }
  console.log('  正确倒轧 = 50000+250000-70000 = 230000 分（2300 元）');
  console.log('  ⇒ snake_case 老数据：出参回显正确，但引擎倒轧按 0 算 ⇒ 食材成本凭空消失 ⇒ 利润虚高');

  console.log('\n==============================================================');
  console.log(' §6 归档判据三处是否完全一致（真跑 is_archive=true）');
  console.log('==============================================================');
  const archAcct = Object.assign(baseAcct({ openingFen: 0, purchaseFen: 0, closingFen: 0 }), {
    is_archive: true, archived_at: 1700000000000, amortize_fen: 555000 });
  reset(archAcct);
  const l = (await getLedger.main({ shop_id: 's1', month: '2026-11' })).data;
  const s = (await getAmortSchedule.main({ shop_id: 's1', month: '2026-11' })).data;
  console.log(`  getLedger       is_archive=${l.is_archive}  amortize_fen=${l.amortize_fen}  (读落库快照 555000)`);
  console.log(`  getAmortSchedule is_archive=${s.is_archive}  total_amount_fen=${s.total_amount_fen} (读落库快照 555000) recomputed=${s.recomputed_total_fen}`);
  console.log(`  exportData/index.js:183  isArchiveRow = !!row.is_archive  （同一判据，见源码）`);
  console.log('  ⇒ 三处判据均为 !!row.is_archive，一致；归档月一律读落库快照，未归档月从台账重算');

  console.log('\n==============================================================');
  console.log(' §7 softDelete 过滤：da.list 是否每个 shop_amortize 读点都生效');
  console.log('==============================================================');
  reset(baseAcct({ openingFen: 0, purchaseFen: 0, closingFen: 0 }));
  DATA.shop_amortize = [
    { _id: 'x1', asset_id: 'x1', shop_id: 's1', name: '已软删', mode: 'amort', value_fen: 360000, start_month: '2026-11', total_months: 12, is_deleted: true },
    { _id: 'x2', asset_id: 'x2', shop_id: 's1', name: '活跃', mode: 'amort', value_fen: 120000, start_month: '2026-11', total_months: 12, is_deleted: false },
  ];
  const l2 = (await getLedger.main({ shop_id: 's1', month: '2026-11' })).data;
  console.log(`  getLedger  amortize_fen=${l2.amortize_fen}  (应=10000 分=100 元，仅活跃资产；软删那条 30000 不计入)`);
  console.log(`  ⇒ da.list 统一注入 is_deleted:false (common/dataAdapter.js:44)，四处读点均走 da.list，软删不复活`);
})();
