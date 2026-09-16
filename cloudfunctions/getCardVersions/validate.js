// cloudfunctions/getCardVersions/validate.js —— 入参校验（纯函数）。
// 契约（core/10 §3）：getCardVersions 入参 { shop_id, card_code }（查询某 card_code 的全部历史版本）。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');
  if (typeof src.card_code !== 'string' || !src.card_code) return err('card_code 必须是非空字符串');
  return {
    error: null,
    shop_id: src.shop_id,
    card_code: src.card_code,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };