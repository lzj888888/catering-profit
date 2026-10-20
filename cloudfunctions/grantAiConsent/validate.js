// cloudfunctions/grantAiConsent/validate.js —— 入参校验（纯函数）
//
// 契约（core/10 §10）：{ shop_id, scope:[...], policy_version, expire_at?, client_request_id }
// 🔴 校验**只判形状与取值域**，不做任何 IO；有效期要跟"现在"比，所以 `now` 由调用方传入
//   （Controller 用 `nowUtc()`，自测用固定值 —— 时间写死在函数里会让自测不可复现）。
const { ERROR_CODES, utilTime } = require('./common');
const { normalizeScopes, checkExpire, POLICY_VERSION } = require('./service');

const mkErr = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });

/**
 * @param {object} event 云函数入参
 * @param {number} [nowArg] 当前毫秒（缺省取服务端时间；自测传固定值）
 */
function validateInput(event, nowArg) {
  if (!event || typeof event !== 'object') return mkErr('event 必须是对象');
  const src = event.input || event;

  if (typeof src.shop_id !== 'string' || !src.shop_id) return mkErr('shop_id 必须是非空字符串');

  // ---- scope：能力粒度，未知项拒收（不静默丢弃）----
  const sc = normalizeScopes(src.scope);
  if (sc.error) return mkErr(sc.error);

  // ---- policy_version：必须是服务端当前条款版本，防止"旧同意覆盖新条款" ----
  const pv = src.policy_version;
  if (typeof pv !== 'string' || !pv.trim()) {
    return mkErr('policy_version 必须是非空字符串（老板同意的是哪一版条款，必须留痕）');
  }
  if (pv.trim() !== POLICY_VERSION) {
    return mkErr('条款已更新（当前 ' + POLICY_VERSION + '，收到 ' + pv.trim() + '），请重新阅读后再同意');
  }

  const now = typeof nowArg === 'number' ? nowArg : utilTime.nowUtc();
  const ex = checkExpire(src.expire_at, now);
  if (ex.error) return mkErr(ex.error);

  const crid = src.client_request_id;
  if (crid !== undefined && crid !== null && typeof crid !== 'string') {
    return mkErr('client_request_id 必须是字符串');
  }

  return {
    error: null,
    shop_id: src.shop_id,
    scope: sc.scopes,
    policy_version: POLICY_VERSION,
    expire_at: ex.value,
    input: { client_request_id: crid || '' },
  };
}

module.exports = { validateInput };
