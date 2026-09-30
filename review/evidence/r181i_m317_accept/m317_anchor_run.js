// m317_anchor_run.js —— M3.17 锚点**独立复算**（不采信 InsCode 自述）
//
// 做法：require **生产单源** utils/takeawayDerive.js，喂规范权威输入，
//       与"我方从 `开发规范v1.1` §M3.17「复算锚点」逐条手推"的期望值比对。
// 期望值一律**先手推、后写死**（推导过程见下），不是从被测模块读回来的。
//
// 手推（`B-a 佣金`）：商品总价 2500 × 6% = 150；保底 130 ⇒ max(150,130) = 150
// 手推（`B-a 实收/利润`）：P=2700 拆 商品总价 2500 + 打包费 200
//     R = P − s − 佣金 − d − 配送补贴 = 2700 − 300 − 150 − 450 − 0 = 1800
//     Cf = R − Cp − 利润 = 1800 − 160 − 365 = 1275（与 M3.16 套餐锚点同值，非巧合）
//     到手率 = 1800 / 2700 = 66.6667% ⇒ round2 = 66.67%
// 手推（`B-b 反算`）：P* = (Cf + Cp + M + s + d + 配送费(顾客) − 打包费) ÷ (1 − c)
//                    = (1275 + 160 + 800 + 300 + 450 + 0 − 200) ÷ 0.94
//                    = 2785 / 0.94 = 2962.766 ⇒ round = 2963
//     校验：顾客支付 = 2963 + 200 = 3163；佣金 = 2963 × 6% = 177.78 ⇒ 178
//           实收 = 3163 − 300 − 178 − 450 = 2235；到手率 = 2235 / 3163 = 70.66%
//           利润 = 2235 − 1275 − 160 = 800 ✓（回到目标值）
// 手推（总额法）：规范原文 —— 收入 = 商品总价 + 打包费 + 商家活动补贴；
//     费用 = 佣金 + 配送服务费 + 补贴 + 推广（"补贴"含配送补贴与商家活动补贴）
//     收入 = 2500 + 200 + 300 = 3000；费用 = 150(佣金) + 450(配送服务费) + 0(配送补贴) + 300(商家补贴) + 0(推广) = 900
//     总额法利润 = 3000 − 900 − 1275 − 160 = 665
//     与到手口径差 = 665 − 365 = 300 = s
//     （到手口径把 s 从 P 里扣一次；总额法 s 进收入一次、进费用一次 ⇒ 净 0 ⇒ 差额恰为 s）
//     ⚠️ 首版误算成「费用 600 / 利润 965 / 差 2s」——那是**漏把 s 计入费用**导致的重复扣减，已按规范原文更正。

'use strict';
const path = require('path');
const D = require(path.join(__dirname, '..', '..', '..', 'utils', 'takeawayDerive.js'));

let pass = 0, fail = 0;
const eq = (name, got, want, note) => {
  const okA = got === want;
  if (okA) { pass++; console.log(`  ✅ ${name}  (got ${got}${note ? ' · ' + note : ''})`); }
  else { fail++; console.log(`  ❌ ${name}  (got ${JSON.stringify(got)} ≠ want ${JSON.stringify(want)}${note ? ' · ' + note : ''})`); }
};

// 解析器：菜品卡 成本 1275 分 / 标价 2500 分；包材 单价 80 分 × 2 = 160 分
const LOOKUP = (id) => ({ 'cardA': { unit_cost_fen: 1275, price_fen: 2500 },
                          'packX': { unit_cost_fen: 80, price_fen: 0 } }[id] || {});

const baseParams = {
  commission_mode: 'rate', commission_rate: 6, commission_min_fen: 130,
  delivery_fee_fen: 450, delivery_subsidy_fen: 0, promo_fen: 0,
  pack_fee_fen: 200, delivery_customer_fen: 0,
  s_merchant: { amount_fen: 300, payer: 'merchant' },
};
const baseOrder = {
  items: [{ card_id: 'cardA', qty: 1 }],
  packs: [{ material_id: 'packX', qty: 2 }],
  params: baseParams,
};

console.log('===== A · 佣金（rate，基数不含打包费）=====');
// 商品总价 2500；打包费 200 在 P 里但**不得**进佣金基数
eq('A1 B-a 佣金 = 150（商品总价 2500 × 6%）', D.resolveCommission(baseParams, 2500), 150, '基数不含打包费');
eq('A2 误用「含打包费的支付额」会得 162 ⇒ 证明差异真实存在', D.resolveCommission(baseParams, 2700), 162, '反证：162 ≠ 150');
eq('A3 保底生效（率算 50 < 保底 130）', D.resolveCommission({ commission_rate: 2, commission_min_fen: 130 }, 2500), 130, 'max(50,130)');

console.log('===== B · 一单双口径（B-a 实收/利润）=====');
const r = D.calcTakeawayOrder(baseOrder, LOOKUP);
eq('B1 商品总价 = 2500', r.cash.goods_total_fen, 2500);
eq('B2 顾客支付 P = 2700（2500 + 打包费 200）', r.cash.payment_fen, 2700);
eq('B3 佣金 = 150', r.cash.commission_fen, 150);
eq('B4 菜品成本 Cf = 1275', r.cash.dish_cost_fen, 1275);
eq('B5 包材成本 Cp = 160（80 × 2）', r.cash.pack_cost_fen, 160);
eq('B6 商家实收 R = 1800', r.cash.receipt_fen, 1800, 'P − s − 佣金 − d');
eq('B7 单均理论利润 = 365', r.cash.profit_fen, 365, 'R − Cf − Cp');
eq('B8 到手率 = 66.67%（<70 ⇒ 应触发软提示）', r.cash.receipt_rate, 66.67);

console.log('===== C · 总额法口径（与 M1 对得上）=====');
eq('C1 收入 = 3000（商品总价 + 打包费 + 商家补贴）', r.accrual.revenue_fen, 3000);
eq('C2 费用 = 900（佣金 150 + 配送服务费 450 + 商家补贴 300 + 配送补贴 0 + 推广 0）', r.accrual.expense_fen, 900);
eq('C3 总额法利润 = 665', r.accrual.profit_fen, 665);
eq('C4 两口径利润差 = s = 300（到手扣 s 一次，总额法两侧各一次⇒净 0）', r.accrual.profit_fen - r.cash.profit_fen, 300);
eq('C5 两套口径各自独立持 profit_fen（不混进同一总数）',
   Object.prototype.hasOwnProperty.call(r.cash, 'profit_fen') && Object.prototype.hasOwnProperty.call(r.accrual, 'profit_fen'), true);

console.log('===== D · 挂牌价反算（B-b）=====');
const rev = D.reverseListedPrice({
  dish_cost_fen: 1275, pack_cost_fen: 160, target_profit_fen: 800,
  subsidy_merchant_fen: 300, delivery_fee_fen: 450, delivery_customer_fen: 0,
  pack_fee_fen: 200, commission_rate: 6,
});
eq('D1 B-b 挂牌总价 P* = 2963', rev, 2963);
// 用反算出的 P* 回灌一遍，验证「顾客支付 3163 / 佣金 178 / 实收 2235 / 到手率 70.66% / 利润回到 800」
const back = D.calcTakeawayOrder({
  items: [{ card_id: 'cardA', qty: 1 }], packs: [{ material_id: 'packX', qty: 2 }],
  params: Object.assign({}, baseParams),
}, (id) => (id === 'cardA' ? { unit_cost_fen: 1275, price_fen: rev } : { unit_cost_fen: 80, price_fen: 0 }));
eq('D2 回灌 顾客支付 = 3163', back.cash.payment_fen, 3163);
eq('D3 回灌 佣金 = 178', back.cash.commission_fen, 178);
eq('D4 回灌 实收 = 2235', back.cash.receipt_fen, 2235);
eq('D5 回灌 到手率 = 70.66%', back.cash.receipt_rate, 70.66);
eq('D6 回灌 利润回到目标 800（反算自洽闭环）', back.cash.profit_fen, 800);
eq('D7 c ≥ 100 ⇒ 返回 0（不产生负分母/无穷）', D.reverseListedPrice({ commission_rate: 100 }), 0);

console.log('===== E · M3.32 补丁：fixed 佣金 / 保底不生效 / 补贴拆行 =====');
eq('E1 fixed 模式直接取金额 200', D.resolveCommission({ commission_mode: 'fixed', commission_fixed_fen: 200 }, 2500), 200);
eq('E2 🔴 fixed 下保底不生效（fixed=100, min=130 ⇒ 100）',
   D.resolveCommission({ commission_mode: 'fixed', commission_fixed_fen: 100, commission_min_fen: 130 }, 2500), 100);
eq('E3 补贴承担方=platform ⇒ 不计入商家成本（R=1800 不变）',
   D.calcTakeawayOrder(Object.assign({}, baseOrder, { params: Object.assign({}, baseParams, { s_merchant: { amount_fen: 300, payer: 'platform' } }) }), LOOKUP).cash.receipt_fen, 2100,
   '不扣 300 ⇒ 1800 + 300');
eq('E4 承担方未选（无 payer）⇒ fail-closed 不计入',
   D.calcTakeawayOrder(Object.assign({}, baseOrder, { params: Object.assign({}, baseParams, { s_merchant: { amount_fen: 300 } }) }), LOOKUP).cash.receipt_fen, 2100);
eq('E5 s_user 承担方=merchant 时计入（1800 恢复）',
   D.calcTakeawayOrder(Object.assign({}, baseOrder, { params: Object.assign({}, baseParams, { s_user: { amount_fen: 300, payer: 'merchant' }, s_merchant: null }) }), LOOKUP).cash.receipt_fen, 1800);

console.log('===== F · 隔离（红线 ⑥：外卖不得进 M1）=====');
// 口径与生产守卫对齐（tools/selftest_m3_takeaway.js 的 M1_HINTS）：
//   ['month','ledger','monthly','profit_month','reconcile']
// ⚠️ 首版把 `expense_`/`income_dine` 也当禁词 ⇒ **误报**：accrual 自身的 `expense_fen`
//    是外卖口径的费用合计，不是 M1 月度字段。已收窄到生产守卫的同一词表。
const M1_HINTS = ['month', 'ledger', 'monthly', 'profit_month', 'reconcile'];
const banned = (k) => M1_HINTS.some((h) => k.toLowerCase().includes(h));
const keysCash = Object.keys(r.cash), keysAcc = Object.keys(r.accrual);
eq('F1 cash 输出无 M1 月度字段', keysCash.filter(banned).length, 0, keysCash.join(','));
eq('F2 accrual 输出无 M1 月度字段', keysAcc.filter(banned).length, 0, keysAcc.join(','));
eq('F3 反恒真：词表确实能命中 M1 字段名（证 F1/F2 非空跑）',
   ['monthly_profit', 'income_ledger', 'reconcile_at'].filter(banned).length, 3);

console.log('\n' + '='.repeat(60));
console.log(`===== M3.17 锚点独立复算：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
