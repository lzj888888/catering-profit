// cloudfunctions/payCallback/service.js —— 批次 5 · 支付回调验签与权益累加（Service 层纯逻辑）
//
// ⚠️ 安全铁律（批次 5 §2.7）：
//   · 回调必须校验官方签名，**绝不信任前端传入的支付结果**；
//   · 签名校验失败 → 丢弃请求并记 audit_log（由 Controller 落日志）；
//   · 幂等键 = **全局 transaction_id（微信支付订单号）**，同一交易号重复回调直接返回成功，
//     不重复生成订单、不重复更新权益；
//   · 回调只做两件事：生成订单记录 + 更新 expire_at（累加）。
//
// 微信支付签名（v3）：header 里 Wechatpay-Signature 是对「应答报文串」的 RSA-SHA256 签名，
// 需要平台证书公钥验签。本 Service 提供**可注入的验签器**（verifySign），生产由 Controller 注入
// 官方 SDK 验签实现；测试注入假验签器验证「验签失败丢弃 / 验签通过处理」两条路径。
//
// 权益主体：shop_entitlement 按 user_id 存；回调只拿到 openid，须先经 openid → user_id 映射。

const { ERROR_CODES } = require('./common');

// ===================== 验签（可注入） =====================
// 默认验签器：未注入时一律拒绝（fail-closed —— 没有官方验签能力绝不处理回调）
const DEFAULT_VERIFIER = () => false;

/**
 * 校验微信支付回调签名。
 * @param {object} raw 回调原始报文（含 headers/body）
 * @param {function} verifySign (raw) => boolean 可注入验签器
 * @returns {boolean} 是否通过
 */
function verifyCallbackSign(raw, verifySign) {
  const fn = (typeof verifySign === 'function') ? verifySign : DEFAULT_VERIFIER;
  try {
    return fn(raw) === true;
  } catch (e) {
    return false;
  }
}

// ===================== 权益累加（纯函数） =====================
// 续费有效期累加（§2.3 环节 4 / §2.6）：已过期 → 从当前时刻起算 +days；未过期 → 在原 expire_at 上累加。
function calcNewExpireAt(currentExpireAt, serverNowMs, days) {
  const now = Number(serverNowMs) || Date.now();
  const base = (Number(currentExpireAt) || 0) > now ? Number(currentExpireAt) : now;
  return base + Number(days) * 24 * 3600 * 1000;
}

// ===================== 回调处理（纯编排，DB 由 Controller 注入） =====================
/**
 * 处理支付成功回调（幂等）。
 * @param {object} p {
 *   transactionId, orderNo, openid, amountFen, planId, paidAtMs, serverNowMs,
 *   readFlow:      async (transactionId) => 已有流水文档|null,
 *   insertFlow:    async (flowDoc) => void,
 *   resolveUser:   async (openid) => user_id|null,
 *   readEntitlement: async (userId) => shop_entitlement 文档|null,
 *   updateExpire:  async (userId, newExpireAt, source) => void,
 *   daysOfPlan:    async (planId) => number（套餐天数，后端读配置）,
 * }
 * @returns {object} { duplicated:boolean, expire_at, ok }
 *   - duplicated=true 表示该 transaction_id 已处理过（幂等命中，不重复发放）
 */
async function handleCallback(p) {
  const txn = p && p.transactionId;
  if (!txn) {
    const e = new Error('缺少 transaction_id');
    e.code = ERROR_CODES.INVALID_PARAM;
    throw e;
  }

  // 1) 幂等预检：transaction_id 已存在流水 → 直接返回成功（不重复发放）
  const existing = await p.readFlow(txn);
  if (existing) return { duplicated: true, ok: true, expire_at: null };

  // 2) openid → user_id（权益主体为 user_id）
  const userId = await p.resolveUser(p.openid);
  if (!userId) {
    const e = new Error('openid 未关联用户');
    e.code = ERROR_CODES.USER_NOT_FOUND;
    throw e;
  }

  // 3) 查套餐天数（后端读配置）
  const days = await p.daysOfPlan(p.planId);

  // 4) 读当前权益 → 累加有效期
  const ent = await p.readEntitlement(userId);
  const currentExpireAt = ent ? (ent.expire_at || 0) : 0;
  const newExpireAt = calcNewExpireAt(currentExpireAt, p.serverNowMs, days);

  // 5) 写流水（幂等键 = transaction_id）+ 更新权益（只动 expire_at）
  await p.insertFlow({
    transaction_id: txn,
    order_no: p.orderNo || '',
    openid: p.openid || '',
    user_id: userId,
    amount_fen: p.amountFen || 0,
    plan_id: p.planId || '',
    status: 'paid',
    paid_at: p.paidAtMs || p.serverNowMs,
  });
  await p.updateExpire(userId, newExpireAt, 'payment');

  return { duplicated: false, ok: true, expire_at: newExpireAt };
}

module.exports = { verifyCallbackSign, calcNewExpireAt, handleCallback, ERROR_CODES };