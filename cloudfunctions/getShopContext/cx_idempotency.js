// cloudfunctions/common/idempotency.js
// 幂等校验（批次 0 §2.4 幂等键维度）
//
// 🔒 R72 单源化：本模块是**全仓唯一**的幂等实现。
//   历史（已废除）：曾导出 (db, shopId, clientRequestId) 三参形态，但**零生产调用** ——
//   真正生效的 3 处（adminGrantEntitlement / adminManualOrder / adminRefundMark）
//   各自在 index.js 里**逐字内联**了同一段查询代码
//   ⇒ 同一语义 4 份实现，而最该被复用的那份（本模块）是死的（另有 42 份 cx_ 派生副本同样是死的）。
//   R72 起统一为 (db, key) 两参、返回 boolean，与那 3 处内联版**逐字等价**。
//
// ⚠️ key 的命名空间由**调用方**负责：模块只回答「audit_log.idempotency_key 是否已存在」。
//   需要按店隔离时请自行带前缀（如 `shop_${shopId}__${crid}`）；管理员操作按操作前缀
//   （`adm_grant_` / `adm_order_` / `adm_refund_`）。**不要把隔离责任留给本模块**。
//
// ⚠️ 性能：本查询走 audit_log.idempotency_key。审计表**只增不删**，上线前**必须**在
//   云开发控制台补索引 `idx_audit_idem`（已登记于 initDb/collections.js），
//   否则每次幂等检查都是全表扫描，且随时间线性恶化。
const { ERROR_CODES } = require('./cx_errors');

/**
 * 幂等预检：audit_log 里已存在该 idempotency_key ⇒ 判定为重复提交。
 * @param {object} db 注入的数据库句柄
 * @param {string} key 幂等键（由调用方构造，应含业务前缀）
 * @returns {Promise<boolean>} true = 已处理过（调用方应拒绝本次重复写入）
 */
async function checkIdempotent(db, key) {
  if (!key) return false; // 无 key ⇒ 该调用点不做幂等约束（是否允许由守卫/豁免清单裁定）
  const dup = await db.collection('audit_log').where({ idempotency_key: key }).limit(1).get();
  return !!(dup && dup.data && dup.data.length > 0);
}

/**
 * 写操作前登记幂等键（落 audit_log 的 idempotency_key 字段，供下次查重）。
 * ⚠️ 本函数是**纯数据构造器**：只返回标准字段，实际落库由 audit.write 完成。
 *    调用方须保证「写业务数据」与「写审计（含该字段）」在同一流程内，否则下次查不到、幂等失效。
 * @returns {Promise<{idempotency_key:string}>}
 */
async function markIdempotent(db, key) {
  return { idempotency_key: key };
}

module.exports = { checkIdempotent, markIdempotent, ERROR_CODES };
