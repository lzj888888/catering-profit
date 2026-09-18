// cloudfunctions/common/errors.js
// 统一错误码（批次 0 地基）· 与 core/09_统一错误码表.md 锁死，禁止各批自造。
// 全树只用本表码；前端按 code 经 i18n/terms.js 的 msgOf() 映射文案（禁硬编码）。
const ERROR_CODES = {
  // 1.1 基础 / 鉴权
  SUCCESS: 'SUCCESS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_PARAM: 'INVALID_PARAM',
  // 1.2 资源 / 业务状态
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  SOFT_DELETED: 'SOFT_DELETED',
  ARCHIVED_LOCKED: 'ARCHIVED_LOCKED',
  SNAPSHOT_IMMUTABLE: 'SNAPSHOT_IMMUTABLE',
  // 1.3 配额 / 付费
  FREE_LIMIT_EXCEEDED: 'FREE_LIMIT_EXCEEDED',
  HARD_CAP_EXCEEDED: 'HARD_CAP_EXCEEDED',
  FEATURE_LOCKED: 'FEATURE_LOCKED',
  PLAN_MISMATCH: 'PLAN_MISMATCH',
  // 1.4 M2/M3 算法
  BOM_CYCLE_DETECTED: 'BOM_CYCLE_DETECTED',
  BOM_DEPTH_EXCEEDED: 'BOM_DEPTH_EXCEEDED',
  M2_RED_ALERT: 'M2_RED_ALERT',
  AMORT_TERMINATED: 'AMORT_TERMINATED',
  // 1.5 支付 / 订单 / 退款
  PAY_FAILED: 'PAY_FAILED',
  PAY_PENDING: 'PAY_PENDING',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_DUPLICATE: 'ORDER_DUPLICATE',
  REFUND_FAILED: 'REFUND_FAILED',
  REFUND_NOT_ALLOWED: 'REFUND_NOT_ALLOWED',
  // 1.6 管理端
  ADMIN_AUTH_FAILED: 'ADMIN_AUTH_FAILED',
  ADMIN_TOKEN_EXPIRED: 'ADMIN_TOKEN_EXPIRED',
  ADMIN_LOCKED: 'ADMIN_LOCKED',
  ADMIN_PERMISSION_DENIED: 'ADMIN_PERMISSION_DENIED',
  ADMIN_OP_IDEMPOTENT: 'ADMIN_OP_IDEMPOTENT',
  ADMIN_ALREADY_INIT: 'ADMIN_ALREADY_INIT',
  // 1.7 系统
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
};

// 成功响应（统一 { code, msg, data }）
function ok(data) {
  return { code: ERROR_CODES.SUCCESS, msg: 'ok', data: data || {} };
}

// 失败响应
function fail(code, msg, data) {
  return { code, msg: msg || code, data: data || {} };
}

// 云数据库「唯一键冲突」判定（单源）——A6b 并发建档的容错判据。
// 真云形态（2026-09-19 实测原文）：
//   code = -502001，msg 含 'E11000 duplicate key error collection: <env>.<coll> index: <idx> dup key: {...}'
// 为什么必须单源：`resolveAuth` 与 `getShopContext` 两处建档都要判它，
//   调用点各写一份正则 = 又是一处「同一语义多份实现」（R62/R72/R73 反复清过的病）。
function isDuplicateKeyError(e) {
  if (!e) return false;
  const msg = String(e.msg || e.message || '');
  if (/E11000|duplicate key/i.test(msg)) return true;
  // 部分包装层只透传错误码
  const code = e.errCode != null ? e.errCode : e.code;
  return code === -502001 && /dup|duplicate/i.test(msg);
}

module.exports = { ERROR_CODES, ok, fail, isDuplicateKeyError };
