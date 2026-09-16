// cloudfunctions/getLedger/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, month }。
const { ERROR_CODES } = require('./common');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');
  if (typeof src.month !== 'string' || !MONTH_RE.test(src.month)) return err('month 必须是 YYYY-MM');
  return { error: null, shop_id: src.shop_id, month: src.month, input: { client_request_id: src.client_request_id || '' } };
}
module.exports = { validateInput, MONTH_RE, ERROR_CODES };