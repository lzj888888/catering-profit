// pages/mine/index.js —— 批次 7 · 「我的」页（隐私协议 + 撤回授权 + 账号注销）
//
// ⚠️ 隐私合规（§2.10）：隐私协议查看 + 撤回授权入口；
// ⚠️ 账号注销（§2.11）：二次确认 → 调 deleteAccount（软删 user + 匿名化 PII）→ 清本地缓存退出。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const loading = require('../../utils/loading.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      title: TERMS.exp.mineTitle,
      account: TERMS.exp.account,
      logoutTitle: TERMS.exp.logoutTitle,
      logoutConfirm: TERMS.exp.logoutConfirm,
      logoutDone: TERMS.exp.logoutDone,
      cancelLogout: TERMS.exp.cancelLogout,
      privacyOpen: TERMS.exp.privacyOpen,
      privacyRevoke: TERMS.exp.privacyRevoke,
      privacyRevoked: TERMS.exp.privacyRevoked,
      privacyDesc: TERMS.exp.privacyDesc,
      privacyTitle: TERMS.exp.privacyTitle,
      dataCleanNote: TERMS.exp.dataCleanNote,
      cancel: TERMS.buttons.cancel,
      shopName: TERMS.ui.shopName,
      goSetting: TERMS.exp.goSetting,
    },
    shopName: '',
    loadingLogout: false,
  },

  onShow() {
    ui.setTitle(TERMS.exp.mineTitle);
    const app = getApp();
    this.setData({ shopName: (app.globalData && app.globalData.shop_name) || '' });
  },

  // 查看隐私协议
  onOpenPrivacy() {
    wx.showModal({
      title: TERMS.exp.privacyTitle,
      content: TERMS.exp.privacyDesc,
      showCancel: false,
      confirmText: TERMS.buttons.thinkAgain || '知道了',
      confirmColor: '#ff6b35',
    });
  },

  // 撤回授权：调 wx.requirePrivacyAuthorize? 实际「撤回」用 wx.openPrivacyContract + 引导去设置；
  // 小程序侧撤回=引导到「设置」取消隐私授权（wx.openSetting）。展示入口即可。
  onRevokePrivacy() {
    wx.showModal({
      title: TERMS.exp.privacyRevoke,
      content: TERMS.exp.privacyRevoked,
      confirmText: TERMS.exp.goSetting,
      cancelText: TERMS.buttons.cancel,
      confirmColor: '#ff6b35',
      success(res) {
        if (res.confirm) wx.openSetting({});
      },
    });
  },

  // 注销账号（二次确认 + loading + 防重复提交 + 幂等）
  onLogout() {
    wx.showModal({
      title: TERMS.exp.logoutTitle,
      content: TERMS.exp.logoutConfirm,
      confirmText: TERMS.exp.logoutTitle,
      cancelText: TERMS.exp.cancelLogout,
      confirmColor: '#e74c3c',
      success: (r) => {
        if (r.confirm) this.doLogout();
      },
    });
  },

  async doLogout() {
    await loading.withLock(this, 'logout', async () => {
      try {
        await api.call('deleteAccount', { client_request_id: 'acc_' + Date.now() });
        // 清本地缓存 + 退出
        wx.clearStorageSync();
        const app = getApp();
        if (app && app.globalData) app.globalData.shop_id = '';
        wx.showToast({ title: TERMS.exp.logoutDone, icon: 'none', duration: 3000 });
        setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200);
      } catch (e) {
        api.toastError(e);
      }
    });
  },

  onPullDownRefresh() { this.onShow(); wx.stopPullDownRefresh(); },
});