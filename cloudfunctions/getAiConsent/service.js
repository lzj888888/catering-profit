// cloudfunctions/getAiConsent/service.js —— AI 授权（读侧）纯函数层
//
// ⚠️ 分层铁律：本文件只做纯判定，**不 require wx-server-sdk、不碰 db、不读时间**。
//   "现在"由 Controller 取 `nowUtc()` 后传进来 —— 时间写死在函数里，自测就不可复现。
//
// 🔴 这个函数存在的理由（队列 #18）：写侧 R403 只落了 grant/revoke。
//   没有读侧时，前端要回答"我现在授了哪几项"只能**调一次 grant 猜** ——
//   而 grant 是有副作用的写操作，用写去读是设计缺陷，不是变通。
//
// 🔴 本文件的核心不是"把记录取出来"，而是**把记录翻译成前端能直接用的状态**。
//   如果只把 `scope` 原样抛给页面，页面会这样渲染：
//     - 授权过期了，但 scope 还在 ⇒ 勾选态仍是"已授权"（实际一用就被拒）
//     - 撤回了，但 scope 还在 ⇒ 同上
//     - 条款升级了，但 scope 还在 ⇒ 同上（写侧已强制重新同意，读侧却显示还有效 = 自相矛盾）
//   ⇒ 所以**必须**把「历史事实」(`scope`) 与「现在能不能用」(`effective_scope`) 分成两个字段。
//     前者给审计/回显（"你当初同意的是这三项"），后者给功能开关（"现在这三项能不能用"）。

const POLICY_VERSION = 'ai-consent-v1';

// 状态四态。**穷尽**，没有第五种，也不允许 `undefined` 漏出去：
//   none    —— 从未授权（首次进页面的正常状态，不是错误）
//   active  —— 有效
//   expired —— 授权过但已过期（**懒过期**：不跑定时器，读的那一刻判）
//   revoked —— 老板主动撤回（或 admin 撤的，看 revoke_reason）
const STATES = ['none', 'active', 'expired', 'revoked'];

/**
 * 判定当前状态。
 * @param {object|null} doc `shop_ai_consent` 记录（可能为 null）
 * @param {number} now 服务端当前毫秒
 * @returns {{state: string, has_record: boolean}}
 *
 * 🔴 `revoked` **优先于** `expired`：两者同时成立时（撤回过、且之后又过了有效期），
 *   对老板有意义的事实是"这是你自己撤的"，而不是"它到期了"。
 *   反过来判会把一条主动撤回记录显示成自然过期 ⇒ 客服无法分辨"他撤了"和"它到期了"。
 */
function judgeState(doc, now) {
  if (!doc) return { state: 'none', has_record: false };
  const revokedAt = doc.revoked_at || 0;
  if (revokedAt > 0) return { state: 'revoked', has_record: true };
  const expireAt = doc.expire_at || 0;
  // `expire_at = 0` 是**不自动过期**（设计稿 §2 约定），不能当"已过期"。
  // 边界用严格大于：到点那一毫秒仍可用，避免"设了到期日当天 0 点就失效"的歧义。
  if (expireAt > 0 && now > expireAt) return { state: 'expired', has_record: true };
  return { state: 'active', has_record: true };
}

/**
 * 计算「现在真正可用的能力」。
 * @param {object|null} doc
 * @param {string} state judgeState 的结果
 * @param {string} currentPolicy 服务端当前条款版本
 * @returns {string[]} 不可用时返回**空数组**（不是 null —— 前端直接 `.length` 判断，少一个空值分支）
 *
 * 🔴 条款版本不一致 ⇒ 一律为空，即使 `state==='active'`：
 *   写侧 `grantAiConsent` 强制 `policy_version` 必须等于当前版本，即"条款升级后必须重新同意"。
 *   读侧若照旧返回有效能力，就变成"写侧要你重同意、读侧说还能用" —— 两个接口互相打脸，
 *   而老板只会看到其中一个。
 */
function effectiveScopes(doc, state, currentPolicy) {
  if (!doc || state !== 'active') return [];
  if ((doc.policy_version || '') !== currentPolicy) return [];
  // 脏数据防御：写侧拒收空数组，但历史记录/手工改库仍可能为空。
  // 保守处理 ⇒ 空就是空（**不能**因为"应该不会为空"就放行，等于把越界当正常）。
  return Array.isArray(doc.scope) ? doc.scope.slice() : [];
}

/**
 * 组装读侧出参。
 * @param {object|null} doc
 * @param {string} shopId
 * @param {number} now
 * @param {string} [policyNow] 服务端当前条款版本（自测可传，缺省取常量）
 */
function buildState(doc, shopId, now, policyNow) {
  const currentPolicy = policyNow || POLICY_VERSION;
  const judged = judgeState(doc, now);
  const state = judged.state;
  const hasRecord = judged.has_record;
  const recordScope = doc && Array.isArray(doc.scope) ? doc.scope.slice() : [];
  const policyStale = hasRecord && (doc.policy_version || '') !== currentPolicy;

  return {
    shop_id: shopId || '',
    has_record: hasRecord,
    state: state,
    // 历史事实：老板当初同意的能力（审计/回显用）。**不要拿它做功能开关**。
    scope: recordScope,
    // 现在的实际权限（功能开关用）。过期/撤回/条款升级 ⇒ 空数组。
    effective_scope: effectiveScopes(doc, state, currentPolicy),
    policy_version: (doc && doc.policy_version) || '',
    policy_version_now: currentPolicy,
    policy_stale: policyStale,
    consent_id: (doc && doc.consent_id) || '',
    granted_at: (doc && doc.granted_at) || 0,
    expire_at: (doc && doc.expire_at) || 0,
    revoked_at: (doc && doc.revoked_at) || 0,
    revoke_reason: (doc && doc.revoke_reason) || '',
    // 🔴 前端只需看这一个布尔决定"要不要弹授权页"：
    //   让页面自己拼 `state!=='active' || policy_stale` ⇒ 漏掉后者就是"条款升级后不弹"。
    //   四态 × 条款一致性 = 8 种组合，页面拼错的概率远高于这里写错。
    need_regrant: state !== 'active' || policyStale,
  };
}

module.exports = { POLICY_VERSION, STATES, judgeState, effectiveScopes, buildState };
