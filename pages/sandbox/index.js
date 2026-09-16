// pages/sandbox/index.js —— 批次 4 · M2 开店测算（输入页 + 结果页，仅正算）
//
// ⚠️ 计算下沉：所有公式在云函数 calcSandbox（Service 层）计算，前端**只展示返回的分整数**，
//   绝不自行编公式（M2.5 公式 + S4 锚点由后端保证）。
// ⚠️ 付费弹窗边界：M2 模块**永不触发**付费弹窗。
// ⚠️ 触发方式（AD-6/AD-7）：输入不实时调云函数，手动点「开始测算」才调。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      title: TERMS.modules.m2.display,
      inputTitle: TERMS.m2.inputTitle,
      rent: TERMS.m2.rent,
      property: TERMS.m2.property,
      labor: TERMS.m2.labor,
      other: TERMS.m2.other,
      includeAmort: TERMS.m2.includeAmort,
      simAmort: TERMS.m2.simAmort,
      varFood: TERMS.m2.varFood,
      varMkt: TERMS.m2.varMkt,
      varOther: TERMS.m2.varOther,
      targetProfit: TERMS.m2.targetProfit,
      calc: TERMS.m2.calc,
      fixedTotal: TERMS.m2.fixedTotal,
      compositeVar: TERMS.m2.compositeVar,
      marginRate: TERMS.m2.marginRate,
      breakEvenMonthly: TERMS.m2.breakEvenMonthly,
      breakEvenDaily: TERMS.m2.breakEvenDaily,
      targetMonthly: TERMS.m2.targetMonthly,
      targetDaily: TERMS.m2.targetDaily,
      redAlert: TERMS.m2.redAlert,
      redAlertHint: TERMS.m2.redAlertHint,
      yuanSuffix: TERMS.m2.yuanSuffix,
      daySuffix: TERMS.m2.daySuffix,
      conclusionPrefix: TERMS.sandboxResult.conclusionPrefix,
      conclusionSuffix: TERMS.sandboxResult.conclusionSuffix,
      noCalc: TERMS.sandboxResult.noCalc,
      loading: TERMS.ui.loading,
      cur: '¥',
    },
    // 输入（界面单位：元 / %）
    rentYuan: '', propertyYuan: '', laborYuan: '', otherYuan: '',
    includeAmort: false, simAmortYuan: '',
    varFoodPct: '', varMktPct: '', varOtherPct: '',
    targetProfitYuan: '',
    // 结果（后端返回，仅展示）
    result: null,
    calcError: '',
    loading: true,
  },

  onLoad() { this.bootstrap(); },

  async bootstrap() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.modules.m2.display);
      this.setData({ loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onRent(e) { this.setData({ rentYuan: e.detail.value }); },
  onProperty(e) { this.setData({ propertyYuan: e.detail.value }); },
  onLabor(e) { this.setData({ laborYuan: e.detail.value }); },
  onOther(e) { this.setData({ otherYuan: e.detail.value }); },
  onIncludeAmort(e) { this.setData({ includeAmort: e.detail.value }); },
  onSimAmort(e) { this.setData({ simAmortYuan: e.detail.value }); },
  onVarFood(e) { this.setData({ varFoodPct: e.detail.value }); },
  onVarMkt(e) { this.setData({ varMktPct: e.detail.value }); },
  onVarOther(e) { this.setData({ varOtherPct: e.detail.value }); },
  onTargetProfit(e) { this.setData({ targetProfitYuan: e.detail.value }); },

  // 手动点击触发（AD-7：不在 input 实时调云函数）
  async onCalc() {
    if (this.data.loading) return;
    this.setData({ loading: true, calcError: '' });
    try {
      const d = await api.call('calcSandbox', {
        rent_fen: api.yuanToFen(this.data.rentYuan),
        property_fen: api.yuanToFen(this.data.propertyYuan),
        labor_fen: api.yuanToFen(this.data.laborYuan),
        other_fen: api.yuanToFen(this.data.otherYuan),
        include_amort: this.data.includeAmort,
        sim_amort_fen: this.data.includeAmort ? api.yuanToFen(this.data.simAmortYuan) : 0,
        var_food_pct: Number(this.data.varFoodPct) || 0,
        var_mkt_pct: Number(this.data.varMktPct) || 0,
        var_other_pct: Number(this.data.varOtherPct) || 0,
        target_profit_fen: api.yuanToFen(this.data.targetProfitYuan),
        client_request_id: 'sb_' + Date.now(),
      });
      // 后端返回分整数 → 仅格式化展示
      const fen = (v) => (v == null ? null : api.fenToYuan(v, 2));
      this.setData({
        result: {
          red_alert: !!d.red_alert,
          fixed_total: fen(d.fixed_total_fen),
          composite_var: d.composite_var_rate_pct != null ? d.composite_var_rate_pct.toFixed(1) : '—',
          // margin_rate_ratio 是比率（0.55 = 55%），出参保留 4 位小数；显示需 ×100 转百分数。
          // 与 composite_var_rate_pct（百分数，直接 toFixed）单位不同 —— 按 R41 口径以 _ratio/_pct 后缀区分。
          margin_rate: d.margin_rate_ratio != null ? (d.margin_rate_ratio * 100).toFixed(1) : '—',
          break_even_monthly: fen(d.break_even_monthly_fen),
          break_even_daily: fen(d.break_even_daily_fen),
          target_monthly: fen(d.target_monthly_fen),
          target_daily: fen(d.target_daily_fen),
        },
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      // M2 红警由后端 M2_RED_ALERT / red_alert=true 表达；非该码的错误统一映射 i18n
      if (e.code === 'M2_RED_ALERT') {
        this.setData({ result: { red_alert: true }, calcError: '' });
      } else {
        this.setData({ calcError: e.msg || '' });
        api.toastError(e);
      }
    }
  },

  onPullDownRefresh() { this.bootstrap().then(() => wx.stopPullDownRefresh()); },
});