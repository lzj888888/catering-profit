// cloudfunctions/payOrderList/selftest.js —— 批次 5 · 订单记录页数据源映射自测
// 运行： node cloudfunctions/payOrderList/selftest.js
const { flowToOut } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const doc = { order_no: 'PO123', plan_name: '真实利润·月', amount: 2590, channel: 'wechat', status: 'paid', paid_at: 1726000000000, created_at: 1725900000000 };
const out = flowToOut(doc);
check('订单号/套餐名 映射', out.order_no === 'PO123' && out.plan_name === '真实利润·月');
check('金额=2590 分整数', out.amount_fen === 2590 && Number.isInteger(out.amount_fen));
check('渠道/状态/生效期 映射', out.channel === 'wechat' && out.status === 'paid' && out.paid_at === 1726000000000);
check('缺省字段回落（status 默认 pending）', flowToOut({}).status === 'pending' && flowToOut({}).amount_fen === 0);

console.log('===== 入参校验 =====');
check('合法', validateInput({ shop_id: 's1' }).error === null);
check('缺 shop_id → INVALID_PARAM', validateInput({}).error === 'INVALID_PARAM');

console.log(`\n==== payOrderList 批次 5 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);