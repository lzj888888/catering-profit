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
// R234：新增 `bizKeyOfPreset`（预设 → 4 大类，供"平铺业态"后自动定参考带）。
// R237：`estimateSeats`（面积 × 业态密度 → 座位估算）**已删除** —— 李老师否掉了"面积↔桌数"的强关联；
//   改为 `seatsPerTableOf`（业态默认单桌座位数）+ `turnModeOf`（翻台口径）+ `turnLevelOf`（三档难度）。
const { BIZ_PRESETS, CITY_COEF, assembleItems, resolveBuild, paybackCash, findPreset,
  // R292：周转难度改按**业态**分档（turnLevelOfBiz）—— 快餐/茶饮翻座天然高，
  //   套旧的 table/seat 通用档会把常态判成「这数偏高」，属吓跑老板的误导提示。
  bizKeyOfPreset, seatsPerTableOf, turnModeOf, turnLevelOf, turnLevelOfBiz } = require('../../utils/bizPreset.js');

const M = TERMS.m2;
const BUILD_ALL = Object.keys(M.buildItems);
// 🔴 R296 拍1：`FIXED_ALL` 随「每月固定支出」明细表删除（原仅 `onAddFixed` 使用）。
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
      bizIsOther: false,   // 🔴 round276：通用兜底业态标记（选「其他/通用餐饮」时为真）
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
      // 🔴 round279c · #10 敏感度（前端派生，引擎零改）
      sensTitle: M.sensTitle,
      sensSub: M.sensSub,
      sensMarginDown: M.sensMarginDown,
      sensBase: M.sensBase,
      sensBaseTag: M.sensBaseTag,
      sensMarginUp: M.sensMarginUp,
      sensBreakMonthly: M.sensBreakMonthly,
      sensDelta: M.sensDelta,
      sensLoading: M.sensLoading,
      sensHint: M.sensHint,
      // 🔴 round279d · #12 多渠道毛利率（前端折算，引擎零改）：堂食/外卖/团购分别给毛利率与营收占比
      channelSwitch: M.channelSwitch,
      channelNote: M.channelNote,
      channelTakeawayRatio: M.channelTakeawayRatio,
      channelGroupRatio: M.channelGroupRatio,
      channelDineinRatio: M.channelDineinRatio,
      channelTakeawayGm: M.channelTakeawayGm,
      channelGroupGm: M.channelGroupGm,
      channelBlended: M.channelBlended,
      channelBlendedDiff: M.channelBlendedDiff,
      channelParams: M.channelParams,
      channelPlatformRate: M.channelPlatformRate,
      channelPackRate: M.channelPackRate,
      channelDiscountRate: M.channelDiscountRate,
      channelGroupPlatform: M.channelGroupPlatform,
      channelOverride: M.channelOverride,
      channelOver100: M.channelOver100,
      channelSample: M.channelSample,
      channelLeveragePre: M.channelLeveragePre,
      channelLeverageMid: M.channelLeverageMid,
      channelPureTakeaway: M.channelPureTakeaway,
      channelPct: M.channelPct,
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
      otherBandNote: M.otherBandNote,
      bandPreviewNote: M.bandPreviewNote,
      buildNote: M.buildNote,
      fixedNote: M.fixedNote,
      varNote: M.varNote,
      marginBandLabel: M.marginBandLabel,
      expectRevLabel: M.expectRevLabel,
      expectRevPh: M.expectRevPh,
      expectRevTitle: M.expectRevTitle,
      expectRevNote: M.expectRevNote,
      // 🔴 round276 · 一个数、两套话术：A「实际」（诊断，看收银后台）vs B「预计」（假设，估个量）。
      //   此前 A/B 共用同一句「这家店一个月大概能做多少生意」⇒ 已开店的老板读成"让我瞎估"，
      //   而 B 的老板又以为要填真实流水 ⇒ 两边都填不对（同一字段两种语义，是最典型的一词两义坑）。
      expectRevLabelRev: M.expectRevLabelRev,
      expectRevNoteRev: M.expectRevNoteRev,
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
      // 🔴 round273：A 区补齐定案指标（每天来多少人 / 一天翻几台）的文案（见 crowdOf）
      fwdCrowdTitle: M.fwdCrowdTitle,
      fwdCrowdBreakLbl: M.fwdCrowdBreakLbl,
      fwdCrowdTargetLbl: M.fwdCrowdTargetLbl,
      fwdCrowdUnit: M.fwdCrowdUnit,
      fwdTurnLbl: M.fwdTurnLbl,
      fwdTurnUnit: M.fwdTurnUnit,
      fwdCrowdHintPre: M.fwdCrowdHintPre,
      fwdCrowdHintMid: M.fwdCrowdHintMid,
      fwdCrowdHintSuf: M.fwdCrowdHintSuf,
      // 🔴 round276 · A 区补齐 round223 §3.1 定案遗漏的「坪效 / 人效」（翻台已 round273 补）。
      fwdEffTitle: M.fwdEffTitle,
      fwdPixelEffLbl: M.fwdPixelEffLbl,
      fwdPixelEffUnit: M.fwdPixelEffUnit,
      fwdPerHeadLbl: M.fwdPerHeadLbl,
      fwdPerHeadUnit: M.fwdPerHeadUnit,
      fwdEffHint: M.fwdEffHint,
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
      // 🔴 R237：一个数、两套话术（按业态切）+ 三档难度，只渲染在**反推结果卡**里。
      revTurnRateTable: M.revTurnRateTable,
      revTurnRateSeat: M.revTurnRateSeat,
      turnNoteTable: M.turnNoteTable,
      turnNoteSeat: M.turnNoteSeat,
      turnLevelEasy: M.turnLevelEasy,
      turnLevelOk: M.turnLevelOk,
      turnLevelHard: M.turnLevelHard,
      // 🔴 P0#5（2026-10-11）：翻台「?」白话说明 + 结果吸底条（纯展示层）
      turnHelpTitle: M.turnHelpTitle,
      turnHelpBody: M.turnHelpBody,
      stickFwdLbl: M.stickFwdLbl,
      stickRevLbl: M.stickRevLbl,
      stickTap: M.stickTap,
      // 🔴 R234-实测：`revAreaCap` 映射已随面积上限输出一并移除（坪效不让问 ⇒ 恒算不出）。
      //    ⚠️ terms.js 里的定义**保留** —— 它是全项目共享词典（多页共用），不是"本页用到才算数"。
      // 🔴 R237：`revWarnTurnHigh` 映射**已删除** —— 红警同时从引擎（`warn_keys` 恒空数组）与页面移除。
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
      // M2 G1/G2（2026-10-11 改造）：入口文案（来自 TERMS.matrix / TERMS.m2Plan 单源）
      matrixEntry: TERMS.matrix.title,
      compareEntry: TERMS.m2Plan.compare,
      // M2v1.3（业态参数包 + 回本卡）
      presetLabel: M.presetLabel,
      presetNone: M.presetNone,
      presetPickedPre: M.presetPickedPre,
      presetPickedSuf: M.presetPickedSuf,
      bizPresets: M.bizPresets,
      l1Title: M.l1Title,
      l1Guide: M.l1Guide,
      // 🔴 R291 补登记（修 P1-③ 静默空白）：index.wxml:46/47 的 reverse 三元分支引用了
      //    这两个键，但此前 t:{} 只登记了 forward 那一对 ⇒ `{{undefined}}` 被 WXML 静默渲染成空串。
      //    守卫工具 tools/check_page_terms.js 的 P2-1 已精确点名本处。
      l1TitleRev: M.l1TitleRev,
      l1GuideRev: M.l1GuideRev,
      // 🔴 R237：座位数输入 ⇒ **桌数 + 单桌座位数**（口径说明见 terms.js 同名注释块）。
      tablesLabel: M.tablesLabel,
      tablesPh: M.tablesPh,
      tablesNote: M.tablesNote,
      seatsPerTableLabel: M.seatsPerTableLabel,
      seatsPerTablePh: M.seatsPerTablePh,
      seatsPerTableNote: M.seatsPerTableNote,   // 🔴 R246：供给侧口径说明
      tableUnit: M.tableUnit,
      areaLabel: M.areaLabel,
      areaUnit: M.areaUnit,
      rentLabel: M.rentLabel,
      headcountLabel: M.headcountLabel,
      headcountUnit: M.headcountUnit,
      l2Toggle: M.l2Toggle,
      l3Toggle: M.l3Toggle,
      avgPriceLabel: M.avgPriceLabel,
      // 🔴 R296 拍1（李老师 2026-10-14）：人工改「每月总额」直填（不乘人数）——
      //   原「员工月均工资 × 人数」的乘法已删（各店工资不同，乘法会失真；人数只用来算人效）。
      laborTotalLabel: M.laborTotalLabel,
      laborTotalNote: M.laborTotalNote,
      // 🔴 R296 拍3：水/电/气拆三项输入（引擎仍合成单个 utility 键，零部署）。
      waterFee: M.waterFee,
      elecFee: M.elecFee,
      gasFee: M.gasFee,
      utilitySplitNote: M.utilitySplitNote,
      // 🔴 R296 拍2：管理费可选填（留空 = 不评）。
      manageOptLabel: M.manageOptLabel,
      manageOptNote: M.manageOptNote,
      openDaysLabel2: M.openDaysLabel2,
      // 🔴 round276 · 「一个月打算开门几天」：餐饮常年开，"打算"这个词暗示可以随便选 ⇒
      //   老板会纠结填 30 还是 31。改为「每月实际开门几天」+ 注「常年开填 30」，给默认值。
      openDaysNote2: M.openDaysNote2,
      dayUnit: M.dayUnit,
      // 🔴 R234-实测：`pixelEffLabel2`（坪效）/ `turnLabel2`（翻台率）映射已移除 ——
      //    两者连同其输入框一起退出本页（李老师原话：「这些本身是咱们计算出来的」）。
      //    留着孤儿映射会让下一个人以为"页面上还有这一项"，正是本轮踩的那类坑。
      // ⚠️ terms.js 定义保留（共享词典，别处/后续可能用）。
      rentRateLabel2: M.rentRateLabel2,
      pctUnit: M.pctUnit,
      assumptionsTitle: M.assumptionsTitle,
      assumptionsHint: M.assumptionsHint,
      costLoss: M.costLoss,
      // 🔴 round278：M2 真机测试暴露的 P0 —— `onPreset`(L1100) 拼 feeRows 时读
      //    `this.data.t.fixedItems[itemKey]`，但本键自 M2 v1.3 起从未映射进 t:{}，
      //    点选任意业态预设即抛 `TypeError: Cannot read properties of undefined (reading 'utility')`，选择静默失效。
      //    与 `costLoss: M.costLoss` 同族补回；terms.js L737 单源已定义。
      fixedItems: M.fixedItems,
      paybackTitle: M.paybackTitle,
      paybackInvest: M.paybackInvest,
      paybackCash: M.paybackCash,
      paybackNull: M.paybackNull,
      paybackDisclaimer: M.paybackDisclaimer,
      paybackSeeM3: M.paybackSeeM3,
      months: M.months,
      yuanUnit: M.yuanUnit,
      initialInvestLabel: M.initialInvestLabel,
      initialInvestPh: M.initialInvestPh,
      paybackByInvest: M.paybackByInvest,
      // ── R234 · 主结论卡「这个铺子租金贵不贵」──
      // 🔴 三处登记的第二处（第一处 terms.js、第三处 index.wxml）：漏登记 ⇒ **渲染空白且零报错**。
      // ⚠️ 判定值不自造：全部读引擎 `indicators` 里 rent 那行的 level（good/ok/warn/bad/na）。
      verdictTitle: M.verdictTitle,
      verdictHealthTitle: M.verdictHealthTitle,
      verdictWorstLabel: M.verdictWorstLabel,
      verdictHealthStrip: M.verdictHealthStrip,
      calcBasisTitle: M.calcBasisTitle,
      calcBasisDays: M.calcBasisDays,
      calcBasisFormula: M.calcBasisFormula,
      m2Disclaimer: M.m2Disclaimer,
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
    cityIdx: 1, bizIdx: 4,          // 🔴 round278：默认「二三线 / 其他·通用餐饮」—— 与预设兜底「都不是（按通用经验估算）」显示对齐（round277 真机暴露的静默错配 B）
    // 各行（yuan / pct 保存**字符串**，与输入框语义一致；提交时才转分）
    buildRows: [
      // 🔴 R296：新增「转让费」（开店大头，按租期摊）—— 与证照/首批物料分开，摊销年限更准。
      mkRow('transfer', M.buildItems, M.buildItemNotes, { yuan: '', years: 3 }),
      mkRow('decor', M.buildItems, M.buildItemNotes, { yuan: '', years: 3 }),
      mkRow('equip', M.buildItems, M.buildItemNotes, { yuan: '', years: 5 }),
      mkRow('franchise', M.buildItems, M.buildItemNotes, { yuan: '', years: 3 }),
    ],
    // 🔴 R296 拍1：`fixedRows`（每月固定支出明细表）**整块删除** —— 固定成本改由结构化输入承载
    //   （房租 L1 / 人工总额·水电气·管理费 L2），小项挂各输入行 note。
    varRows: [mkRow('takeawayComm', M.varItems, M.varItemNotes, { pct: '' })],
    marginPct: 65,
    expectYuan: '',      // 预计月营业额（选填）—— 锚点：后端据此反算各项参考金额
    targetYuan: '',
    // 结果（全部来自后端）
    result: null,
    crowd: null,         // 🔴 round273：A 区派生指标（每天来多少人 / 一天翻几台）；算不出则为 null（不渲染）
    eff: null,           // 🔴 round276：A 区派生指标（坪效 / 人效）；没填实际营业额则为 null（不渲染）
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
    //    · 坪效   ⇒ 原计划"与 L3 已有的 pixelEffYuan 复用那一个" —— R234 实测已**推翻**：
    //      坪效同属「算出来的」专业指标，L3 那一份也一并移除（见 data 处 R234-实测修复注释）。
    //    ⚠️ 云端入参 `target_rent_rate` / `pixel_eff_fen` **保留**（契约 + 快照需要），只是换了取值来源。
    reverseResult: null,     // 反推结果（reverse 块）
    rentRatePct: '',         // R234：本次采用的房租行规（%，来自云端 BANDS，**只读回显**）
    // 🔴 P0#5（2026-10-11）：结果吸底条（纯展示层，不碰引擎）。
    //   ⚠️ R296 拍4：`showTurnHelp`（翻台「?」面板开关）已随反推翻台展示一并删除。
    stickKpi: false,         // 吸底条是否显示（出数后才显示）
    stickLbl: '',            // 吸底条左侧标签（保本营业额 / 房租最多能扛）
    stickVal: '',            // 吸底条核心数字
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
    // 🔴 R296 拍1：人工改**直接填总额**（不乘人数、不乘城市系数）；`laborUnitYuan` 降级为
    //   内部兜底值（选业态时由预设带出、无输入框）—— 用户没填总额时按「人数 × 该值」估。
    laborUnitYuan: '',       // 单人月人工单价（元）—— 内部兜底，无输入框
    laborTotalYuan: '',      // 🔴 拍1：人工每月总额（元）—— 用户直填，不乘人数
    // 🔴 R296 拍3：水/电/气三项实数（有店填；找店留空 ⇒ 引擎按「房租×占比」给参考值）。
    waterYuan: '',
    electricYuan: '',
    gasYuan: '',
    // 🔴 R296 拍2：管理费（选填）—— 普通单店通常没有，留空 = 不评（不虚高）。
    manageYuan: '',
    // 🔴 R294-C：手填标记位。marginPct 初值非空（65），不能靠「空串」判断用户是否改过 ⇒ 用显式标记。
    //   选预设时仅补 `fieldTouched.x` 为 false 的字段，用户手填过的一律保留。
    fieldTouched: { margin: false, labor: false, avg: false },
    // 🔴 R290：固定 30（李老师原话「每天都正常营业，推演也按每天营业推」）。
    //   ⚠️ 不是删字段——引擎 `open_days` 必填 1~31，留空会发 0 ⇒ fail-closed 报「填写错误」。
    openDaysNum: '30',       // 每月营业天数（常量，页面只读展示，不再让老板填）
    // 🔴 R237：输入口径由「座位数」改为「桌数」—— 李老师 2026-10-08 原话：
    //   「餐饮老板算账都是按桌数来算，比如店里有 20 张桌子，今天火锅卖了 30 桌」。
    //   引擎入参仍是 `seats`（座位数，云函数契约字段，**名字与形状一字不改**）⇒
    //   由 `seatsNow()` 做一次换算：座位数 = 桌数 × 单桌座位数 ⇒ **引擎零改动、锚点零漂**。
    tablesNum: '',           // 桌数（含散台；包间按「一张桌」计）
    seatsPerTableNum: '',    // 单桌座位数（业态默认、**用户可改**）—— 桌数↔座位数的唯一换算系数
    // 🔴 R234-实测修复：`pixelEffYuan`（坪效）/ `turnNum`（翻台率）**已从输入区移除**。
    //   依据李老师原话「这些本身是咱们计算出来的，不是让客户自己填出来的」。
    //   实测坐实的两个事实（见 review/evidence/r234_m2_v14/probe_engine.js）：
    //     · `turnNum` 全仓只有 data 声明 + onTurn handler，**引擎根本不收 turn 参数**
    //       ⇒ 用户填了会触发重算却对任何结果零影响 = 纯死输入（最糟的一类 UI）。
    //     · `pixelEffYuan` 唯一下游是 `area_cap_sqm`，而坪效不让问 ⇒ 该输出恒 null ⇒ 一并移除。
    //   ⚠️ `pixel_eff_fen` 仍是**云函数契约字段**（validate 允许 0）⇒ 保留传参、恒传 0，不删字段。
    feeOverrides: {},        // itemKey → pct 字符串（L3 费率覆盖）
    feeRows: [],             // 当前预设 revenue_rate 项 [{key,label,pct}]
    showL2: false,
    showL3: false,
    showAssumptions: false,
    // R234/J4：行内长提示折叠（与月录入页同一套 `hintFold` map 模式，默认全收起）。
    //   ⚠️ 与上面三个区段级折叠（showL2/showL3/showAssumptions，走 .fold-toggle）**语义不同**：
    //      那三个收的是**整块参数区**，本 map 收的是**一句说明文案**。两者并存、互不干扰。
    hintFold: {},
    payback: null,           // {invest, cash, investDefault, userInvest, userPaybackMonths}（M2v1.3 回本卡）
    initialInvestYuan: '',    // 🔴 round279e · A：初始总投入（非必填，纯前端派生回本月数，非引擎入参）
    presetAssumptions: [],   // 底部假设卡行 [{label,val,src}]
    bandsRaw: [],            // R234：云端 bands_preview **原样留存**（拿到 rent.hi 用，见 rentRateDefault）
    bandsRawKey: '',         // 上面这份数据对应哪一组「城市 × 业态」（= cityIdx + ':' + bizIdx）
    verdict: null,           // R234：主结论卡 {level, levelName, note, mine, band, rentPct}
    // 🔴 round279c · #10 敏感度（前端派生，引擎零改）：毛利率 ±5% 看保本额变化
    sens: { open: false, loading: false, disabled: false, rows: null },
    // 🔴 round279d · #12 多渠道毛利率（前端折算，引擎零改）：开关关=老版本 100% 一致（零漂移）
    channel: {
      on: false,                 // 「分渠道细化毛利率」开关，默认关
      paramsOpen: false,         // 默认参数（抽成/折扣）折叠，展开才显
      takeawayRatio: 0,          // 外卖营收占比（0-100 整数）
      groupRatio: 0,             // 团购营收占比（0-100 整数）
      platformRate: 20,          // 外卖平台抽成率%（示例值，待校准）
      packRate: 3,              // 外卖包装/配送成本率%（示例值，待校准）
      discountRate: 30,          // 团购折扣率%（示例值，待校准）
      groupPlatformRate: 5,      // 团购平台抽成率%（示例值，待校准）
      takeawayOverride: '',      // 手动覆盖外卖净毛利率%（选填）
      groupOverride: '',         // 手动覆盖团购净毛利率%（选填）
      dineinRatio: 100,          // 堂食占比 = 100 - 外卖 - 团购（自动）
      takeawayGm: null,          // 外卖毛利率（推导/覆盖）
      groupGm: null,             // 团购毛利率（推导/覆盖）
      blendedGm: null,           // 综合毛利率（加权）
      blendedDiff: 0,            // 综合比堂食低的百分点
      leverageX: null,           // 外卖/团购每+10% ⇒ 综合毛利降 X 点
      leverageY: null,           // ⇒ 保本需升 Y%
      over100: false,            // 外卖+团购 >100% 阻断
      pureTakeaway: false,       // 无堂食营收强提示
    },
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
        // #1 收口（round272b）：营业天数也要随草稿回来 —— 否则提示「已载入上次填的数」是**半份**
        //   （用户改过 26 天、退出重进后被静默丢回 30 天，且他看不出来）。
        openDaysNum: this.data.openDaysNum,
        build: this.data.buildRows.map((r) => ({ key: r.key, yuan: r.yuan, years: r.years })),
        // 🔴 R296 拍1：`fixed`（明细表）随明细表删除，不再存草稿（固定成本来自结构化字段）。
        varRows: this.data.varRows.map((r) => ({ key: r.key, pct: r.pct })),
        presetKey: this.data.presetKey,
      });
    } catch (e) { /* 写盘失败不影响测算：草稿只是锦上添花，不打扰用户 */ }
  },

  restoreDraft() {
    let d = null;
    try { d = wx.getStorageSync(DRAFT_KEY); } catch (e) { d = null; }
    if (!d || d.v !== 1) return false;
    const build = (d.build || []).map((x) => mkRow(x.key, M.buildItems, M.buildItemNotes, { yuan: x.yuan, years: x.years }));
    // 🔴 R296 拍1：旧草稿里的 `d.fixed`（明细表）**忽略**（该表已删）；固定成本走结构化字段。
    const varRows = (d.varRows || []).map((x) => mkRow(x.key, M.varItems, M.varItemNotes, { pct: x.pct }));
    const ci = d.cityIdx || 0;
    const bi = d.bizIdx || 0;
    this.setData({
      cityIdx: ci, cityName: M.cityTiers[ci].name,
      bizIdx: bi, bizName: M.bizTypes[bi].name,
      buildRows: build.length ? build : this.data.buildRows,
      varRows: varRows.length ? varRows : this.data.varRows,
      marginPct: typeof d.marginPct === 'number' ? d.marginPct : this.data.marginPct,
      expectYuan: d.expectYuan || '',
      targetYuan: d.targetYuan || '',
      openDaysNum: d.openDaysNum || '30',   // R290：旧草稿没有该字段时兜底 30，绝不回退空串（空串 ⇒ 发 0 ⇒ fail-closed）
      presetKey: d.presetKey || '',   // 🔴 round279e · D：回存业态预设（老用户打开时选择器与计算口径一致，不再"显示通用、实际按别业态算"）
      draftRestored: true,
    });
    this.syncPresetOptions();   // 🔴 D：用回存的 presetKey 重建预设选择器显示（presetName/presetPicked 与计算口径对齐）
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
  // 🔴 R296 拍1：`onFixedYuan` / `onAddFixed` / `onDelFixed` 三 handler **随明细表一并删除**
  //   （固定成本改由结构化输入承载：房租 L1 / 人工总额·水电气·管理费 L2）。
  //   留着孤立 handler 会让后来人误以为"UI 删了、逻辑还在"—— 必须连根拔（同 R234 坪效/翻台处理）。

  // ===== 毛利率滑杆 =====
  // bindchanging：拖动中只更新数字（不发请求）；bindchange：松手才重算 ⇒ 既是"实时"又不刷爆云函数
  // ⚠️ round111：这里原有一个 foodCostPct（100 − 毛利率）联动展示，已**删掉** ——
  //    对外不出现"食材成本率"（客户看不懂）。成本率只在云函数内部参与计算。
  onMarginChanging(e) {
    this.setData({ marginPct: Number(e.detail.value) });
  },
  onMarginChange(e) {
    this.setData({ marginPct: Number(e.detail.value), 'fieldTouched.margin': true });
    if (this.data.channel.on) this.recomputeChannel();
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
    // 🔴 R290 v5（李老师拍板）：找店 = 多维度推演 ⇒ **直接进场景矩阵页**，不在首页再填一遍。
    //   实证依据（勿凭转述改设计）：
    //   · 矩阵页 4 个维度档位 rent/labor/margin/target 已存在，且 buildClean 传 `fixedYuan:{rent}`
    //     **不传 mode** ⇒ 引擎 `validate.js:24` 默认 forward ⇒ **矩阵本来就出保本点**（不是只有房租上限）。
    //   · 首页 reverse 才走 reverse 引擎（只出 rent_cap_fen、无 break_even），那是另一条路。
    //   ⇒ 首页自此恒为「已有铺面」（forward）；找店的房租在矩阵页以「档位」形式填，仍遵循「房租是根本」。
    if (mode === 'reverse') {
      wx.navigateTo({ url: '/pages/sandbox/matrix?mode=reverse' });
      return;
    }
    this.setData({ mode });
    // 切 Tab 后吸底条标签/数字要跟着当前结果重算（结果可能仍有效，也可能已清空）
    this.refreshStick();
    // 切到反推 Tab 立即触发一次反推（复用防抖）
    this.scheduleCalc();
  },
  // 🔴 R296 拍4：`onToggleTurnHelp` 随反推翻台展示一并删除（引擎仍算 turn_rate，仅不再展示）。
  // 🔴 P0#5：吸底条点开 ⇒ 滚到结果区（原生页面滚动用 pageScrollTo + selector）
  onStickTap() { wx.pageScrollTo({ selector: '#m2result', duration: 300 }); },
  // 🔴 P0#5：根据当前 Tab + 结果，算出吸底条要显示的核心数（只在出数且非红警时显示）
  refreshStick() {
    const t = this.data.t || {};
    const cur = (t.cur) || '¥';
    let kpi = false, lbl = '', val = '';
    if (this.data.mode === 'reverse') {
      const r = this.data.reverseResult;
      if (r && !r.red_alert) { kpi = true; lbl = t.stickRevLbl || '房租最多能扛'; val = cur + (r.rent_cap != null ? r.rent_cap : ''); }
    } else {
      const r = this.data.result;
      if (r && !r.red_alert) { kpi = true; lbl = t.stickFwdLbl || '保本营业额'; val = cur + (r.break_even_monthly != null ? r.break_even_monthly : ''); }
    }
    this.setData({ stickKpi: kpi, stickLbl: lbl, stickVal: val });
  },
  // 🔴 R234：删掉 `onRevRentRate` / `onRevPixelEff` 两个 handler ——
  //    对应输入框已从 wxml 移除（R223 §3.2 明令「L1/L2 严禁以坪效/目标租金率作输入」）。
  //    留着孤立的 handler 会让后续维护误以为还有这条路。
  // 🔴 R237：`onSeats`（座位数）已改为「桌数」—— 用户填桌、系统换算座位（见 `seatsNow()`）。
  onTables(e) { this.setData({ tablesNum: e.detail.value }); this.scheduleCalc(); },
  onSeatsPerTable(e) { this.setData({ seatsPerTableNum: e.detail.value }); this.scheduleCalc(); },

  // ===== 🔴 round279c · #10 敏感度（前端派生，引擎零改）=====
  // 🔴 R296：入参统一走 `buildPresetParam`（单一装配器）—— 只覆盖毛利率，不新写计算逻辑、不碰引擎。
  buildForwardPayload(marginPct) {
    const p = this.buildPresetParam('forward');
    return {
      mode: 'forward',
      city_tier: p.city_tier, biz_type: p.biz_type,
      build_items: p.build_items, fixed_items: p.fixed_items, var_items: p.var_items,
      gross_margin_pct: Number(marginPct),
      target_profit_fen: p.target_profit_fen,
      expected_revenue_fen: p.expected_revenue_fen,
      rev_price_fen: p.rev_price_fen, seats: p.seats, open_days: p.open_days,
      target_rent_rate: p.target_rent_rate, pixel_eff_fen: p.pixel_eff_fen,
      valid_days: p.valid_days,
      client_request_id: 'sb_sens_' + Date.now() + '_' + Math.round(marginPct * 100),
    };
  },

  async buildSensitivity() {
    const base = this.effectiveMarginPct();
    const deltas = [-5, 0, 5];
    const hasFixed = this.buildForwardPayload(base).fixed_items.length > 0;
    if (!hasFixed) {
      this.setData({ 'sens.disabled': true, 'sens.loading': false, 'sens.rows': null });
      return;
    }
    this.setData({ 'sens.loading': true, 'sens.disabled': false });
    try {
      const calls = deltas.map((d) => {
        const m = Math.min(99, Math.max(1, base + d));
        return api.call('calcSandbox', this.buildForwardPayload(m)).then((res) => ({
          delta: d,
          margin: m,
          breakMonthly: res.break_even_monthly_fen != null ? api.fenToYuan(res.break_even_monthly_fen, 0) : null,
        }));
      });
      const res = await Promise.all(calls);
      const baseBreak = (res.find((r) => r.delta === 0) || {}).breakMonthly;
      const rows = res.map((r) => {
        const deltaPct = baseBreak > 0 && r.breakMonthly != null
          ? Math.round((r.breakMonthly - baseBreak) / baseBreak * 100) : 0;
        return {
          key: 'd' + r.delta,
          label: r.delta === 0 ? this.data.t.sensBase : (r.delta < 0 ? this.data.t.sensMarginDown : this.data.t.sensMarginUp),
          breakMonthly: r.breakMonthly,
          deltaPct,
          deltaText: r.delta === 0 ? this.data.t.sensBaseTag : ((deltaPct >= 0 ? '+' : '') + deltaPct + '%'),
        };
      });
      this.setData({ 'sens.rows': rows, 'sens.loading': false });
    } catch (e) {
      this.setData({ 'sens.loading': false });
      api.toastError(e);
    }
  },

  onToggleSens() {
    const open = !this.data.sens.open;
    // 每次展开都重算（输入可能已变，避免拿旧数）
    if (open) {
      this.setData({ 'sens.open': true, 'sens.rows': null, 'sens.loading': false, 'sens.disabled': false },
        () => this.buildSensitivity());
    } else {
      this.setData({ 'sens.open': false });
    }
  },

  // ===== #12 多渠道毛利率（前端折算，引擎零改）=====
  // 开关关：直接返回原 L2 毛利率（与老版本 100% 一致，零漂移）。
  effectiveMarginPct() {
    const c = this.data.channel;
    if (!c.on) return Number(this.data.marginPct) || 0;
    return (c.blendedGm != null) ? c.blendedGm : (Number(this.data.marginPct) || 0);
  },

  // 把渠道占比/参数折算成：堂食占比（自动）、外卖/团购毛利率（推导或覆盖）、综合毛利率、杠杆提示。
  recomputeChannel() {
    const c = this.data.channel;
    const gmD = Number(this.data.marginPct) || 0;          // 堂食毛利率 = 原 L2 字段
    const rt = Number(c.takeawayRatio) || 0;
    const rg = Number(c.groupRatio) || 0;
    const dinein = 100 - rt - rg;
    const over100 = (rt + rg) > 100;
    const pureTakeaway = (rt + rg) >= 100;
    let takeawayGm = (c.takeawayOverride !== '' && c.takeawayOverride != null)
      ? Number(c.takeawayOverride)
      : (gmD - Number(c.platformRate) - Number(c.packRate));
    let groupGm = (c.groupOverride !== '' && c.groupOverride != null)
      ? Number(c.groupOverride)
      : (100 - (100 - gmD) / (100 - Number(c.discountRate)) * 100 - Number(c.groupPlatformRate));
    let blended = null, blendedDiff = 0, leverageX = null, leverageY = null;
    if (!over100 && dinein >= 0) {
      blended = (dinein * gmD + rt * takeawayGm + rg * groupGm) / 100;
      blendedDiff = Math.round((gmD - blended) * 100) / 100;
      const mix = rt + rg;
      if (mix > 0) {
        const mixGm = (rt * takeawayGm + rg * groupGm) / mix;   // 混合渠道加权毛利率
        leverageX = Number(((gmD - mixGm) / 10).toFixed(1));    // 混合占比每 +10% ⇒ 综合毛利降 X 点
        if ((blended - leverageX) > 0) {
          leverageY = Number(((blended / (blended - leverageX) - 1) * 100).toFixed(1));
        }
      }
    }
    this.setData({
      'channel.dineinRatio': dinein,
      'channel.takeawayGm': takeawayGm,
      'channel.groupGm': groupGm,
      'channel.blendedGm': blended,
      'channel.blendedDiff': blendedDiff,
      'channel.leverageX': leverageX,
      'channel.leverageY': leverageY,
      'channel.over100': over100,
      'channel.pureTakeaway': pureTakeaway,
    });
  },

  onToggleChannel() {
    const on = !this.data.channel.on;
    this.setData({ 'channel.on': on }, () => {
      if (on) this.recomputeChannel();
      this.scheduleCalc();
    });
  },

  onToggleChannelParams() {
    this.setData({ 'channel.paramsOpen': !this.data.channel.paramsOpen });
  },

  onChannelInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['channel.' + field]: e.detail.value }, () => {
      this.recomputeChannel();
      this.scheduleCalc();
    });
  },

  // ===== 自动重算（防抖；AD-6/AD-7 折中）=====
  scheduleCalc() {    this.setData({ dirty: true });
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
    // 🔴 R296：**统一走 `buildPresetParam` 装配器**（预设态与"未选预设"共用同一套 L1/L2/L3 输入）。
    //   为什么删掉原「未选预设」的 legacy 分支（它直接读被删的 `fixedRows`）：两条路装配口径不一；
    //   `buildPresetParam` 对空 presetKey 内部回落 'other' 通用预设 ⇒ 两条路合一，
    //   保存 / 重算 / 敏感度全部同源，杜绝"同一方案两处对不上"。
    if (isFirst) this.setData({ loading: true, calcError: '' });
    return this.onCalcPresetFwd();
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
  // 🔴 R296 拍1：`applyRefAmount`（给明细表各输入行填参考金额灰字）**随明细表一并删除** ——
  //   它唯一消费者是 fixedRows 渲染；明细表删后本方法无调用方。
  //   ⚠️ 保留 `amountMaps`（仍给结果区「参考 ¥X」用）。

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
    // 🔴 R296：**统一走 `buildPresetParam`**（预设态与"未选预设"共用同一装配器；未选 ⇒ 回落 'other'）。
    //   此前是双路（预设走装配、未选走手写 fixedRows）⇒ 同一方案"页面显示"与"保存重算"对不上。
    return this.buildPresetParam(this.data.mode);
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

  // ===== M2 G1/G2（2026-10-11 改造）：跳转场景矩阵 / 多方案对比 =====
  // 🔴 round273：矩阵页按**当前场景**进（A 已有铺面 ⇒ 扫毛利率；B 寻找铺面 ⇒ 扫租金档位）。
  //   同一个矩阵页在不同处境下要答的不是同一个问题，故把 `mode` 带过去（不带 ⇒ 页内默认 reverse）。
  goMatrix() { wx.navigateTo({ url: '/pages/sandbox/matrix?mode=' + this.data.mode }); },
  goCompare() { wx.navigateTo({ url: '/pages/sandbox/compare' }); },

  // ===== M2v1.3（业态参数包 + 回本卡 · 第三期）=====
  // 🔴 R234：业态预设**平铺**（背景见 terms.js 的 R234 段与本文件顶部注释）。
  //   旧的 `filter(p => p.bizKey === bizKey)` 按上一级「经营类型」过滤，而 6 个预设分布是
  //   快餐 2 / 火锅 2 / **正餐 1 / 茶饮 1** ⇒ 选「中式正餐」后下拉**只剩 1 项**。
  //   ⇒ 治法：用户只需回答「我开什么店」；`bizKey`（4 大类）由**系统**反查（`bizKeyOfPreset`），
  //     它只是去云端取 `BANDS` 的钥匙，**不是一道要用户先答的题**。
  syncPresetOptions() {
    // 🔴 行业标准选项按「美团大类」分组呈现：每个选项名前缀业态大类（快餐小吃 / 火锅烧烤 / 中式正餐 / 茶饮咖啡），
    //   末尾「通用餐饮」兜底（key='other'）。用户一眼能按品类定位自己的店。
    const catName = (bk) => {
      const bt = this.data.t.bizTypes.find((x) => x.key === bk);
      return bt ? bt.name : '';
    };
    const opts = BIZ_PRESETS.map((p) => {
      const c = catName(bizKeyOfPreset(p.presetKey));
      const base = this.data.t.bizPresets[p.presetKey] || p.presetKey;
      return { key: p.presetKey, name: (c ? c + ' · ' : '') + base };
    });
    // 🔴 round276：兜底选项**真实 key='other'**（不再是空串）。旧实现 key='' ⇒
    //   `findPreset('')` 静默回退到 `BIZ_PRESETS[0]`（快餐小面）⇒ 选"都不是"实则按错业态出指标，用户无感。
    //   现在选它走真正的通用兜底业态（BANDS.other），指标按"通用经验区间"出，且下方提示"未细分行业"。
    const full = [{ key: 'other', name: this.data.t.presetNone }].concat(opts);
    const idx = full.findIndex((o) => o.key === this.data.presetKey);
    const still = idx >= 0;
    this.setData({
      presetOptions: full,
      presetIdx: still ? idx : 0,
      presetName: still ? full[idx].name : this.data.t.presetNone,
      presetPicked: still,
    });
  },

  // ===== R237 · 桌数 ⇄ 座位数 换算（全页**唯一**换算点）=====
  //
  // 🔴 为什么要有这一层：引擎入参是 `seats`（座位数，**云函数契约字段，名字与形状一字不改**），
  //   而李老师定的是「用户填桌数」（餐饮老板都按桌算账：20 张桌子、今天卖了 30 桌 ⇒ 翻台 1.5）。
  //   ⇒ 换算放在这一层，引擎一行不改、锁定锚点（座位 20 ⇒ 翻台 3.70）一字不漂。
  //
  // ⚠️ 豆包第 5 轮点名的「最高危静默错」：小数 / 0 / 负数若不拦，会算出"半张桌子"这种
  //   数学成立、业务无效的数，**而且引擎不会报错**。⇒ 这里一律取整 + 下限 1，无效即 0。
  bizKeyNow() {
    const bt = this.data.t.bizTypes[this.data.bizIdx];
    return (bt && bt.key) || 'fastfood';
  },
  /** 单桌座位数：用户填的优先；空着 ⇒ 取业态默认（火锅/正餐 4、快餐/茶饮 2）。 */
  seatsPerTableNow() {
    const n = Math.floor(Number(this.data.seatsPerTableNum));
    if (isFinite(n) && n >= 1) return n;
    return seatsPerTableOf(this.bizKeyNow());
  },
  /** 送引擎的座位数 = 桌数 × 单桌座位数（都取正整数；任一无效 ⇒ 0 ⇒ 反推模式被引擎 fail-closed 拒）。 */
  seatsNow() {
    const t = Math.floor(Number(this.data.tablesNum));
    if (!isFinite(t) || t < 1) return 0;
    return t * this.seatsPerTableNow();
  },
  /** 翻台口径：'table'（桌周转，可说「翻台」）/ 'seat'（座位周转，**禁用「翻台」二字**）。 */
  turnModeNow() { return turnModeOf(this.bizKeyNow()); },
  /**
   * 🔴 #1 收口（round272b）：每月营业天数 —— **正向 / 反向共用同一份用户输入**（L3「一个月打算开门几天」）。
   *   返回 1~31 的整数；未填 / 非法（0 / 非整数 / 越界）⇒ 返回 0，交由后端按「缺省回退 30」处理。
   *   为什么必须在页面侧夹一次：正向入参 `valid_days` 走**严格校验**（非 1~31 的整数直接拒），
   *   用户可能填 28.5 ⇒ 不夹就会把一个"本来能算"的表单变成一条契约名报错。
   *   ⚠️ 反推的 `open_days` 保持原样（其 fail-closed 语义由 validate 层守着，不在此处改）。
   *   🔴 R290：该项已改为**常量 30**（老板不再填）⇒ 正常路径恒返回 30；
   *      「未填返回 0」这一哨兵分支仍需保留——防止历史草稿里存了空串/非法值时把整表变成「填写错误」。
   */
  validDaysNow() {
    const n = Number(this.data.openDaysNum);
    // 🔴 round273：返回的 0 是**哨兵**（= 没填 / 填了非法值），**不是**「每月营业 0 天」。
    //   云端 validate 对 0 按「未填」处理（不进 1~31 校验），service 再回退 30 ⇒ 与「选填」口径一致。
    //   曾在这里返回 0 却被云端当成越界值 ⇒ 用户没动过这项、一点「已有铺面」就整表报「填写错误」。
    if (!Number.isInteger(n) || n < 1 || n > 31) return 0;
    return n;
  },

  /**
   * 🔴 round273 · A 区（已有铺面）补齐 round223 §3.1 定案的两项指标：**每天来多少人 / 一天翻几台**。
   *
   * ⚠️ 为什么是**前端派生**而不是引擎出参：正向引擎出参**根本不含**客流与翻台（只有反推有
   *   `traffic` / `turn_rate`），而引擎红线＝**禁改源码** ⇒ 走既定扩展法「入参变换 + 前端派生」，
   *   引擎零改动（service.js / validate.js 本次都没碰）。
   *
   * 口径（与反推**完全同源**，保证两个 Tab 里同一个铺子的数字可比）：
   *   每天来客 = 日均营业额 ÷ 人均消费（向上取整，人不能是 0.7 个）
   *   一天翻台 = 每天来客 ÷ 座位数（反推是 `月客流 ÷(座位×天数)` ≡ `日均客流 ÷ 座位`，同一个数）
   *
   * fail-closed：人均消费 ≤0 或座位数 ≤0 ⇒ 返回 null（卡片整块不渲染，**不给假数**）。
   */
  crowdOf(result) {
    if (!result || result.red_alert) return null;
    const price = Number(this.data.avgPriceYuan);
    const seats = this.seatsNow();
    if (!(price > 0) || !(seats > 0)) return null;
    const bd = Number(result.break_even_daily);
    const td = Number(result.target_daily);
    if (!isFinite(bd) || !isFinite(td) || bd <= 0 || td <= 0) return null;
    const breakPeople = Math.ceil(bd / price);
    const targetPeople = Math.ceil(td / price);
    return {
      breakPeople,
      targetPeople,
      turn: Math.round((targetPeople / seats) * 100) / 100,
      price: String(price),
      // ⚠️ 键名必须是 `seatCount` 而不是 `seats`：`check_m2_biz_inputs` 的 A-⑧ 会扫所有
      //    `seats:` 右值，只放行 `this.seatsNow()` / 透传 —— 这里存的是**已换算好的展示值**，
      //    写成 `seats:` 会被判成「漏乘单桌座位数」而误伤（守卫守的是口径，不是命名喜好）。
      seatCount: String(seats),
    };
  },

  /**
   * 🔴 round276 · A 区（已有铺面）补齐 round223 §3.1 定案**遗漏**的「坪效 / 人效」
   *   （翻台已 round273 补；这两项 grep 全仓零命中 ⇒ 从来没建过）。
   *
   * 为什么同样是**前端派生**：正向引擎出参里根本没有这两项（正向只回答"每月/每天卖多少够本"），
   *   引擎红线＝**禁改源码** ⇒ 走既定扩展法（入参变换 + 前端派生），引擎零改动。
   *
   * 口径（餐饮通行定义，不是我造的）：
   *   坪效 = 月营业额 ÷ 营业面积（元/㎡·月）—— 答"这面积用得值不值"
   *   人效 = 月营业额 ÷ 员工人数（元/人·月）—— 答"这些人产出够不够"
   *
   * ⚠️ 分子必须是**用户填的实际月营业额**（A 区语义＝已发生的真实流水）：
   *   拿"保本营业额"当分子算出来的是**保本坪效**，不是老板要的"我这店实际坪效"。
   *
   * 🔴 两项**都不挂行业区间**：R223 §3.2 红线＝不得编造分位数，而仓内 BANDS（`indicatorRef.js`）
   *   只有毛利率/房租占比/人工占比/能耗/管理/推广六项 —— **没有坪效、也没有人效**。
   *   ⇒ 只出数值、不做评级、不给区间，留给老板自家横比（换面积/换人数自己看变化）。
   *
   * fail-closed：没填实际营业额 ⇒ 整块不渲染（**不给假数**）；
   *   面积或人数没填 ⇒ 只出填了的那一（几）项，缺的那项不出现。
   */
  effOf() {
    const rev = Number(this.data.expectYuan);
    if (!(rev > 0)) return null;
    const area = Number(this.data.areaNum);
    const head = Number(this.data.headcountNum);
    const pixel = area > 0 ? Math.round(rev / area) : null;
    const perHead = head > 0 ? Math.round(rev / head) : null;
    if (pixel == null && perHead == null) return null;
    return {
      rev: String(Math.round(rev)),
      pixel: pixel == null ? null : String(pixel),
      perHead: perHead == null ? null : String(perHead),
    };
  },

  onPreset(e) {
    const i = Number(e.detail.value);
    const opt = this.data.presetOptions[i];
    // 🔴 round276：兜底选项 key='other'；此处保留空值兜底，统一按通用业态处理（不静默回落 fastfood）。
    if (!opt || !opt.key) {
      this.setData({ presetKey: 'other', presetName: this.data.t.presetNone, presetPicked: false,
        feeRows: [], feeOverrides: {}, bizIsOther: true });
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
    // 🔴 round276：通用兜底业态标记（选「其他/通用餐饮」时为真）
    patch.bizIsOther = (bk === 'other');
    // 🔴 R294-C（真机走查登记 · 本次修复）：选预设只补「用户没手动改过」的字段，绝不覆盖已手填值。
    //   手填判定用 fieldTouched 标记（marginPct 初值非空的 65，不能靠空串判断 ⇒ 必须用标记位）；
    //   laborUnitYuan/avgPriceYuan 初值为空串、fieldTouched 同样适用，逻辑统一。
    //   openDays 为常量 30（R290 已删手填入口），空值守卫即可，预设不会冲它。
    if (preset.params && preset.params.grossMarginPct && !this.data.fieldTouched.margin) patch.marginPct = preset.params.grossMarginPct.v;
    if (preset.params && preset.params.openDays && !this.data.openDaysNum) patch.openDaysNum = String(preset.params.openDays.v);
    if (preset.params && preset.params.laborUnitYuan && !this.data.fieldTouched.labor) patch.laborUnitYuan = String(preset.params.laborUnitYuan.v);
    if (preset.params && preset.params.avgPriceYuan && !this.data.fieldTouched.avg) patch.avgPriceYuan = String(preset.params.avgPriceYuan.v);
    // 🔴 R237：**砍掉「面积 → 座位数」自动估算**（李老师 2026-10-08：「桌数和面积没有强关联，
    //   因为有的店要设包间，同样 100 平方米，包间多的店和全散台的店桌数差很远」）。
    //   ⚠️ 同时**不再预填桌数** —— 桌数由用户现场数（豆包：「小白站铺子门口，数桌子远比数椅子简单」）。
    //   这里只做一件事：按业态把「单桌座位数」的默认值刷新（用户改过就以用户的为准）。
    patch.seatsPerTableNum = String(seatsPerTableOf(bk || this.bizKeyNow()));
    this.setData(patch);
    this.scheduleCalc();
  },
  onArea(e) {
    this.setData({ areaNum: e.detail.value });
    this.scheduleCalc();
  },
  onRent(e) { this.setData({ rentYuan: e.detail.value }); this.scheduleCalc(); },
  onHeadcount(e) { this.setData({ headcountNum: e.detail.value }); this.scheduleCalc(); },
  // 🔴 round279e · A：初始总投入（非必填）。不进引擎，只在前端派生回本月数（见 onCalcPresetFwd）。
  onInitialInvest(e) { this.setData({ initialInvestYuan: e.detail.value }); this.scheduleCalc(); },
  onAvgPrice(e) { this.setData({ avgPriceYuan: e.detail.value, 'fieldTouched.avg': true }); this.scheduleCalc(); },
  // 🔴 R296 拍1/拍2/拍3：结构化固定成本输入（人工总额 / 水电气三项 / 管理费）。
  onLaborTotal(e) { this.setData({ laborTotalYuan: e.detail.value }); this.scheduleCalc(); },
  onWater(e) { this.setData({ waterYuan: e.detail.value }); this.scheduleCalc(); },
  onElectric(e) { this.setData({ electricYuan: e.detail.value }); this.scheduleCalc(); },
  onGas(e) { this.setData({ gasYuan: e.detail.value }); this.scheduleCalc(); },
  onManage(e) { this.setData({ manageYuan: e.detail.value }); this.scheduleCalc(); },
  // ⚠️ 原 `onLaborUnit`（员工月均工资输入）已随输入框删除 —— 人工改「直接填总额」，
  //    `laborUnitYuan` 降级为内部兜底（由预设带出），无 UI、无 handler。
  // 🔴 R290：营业天数改为常量 30 ⇒ 原 `onOpenDays2` 输入 handler 随 UI 一并删除（不留孤立 handler）。
  // 🔴 R234-实测修复：`onPixelEff` / `onTurn` 已随输入区一并删除（坪效/翻台率是算出来的，不是填的）。
  //    留着 handler 会让人以为"UI 删了、逻辑还在"，下次加回输入框只要一行 —— 必须连根拔。
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
    // 🔴 round276：兜底预设优先按 'other' 解析（通用业态），**绝不**静默回落 BIZ_PRESETS[0]（快餐小面）。
    const preset = findPreset(this.data.presetKey) || findPreset('other') || BIZ_PRESETS[0];
    const cityKey = this.data.t.cityTiers[this.data.cityIdx].key;
    const coef = Object.assign({ rent: 1, labor: 1 }, CITY_COEF[cityKey] || {});
    const isReverse = mode === 'reverse';
    const userBuild = this.data.buildRows
      .filter((r) => api.yuanToFen(r.yuan) > 0)
      .map((r) => ({ key: r.key, fen: api.yuanToFen(r.yuan), years: Number(r.years) || 1 }));
    const input = {
      area: Number(this.data.areaNum) || 0,
      headcount: Number(this.data.headcountNum) || 0,
      // 🔴 R296 拍1：人工**直接填总额**（laborTotalYuan）；`laborUnitYuan` 降级为兜底
      //   （用户没填总额时按「人数 × 该值 × 城市系数」估，避免人工=0 乐观化保本点）。
      laborTotalYuan: Number(this.data.laborTotalYuan) || 0,
      laborUnitYuan: Number(this.data.laborUnitYuan) || 0,
      rentYuan: Number(this.data.rentYuan) || 0,
      // 🔴 R296 拍3：水/电/气三项实数（有店填；找店留空 ⇒ assembleItems 走「房租×占比」参考值）。
      waterYuan: Number(this.data.waterYuan) || 0,
      electricYuan: Number(this.data.electricYuan) || 0,
      gasYuan: Number(this.data.gasYuan) || 0,
      // 🔴 R219 口径（两道防线之一·装配层）：反推模式下 `fixed_items` **不得含 rent**。
      //    房租在此处是**求解目标**，把它当已知固定成本喂进去会**重复计租**。
      // 🔴 R296 拍2：**正向**的 `fixedYuan` **必须带 `manage` 键**（值可为空/0）——
      //    `fixed_opt` 以「键是否存在」判"用户是否作答"：键在（含 ''/0）⇒ 不评；键缺（找店/矩阵不传）⇒ 走兜底。
      //    反推模式给 `{}`（键缺）⇒ 管理费走「房租×占比」参考值（找店小白友好）。
      fixedYuan: isReverse ? {} : { rent: this.data.rentYuan, manage: this.data.manageYuan },
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
    // 🔴 R237：座位数 = **桌数 × 单桌座位数**（用户填桌，系统换算）—— 换算只发生在 `seatsNow()`，
    //   引擎入参 `seats` 与锁定锚点（座位 20 ⇒ 翻台 3.70）一字不动。
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
      // 🔴 #1 收口（round272b）：预设分支（正/反共用本装配器）同样喂 valid_days；
      //   反推模式下 validate 只读 open_days、忽略本字段 ⇒ 对反推零影响。
      valid_days: this.validDaysNow(),
      rev_price_fen: api.yuanToFen(this.data.avgPriceYuan),
      // 🔴 R237：座位数 = 桌数 × 单桌座位数（唯一换算点 `seatsNow()`）—— 引擎入参/锚点一字不动。
      seats: this.seatsNow(),
      open_days: openDays,
      // R234：不再来自用户输入，改由 `rentRateDefault()` 自动取本业态×本城市的健康上限。
      //   ⚠️ 字段名与形状**完全没变**（`target_rent_rate` 仍是云函数契约字段），变的只是取值来源。
      target_rent_rate: this.rentRateDefault(),
      pixel_eff_fen: 0,   // R234-实测：同上（契约字段保留，取值恒 0）
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
      // 🔴 round279e · A：初始总投入回本（纯前端派生，复用 paybackCash 唯一合法除法，引擎零改）。
      //   覆盖「转让费/加盟费等建店投入之外的真实总投入」——引擎 payback_months 只算 buildItems。
      const investFen = api.yuanToFen(this.data.initialInvestYuan);
      const userPayback = investFen > 0 ? paybackCash(investFen, p._targetFen, d.build_amort_monthly_fen) : null;
      const payback = {
        invest: invest != null ? api.fenToYuan(api.yuanToFen(invest), 0) : null,
        cash: cash != null ? String(cash) : null,
        investDefault: p._preset.paybackView === 'invest',
        hasData: invest != null || cash != null,
        userInvest: investFen > 0 ? api.fenToYuan(investFen, 0) : null,
        userPaybackMonths: userPayback != null ? String(userPayback) : null,
      };
      const amt = this.amountMaps(d.amount_preview || []);
      const indTarget = d.indicators_at_target || [];
      // 🔴 round273：同主链路 —— result 先落局部变量，A 区客流/翻台在**新结果**上派生。
      const presetResultObj = !hasFixed ? null : {
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
        valid_days: d.valid_days,
        _ind: { break: d.indicators_at_breakeven || [], target: d.indicators_at_target || [] },
      };
      this.setData({
        // R234：`bands_preview` **原样留存** —— `rentRateDefault()` 要从这里取 rent.hi，
        //      若只留 decorate 后的 `bands`（只剩拼好的字串），就再也拿不到原始数值了。
        bandsRaw: d.bands_preview || [],
        bandsRawKey: this.bandsKeyNow(),
        bands: this.decorateBands(d.bands_preview || [], amt),
        marginBand: this.pickBand(d.bands_preview, 'grossMargin'),
        verdict: !hasFixed ? null : this.verdictOf(indTarget),
        result: presetResultObj,
        // 🔴 round273：A 区（已有铺面）补齐定案指标（每天来多少人 / 一天翻几台）—— 在新结果上派生
        crowd: presetResultObj ? this.crowdOf(presetResultObj) : null,
        // 🔴 round276：同主链路，A 区坪效 / 人效（派生自用户填的实际营业额 + 面积 + 人数）
        eff: this.effOf(),
        indicators: hasFixed ? this.decorate(d.indicators_at_breakeven || []) : [],
        indTab: 'break',
        payback,
        presetAssumptions: this.buildAssumptions(p._preset, d),
        calcError: hasFixed ? '' : M.needFixed,
        // 🔴 R296：通用兜底业态标记 + 吸底条刷新 —— 原「未选预设」legacy 分支有、本分支曾漏；
        //   统一走 buildPresetParam 后在此补齐（否则选「其他/通用餐饮」不显示"未细分"提示、吸底条不更新）。
        bizIsOther: this.bizKeyNow() === 'other',
        loading: false,
        dirty: false,
      });
      this.refreshStick();
    } catch (e) {
      if (seq !== this._seq) return;
      this.setData({ loading: false });
      if (e.code === 'M2_RED_ALERT') { this.setData({ result: { red_alert: true }, calcError: '' }); }
      else { this.setData({ calcError: e.msg || '' }); api.toastError(e); }
    }
  },

  // 🔴 R296-E（P2 死代码清理）：`onCalcPresetRev` 整方法已删 —— 首页 mode 恒为 forward
  //   （onMode('reverse') 直接跳矩阵页），且 onCalc 内的 reverse 分派已改为恒走 forward，
  //   故本方法自 R290 起不可达。反推计算现完全由 matrix 页承载（buildClean → assembleItems
  //   → 云函数批量算），与首页无耦合；`seatsNow`/`validDaysNow` 仍被上方 forward 分支共用，保留。



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
    // 🔴 R296-E（P0-①）：逐指标文案单源（键 = indNames 的 6 项）。按「最差项 key × level」精准取，
    //   消灭「人工/能耗最差却显示房租台词」的串台。找不到再回退通用 level 文案。
    const NOTE_BY_ITEM = M.verdictNoteByItem || {};
    // 为 0 通常是「没填实际支出」而非真 0 的项（mkt 例外：0 推广费合法），不判优秀。
    const ZERO_NAIVE = { rent: 1, labor: 1, energy: 1, manage: 1, grossMargin: 1 };
    const rows = indTarget || [];
    if (!rows.length) {
      return { level: 'na', levelName: NAME.na, note: NOTE.na, mine: '', band: '', summary: [] };
    }
    // 🔴 #7（P0-2，round272）：主结论改「综合健康度」—— 取 6 项指标里最差的 level（bad>warn>ok>good），
    //    不再只判房租，消除「人工/毛利率爆了但结论还绿」的信任坑。判定仍读引擎 level，不自造。
    const rank = { na: 0, good: 1, ok: 2, warn: 3, bad: 4 };
    // 🔴 R296-C（真机走查发现）：指标名 / 评级**必须走中文单源**（`M.indNames` / `M.indLevels*`）。
    //   此前直接透传后端英文 key（grossMargin / rent / labor …）与英文 level（ok / good），
    //   中文界面读成英文 —— 与本次诉求「带出各指标是否正常的中文解读（如房租占比高还是低）」不符。
    //   ⚠️ `level`（英文）**保留**：wxml 用它作 CSS 类名 `lv-{{item.level}}`（`.lv-ok` / `.lv-bad` …）；
    //      中文另存 `levelName`（成本项「偏高/过高」、毛利率走反向表「偏低/过低」）。
    const names = M.indNames || {};
    const summary = rows.map((x) => ({
      key: x.key,
      name: names[x.key] || x.name || x.key,
      levelName: ((x.key === M.indGainKey ? M.indLevelsGain : M.indLevels) || {})[x.level] || '',
      pct: x.pct, level: x.level || 'na',
      lo: x.lo, hi: x.hi,
    }));
    let worst = 'good';
    summary.forEach((s) => { if (rank[s.level] > rank[worst]) worst = s.level; });
    // 最该盯的一项 = 最差 level 里的第一项（替代原「只显示房租」），用于 mine/band 展示
    const worstRow = summary.filter((s) => s.level === worst)[0] || summary[0];
    // 🔴 R296-E（P0-①）：精准文案 —— 按「最差项 key × level」取；fallback 通用 level 文案。
    const itemNote = (NOTE_BY_ITEM[worstRow.key] && NOTE_BY_ITEM[worstRow.key][worst]) || NOTE[worst] || '';
    // 🔴 R296-E（P0-①）：0 值数据缺失保护 —— 成本类/毛利率为 0 多属「没填」，不判优秀，降级 na 并提示。
    const isZeroNaive = worstRow.pct === 0 && !!ZERO_NAIVE[worstRow.key];
    return {
      level: isZeroNaive ? 'na' : worst,
      levelName: isZeroNaive ? (NAME.na || '') : (NAME[worst] || ''),
      itemName: worstRow.name || '',
      note: isZeroNaive ? (M.verdictNoteZero || NOTE.na) : itemNote,
      mine: worstRow.pct == null ? '' : String(worstRow.pct) + '%',
      band: worstRow.lo == null ? '' : worstRow.lo + '~' + worstRow.hi + '%',
      summary,
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
