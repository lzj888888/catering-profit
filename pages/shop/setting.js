// pages/shop/setting.js —— 批次 4 · 店铺设置页（店铺名/备注 + 库存/摊销开关）
//
// ⚠️ 店铺开关以服务端 shop_switch 为准（getShopContext 读回）；本页写入走 saveShopSetting，
//   保存后重新 getShopContext 同步全局。前端**不自行切换计算口径**。
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
      inventorySwitch: TERMS.settings.inventorySwitch,
      inventorySwitchDesc: TERMS.settings.inventorySwitchDesc,
      amortizeSwitch: TERMS.settings.amortizeSwitch,
      amortizeSwitchDesc: TERMS.settings.amortizeSwitchDesc,
      save: TERMS.settings.save,
      saved: TERMS.settings.saved,
      loading: TERMS.ui.loading,
    },
    shopName: '',
    remark: '',
    inventoryOn: false,
    amortizeOn: false,
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
        inventoryOn: !!(ctx.switches && ctx.switches.inventorySwitchOn),
        amortizeOn: !!(ctx.switches && ctx.switches.amortizeSwitchOn),
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onName(e) { this.setData({ shopName: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },
  onInventory(e) { this.setData({ inventoryOn: e.detail.value }); },
  onAmortize(e) { this.setData({ amortizeOn: e.detail.value }); },

  async onSave() {
    try {
      await api.call('saveShopSetting', {
        name: this.data.shopName,
        remark: this.data.remark,
        switches: { inventory: this.data.inventoryOn, amortize: this.data.amortizeOn },
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