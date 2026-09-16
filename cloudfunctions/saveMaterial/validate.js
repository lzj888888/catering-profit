// cloudfunctions/saveMaterial/validate.js —— 入参校验（纯函数）。
// 契约（core/10 §3）：saveMaterial 入参 { shop_id, material:{...}, client_request_id }。
// 金额铁律（R27）：purchase_price_fen 必须 JSON number（整数分），字符串一律 INVALID_PARAM。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const m = src.material;
  if (!m || typeof m !== 'object') return err('material 必须是对象');
  if (typeof m.name !== 'string' || !m.name.trim()) return err('material.name 必须是非空字符串');

  // 采购单价：分整数
  const purchasePriceFen = m.purchase_price_fen;
  if (typeof purchasePriceFen !== 'number' || !Number.isInteger(purchasePriceFen) || purchasePriceFen < 0) {
    return err('material.purchase_price_fen 必须是非负整数分（JSON number，字符串不接受）');
  }
  // 换算系数：>0 的有限数
  const convertFactor = m.convert_factor;
  if (typeof convertFactor !== 'number' || !(convertFactor > 0) || !isFinite(convertFactor)) {
    return err('material.convert_factor 必须是 >0 的有限 number');
  }
  // 出成率：>0
  const yieldRate = m.yield_rate;
  if (typeof yieldRate !== 'number' || !(yieldRate > 0) || !isFinite(yieldRate) || yieldRate > 100) {
    return err('material.yield_rate 必须是 (0,100] 的 number（%）');
  }

  return {
    error: null,
    shop_id: src.shop_id,
    material: {
      id: (typeof m.id === 'string' && m.id) ? m.id : '',   // 为空 → 新增；非空 → 编辑
      name: m.name.trim(),
      brand_spec: (typeof m.brand_spec === 'string') ? m.brand_spec : '',
      purchase_unit: (typeof m.purchase_unit === 'string') ? m.purchase_unit : '斤',
      purchase_price_fen: purchasePriceFen,
      convert_factor: convertFactor,
      yield_rate: yieldRate,
      is_virtual: !!m.is_virtual,
    },
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };