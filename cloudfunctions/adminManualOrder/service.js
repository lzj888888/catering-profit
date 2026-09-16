// cloudfunctions/adminManualOrder/service.js —— 批次 6 · 私域订单录入编排（注入式纯逻辑，可单测）
//
// 联动发权益（批次 6 §2.7）：标记「已支付」→ 自动按套餐天数更新 expire_at（source=manual）。
// expire_at 规则同 §2.3（未到期累加 / 过期从当日）。
// ⚠️ 不接触 wx-server-sdk；db 操作全部由调用方注入（deps）。
const { calcGrantExpireAt } = require('./adminAuth');

/**
 * 私域订单录入（幂等 + 留痕由调用方保证；本函数负责联动发权益与审计组装）。
 * @param {object} deps {
 *   nowMs, clientRequestId,
 *   readPlan: async (planId) => 套餐文档|null（含 days/name/price），
 *   readEntitlement: async (userId) => 文档|null,
 *   upsertEntitlement: async (doc) => void,
 *   insertOrder: async (doc) => void,
 *   checkIdempotent: async (key) => boolean,
 *   writeAudit: async (p) => void,
 * }
 * @param {object} input { userId, planId, amountFen, paidAt, remark, operatorId, shopId }
 * @returns {Promise<object>} { order_no, user_id, expire_at, source:'manual' }
 * @throws {{code:'INVALID_PARAM'}} plan 不存在；{{code:'ADMIN_OP_IDEMPOTENT'}} 幂等命中
 */
async function manualOrder(deps, input) {
  const now = deps.nowMs || Date.now();
  const userId = input.userId;
  const key = deps.clientRequestId ? `adm_order_${deps.clientRequestId}` : '';

  if (key && await deps.checkIdempotent(key)) {
    const e = new Error('重复提交');
    e.code = 'ADMIN_OP_IDEMPOTENT';
    throw e;
  }

  // 套餐（后端配置下发）
  const plan = await deps.readPlan(input.planId);
  if (!plan) {
    const e = new Error('plan_id 不存在');
    e.code = 'INVALID_PARAM';
    throw e;
  }
  const days = plan.days || 30;

  // 读当前权益 → 计算新 expire_at（§2.3 累加）
  const ent = await deps.readEntitlement(userId);
  const beforeExpireAt = ent ? (ent.expire_at || 0) : 0;
  const newExpireAt = calcGrantExpireAt(beforeExpireAt, now, days);

  // 订单号
  const orderNo = 'MO' + now.toString(36).toUpperCase() + Math.floor(Math.random() * 1e6).toString(36).toUpperCase();

  // 写订单（shop_payment_flow, status=paid, channel=manual）
  await deps.insertOrder({
    order_no: orderNo,
    user_id: userId,
    shop_id: input.shopId || '',
    amount: input.amountFen,
    plan_id: input.planId,
    plan_name: plan.name || '',
    status: 'paid',
    channel: 'manual',
    paid_at: input.paidAt || now,
    created_at: now,
    updated_at: now,
  });

  // 自动发权益（source=manual）
  await deps.upsertEntitlement({
    user_id: userId,
    expire_at: newExpireAt,
    source: 'manual',
    updated_at: now,
    _id: ent ? ent._id : '',
  });

  // 留痕（订单 + 权益变更）
  await deps.writeAudit({
    action: 'ADMIN_MANUAL_ORDER',
    operator_type: 'admin',
    operator_id: input.operatorId,
    shop_id: input.shopId || '',
    before_data: { user_id: userId, expire_at: beforeExpireAt },
    after_data: { order_no: orderNo, amount_fen: input.amountFen, plan_id: input.planId, expire_at: newExpireAt, source: 'manual' },
    remark: input.remark || '私域订单手动录入（自动发权益）',
    idempotency_key: key,
  });

  return { order_no: orderNo, user_id: userId, expire_at: newExpireAt, source: 'manual' };
}

module.exports = { manualOrder };