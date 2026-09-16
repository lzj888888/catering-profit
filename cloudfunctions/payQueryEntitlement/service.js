// cloudfunctions/payQueryEntitlement/service.js —— 批次 5 · 权益出参映射（纯函数）
// 权限判定解耦铁律（批次 5 §2.4）：前端**只读 expire_at 一个字段**判定；
// 空/过期 = 免费档；有效 = 付费档。不读 plan_id。有效期以服务端 UTC 为准。
const { ERROR_CODES } = require('./common');

/**
 * 映射权益出参。
 * @param {object|null} ent shop_entitlement 文档（无记录传 null）
 * @param {number} serverNowMs 服务端 UTC 毫秒（调用方注入，防篡改）
 * @returns {object} { expire_at, is_active, source, days_left, renewed }
 *   - expire_at: 0 表示无记录/免费档
 *   - is_active: expire_at > now
 *   - days_left: 剩余天数（按服务端 UTC 计算，向下取整；过期为负数）
 */
function entitlementToOut(ent, serverNowMs) {
  const now = Number(serverNowMs) || Date.now();
  if (!ent) {
    return { expire_at: 0, is_active: false, source: '', days_left: 0 };
  }
  const expireAt = Number(ent.expire_at) || 0;
  const active = expireAt > now;
  const daysLeft = Math.floor((expireAt - now) / (24 * 3600 * 1000));
  return {
    expire_at: expireAt,
    is_active: active,
    source: ent.source || '',
    days_left: active ? daysLeft : Math.max(daysLeft, 0),
  };
}

module.exports = { entitlementToOut, ERROR_CODES };