// pages/shop/switch.js —— 批次 7 · 店铺切换页
//
// ⚠️ 店铺切换器（§2.3/§2.7）：
//   · 列表仅含 is_deleted=false（getShopList 后端过滤）；
//   · 选中 shop_id 持久化本地缓存，下次进入默认打开上次店铺；
//   · **切换永不触发付费弹窗**；仅「新增店铺保存」超限时（getShopList.hit_free_limit）由保存动作触发。
// ⚠️ 多店铺数据隔离：切换即写 app.globalData.shop_id（api.js 自动带新 shop_id），所有查询强制带。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const sw = require('../../utils/shopSwitcher.js');
const { openPaywall } = require('../../utils/paywall.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();

Page({
  data: {
    t: {
      title: TERMS.exp.switchTitle,
      currentShop: TERMS.exp.currentShop,
      noShop: TERMS.exp.noShop,
      addShop: TERMS.exp.addShop,
      switchHint: TERMS.exp.switchHint,
      loading: TERMS.ui.loading,
    },
    list: [],
    currentShopId: '',
    used: 0,
    freeLimit: 1,
    hitFreeLimit: false,
    loading: true,
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.exp.switchTitle);
      const d = await sw.fetchShopList();
      const currentShopId = app.globalData.shop_id || '';
      // 持久化恢复：上次店铺存在 → 切回（若当前为空）
      if (!currentShopId && d.list.length > 0) {
        const restored = await sw.restoreLastShop(d.list);
        if (!restored) sw.switchShop(d.list[0].shop_id);
      }
      this.setData({
        list: d.list,
        currentShopId: app.globalData.shop_id || '',
        used: d.used,
        freeLimit: d.free_limit,
        hitFreeLimit: d.hit_free_limit,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onSelect(e) {
    const shopId = e.currentTarget.dataset.id;
    if (!shopId || shopId === this.data.currentShopId) return;
    // ⚠️ 切换永不触发付费弹窗（交互边界）
    sw.switchShop(shopId);
    this.setData({ currentShopId: shopId });
    wx.showToast({ title: TERMS.exp.switchTitle, icon: 'success' });
    setTimeout(() => wx.navigateBack(), 400);
  },

  // 新增店铺（保存动作才可能触发付费墙；本页切换列表不弹）
  onAdd() {
    // 若已达免费上限（1 家），新增即保存超限 → 触发付费墙；否则引导去设置页新建
    if (this.data.hitFreeLimit) {
      openPaywall('saveLimit', { shopId: this.data.currentShopId || '' });
      return;
    }
    wx.navigateTo({ url: '/pages/shop/setting' });
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});