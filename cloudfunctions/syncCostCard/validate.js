// cloudfunctions/syncCostCard/validate.js —— 入参校验（纯函数）。
// 契约（core/10 §3）：syncCostCard 入参 { shop_id, card_code, client_request_id }。
// M3.19（批次 E）：新增 dry_run 影响面预览分支 —— dry_run=true 时 card_code 不再必填、material_id 必填。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  // M3.19（批次 E）：dry_run = 影响面预览（只读、零写库）；此时 card_code 不必填、material_id 必填。
  const dryRun = src.dry_run === true;
  if (dryRun) {
    if (typeof src.material_id !== 'string' || !src.material_id) return err('dry_run 预览需提供 material_id');
    return {
      error: null,
      shop_id: src.shop_id,
      dry_run: true,
      material_id: src.material_id,
      card_code: '',
      input: { client_request_id: src.client_request_id || '' },
    };
  }

  if (typeof src.card_code !== 'string' || !src.card_code) return err('card_code 必须是非空字符串');
  return {
    error: null,
    shop_id: src.shop_id,
    dry_run: false,
    material_id: '',
    card_code: src.card_code,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };
