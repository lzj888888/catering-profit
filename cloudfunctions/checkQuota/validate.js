// cloudfunctions/checkQuota/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, scope }。scope ∈ {shop, cost_card}。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');
  if (src.scope !== 'shop' && src.scope !== 'cost_card') return err('scope 必须是 shop 或 cost_card');
  return {
    error: null,
    shop_id: src.shop_id,
    scope: src.scope,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };