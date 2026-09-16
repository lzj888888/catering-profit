// cloudfunctions/getShopContext/validate.js —— 入参校验（纯函数）。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  // shop_id 可选（缺省取用户默认店铺）；提供了则必须非空字符串
  const shopId = (typeof src.shop_id === 'string' && src.shop_id) ? src.shop_id : '';
  return { error: null, shop_id: shopId, input: { client_request_id: src.client_request_id || '' } };
}

module.exports = { validateInput, ERROR_CODES };