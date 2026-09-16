// 批次 0 §2.11：wx.cloud.init 只允许从 config/env.js 取值（core/06 §1.3.1 铁律）。
// ❌ 禁止在此硬编码 'catering-dev' / 'catering-prod' 等环境 ID 字面量。
// 批次 7 §2.10（隐私合规硬门槛）：首次启动隐私协议弹窗 + onNeedPrivacyAuthorization 回调。
//   · 同会话最多弹 2 次，拒绝后不反复骚扰；
//   · 未同意前不调用隐私相关接口（本工具仅 wx.cloud，无手机号/位置等敏感接口）；
//   · 文案取自 miniprogram/i18n/terms.js（不硬编码）。
const env = require('./miniprogram/config/env.js');

App({
  globalData: {
    shop_id: '',          // 店铺 ID（页面首次 getShopContext 后写入；所有请求自动携带 commit）
    shop_name: '',
    switches: { inventorySwitchOn: false, amortizeSwitchOn: false },
    privacyAsked: 0,      // 本会话已弹隐私协议次数（≤2，§2.10）
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: env.getEnv(), traceUser: true });
    } else {
      console.error('[cloud] wx.cloud 未就绪');
    }
    this.setupPrivacy();
  },

  // 隐私合规（批次 7 §2.10）：
  //   1) getPrivacySetting 判断是否需授权；
  //   2) onNeedPrivacyAuthorization 注册回调，在系统触发时弹出我们的引导弹窗；
  //   3) requirePrivacyAuthorize 主动拉起授权（首启需授权时）；
  //   4) 同会话最多 2 次；未同意不阻塞（本工具可跳过，功能按免费档展示）。
  setupPrivacy() {
    const app = this;
    // 注册系统隐私回调（组件/接口被调用时系统触发）
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        app.askPrivacy(resolve);
      });
    }
    // 首启：查询是否需要授权（有隐私接口调用史时系统返回 need）
    if (wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success: (res) => {
          if (res && res.needAuthorization) app.askPrivacy(null);
        },
        fail: () => { /* 低版本/无权限时静默跳过，不阻塞启动 */ },
      });
    }
  },

  // 弹出隐私协议引导（同会话 ≤2 次；不绑定其他业务，可跳过）
  askPrivacy(resolve) {
    const app = this;
    if (app.globalData.privacyAsked >= 2) {
      if (typeof resolve === 'function') resolve({ buttonId: 'disagree', event: '' });
      return;
    }
    app.globalData.privacyAsked += 1;
    const TERMS = require('./miniprogram/i18n/terms.js').TERMS;
    wx.showModal({
      title: TERMS.exp.privacyTitle,
      content: TERMS.exp.privacyDesc,
      confirmText: TERMS.exp.privacyAgree,
      cancelText: TERMS.exp.privacyDisagree,
      confirmColor: '#ff6b35',
      success: (r) => {
        if (r.confirm) {
          // 主动拉起系统授权（同会话首次）
          if (wx.requirePrivacyAuthorize) {
            wx.requirePrivacyAuthorize({ fail: () => {} });
          }
          if (typeof resolve === 'function') resolve({ buttonId: 'agree', event: '' });
        } else if (typeof resolve === 'function') {
          resolve({ buttonId: 'disagree', event: '' });
        }
      },
      fail: () => {
        if (typeof resolve === 'function') resolve({ buttonId: 'disagree', event: '' });
      },
    });
  },

  // 供 pages 设置/读取当前店铺上下文
  setShopContext(ctx) {
    this.globalData.shop_id = ctx.shop_id || '';
    this.globalData.shop_name = ctx.shop_name || '';
    this.globalData.switches = ctx.switches || { inventorySwitchOn: false, amortizeSwitchOn: false };
  },
});