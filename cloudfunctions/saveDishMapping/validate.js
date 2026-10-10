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

// ===== R260：批量入参校验（规范 v1.9 §0 D25~D27）=====
// 🔴 两种形态**互斥**（不是"优先取其一"）：同时给 `dish_key` 与 `items` ⇒ 拒。
//    理由：静默取其一 = 用户以为提交了批量、实际只写了一条（或反之），**且不报错**。
// 🔴 每一处拒绝都带 `rejected[]`（哪一项、为什么），让用户一次看清要改哪几行；
//    这也是 D28「整批不写」的另一半 —— 原子语义必须配得上"看得见原因"。
const MAX_ITEMS = require('./service').MAX_BATCH;

function validateBatch(event) {
  const err = (m, rejected) => ({
    error: ERROR_CODES.INVALID_PARAM, msg: m, rejected: rejected || [],
  });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  // ① 互斥
  const hasSingle = typeof src.dish_key === 'string' && src.dish_key.trim() !== '';
  const hasBatch = Array.isArray(src.items);
  if (hasSingle && hasBatch) {
    return err('不能同时提交单条（dish_key）与批量（items）');
  }
  if (!hasBatch) return err('items 必须是数组');

  // ② 长度（上限取自纯函数单源，不在本文件另写一个数）
  if (src.items.length === 0) return err('items 不能为空数组');
  if (src.items.length > MAX_ITEMS) {
    return err('单批最多 ' + MAX_ITEMS + ' 项（当前 ' + src.items.length + '），请分块提交');
  }

  // ③ 逐项字段校验（全量跑完再判，让用户一次看到所有问题项，而不是"改一个报一个"）
  const rejected = [];
  const items = [];
  for (let i = 0; i < src.items.length; i++) {
    const it = src.items[i];
    if (!it || typeof it !== 'object') { rejected.push({ index: i, dish_key: '', reason: 'not_object' }); continue; }
    const dishKey = typeof it.dish_key === 'string' ? it.dish_key.trim() : '';
    const cardCode = typeof it.card_code === 'string' ? it.card_code.trim() : '';
    const platform = typeof it.platform === 'string' ? it.platform.trim() : '';
    if (!dishKey) { rejected.push({ index: i, dish_key: '', reason: 'dish_key_empty' }); continue; }
    if (dishKey.length > MAX_LEN) { rejected.push({ index: i, dish_key: dishKey, reason: 'dish_key_too_long' }); continue; }
    if (cardCode.length > MAX_LEN) { rejected.push({ index: i, dish_key: dishKey, reason: 'card_code_too_long' }); continue; }
    if (platform.length > MAX_LEN) { rejected.push({ index: i, dish_key: dishKey, reason: 'platform_too_long' }); continue; }
    items.push({ dish_key: dishKey, card_code: cardCode, platform });
  }
  // ④ 批内去重（判重键与写库唯一键同源 —— 见 service.js::findBatchConflicts 头注）
  const conflicts = require('./service').findBatchConflicts(items);
  conflicts.forEach((c) => rejected.push({ index: c.index, dish_key: c.dish_key, reason: 'duplicate_key' }));

  if (rejected.length) {
    return err('批量入参有 ' + rejected.length + ' 项不合格，整批未写入', rejected);
  }

  return {
    error: null,
    mode: 'batch',
    shop_id: src.shop_id,
    items,
    input: { client_request_id: typeof src.client_request_id === 'string' ? src.client_request_id : '' },
  };
}

module.exports = { validateInput, validateBatch, ERROR_CODES, MAX_LEN, MAX_ITEMS };
