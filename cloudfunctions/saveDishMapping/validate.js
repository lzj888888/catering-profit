// cloudfunctions/saveDishMapping/validate.js —— 入参校验（纯函数）
// 契约（core/10）：saveDishMapping 入参
//   { shop_id, dish_key, card_code, platform?, client_request_id? }
//
// 🔴 两道 fail-closed：
//   ① `dish_key` trim 后必须非空 —— 空则无从挂钩，而"静默成功"是最坏的语义
//      （用户以为挂上了，下次复盘照旧 unmatched）；
//   ② `platform` 可空（空 ⇒ 跨所有平台生效），给了就必须 trim 后非空（空串与未给同义，不报错）。
//
// ⚠️ `card_code` 空串是**合法**的 —— 语义 = 「解除映射」。非空时由 index.js 校验
//    该卡在本店是否真的存在（挂到不存在的卡 ⇒ 永远匹配不上，等于死挂钩）。
const { ERROR_CODES } = require('./common');

const MAX_LEN = 200;

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const dishKey = typeof src.dish_key === 'string' ? src.dish_key.trim() : '';
  if (!dishKey) return err('dish_key 必须是非空字符串');
  if (dishKey.length > MAX_LEN) return err('dish_key 过长（上限 ' + MAX_LEN + ' 字）');

  const cardCode = typeof src.card_code === 'string' ? src.card_code.trim() : '';
  if (cardCode.length > MAX_LEN) return err('card_code 过长（上限 ' + MAX_LEN + ' 字）');

  const platform = typeof src.platform === 'string' ? src.platform.trim() : '';
  if (platform.length > MAX_LEN) return err('platform 过长（上限 ' + MAX_LEN + ' 字）');

  return {
    error: null,
    shop_id: src.shop_id,
    dish_key: dishKey,
    card_code: cardCode,
    platform,
    input: { client_request_id: typeof src.client_request_id === 'string' ? src.client_request_id : '' },
  };
}

module.exports = { validateInput, ERROR_CODES, MAX_LEN };
