// 批次 0 §2.11：wx.cloud.init 只允许从 config/env.js 取值（core/06 §1.3.1 铁律）。
// ❌ 禁止在此硬编码 'catering-dev' / 'catering-prod' 等环境 ID 字面量。
const env = require('./miniprogram/config/env.js');

App({
  globalData: {
    shop_id: '',          // 店铺 ID（页面首次 getShopContext 后写入；所有请求自动携带 commit）
    shop_name: '',
    switches: { inventorySwitchOn: false, amortizeSwitchOn: false },
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: env.getEnv(), traceUser: true });
    } else {
      console.error('[cloud] wx.cloud 未就绪');
    }
  },

  // 供 pages 设置/读取当前店铺上下文
  setShopContext(ctx) {
    this.globalData.shop_id = ctx.shop_id || '';
    this.globalData.shop_name = ctx.shop_name || '';
    this.globalData.switches = ctx.switches || { inventorySwitchOn: false, amortizeSwitchOn: false };
  },
});