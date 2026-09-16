// pages/month/index.js —— 批次 4 · M1 月度经营首页
// 月份选择器 + 双口径 tab + 结果卡 + 待归档徽标 + 结账归档。
// ⚠️ 计算下沉：金额一律取 getLedger 返回的整数「分」，前端仅展示不计算。
// ⚠️ 付费 tab：仅展示后端返回的真实利润与 freeHint，**点击不触发付费弹窗**（交互边界：非保存超限/导出）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();

Page({
  data: {
    t: {
      m1: TERMS.modules.m1.display,
      freeTab: TERMS.m1Tabs.free.display,
      paidTab: TERMS.m1Tabs.paid.display,
      freeHint: TERMS.freeHint,
      loading: TERMS.ui.loading,
      month: TERMS.ui.month,
      cur: '¥',
      totalRevenue: TERMS.ui.totalRevenue,
      totalExpense: TERMS.ui.totalExpense,
      grossProfit: TERMS.ui.grossProfit,
      netRef: TERMS.ui.netRef,
      netTrue: TERMS.ui.netTrue,
      profitDiff: TERMS.ui.profitDiff,
      pendingArchive: TERMS.ui.pendingArchive,
      archivedLock: TERMS.ui.archivedLock,
      graceArchive: TERMS.ui.graceArchive,
      goInput: TERMS.nav.goInput,
      goInventory: TERMS.nav.goInventory,
      goAmortize: TERMS.nav.goAmortize,
      goResult: TERMS.nav.goResult,
      archiveNow: TERMS.nav.archiveNow,
      confirmArchive: TERMS.ui.confirmArchive,
      history: TERMS.ui.history,
    },
    months: [],              // 可选月份（倒序）
    curMonth: '',
    tab: 'free',
    isArchive: false,
    archivedAtMs: 0,
    canArchive: false,
    switches: {},
    result: null,
    loading: true,
  },

  onShow() { this.bootstrap(); },

  async bootstrap() {
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.modules.m1.display);
      const cur = this.data.curMonth || ui.nowMonth();
      const ml = await api.call('getMonthList', {});
      let months = (ml.list || []).map((m) => m.month);
      if (!months.includes(cur)) months.push(cur);
      months = months.sort().reverse();
      await this.loadMonth(cur);
      this.setData({ months, curMonth: cur, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  async loadMonth(month) {
    try {
      const d = await api.call('getLedger', { month });
      // 统一用服务端读回的开关（getLedger 返回的 switches 为权威）
      const sw = d.switches || app.globalData.switches;
      // ⚠️ 计算下沉：金额一律由后端返回分整数，此处仅格式化展示（分→元），不做任何业务计算
      const r = d.result || null;
      const fmt = (v) => (v == null ? '0.00' : api.fenToYuan(v, 2));
      this.setData({
        curMonth: month,
        isArchive: !!d.is_archive,
        archivedAtMs: d.archived_at || 0,
        switches: sw,
        result: r ? {
          income_total_fen: r.income_total_fen,
          expense_total_fen: r.expense_total_fen,
          gross_profit_fen: r.gross_profit_fen,
          gross_margin_pct: r.gross_margin_pct,
          operation_ref_profit_fen: r.operation_ref_profit_fen,
          total_factor_real_profit_fen: r.total_factor_real_profit_fen,
          profit_diff_fen: r.profit_diff_fen,
          // 展示用格式化值
          income_total: fmt(r.income_total_fen),
          expense_total: fmt(r.expense_total_fen),
          gross_profit: fmt(r.gross_profit_fen),
          ref_profit: fmt(r.operation_ref_profit_fen),
          true_profit: fmt(r.total_factor_real_profit_fen),
          profit_diff: fmt(r.profit_diff_fen),
        } : null,
        tab: this.data.tab,
      });
      // 归档状态：次月 1 日起软提示（待归档徽标）；归档月只读标识
      const canArchive = !d.is_archive && !!d.account_id;
      this.setData({ canArchive });
    } catch (e) { api.toastError(e); }
  },

  onMonthChange(e) {
    const month = e.detail.value;
    this.setData({ loading: true });
    this.loadMonth(month).then(() => this.setData({ loading: false }));
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
    // ⚠️ 不触发付费弹窗（交互边界）
  },

  goInput() { wx.navigateTo({ url: '/pages/month/input?month=' + this.data.curMonth }); },
  goInventory() { wx.navigateTo({ url: '/pages/month/inventory?month=' + this.data.curMonth }); },
  goAmortize() { wx.navigateTo({ url: '/pages/month/amortize?month=' + this.data.curMonth }); },
  goResult() { wx.navigateTo({ url: '/pages/month/result?month=' + this.data.curMonth }); },

  onArchive() {
    wx.showModal({
      title: TERMS.nav.archiveNow,
      content: TERMS.ui.confirmArchive,
      confirmColor: '#ff6b35',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.call('archiveMonth', { month: this.data.curMonth, archive: true });
          wx.showToast({ title: TERMS.nav.archiveNow, icon: 'success' });
          this.loadMonth(this.data.curMonth);
        } catch (e) { api.toastError(e); }
      },
    });
  },

  onPullDownRefresh() { this.bootstrap().then(() => wx.stopPullDownRefresh()); },
});