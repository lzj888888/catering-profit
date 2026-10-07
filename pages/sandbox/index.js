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
// R234：新增 `bizKeyOfPreset`（预设 → 4 大类，供"平铺业态"后自动定参考带）
//       与 `estimateSeats`（面积 × 业态密度 → 座位默认值生成器）。
const { BIZ_PRESETS, CITY_COEF, assembleItems, resolveBuild, paybackCash, findPreset,
  bizKeyOfPreset, estimateSeats } = require('../../utils/bizPreset.js');

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
      bizAutoNote: M.bizAutoNote,
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
      tabForwardSub: M.tabForwardSub,
      tabReverseSub: M.tabReverseSub,
      revPrice: M.revPrice,
      // 🔴 R234：`revRentRate`（目标租金率）**已从输入项移除**（不再向用户收这个数）。
      //    它由系统自动取「本业态 × 本城市」的**健康租金上限**（云端 BANDS 单源），
      //    界面上只告诉用户"按什么行规算的"，不给输入框。
      rentRateAutoPre: M.rentRateAutoPre,
      rentRateAutoMid: M.rentRateAutoMid,
      rentRateAutoUnit: M.rentRateAutoUnit,
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
      l1Guide: M.l1Guide,
      seatLabel: M.seatLabel,
      seatPh: M.seatPh,
      seatNote: M.seatNote,
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
      // ── R234 · 主结论卡「这个铺子租金贵不贵」──
      // 🔴 三处登记的第二处（第一处 terms.js、第三处 index.wxml）：漏登记 ⇒ **渲染空白且零报错**。
      // ⚠️ 判定值不自造：全部读引擎 `indicators` 里 rent 那行的 level（good/ok/warn/bad/na）。
      verdictTitle: M.verdictTitle,
      verdictGood: M.verdictGood,
      verdictOk: M.verdictOk,
      verdictWarn: M.verdictWarn,
      verdictBad: M.verdictBad,
      verdictNa: M.verdictNa,
      verdictNoteGood: M.verdictNoteGood,
      verdictNoteOk: M.verdictNoteOk,
      verdictNoteWarn: M.verdictNoteWarn,
      verdictNoteBad: M.verdictNoteBad,
      verdictNoteNa: M.verdictNoteNa,
      verdictRentLabel: M.verdictRentLabel,
      verdictCompare: M.verdictCompare,
      // ── R234/J4 行内长提示折叠（M2 选址页 8 处 ≥18 字的提示）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
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
    mode: 'forward',         // 'forward' 已有铺面 | 'reverse' 寻找铺面（**值未变**，只有文案改名）
    // 🔴 R234 移除：`revRentRate`（目标租金率）与 `revPixelEff`（坪效）两个**输入字段**。
    //    · 租金率 ⇒ 改由 `rentRateDefault()` 自动取云端 BANDS 的健康上限（不再问用户）；
    //    · 坪效   ⇒ 与 L3 已有的 `pixelEffYuan` 是同一个东西，**复用那一个**（此前同义两项并存）。
    //    ⚠️ 云端入参 `target_rent_rate` / `pixel_eff_fen` **保留**（契约 + 快照需要），只是换了取值来源。
    reverseResult: null,     // 反推结果（reverse 块）
    rentRatePct: '',         // R234：本次采用的房租行规（%，来自云端 BANDS，**只读回显**）
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
    seatsNum: '',            // R234：座位数（L2；由面积 × 业态密度估算，**用户可改**）
    seatEstimated: false,    // 当前 seatsNum 是否还是"系统估的"（估的就允许再估一次；用户改过就别覆盖）
    pixelEffYuan: '',        // 坪效（元/㎡·月）
    turnNum: '',             // 翻台率
    feeOverrides: {},        // itemKey → pct 字符串（L3 费率覆盖）
    feeRows: [],             // 当前预设 revenue_rate 项 [{key,label,pct}]
    showL2: false,
    showL3: false,
    showAssumptions: false,
    // R234/J4：行内长提示折叠（与月录入页同一套 `hintFold` map 模式，默认全收起）。
    //   ⚠️ 与上面三个区段级折叠（showL2/showL3/showAssumptions，走 .fold-toggle）**语义不同**：
    //      那三个收的是**整块参数区**，本 map 收的是**一句说明文案**。两者并存、互不干扰。
    hintFold: {},
    payback: null,           // {invest, cash, investDefault}（M2v1.3 回本卡）
    presetAssumptions: [],   // 底部假设卡行 [{label,val,src}]
    bandsRaw: [],            // R234：云端 bands_preview **原样留存**（拿到 rent.hi 用，见 rentRateDefault）
    bandsRawKey: '',         // 上面这份数据对应哪一组「城市 × 业态」（= cityIdx + ':' + bizIdx）
    verdict: null,           // R234：主结论卡 {level, levelName, note, mine, band, rentPct}
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
  // 🔴 R234：删掉 `onRevRentRate` / `onRevPixelEff` 两个 handler ——
  //    对应输入框已从 wxml 移除（R223 §3.2 明令「L1/L2 严禁以坪效/目标租金率作输入」）。
  //    留着孤立的 handler 会让后续维护误以为还有这条路。
  onSeats(e) { this.setData({ seatsNum: e.detail.value, seatEstimated: false }); this.scheduleCalc(); },

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

    // M2v1.3：选了业态预设 ⇒ 走「参数包装配」的统一分支（两个 Tab 共用同一套 L1/L2/L3 输入）
    if (this.data.presetKey) {
      const needsRefresh = this.bandsStale();
      // 🔴 R234 时序修正：反推 Tab 的 `target_rent_rate` 取自 `bandsRaw`（房租行规上限）。
      //    换业态 / 换城市后若直接发 reverse，会拿**上一组合**的行规去判 ⇒ 数字看着正常、判据错了。
      //    ⇒ 过期时**先补一次 forward**（只为把新行规取回来），紧接着再走 reverse。
      if (isReverse && needsRefresh) {
        await this.onCalcPresetFwd();
        if (seq !== this._seq) return;
      }
      return isReverse ? this.onCalcPresetRev() : this.onCalcPresetFwd();
    }

    // ===== M2v1.1 反推分支（**未选预设**时的兼容路径）=====
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
          // R234：同义字段合并 —— 人均/座位/天数/坪效一律取 L2/L3 那一份（反推卡不再另收）
          rev_price_fen: api.yuanToFen(this.data.avgPriceYuan),
          seats: Number(this.data.seatsNum) || 0,
          open_days: Number(this.data.openDaysNum) || 0,
          target_rent_rate: this.rentRateDefault(),
          pixel_eff_fen: api.yuanToFen(this.data.pixelEffYuan),
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
        // R234：`bands_preview` 原样留存（`rentRateDefault()` 要读 rent.hi，见预设前向分支同处注释）
        bandsRaw: d.bands_preview || [],
        bandsRawKey: this.bandsKeyNow(),
        // 行业参考区间（round113）+ 参考金额（round114）：与"填了多少"无关，红警时也在
        bands: this.decorateBands(d.bands_preview || [], amt),
        marginBand: this.pickBand(d.bands_preview, 'grossMargin'),
        verdict: !hasFixed ? null : this.verdictOf(d.indicators_at_target || []),
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
    // 🔴 R234：选了业态预设 ⇒ **必须走同一套装配**（`buildPresetParam`）。
    //   此前无论什么态都手写一份 fixedRows/varRows ⇒ 预设态下**保存的是手填那份**，
    //   而页面显示的来自参数包 —— 同一方案保存前后对不上（重开会算出另一个保本点）。
    //   「保存与重算同源」只有共用装配才成立。
    if (this.data.presetKey) return this.buildPresetParam(this.data.mode);
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
      // R234：同义字段合并 —— 一律取 L2/L3 那一份（反推卡不再另收一套）
      rev_price_fen: api.yuanToFen(this.data.avgPriceYuan),
      seats: Number(this.data.seatsNum) || 0,
      open_days: Number(this.data.openDaysNum) || 0,
      target_rent_rate: this.rentRateDefault(),
      pixel_eff_fen: api.yuanToFen(this.data.pixelEffYuan),
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
  // 🔴 R234：业态预设**平铺**（背景见 terms.js 的 R234 段与本文件顶部注释）。
  //   旧的 `filter(p => p.bizKey === bizKey)` 按上一级「经营类型」过滤，而 6 个预设分布是
  //   快餐 2 / 火锅 2 / **正餐 1 / 茶饮 1** ⇒ 选「中式正餐」后下拉**只剩 1 项**。
  //   ⇒ 治法：用户只需回答「我开什么店」；`bizKey`（4 大类）由**系统**反查（`bizKeyOfPreset`），
  //     它只是去云端取 `BANDS` 的钥匙，**不是一道要用户先答的题**。
  syncPresetOptions() {
    const opts = BIZ_PRESETS.map((p) => ({
      key: p.presetKey,
      name: this.data.t.bizPresets[p.presetKey] || p.presetKey,
    }));
    const full = [{ key: '', name: this.data.t.presetNone }].concat(opts);
    const idx = full.findIndex((o) => o.key === this.data.presetKey);
    const still = idx >= 0;
    this.setData({
      presetOptions: full,
      presetIdx: still ? idx : 0,
      presetName: still ? full[idx].name : this.data.t.presetNone,
      presetPicked: still,
    });
  },

  // R234：面积 → 座位数（**默认值生成器**，不是测算）。
  // ⚠️ 覆盖策略：只在该字段**空着**或**上次是系统估的**时才覆盖；
  //    用户一旦手改过（`seatEstimated=false`）就再也不碰 —— 否则改一次面积就把用户的数冲掉。
  reestimateSeats(presetKey) {
    if (this.data.seatsNum !== '' && !this.data.seatEstimated) return null;
    const est = estimateSeats(presetKey, this.data.areaNum);
    if (est === '') return null;
    return { seatsNum: est, seatEstimated: true };
  },

  onPreset(e) {
    const i = Number(e.detail.value);
    const opt = this.data.presetOptions[i];
    if (!opt || !opt.key) {
      // 「都不是（我自己填）」：清空预设，回到手填全部
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
    // 🔴 R234：选完业态 ⇒ **系统**把 4 大类对齐（用户不再被问这一题）。
    //   ⚠️ 必须真的写进 bizIdx：`bands_preview` / `indicators` 的行规都按它取，
    //      不同步会让下面整套参考带停在旧业态上（用户看不到任何报错）。
    const bk = bizKeyOfPreset(opt.key);
    if (bk) {
      const bi = this.data.t.bizTypes.findIndex((x) => x.key === bk);
      if (bi >= 0) {
        patch.bizIdx = bi;
        patch.bizName = this.data.t.bizTypes[bi].name;
      }
    }
    // 自动带出参数包默认值（只覆盖还为空 / 未改的项）
    if (preset.params && preset.params.grossMarginPct) patch.marginPct = preset.params.grossMarginPct.v;
    if (preset.params && preset.params.openDays) patch.openDaysNum = String(preset.params.openDays.v);
    if (preset.params && preset.params.laborUnitYuan) patch.laborUnitYuan = String(preset.params.laborUnitYuan.v);
    if (preset.params && preset.params.avgPriceYuan) patch.avgPriceYuan = String(preset.params.avgPriceYuan.v);
    const seat = this.reestimateSeats(opt.key);
    if (seat) { patch.seatsNum = seat.seatsNum; patch.seatEstimated = true; }
    this.setData(patch);
    this.scheduleCalc();
  },
  onArea(e) {
    const seats = this.reestimateSeats(this.data.presetKey);
    this.setData(Object.assign({ areaNum: e.detail.value }, seats || {}));
    this.scheduleCalc();
  },
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

  // R234/J4：**通用「行内提示折叠」开关**（与月录入页 `pages/month/input.js` 同一实现，
  //   保持仓内单一形态 —— 两页若各写一套，将来改判据要改两处）。
  //   一个 handler 服务本页 8 处，折叠态集中在 `hintFold` 一个 map 里，新增位置只是加一个键。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;                       // 无 key ⇒ 静默返回（不误翻别人的状态）
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
  },
  onGoM3() { wx.switchTab({ url: '/pages/m3/hub' }); },

  /**
   * 🔴 R234：本业态 × 本城市的**健康租金上限**（%），由系统自动取，**不再向用户收这个数**。
   *
   * 为什么是「健康区间上限」而不是豆包那组「保本极限红线」（快餐≤15%/中餐18~20%/火锅≤20%）：
   *   那组数据豆包已自述为「一线经验估算、非公开调研、样本仅重庆街边店」，并明确
   *   「不适合作为健康经营标准采信，你们 5~10%/8~15% 数据源更严谨，优先采信」。
   *   两者语义也不同：我方=健康盈利区间（有利润缓冲），它=保本临界（几无缓冲）。
   *   且只给一个数时应取**更保守**的 —— 新手最容易高估自己，给极限红线会让他
   *   误以为「不超过 20% 就没问题」。（同 R224 处理「火锅水电 8~12%」的套路。）
   *
   * ⚠️ 单源：数值来自云端 `bands_preview`（`indicatorRef.BANDS.rent` × 城市系数），
   *    前端**不复制、不硬编码**任何一个百分比 —— 复制一份立刻就有两份真相源。
   * @returns {number} 健康租金上限（%）；取不到 ⇒ 0（调用方按 0 处理）
   */
  rentRateDefault() {
    const key = this.data.cityIdx + ':' + this.data.bizIdx;
    // 🔴 过期保护：`bandsRaw` 是**上一组**业态/城市的结果时**不能拿来用** ——
    //    否则换业态后头一次反推会用旧业态的行规判房租（错得很隐蔽：数字一样，判据换了）。
    if (this.data.bandsRawKey !== key) return 0;
    const row = (this.data.bandsRaw || []).filter((x) => x.key === 'rent')[0];
    return row && row.hi != null ? Number(row.hi) : 0;
  },

  /** 当前「城市 × 业态」的键值（与 `bandsRawKey` 同构）。 */
  bandsKeyNow() { return this.data.cityIdx + ':' + this.data.bizIdx; },

  /**
   * 当前这份 `bandsRaw` 是否已过期（换过业态/城市，或压根还没取到）。
   * 🔴 反推分支必须先问这一句 —— 见 `onCalc` 里 R234 时序修正处的说明。
   */
  bandsStale() {
    return this.data.bandsRawKey !== this.bandsKeyNow() || (this.data.bandsRaw || []).length === 0;
  },

  // 统一入参装配（preset 态）：cost_meta 形态运算**只在 assembleItems 内**，本方法不做任何保本/毛利率/摊销算式
  //
  // @param {string} mode 'forward'（已有铺面）| 'reverse'（寻找铺面）
  //   🔴 R234：两个 Tab **共用同一套 L1/L2/L3 输入**（此前反推 Tab 另有一套 revPrice/revSeats/…
  //     与 L2 的 avgPrice 同义并存 ⇒ 用户改一处、另一处不动，是本页第二个"重复")。
  buildPresetParam(mode) {
    const preset = findPreset(this.data.presetKey) || BIZ_PRESETS[0];
    const cityKey = this.data.t.cityTiers[this.data.cityIdx].key;
    const coef = Object.assign({ rent: 1, labor: 1 }, CITY_COEF[cityKey] || {});
    const isReverse = mode === 'reverse';
    const userBuild = this.data.buildRows
      .filter((r) => api.yuanToFen(r.yuan) > 0)
      .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan), years: Number(r.years) || 1 }));
    const input = {
      area: Number(this.data.areaNum) || 0,
      headcount: Number(this.data.headcountNum) || 0,
      rentYuan: Number(this.data.rentYuan) || 0,
      // 🔴 R219 口径（两道防线之一·装配层）：反推模式下 `fixed_items` **不得含 rent**。
      //    房租在此处是**求解目标**，把它当已知固定成本喂进去会**重复计租**
      //    （R219 实测：照豆包原算式落码 ⇒ 参考利润虚高 **25%**）。
      fixedYuan: isReverse ? {} : { rent: this.data.rentYuan },
      buildItems: userBuild,
    };
    const asm = assembleItems(preset, input, coef);
    // 第二道防线：装配产物里再滤一次（将来参数包长出别的形态也不会漏）
    const fixedItems = isReverse ? asm.fixedItems.filter((x) => x.key !== 'rent') : asm.fixedItems;
    const fo = this.data.feeOverrides || {};
    const varItemsFinal = asm.varItems.map((v) =>
      (fo[v.key] != null && fo[v.key] !== '' ? { key: v.key, pct: Number(fo[v.key]) } : v));
    const buildItems = resolveBuild(preset, input);
    const openDays = (this.data.openDaysNum && this.data.openDaysNum !== '') ? Number(this.data.openDaysNum)
      : (preset.params && preset.params.openDays ? preset.params.openDays.v : 30);
    // 🔴 R234：座位数此前只有反推 Tab 有（`revSeats`），L2 却另有一个同义的人均/天数对 ⇒ 重复。
    //    统一取 L2 的 `seatsNum`（由面积×业态密度估算、用户可改），反推 Tab 也不再单独收。
    const seats = Number(this.data.seatsNum) || 0;
    return {
      mode: mode || 'forward',
      city_tier: cityKey,
      biz_type: preset.bizKey,
      build_items: buildItems,
      fixed_items: fixedItems,
      var_items: varItemsFinal,
      gross_margin_pct: Number(this.data.marginPct),
      target_profit_fen: api.yuanToFen(this.data.targetYuan),
      expected_revenue_fen: api.yuanToFen(this.data.expectYuan),
      rev_price_fen: api.yuanToFen(this.data.avgPriceYuan),
      seats,
      open_days: openDays,
      // R234：不再来自用户输入，改由 `rentRateDefault()` 自动取本业态×本城市的健康上限。
      //   ⚠️ 字段名与形状**完全没变**（`target_rent_rate` 仍是云函数契约字段），变的只是取值来源。
      target_rent_rate: this.rentRateDefault(),
      pixel_eff_fen: api.yuanToFen(this.data.pixelEffYuan),
      _preset: preset,
      _targetFen: api.yuanToFen(this.data.targetYuan),
    };
  },

  // 预设前向测算：结果区渲染 + 回本卡（invest 读引擎，cash 走 bizPreset.paybackCash 唯一派生）
  async onCalcPresetFwd() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const seq = ++this._seq;
    const p = this.buildPresetParam('forward');
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
      const indTarget = d.indicators_at_target || [];
      this.setData({
        // R234：`bands_preview` **原样留存** —— `rentRateDefault()` 要从这里取 rent.hi，
        //      若只留 decorate 后的 `bands`（只剩拼好的字串），就再也拿不到原始数值了。
        bandsRaw: d.bands_preview || [],
        bandsRawKey: this.bandsKeyNow(),
        bands: this.decorateBands(d.bands_preview || [], amt),
        marginBand: this.pickBand(d.bands_preview, 'grossMargin'),
        verdict: !hasFixed ? null : this.verdictOf(indTarget),
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
        loading: false,
        dirty: false,
      });
    } catch (e) {
      if (seq !== this._seq) return;
      this.setData({ loading: false });
      if (e.code === 'M2_RED_ALERT') { this.setData({ result: { red_alert: true }, calcError: '' }); }
      else { this.setData({ calcError: e.msg || '' }); api.toastError(e); }
    }
  },

  // ===== R234 · 「寻找铺面」Tab：与上面共用同一套 L1/L2/L3 入参装配 =====
  //
  // 🔴 为什么必须单独写这一个分支而不再复用手写的 fixedRows 装配：
  //    旧的 reverse 分支手工拼 fixedRows/varRows，而 forward 已走 `buildPresetParam`（参数包装配）。
  //    ⇒ 同一个铺子在两个 Tab 里**看到的成本根本不是同一份**（一边按行规、一边按手填）。
  //    合并成一套后，"切 Tab" 只是换了问法，输入的钱永远是同一笔钱。
  async onCalcPresetRev() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const seq = ++this._seq;
    const p = this.buildPresetParam('reverse');
    try {
      const d = await api.call('calcSandbox', {
        mode: 'reverse',
        city_tier: p.city_tier, biz_type: p.biz_type,
        build_items: p.build_items, fixed_items: p.fixed_items, var_items: p.var_items,
        gross_margin_pct: p.gross_margin_pct, target_profit_fen: p.target_profit_fen,
        expected_revenue_fen: p.expected_revenue_fen,
        rev_price_fen: p.rev_price_fen, seats: p.seats, open_days: p.open_days,
        target_rent_rate: p.target_rent_rate, pixel_eff_fen: p.pixel_eff_fen,
        client_request_id: 'sb_' + Date.now(),
      });
      if (seq !== this._seq) return;
      const fen = (v) => (v == null ? null : api.fenToYuan(v, 2));
      const rev = d.reverse || null;
      this.setData({
        bandsRaw: d.bands_preview || [],
        bandsRawKey: this.bandsKeyNow(),
        // R234：把"本次按什么行规算"回显给用户（数字来自云端 BANDS，我们不自造）
        rentRatePct: String(this.rentRateDefault()),
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
        loading: false,
        dirty: false,
      });
    } catch (e) {
      if (seq !== this._seq) return;
      this.setData({ loading: false, dirty: false, reverseResult: null, calcError: e.msg || '' });
      api.toastError(e);
    }
  },

  /**
   * R234 · 主结论卡「这个铺子租金贵不贵」的数据组装。
   *
   * 🔴 **零自算**：判定等级**直接读引擎** `indicators` 里 rent 那行的 `level`
   *    （good/ok/warn/bad/na 由云端 `indicatorRef.levelOf` 判得出）；
   *    前端只做 `level → 中文文案` 映射 + "你的值 / 行规区间"的**原样搬运**。
   *    这样"什么叫贵"永远只有一个真相源 —— 前端改文案不会悄悄换掉判据。
   *
   * ⚠️ 为什么取 `target` 那份分母：A Tab 填的是"我想月赚多少"，判定就该站在
   *    **实现目标利润**那个营业额水位上判；用 break 那份会把目标利润漏掉。
   *
   * @param {Array} indTarget 后端 `indicators_at_target`（原始形态，未 decorate）
   */
  verdictOf(indTarget) {
    const NAME = {
      good: M.verdictGood, ok: M.verdictOk, warn: M.verdictWarn,
      bad: M.verdictBad, na: M.verdictNa,
    };
    const NOTE = {
      good: M.verdictNoteGood, ok: M.verdictNoteOk, warn: M.verdictNoteWarn,
      bad: M.verdictNoteBad, na: M.verdictNoteNa,
    };
    const row = (indTarget || []).filter((x) => x.key === 'rent')[0];
    if (!row || row.pct == null) {
      return { level: 'na', levelName: NAME.na, note: NOTE.na, mine: '', band: '' };
    }
    const lv = row.level || 'na';
    return {
      level: lv,
      levelName: NAME[lv] || '',
      note: NOTE[lv] || '',
      mine: String(row.pct) + '%',
      band: row.lo == null ? '' : row.lo + '~' + row.hi + '%',
    };
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
