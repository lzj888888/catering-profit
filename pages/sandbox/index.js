// pages/sandbox/index.js —— M2 开店盈亏平衡点测算（v2 · 2026-09-23 李老师拍板改造）
//
// ⚠️ 计算下沉（铁律不变）：所有**公式**在云函数 calcSandbox（Service 层）算，前端只展示返回的分整数。
//   前端只允许做「纯金额求和」这类展示汇总（如各行金额相加），**任何含除法 / 费率的量
//   （月摊销、保本营业额、各类占比）一律只用后端返回值** —— 前端不编公式。
//
// ⚠️ 触发方式（AD-6/AD-7 的 v2 折中，已写进 M2 规范）：
//   仍**不按键调用**（防每敲一个字符就发一次云函数），改为「改动停顿 700ms 自动重算」+「滑块松手即算」
//   + 底部「开始测算」按钮兜底。公式权威性不变（仍由后端算），只是把"点按钮"从必做变成可选。
//
// ⚠️ 付费弹窗边界：M2 模块**永不触发**付费弹窗（不变）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

const M = TERMS.m2;
const BUILD_ALL = Object.keys(M.buildItems);
const FIXED_ALL = Object.keys(M.fixedItems);
const VAR_ALL = Object.keys(M.varItems);
const DEBOUNCE_MS = 700;

// 行工厂：把「术语里的中文名」直接塞进行对象，wxml 只渲染 {{item.name}} ——
// 避免在 WXML 里写动态键（{{t.xxx[item.key]}}）这种解析边界写法。
// round113：行对象多带一个 note（逐项口径备注）—— 让"这笔钱指什么"就贴在输入框旁边，
// 解决"不知道各种费用是什么"（李老师 round113 原话：很多用户不知道，就不会填、不会用）。
const mkRow = (k, nameMap, noteMap, extra) =>
  Object.assign({ key: k, name: nameMap[k], note: (noteMap && noteMap[k]) || '' }, extra || {});

Page({
  data: {
    t: {
      cityLabel: M.cityLabel,
      cityTiers: M.cityTiers,
      bizLabel: M.bizLabel,
      bizTypes: M.bizTypes,
      secBuild: M.secBuild,
      secFixed: M.secFixed,
      secMargin: M.secMargin,
      secVar: M.secVar,
      secTarget: M.secTarget,
      secResult: M.secResult,
      secIndicators: M.secIndicators,
      buildPh: M.buildPh,
      yearsSuffix: M.yearsSuffix,
      buildTotal: M.buildTotal,
      amortMonthly: M.amortMonthly,
      fixedTotal: M.fixedTotal,
      marginName: M.marginName,
      marginSub: M.marginSub,
      marginTip: M.marginTip,
      varTotal: M.varTotal,
      targetProfit: M.targetProfit,
      targetRow: M.targetRow,
      resBreakMonthly: M.resBreakMonthly,
      resBreakDaily: M.resBreakDaily,
      resTargetMonthly: M.resTargetMonthly,
      resTargetDaily: M.resTargetDaily,
      resPayback: M.resPayback,
      paybackUnit: M.paybackUnit,
      indBand: M.indBand,
      indMine: M.indMine,
      indRedline: M.indRedline,
      indByBreak: M.indByBreak,
      indByTarget: M.indByTarget,
      indLevels: M.indLevels,
      addItem: M.addItem,
      delItem: M.delItem,
      autoHint: M.autoHint,
      needFixed: M.needFixed,
      bandPreviewTitle: M.bandPreviewTitle,
      bandPreviewNote: M.bandPreviewNote,
      buildNote: M.buildNote,
      fixedNote: M.fixedNote,
      varNote: M.varNote,
      marginBandLabel: M.marginBandLabel,
      calc: M.calc,
      redAlert: M.redAlert,
      redAlertHint: M.redAlertHint,
      noCalc: TERMS.sandboxResult.noCalc,
      loading: TERMS.ui.loading,
      cur: '¥',
    },
    // 选择器
    cityIdx: 1, bizIdx: 1,          // 默认「二三线 / 中式正餐」
    // 各行（yuan / pct 保存**字符串**，与输入框语义一致；提交时才转分）
    buildRows: [
      mkRow('decor', M.buildItems, M.buildItemNotes, { yuan: '', years: 3 }),
      mkRow('equip', M.buildItems, M.buildItemNotes, { yuan: '', years: 5 }),
      mkRow('franchise', M.buildItems, M.buildItemNotes, { yuan: '', years: 3 }),
    ],
    fixedRows: [
      mkRow('rent', M.fixedItems, M.fixedItemNotes, { yuan: '' }),
      mkRow('labor', M.fixedItems, M.fixedItemNotes, { yuan: '' }),
      mkRow('utility', M.fixedItems, M.fixedItemNotes, { yuan: '' }),
      mkRow('manage', M.fixedItems, M.fixedItemNotes, { yuan: '' }),
    ],
    varRows: [mkRow('takeawayComm', M.varItems, M.varItemNotes, { pct: '' })],
    marginPct: 65,
    targetYuan: '',
    // 结果（全部来自后端）
    result: null,
    indicators: [],
    bands: [],            // 行业参考区间预览（round113 · 来自云端 bands_preview）
    marginBand: '',       // 本业态毛利率参考带（同上，取 grossMargin 那一项）
    indTab: 'break',
    calcError: '',
    loading: true,
    dirty: false,
  },

  onLoad() { this.bootstrap(); },
  onUnload() { if (this._timer) clearTimeout(this._timer); },

  async bootstrap() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.modules.m2.navTitle);
      this.setData({ loading: false });
      // round113：进页面先拿一次"行业参考区间" —— 用户**还没填任何数**就能看到该填多少量级
      //（开店前手里没数字，是本页的主要流失点）
      this.onCalc();
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // ===== 选择器 =====
  onCity(e) {
    const i = Number(e.detail.value);
    this.setData({ cityIdx: i, cityName: M.cityTiers[i].name });
    this.scheduleCalc();
  },
  onBiz(e) {
    const i = Number(e.detail.value);
    this.setData({ bizIdx: i, bizName: M.bizTypes[i].name });
    this.scheduleCalc();
  },

  // ===== 建店投入 =====
  onBuildYuan(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const rows = this.data.buildRows.slice();
    rows[i].yuan = e.detail.value;
    this.setData({ buildRows: rows });
    this.scheduleCalc();
  },
  onBuildYears(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const rows = this.data.buildRows.slice();
    rows[i].years = e.detail.value;
    this.setData({ buildRows: rows });
    this.scheduleCalc();
  },
  onAddBuild() {
    const used = this.data.buildRows.map((r) => r.key);
    const k = BUILD_ALL.filter((x) => used.indexOf(x) < 0)[0];
    if (!k) return;
    const rows = this.data.buildRows.concat([mkRow(k, M.buildItems, M.buildItemNotes, { yuan: '', years: 3 })]);
    this.setData({ buildRows: rows });
    this.scheduleCalc();
  },
  onDelBuild(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const rows = this.data.buildRows.slice();
    rows.splice(i, 1);
    this.setData({ buildRows: rows });
    this.scheduleCalc();
  },

  // ===== 每月固定 =====
  onFixedYuan(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const rows = this.data.fixedRows.slice();
    rows[i].yuan = e.detail.value;
    this.setData({ fixedRows: rows });
    this.scheduleCalc();
  },
  onAddFixed() {
    const used = this.data.fixedRows.map((r) => r.key);
    const k = FIXED_ALL.filter((x) => used.indexOf(x) < 0)[0];
    if (!k) return;
    const rows = this.data.fixedRows.concat([mkRow(k, M.fixedItems, M.fixedItemNotes, { yuan: '' })]);
    this.setData({ fixedRows: rows });
    this.scheduleCalc();
  },
  onDelFixed(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const rows = this.data.fixedRows.slice();
    rows.splice(i, 1);
    this.setData({ fixedRows: rows });
    this.scheduleCalc();
  },

  // ===== 毛利率滑杆 =====
  // bindchanging：拖动中只更新数字（不发请求）；bindchange：松手才重算 ⇒ 既是"实时"又不刷爆云函数
  // ⚠️ round111：这里原有一个 foodCostPct（100 − 毛利率）联动展示，已**删掉** ——
  //    对外不出现"食材成本率"（客户看不懂）。成本率只在云函数内部参与计算。
  onMarginChanging(e) {
    this.setData({ marginPct: Number(e.detail.value) });
  },
  onMarginChange(e) {
    this.setData({ marginPct: Number(e.detail.value) });
    this.scheduleCalc();
  },

  // ===== 挂钩费用 =====
  onVarPct(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const rows = this.data.varRows.slice();
    rows[i].pct = e.detail.value;
    this.setData({ varRows: rows });
    this.scheduleCalc();
  },
  onAddVar() {
    const used = this.data.varRows.map((r) => r.key);
    const k = VAR_ALL.filter((x) => used.indexOf(x) < 0)[0];
    if (!k) return;
    const rows = this.data.varRows.concat([mkRow(k, M.varItems, M.varItemNotes, { pct: '' })]);
    this.setData({ varRows: rows });
    this.scheduleCalc();
  },
  onDelVar(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const rows = this.data.varRows.slice();
    rows.splice(i, 1);
    this.setData({ varRows: rows });
    this.scheduleCalc();
  },

  // ===== 目标利润 =====
  onTarget(e) { this.setData({ targetYuan: e.detail.value }); this.scheduleCalc(); },

  // ===== 自动重算（防抖；AD-6/AD-7 折中）=====
  scheduleCalc() {
    this.setData({ dirty: true });
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.onCalc(); }, DEBOUNCE_MS);
  },

  async onCalc() {
    if (this.data.loading) return;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const fixedItems = this.data.fixedRows
      .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan) }))
      .filter((x) => x.fen > 0);
    // ⚠️ round113：**不再**在"无固定支出"时提前 return —— 因为"行业参考区间"与用户填了什么无关，
    //    进页面 / 换业态城市时就该显示。改为照常请求后端，只是**不展示测算结果**（保本点此时无意义）。
    const hasFixed = fixedItems.length > 0;
    this.setData({ loading: true, calcError: '' });
    try {
      const d = await api.call('calcSandbox', {
        city_tier: this.data.t.cityTiers[this.data.cityIdx].key,
        biz_type: this.data.t.bizTypes[this.data.bizIdx].key,
        build_items: this.data.buildRows
          .filter((r) => api.yuanToFen(r.yuan) > 0)
          .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan), years: Number(r.years) || 1 })),
        fixed_items: fixedItems,
        var_items: this.data.varRows
          .filter((r) => Number(r.pct) > 0)
          .map((r) => ({ key: r.key, pct: Number(r.pct) })),
        gross_margin_pct: Number(this.data.marginPct),
        target_profit_fen: api.yuanToFen(this.data.targetYuan),
        client_request_id: 'sb_' + Date.now(),
      });
      const fen = (v) => (v == null ? null : api.fenToYuan(v, 2));
      this.setData({
        // 行业参考区间（round113）：与"填了多少"无关，红警时也在
        bands: this.decorateBands(d.bands_preview || []),
        marginBand: this.pickBand(d.bands_preview, 'grossMargin'),
        result: !hasFixed ? null : {
          red_alert: !!d.red_alert,
          build_total: fen(d.build_total_fen),
          build_amort: fen(d.build_amort_monthly_fen),
          fixed_total: fen(d.fixed_total_fen),
          food_cost_pct: d.food_cost_pct,
          platform_pct: d.platform_pct,
          composite_var: d.composite_var_rate_pct != null ? d.composite_var_rate_pct.toFixed(1) : '—',
          // margin_rate_ratio 是比率（0.55 = 55%），与 *_pct（百分数）单位不同 —— 按 R41 口径以后缀区分
          margin_rate: d.margin_rate_ratio != null ? (d.margin_rate_ratio * 100).toFixed(1) : '—',
          break_even_monthly: fen(d.break_even_monthly_fen),
          break_even_daily: fen(d.break_even_daily_fen),
          target_monthly: fen(d.target_monthly_fen),
          target_daily: fen(d.target_daily_fen),
          payback_months: d.payback_months,
          _ind: { break: d.indicators_at_breakeven || [], target: d.indicators_at_target || [] },
        },
        indicators: hasFixed ? this.decorate(d.indicators_at_breakeven || []) : [],
        indTab: 'break',
        // 未达最小可算条件 ⇒ 用温和引导语代替报错（不是错误，是"还没填够"）
        calcError: hasFixed ? '' : M.needFixed,
        loading: false,
        dirty: false,
      });
    } catch (e) {
      this.setData({ loading: false, dirty: false });
      if (e.code === 'M2_RED_ALERT') {
        this.setData({ result: { red_alert: true }, calcError: '' });
      } else {
        this.setData({ calcError: e.msg || '' });
        api.toastError(e);
      }
    }
  },

  // 行业参考区间（round113）：key → 中文名 + "lo~hi%"。
  // ⚠️ 本函数**不含任何数值常量** —— 参考带单源仍是云端 indicatorRef.BANDS（经 bands_preview 下发）。
  decorateBands(list) {
    const names = M.indNames;
    return (list || []).map((x) => ({
      key: x.key,
      name: names[x.key] || x.key,
      band: x.lo == null ? '—' : x.lo + '~' + x.hi + '%',
    }));
  },

  /** 取某一项参考带的展示串（如毛利率 55~65%）；没有则空串。 */
  pickBand(list, key) {
    const it = (list || []).filter((x) => x.key === key)[0];
    return it && it.lo != null ? it.lo + '~' + it.hi + '%' : '';
  },

  // 指标对照：把后端 key/level 枚举 → 中文（术语单源在 terms，后端不存中文）
  // ⚠️ 评级文案必须**分两张表**：毛利率"越高越好"，成本项"越低越好"。
  //    若统一用成本类那张，会把"毛利率偏低"渲染成「偏高」—— 方向相反，客户会读反（round111 立）。
  decorate(list) {
    const names = M.indNames;
    return (list || []).map((x) => {
      const levels = x.key === M.indGainKey ? M.indLevelsGain : M.indLevels;
      return {
        key: x.key,
        name: names[x.key] || x.key,
        mine: x.pct == null ? '—' : x.pct + '%',
        band: x.lo == null ? '—' : x.lo + '~' + x.hi + '%',
        level: x.level,
        levelName: levels[x.level] || '',
        redline: x.redline == null ? '' : x.redline + '%',
        hit: !!x.redlineHit,
      };
    });
  },

  onIndTab(e) {
    const tab = e.currentTarget.dataset.tab;
    const ind = this.data.result && this.data.result._ind;
    this.setData({ indTab: tab, indicators: this.decorate(ind ? ind[tab] : []) });
  },

  onPullDownRefresh() { this.bootstrap().then(() => wx.stopPullDownRefresh()); },
});
