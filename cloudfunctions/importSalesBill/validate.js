// cloudfunctions/importSalesBill/validate.js —— 入参校验（纯函数）
// 入参 { fileID, platform?, confirm? }（shop_id 由 api.call 注入 event.shop_id）。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;

  if (typeof src.fileID !== 'string' || !src.fileID) return err('fileID 必须是非空字符串');

  // platform 可选：不传则云函数按表头自动检测；传了必须是外卖平台枚举（不含 pos —— 堂食不走这条路）。
  // 🔴 v1.7 §10-2：形态 C 的 platform 必须由调用方显式传入（不许按文件名猜）；此处放宽以放行 eleme/other。
  // 🔴 R245：与 service.js::SALES_SCHEMA.platform.enum 同一平台面（多了 jd_order/jd_sku；
  //    仍不含 pos —— 堂食不走这条路）。
  const PLATFORMS = ['taobao', 'meituan', 'jd_order', 'jd_sku', 'eleme', 'other'];
  const platform = PLATFORMS.indexOf(src.platform) >= 0 ? src.platform : '';

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
