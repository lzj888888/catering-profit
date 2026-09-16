// cloudfunctions/getMaterial/validate.js —— 入参校验（纯函数）。
// 契约（core/10 §3）：getMaterial 入参 { shop_id, is_virtual? }。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');
  let isVirtual = null; // null = 不过滤（全部）
  if (src.is_virtual !== undefined && src.is_virtual !== null) {
    if (typeof src.is_virtual !== 'boolean') return err('is_virtual 必须是 boolean');
    isVirtual = src.is_virtual;
  }
  return {
    error: null,
    shop_id: src.shop_id,
    is_virtual: isVirtual,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };