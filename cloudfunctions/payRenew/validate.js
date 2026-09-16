// cloudfunctions/payRenew/validate.js —— 入参校验（纯函数）。
// 入参 { plan_id, channel? }（shop_id 可选——续费入口可来自订单页/权益页，非单店归属）。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.plan_id !== 'string' || !src.plan_id) return err('plan_id 必须是非空字符串');
  const channel = (typeof src.channel === 'string' && src.channel) ? src.channel : 'wechat';
  return {
    error: null,
    shop_id: (typeof src.shop_id === 'string') ? src.shop_id : '',
    plan_id: src.plan_id,
    channel,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };