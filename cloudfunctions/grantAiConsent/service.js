// cloudfunctions/grantAiConsent/service.js —— AI 授权（写侧）纯函数层
//
// ⚠️ 分层铁律：本文件只做纯计算/纯变换，**不 require wx-server-sdk、不碰 db、不读时间**。
//   时间一律由 Controller 取 `nowUtc()` 后**作为入参传进来**，保证同一请求内只有一个"现在"。
//
// 🔴 为什么 scope 必须是**数组**而不是布尔（设计稿 §0 的前提，不在代码里再解释一遍就没人记得）：
//   老板授权的不是"用我的数据"，而是"用我的数据做**某一类**判断"。
//   布尔一旦落地 ⇒ 以后新增能力时，旧授权会被当成"已同意"⇒ 这是隐私上最常见的越界。
//   所以这里对**未知能力名直接拒收**，绝不"静默丢弃未知项"（静默丢弃 = 老板以为授了三项，
//   实际只存了两项；而"多存"比"少存"更危险，所以两边都不许）。
//
// ⚠️ 本文件与 `revokeAiConsent/service.js` **不是同一份语义**，不要合并：
//   授权要校验 scope / 条款版本 / 有效期；撤回只决定"当前是什么状态"。两份各自单一职责。

// 能力枚举 —— 与设计稿 §2 的 `scope` 一一对应。新增能力**必须**同时改这里与条款版本，
// 否则旧条款下的授权会带上新能力（越界）。
const SCOPES = ['diagnose', 'pricing', 'expand'];

// 当前条款版本。老板同意的是**哪一版**条款 ⇒ 条款升级后旧客户端必须重新同意，
// 不能让"同意过 v1"自动覆盖 v2。客户端传的值必须**等于**这里，否则拒收。
const POLICY_VERSION = 'ai-consent-v1';

// 有效期上限：只用于拦"手滑写成 2099 年"这类无意义值（不是业务额度）。
const MAX_EXPIRE_YEARS = 10;

/**
 * 归一 scope：去空白、去重、按声明顺序排序；未知项**拒收**。
 * @param {*} raw 前端传入的 scope
 * @returns {{error: string|null, scopes: string[]}}
 */
function normalizeScopes(raw) {
  if (!Array.isArray(raw)) {
    return { error: 'scope 必须是数组（能力粒度：' + SCOPES.join('/') + '），不接受布尔', scopes: [] };
  }
  if (raw.length === 0) {
    return { error: 'scope 不能为空（至少勾一项；空数组等于没授权，不该落一条"已授权"记录）', scopes: [] };
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i];
    if (typeof x !== 'string') return { error: 'scope[' + i + '] 必须是字符串', scopes: [] };
    const k = x.trim();
    if (SCOPES.indexOf(k) < 0) {
      return { error: 'scope[' + i + '] 是未知能力「' + k + '」（只接受 ' + SCOPES.join('/') + '）', scopes: [] };
    }
    if (out.indexOf(k) < 0) out.push(k);
  }
  // 稳定顺序：同一组授权不因前端勾选顺序不同而落成两种"看起来不同"的记录（审计与对拍都需要可比）。
  out.sort((a, b) => SCOPES.indexOf(a) - SCOPES.indexOf(b));
  return { error: null, scopes: out };
}

/**
 * 校验有效期。`0` = 不自动过期（设计稿约定）。
 * @param {*} expireAt
 * @param {number} now 服务端当前毫秒（由 Controller 传入）
 * @returns {{error: string|null, value: number}}
 */
function checkExpire(expireAt, now) {
  if (expireAt === undefined || expireAt === null) return { error: null, value: 0 };
  if (typeof expireAt !== 'number' || !Number.isInteger(expireAt) || expireAt < 0) {
    return { error: 'expire_at 必须是非负整数毫秒（0 = 不自动过期）', value: 0 };
  }
  if (expireAt === 0) return { error: null, value: 0 };
  // 🔴 落一条**已经过期**的授权，会让前端显示"已授权"而实际一读就被判失效 ——
  //   这是典型的"接口成功、功能不生效"，比直接报错贵得多（同族 round116）。
  if (expireAt <= now) return { error: 'expire_at 必须晚于当前时间（不能落一条出生即过期的授权）', value: 0 };
  const cap = now + MAX_EXPIRE_YEARS * 365 * 24 * 60 * 60 * 1000;
  if (expireAt > cap) return { error: 'expire_at 超过 ' + MAX_EXPIRE_YEARS + ' 年上限', value: 0 };
  return { error: null, value: expireAt };
}

/**
 * 审计用：只摘"授权面"字段。
 * 🔴 不把整条记录抄进 audit_log —— 里面没有敏感明细，但也没必要把 `user_id` 再复制一份到只增不删的表里。
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

module.exports = { SCOPES, POLICY_VERSION, MAX_EXPIRE_YEARS, normalizeScopes, checkExpire, auditSnapshot };
