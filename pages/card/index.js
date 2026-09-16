// pages/card/index.js —— M3 成本卡列表
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
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

  goAdd() { wx.navigateTo({ url: '/pages/card/edit?card_code=' }); },
  goEdit(e) {
    const cc = e.currentTarget.dataset.code;
    wx.navigateTo({ url: '/pages/card/edit?card_code=' + (cc || '') });
  },
  goVersion(e) {
    const cc = e.currentTarget.dataset.code;
    wx.navigateTo({ url: '/pages/card/version?card_code=' + (cc || '') });
  },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});