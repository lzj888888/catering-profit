// cloudfunctions/payCreateOrder/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, plan_id, channel }。plan_id 必须来自 subscription_plan（Controller 读配置校验 enabled）。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');
  if (typeof src.plan_id !== 'string' || !src.plan_id) return err('plan_id 必须是非空字符串');
  const channel = (typeof src.channel === 'string' && src.channel) ? src.channel : 'wechat';
  return {
    error: null,
    shop_id: src.shop_id,
    plan_id: src.plan_id,
    channel,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };