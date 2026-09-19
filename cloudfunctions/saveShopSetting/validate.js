// cloudfunctions/saveShopSetting/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, name?, remark?, switches:{inventory,amortize}? }。
const { ERROR_CODES } = require('./common');

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

  return {
    error: null,
    shop_id: src.shop_id,
    name, remark, switches,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };