// subpkg/tools/sandbox/list.js —— 我的方案（列表 · 并排对比）· M2v1.2
//
// 🔴 数据来源：
//   · 列表：getPlan 一次取回各 sandbox_id 的最新版本；卡片金额读 `result_snapshot_json`（只作快速渲染缓存）。
//   · 对比：点【并排对比】时对每个选中方案用其 `param_json` **调 calcSandbox 实时重算**（不读快照）——
//     前端**不做任何转换/公式**，param_json 本身即 calcSandbox 的 snake_case wire 形态，原样透传即可。
//   · 金额一律「分」整数，前端只展示（fen/100）。
// 🔴 最多 3 个（前端拦，不耗云函数）。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const { openPaywall } = require('../../../utils/paywall.js');
const exportFile = require('../../../utils/exportFile.js');   // R265：导出投递单源（落盘 + 打开 + 转发兜底）

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
      exportImg: P.exportImg,
      exportExcel: P.exportExcel,
      exportImgHint: P.exportImgHint,
      exportExcelHint: P.exportExcelHint,
      exportImgSaved: P.exportImgSaved,
      exportCopied: P.exportCopied,
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

  /**
   * 🔴 R297 第四轮（M2 整体审计 B1）：**画布必须在用户点导出之前就绪**。
   *
   * 病根：`initCanvas()` 的内部是 `wx.createSelectorQuery().exec(cb)`（**异步**），函数体
   *   末尾无条件 `return null` —— 真正的 `this._ctx` 只在异步回调里才赋值。
   *   而 `onExportImg()` 里 `const ctx = this._ctx || this.initCanvas(); if (!ctx) { 提示失败; return; }`
   *   ⇒ **首次点击必然走 `!ctx` 分支**：弹一句提示、不出图；不点第二次就拿不到图。
   *
   * 治法：首屏渲染完成（onReady 在首帧之后触发，此时 canvas 节点已可查）就预热一次，
   *   `this._ctx` 提前落定 ⇒ 首次点击即出图。保留 onExportImg 的惰性兜底（防御性）。
   */
  onReady() { this.initCanvas(); },

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
    else wx.navigateBack({ fail: () => wx.reLaunch({ url: '/subpkg/tools/sandbox/index' }) });
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
          // 🔴 R297 第四轮（审计 B5）：给列配一个**唯一键** —— 方案名允许重名，
          //   wxml 里 `wx:key="name"` 撞键会导致对比表列渲染异常（少列/错列）。
          id: it.sandbox_id,
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

  // ===== M2v1.3 · 对比表导出（图片免费 / Excel 付费，两出口共用同一份已算结果）=====
  buildCompareTable() {
    const header = [P.colName].concat(this.data.compareCols.map((c) => c.name));
    const rows = this.data.compareRows.map((r) => [r.name].concat(r.vals));
    return { header, rows };
  },

  // 图片（PNG）· 免费：本地 canvas → 保存相册；🔴 不进权益校验、不调云函数
  onExportImg() {
    if (!this.data.compareRows.length) { api.toastError({ msg: P.notSelected }); return; }
    const { rows } = this.buildCompareTable();
    // 画布不足即降级提示（不阻断）；小屏用两行式文本
    // 🔴 R297 第四轮（审计 B1）：正常路径下 `this._ctx` 已由 `onReady` 预热 ⇒ 首次点击即出图；
    //   这里保留惰性兜底只为防御（例如 canvas 节点异常）。
    const ctx = this._ctx || this.initCanvas();
    if (!ctx) { api.toastError({ msg: P.exportImgHint }); return; }
    try {
      const lineH = Math.max(44, Math.floor(this._cw / rows.length));
      ctx.clearRect(0, 0, this._cw, this._ch);
      ctx.fillStyle = '#1e3a5f';
      ctx.font = '16px sans-serif';
      ctx.fillText(P.navTitle, 16, 28, this._cw - 32);
      rows.forEach((r, i) => {
        ctx.fillStyle = '#333';
        ctx.fillText(String(r[0] || ''), 16, 56 + i * lineH, this._cw - 110);
        ctx.fillStyle = '#666';
        const extra = (r.slice(1) || []).join(' · ');
        ctx.fillText(extra, 112, 56 + i * lineH, this._cw - 128);
      });
      wx.canvasToTempFilePath({
        canvas: this._canvas,
        success: (res) => {
          // 免费导出：本地 canvas → 临时图片 → 预览（非相册权限 API，避免新增隐私收集项）
          wx.previewImage({ urls: [res.tempFilePath], current: res.tempFilePath });
        },
        fail: () => api.toastError({ msg: P.exportImgHint }),
      });
    } catch (e) { api.toastError({ msg: P.exportImgHint }); }
  },

  initCanvas() {
    try {
      const q = wx.createSelectorQuery().in(this);
      const that = this;
      q.select('#compareCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : {}).pixelRatio || 2;
        canvas.width = 720;
        canvas.height = 300;
        const ctx = canvas.getContext('2d');
        ctx.scale(1, 1);
        that._canvas = canvas;
        that._ctx = ctx;
        that._cw = 720;
        that._ch = 300;
      });
    } catch (e) { return null; }
    // 🔴 R297 第四轮（审计 B1）：**恒返回 null 是设计使然** —— 真值只会在上面的异步回调里
    //   落到 `this._ctx`。所以它**不是**"同步取画布"的接口，调用方必须在交互前预热（见 onReady）。
    return null;
  },

  // Excel · 付费（复用 'export' 能力键）：hasFeature 假 ⇒ 弹既有 export 墙；否则调 exportData
  async onExportExcel() {
    if (!this.data.compareRows.length) { api.toastError({ msg: P.notSelected }); return; }
    const planIds = this.data.selIds.slice();
    const table = this.buildCompareTable();
    try {
      // R265：此前「导出」= 把 CSV 文本塞进剪贴板 ⇒ 用户拿到一串字、不知道往哪粘（真机反馈同类问题）。
      //   统一改成真 xlsx 文件 + 打开（打不开则转发到微信）。
      const d = await api.call('exportData', {
        export_type: 'm2_compare', format: 'xlsx', plan_ids: planIds, table,
      });
      exportFile.deliver(d);
    } catch (e) {
      if (e.code === 'FEATURE_LOCKED') {
        openPaywall('export', { shopId: (getApp && getApp().globalData && getApp().globalData.shop_id) || '' });
      } else {
        api.toastError(e);
      }
    }
  },
});