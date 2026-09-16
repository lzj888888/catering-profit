// cloudfunctions/saveShopSetting/service.js —— 纯常量（与 getShopContext 同款开关键，防漂移）。
const { ERROR_CODES } = require('./common');

const SWITCH_KEYS = { inventory: 'inventory_switch', amortize: 'amortize_switch' };

module.exports = { SWITCH_KEYS, ERROR_CODES };