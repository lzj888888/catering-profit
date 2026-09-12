// 批次 0 §2.11：wx.cloud.init 只允许从 config/env.js 取值（core/06 §1.3.1 铁律）。
// ❌ 禁止在此硬编码 'catering-dev' / 'catering-prod' 等环境 ID 字面量。
const env = require('./config/env.js');

App({
  globalData: {
    dishes: [],
    fixedCosts: { rent: 0, labor: 0, utility: 0 }
  },
  onLaunch() {
    // 初始化云开发：环境 ID 单一来源 = config/env.js
    if (wx.cloud) {
      wx.cloud.init({ env: env.getEnv(), traceUser: true });
    } else {
      console.error('[cloud] wx.cloud 未就绪');
    }
    this.globalData.dishes = wx.getStorageSync('dishes') || [];
    this.globalData.fixedCosts = wx.getStorageSync('fixedCosts') || { rent: 0, labor: 0, utility: 0 };
  }
});
