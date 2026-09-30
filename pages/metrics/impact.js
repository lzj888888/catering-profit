// pages/metrics/impact.js —— M3.19 原料变动影响面（只展示、绝不自动改卡）
//
// 数据来自 api.call('syncCostCard', { material_id, dry_run: true })。dry_run = 只读预览：
//   列出所有用到该原料的成本卡、按最新价重算的新成本/新毛利率、是否跌破业态参考带下限。
// 🔴 本页**只展示**，绝不出现「一键改卡 / 应用新价」按钮 —— 改卡只能由用户在列表页手动走「同步至最新价」。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      impactTitle: TERMS.card.impactTitle,
      impactEmpty: TERMS.card.impactEmpty,
      impactCard: TERMS.card.impactCard,
      impactPrice: TERMS.card.impactPrice,
      impactCostChange: TERMS.card.impactCostChange,
      impactMargin: TERMS.card.impactMargin,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    material_id: '',
    material_name: '',
    affected: [],
    loading: true,
  },

  onLoad(q) {
    this.setData({ material_id: (q && q.material_id) || '', material_name: (q && q.name) || '' });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.impactTitle);
      const d = await api.call('syncCostCard', {
        material_id: this.data.material_id,
        dry_run: true,
        client_request_id: 'mimp_' + Date.now(),
      });
      const affected = (d.affected || []).map((a) => ({
        card_code: a.card_code,
        name: a.name || '',
        price: a.price_fen > 0 ? api.fenToYuan(a.price_fen, 2) : '—',
        old_cost: api.fenToYuan(a.old_total_cost_fen, 2),
        new_cost: api.fenToYuan(a.new_total_cost_fen, 2),
        old_margin: a.old_gross_margin_pct != null ? a.old_gross_margin_pct.toFixed(1) : '—',
        new_margin: a.new_gross_margin_pct != null ? a.new_gross_margin_pct.toFixed(1) : '—',
        margin_delta: (a.old_gross_margin_pct != null && a.new_gross_margin_pct != null)
          ? (a.new_gross_margin_pct - a.old_gross_margin_pct).toFixed(1) : '—',
        below_band: !!a.below_band,
        band_floor: a.band_floor_pct != null ? a.band_floor_pct : 0,
        band_hint: a.below_band ? TERMS.card.impactBelowBand(a.band_floor_pct) : '',
      }));
      this.setData({ affected, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
