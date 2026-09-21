// pages/month/index.js —— 批次 4/5 · M1 月度经营首页
// 月份选择器 + 双口径 tab + 结果卡 + 待归档徽标 + 结账归档。
// ⚠️ 计算下沉：金额一律取 getLedger 返回的整数「分」，前端仅展示不计算。
// ⚠️ 批次 5 权限 tab（§2.1.1/§2.4）：免费用户只见「经营参考估算」；付费用户（expire_at 有效）见双 tab。
//   · 前端只读 payQueryEntitlement 的 expire_at/is_active，不读 plan_id；
//   · **切换 tab 不触发付费弹窗**（交互边界：仅保存超限/导出触发）；
//   · 到期前 7 天展示常驻提示条（双渠道之一，订阅消息为另一渠道）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const entitle = require('../../utils/entitlement.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();

Page({
  data: {
    t: {
      m1: TERMS.modules.m1.navTitle,
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
      expireSoonTitle: TERMS.pay.expireSoonTitle,
      renewEntry: TERMS.pay.renewEntry,
      goOrders: TERMS.pay.goOrders,
      expiredLocked: TERMS.pay.expiredLocked,
      monthEmpty: TERMS.uiFix.monthEmpty,
    },
    months: [],              // 可选月份（倒序）
    curMonth: '',
    tab: 'free',
    isPaid: false,           // 权限判定（只读 expire_at / is_active）
    expireSoonDays: 0,       // 到期前 7 天内天数（0 = 不提示）
    expireSoonText: '',      // 预计算提示文案（WXML 不支持函数调用）
    isExpired: false,        // 曾付费但已过期 → 回落到免费档 + 提示
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
      ui.setTitle(TERMS.modules.m1.navTitle);
      // 批次 5：拉权限（只读 expire_at），免费用户 tab 锁定在 free
      let ent = null;
      try { ent = await entitle.fetchEntitlement(); } catch (e) { /* 权限查询失败回落免费档 */ }
      const isPaid = entitle.isPaid(ent);
      const expireSoonDays = entitle.expireSoonDays(ent);
      const isExpired = !!(ent && ent.expire_at > 0 && !isPaid);
      this.setData({
        isPaid,
        expireSoonDays,
        expireSoonText: expireSoonDays > 0 ? TERMS.pay.expireSoonBody(expireSoonDays) : '',
        isExpired,
        tab: isPaid ? (this.data.tab === 'paid' ? 'paid' : 'free') : 'free',
      });
      const cur = this.data.curMonth || ui.nowMonth();
      const ml = await api.call('getMonthList', {});
      // 月份下拉 = 滚动窗口（最近 24 个月）∪ 已建档月份 ∪ 当前月，倒序去重。
      // 🔴 不能只用 getMonthList：它只返回「已建档」月份（shop_monthly_account 有行）⇒ 新店首次只剩当月，
      //    想补录上个月连选项都没有（李老师真机反馈「月份选择 只有两个月份」）。单源 = utils/ui.recentMonths。
      const months = Array.from(new Set(
        ui.recentMonths(24)
          .concat((ml.list || []).map((m) => m.month))
          .concat([cur])
          .filter(Boolean),
      )).sort().reverse();
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
  goOrders() { wx.navigateTo({ url: '/pages/pay/orders' }); },

  onArchive() {
    wx.showModal({
      title: TERMS.nav.archiveNow,
      content: TERMS.ui.confirmArchive,
      confirmColor: '#1e3a5f',
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