// pages/recon/index.js —— M3.21 M1↔M3 率对率对账（只读对照，绝不写 M1）
//
// 数据：getLedger(month) 拿 M1 实际 + getCostCard() 拿全部卡 → 喂 utils/reconDerive.js。
// 🔴 只读：本页只调 getLedger / getCostCard / getShopContext / saveShopSetting，**绝不**调 saveLedger / archiveMonth 等 M1 写路径。
// 🔴 覆盖率分母：用户在页面上填「本月在售菜品数」，存 shop_switch（m3_menu_dish_count）；未填 ⇒ coverage null ⇒ 抑制。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const { calcMenuMargin, calcActualDishMargin, reconcile } = require('../../utils/reconDerive.js');

Page({
  data: {
    t: {
      reconTitle: TERMS.card.reconTitle,
      reconMenuMargin: TERMS.card.reconMenuMargin,
      reconActualMargin: TERMS.card.reconActualMargin,
      reconDiffPp: TERMS.card.reconDiffPp,
      reconDiffFen: TERMS.card.reconDiffFen,
      reconCoverage: TERMS.card.reconCoverage,
      reconCoveragePh: TERMS.card.reconCoveragePh,
      reconSave: TERMS.card.reconSave,
      reconIncludeCombo: TERMS.card.reconIncludeCombo,
      reconMonth: TERMS.card.reconMonth,
      reconSuppressCoverage: TERMS.card.reconSuppressCoverage,
      reconSuppressDetail: TERMS.card.reconSuppressDetail,
      reconSuppressNoCount: TERMS.card.reconSuppressNoCount,
      reconAttributionTitle: TERMS.card.reconAttributionTitle,
      reconAttr1: TERMS.card.reconAttr1,
      reconAttr2: TERMS.card.reconAttr2,
      reconAttr3: TERMS.card.reconAttr3,
      reconAttr4: TERMS.card.reconAttr4,
      cur: '¥',
      loading: TERMS.ui.loading,
      save: TERMS.buttons.save,
    },
    months: [],
    monthIndex: 0,
    curMonth: '',
    includeCombo: false,
    menuDishCount: '',   // 输入框字符串值
    savedDishCount: null, // 库内存的（null = 未填）
    result: null,        // { menuPct, actualPct, diffPp, diffFen, suppressed, reason, income_fen }
    loading: true,
    saving: false,
  },

  onLoad() { this.init(); },

  async init() {
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.reconTitle);
      const cur = ui.nowMonth();
      const ml = await api.call('getMonthList', {});
      const months = Array.from(new Set(
        ui.recentMonths(24).concat((ml.list || []).map((m) => m.month)).concat([cur]).filter(Boolean),
      )).sort().reverse();
      // 读本月在售菜品数（shop_switch）
      let savedDishCount = null;
      try {
        const sc = await api.call('getShopContext', {});
        savedDishCount = (sc.menu_dish_count == null) ? null : sc.menu_dish_count;
      } catch (e) { savedDishCount = null; }
      this.setData({
        months,
        curMonth: cur,
        savedDishCount,
        menuDishCount: savedDishCount == null ? '' : String(savedDishCount),
        loading: false,
      });
      this.calc(cur, savedDishCount);
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onMonthChange(e) {
    const i = Number(e.detail.value);
    const m = this.data.months[i];
    if (!m) return;
    this.setData({ monthIndex: i, curMonth: m });
    this.calc(m, this.data.savedDishCount);
  },
  onIncludeCombo(e) { this.setData({ includeCombo: e.detail.value }); this.calc(this.data.curMonth, this.data.savedDishCount); },
  onDishCount(e) { this.setData({ menuDishCount: e.detail.value }); },

  async calc(month, savedCount) {
    try {
      const [ledger, cardsRes] = await Promise.all([
        api.call('getLedger', { month }),
        api.call('getCostCard', {}),
      ]);
      const cards = (cardsRes.list || []).map((c) => ({
        card_type: c.card_type,
        price_fen: c.price_fen,
        total_cost_fen: c.total_cost_fen,
      }));
      const menu = calcMenuMargin(cards, { includeCombo: this.data.includeCombo });
      const actual = calcActualDishMargin(ledger);
      // 已建卡菜品数 = 非套餐卡数（套餐是引用型卡，不算独立菜品）
      const cardCount = cards.filter((c) => c.card_type !== 3).length;
      const coverage = (savedCount == null || savedCount <= 0) ? null : (cardCount / savedCount);
      const rec = reconcile({ menuPct: menu.pct, actualPct: actual.pct, coverage, incomeFen: actual.income_fen });
      // 抑制原因 → 文案（三种：未填在售数 / 覆盖率不足 / 外卖快速录入拆不出商品总价）
      let suppressText = '';
      if (rec.suppressed) {
        if (rec.reason === 'coverage_missing') suppressText = TERMS.card.reconSuppressNoCount;
        else if (rec.reason === 'coverage_low') suppressText = TERMS.card.reconSuppressCoverage;
        else if (actual.reason === 'need_detail_income') suppressText = TERMS.card.reconSuppressDetail;
        else suppressText = TERMS.card.reconSuppressCoverage;   // menu_no_price / actual_no_data 兜底
      }
      this.setData({
        result: {
          menuPct: menu.pct,
          actualPct: actual.pct,
          diffPp: rec.diffPp,
          diffFen: rec.diffFen,
          suppressed: rec.suppressed,
          reason: rec.reason,
          income_fen: actual.income_fen,
          coverage,
          suppressText,
          // 展示格式化（分→元、百分号拼接都在 js 做，wxml 只摆位）
          menuPctText: menu.pct == null ? '—' : (menu.pct.toFixed(2) + '%'),
          actualPctText: actual.pct == null ? '—' : (actual.pct.toFixed(2) + '%'),
          diffPpText: rec.diffPp == null ? '—' : (rec.diffPp.toFixed(2) + ' pp'),
          diffFenText: rec.diffFen == null ? '—' : api.fenToYuan(rec.diffFen, 2),
        },
      });
    } catch (e) { api.toastError(e); }
  },

  async onSaveCount() {
    const n = Number(this.data.menuDishCount);
    if (!Number.isInteger(n) || n < 0) { wx.showToast({ title: TERMS.card.reconCoveragePh, icon: 'none' }); return; }
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api.call('saveShopSetting', { menu_dish_count: n, client_request_id: 'mdc_' + Date.now() });
      this.setData({ savedDishCount: n, menuDishCount: String(n) });
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
      this.calc(this.data.curMonth, n);
    } catch (e) { api.toastError(e); }
    this.setData({ saving: false });
  },
});
