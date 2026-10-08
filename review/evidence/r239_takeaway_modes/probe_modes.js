// review/evidence/r239_takeaway_modes/probe_modes.js
// 目的：用**生产引擎**（utils/takeawayDerive.js）实跑，回答「到手口径 vs 总额法口径 到底是不是同一个」。
// 铁律：数字全部来自引擎输出，不手算、不推演。
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const E = require(path.join(ROOT, 'utils/takeawayDerive.js'));

const fen = (y) => Math.round(y * 100);
const yuan = (f) => (f / 100).toFixed(2);

// 场景：一份外卖套餐单
// 商品总价 30.00、打包费 1.00、配送费(顾客承担) 3.00
// 佣金 20%（基数=商品总价，不含打包费）；配送服务费 3.00；配送补贴 2.00；推广费 1.50
// 商家承担补贴：用户券 4.00（商家承担）+ 商家满减 3.00（商家承担）
// 菜品成本 18.00（卡锁定标准成本）；包材 1.20
const order = {
  items: [{ card_id: 'C1', qty: 1 }],
  packs: [{ qty: 1, unit_price_fen: fen(1.2) }],
  params: {
    commission_mode: 'rate',
    commission_rate: 20,
    commission_min_fen: 0,
    commission_fixed_fen: 0,
    delivery_fee_fen: fen(3),
    delivery_subsidy_fen: fen(2),
    promo_fen: fen(1.5),
    pack_fee_fen: fen(1),
    delivery_customer_fen: fen(3),
    s_user: { amount_fen: fen(4), payer: 'merchant' },
    s_merchant: { amount_fen: fen(3), payer: 'merchant' },
  },
};
const lookup = (id) => (id === 'C1' ? { unit_cost_fen: fen(18), price_fen: fen(30) } : {});

const r = E.calcTakeawayOrder(order, lookup);
const c = r.cash, a = r.accrual;

console.log('===== 输入（同一组，两套口径共用）=====');
console.log('商品总价 goodsTotal      =', yuan(c.goods_total_fen));
console.log('打包费(收入) packFee      =', yuan(c.pack_fee_fen));
console.log('配送费(顾客承担)          =', yuan(c.delivery_customer_fen));
console.log('佣金 20%×商品总价         =', yuan(c.commission_fen), '  ← 基数不含打包费');
console.log('配送服务费 d              =', yuan(c.delivery_fee_fen));
console.log('配送补贴                  =', yuan(c.delivery_subsidy_fen));
console.log('推广费                    =', yuan(c.promo_fen));
console.log('商家承担补贴合计 s        =', yuan(c.subsidy_merchant_fen), '(用户券4.00+满减3.00)');
console.log('菜品成本 Cf               =', yuan(c.dish_cost_fen));
console.log('包材成本 Cp               =', yuan(c.pack_cost_fen));

console.log('\n===== 口径一 到手（现金视角）=====');
console.log('顾客支付 P   =', yuan(c.payment_fen));
console.log('商家实收 R   =', yuan(c.receipt_fen));
console.log('单均利润     =', yuan(c.profit_fen));
console.log('到手率 R÷P   =', c.receipt_rate + '%');

console.log('\n===== 口径二 总额法（会计视角）=====');
console.log('收入 revenue =', yuan(a.revenue_fen));
console.log('费用 expense =', yuan(a.expense_fen));
console.log('单均利润     =', yuan(a.profit_fen));

console.log('\n===== 差异 =====');
const diff = c.profit_fen - a.profit_fen;
console.log('现金利润 − 会计利润 =', yuan(diff), '元');
console.log('逐项拆解（差异只来自三项）：');
console.log('  + 配送费(顾客承担)  ', yuan(c.delivery_customer_fen));
console.log('  − 商家承担补贴 s    ', yuan(-c.subsidy_merchant_fen));
console.log('  + 推广费 promo      ', yuan(c.promo_fen));
const recomposed = c.delivery_customer_fen - c.subsidy_merchant_fen + c.promo_fen;
console.log('  三项合计            =', yuan(recomposed), '⇒ 与实测差', diff === recomposed ? '完全一致 ✅' : '不一致 ❌');

console.log('\n===== 对照：把这三项归零，两套利润是否相同？=====');
const z = JSON.parse(JSON.stringify(order));
z.params.delivery_customer_fen = 0;
z.params.s_user = { amount_fen: 0, payer: null };
z.params.s_merchant = { amount_fen: 0, payer: null };
z.params.promo_fen = 0;
const r0 = E.calcTakeawayOrder(z, lookup);
console.log('现金利润 =', yuan(r0.cash.profit_fen), ' 会计利润 =', yuan(r0.accrual.profit_fen),
  ' ⇒', r0.cash.profit_fen === r0.accrual.profit_fen ? '相同（此时两口径利润等价）' : '仍不同');

console.log('\n===== 边界：只填商品总价+佣金，其他全 0 =====');
const m = JSON.parse(JSON.stringify(order));
m.packs = [];
Object.keys(m.params).forEach((k) => { if (k !== 'commission_mode' && k !== 'commission_rate') m.params[k] = 0; });
m.params.s_user = { amount_fen: 0, payer: null };
m.params.s_merchant = { amount_fen: 0, payer: null };
const r1 = E.calcTakeawayOrder(m, lookup);
console.log('现金利润 =', yuan(r1.cash.profit_fen), ' 会计利润 =', yuan(r1.accrual.profit_fen),
  ' ⇒', r1.cash.profit_fen === r1.accrual.profit_fen ? '相同' : '不同');
