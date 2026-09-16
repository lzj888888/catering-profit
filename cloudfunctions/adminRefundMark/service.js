// cloudfunctions/adminRefundMark/service.js —— 批次 6 · 退款标记编排（注入式纯逻辑，可单测）
//
// 「权收数据留」（批次 6 §2.6）：标记退款 → 权益回退至退款生效前状态；订单/数据/记录**不删**。
// 回退策略：优先用该订单发权益时的审计快照（before_expire_at）；缺失则「当前 − 套餐天数」封底 0。
// ⚠️ 不接触 wx-server-sdk；db 操作全部由调用方注入（deps）。
const DAY_MS = 24 * 3600 * 1000;

/**
 * @param {object} deps {
 *   nowMs, clientRequestId,
 *   readOrder: async (orderNo) => 订单文档|null,
 *   readAuditSnapshot: async (orderNo) => 发权益审计文档|null（after_data.order_no 匹配）,
 *   readPlan: async (planId) => 套餐文档|null,
 *   readEntitlement: async (userId) => 文档|null,
 *   markOrderRefunded: async (orderDocId) => void,
 *   updateEntitlement: async (docId, expireAt, source) => void,
 *   insertRefund: async (doc) => void,
 *   checkIdempotent: async (key) => boolean,
 *   writeAudit: async (p) => void,
 * }
 * @param {object} input { orderId, reason, operatorId, shopId }
 * @returns {Promise<object>} { ok:true, order_id, expire_at_after_refund }
 * @throws {{code:'ORDER_NOT_FOUND'|'REFUND_NOT_ALLOWED'|'ADMIN_OP_IDEMPOTENT'}}
 */
async function refundMark(deps, input) {
  const now = deps.nowMs || Date.now();
  const key = deps.clientRequestId ? `adm_refund_${deps.clientRequestId}` : '';

  if (key && await deps.checkIdempotent(key)) {
    const e = new Error('重复提交');
    e.code = 'ADMIN_OP_IDEMPOTENT';
    throw e;
  }

  // 定位订单
  const order = await deps.readOrder(input.orderId);
  if (!order) {
    const e = new Error('订单不存在');
    e.code = 'ORDER_NOT_FOUND';
    throw e;
  }
  if (order.status === 'refunded') {
    const e = new Error('订单已退款');
    e.code = 'REFUND_NOT_ALLOWED';
    throw e;
  }

  // 查发权益审计快照（before_expire_at）
  const snap = await deps.readAuditSnapshot(input.orderId);
  const snapBefore = snap && snap.after_data && snap.after_data.before_expire_at;

  const userId = order.user_id || '';
  const ent = await deps.readEntitlement(userId);
  const currentExpireAt = ent ? (ent.expire_at || 0) : 0;

  // 计算回退后的 expire_at
  let refundedExpireAt;
  if (snapBefore !== undefined && snapBefore !== null && Number(snapBefore) >= 0) {
    // 用发放时的精确前值（允许前值=0，表示该订单发放前无权益 → 退回到无权益）
    refundedExpireAt = currentExpireAt >= Number(snapBefore) ? Number(snapBefore) : Math.max(0, currentExpireAt);
  } else {
    const plan = await deps.readPlan(order.plan_id);
    const days = plan ? (plan.days || 30) : 30;
    refundedExpireAt = Math.max(0, currentExpireAt - days * DAY_MS);
  }

  // 标记订单已退款 + 回收权益（数据保留，不做删除）
  await deps.markOrderRefunded(order._id || order.id);
  if (ent) {
    await deps.updateEntitlement(ent._id || ent.id, refundedExpireAt, ent.source || 'manual');
  }

  // 写 order_refund（第 8 章字段）
  await deps.insertRefund({
    order_id: input.orderId,
    user_id: userId,
    shop_id: order.shop_id || '',
    amount: order.amount != null ? order.amount : 0,
    refund_at: now,
    reason: (input.reason || '').trim(),
    operator: input.operatorId,
  });

  // 留痕（action=ADMIN_REFUND，前后值 + 原因）
  await deps.writeAudit({
    action: 'ADMIN_REFUND',
    operator_type: 'admin',
    operator_id: input.operatorId,
    shop_id: order.shop_id || '',
    before_data: { order_no: input.orderId, expire_at: currentExpireAt, status: order.status },
    after_data: { order_no: input.orderId, expire_at: refundedExpireAt, status: 'refunded', refund_at: now },
    remark: (input.reason || '').trim(),
    idempotency_key: key,
  });

  return { ok: true, order_id: input.orderId, expire_at_after_refund: refundedExpireAt };
}

module.exports = { refundMark, DAY_MS };