// cloudfunctions/calcSandbox/validate.js —— 入参校验（纯函数）。
// 契约（core/10 §4）：calcSandbox 入参 { rent_fen, property_fen, labor_fen, other_fen, include_amort, sim_amort_fen?, var_food_pct, var_mkt_pct, var_other_pct, target_profit_fen }。
// 金额一律「分」JSON number（R27）；变效率可为小数但须 ∈ [0,100]。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  // 金额：分非负整数
  const fen = (v, name) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return err(`${name} 必须是非负整数分（JSON number，字符串不接受）`);
    }
    return v;
  };
  const rentFen = fen(src.rent_fen, 'rent_fen');
  if (rentFen && rentFen.error) return rentFen;
  const propertyFen = fen(src.property_fen, 'property_fen');
  if (propertyFen && propertyFen.error) return propertyFen;
  const laborFen = fen(src.labor_fen, 'labor_fen');
  if (laborFen && laborFen.error) return laborFen;
  const otherFen = fen(src.other_fen, 'other_fen');
  if (otherFen && otherFen.error) return otherFen;
  const simAmortFen = (src.include_amort) ? fen(src.sim_amort_fen, 'sim_amort_fen') : 0;
  if (simAmortFen && simAmortFen.error) return simAmortFen;
  const targetProfitFen = fen(src.target_profit_fen, 'target_profit_fen');
  if (targetProfitFen && targetProfitFen.error) return targetProfitFen;

  // 变效率：有限数 ∊ [0,100]（百分比）
  const pct = (v, name) => {
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) {
      return err(`${name} 必须是 ∈ [0,100] 的 number（%）`);
    }
    return v;
  };
  const varFoodPct = pct(src.var_food_pct, 'var_food_pct');
  if (varFoodPct && varFoodPct.error) return varFoodPct;
  const varMktPct = pct(src.var_mkt_pct, 'var_mkt_pct');
  if (varMktPct && varMktPct.error) return varMktPct;
  const varOtherPct = pct(src.var_other_pct, 'var_other_pct');
  if (varOtherPct && varOtherPct.error) return varOtherPct;

  return {
    error: null,
    shop_id: src.shop_id,
    clean: {
      rentFen, propertyFen, laborFen, otherFen,
      includeAmort: !!src.include_amort, simAmortFen,
      varFoodPct, varMktPct, varOtherPct,
      targetProfitFen,
    },
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };