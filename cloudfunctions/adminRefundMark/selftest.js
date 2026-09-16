// cloudfunctions/adminRefundMark/selftest.js —— 批次 6 · 退款标记自测（权收数据留）
// 运行： node cloudfunctions/adminRefundMark/selftest.js
// 覆盖验收 7（标记退款 → 权益回收、数据保留、order_refund 有记录）。
const { refundMark } = require('./service');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const DAY = 24 * 3600 * 1000;

(async () => {
  // 假 DB：订单已支付，发权益时 before=0（新用户 +31 天）
  let order = {
    _id: 'ord_1', order_no: 'MO123', user_id: 'u1', shop_id: 's1',
    amount: 2590, plan_id: 'plan_basic_month', plan_name: '真实利润·月',
    status: 'paid', channel: 'manual', paid_at: NOW,
  };
  let entitlement = { _id: 'ent_1', user_id: 'u1', expire_at: NOW + 31 * DAY, source: 'manual' };
  let refunds = [];
  let audits = [];
  let idemKeys = [];
  const plans = [{ plan_id: 'plan_basic_month', days: 31 }];

  const deps = {
    nowMs: NOW,
    clientRequestId: 'req_ref_001',
    readOrder: async () => order,
    readAuditSnapshot: async () => ({ after_data: { order_no: 'MO123', before_expire_at: 0 } }),
    readPlan: async (id) => plans.find((p) => p.plan_id === id) || null,
    readEntitlement: async () => entitlement,
    markOrderRefunded: async () => { order.status = 'refunded'; },
    updateEntitlement: async (id, expireAt, source) => { entitlement.expire_at = expireAt; entitlement.source = source; },
    insertRefund: async (doc) => { refunds.push(doc); },
    checkIdempotent: async (key) => idemKeys.indexOf(key) >= 0,
    writeAudit: async (p) => { audits.push(p); idemKeys.push(p.idempotency_key || ''); },
  };

  const r = await refundMark(deps, { orderId: 'MO123', reason: '用户申请退款', operatorId: 'adm_op' });

  // 1) 权益回收：退款生效前的状态 = 发权益前（0）→ 回退至 0
  check('退款后 expire_at 回退至发权益前状态(0)', r.expire_at_after_refund === 0 && entitlement.expire_at === 0, `=${entitlement.expire_at}`);
  // 2) 订单状态标记 refunded（数据保留，不删）
  check('订单标记 refunded（不删除）', order.status === 'refunded' && !!order.order_no && !!order.user_id);
  // 3) order_refund 有记录（第 8 章字段）
  check('order_refund 写入（order_id/user_id/amount/reason/operator）',
    refunds.length === 1 && refunds[0].order_id === 'MO123' && refunds[0].user_id === 'u1' && refunds[0].amount === 2590 && refunds[0].operator === 'adm_op');
  check('refund_at 服务端 UTC', refunds[0].refund_at === NOW);
  // 4) 审计 action=ADMIN_REFUND 前后值
  check('审计 action=ADMIN_REFUND + 前后值', audits[0].action === 'ADMIN_REFUND' && audits[0].before_data.expire_at === NOW + 31 * DAY && audits[0].after_data.expire_at === 0 && audits[0].after_data.status === 'refunded');
  check('退款原因入审计', audits[0].remark === '用户申请退款' && audits[0].operator_id === 'adm_op');

  // 幂等：重复提交
  const beforeRefunds = refunds.length;
  let threw = false;
  try { await refundMark(deps, { orderId: 'MO123', reason: 'dup', operatorId: 'adm_op' }); } catch (e) { threw = e.code === 'ADMIN_OP_IDEMPOTENT'; }
  check('重复退款 → ADMIN_OP_IDEMPOTENT', threw);
  check('重复退款不重复写 refund', refunds.length === beforeRefunds);

  // 已退款订单再退 → REFUND_NOT_ALLOWED
  let denied = false;
  try { await refundMark(Object.assign({}, deps, { clientRequestId: 'req_ref_002' }), { orderId: 'MO123', reason: 'again', operatorId: 'adm_op' }); } catch (e) { denied = e.code === 'REFUND_NOT_ALLOWED'; }
  check('已退款订单再退 → REFUND_NOT_ALLOWED', denied);

  // 订单不存在 → ORDER_NOT_FOUND
  let notFound = false;
  try {
    await refundMark(Object.assign({}, deps, { clientRequestId: 'req_ref_003', readOrder: async () => null }), { orderId: 'NOPE', reason: 'x', operatorId: 'adm_op' });
  } catch (e) { notFound = e.code === 'ORDER_NOT_FOUND'; }
  check('订单不存在 → ORDER_NOT_FOUND', notFound);

  console.log(`\n==== adminRefundMark 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();