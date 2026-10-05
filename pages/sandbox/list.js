// pages/sandbox/list.js —— 我的方案（列表 · 并排对比）· M2v1.2
//
// 🔴 数据来源：
//   · 列表：getPlan 一次取回各 sandbox_id 的最新版本；卡片金额读 `result_snapshot_json`（只作快速渲染缓存）。
//   · 对比：点【并排对比】时对每个选中方案用其 `param_json` **调 calcSandbox 实时重算**（不读快照）——
//     前端**不做任何转换/公式**，param_json 本身即 calcSandbox 的 snake_case wire 形态，原样透传即可。
//   · 金额一律「分」整数，前端只展示（fen/100）。
// 🔴 最多 3 个（前端拦，不耗云函数）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

const P = TERMS.m2Plan;
const MAX_SEL = 3;

Page({
  data: {
    t: {
      navTitle: P.navTitle,
      empty: P.empty,
      compare: P.compare,
      compareHint: P.compareHint,
      compareLoading: P.compareLoading,
      compareMaxHint: P.compareMaxHint,
      notSelected: P.notSelected,
      typeSite: P.typeSite,
      typeBiz: P.typeBiz,
      vers: P.vers,
      colName: P.colName,
      rowBreakEven: P.rowBreakEven,
      rowTarget: P.rowTarget,
      rowPayback: P.rowPayback,
      rowMargin: P.rowMargin,
      rowRentPct: P.rowRentPct,
      unitYuan: P.unitYuan,
      unitMonth: P.unitMonth,
      back: P.back,
      loading: TERMS.ui.loading,
    },
    mode: 'list',        // 'list' | 'compare'
    list: [],
    selIds: [],
    compareRows: [],     // 对比表：行 = 指标
    compareCols: [],     // 对比表：列 = 方案（含 name + values）
    loading: true,
    comparing: false,
    errMsg: '',
  },

  onLoad() { this.load(); },

  async load() {
    this.setData({ loading: true, errMsg: '' });
    try {
      await api.ensureShop();
      ui.setTitle(P.navTitle);
      const d = await api.call('getPlan', {});
      const rows = (d.list || []).map((it) => this.decorate(it));
      // 默认不勾选（避免首次进来自带对比态）
      this.setData({ list: rows, selIds: [], mode: 'list', comparing: false, loading: false });
    } catch (e) {
      this.setData({ loading: false, errMsg: (e && e.msg) || TERMS.ui.loading });
      api.toastError(e);
    }
  },

  // 读快照快速渲染（只取展示数字，前端不做任何公式）
  decorate(it) {
    const snap = it.result_snapshot_json || {};
    const isRev = (snap.reverse && snap.reverse.target_monthly_fen != null);
    const targetFen = isRev ? snap.reverse.target_monthly_fen : snap.target_monthly_fen;
    return Object.assign({}, it, {
      typeName: it.sandbox_type === 'biz_sim' ? P.typeBiz : P.typeSite,
      targetYuan: targetFen != null ? api.fenToYuan(targetFen, 0) : '—',
      breakEvenYuan: snap.break_even_monthly_fen != null ? api.fenToYuan(snap.break_even_monthly_fen, 0) : '—',
      updatedText: this.fmtTime(it.updated_at),
      checked: false,
    });
  },

  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  onBack() {
    if (this.data.mode === 'compare') this.setData({ mode: 'list' });
    else wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/sandbox/index' }) });
  },

  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    const sel = this.data.selIds.slice();
    const i = sel.indexOf(id);
    if (i >= 0) { sel.splice(i, 1); }
    else {
      if (sel.length >= MAX_SEL) {
        api.toastError({ msg: P.compareMaxHint });
        return;
      }
      sel.push(id);
    }
    const list = this.data.list.map((r) => Object.assign({}, r, { checked: sel.indexOf(r.sandbox_id) >= 0 }));
    this.setData({ selIds: sel, list });
  },

  // 并排对比：每个选中方案用 param_json 调 calcSandbox 实时重算
  async onCompare() {
    const sel = this.data.selIds.slice();
    if (sel.length < 2 || sel.length > MAX_SEL) {
      api.toastError({ msg: P.notSelected });
      return;
    }
    const chosen = this.data.list.filter((r) => sel.indexOf(r.sandbox_id) >= 0);
    this.setData({ comparing: true });
    const cols = [];
    try {
      for (const it of chosen) {
        const d = await api.call('calcSandbox', Object.assign({}, it.param_json, {
          client_request_id: 'cmp_' + Date.now() + '_' + it.sandbox_id.slice(-4),
        }));
        cols.push({
          name: it.name,
          typeName: it.typeName,
          breakEvenYuan: d.break_even_monthly_fen != null ? api.fenToYuan(d.break_even_monthly_fen, 0) : '—',
          targetYuan: (d.reverse && d.reverse.target_monthly_fen != null)
            ? api.fenToYuan(d.reverse.target_monthly_fen, 0)
            : (d.target_monthly_fen != null ? api.fenToYuan(d.target_monthly_fen, 0) : '—'),
          paybackMonths: d.payback_months != null ? d.payback_months : '—',
          marginPct: (it.param_json && it.param_json.gross_margin_pct != null) ? it.param_json.gross_margin_pct : '—',
          rentPct: this.rentPct(d, it.param_json),
        });
      }
    } catch (e) {
      this.setData({ comparing: false });
      api.toastError(e);
      return;
    }
    // 行 = 关键指标
    const compareRows = [
      { key: 'breakEven', name: P.rowBreakEven, unit: P.unitYuan },
      { key: 'target', name: P.rowTarget, unit: P.unitYuan },
      { key: 'payback', name: P.rowPayback, unit: P.unitMonth },
      { key: 'margin', name: P.rowMargin, unit: '%' },
      { key: 'rentPct', name: P.rowRentPct, unit: '%' },
    ].map((row) => Object.assign({}, row, { vals: cols.map((c) => this.fmtVal(c[row.key])) }));
    this.setData({ compareRows, compareCols: cols, mode: 'compare', comparing: false, loading: false });
  },

  fmtVal(v) {
    if (v == null || v === '' || v === '—') return '—';
    return String(v);
  },

  // 房租占比（读后端已算好的百分数，前端不做公式）
  rentPct(result, paramJson) {
    if (paramJson && paramJson.mode === 'reverse') {
      return (result.reverse && result.reverse.rent_rate_pct != null)
        ? result.reverse.rent_rate_pct : null;
    }
    const ind = (result.indicators_at_breakeven || []).filter((x) => x.key === 'rent')[0];
    return ind && ind.pct != null ? ind.pct : null;
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});