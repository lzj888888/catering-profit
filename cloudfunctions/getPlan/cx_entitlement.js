// cloudfunctions/common/entitlement.js —— 付费判定单源（M3.28 批次 Q3）
//
// ⚠️ 为什么要有这一层：
//   「是否付费」此前由消费方各自手写 `expireAt > nowUtc()`（首例 exportData/index.js:58）。
//   当 M3 引入第二个、第三个付费能力（S1 套餐 `m3_combo` / S2 外卖 `m3_takeaway`）时，
//   复制一段判定 = 双源 ⇒ 「哪个能力算付费」最终由各函数自己说了算。此处收敛为一处。
//
// ⚠️ 判定口径：**只读 shop_entitlement.expire_at，不读 plan_id**（批次 7 §2.8 既定口径，本文件不变更）。
//   `feature_permissions` 是 **plan 维度的能力位**表 —— 它回答「某档位包含什么」，
//   回答不了「**这个用户**现在付没付钱」 ⇒ 严禁拿它判付费（否则曾经的付费用户到期后仍算付费）。
//   ⚠️ 因此 v1.3 规范 Q-D4 原写的「新增 feature_key 作付费域」**按现状纠正**：付费域必须是 expire_at 判定，
//      `feature_permissions` 只保留其在 plan 维度的既有职责。
//
// ⚠️ 新增符号必须在 common/index.js 聚合入口同步导出（genId 事故族；伴侣守卫 tools/check_requires.js §2）。

const nowUtc = () => Date.now();

/**
 * 是否已付费（纯函数，便于 selftest）。0 / undefined / 已过期的时间戳 ⇒ false。
 * @param {number} expireAt 权益到期毫秒
 * @param {number} [now] 注入当前时间（不传则取真实时间）
 */
function isPaid(expireAt, now) {
  return Number(expireAt || 0) > (now == null ? nowUtc() : now);
}

/** 付费域能力清单。S1 套餐 / S2 外卖在此登记；**未登记的能力一律免费**（开放默认，不因漏登记而锁死用户）。 */
const PAID_FEATURES = ['export', 'm3_combo', 'm3_takeaway'];

/**
 * 读取权益到期时间（无档 = 0 = 免费）。
 * ⚠️ 刻意不 try-catch：读权益失败必须响亮失败（同 exportData 既有行为），
 *    吞掉异常会把**已付费用户降级成免费**，属于静默损失。
 */
async function loadExpireAt(db, userId) {
  const res = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
  const ent = res && res.data && res.data[0];
  return ent ? Number(ent.expire_at || 0) : 0;
}

/**
 * 某付费域能力对该用户是否解锁。
 * @param {object} db
 * @param {string} userId
 * @param {string} featureKey ∈ PAID_FEATURES（不在清单内 ⇒ 恒 true）
 */
async function hasFeature(db, userId, featureKey) {
  if (PAID_FEATURES.indexOf(featureKey) < 0) return true;
  return isPaid(await loadExpireAt(db, userId));
}

module.exports = { PAID_FEATURES, isPaid, loadExpireAt, hasFeature, nowUtc };
