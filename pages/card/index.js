// pages/card/index.js —— 批次 4/5 · M3 成本卡列表
// ⚠️ 批次 5 付费边界：只有「保存超限（第 4 张卡）」「导出」才触发付费弹窗；
//   进入页面/查看历史/点开卡片**不弹**；M2 永不弹（本页即 M3，仅上述两类）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { openPaywall } = require('../../utils/paywall.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      listTitle: TERMS.card.listTitle,
      addCard: TERMS.buttons.addCostCard,
      totalCost: TERMS.card.totalCost,
      price: TERMS.card.price,
      grossMargin: TERMS.card.grossMargin,
      version: TERMS.card.version,
      viewVersion: TERMS.nav.viewVersion,
      syncPrice: TERMS.nav.syncPrice,
      empty: TERMS.card.empty,
      hintAlways: TERMS.card.hintAlways,
      loading: TERMS.ui.loading,
      cur: '¥',
      calcModeA: TERMS.card.calcModeA,
      calcModeB: TERMS.card.calcModeB,
      export: TERMS.buttons.export,
      goOrders: TERMS.pay.goOrders,
    },
    list: [],
    loading: true,
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.listTitle);
      const d = await api.call('getCostCard', {});
      const list = (d.list || []).map((c) => ({
        card_code: c.card_code,
        version: c.version,
        name: c.name || '',
        total_cost: api.fenToYuan(c.total_cost_fen, 2),
        price: c.price_fen > 0 ? api.fenToYuan(c.price_fen, 2) : '—',
        margin: c.price_fen > 0 ? c.gross_margin_pct : null,
        calc_mode: c.calc_mode,
      }));
      this.setData({ list, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // 新增：先配额预检（免费 3 张，第 4 张触发付费墙；进列表不弹）
  async goAdd() {
    try {
      const q = await api.call('checkQuota', { scope: 'cost_card' });
      if (q.hit_free_limit) {
        openPaywall('saveLimit', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
        return;
      }
      if (q.hit_hard_limit) {
        api.toastError({ msg: TERMS.pay.contactServiceHint });
        return;
      }
      wx.navigateTo({ url: '/pages/card/edit?card_code=' });
    } catch (e) { api.toastError(e); }
  },
  goEdit(e) {
    const cc = e.currentTarget.dataset.code;
    wx.navigateTo({ url: '/pages/card/edit?card_code=' + (cc || '') });
  },
  goVersion(e) {
    const cc = e.currentTarget.dataset.code;
    wx.navigateTo({ url: '/pages/card/version?card_code=' + (cc || '') });
  },
  goOrders() { wx.navigateTo({ url: '/pages/pay/orders' }); },
  // 导出：付费功能，免费触发付费墙（M3 导出全禁）
  onExport() {
    openPaywall('export', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
  },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});