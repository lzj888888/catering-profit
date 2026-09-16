// cloudfunctions/payCreateOrder/selftest.js —— 批次 5 · 订单创建自测
// 运行： node cloudfunctions/payCreateOrder/selftest.js
// ⚠️ 当前阶段 enable_real_payment=false：生成 pending 订单、pay_params=null（前端提示联系客服）。
const { createOrder, genOrderNo, ENABLE_REAL_PAYMENT } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 订单生成 =====');
const o = createOrder({ userId: 'u1', planId: 'plan_basic_month', planName: '真实利润·月', priceFen: 2590, channel: 'wechat' });
check('生成订单号（PO 前缀）', /^PO/.test(o.order_no), o.order_no);
check('金额=2590 分（整数）', o.amount_fen === 2590);
check('plan_id/plan_name 原样携带', o.plan_id === 'plan_basic_month' && o.plan_name === '真实利润·月');
check('status=pending', o.status === 'pending');
check('enable_real_payment=false（私域阶段）', o.enable_real_payment === false && ENABLE_REAL_PAYMENT === false);
check('pay_params=null（无拉起参数，前端提示联系客服）', o.pay_params === null);
check('订单号唯一性（两次不同）', genOrderNo('PO') !== genOrderNo('PO'));

console.log('===== 入参校验 =====');
check('合法', validateInput({ shop_id: 's1', plan_id: 'p1' }).error === null);
check('缺 plan_id → INVALID_PARAM', validateInput({ shop_id: 's1' }).error === 'INVALID_PARAM');
check('缺 shop_id → INVALID_PARAM', validateInput({ plan_id: 'p1' }).error === 'INVALID_PARAM');

console.log(`\n==== payCreateOrder 批次 5 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);