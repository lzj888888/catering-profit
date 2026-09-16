// pages/month/result.js —— 批次 4 · M1 结果展示页（收入/费用/毛利/毛利率/双利润/差异）
//
// ⚠️ 计算下沉：所有数值来自 getLedger 后端重算返回的分整数，前端仅格式化展示（分→元）。
// ⚠️ 归档态展示：归档月显示只读提示，不提供任何编辑入口。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      title: TERMS.resultPage.title,
      monthTotal: TERMS.resultPage.monthTotal,
      income: TERMS.resultPage.income,
      expense: TERMS.resultPage.expense,
      grossProfit: TERMS.resultPage.grossProfit,
      grossMargin: TERMS.resultPage.grossMargin,
      materialCost: TERMS.resultPage.materialCost,
      realConsume: TERMS.resultPage.realConsume,
      effectiveAmortize: TERMS.resultPage.effectiveAmortize,
      refProfit: TERMS.resultPage.refProfit,
      trueProfit: TERMS.resultPage.trueProfit,
      profitDiff: TERMS.resultPage.profitDiff,
      refNote: TERMS.resultPage.refNote,
      trueNote: TERMS.resultPage.trueNote,
      archiveLocked: TERMS.resultPage.archiveLocked,
      loading: TERMS.ui.loading,
      cur: '¥',
      pendingArchive: TERMS.ui.pendingArchive,
    },
    month: '',
    isArchive: false,
    loading: true,
    r: null,       // 展示用已格式化数据
  },

  onLoad(q) {
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.resultPage.title);
      const d = await api.call('getLedger', { month: this.data.month });
      const res = d.result || {};
      const fen = (v) => api.fenToYuan(v || 0, 2);
      this.setData({
        isArchive: !!d.is_archive,
        r: {
          income: fen(res.income_total_fen),
          expense: fen(res.expense_total_fen),
          grossProfit: fen(res.gross_profit_fen),
          grossMargin: res.gross_margin_pct != null ? res.gross_margin_pct : '—',
          materialCost: fen(res.material_cost_fen),
          realConsume: fen(res.real_consume_fen),
          effectiveAmortize: fen(res.effective_amortize_fen),
          refProfit: fen(res.operation_ref_profit_fen),
          trueProfit: fen(res.total_factor_real_profit_fen),
          profitDiff: fen(res.profit_diff_fen),
        },
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});