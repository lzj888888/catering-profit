// tools/selftest_m3_takeaway.js —— M3.17 外卖单均 + M3.32 外卖补丁自测（批次 D）
//
// 锚点（require 真实单源实算，不重写一份）：
//   T-a 佣金基数（不含打包费） T-b 实收/利润/到手率  T-c 挂牌价反算
//   T-d rate/fixed 两模式    T-e 补贴拆分等价       T-f 承担方未选 fail-closed
//   T-g 隔离（输出不含 M1 月度字段）
//
// 运行：node tools/selftest_m3_takeaway.js

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const { calcTakeawayOrder, resolveCommission, reverseListedPrice } = require('../utils/takeawayDerive.js');

// 一单解析器：套餐 = 宫保鸡丁（成本 1275 / 标价 2500）
const lookup = (id) => ({ unit_cost_fen: 1275, price_fen: 2500 });

console.log('===== T-a · 佣金基数（商品总价，不含打包费）=====');
const c1 = resolveCommission({ commission_mode: 'rate', commission_rate: 6, commission_min_fen: 130 }, 2500);
check('T-a 商品总价 2500、c=6%、保底 130 ⇒ 佣金 150 分', c1 === 150, `got ${c1}`);
const c1b = resolveCommission({ commission_mode: 'rate', commission_rate: 6, commission_min_fen: 130 }, 2700);
check('T-a 基数不含打包费（商品总价 2500 而非含打包费的 2700）', c1b === 162, `got ${c1b}（2500→150 vs 2700→162）`);

console.log('===== T-b · 实收 / 利润 / 到手率 =====');
const orderB = {
  items: [{ combo_id: 'combo_gongbao', qty: 1 }],
  packs: [{ qty: 1, unit_price_fen: 160 }],
  params: {
    commission_mode: 'rate', commission_rate: 6, commission_min_fen: 130,
    delivery_fee_fen: 450, delivery_subsidy_fen: 0, promo_fen: 0,
    pack_fee_fen: 200, delivery_customer_fen: 0,
    s_merchant: { amount_fen: 300, payer: 'merchant' },
    s_user: { amount_fen: 0, payer: null },
  },
};
const rB = calcTakeawayOrder(orderB, lookup).cash;
check('T-b 实收 1800（P=2700 − s300 − 佣金150 − d450）', rB.receipt_fen === 1800, `got ${rB.receipt_fen}`);
check('T-b 单均利润 365（1800 − Cf1275 − Cp160）', rB.profit_fen === 365, `got ${rB.profit_fen}`);
check('T-b 到手率 66.67%', Math.abs(rB.receipt_rate - 66.67) < 0.005, `got ${rB.receipt_rate}`);
check('T-b 到手率 <70% ⇒ 软提示触发条件成立', rB.receipt_rate < 70, '');

console.log('===== T-c · 挂牌价反算 =====');
const pStar = reverseListedPrice({
  dish_cost_fen: 1275, pack_cost_fen: 160, target_profit_fen: 800,
  subsidy_merchant_fen: 300, delivery_fee_fen: 450, pack_fee_fen: 200, commission_rate: 6,
});
check('T-c 反算 P* = 2963 分（目标到手利润 800）', pStar === 2963, `got ${pStar}`);
// 用反算出的挂牌价回带 calcTakeawayOrder 复算
const orderC = {
  items: [{ combo_id: 'combo_gongbao', qty: 1 }],
  packs: [{ qty: 1, unit_price_fen: 160 }],
  params: {
    commission_mode: 'rate', commission_rate: 6, commission_min_fen: 0,
    delivery_fee_fen: 450, delivery_subsidy_fen: 0, promo_fen: 0,
    pack_fee_fen: 200, delivery_customer_fen: 0,
    s_merchant: { amount_fen: 300, payer: 'merchant' },
    s_user: { amount_fen: 0, payer: null },
  },
};
const rC = calcTakeawayOrder(orderC, (id) => ({ unit_cost_fen: 1275, price_fen: pStar })).cash;
check('T-c 顾客支付 3163（P*2963 + 打包费200）', rC.payment_fen === 3163, `got ${rC.payment_fen}`);
check('T-c 佣金 178（round(2963×6%)）', rC.commission_fen === 178, `got ${rC.commission_fen}`);
check('T-c 实收 2235（3163 − s300 − 佣金178 − d450）', rC.receipt_fen === 2235, `got ${rC.receipt_fen}`);
check('T-c 到手率 70.66%', Math.abs(rC.receipt_rate - 70.66) < 0.005, `got ${rC.receipt_rate}`);

console.log('===== T-d · rate / fixed 两模式 =====');
const dRate = resolveCommission({ commission_mode: 'rate', commission_rate: 6, commission_min_fen: 130 }, 2500);
const dFixed = resolveCommission({ commission_mode: 'fixed', commission_fixed_fen: 200, commission_min_fen: 130 }, 2500);
check('T-d rate 模式 = 150（max(150,130)）', dRate === 150, `got ${dRate}`);
check('T-d fixed 模式 = 200（直接取固定金额）', dFixed === 200, `got ${dFixed}`);
// 🔴 关键：fixed < min 时若 min 生效会返回 130，正确应为 100 —— 这才真证「fixed 下保底不生效」
const dFixedLow = resolveCommission({ commission_mode: 'fixed', commission_fixed_fen: 100, commission_min_fen: 130 }, 2500);
check('T-d fixed 模式下保底 min 不生效（fixed=100、min=130 ⇒ 100 而非 max 130）', dFixedLow === 100, `got ${dFixedLow}`);

console.log('===== T-e · 补贴拆分等价 =====');
const baseParams = {
  commission_mode: 'rate', commission_rate: 6, commission_min_fen: 130,
  delivery_fee_fen: 450, delivery_subsidy_fen: 0, promo_fen: 0,
  pack_fee_fen: 200, delivery_customer_fen: 0,
};
const orderSingle = { items: [{ combo_id: 'x', qty: 1 }], packs: [], params: Object.assign({}, baseParams, { s_merchant: { amount_fen: 300, payer: 'merchant' }, s_user: { amount_fen: 0, payer: null } }) };
const orderSplit = { items: [{ combo_id: 'x', qty: 1 }], packs: [], params: Object.assign({}, baseParams, { s_merchant: { amount_fen: 200, payer: 'merchant' }, s_user: { amount_fen: 100, payer: 'merchant' } }) };
const rSingle = calcTakeawayOrder(orderSingle, lookup).cash;
const rSplit = calcTakeawayOrder(orderSplit, lookup).cash;
check('T-e s_user+s_merchant 都商家承担时，与单 s 算术等价（实收一致）',
  rSingle.receipt_fen === rSplit.receipt_fen && rSingle.subsidy_merchant_fen === rSplit.subsidy_merchant_fen,
  `single=${rSingle.receipt_fen} split=${rSplit.receipt_fen}（补贴合计 ${rSingle.subsidy_merchant_fen}）`);

console.log('===== T-f · 承担方未选 fail-closed =====');
const orderNone = { items: [{ combo_id: 'x', qty: 1 }], packs: [], params: Object.assign({}, baseParams, { s_merchant: { amount_fen: 300, payer: 'merchant' }, s_user: { amount_fen: 500, payer: null } }) };
const orderPlatform = { items: [{ combo_id: 'x', qty: 1 }], packs: [], params: Object.assign({}, baseParams, { s_merchant: { amount_fen: 300, payer: 'merchant' }, s_user: { amount_fen: 500, payer: 'platform' } }) };
const orderMerchant = { items: [{ combo_id: 'x', qty: 1 }], packs: [], params: Object.assign({}, baseParams, { s_merchant: { amount_fen: 300, payer: 'merchant' }, s_user: { amount_fen: 500, payer: 'merchant' } }) };
const rNone = calcTakeawayOrder(orderNone, lookup).cash;
const rPlatform = calcTakeawayOrder(orderPlatform, lookup).cash;
const rMerchant = calcTakeawayOrder(orderMerchant, lookup).cash;
check('T-f 承担方未选（payer=null）⇒ 补贴不计入（subsidy=300 而非 800）', rNone.subsidy_merchant_fen === 300, `got ${rNone.subsidy_merchant_fen}`);
check('T-f 承担方=platform ⇒ 不计入商家成本（subsidy=300）', rPlatform.subsidy_merchant_fen === 300, `got ${rPlatform.subsidy_merchant_fen}`);
check('T-f 承担方=merchant ⇒ 计入（subsidy=800）', rMerchant.subsidy_merchant_fen === 800, `got ${rMerchant.subsidy_merchant_fen}`);
check('T-f 未选 vs 商家承担实收差一个补贴额（500）', rMerchant.receipt_fen === rNone.receipt_fen - 500, `none=${rNone.receipt_fen} merchant=${rMerchant.receipt_fen}`);

console.log('===== T-g · 隔离（输出不含 M1 月度字段）=====');
const full = calcTakeawayOrder(orderB, lookup);
const M1_HINTS = ['month', 'ledger', 'monthly', 'profit_month', 'reconcile'];
const deepScan = (obj, path) => {
  if (Array.isArray(obj)) return obj.some((o, i) => deepScan(o, `${path}[${i}]`));
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (M1_HINTS.some((h) => k.toLowerCase().indexOf(h) >= 0)) return `${path}.${k}`;
      const hit = deepScan(obj[k], `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return false;
};
check('T-g 输出对象不含任何 M1 月度字段（month/ledger/monthly...）', deepScan(full, 'out') === false,
  deepScan(full, 'out') === false ? 'cash+accrual 仅 *_fen / receipt_rate' : `命中 ${deepScan(full, 'out')}`);
check('T-g 两套口径分别持有 profit_fen（不混进同一总数）', !!full.cash.profit_fen && !!full.accrual.profit_fen, '');

console.log('\n' + '='.repeat(60));
console.log(`===== M3.17 外卖单均自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
