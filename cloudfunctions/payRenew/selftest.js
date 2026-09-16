// cloudfunctions/payRenew/selftest.js —— 批次 5 · 续费订单生成自测
// 运行： node cloudfunctions/payRenew/selftest.js
// ⚠️ 续费 = 再次创建订单；有效期**累加**由 payCallback 的 calcNewExpireAt 完成（本函数只管下单）。
const { createOrder, genOrderNo, ENABLE_REAL_PAYMENT } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 续费订单生成 =====');
const o = createOrder({ userId: 'u1', planId: 'plan_basic_year', planName: '真实利润·年', priceFen: 19900, channel: 'wechat' });
check('生成续费订单号（PR 前缀）', /^PR/.test(o.order_no), o.order_no);
check('金额=19900 分', o.amount_fen === 19900);
check('plan 携带 + status=pending', o.plan_id === 'plan_basic_year' && o.status === 'pending');
check('enable_real_payment=false', o.enable_real_payment === false && ENABLE_REAL_PAYMENT === false);
check('pay_params=null', o.pay_params === null);

console.log('===== 入参校验 =====');
check('合法（含可选 shop_id）', validateInput({ plan_id: 'p1', shop_id: 's1' }).error === null);
check('缺 plan_id → INVALID_PARAM', validateInput({}).error === 'INVALID_PARAM');

console.log(`\n==== payRenew 批次 5 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);