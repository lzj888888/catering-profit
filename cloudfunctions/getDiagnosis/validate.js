// cloudfunctions/getDiagnosis/validate.js —— 入参校验（纯函数）。
//   从 getMonthList 复制而来（同构）；本函数只需 shop_id —— 其余输入全部由 assemble 从库里读，
//   不让前端上传现金/评分这些敏感值（传了就能被篡改成好看的数字）。
const { ERROR_CODES } = require('./common');
function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');
  return { error: null, shop_id: src.shop_id, input: { client_request_id: src.client_request_id || '' } };
}
module.exports = { validateInput, ERROR_CODES };