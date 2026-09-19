// pages/shop/setting.js —— 批次 4 · 店铺设置页（店铺名 / 备注）
//
// ⚠️ 2026-09-20：库存 / 摊销开关**已迁出本页**，改到「月度录入」页就地二选一
//   （pages/month/input）—— 真机走查发现老板在设置页看不懂「库存核算 / 摊销核算」这类词，
//   放到真正要用到的计算步骤旁边才有意义。单源落点 = pages/month/input.wxml 的核算方式区。
// ⚠️ 本页保存时**不传 switches**（未传 = 不动库），不会覆盖那边的选择；
//   店铺名/备注仍以服务端为准（getShopContext 读回）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();

Page({
  data: {
    t: {
      title: TERMS.settings.title,
      shopName: TERMS.settings.shopName,
      shopNamePh: TERMS.settings.shopNamePh,
      remark: TERMS.settings.remark,
      remarkPh: TERMS.settings.remarkPh,
      // 核算方式（库存 / 摊销）已迁至 pages/month/input —— 本页不再提供开关
      calcMoved: TERMS.calcMethod.movedNote,
      save: TERMS.settings.save,
      saved: TERMS.settings.saved,
      loading: TERMS.ui.loading,
    },
    shopName: '',
    remark: '',
    loading: true,
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.settings.title);
      const ctx = await api.call('getShopContext', {});
      app.setShopContext(ctx);
      this.setData({
        shopName: ctx.shop_name || '',
        remark: ctx.shop_remark || '',
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onName(e) { this.setData({ shopName: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  async onSave() {
    try {
      await api.call('saveShopSetting', {
        name: this.data.shopName,
        remark: this.data.remark,
        // 🔴 不再传 switches：本页不掌管核算方式（已迁至月度录入页）。
        //    saveShopSetting 对未传字段视为「不动库」，传错才会覆盖那边的选择。
        client_request_id: 'ss_' + Date.now(),
      });
      // 保存后重拉上下文，同步全局（服务端为准）
      const ctx = await api.call('getShopContext', {});
      app.setShopContext(ctx);
      wx.showToast({ title: TERMS.settings.saved, icon: 'success' });
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});