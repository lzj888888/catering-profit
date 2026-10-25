/**
 * R496 · 外卖口径真值代入探针（只跑本仓真实函数，不重写算法）
 * 目的：验证「照抄账单『商品总价』列（优惠前标价）」时，本仓口径算出的净额 vs 真实到手。
 * 真值锚点：
 *   美团 2026-08：商品总价(优惠前)3041.20 / 打包125.00 / 商家承担补贴806.29 / 平台服务费533.27 / 到手1826.64
 *   淘宝 2026-08：优惠前总额(商品+打包)6585.08 / 商家承担补贴2069.70 / 佣金158.71 / 配送577.02 / 到手3779.65
 */
const tw = require('../../../utils/takeaway.js');

function run(name, goods, pack, subsidy, commission, delivery, truth) {
  const subtotal = Number(tw.subtotalOf(goods, pack, subsidy));   // 本仓：三项相加 = 收入
  const net = subtotal - subsidy - commission - delivery;          // 费用侧：补贴自动带出 + 佣金 + 配送
  const correct = (goods + pack) - subsidy - commission - delivery; // 正确口径：收入不含补贴
  console.log(`\n===== ${name} =====`);
  console.log(`录入：商品总价=${goods} 打包=${pack} 商家承担补贴=${subsidy}`);
  console.log(`本仓收入(三框和 subtotalOf) = ${subtotal.toFixed(2)}`);
  console.log(`本仓净额 = 收入 − 补贴(费用带出) − 佣金配送 = ${net.toFixed(2)}`);
  console.log(`正确净额 = (商品+打包) − 补贴 − 佣金配送 = ${correct.toFixed(2)}`);
  console.log(`真实到手 = ${truth.toFixed(2)}`);
  console.log(`>> 本仓偏差 = ${(net - truth).toFixed(2)}   正确口径偏差 = ${(correct - truth).toFixed(2)}`);
  return { subtotal, net, correct, truth, diff: net - truth };
}

// 美团：商品总价照抄账单列（优惠前标价）
const mt = run('美团 2026-08（照抄账单「商品总价」列 = 优惠前）', 3041.20, 125.00, 806.29, 533.27, 0, 1826.64);
// 淘宝：优惠前总额 = 商品+打包 = 6585.08，补贴另计
const tb = run('淘宝闪购 2026-08（照抄账单「商品总价」列 = 优惠前）', 6585.08, 0, 2069.70, 158.71, 577.02, 3779.65);
// 对照：若「商品总价」填优惠后（= 优惠前 − 补贴），本仓才命中
const mt2 = run('美团（对照：商品总价填「优惠后」= 3041.20−806.29）', 3041.20 - 806.29, 125.00, 806.29, 533.27, 0, 1826.64);

console.log('\n===== 结论 =====');
console.log(`照抄账单「商品总价」列：美团虚高 ${mt.diff.toFixed(2)} / 淘宝虚高 ${tb.diff.toFixed(2)}`);
console.log(`且偏差恒等于「商家承担补贴额」：美团 ${(mt.diff - 806.29).toFixed(2)} / 淘宝 ${(tb.diff - 2069.70).toFixed(2)}`);
console.log(`只有把「商品总价」填成优惠后金额才命中（偏差 ${mt2.diff.toFixed(2)}）—— 但界面从未说明这一点`);
