// cloudfunctions/saveAsset/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, asset:{asset_id?,name,value_fen,start_month,total_months,terminate_month?}, terminate?:bool, client_request_id }。
const { ERROR_CODES } = require('./common');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const a = src.asset;
  if (!a || typeof a !== 'object') return err('asset 必须是对象');
  if (typeof a.name !== 'string' || !a.name.trim()) return err('asset.name 必须是非空字符串');
  if (typeof a.value_fen !== 'number' || !Number.isInteger(a.value_fen) || a.value_fen <= 0) {
    return err('asset.value_fen 必须是正整数分（JSON number；不接受字符串、0 与负数）');
  }
  if (typeof a.start_month !== 'string' || !MONTH_RE.test(a.start_month)) return err('asset.start_month 必须是 YYYY-MM');
  if (typeof a.total_months !== 'number' || !Number.isInteger(a.total_months) || a.total_months < 1) {
    return err('asset.total_months 必须是 ≥1 的整数');
  }
  const terminate_month = (typeof a.terminate_month === 'string' && a.terminate_month) ? a.terminate_month : '';
  if (terminate_month && !MONTH_RE.test(terminate_month)) return err('asset.terminate_month 必须是 YYYY-MM 或留空');

  return {
    error: null,
    shop_id: src.shop_id,
    asset: {
      asset_id: (typeof a.asset_id === 'string' && a.asset_id) ? a.asset_id : '',
      name: a.name.trim(),
      value_fen: a.value_fen,
      start_month: a.start_month,
      total_months: a.total_months,
      terminate_month,
    },
    input: { client_request_id: src.client_request_id || '' },
  };
}
module.exports = { validateInput, MONTH_RE, ERROR_CODES };