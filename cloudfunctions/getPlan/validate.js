// cloudfunctions/getPlan/validate.js —— 入参校验（纯函数）· 只读
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  let planId = '';
  if (src.plan_id !== undefined && src.plan_id !== null) {
    if (typeof src.plan_id !== 'string' || !src.plan_id) return err('plan_id 必须是非空字符串');
    planId = src.plan_id;
  }

  let version = null;
  if (src.version !== undefined && src.version !== null) {
    if (!Number.isInteger(src.version) || src.version <= 0) return err('version 必须是正整数（可选）');
    version = src.version;
  }

  return { error: null, shop_id: src.shop_id, plan_id: planId, version };
}

module.exports = { validateInput, ERROR_CODES };