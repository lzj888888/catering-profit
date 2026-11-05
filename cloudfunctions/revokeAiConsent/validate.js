// cloudfunctions/revokeAiConsent/validate.js —— 入参校验（纯函数）
//
// 契约（core/10 §10）：{ shop_id, reason?, client_request_id }
// ⚠️ 撤回**不校验 scope / policy_version**：撤回本身是"缩小授权"，任何情况下都不该被入参细节挡住。
const { ERROR_CODES } = require('./common');
const { normalizeReason } = require('./service');

const mkErr = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });

function validateInput(event) {
  if (!event || typeof event !== 'object') return mkErr('event 必须是对象');
  const src = event.input || event;

  if (typeof src.shop_id !== 'string' || !src.shop_id) return mkErr('shop_id 必须是非空字符串');

  const rs = normalizeReason(src.reason);
  if (rs.error) return mkErr(rs.error);

  const crid = src.client_request_id;
  if (crid !== undefined && crid !== null && typeof crid !== 'string') {
    return mkErr('client_request_id 必须是字符串');
  }

  return {
    error: null,
    shop_id: src.shop_id,
    reason: rs.reason,
    input: { client_request_id: crid || '' },
  };
}

module.exports = { validateInput };
