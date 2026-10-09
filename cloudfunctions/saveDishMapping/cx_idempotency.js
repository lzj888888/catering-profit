// cloudfunctions/common/idempotency.js
// 幂等校验（批次 0 §2.4 幂等键维度）
//
// 🔒 R72/R73 单源化：本模块是**全仓唯一**的幂等实现，**两种形态都在这里**：
//   · 拒绝形态 `checkIdempotent(db, key)` —— 命中即拒（管理员写操作 → `ADMIN_OP_IDEMPOTENT`）。
//     key 前缀由调用方自己给（这些操作**不按店隔离**，如 `adm_grant_<crid>`）。
//   · 重放形态 `findPriorResult(db, shopId, clientRequestId)` —— 命中即**返回首次结果**。
//     契约（喂投包 §181 / §6.1）明文要求：「同一 id 重复请求**直接返回首次结果**，不重复写入」，
//     用户侧写操作（saveLedger / saveAsset / saveMaterial / saveCostCard / syncCostCard）走这一形态。
//     key 格式由本模块 `shopKey()` **统一提供**，调用点禁止自己拼字符串。
//
//   历史（已废除，勿复活）：
//     · 曾导出 `(db, shopId, clientRequestId)` 三参形态，但**零生产调用** —— 真正生效的 3 处
//       （adminGrantEntitlement / adminManualOrder / adminRefundMark）各自在 index.js 里**逐字内联**了
//       同一段查询；saveCostCard 又**另起一套**重放形态内联实现（自带一个 `getIdempotent`）。
//       ⇒ 同一语义 5 份实现，而最该被复用的那份（本模块）是死的（另有 42 份 `cx_` 派生副本同样是死的）。
//     · 曾导出 `markIdempotent(db, key)`：**同样零调用**，且实现只是 `return { idempotency_key: key }`
//       （纯数据构造器，不落库）—— 真正落库的是 `common/audit.writeAudit`，它本来就认这个字段。
//       ⇒ R73 删除：留着一个"看起来是官方登记入口"的死函数，比没有更坏（会诱导新代码走死路）。
//
// ⚠️ 隔离与格式责任（R73 定）：店铺维度**必须**用 `shopKey()`；非店铺维度的管理员操作自给前缀。
//
// ⚠️ 性能：两种形态都查 `audit_log.idempotency_key`。审计表**只增不删**，上线前**必须**在
//   云开发控制台补索引 `idx_audit_idem`（已登记于 initDb/collections.js），
//   否则每次幂等检查都是全表扫描，且随时间线性恶化。
const { ERROR_CODES } = require('./cx_errors');

/**
 * 店铺维度的幂等键（重放形态专用）。格式 = `<shop_id>__<client_request_id>`。
 * 空 `client_request_id` ⇒ 返回空串（= 该调用点不做幂等约束，是否允许由守卫/豁免清单裁定）。
 * @param {string} shopId
 * @param {string} clientRequestId
 * @returns {string}
 */
function shopKey(shopId, clientRequestId) {
  return clientRequestId ? `${shopId}__${clientRequestId}` : '';
}

/**
 * 幂等预检（拒绝形态）：`audit_log` 里已存在该 `idempotency_key` ⇒ 判定为重复提交。
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
 * 幂等预检（重放形态）：取该店该 `client_request_id` **首次**调用时留存的返回体
 * （`audit_log.after_data`，由 `common/audit.writeAudit` 连同 `idempotency_key` 一并写入）。
 * @param {object} db
 * @param {string} shopId
 * @param {string} clientRequestId
 * @returns {Promise<object|null>} 非 null ⇒ 调用方应**直接 `ok(该值)`**，不再落库
 */
async function findPriorResult(db, shopId, clientRequestId) {
  const key = shopKey(shopId, clientRequestId);
  if (!key) return null;
  const rec = await db.collection('audit_log')
    .where({ shop_id: shopId, idempotency_key: key }).limit(1).get();
  const row = rec && rec.data && rec.data[0];
  return (row && row.after_data) ? row.after_data : null;
}

module.exports = { checkIdempotent, findPriorResult, shopKey, ERROR_CODES };
