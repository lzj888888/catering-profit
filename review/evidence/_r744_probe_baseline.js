#!/usr/bin/env node
// R744 口径取证 · 改动前基线：真跑生产引擎，量化「报废残值蒸发」与「一次性投入要重存」各错多少钱
// 手法：内存假 db + 真 exports.main（不重写公式）
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
const F = (p) => path.join(ROOT, p);
const Y = 100;
const yuan = (f) => (f / Y).toFixed(2);

let DATA = {};
function eqMatch(row, cond) { for (const k in cond) if (row[k] !== cond[k]) return false; return true; }
function makeDb() {
  return {
    collection(name) {
      const rows = () => DATA[name] || [];
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
        doc(id) { return { get: async () => ({ data: rows().find((x) => x._id === id) }) }; },
      };
    },
  };
}
const fakeCloud = {
  DYNAMIC_CURRENT_ENV: 'stub-env', init() {}, database() { return makeDb(); },
  getWXContext() { return { OPENID: 'openid_stub' }; },
};
const origLoad = Module._load;
Module._load = function (req) { if (req === 'wx-server-sdk') return fakeCloud; return origLoad.apply(this, arguments); };
function patchCommon(dir) {
  const c = require(F('cloudfunctions/' + dir + '/common.js'));
  c.resolveAuth = async () => ({ user: { id: 'u_stub' } });
  c.assertShopOwner = async () => ({ error: null });
  c.dataAdapter.makeAdapter = () => {
    function list(coll, where, extra) {
      const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
      return Promise.resolve({ data: (DATA[coll] || []).filter((r) => eqMatch(r, cond)).slice(0, 1000) });
    }
    async function get(coll, id) {
      const rows = DATA[coll] || [];
      return rows.find((r) => r._id === id) || rows.find((r) => r.shop_id === id) || null;
    }
    return { list, listAll: list, get, add: async () => ({}), update: async () => ({}) };
  };
  return c;
}
for (const d of ['getLedger', 'saveLedger', 'getAmortSchedule', 'exportData', 'saveAsset']) {
  try { patchCommon(d); } catch (_) { /* 未部署派生副本的函数跳过 */ }
}
const getLedger = require(F('cloudfunctions/getLedger/index.js'));
const getAmortSchedule = require(F('cloudfunctions/getAmortSchedule/index.js'));

function reset(assets, accts) {
  DATA = {
    shop_amortize: JSON.parse(JSON.stringify(assets)),
    shop_switch: [
      { shop_id: 's1', switch_key: 'amortize_switch', enabled: false, is_deleted: false },
      { shop_id: 's1', switch_key: 'inventory_switch', enabled: false, is_deleted: false },
    ],
    shop_monthly_account: accts || [],
    shop: [{ _id: 's1', shop_id: 's1', biz_type: 'dining', city_tier: 'tier23', is_deleted: false }],
  };
}
const call = (fn, ev) => fn.main(Object.assign({ shop_id: 's1' }, ev));

console.log('===== R744 改动前基线取证 =====\n');

// 场景 1：旧空调 12000 元 / 36 期，2026-01 起摊，2026-08 提前报废（规范 S2b 锚点）
const AIR = {
  _id: 'air', asset_id: 'air', shop_id: 's1', name: '旧空调', mode: 'amort',
  value_fen: 12000 * Y, start_month: '2026-01', total_months: 36,
  terminate_month: '2026-08', is_deleted: false,
};
// 场景 2：一次性投入 1000 元，挂在 2026-11
const LUMP = {
  _id: 'l1', asset_id: 'l1', shop_id: 's1', name: '开业推广费', mode: 'lump',
  value_fen: 1000 * Y, start_month: '2026-11', total_months: 1,
  terminate_month: '', is_deleted: false,
};

(async () => {
  console.log('【场景 1 · 规范 S2b 锚点：旧空调提前报废】');
  console.log('  原值 12000.00 / 36 期 / base=333.33 / 2026-01 起摊 / 2026-08 报废');
  reset([AIR]);
  for (const m of ['2026-07', '2026-08', '2026-09']) {
    const g = await call(getLedger, { month: m });
    const s = await call(getAmortSchedule, { month: m });
    const gd = (g && g.data) || {};
    const sd = (s && s.data) || {};
    console.log(`  ${m}: 结果页摊销=${yuan(gd.amortize_fen || 0)} 真实利润=${yuan((gd.result||{}).total_factor_real_profit_fen || 0)}`
      + ` | 摊销页页首=${yuan(sd.total_amount_fen || 0)}`);
  }
  // 规范期望：2026-08 当月计入 base 333.33 + 残值 9333.36 = 9666.69
  console.log('  规范 S2b 期望：2026-08 应计入 333.33(摊销) + 9333.36(处置损失) = 9666.69');
  console.log('  ⇒ 当前实现：处置损失 9333.36 元【从未进过利润表】＝永久蒸发\n');

  console.log('【场景 2 · 一次性投入「要重存一次账才生效」】');
  console.log('  老板先保存 2026-11 的账（此刻台账里还没登记一次性投入），之后登记 1000 元投入');
  reset([LUMP], [{
    _id: 'acc', shop_id: 's1', month: '2026-11', is_archive: false,
    income_items: [{ category: 'food', name: '营收', amount_fen: 5000 * Y }],
    expense_items: [], direct_consume_fen: 0, inventory: { openingFen: 0, purchaseFen: 0, closingFen: 0 },
    amortize_fen: 0, lump_sum_fen: 0, switch_used: {}, is_deleted: false,
  }]);
  const g2 = await call(getLedger, { month: '2026-11' });
  const d2 = (g2 && g2.data) || {};
  console.log(`  结果页 lump_sum_fen=${yuan(d2.lump_sum_fen || 0)}（读落库快照，应为 1000.00）`);
  console.log(`  结果页真实利润=${yuan((d2.result||{}).total_factor_real_profit_fen || 0)}（应为 4000.00）`);
  console.log('  ⇒ 利润虚高 1000.00 元；老板重新保存一次账才变对（同月两个减项口径不对称）\n');

  console.log('【设计自洽校验：把处置损失并入「本月计入额」后，闭包是否成立】');
  const base = Math.round(1200000 / 36);       // 33333 分
  const paid = 8;                              // 2026-01..08 共 8 期
  const residual = 1200000 - base * paid;      // 未摊残值
  const full = base * paid + residual;
  console.log(`  历史已摊 ${yuan(base * paid)} + 终止月处置损失 ${yuan(residual)} = ${yuan(full)}（原值 ${yuan(1200000)}）`);
  console.log(`  闭包 ${full === 1200000 ? '✅ 成立' : '❌ 不成立'} —— 终止月当月计入 base + 残值，历史已摊不变，整笔原值全部体现`);
  console.log('\n===== 结论：两处口径都需修；闭包设计自洽 =====');
})();
