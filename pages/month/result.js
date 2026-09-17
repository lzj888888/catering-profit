// pages/month/result.js —— 批次 4/5 · M1 结果展示页（收入/费用/毛利/毛利率/双利润/差异）
//
// ⚠️ 计算下沉：所有数值来自 getLedger 后端重算返回的分整数，前端仅格式化展示（分→元）。
// ⚠️ 批次 5 · 到期提醒双渠道：① 结果页**常驻提示条**（到期前 7 天内，读 payQueryEntitlement 的
//   days_left，前端只读 expire_at 系）；② 订阅消息（请求授权，用户拒绝不影响常驻条兜底）。
// ⚠️ 归档态展示：归档月显示只读提示，不提供任何编辑入口。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const entitle = require('../../utils/entitlement.js');
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
      expireSoonTitle: TERMS.pay.expireSoonTitle,
      renewEntry: TERMS.pay.renewEntry,
      subscribeTip: TERMS.pay.subscribeTip,
      subscribeDenied: TERMS.pay.subscribeDenied,
      exportBtn: TERMS.exportBtn.m1Report,
      exportIng: TERMS.exp.exportIng,
      exportDone: TERMS.exp.exportDone,
      fileSaved: TERMS.exp.fileSaved,
      viewFile: TERMS.exp.viewFile,
      resultEmpty: TERMS.uiFix.resultEmpty,
      resultEmptyGoInput: TERMS.uiFix.resultEmptyGoInput,
    },
    month: '',
    isArchive: false,
    loading: true,
    r: null,       // 展示用已格式化数据
    expireSoonDays: 0,
    expireSoonText: '',
    subscribeAsked: false,
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
      // 批次 5：到期前 7 天常驻提示条（双渠道兜底）
      try {
        const ent = await entitle.fetchEntitlement();
        const soon = entitle.expireSoonDays(ent);
        this.setData({ expireSoonDays: soon, expireSoonText: soon > 0 ? TERMS.pay.expireSoonBody(soon) : '' });
      } catch (e) { /* 权限查询失败不阻断结果页 */ }
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // 订阅消息授权（双渠道①）；拒绝不影响常驻提示条（兜底），提示一次即可
  onAskSubscribe() {
    if (this.data.subscribeAsked) return;
    this.setData({ subscribeAsked: true });
    wx.requestSubscribeMessage({
      tmplIds: [], // 模板 ID 由后端配置下发；当前阶段未配置 → 直接回落兜底
      success: () => {
        // 授权成功：后续到期前 7 天由 payExpireNotify 定时推送
      },
      fail: () => {
        wx.showToast({ title: TERMS.pay.subscribeDenied, icon: 'none' });
      },
    });
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
  goOrders() { wx.navigateTo({ url: '/pages/pay/orders' }); },
  goInput() { wx.navigateTo({ url: '/pages/month/input?month=' + this.data.month }); },

  // M1 报表导出：权限只读 expire_at（前端先查，后端 exportData 再兜底校验）；免费用户触发付费墙
  async onExport() {
    const ent = await require('../../utils/entitlement.js').fetchEntitlement().catch(() => null);
    if (!ent || !ent.is_active) {
      require('../../utils/paywall.js').openPaywall('export', {
        shopId: (getApp().globalData && getApp().globalData.shop_id) || '',
      });
      return;
    }
    await this.doExport();
  },

  async doExport() {
    wx.showLoading({ title: this.data.t.exportIng, mask: true });   // 进度提示：生成中不阻塞
    try {
      const d = await require('../../utils/api.js').call('exportData', {
        scope: 'm1_report',
        format: 'excel',
        month: this.data.month,
        client_request_id: 'ex_' + Date.now(),
      });
      wx.hideLoading();
      this.downloadContent(d.filename, d.content, d.format);
      wx.showToast({ title: this.data.t.exportDone, icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      require('../../utils/api.js').toastError(e);
    }
  },

  // 前端下载导出内容（Excel=CSV 文本；JSON 原样）
  downloadContent(filename, content, format) {
    const api = require('../../utils/api.js');
    if (format === 'json') {
      const fs = wx.getFileSystemManager();
      const tmp = `${wx.env.USER_DATA_PATH}/${filename}`;
      try { fs.writeFileSync(tmp, JSON.stringify(content)); } catch (e) { api.toastError(e); return; }
      wx.openDocument({ filePath: tmp, showMenu: true, fail: () => wx.showToast({ title: this.data.t.fileSaved, icon: 'none' }) });
      return;
    }
    // CSV/Excel：wx 无直接下载，落本地文件 + openDocument 预览（v1.0 简版）
    const fs = wx.getFileSystemManager();
    const tmp = `${wx.env.USER_DATA_PATH}/${filename}`;
    try {
      fs.writeFileSync(tmp, String(content), 'utf8');
      wx.openDocument({ filePath: tmp, showMenu: true, fileType: 'csv', fail: () => {} });
    } catch (e) { api.toastError(e); }
  },
});