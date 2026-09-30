// cloudfunctions/saveShopSetting/service.js —— 纯常量（与 getShopContext 同款开关键，防漂移）。
const { ERROR_CODES } = require('./common');

const SWITCH_KEYS = {
  inventory: 'inventory_switch',
  amortize: 'amortize_switch',
  // M3.17（批次 D）：外卖平台参数默认值 —— 值 = JSON 字符串（存 shop_switch.value 字段，非 enabled 布尔）。
  takeawayParams: 'm3_takeaway_params',
  // M3.21（批次 E）：本月在售菜品数（对账覆盖率分母）—— 值 = 数字字符串（存 shop_switch.value）。
  menuDishCount: 'm3_menu_dish_count',
};

module.exports = { SWITCH_KEYS, ERROR_CODES };