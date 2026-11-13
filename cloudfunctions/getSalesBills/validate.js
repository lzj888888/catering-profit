// cloudfunctions/getSalesBills/validate.js —— 入参校验（纯函数）。
// 契约（core/10）：getSalesBills 入参
//   { shop_id, biz_date_from?, biz_date_to?, platform?, include_cleared?, client_request_id?, detail? }
// 🔴 R728：detail=true（要菜品级明细）时 biz_date_from/to **必传** —— 缺参直接拒，
//   绝不退回读全表（R301：不传区间会把历次导入的多个月累加，页面却按当月呈现）。
const { ERROR_CODES } = require('./common');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const from = (typeof src.biz_date_from === 'string' && src.biz_date_from) ? src.biz_date_from : '';
  const to = (typeof src.biz_date_to === 'string' && src.biz_date_to) ? src.biz_date_to : '';
  if (from && !DATE_RE.test(from)) return err('biz_date_from 必须是 YYYY-MM-DD');
  if (to && !DATE_RE.test(to)) return err('biz_date_to 必须是 YYYY-MM-DD');

  const platform = (typeof src.platform === 'string' && src.platform) ? src.platform : '';
  const detail = src.detail === true;
  if (detail && (!from || !to || from >= to)) {
    return err('detail=true 时 biz_date_from / biz_date_to 必传，且 from < to（半开区间）');
  }

  return {
    error: null,
    shop_id: src.shop_id,
    biz_date_from: from,
    biz_date_to: to,
    platform,
    include_cleared: src.include_cleared === true,
    detail,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES, DATE_RE };
