// pages/sandbox/matrix/index.js —— M2 G1 场景矩阵生成器（2026-10-11 改造）
//
// ⚠️ 计算下沉（铁律不变）：每一行的测算全部由云函数 calcSandbox 算（经新增 matrix action 批量调），
//   本页只做「维度组合 → assembleItems 装配 clean 参数 → 整批送云 → 展示分整数」。
//   前端不编任何保本/摊销/占比公式：占比等展示量要么取自引擎出参，要么是两个已返回数值的简单比值（展示用）。
//
// ⚠️ 免费引流：本页矩阵与导出均免费（G4 李老师拍板），不触发付费墙、不要求先开店铺。
const api = require('../../utils/api.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const {
  BIZ_PRESETS, CITY_COEF, assembleItems, resolveBuild, findPreset, bizKeyOfPreset,
} = require('../../utils/bizPreset.js');
const { deliver } = require('../../utils/exportFile.js');

const M = TERMS.matrix;

// 默认扫维度档位（照搬小面表 + 毛利率 4 档，即「升级」核心）
const DEFAULT_DIMS = {
  rent: [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000],
  labor: [2, 3],
  margin: [45, 55, 60, 65],
  target: [0, 10000, 15000], // 0=保本
};

Page({
  data: {
    t: {
      title: M.title,
      subtitle: M.subtitle,
      presetLabel: M.presetLabel,
      cityLabel: TERMS.m2.cityLabel,
      cityTiers: TERMS.m2.cityTiers,
      bizLabel: TERMS.m2.bizLabel,
      bizTypes: TERMS.m2.bizTypes,
      dimRent: M.dimRent,
      dimLabor: M.dimLabor,
      dimMargin: M.dimMargin,
      dimTarget: M.dimTarget,
      addDim: M.addDim,
      delDim: M.delDim,
      buildLabel: M.buildLabel,
      buildYearsLabel: M.buildYearsLabel,
      areaLabel: M.areaLabel,
      generate: M.generate,
      generating: M.generating,
      detail: M.detail,
      pivot: M.pivot,
      pivotFixMargin: M.pivotFixMargin,
      pivotFixLabor: M.pivotFixLabor,
      exportXlsx: M.exportXlsx,
      exporting: M.exporting,
      empty: M.empty,
      count: M.count,
      rentPct: M.rentPct,
      payback: M.payback,
      unfeasible: M.unfeasible,
      colBreakMonthly: M.colBreakMonthly,
      colBreakDaily: M.colBreakDaily,
      colTargetMonthly: M.colTargetMonthly,
      colTargetDaily: M.colTargetDaily,
      redAlertHint: M.redAlertHint,
      pivotCellBreak: M.pivotCellBreak,
      pivotCellTarget: M.pivotCellTarget,
      backToSandbox: M.backToSandbox,
      toCompare: M.toCompare,
      yuan: M.yuan,
      pct: M.pct,
      person: M.person,
    },
    presets: BIZ_PRESETS.map((p) => ({ key: p.presetKey, name: TERMS.m2.bizTypes.find((b) => b.key === p.bizKey) ? TERMS.m2.bizTypes.find((b) => b.key === p.bizKey).name + '·预设' : p.presetKey })),
    presetIdx: 0,
    cityIdx: 1, // tier23
    dims: {
      rent: DEFAULT_DIMS.rent.slice(),
      labor: DEFAULT_DIMS.labor.slice(),
      margin: DEFAULT_DIMS.margin.slice(),
      target: DEFAULT_DIMS.target.slice(),
    },
    global: { area: 60, buildTotalYuan: 0, buildYears: 3 },
    pivotFix: { margin: 55, labor: 2 },
    loading: false,
    exporting: false,
    result: null, // { rows:[], view, count, pivot }
  },

  onLoad() {
    this.syncBuildDefault();
  },

  // 切换业态预设时，把「开店一次性投入」默认值带出来（有 buildRef 才带，否则留空让用户填）
  syncBuildDefault() {
    const p = findPreset(BIZ_PRESETS[this.data.presetIdx].presetKey);
    const ref = (p && p.buildRef && p.buildRef[0]) || null;
    this.setData({
      global: {
        area: this.data.global.area,
        buildTotalYuan: ref ? Math.round(ref.fen / 100) : 0,
        buildYears: ref ? Math.round(ref.years) : 3,
      },
    });
  },

  onPresetChange(e) {
    this.setData({ presetIdx: Number(e.detail.value) }, () => this.syncBuildDefault());
  },
  onCityChange(e) {
    this.setData({ cityIdx: Number(e.detail.value) });
  },

  // ===== 维度档位编辑 =====
  onDimInput(e) {
    const { dim, idx } = e.currentTarget.dataset;
    const val = e.detail.value;
    const dims = this.data.dims;
    dims[dim][idx] = val;
    this.setData({ dims });
  },
  addDim(e) {
    const dim = e.currentTarget.dataset.dim;
    const dims = this.data.dims;
    dims[dim] = dims[dim].concat(['']);
    this.setData({ dims });
  },
  delDim(e) {
    const { dim, idx } = e.currentTarget.dataset;
    const dims = this.data.dims;
    if (dims[dim].length <= 1) return; // 至少保留一档
    dims[dim].splice(idx, 1);
    this.setData({ dims });
  },

  onGlobalInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const global = this.data.global;
    global[key] = val;
    this.setData({ global });
  },

  // ===== 装配单行的 clean 参数（与单测口径一致，走 assembleItems 唯一入口）=====
  buildClean(preset, coef, rentYuan, laborN, marginPct, targetYuan, cityTier) {
    const buildItems = this.buildItems();
    const input = {
      area: Number(this.data.global.area) || 0,
      headcount: laborN,
      rentYuan,
      fixedYuan: { rent: rentYuan },
      buildItems,
    };
    const { fixedItems, varItems } = assembleItems(preset, input, coef);
    return {
      cityTier,
      bizType: bizKeyOfPreset(preset.presetKey),
      fixedItems,
      varItems,
      buildItems,
      grossMarginPct: marginPct,
      targetProfitFen: api.yuanToFen(targetYuan),
      expectedRevenueFen: 0,
    };
  },
  // 全局开店投入 → buildItems（与 bizPreset.resolveBuild 同形：[{key,fen,years}]）
  buildItems() {
    const yuan = Number(this.data.global.buildTotalYuan) || 0;
    const years = Number(this.data.global.buildYears) || 1;
    return [{ key: 'other', fen: api.yuanToFen(yuan), years: years > 0 ? years : 1 }];
  },

  // ===== 生成矩阵（批量送云）=====
  async onGenerate() {
    if (this.data.loading) return;
    const presetKey = BIZ_PRESETS[this.data.presetIdx].presetKey;
    const preset = findPreset(presetKey);
    if (!preset) { api.toastError({ msg: '请选择经营类型' }); return; }
    const tiers = ['tier1', 'tier23', 'county'];
    const cityTier = tiers[this.data.cityIdx] || 'tier23';
    const coef = CITY_COEF[cityTier] || CITY_COEF.tier23;
    const { rent, labor, margin, target } = this.data.dims;
    const cleanArr = [];
    const meta = []; // 与 cleanArr 对齐的维度标注
    for (const r of rent) for (const l of labor) for (const m of margin) for (const tg of target) {
      const rv = Number(r), lv = Number(l), mv = Number(m), tgv = Number(tg);
      if (![rv, lv, mv, tgv].every((x) => isFinite(x))) continue;
      cleanArr.push(this.buildClean(preset, coef, rv, lv, mv, tgv, cityTier));
      meta.push({ rent: rv, labor: lv, marginPct: mv, targetYuan: tgv });
    }
    if (!cleanArr.length) { api.toastError({ msg: '维度档位不能为空' }); return; }
    this.setData({ loading: true });
    try {
      const d = await api.call('calcSandbox', { action: 'matrix', clean_array: cleanArr });
      const rows = (d.rows || []).map((res, i) => this.toRow(meta[i], res));
      const pivot = this.buildPivot(rows);
      this.setData({
        loading: false,
        result: { rows, view: 'detail', count: rows.length, pivot },
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  toRow(meta, res) {
    const rentFen = meta.rent * 100;
    const targetMonthlyFen = res.target_monthly_fen;
    // 房租占比：两个引擎返回数值的简单比值（展示用，非测算公式）
    const rentPct = (targetMonthlyFen && targetMonthlyFen > 0)
      ? Math.round((rentFen / targetMonthlyFen) * 1000) / 10
      : null;
    return {
      rent: meta.rent,
      labor: meta.labor,
      marginPct: meta.marginPct,
      targetYuan: meta.targetYuan,
      breakMonthly: res.break_even_monthly_fen != null ? res.break_even_monthly_fen / 100 : null,
      breakDaily: res.break_even_daily_fen != null ? res.break_even_daily_fen / 100 : null,
      targetMonthly: targetMonthlyFen != null ? targetMonthlyFen / 100 : null,
      targetDaily: res.target_daily_fen != null ? res.target_daily_fen / 100 : null,
      rentPct,
      payback: res.payback_months != null ? res.payback_months : null,
      red: !!res.red_alert,
    };
  },

  // ===== 透视表：行=月租金档，列=目标利润档，单元格=目标日均(元) =====
  // 顶部固定 毛利率 / 人工，从已算结果里筛出对应子集（无需重新调云）
  buildPivot(rows) {
    const fixMargin = Number(this.data.pivotFix.margin);
    const fixLabor = Number(this.data.pivotFix.labor);
    const filtered = rows.filter((r) => !r.red && r.marginPct === fixMargin && r.labor === fixLabor);
    const cells = {};
    for (const r of filtered) cells[r.rent + '|' + r.targetYuan] = r.targetDaily;
    return {
      fixMargin,
      fixLabor,
      rows: this.data.dims.rent.slice(),
      cols: this.data.dims.target.slice(),
      cells,
    };
  },
  onPivotFixChange(e) {
    const key = e.currentTarget.dataset.key;
    const val = Number(e.detail.value);
    const pivotFix = this.data.pivotFix;
    pivotFix[key] = val;
    this.setData({ pivotFix }, () => {
      if (this.data.result) {
        this.setData({ 'result.pivot': this.buildPivot(this.data.result.rows) });
      }
    });
  },
  onPivotFixInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = Number(e.detail.value);
    const pivotFix = this.data.pivotFix;
    pivotFix[key] = val;
    this.setData({ pivotFix }, () => {
      if (this.data.result) {
        this.setData({ 'result.pivot': this.buildPivot(this.data.result.rows) });
      }
    });
  },

  onViewChange(e) {
    const view = e.currentTarget.dataset.view;
    if (this.data.result) this.setData({ 'result.view': view });
  },

  // ===== 导出 Excel（免费引流，G4）=====
  async onExport() {
    const rows = this.data.result && this.data.result.rows;
    if (!rows || !rows.length || this.data.exporting) return;
    const t = this.data.t;
    const header = [
      t.dimRent, t.dimLabor, t.dimMargin, t.dimTarget,
      t.colBreakMonthly, t.colBreakDaily, t.colTargetMonthly, t.colTargetDaily,
      t.rentPct, t.payback,
    ];
    const body = rows.map((r) => [
      r.rent, r.labor, r.marginPct, r.targetYuan,
      r.breakMonthly != null ? r.breakMonthly : '—',
      r.breakDaily != null ? r.breakDaily : '—',
      r.targetMonthly != null ? r.targetMonthly : '—',
      r.targetDaily != null ? r.targetDaily : '—',
      r.rentPct != null ? r.rentPct : '—',
      r.payback != null ? r.payback : '—',
    ]);
    this.setData({ exporting: true });
    try {
      const d = await api.call('exportData', {
        export_type: 'm2_matrix',
        shop_name: '',
        table: { header, rows: body },
      });
      deliver(d);
    } catch (e) {
      api.toastError(e);
    } finally {
      this.setData({ exporting: false });
    }
  },

  goSandbox() { wx.navigateBack({ delta: 1 }); },
  goCompare() { wx.navigateTo({ url: '/pages/sandbox/compare' }); },
});
