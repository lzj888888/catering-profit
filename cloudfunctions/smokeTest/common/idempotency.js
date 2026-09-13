// cloudfunctions/common/idempotency.js
// 幂等校验（批次 0 §2.4 幂等键维度）
// 唯一键 = (shop_id + client_request_id)：不同店铺允许复用同一请求 ID，避免全局唯一误拦截；
//            换店用同一 ID 不被误拦（复审点 2 验收第 2 条）。
// 读操作不强制；所有写操作必须校验。
const { ERROR_CODES } = require('./errors');

async function checkIdempotent(db, shopId, clientRequestId) {
  if (!clientRequestId) return { ok: true, hit: false };
  const key = `${shopId}__${clientRequestId}`;
  const rec = await db.collection('audit_log').where({ idempotency_key: key }).limit(1).get();
  if (rec && rec.data && rec.data.length > 0) {
    return { ok: false, hit: true, first: rec.data[0] }; // 命中 → 返回首次结果，不重复写入
  }
  return { ok: true, hit: false, key };
}

// 写操作前登记幂等键（落 audit_log 的 idempotency_key 字段，供下次查重）
async function markIdempotent(db, key) {
  // 实际登记由 audit.write 完成；此处仅返回标准字段，便于调用方写入
  return { idempotency_key: key };
}

module.exports = { checkIdempotent, markIdempotent, ERROR_CODES };
