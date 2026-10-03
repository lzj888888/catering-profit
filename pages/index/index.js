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
      tipMore: TERMS.ui.tipMore,
      switchShop: TERMS.exp.switchTitle,
      mine: TERMS.exp.mineTitle,
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
  // R191：M3 入口改指向**枢纽页**（pages/m3/hub），不再直接落进成本卡列表页。
  //   原因：原料库 / 外卖 / 对账 此前只能寄生在列表页顶部当按钮 ⇒ 分类说不明白。
  //   枢纽页只做「去哪」，列表页只做「找东西 + 新增」。
  // 🔴 R199：`pages/m3/hub` 已改为**底部 tabBar 页** ⇒ `wx.navigateTo` 到 tabBar 页会**失败**
  //   （微信限制：tabBar 页只能 `switchTab`，且不能带参数）。故改用 `wx.switchTab`。
  //   同理 `goMine()`（`pages/mine/index` 也在 tabBar 里）。
  goCard() { wx.switchTab({ url: '/pages/m3/hub' }); },
  goSettings() { wx.navigateTo({ url: '/pages/shop/setting' }); },
  goSwitch() { wx.navigateTo({ url: '/pages/shop/switch' }); },
  goMine() { wx.switchTab({ url: '/pages/mine/index' }); },

  // R193：全局开了 enablePullDownRefresh，但本页**没实现** ⇒ 下拉转圈、松手没反应（假刷新）。
  onPullDownRefresh() { this.bootstrap().then(() => wx.stopPullDownRefresh()); },
});