// cloudfunctions/revokeAiConsent/service.js —— AI 撤回（写侧）纯函数层
//
// ⚠️ 与 `grantAiConsent/service.js` **不是同一份语义**，不要合并：撤回只决定"当前是什么状态"，
//   不做 scope / 条款版本校验 —— 撤回在任何授权面上都必须成功（缩小授权永远不该被拒）。
//
// 🔴 撤回的三条硬约束（设计稿 §4）：
//   ① **不删记录**，只翻 `revoked_at` 留痕；删了就无法回答"他什么时候同意过、什么时候撤的"。
//   ② 撤回必须**同时清派生数据**（`shop_ai_insight` 里按 `consent_id`）——只翻标记不清缓存，
//      就是"撤回了但结论还在被引用"，这是豆包第三轮指出的全链路返工根因。
//   ③ 已撤回再撤一次是**幂等终态**：不许刷新 `revoked_at`（刷新会让"撤回时间"变成最后一次点击时间，
//      历史就被改写了）。

// 客户端可以给的撤回原因。`expire` / `admin` 是服务端/管理员语义，不接受客户端伪造。
const CLIENT_REASONS = ['user'];

/**
 * 判定本次撤回落在哪个状态（纯函数，便于行为级自测）。
 * @param {object|null} row 现有授权记录
 * @returns {'no_consent'|'revoked'|'already_revoked'}
 */
function revokeState(row) {
  if (!row) return 'no_consent';
  return (typeof row.revoked_at === 'number' && row.revoked_at > 0) ? 'already_revoked' : 'revoked';
}

/**
 * 归一撤回原因：缺省 = `user`；只接受客户端合法原因。
 * @returns {{error: string|null, reason: string}}
 */
function normalizeReason(raw) {
  if (raw === undefined || raw === null || raw === '') return { error: null, reason: 'user' };
  if (typeof raw !== 'string') return { error: 'reason 必须是字符串', reason: '' };
  const k = raw.trim();
  if (CLIENT_REASONS.indexOf(k) < 0) {
    return { error: 'reason 只接受 ' + CLIENT_REASONS.join('/') + '（expire/admin 是服务端语义，客户端不得伪造）', reason: '' };
  }
  return { error: null, reason: k };
}

/**
 * 审计用授权面快照（与 grant 侧同形，便于按 consent_id 串起一条时间线）。
 */
function auditSnapshot(doc) {
  if (!doc) return null;
  return {
    consent_id: doc.consent_id || '',
    scope: Array.isArray(doc.scope) ? doc.scope.slice() : [],
    policy_version: doc.policy_version || '',
    granted_at: doc.granted_at || 0,
    expire_at: doc.expire_at || 0,
    revoked_at: doc.revoked_at || 0,
    revoke_reason: doc.revoke_reason || '',
  };
}

module.exports = { CLIENT_REASONS, revokeState, normalizeReason, auditSnapshot };
