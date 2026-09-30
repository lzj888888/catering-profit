// cloudfunctions/importSalesBill/validate.js —— 入参校验（纯函数）
// 入参 { fileID, platform?, confirm? }（shop_id 由 api.call 注入 event.shop_id）。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;

  if (typeof src.fileID !== 'string' || !src.fileID) return err('fileID 必须是非空字符串');

  // platform 可选：不传则云函数按表头自动检测；传了必须是 taobao / meituan
  const platform = (src.platform === 'taobao' || src.platform === 'meituan') ? src.platform : '';

  const confirm = src.confirm === true;

  return {
    error: null,
    fileID: src.fileID,
    platform,
    confirm,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };
