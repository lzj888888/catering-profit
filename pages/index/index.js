// pages/index/index.js —— 批次 4 · 模块入口首页
// 首次进入拉 getShopContext（店铺 + 服务端权威开关），写入 app.globalData 后供全站请求携带 shop_id。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();

Page({
  data: {
    t: {
      m1: TERMS.modules.m1.display,
      m1Sub: TERMS.modules.m1.subtitle,
      m2: TERMS.modules.m2.display,
      m2Sub: TERMS.modules.m2.subtitle,
      m3: TERMS.modules.m3.display,
      m3Sub: TERMS.modules.m3.subtitle,
      addShop: TERMS.buttons.addShop,
      shopName: TERMS.ui.shopName,
      defaultShopName: TERMS.ui.defaultShopName,
      settings: TERMS.ui.settings,
      loading: TERMS.ui.loading,
    },
    shopName: '',
    loading: true,
  },

  onShow() { this.bootstrap(); },

  async bootstrap() {
    ui.setTitle(TERMS.app.title);
    this.setData({ loading: true });
    try {
      const ctx = await api.call('getShopContext', {});
      app.setShopContext(ctx);
      this.setData({ shopName: ctx.shop_name || '', loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: (e && e.msg) || TERMS.ui.loadFailed, icon: 'none' });
    }
  },

  goMonth() { wx.navigateTo({ url: '/pages/month/index' }); },
  goSandbox() { wx.navigateTo({ url: '/pages/sandbox/index' }); },
  goCard() { wx.navigateTo({ url: '/pages/card/index' }); },
  goSettings() { wx.navigateTo({ url: '/pages/shop/setting' }); },
});