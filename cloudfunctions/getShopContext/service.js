// cloudfunctions/getShopContext/service.js —— 纯函数：shop / switch 文档 → 出参。
const { ERROR_CODES } = require('./common');

// switch 键集合（与批次 1 calcMonthlyProfit readSwitches 一致）
const SWITCH_KEYS = { inventory: 'inventory_switch', amortize: 'amortize_switch' };

// 从 switch 行组出 { inventorySwitchOn, amortizeSwitchOn }
function switchesFromRows(rows) {
  return {
    inventorySwitchOn: !!((rows || []).find((r) => r.switch_key === SWITCH_KEYS.inventory) || {}).enabled,
    amortizeSwitchOn: !!((rows || []).find((r) => r.switch_key === SWITCH_KEYS.amortize) || {}).enabled,
  };
}

module.exports = { switchesFromRows, SWITCH_KEYS, ERROR_CODES };