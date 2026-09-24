// cloudfunctions/saveShopSetting/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, name?, remark?, switches:{inventory,amortize}? }。
const { ERROR_CODES, indicatorRef } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  // 🔴 三态语义（2026-09-20 修）：undefined = 调用方没传 → **不动库**；
  //    '' = 显式清空；非字符串 = 归一 ''（既有语义不变）。
  //    起因：月度录入页只切换核算口径时不传 name，被归一成 '' 写库 → **店铺名被清空**；
  //    而旧注释写着"不清空已有名"，实现与注释不符。此处与 switches 的 null 语义对齐。
  const name = src.name === undefined ? undefined : ((typeof src.name === 'string') ? src.name : '');
  const remark = src.remark === undefined ? undefined : ((typeof src.remark === 'string') ? src.remark : '');

  let switches = { inventory: null, amortize: null };
  if (src.switches && typeof src.switches === 'object') {
    const s = src.switches;
    if (s.inventory !== undefined && typeof s.inventory !== 'boolean') return err('switches.inventory 必须是 boolean');
    if (s.amortize !== undefined && typeof s.amortize !== 'boolean') return err('switches.amortize 必须是 boolean');
    switches = { inventory: s.inventory === undefined ? null : s.inventory, amortize: s.amortize === undefined ? null : s.amortize };
  }

  // round115：业态 / 城市层级 —— M1 结果页取「行业参考带」的输入（M1 此前**完全没有**这两个值，
  //   而参考带是分业态 × 分城市层级的 ⇒ 没有它们对照就只能瞎给）。
  // 🔴 三态语义与 name 一致：undefined = 调用方没传 → **不动库**；'' / null = 显式清空；
  //    其余非白名单值 = **报错**（fail-closed，不静默归一 —— 否则会悄悄改掉用户的选择）。
  // ⚠️ 枚举**从 indicatorRef 单源取**，本文件不另抄一份（抄了必漂）。
  let bizType;
  if (src.biz_type !== undefined) {
    if (src.biz_type === '' || src.biz_type === null) bizType = '';
    else if (typeof src.biz_type === 'string' && indicatorRef.BIZ_KEYS.indexOf(src.biz_type) >= 0) bizType = src.biz_type;
    else return err('biz_type 必须是 ' + indicatorRef.BIZ_KEYS.join(' / ') + ' 之一');
  }
  let cityTier;
  if (src.city_tier !== undefined) {
    if (src.city_tier === '' || src.city_tier === null) cityTier = '';
    else if (typeof src.city_tier === 'string' && indicatorRef.CITY_KEYS.indexOf(src.city_tier) >= 0) cityTier = src.city_tier;
    else return err('city_tier 必须是 ' + indicatorRef.CITY_KEYS.join(' / ') + ' 之一');
  }

  return {
    error: null,
    shop_id: src.shop_id,
    name, remark, switches,
    biz_type: bizType, city_tier: cityTier,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };