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
      subItem: TERMS.ledger.subItem,
      // round115：行业指标对照 —— 文案复用 M2 术语（indNames/indLevels/indLevelsGain/indBand/indMine），
      // 本页只新增「区块标题 + 缺项说明 + 两项口径小字 + 默认范围提示」这几条 M1 特有文案。
      indTitle: TERMS.resultPage.indTitle,
      indSub: TERMS.resultPage.indSub,
      indMissing: TERMS.resultPage.indMissing,
      indMarginNote: TERMS.resultPage.indMarginNote,
      indMktNote: TERMS.resultPage.indMktNote,
      indScopeTip: TERMS.resultPage.indScopeTip,
      indScopeChange: TERMS.resultPage.indScopeChange,
      indBand: TERMS.m2.indBand,
      indMine: TERMS.m2.indMine,
      indNames: TERMS.m2.indNames,
      indLevels: TERMS.m2.indLevels,
      indLevelsGain: TERMS.m2.indLevelsGain,
      indGainKey: TERMS.m2.indGainKey,
    },
    month: '',
    isArchive: false,
    loading: true,
    r: null,       // 展示用已格式化数据
    incDetail: [],
    expDetail: [],
    showIncDrill: false,
    showExpDrill: false,
    expireSoonDays: 0,
    expireSoonText: '',
    subscribeAsked: false,
    // round115：行业指标对照（后端出 pct/lo/hi/level，中文名与评级文案在前端补）
    inds: [],
    scope: {},
    bizTypes: TERMS.m2.bizTypes,
    cityTiers: TERMS.m2.cityTiers,
    bizIdx: 1,      // 默认「中式正餐」（bizTypes[1]），与后端 bandOf 的兜底口径一致
    cityIdx: 1,     // 默认「二三线」（cityTiers[1]）
    bizText: '',
    cityText: '',
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
      // D1：保存原始明细（snake_case，含 sub_items），供下钻面板展示（前端不重算金额）
      const incDetail = this.buildDetail(d.income_items || []);
      const expDetail = this.buildDetail(d.expense_items || []);
      // round115：行业指标对照 —— 后端只回 key/数值/level 枚举，中文名与评级文案在前端补齐（术语单源在前端）
      const inds = this.decorateInds(d.indicators || []);
      const scope = d.indicator_scope || {};
      const sv = this.scopeView(scope);
      this.setData({
        isArchive: !!d.is_archive,
        incDetail,
        expDetail,
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
        inds, scope,
        bizIdx: sv.bizIdx, cityIdx: sv.cityIdx, bizText: sv.bizText, cityText: sv.cityText,
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

  // ===== round115：行业指标对照 =====

  // 后端只回 { key, pct, lo, hi, level, redline, redlineHit }；中文名与评级文案在前端补（术语单源在前端）。
  // 🔴 pct === null 表示「这项没数据」⇒ has=false ⇒ 页面显示「本月没填」，**绝不显示 0%**
  //    （算成 0% 会得出「房租占比 0%，优秀」这种荒谬结论 —— round115 后端真有此 bug，已修并被 selftest 钉住）。
  decorateInds(list) {
    const lvCost = TERMS.m2.indLevels, lvGain = TERMS.m2.indLevelsGain;
    const names = TERMS.m2.indNames, gainKey = TERMS.m2.indGainKey;
    return (list || []).map((it) => {
      const has = it.pct !== null && it.pct !== undefined;
      return {
        key: it.key,
        name: names[it.key] || it.key,
        pct: it.pct,
        lo: it.lo,
        hi: it.hi,
        level: it.level,
        has,
        lvText: (it.key === gainKey ? lvGain : lvCost)[it.level] || '',
      };
    });
  },

  // 业态/城市 → picker 索引与显示文案；库里没存过则回落「中式正餐 × 二三线」
  //（与后端 bandOf 的兜底一致：`BANDS[bizKey] || BANDS.dining` + CITY_TIERS[1]）
  scopeView(scope) {
    const bs = TERMS.m2.bizTypes, cs = TERMS.m2.cityTiers;
    let bi = bs.findIndex((x) => x.key === (scope && scope.biz_type));
    let ci = cs.findIndex((x) => x.key === (scope && scope.city_tier));
    if (bi < 0) bi = 1;
    if (ci < 0) ci = 1;
    return { bizIdx: bi, cityIdx: ci, bizText: bs[bi].name, cityText: cs[ci].name };
  },

  onBiz(e) { this.saveScope({ biz_type: TERMS.m2.bizTypes[Number(e.detail.value)].key }); },
  onCity(e) { this.saveScope({ city_tier: TERMS.m2.cityTiers[Number(e.detail.value)].key }); },

  // 业态/城市是「你的店是什么」，一次设定长期有效 ⇒ 落库（shop 集合）；改完重拉，参考带跟着变
  async saveScope(patch) {
    try {
      await api.call('saveShopSetting', Object.assign({
        shop_id: (getApp().globalData && getApp().globalData.shop_id) || '',
      }, patch));
      await this.load();
    } catch (e) {
      api.toastError(e);
    }
  },

  // D1：把后端明细（snake_case 大类列表）转为下钻面板数据（大类 → 细项，金额仅格式化展示）
  buildDetail(items) {
    return (items || []).map((it) => {
      const subs = (it.sub_items || []).map((si) => ({
        name: si.sub_item || '',
        amount: si.amount_fen ? api.fenToYuan(si.amount_fen, 2) : '0.00',
      }));
      return {
        name: it.name || '',
        amount: it.amount_fen ? api.fenToYuan(it.amount_fen, 2) : '0.00',
        sub_items: subs,
      };
    });
  },

  // D1：切换下钻面板（income / expense）
  toggleDrill(e) {
    const kind = e.currentTarget.dataset.kind;   // 'income' | 'expense'
    const key = kind === 'income' ? 'showIncDrill' : 'showExpDrill';
    this.setData({ [key]: !this.data[key] });
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
    // 2026-09-20 加固：此前整段无 try/catch —— 一旦取权益/弹窗任一步抛异常，点击就是「毫无反应」，
    // 用户无从判断是没权限还是坏了。现统一兜底：任何异常都 toast 出来（可证伪，不静默）。
    try {
      const ent = await require('../../utils/entitlement.js').fetchEntitlement().catch(() => null);
      if (!ent || !ent.is_active) {
        require('../../utils/paywall.js').openPaywall('export', {
          shopId: (getApp().globalData && getApp().globalData.shop_id) || '',
        });
        return;
      }
      await this.doExport();
    } catch (e) {
      require('../../utils/api.js').toastError(e);
    }
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