// cloudfunctions/getShopContext/service.js —— 纯函数：shop / switch 文档 → 出参。
const { ERROR_CODES } = require('./common');

// switch 键集合（与批次 1 calcMonthlyProfit readSwitches 一致）
const SWITCH_KEYS = { inventory: 'inventory_switch', amortize: 'amortize_switch', takeawayParams: 'm3_takeaway_params' };

// 从 switch 行组出 { inventorySwitchOn, amortizeSwitchOn }
function switchesFromRows(rows) {
  return {
    inventorySwitchOn: !!((rows || []).find((r) => r.switch_key === SWITCH_KEYS.inventory) || {}).enabled,
    amortizeSwitchOn: !!((rows || []).find((r) => r.switch_key === SWITCH_KEYS.amortize) || {}).enabled,
  };
}

// M3.17（批次 D）：读外卖平台参数默认值（JSON 字符串，存 shop_switch.value；缺行/缺值 ⇒ ''）
function takeawayParamsFromRows(rows) {
  const row = (rows || []).find((r) => r.switch_key === SWITCH_KEYS.takeawayParams);
  return (row && typeof row.value === 'string') ? row.value : '';
}

module.exports = { switchesFromRows, takeawayParamsFromRows, SWITCH_KEYS, ERROR_CODES };