// cloudfunctions/archiveMonth/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, month, archive? }。archive 缺省 true（结账归档）；false = 取消归档（保留，供客服后台用）。
const { ERROR_CODES } = require('./common');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');
  if (typeof src.month !== 'string' || !MONTH_RE.test(src.month)) return err('month 必须是 YYYY-MM（如 2026-09）');
  const archive = src.archive === undefined ? true : !!src.archive;
  return {
    error: null,
    shop_id: src.shop_id,
    month: src.month,
    archive,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, MONTH_RE, ERROR_CODES };