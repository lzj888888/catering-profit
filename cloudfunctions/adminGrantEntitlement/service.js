// cloudfunctions/adminGrantEntitlement/service.js —— 批次 6 · 手动调权编排（注入式纯逻辑，可单测）
//
// 核心规则（批次 6 §2.3，对齐 v1.4 §10.10）：
//   · 未到期 → 新 expire_at = 原 expire_at + days（累加，不覆盖）
//   · 已过期/无记录 → 新 expire_at = 操作当日 + days（不顺延原到期）
// ⚠️ 不接触 wx-server-sdk；db 操作全部由调用方注入（deps），便于纯 node 单测。
const { calcGrantExpireAt } = require('./adminAuth');

/**
 * 手动调权（幂等 + 留痕由调用方保证；本函数负责规则与审计数据组装）。
 * @param {object} deps {
 *   nowMs, clientRequestId,
 *   readEntitlement: async (userId) => 文档|null,
 *   upsertEntitlement: async (doc) => void,   // 有 _id → update；无 → add
 *   checkIdempotent: async (key) => boolean,  // true=已处理过
 *   writeAudit: async (p) => void,
 * }
 * @param {object} input { userId, days, reason, operatorId }
 * @returns {Promise<object>} { user_id, expire_at, before_expire_at, source:'manual' }
 * @throws {{code:'ADMIN_OP_IDEMPOTENT'}} 幂等命中
 */
async function grantEntitlement(deps, input) {
  const now = deps.nowMs || Date.now();
  const userId = input.userId;
  const days = input.days;
  const reason = (input.reason || '').trim();
  const key = deps.clientRequestId ? `adm_grant_${deps.clientRequestId}` : '';

  // 幂等预检
  if (key && await deps.checkIdempotent(key)) {
    const e = new Error('重复提交');
    e.code = 'ADMIN_OP_IDEMPOTENT';
    throw e;
  }

  // 读当前权益
  const ent = await deps.readEntitlement(userId);
  const beforeExpireAt = ent ? (ent.expire_at || 0) : 0;

  // 计算新 expire_at（§2.3）
  const newExpireAt = calcGrantExpireAt(beforeExpireAt, now, days);

  // upsert
  await deps.upsertEntitlement({
    user_id: userId,
    expire_at: newExpireAt,
    source: 'manual',
    updated_at: now,
    _id: ent ? ent._id : '',
  });

  // 留痕（前后值/原因/操作人）
  await deps.writeAudit({
    action: 'ADMIN_GRANT_ENTITLEMENT',
    operator_type: 'admin',
    operator_id: input.operatorId,
    shop_id: '',
    before_data: { user_id: userId, expire_at: beforeExpireAt },
    after_data: { user_id: userId, expire_at: newExpireAt, days, source: 'manual' },
    remark: reason,
    idempotency_key: key,
  });

  return { user_id: userId, expire_at: newExpireAt, before_expire_at: beforeExpireAt, source: 'manual' };
}

module.exports = { grantEntitlement };