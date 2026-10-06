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
// M2v1.3：业态参数包（纯数据 + 唯一装配入口 + 回本派生，仓根 utils/）
const { BIZ_PRESETS, CITY_COEF, assembleItems, resolveBuild, paybackCash, findPreset } = require('../../utils/bizPreset.js');

const M = TERMS.m2;
const BUILD_ALL = Object.keys(M.buildItems);
const FIXED_ALL = Object.keys(M.fixedItems);
const VAR_ALL = Object.keys(M.varItems);
const DEBOUNCE_MS = 700;
// R193：M2 本地草稿键（此前算完即丢 —— 不存不导不记忆，退出重进全部重填）
const DRAFT_KEY = 'sandbox_draft_v1';

// 行工厂：把「术语里的中文名」直接塞进行对象，wxml 只渲染 {{item.name}} ——
// 避免在 WXML 里写动态键（{{t.xxx[item.key]}}）这种解析边界写法。
// round113：行对象多带一个 note（逐项口径备注）—— 让"这笔钱指什么"就贴在输入框旁边，
// 解决"不知道各种费用是什么"（李老师 round113 原话：很多用户不知道，就不会填、不会用）。
const mkRow = (k, nameMap, noteMap, extra) =>
  Object.assign({ key: k, name: nameMap[k], note: (noteMap && noteMap[k]) || '' }, extra || {});

Page({
  data: {
    t: {
      // R193：本地草稿（漏登记 ⇒ 页面静默空白，本仓 R189 P2-1 同族）
      draftRestored: M.draftRestored,
      clearDraft: M.clearDraft,
      draftClearConfirm: M.draftClearConfirm,
      draftClearOk: M.draftClearOk,
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
      expectRevLabel: M.expectRevLabel,
      expectRevPh: M.expectRevPh,
      expectRevNote: M.expectRevNote,
      refAmtCard: M.refAmtCard,
      calc: M.calc,
      redAlert: M.redAlert,
      redAlertHint: M.redAlertHint,
      noCalc: TERMS.sandboxResult.noCalc,
      loading: TERMS.ui.loading,
      cur: '¥',
      // M2v1.1（选址反推 · 第一期）
      tabForward: M.tabForward,
      tabReverse: M.tabReverse,
      revPrice: M.revPrice,
      revSeats: M.revSeats,
      revOpenDays: M.revOpenDays,
      revRentRate: M.revRentRate,
      revPixelEff: M.revPixelEff,
      revRentHint: M.revRentHint,
      revRevenue: M.revRevenue,
      revRentCap: M.revRentCap,
      revTraffic: M.revTraffic,
      revDailyTraffic: M.revDailyTraffic,
      revTurnRate: M.revTurnRate,
      revAreaCap: M.revAreaCap,
      revWarnTurnHigh: M.revWarnTurnHigh,
      // M2v1.2（多方案存储 · 第二期）
      savePlanEntry: M.savePlanEntry,
      savePlanBtn: M.savePlanBtn,
      savePlanModalTitle: M.savePlanModalTitle,
      planNameLabel: M.planNameLabel,
      planTypeLabel: M.planTypeLabel,
      planTypeSite: M.planTypeSite,
      planTypeBiz: M.planTypeBiz,
      planNameRequired: M.planNameRequired,
      planSaving: M.planSaving,
      planSavedOk: M.planSavedOk,
      planNamePh: M.planNamePh,
      cancel: TERMS.buttons.cancel,
      // M2v1.3（业态参数包 + 回本卡）
      presetLabel: M.presetLabel,
      presetNone: M.presetNone,
      presetPickedPre: M.presetPickedPre,
      presetPickedSuf: M.presetPickedSuf,
      bizPresets: M.bizPresets,
      l1Title: M.l1Title,
      areaLabel: M.areaLabel,
      areaUnit: M.areaUnit,
      rentLabel: M.rentLabel,
      headcountLabel: M.headcountLabel,
      headcountUnit: M.headcountUnit,
      l2Toggle: M.l2Toggle,
      l3Toggle: M.l3Toggle,
      avgPriceLabel: M.avgPriceLabel,
      laborUnitLabel: M.laborUnitLabel,
      openDaysLabel2: M.openDaysLabel2,
      dayUnit: M.dayUnit,
      pixelEffLabel2: M.pixelEffLabel2,
      rentRateLabel2: M.rentRateLabel2,
      turnLabel2: M.turnLabel2,
      pctUnit: M.pctUnit,
      assumptionsTitle: M.assumptionsTitle,
      assumptionsHint: M.assumptionsHint,
      costLoss: M.costLoss,
      paybackTitle: M.paybackTitle,
      paybackInvest: M.paybackInvest,
      paybackCash: M.paybackCash,
      paybackNull: M.paybackNull,
      paybackDisclaimer: M.paybackDisclaimer,
      paybackSeeM3: M.paybackSeeM3,
      months: M.months,
      yuanUnit: M.yuanUnit,
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
      mkRow('rent', M.fixedItems, M.fixedItemNotes, { yuan: '', ph: M.buildPh }),
      mkRow('labor', M.fixedItems, M.fixedItemNotes, { yuan: '', ph: M.buildPh }),
      mkRow('utility', M.fixedItems, M.fixedItemNotes, { yuan: '', ph: M.buildPh }),
      mkRow('manage', M.fixedItems, M.fixedItemNotes, { yuan: '', ph: M.buildPh }),
    ],
    varRows: [mkRow('takeawayComm', M.varItems, M.varItemNotes, { pct: '' })],
    marginPct: 65,
    expectYuan: '',      // 预计月营业额（选填）—— 锚点：后端据此反算各项参考金额
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
    // R193：是否从本地草稿恢复（决定顶部那行提示与「清空重填」按钮是否出现）
    draftRestored: false,
    // M2v1.1（选址反推 · 第一期）
    mode: 'forward',         // 'forward' 正向测算 | 'reverse' 目标反推
    revPriceYuan: '',        // 客单价（元）
    revSeats: '',            // 座位数
    revOpenDays: '30',       // 每月营业天数
    revRentRate: '',         // 目标租金率（%）
    revPixelEff: '',         // 坪效（元/㎡·月，选填）
    reverseResult: null,     // 反推结果（reverse 块）
    // M2v1.2（多方案存储 · 第二期）：保存沙盘弹窗
    sandboxId: '',           // 正算/反推共用同一个 sandbox_id（首次保存后回填）
    showSave: false,
    planName: '',
    planType: 'site_select',
    planSaving: false,
    saveCrid: '',            // 本次点击生成一次的 uuid；同一次点击重试复用（幂等依赖）
    // M2v1.3（业态参数包 + 回本卡）
    presetKey: '',           // 选中的类内预设（'' = 不确定 / 手填）
    presetName: '',
    presetPicked: false,
    presetIdx: -1,
    presetOptions: [],       // 当前主分类下的类内预设 [{key,name}]
    areaNum: '',             // 面积（㎡）
    rentYuan: '',            // 月租金（元）
    headcountNum: '',        // 员工数（人）
    avgPriceYuan: '',        // 客单价（元）
    laborUnitYuan: '',       // 单人月人工单价（元）
    openDaysNum: '',         // 每月营业天数
    pixelEffYuan: '',        // 坪效（元/㎡·月）
    turnNum: '',             // 翻台率
    feeOverrides: {},        // itemKey → pct 字符串（L3 费率覆盖）
    feeRows: [],             // 当前预设 revenue_rate 项 [{key,label,pct}]
    showL2: false,
    showL3: false,
    showAssumptions: false,
    payback: null,           // {invest, cash, investDefault}（M2v1.3 回本卡）
    presetAssumptions: [],   // 底部假设卡行 [{label,val,src}]
  },

  onLoad() { this._seq = 0; this.bootstrap(); },
  onUnload() { if (this._timer) clearTimeout(this._timer); },

  async bootstrap() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.modules.m2.navTitle);
      this.syncPresetOptions();
      // R193：首算**之前**恢复本地草稿 ⇒ 进来看到的就是上次那版结果（不用重填一遍才有数）
      this.restoreDraft();
      // round113：进页面先拿一次"行业参考区间" —— 用户**还没填任何数**就能看到该填多少量级
      //（开店前手里没数字，是本页的主要流失点）
      // ⚠️ round114：改为 await + 首算保持整页 loading —— 拿到结果一次性渲染。
      //    否则会先渲染一版"没有参考区间"的空页、再跳一下（双闪）。
      await this.onCalc(true);
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // ===== R193：本地草稿（M2 算完即丢 ⇒ 以前退出重进要全部重填）=====
  // 🔴 零云端改动：只用 Storage，不新增集合 / 云函数。
  // 🔴 只存**用户填的值**，行名由 terms 现场派生 ⇒ 术语改名不会把旧名带回来。
  // 🔴 只在 scheduleCalc（用户真的改过）里写盘 ⇒ 从没填过的人不会看到"已载入"的假提示。
  saveDraft() {
    try {
      wx.setStorageSync(DRAFT_KEY, {
        v: 1,
        cityIdx: this.data.cityIdx,
        bizIdx: this.data.bizIdx,
        marginPct: this.data.marginPct,
        expectYuan: this.data.expectYuan,
        targetYuan: this.data.targetYuan,
        build: this.data.buildRows.map((r) => ({ key: r.key, yuan: r.yuan, years: r.years })),
        fixed: this.data.fixedRows.map((r) => ({ key: r.key, yuan: r.yuan })),
        varRows: this.data.varRows.map((r) => ({ key: r.key, pct: r.pct })),
      });
    } catch (e) { /* 写盘失败不影响测算：草稿只是锦上添花，不打扰用户 */ }
  },

  restoreDraft() {
    let d = null;
    try { d = wx.getStorageSync(DRAFT_KEY); } catch (e) { d = null; }
    if (!d || d.v !== 1) return false;
    const build = (d.build || []).map((x) => mkRow(x.key, M.buildItems, M.buildItemNotes, { yuan: x.yuan, years: x.years }));
    const fixed = (d.fixed || []).map((x) => mkRow(x.key, M.fixedItems, M.fixedItemNotes, { yuan: x.yuan, ph: M.buildPh }));
    const varRows = (d.varRows || []).map((x) => mkRow(x.key, M.varItems, M.varItemNotes, { pct: x.pct }));
    const ci = d.cityIdx || 0;
    const bi = d.bizIdx || 0;
    this.setData({
      cityIdx: ci, cityName: M.cityTiers[ci].name,
      bizIdx: bi, bizName: M.bizTypes[bi].name,
      buildRows: build.length ? build : this.data.buildRows,
      fixedRows: fixed.length ? fixed : this.data.fixedRows,
      varRows: varRows.length ? varRows : this.data.varRows,
      marginPct: typeof d.marginPct === 'number' ? d.marginPct : this.data.marginPct,
      expectYuan: d.expectYuan || '',
      targetYuan: d.targetYuan || '',
      draftRestored: true,
    });
    return true;
  },

  // 清空重填：清本地草稿 + 整页重进（不复制一份"初始值"代码 ⇒ 不可能与默认态不一致）
  // ⚠️ 不用 wx.reLaunch 之外的方式：手写一遍初始行 = 两份真相源，将来改默认值必漏一处。
  onClearDraft() {
    wx.showModal({
      title: M.clearDraft,
      content: M.draftClearConfirm,
      // ⚠️ 必须写全路径 TERMS.m2.xxx：modal 按钮长度守卫只解析 TERMS.*，别名 M.* 解析不了会判红
      confirmText: TERMS.m2.draftClearOk,
      cancelText: TERMS.buttons.cancel,
      confirmColor: '#e74c3c',
      success: (r) => {
        if (!r.confirm) return;
        try { wx.removeStorageSync(DRAFT_KEY); } catch (e) { /* 忽略 */ }
        wx.reLaunch({ url: '/pages/sandbox/index' });
      },
    });
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
    // M2v1.3：主分类变了 ⇒ 类内预设跟着换（不同 bizKey 的预设不同）
    this.syncPresetOptions();
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
    const rows = this.data.fixedRows.concat([mkRow(k, M.fixedItems, M.fixedItemNotes, { yuan: '', ph: M.buildPh })]);
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

  // ===== 预计月营业额（锚点 · round114）=====
  onExpect(e) { this.setData({ expectYuan: e.detail.value }); this.scheduleCalc(); },

  // ===== M2v1.1 双 Tab + 反推输入 =====
  onTab(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({ mode });
    // 切到反推 Tab 立即触发一次反推（复用防抖）
    this.scheduleCalc();
  },
  onRevPrice(e) { this.setData({ revPriceYuan: e.detail.value }); this.scheduleCalc(); },
  onRevSeats(e) { this.setData({ revSeats: e.detail.value }); this.scheduleCalc(); },
  onRevOpenDays(e) { this.setData({ revOpenDays: e.detail.value }); this.scheduleCalc(); },
  onRevRentRate(e) { this.setData({ revRentRate: e.detail.value }); this.scheduleCalc(); },
  onRevPixelEff(e) { this.setData({ revPixelEff: e.detail.value }); this.scheduleCalc(); },

  // ===== 自动重算（防抖；AD-6/AD-7 折中）=====
  scheduleCalc() {
    this.setData({ dirty: true });
    // R193：用户一改就存草稿（此处已是 700ms 防抖链路上，不会高频写盘）
    this.saveDraft();
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.onCalc(); }, DEBOUNCE_MS);
  },

  /**
   * 重算（唯一云端交互点）。
   * @param {boolean} isFirst 首次进页面=true ⇒ 走整页 loading（wxml 用 `wx:if="{{!loading}}"` 整页切换）
   *
   * ⚠️ round114 修 ①：此前每次自动重算都把 loading 置 true ⇒ 用户每改一个数、停顿 700ms 后
   *    **整页闪成"加载中"**（输入框被整页重绘，体验差且易丢光标）。改为只有首算才整页 loading。
   * ⚠️ round114 修 ②：加请求序号 _seq —— 云函数有网络延迟，慢响应的**旧结果**可能晚于新结果返回，
   *    把界面覆盖成上一次的数（改了数却看到旧保本点）。序号不匹配即丢弃过期响应。
   */
  async onCalc(isFirst) {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const first = !!isFirst;
    if (first) this.setData({ loading: true, calcError: '' });
    const seq = ++this._seq;
    const isReverse = this.data.mode === 'reverse';

    // M2v1.3：选了类内预设 ⇒ 走「参数包装配 → 回本卡」的预设前向分支
    if (!isReverse && this.data.presetKey) {
      return this.onCalcPresetFwd();
    }

    // ===== M2v1.1 反推分支 =====
    if (isReverse) {
      // 固定支出剔除 rent（页面已隐藏房租行，此处保险再滤一层）
      const fixedItems = this.data.fixedRows
        .filter((r) => r.key !== 'rent')
        .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan) }))
        .filter((x) => x.fen > 0);
      try {
        const d = await api.call('calcSandbox', {
          mode: 'reverse',
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
          rev_price_fen: api.yuanToFen(this.data.revPriceYuan),
          seats: Number(this.data.revSeats) || 0,
          open_days: Number(this.data.revOpenDays) || 0,
          target_rent_rate: Number(this.data.revRentRate) || 0,
          pixel_eff_fen: api.yuanToFen(this.data.revPixelEff),
          client_request_id: 'sb_' + Date.now(),
        });
        if (seq !== this._seq) return;
        const fen = (v) => (v == null ? null : api.fenToYuan(v, 2));
        const rev = d.reverse || null;
        this.setData({
          loading: false,
          dirty: false,
          reverseResult: rev ? {
            red_alert: !!rev.red_alert,
            target_monthly: fen(rev.target_monthly_fen),
            rent_cap: fen(rev.rent_cap_fen),
            monthly_traffic: rev.monthly_traffic,
            daily_traffic: rev.daily_traffic,
            turn_rate: rev.turn_rate,
            area_cap_sqm: rev.area_cap_sqm,
            warn_turn_high: Array.isArray(rev.warn_keys) && rev.warn_keys.indexOf('turnOverHigh') >= 0,
          } : null,
          calcError: rev ? '' : M.needFixed,
        });
      } catch (e) {
        if (seq !== this._seq) return;
        this.setData({ loading: false, dirty: false, reverseResult: null, calcError: e.msg || '' });
        api.toastError(e);
      }
      return;
    }

    // ===== 正向分支（现状，逐字节不变）=====
    const fixedItems = this.data.fixedRows
      .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan) }))
      .filter((x) => x.fen > 0);
    // ⚠️ round113：**不再**在"无固定支出"时提前 return —— 因为"行业参考区间"与用户填了什么无关，
    //    进页面 / 换业态城市时就该显示。改为照常请求后端，只是**不展示测算结果**（保本点此时无意义）。
    const hasFixed = fixedItems.length > 0;
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
        // round114：预计月营业额（选填）—— 后端据此反算各项参考金额（amount_preview）
        expected_revenue_fen: api.yuanToFen(this.data.expectYuan),
        client_request_id: 'sb_' + Date.now(),
      });
      if (seq !== this._seq) return;      // 过期响应：新请求已在路上，丢弃
      const fen = (v) => (v == null ? null : api.fenToYuan(v, 2));
      const amt = this.amountMaps(d.amount_preview || []);
      const rowsWithPh = this.applyRefAmount(this.data.fixedRows, amt);
      const phChanged = rowsWithPh.some((r, i) => r.ph !== this.data.fixedRows[i].ph);
      this.setData({
        // 行业参考区间（round113）+ 参考金额（round114）：与"填了多少"无关，红警时也在
        bands: this.decorateBands(d.bands_preview || [], amt),
        marginBand: this.pickBand(d.bands_preview, 'grossMargin'),
        // 只在真的变了才回写（减少无谓的输入行重绘）
        fixedRows: phChanged ? rowsWithPh : this.data.fixedRows,
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
      if (seq !== this._seq) return;
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
  // round114：追加参考**金额**（amt）—— 用户填了"预计月营业额"后，每项旁边给出该量级下的
  //   参考金额，把"给区间"升级为"给起点"。
  // ⚠️ 本函数**不含任何数值常量、不含任何公式** —— 区间与金额的单源都在云端 indicatorRef
  //    （BANDS / suggestAmounts），经 bands_preview / amount_preview 下发；前端只做拼装。
  decorateBands(list, amt) {
    const names = M.indNames;
    const byInd = (amt && amt.byInd) || {};
    return (list || []).map((x) => ({
      key: x.key,
      name: names[x.key] || x.key,
      band: x.lo == null ? '—' : x.lo + '~' + x.hi + '%',
      amt: byInd[x.key] || '',
    }));
  },

  /** amount_preview → 两张匹配表：按固定项 key（输入行）/ 按指标 key（参考区间卡）。 */
  amountMaps(list) {
    const byFixed = {};
    const byInd = {};
    (list || []).forEach((x) => {
      const s = api.fenToYuanInt(x.fen);
      if (x.key) byFixed[x.key] = s;
      if (x.indKey) byInd[x.indKey] = s;
    });
    return { byFixed, byInd };
  },

  /**
   * 把参考金额写进固定支出行的 placeholder（灰字起点）。
   * 🔴 只改 placeholder，**绝不碰用户已填的 yuan** —— 参考值是"起点"不是"答案"：
   *    自动填值会让用户跳过核对，直接得到一份"自证的合理"（round114 设计边界）。
   */
  applyRefAmount(rows, amt) {
    const byFixed = (amt && amt.byFixed) || {};
    return (rows || []).map((r) => Object.assign({}, r, {
      ph: byFixed[r.key] ? (M.refAmtPh + byFixed[r.key]) : M.buildPh,
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

  // ===== M2v1.2（多方案存储 · 第二期）：我的方案入口 + 保存沙盘 =====
  onSaveEntry() {
    wx.navigateTo({ url: '/pages/sandbox/list' });
  },

  onOpenSave() {
    // 每次打开弹窗生成一次 uuid；同一次点击重试必须复用（否则幂等失效）
    this.setData({
      showSave: true,
      planName: '',
      planType: this.data.mode === 'reverse' ? 'biz_sim' : 'site_select',
      planSaving: false,
      saveCrid: 'sd_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
    });
  },
  onSaveType(e) { this.setData({ planType: e.currentTarget.dataset.type }); },
  onSaveName(e) { this.setData({ planName: e.detail.value }); },
  onCancelSave() { this.setData({ showSave: false, saveCrid: '' }); },

  // 组装 14 字段 snake_case 的 param_json（= calcSandbox 的 wire 形态；保存与重算同源）
  buildParam() {
    const isRev = this.data.mode === 'reverse';
    const fixedItems = this.data.fixedRows
      .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan) }))
      .filter((x) => x.fen > 0);
    return {
      mode: isRev ? 'reverse' : 'forward',
      city_tier: this.data.t.cityTiers[this.data.cityIdx].key,
      biz_type: this.data.t.bizTypes[this.data.bizIdx].key,
      build_items: this.data.buildRows
        .filter((r) => api.yuanToFen(r.yuan) > 0)
        .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan), years: Number(r.years) || 1 })),
      fixed_items: isRev ? fixedItems.filter((r) => r.key !== 'rent') : fixedItems,
      var_items: this.data.varRows
        .filter((r) => Number(r.pct) > 0)
        .map((r) => ({ key: r.key, pct: Number(r.pct) })),
      gross_margin_pct: Number(this.data.marginPct),
      target_profit_fen: api.yuanToFen(this.data.targetYuan),
      expected_revenue_fen: api.yuanToFen(this.data.expectYuan),
      rev_price_fen: api.yuanToFen(this.data.revPriceYuan),
      seats: Number(this.data.revSeats) || 0,
      open_days: Number(this.data.revOpenDays) || 0,
      target_rent_rate: Number(this.data.revRentRate) || 0,
      pixel_eff_fen: api.yuanToFen(this.data.revPixelEff),
    };
  },

  async onSavePlan() {
    const name = (this.data.planName || '').trim();
    if (!name) {
      api.toastError({ msg: TERMS.m2.planNameRequired });
      return;
    }
    if (this.data.planSaving) return;
    this.setData({ planSaving: true });
    const crid = this.data.saveCrid;   // 幂等键：本次点击固定，重试复用
    const paramJson = this.buildParam();
    try {
      const d = await api.call('savePlan', {
        plan: {
          sandbox_id: this.data.sandboxId || '',
          name,
          sandbox_type: this.data.planType,
          param_json: paramJson,
        },
        client_request_id: crid,
      });
      this.setData({ showSave: false, planSaving: false, saveCrid: '', sandboxId: d.sandbox_id || d.plan_id || this.data.sandboxId });
      wx.showToast({ title: TERMS.m2.planSavedOk, icon: 'success' });
    } catch (e) {
      this.setData({ planSaving: false });
      api.toastError(e);
    }
  },

  // ===== M2v1.3（业态参数包 + 回本卡 · 第三期）=====
  // 当前主分类下的类内预设选项（主分类 4 类，类内预设由 bizPreset.js 供给）
  syncPresetOptions() {
    const bizKey = this.data.t.bizTypes[this.data.bizIdx].key;
    const opts = BIZ_PRESETS
      .filter((p) => p.bizKey === bizKey)
      .map((p) => ({ key: p.presetKey, name: this.data.t.bizPresets[p.presetKey] || p.presetKey }));
    // 前端先补一项「不确定」（key=''；选了它 = 不用预设，手填全部）
    const none = { key: '', name: this.data.t.presetNone };
    const full = [none].concat(opts);
    // 若当前预设不属于新主分类，重置
    const still = BIZ_PRESETS.filter((p) => p.presetKey === this.data.presetKey && p.bizKey === bizKey).length > 0;
    const presetIdx = still ? full.findIndex((o) => o.key === this.data.presetKey) : 0;
    this.setData({ presetOptions: full, presetIdx, presetName: still ? this.data.presetName : this.data.t.presetNone, presetPicked: still });
  },

  onPreset(e) {
    const i = Number(e.detail.value);
    const opt = this.data.presetOptions[i];
    if (!opt || !opt.key) {
      // 「不确定」：清空预设，回到手填全部
      this.setData({ presetKey: '', presetName: this.data.t.presetNone, presetPicked: false, feeRows: [], feeOverrides: {} });
      this.scheduleCalc();
      return;
    }
    const preset = findPreset(opt.key);
    const patch = {
      presetKey: opt.key,
      presetName: opt.name,
      presetPicked: true,
      feeRows: (preset.costMeta || [])
        .filter((m) => m.form === 'revenue_rate')
        .map((m) => ({ key: m.itemKey, label: m.labelKey === 'costLoss' ? this.data.t.costLoss : (this.data.t.fixedItems[m.itemKey] || m.itemKey), pct: String(m.pct) })),
      feeOverrides: {},
    };
    // 自动带出参数包默认值（只覆盖还为空 / 未改的项）
    if (preset.params && preset.params.grossMarginPct) patch.marginPct = preset.params.grossMarginPct.v;
    if (preset.params && preset.params.openDays) patch.openDaysNum = String(preset.params.openDays.v);
    if (preset.params && preset.params.laborUnitYuan) patch.laborUnitYuan = String(preset.params.laborUnitYuan.v);
    if (preset.params && preset.params.avgPriceYuan) patch.avgPriceYuan = String(preset.params.avgPriceYuan.v);
    this.setData(patch);
    this.scheduleCalc();
  },
  onArea(e) { this.setData({ areaNum: e.detail.value }); this.scheduleCalc(); },
  onRent(e) { this.setData({ rentYuan: e.detail.value }); this.scheduleCalc(); },
  onHeadcount(e) { this.setData({ headcountNum: e.detail.value }); this.scheduleCalc(); },
  onAvgPrice(e) { this.setData({ avgPriceYuan: e.detail.value }); this.scheduleCalc(); },
  onLaborUnit(e) { this.setData({ laborUnitYuan: e.detail.value }); this.scheduleCalc(); },
  onOpenDays2(e) { this.setData({ openDaysNum: e.detail.value }); this.scheduleCalc(); },
  onPixelEff(e) { this.setData({ pixelEffYuan: e.detail.value }); this.scheduleCalc(); },
  onTurn(e) { this.setData({ turnNum: e.detail.value }); this.scheduleCalc(); },
  onFeePct(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const overrides = Object.assign({}, this.data.feeOverrides, { [key]: val });
    const feeRows = this.data.feeRows.map((r) => (r.key === key ? Object.assign({}, r, { pct: val }) : r));
    this.setData({ feeOverrides: overrides, feeRows });
    this.scheduleCalc();
  },
  onToggleL2() { this.setData({ showL2: !this.data.showL2 }); },
  onToggleL3() { this.setData({ showL3: !this.data.showL3 }); },
  onToggleAssumptions() { this.setData({ showAssumptions: !this.data.showAssumptions }); },
  onGoM3() { wx.switchTab({ url: '/pages/m3/hub' }); },

  // 统一入参装配（preset 态）：cost_meta 形态运算**只在 assembleItems 内**，本方法不做任何保本/毛利率/摊销算式
  buildPresetParam() {
    const preset = findPreset(this.data.presetKey) || BIZ_PRESETS[0];
    const cityKey = this.data.t.cityTiers[this.data.cityIdx].key;
    const coef = Object.assign({ rent: 1, labor: 1 }, CITY_COEF[cityKey] || {});
    const userBuild = this.data.buildRows
      .filter((r) => api.yuanToFen(r.yuan) > 0)
      .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan), years: Number(r.years) || 1 }));
    const input = {
      area: Number(this.data.areaNum) || 0,
      headcount: Number(this.data.headcountNum) || 0,
      rentYuan: Number(this.data.rentYuan) || 0,
      fixedYuan: { rent: this.data.rentYuan },
      buildItems: userBuild,
    };
    const { fixedItems, varItems } = assembleItems(preset, input, coef);
    const fo = this.data.feeOverrides || {};
    const varItemsFinal = varItems.map((v) =>
      (fo[v.key] != null && fo[v.key] !== '' ? { key: v.key, pct: Number(fo[v.key]) } : v));
    const buildItems = resolveBuild(preset, input);
    const openDays = (this.data.openDaysNum && this.data.openDaysNum !== '') ? Number(this.data.openDaysNum)
      : (preset.params && preset.params.openDays ? preset.params.openDays.v : 30);
    return {
      mode: 'forward',
      city_tier: cityKey,
      biz_type: preset.bizKey,
      build_items: buildItems,
      fixed_items: fixedItems,
      var_items: varItemsFinal,
      gross_margin_pct: Number(this.data.marginPct),
      target_profit_fen: api.yuanToFen(this.data.targetYuan),
      expected_revenue_fen: api.yuanToFen(this.data.expectYuan),
      rev_price_fen: api.yuanToFen(this.data.avgPriceYuan),
      seats: 0,
      open_days: openDays,
      target_rent_rate: 0,
      pixel_eff_fen: api.yuanToFen(this.data.pixelEffYuan),
      _preset: preset,
      _targetFen: api.yuanToFen(this.data.targetYuan),
    };
  },

  // 预设前向测算：结果区渲染 + 回本卡（invest 读引擎，cash 走 bizPreset.paybackCash 唯一派生）
  async onCalcPresetFwd() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const seq = ++this._seq;
    const p = this.buildPresetParam();
    const payload = {
      city_tier: p.city_tier, biz_type: p.biz_type,
      build_items: p.build_items, fixed_items: p.fixed_items, var_items: p.var_items,
      gross_margin_pct: p.gross_margin_pct, target_profit_fen: p.target_profit_fen,
      expected_revenue_fen: p.expected_revenue_fen,
      rev_price_fen: p.rev_price_fen, seats: p.seats, open_days: p.open_days,
      target_rent_rate: p.target_rent_rate, pixel_eff_fen: p.pixel_eff_fen,
      client_request_id: 'sb_' + Date.now(),
    };
    try {
      const d = await api.call('calcSandbox', payload);
      if (seq !== this._seq) return;
      const fen = (v) => (v == null ? null : api.fenToYuan(v, 2));
      const hasFixed = p.fixed_items.length > 0;
      // 回本卡（invest 直读引擎 payback_months；cash 唯一派生在 bizPreset）
      const invest = d.payback_months;
      const cash = paybackCash(d.build_total_fen, p._targetFen, d.build_amort_monthly_fen);
      const payback = {
        invest: invest != null ? api.fenToYuan(api.yuanToFen(invest), 0) : null,
        cash: cash != null ? String(cash) : null,
        investDefault: p._preset.paybackView === 'invest',
        hasData: invest != null || cash != null,
      };
      const amt = this.amountMaps(d.amount_preview || []);
      const rowsWithPh = this.applyRefAmount(this.data.fixedRows, amt);
      this.setData({
        bands: this.decorateBands(d.bands_preview || [], amt),
        marginBand: this.pickBand(d.bands_preview, 'grossMargin'),
        result: !hasFixed ? null : {
          red_alert: !!d.red_alert,
          build_total: fen(d.build_total_fen),
          build_amort: fen(d.build_amort_monthly_fen),
          fixed_total: fen(d.fixed_total_fen),
          platform_pct: d.platform_pct,
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
        payback,
        presetAssumptions: this.buildAssumptions(p._preset, d),
        calcError: hasFixed ? '' : M.needFixed,
        dirty: false,
      });
    } catch (e) {
      if (seq !== this._seq) return;
      if (e.code === 'M2_RED_ALERT') { this.setData({ result: { red_alert: true }, calcError: '' }); }
      else { this.setData({ calcError: e.msg || '' }); api.toastError(e); }
    }
  },

  // 底部假设卡（只读展示参数包默认值 + 来源；不参与计算）
  buildAssumptions(preset, d) {
    const rows = [];
    if (preset.params && preset.params.grossMarginPct) rows.push({ label: M.marginName, val: preset.params.grossMarginPct.v + '%', src: preset.params.grossMarginPct.src });
    if (preset.params && preset.params.openDays) rows.push({ label: M.revOpenDays, val: String(preset.params.openDays.v) + '天', src: preset.params.openDays.src });
    if (preset.params && preset.params.laborUnitYuan) rows.push({ label: M.laborUnitLabel, val: preset.params.laborUnitYuan.v + '元/人·月', src: preset.params.laborUnitYuan.src });
    if (preset.params && preset.params.avgPriceYuan) rows.push({ label: M.avgPriceLabel, val: preset.params.avgPriceYuan.v + '元', src: preset.params.avgPriceYuan.src });
    const fee = M.varItems;
    (preset.costMeta || []).forEach((m) => {
      if (m.form === 'revenue_rate') rows.push({ label: m.labelKey === 'costLoss' ? M.costLoss : (fee[m.itemKey] || m.itemKey), val: m.pct + '%', src: m.src });
    });
    return rows;
  },
});
