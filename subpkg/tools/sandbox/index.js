// subpkg/tools/sandbox/index.js —— M2 经营盈亏沙盘（v2 · 2026-09-23 李老师拍板改造；R519 定名）
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
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
// R411：金额展示单源（万/元口径与小数位只在这里定，页面不许再各写一份）
const MoneyFmt = require('../../../utils/moneyFmt.js');
const ss = require('../../../utils/shopSwitcher.js');   // R443：草稿必须按店隔离
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
// 🔴 R395：分享卡片标题装配（纯函数单源）—— 见 `utils/shareCard.js` 头注
const shareCard = require('../../../utils/shareCard.js');
// R412（队列 #24）：渠道占比规则单源 —— 「外卖 + 团购 ≤ 100%」的判定必须可被机器验，
//   写成纯函数（utils/channelRule.js）后守卫能喂真数字判行为，而不是 grep 字面量。
const ChannelRule = require('../../../utils/channelRule.js');
// 🔴 R546：费率参考值单源。placeholder / ※ / 加权计算全读它 —— 术语里不写数字，防止两份真相源。
const CHANNEL_REF = ChannelRule.CHANNEL_REF;
// 术语模板 {a}/{b} → 数字（页面 JS 不写中文，数字也不写进术语，两边都不越界）
const phTpl = (tpl, a, b) => String(tpl || '').split('{a}').join(a).split('{b}').join(b);
// R414（队列 #25）：金额输入可读性判定（纯函数）—— yuanToFen 对非法输入 fail-soft 返回 0，
//   0 是合法金额 ⇒ 云端拒不了 ⇒ 必须在这一层**暴露**给老板看（不改数、不静默清洗）。
const AmountInput = require('../../../utils/amountInput.js');
// M2v1.3：业态参数包（纯数据 + 唯一装配入口 + 回本派生，仓根 utils/）
// R234：新增 `bizKeyOfPreset`（预设 → 4 大类，供"平铺业态"后自动定参考带）。
// 🔴 R526：`seatsPerTableOf` / `turnModeOf` / `turnLevelOf` / `turnLevelOfBiz` 的导入**已删除** ——
//   桌数/座位数输入在 R525~R526 全部下线（翻台率本页不讨论），这些函数在本页已无使用方；
//   它们本身仍在 `utils/bizPreset.js`（矩阵/其他页与 `check_biz_preset` 仍依赖），只是本页不再引用
//   —— 留着未使用的导入会让下一个人以为"翻台这套还在跑"。
const { BIZ_PRESETS, CITY_COEF, assembleItems, resolveBuild, paybackCash, findPreset,
  bizKeyOfPreset,
  // R297：年限不再各写各的（初始行 / 新增行 / 提交 / 回存草稿 四处同走这一份）
  BUILD_DEFAULT_YEARS, buildYearsOf, cashBreakeven } = require('../../../utils/bizPreset.js');

// 🔴 R330：做活动会怎样（纯假设推演，不依赖账本/成本卡）
const Promo = require('../../../utils/promoImpact.js');

const M = TERMS.m2;
// 促销选项的真实值（与 terms 的 promoDiscountOpts / promoWeightOpts 一一对应）
const BUILD_ALL = Object.keys(M.buildItems);
// 🔴 R296 拍1：`FIXED_ALL` 随「每月固定支出」明细表删除（原仅 `onAddFixed` 使用）。
// 🔴 R296b：`VAR_ALL` 随 ④「挂钩费用」明细卡删除（原仅 `onAddVar` 使用）。
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
      cityLabel: M.cityLabel,
      cityTiers: M.cityTiers,
      bizTypes: M.bizTypes,
      secBuild: M.secBuild,
      secFixed: M.secFixed,
      secMargin: M.secMargin,
      // 🔴 R522：输入区六段重排新增的三个卡标题（漏映射 ⇒ t.xxx=undefined ⇒ 卡标题整行空白）
      secStore: M.secStore,
      secDeduct: M.secDeduct,
      secGoal: M.secGoal,
      presetDisplay: M.presetDisplay,
      bandPreviewLabel: M.bandPreviewLabel,
      otherBandLabel: M.otherBandLabel,
      secResult: M.secResult,
      secIndicators: M.secIndicators,
      bizIsOther: false,   // 🔴 round276：通用兜底业态标记（选「其他/通用餐饮」时为真）
      buildPh: M.buildPh,
      yearsSuffix: M.yearsSuffix,
      buildTotal: M.buildTotal,
      amortMonthly: M.amortMonthly,
      // 🔴 D5：输入区（不含摊销）/ 结果区（含摊销）两个标签拆开
      fixedTotalNoAmort: M.fixedTotalNoAmort,
      fixedTotalWithAmort: M.fixedTotalWithAmort,
      // 🔴 D8：派生项标注（结果区列明哪些固定成本是行业估算、从哪来）
      derivedNotePrefix: M.derivedNotePrefix,
      derivedNoteSuffix: M.derivedNoteSuffix,
      marginName: M.marginName,
      marginSub: M.marginSub,
      profitLadderTitle: M.profitLadderTitle,
      profitLadderSub: M.profitLadderSub,
      profitColRev: M.profitColRev,
      profitColResult: M.profitColResult,
      profitAtBreak: M.profitAtBreak,
      profitLoss: M.profitLoss,
      profitGain: M.profitGain,
      profitWan: M.profitWan,
      profitYuan: M.profitYuan,
      promoTitle: M.promoTitle,
      promoSub: M.promoSub,
      promoRealLabel: M.promoRealLabel,
      promoCostLabel: M.promoCostLabel,
      promoCostPh: M.promoCostPh,
      promoCostNote: M.promoCostNote,
      promoGoalText: M.promoGoalText,
      promoRealPh: M.promoRealPh,
      promoRealNote: M.promoRealNote,
      promoGaLabel: M.promoGaLabel,
      promoBeLabel: M.promoBeLabel,
      promoTrafficLabel: M.promoTrafficLabel,
      promoSameRevWin: M.promoSameRevWin,
      promoSameRevLoss: M.promoSameRevLoss,
      promoSameRevNote: M.promoSameRevNote,
      // 🔴 R353：这三行曾被 R344/R350 的补丁**覆盖丢失** ⇒ 活动卡三个数字渲成空串、
      //   页面零报错（跑模拟器读 data 才发现）。原文案键还在 terms 里，只是没映射进 t。
      promoDropText: M.promoDropText,
      promoBeText: M.promoBeText,
      promoTrafficTextHeads: M.promoTrafficTextHeads,
      promoTrafficText: M.promoTrafficText,
      promoNeedCalc: M.promoNeedCalc,
      promoRealBad: M.promoRealBad,
      promoNegText: M.promoNegText,
      marginTip: M.marginTip,
      // 🔴 R547b：毛利率「从哪来」说明 —— **只有文字，没有按钮**（填表中间不能召唤跳走）。
      //   R545 那个「去建成本卡」按钮已撤：它打断填表闭环，且「建一张卡就自动算出来了」是假承诺。
      marginSrcNote: M.marginSrcNote,
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
      sensLoading: M.sensLoading,
      sensHint: M.sensHint,
      // 🔴 round279d · #12 多渠道毛利率（前端折算，引擎零改）：堂食/外卖/团购分别给毛利率与营收占比
      channelNote: M.channelNote,
      channelTakeawayRatio: M.channelTakeawayRatio,
      channelGroupRatio: M.channelGroupRatio,
      channelPlatformRate: M.channelPlatformRate,
      channelPackRate: M.channelPackRate,
      channelDiscountRate: M.channelDiscountRate,
      channelGroupPlatform: M.channelGroupPlatform,
      channelOver100: M.channelOver100,
      // 🔴 R546：⑦ 平台抽成改造新增（「这四个数在哪看」折叠 + 折扣换算注 + ※ 图例）
      channelRefLabel: M.channelRefLabel,
      channelRefBody: M.channelRefBody,
      channelRefNote: M.channelRefNote,
      // 🔴 R547b：多家平台抽成怎么合成一个数（新增折叠 sbChannelMulti）
      channelMultiLabel: M.channelMultiLabel,
      channelMultiBody: M.channelMultiBody,
      channelDiscountHint: M.channelDiscountHint,
      // R419：归到公共区（M1 月度录入页同用这一句）
      amountBadTip: TERMS.ui.amountBadTip,
      channelSample: M.channelSample,
      // 🔴 R296b：渠道佣金新键（占比×抽点 → 加权挂钩费率）
      channelCardRate: M.channelCardRate,
      channelTotal: M.channelTotal,
      channelTotalNote: M.channelTotalNote,
      channelPct: M.channelPct,
      // 🔴 R338：安全垫文案**复用 M1**（TERMS.card），不另写 —— 同一个老板在两个模块
      //   必须看到同一句话，否则像两套软件。改口径只改一处。
      safeMargin: TERMS.card.beMargin,
      targetEmptyHint: M.targetEmptyHint,
      beCashLabel2: M.beCashLabel2,
      beCashNote2: M.beCashNote2,
      fixedBreakTitle2: M.fixedBreakTitle2,
      fixedBreakNote2: M.fixedBreakNote2,
      resBreakMonthly: M.resBreakMonthly,
      resBreakDaily: M.resBreakDaily,
      resTargetMonthly: M.resTargetMonthly,
      resTargetDaily: M.resTargetDaily,
      resPayback: M.resPayback,
      paybackUnit: M.paybackUnit,
      indBand: M.indBand,
      indMine: M.indMine,
      indByBreak: M.indByBreak,
      indByTarget: M.indByTarget,
      addItem: M.addItem,
      delItem: M.delItem,
      otherBandNote: M.otherBandNote,
      bandPreviewNote: M.bandPreviewNote,
      buildNote: M.buildNote,
      marginBandLabel: M.marginBandLabel,
      expectRevLabel: M.expectRevLabel,
      expectRevPh: M.expectRevPh,
      expectRevTitle: M.expectRevTitle,
      expectRevTitleRev: M.expectRevTitleRev,
      expectRevNote: M.expectRevNote,
      revGrossHint: M.revGrossHint,
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
      fwdCrowdHintPre: M.fwdCrowdHintPre,
      fwdCrowdHintSuf: M.fwdCrowdHintSuf,
      // 🔴 round276 · A 区补齐 round223 §3.1 定案遗漏的「坪效 / 人效」（翻台已 round273 补）。
      fwdEffTitle: M.fwdEffTitle,
      fwdPixelEffLbl: M.fwdPixelEffLbl,
      fwdPixelEffUnit: M.fwdPixelEffUnit,
      fwdPerHeadLbl: M.fwdPerHeadLbl,
      fwdPerHeadUnit: M.fwdPerHeadUnit,
      fwdEffHint: M.fwdEffHint,
      // 🔴 R234：`revRentRate`（目标租金率）**已从输入项移除**（不再向用户收这个数）。
      //    它由系统自动取「本业态 × 本城市」的**健康租金上限**（云端 BANDS 单源），
      //    界面上只告诉用户"按什么行规算的"，不给输入框。
      revRevenue: M.revRevenue,
      revRentCap: M.revRentCap,
      revTraffic: M.revTraffic,
      revDailyTraffic: M.revDailyTraffic,
      // 🔴 R237：一个数、两套话术（按业态切）+ 三档难度，只渲染在**反推结果卡**里。
      // 🔴 P0#5（2026-10-11）：翻台「?」白话说明 + 结果吸底条（纯展示层）
      stickFwdLbl: M.stickFwdLbl,
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
      planSaving: M.planSaving,
      planNamePh: M.planNamePh,
      cancel: TERMS.buttons.cancel,
      // M2 G1/G2（2026-10-11 改造）：入口文案（来自 TERMS.matrix / TERMS.m2Plan 单源）
      matrixEntry: TERMS.matrix.title,
      matrixEntryNote: M.matrixEntryNote,
      compareEntry: TERMS.m2Plan.compare,
      // M2v1.3（业态参数包 + 回本卡）
      presetLabel: M.presetLabel,
      m2NavLine: M.m2NavLine,
      feeAmtUnit: M.feeAmtUnit,
      // 🔴 R452（D 项）：费率折算「≈ 每月多少钱」放回 ⇒ 必须同屏带这句「估算」（漏登记 ⇒ 真机静默空白）
      feeAmtEst: M.feeAmtEst,
      moreAnalysis: M.moreAnalysis,
      presetNone: M.presetNone,
      presetPickedPre: M.presetPickedPre,
      presetPickedSuf: M.presetPickedSuf,
      bizPresets: M.bizPresets,
      areaHint: M.areaHint,
      rentHint: M.rentHint,
      headcountHint: M.headcountHint,
      headcountHintRev: M.headcountHintRev,
      // 🔴 R291 补登记（修 P1-③ 静默空白）：index.wxml:46/47 的 reverse 三元分支引用了
      //    这两个键，但此前 t:{} 只登记了 forward 那一对 ⇒ `{{undefined}}` 被 WXML 静默渲染成空串。
      //    守卫工具 tools/check_page_terms.js 的 P2-1 已精确点名本处。
      l1TitleRev: M.l1TitleRev,
      l1GuideRev: M.l1GuideRev,
      // 🔴 R526：桌数输入也已删除（承接 R525「翻台率不讨论」）⇒ 这一组 4 个文案键全部下线
      //   （tablesLabel / tablesPh / tablesNote / tableUnit），不留"有键无渲染"的僵尸文案。
      // 🔴 R525（方案 B）：2% 杂支摆出来可改
      otherVarLabel: M.otherVarLabel,
      otherVarNote: M.otherVarNote,
      areaLabel: M.areaLabel,
      areaPh: M.areaPh,
      areaUnit: M.areaUnit,
      rentLabel: M.rentLabel,
      rentPh: M.rentPh,
      headcountLabel: M.headcountLabel,
      headcountLabelRev: M.headcountLabelRev,
      headcountUnit: M.headcountUnit,
      avgPriceLabel: M.avgPriceLabel,
      avgPricePh: M.avgPricePh,
      missingPrefix: M.missingPrefix,
      // 🔴 R296 拍1（李老师 2026-10-14）：人工改「每月总额」直填（不乘人数）——
      //   原「员工月均工资 × 人数」的乘法已删（各店工资不同，乘法会失真；人数只用来算人效）。
      laborTotalLabel: M.laborTotalLabel,
      laborTotalPh: M.laborTotalPh,
      laborTotalNote: M.laborTotalNote,
      // 🔴 R296 拍3：水/电/气拆三项输入（引擎仍合成单个 utility 键，零部署）。
      energyFee: M.energyFee,
      waterFee: M.waterFee,
      electricFee: M.electricFee,
      energyMergeLabel: M.energyMergeLabel,
      energyMergeNote: M.energyMergeNote,
      beHeroCap: M.beHeroCap,
      beHeroHint: M.beHeroHint,
      indLvGood: M.indLevels.good,
      indLvOk: M.indLevels.ok,
      indLvWarn: M.indLevels.warn,
      indLvBad: M.indLevels.bad,
      gasFee: M.gasFee,
      utilitySplitNote: M.utilitySplitNote,
      // 🔴 R296 拍2：管理费可选填（留空 = 不评）。
      manageOptLabel: M.manageOptLabel,
      manageOptNote: M.manageOptNote,
      // 🔴 R361（李老师 2026-10-19）：`openDaysLabel2 / openDaysNote2 / dayUnit` 三处映射已移除 ——
      //   「每月营业天数」那行整行删除（只读值，且底部假设卡已有一份）。
      //   ⚠️ 状态字段 `openDaysNum` 仍在用（草稿回读 / 发参 `|| 30`），只是不再渲染。
      // 🔴 R234-实测：`pixelEffLabel2`（坪效）/ `turnLabel2`（翻台率）映射已移除 ——
      //    两者连同其输入框一起退出本页（李老师原话：「这些本身是咱们计算出来的」）。
      //    留着孤儿映射会让下一个人以为"页面上还有这一项"，正是本轮踩的那类坑。
      // ⚠️ terms.js 定义保留（共享词典，别处/后续可能用）。
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
      // 🔴 R518：M2 → M1 转化口（免费模块的价值出口；此前只有去 M3 的一条钩子）
      paybackSeeM1: M.paybackSeeM1,
      months: M.months,
      yuanUnit: M.yuanUnit,
      initialInvestLabel: M.initialInvestLabel,
      initialInvestPh: M.initialInvestPh,
      paybackByInvest: M.paybackByInvest,
      // ── R234 · 主结论卡「这个铺子租金贵不贵」──
      // 🔴 三处登记的第二处（第一处 terms.js、第三处 index.wxml）：漏登记 ⇒ **渲染空白且零报错**。
      // ⚠️ 判定值不自造：全部读引擎 `indicators` 里 rent 那行的 level（good/ok/warn/bad/na）。
      verdictHealthTitle: M.verdictHealthTitle,
      verdictHealthStrip: M.verdictHealthStrip,
      calcBasisTitle: M.calcBasisTitle,
      calcBasisDays: M.calcBasisDays,
      calcBasisFormula: M.calcBasisFormula,
      m2Disclaimer: M.m2Disclaimer,
      // ── R234/J4 行内长提示折叠（M2 选址页 8 处 ≥18 字的提示）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      stickProfitLbl: M.stickProfitLbl,
      stickBeLbl: M.stickBeLbl,
      // 🔴 R367：目标反推文案（页面在 js 里拼串，所以映射必须齐 —— 缺一个就渲染空串）
      tgtRevTitle: M.tgtRevTitle,
      tgtRevMarginLine: M.tgtRevMarginLine,
      tgtRevLaborLine: M.tgtRevLaborLine,
      tgtRevLaborImpossible: M.tgtRevLaborImpossible,
      tgtRevMarginImpossible: M.tgtRevMarginImpossible,
      tgtRevNote: M.tgtRevNote,
      tgtRevNeedRevenue: M.tgtRevNeedRevenue,
      tgtRevNeedTarget: M.tgtRevNeedTarget,
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    // 选择器
    cityIdx: 1, bizIdx: 4,          // 🔴 round278：默认「二三线 / 其他·通用餐饮」—— 与预设兜底「都不是（按通用经验估算）」显示对齐（round277 真机暴露的静默错配 B）
    // 各行（yuan / pct 保存**字符串**，与输入框语义一致；提交时才转分）
    buildRows: [
      // 🔴 R296：新增「转让费」（开店大头，按租期摊）—— 与证照/首批物料分开，摊销年限更准。
      // 🔴 R297：年限一律取 `BUILD_DEFAULT_YEARS`（与云端 indicatorRef 同口径）——
      //   此前四处各写死 3/3/5/3，改默认值得改四遍且必漏一处。
      mkRow('transfer', M.buildItems, M.buildItemNotes, { yuan: '', years: BUILD_DEFAULT_YEARS.transfer }),
      mkRow('decor', M.buildItems, M.buildItemNotes, { yuan: '', years: BUILD_DEFAULT_YEARS.decor }),
      mkRow('equip', M.buildItems, M.buildItemNotes, { yuan: '', years: BUILD_DEFAULT_YEARS.equip }),
      mkRow('franchise', M.buildItems, M.buildItemNotes, { yuan: '', years: BUILD_DEFAULT_YEARS.franchise }),
    ],
    // 🔴 R296b：`varRows`（④「跟营业额挂钩的费用」明细）**整块删除** —— 挂钩费率改由
    //   「渠道佣金」卡（各渠道占比 × 抽点）自动算，见 `recomputeChannel` + `buildPresetParam`。
    marginPct: 65,
    expectYuan: '',      // 预计月营业额（选填）—— 锚点：后端据此反算各项参考金额
    targetYuan: '',
    // 结果（全部来自后端）
    result: null,
    // 🔴 R327：正推表（做到某营业额能赚多少）—— 由 profitLadderOf(result) 派生
    profitLadder: null,
    targetReverse: null,   // R367：想月赚 X 要怎么做（反推毛利率 / 人工上限）
    // 🔴 R370（纯堂食 · 缩小为「保本门槛」）：只剩两个输入 —— 实收率 与 活动成本率。
    //   折扣档 / 几成订单 两组 chips 已删：老板手上直接有"实收 ÷ 原价"，不需要系统替他反推。
    promoRealPct: '',   // 折扣后实收率（%）：实收 ÷ 原价 × 100；空 = 还没填
    promoCostPct: '',   // 商家出资的活动成本率（% 实收）：赠送/奖品/自贴券
    promoRes: null,
    // 🔴 R342：固定费用构成（前端同源重算 + 与引擎对账，对不上就整块不显示）
    fixedBreak: null,
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
    // 🔴 R323：原 `reverseResult` 已删 —— 全页只有声明与读取、**从无赋值**（审计 B13）。
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
    // 🔴 R543（李老师 2026-10-27）：水电**默认分两栏**（水费 / 电费），只有账单合并的店才打开开关走「水电合计」。
    //   R541 曾把两栏直接合成一格 —— 那是把「给合并账单的店一个选项」做成了不可逆的单一口径。
    waterYuan: '',
    electricYuan: '',
    energyMerged: false,     // 开关：false=分两栏（默认）/ true=水电合计单值
    energyYuan: '',          // 仅合并态使用
    gasYuan: '',
    // 🔴 R296 拍2：管理费（选填）—— 普通单店通常没有，留空 = 不评（不虚高）。
    manageYuan: '',
    // 🔴 R294-C：手填标记位。marginPct 初值非空（65），不能靠「空串」判断用户是否改过 ⇒ 用显式标记。
    //   选预设时仅补 `fieldTouched.x` 为 false 的字段，用户手填过的一律保留。
    // 🔴 R297 第四轮（审计 B10）：补 `seatsPerTable` —— 原实现漏了这一项，选业态预设时
    //   会**无条件覆盖**用户手填的单桌座位数（见 onPreset），与本节机制自相矛盾。
    // 🔴 R525：该字段已随「单桌座位数」输入一起删除，改登记 `otherPct`（2% 杂支可改 ⇒ 同样不能被预设覆盖）。
    fieldTouched: { margin: false, labor: false, avg: false, otherPct: false },
    // 🔴 R290：固定 30（李老师原话「每天都正常营业，推演也按每天营业推」）。
    //   ⚠️ 不是删字段——引擎 `open_days` 必填 1~31，留空会发 0 ⇒ fail-closed 报「填写错误」。
    openDaysNum: '30',       // 每月营业天数（常量 30；R361 起**不再渲染**，只供发参/草稿用）
    // 🔴 R526：**桌数 / 座位数两个输入都已删除**（R525 删座位、R526 删桌数）。
    //   核实结论（回答"桌数在反推里按桌数还是座位数算"）：**两者都不参与** ——
    //     · 反推（寻找铺面）现在点 Tab 直接进矩阵页，矩阵每格走**正向**口径（clean 默认 mode='forward'），
    //       产出只有「保本营业额 / 目标营业额 / 房租占比 / 回本」，`matrix.js` 里搜不到 seats；
    //     · 云端 `calcSandboxReverse`（用 seats 算 turn_rate/月客流）**已无调用方**，只剩契约与自测；
    //     · 正向引擎不使用 seats，`validate` 对 forward 也不校验它。
    //   ⇒ 桌数留着就是"填了不影响任何结果"的死输入，故删除。
    // 🔴 R525（方案 B）：其他杂支占营业额 %（默认取预设值 2%；老板可改 0 或留空 = 不算这项）。
    //   为什么从预设里"抬"到界面上：原来它藏在参数包里、老板改不了 ⇒ 已有店铺填了真实水电/管理费
    //   再被额外扣 2% 未填过的钱 = 重复扣；摆出来可改才是"不替老板假设"。
    otherPctNum: '2',        // 其他杂支（占营业额 %）
    // 🔴 R234-实测修复：`pixelEffYuan`（坪效）/ `turnNum`（翻台率）**已从输入区移除**。
    //   依据李老师原话「这些本身是咱们计算出来的，不是让客户自己填出来的」。
    //   实测坐实的两个事实（见 review/evidence/r234_m2_v14/probe_engine.js）：
    //     · `turnNum` 全仓只有 data 声明 + onTurn handler，**引擎根本不收 turn 参数**
    //       ⇒ 用户填了会触发重算却对任何结果零影响 = 纯死输入（最糟的一类 UI）。
    //     · `pixelEffYuan` 唯一下游是 `area_cap_sqm`，而坪效不让问 ⇒ 该输出恒 null ⇒ 一并移除。
    //   ⚠️ `pixel_eff_fen` 仍是**云函数契约字段**（validate 允许 0）⇒ 保留传参、恒传 0，不删字段。
    // 🔴 R447：`feeOverrides` 与 `feeRows` **有意保留**（不是漏删）——
    //   · `feeOverrides` 仍是引擎入参覆盖分支的源（`varItemsFinal` 里 `fo[v.key]`）；删它要动入参装配，越界。
    //   · `feeRows` 由 `onPreset` 按预设 `costMeta` 装配，是「费率行 ≈ 每月多少钱」重新显示时的唯一数据源；
    //     删了等于把恢复成本从"改 wxml"变成"改预设装配"。⚠️ 二者现均**无读取方**（R441 删 L3 的连带）。
    feeOverrides: {},        // itemKey → pct 字符串（L3 费率覆盖；现无写入方，保留作引擎入参覆盖口）
    feeRows: [],             // 当前预设 revenue_rate 项 [{key,label,pct}]（现无读取方，保留待产品拍板）
    fixedPreviewText: '',    // R443：输入区实时「每月固定支出合计」的展示文本（只读，不参与计算）
    missingHint: '',         // R443：顶部「还差哪几格」一行提示（全填完即消失）
    showMore: false,          // R442：结果区四张分析卡（利润阶梯/客群/效率/回本）默认收起
    showL2: false,
    // 🔴 R364：试验台（做活动）默认收起 —— 它问的是"如果"，不是老板要填的事实；
    //   收起时只显示一句结论（打几折要多卖多少），点开才露出参数。
    showPromo: false,
    showAssumptions: false,
    // R234/J4：行内长提示折叠（与月录入页同一套 `hintFold` map 模式，默认全收起）。
    //   ⚠️ 与上面三个区段级折叠（showL2/showPromo/showAssumptions，走 .fold-toggle）**语义不同**：
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
    // 🔴 R296b 「渠道佣金」（原 #12 多渠道毛利率**改造** · 豆包评审定案）：
    //   老板只知道「大概多少生意来自外卖/团购 + 平台抽几个点」，**80% 算不出加权总费率** ⇒
    //   让他填「各渠道占比 + 抽点」，系统自动算**加权挂钩费率**，直接进 `var_items`（引擎零改）。
    //   🔴 绝不揉进毛利率 —— 老板认知里毛利率是"菜赚不赚钱"，偷偷扣掉平台佣金会被当成软件算错。
    //   ⚠️ 默认 `on:false` ⇒ 佣金 0，与改造前 **100% 一致（保本/目标锚点零漂移）**；
    //      打开后默认 外卖占比 20% × 抽点 20% = 4%（豆包：主流档，普通堂食店直接可用）。
    channel: {
      on: false,                 // 「渠道佣金」开关，默认关（关 = 不计佣金，零漂移）
      takeawayRatio: 20,         // 外卖占流水%（默认 20）
      // 🔴 R546（⑦ 平台抽成改造）：四个费率默认 **空字符串**（= 老板不知道），
      //   计算时按 CHANNEL_REF 兜底并在界面打 ※。
      //   原来默认 20 / 0 / 5 / 0 ⇒ 等于替他认定「外卖没包装费、团购没打折」
      //   ⇒ 渠道费率偏低 ⇒ 保本额偏低（**偏乐观**：老板以为更容易回本）。
      //   改成 '' 之后：留空 = 不知道（按参考值）；**填 0 = 他明确说「我没有这笔」**。
      platformRate: '',
      packRate: '',
      groupRatio: 0,             // 团购占流水%（这是他的生意结构，必须他自己填，不给参考值）
      groupPlatformRate: '',
      discountRate: '',
      cardRate: '',
      // 留空提示语：数字一律由 CHANNEL_REF 拼出（术语里只写「怎么理解」，不写数值）
      phPlatformRate: phTpl(M.channelPhTpl, CHANNEL_REF.platformRate),
      phPackRate: phTpl(M.channelPhTpl, CHANNEL_REF.packRate),
      phGroupPlatformRate: phTpl(M.channelPhTpl, CHANNEL_REF.groupPlatformRate),
      phDiscountRate: phTpl(M.channelPhDiscountTpl, CHANNEL_REF.discountRate,
        (100 - CHANNEL_REF.discountRate) / 10),
      phCardRate: phTpl(M.channelPhTpl, CHANNEL_REF.cardRate),
      // 哪几项用了参考值（wxml 行名后打 ※）；初始全空 ⇒ 全部是 ※
      refs: { platformRate: 1, packRate: 1, groupPlatformRate: 1, discountRate: 1, cardRate: 1 },
      anyRef: true,
      // ---- 派生（均按**总流水**口径，供 var_items；合计即「总挂钩费率」）----
      takeawayComm: 0,           // 外卖佣金费率 = 外卖占比% × (抽点+包装)%
      grouponComm: 0,            // 团购佣金费率 = 团购占比% × (抽点+折扣)%
      cardFee: 0,                // 刷卡费率
      total: 0,                  // 合计挂钩费率（= 三者之和）
      over100: false,            // R412：外卖+团购占比 > 100%（true 时界面提示；只提示不改数）
      badAmountCount: 0,         // R414（#25）：读不成数字的金额栏数（>0 时界面提示；只提示不改数）
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
        shop_id: ss.currentShopId(),   // R443：切店后不得回填到别的店
        cityIdx: this.data.cityIdx,
        bizIdx: this.data.bizIdx,
        marginPct: this.data.marginPct,
        expectYuan: this.data.expectYuan,
        targetYuan: this.data.targetYuan,
        // #1 收口（round272b）：营业天数也要随草稿回来 —— 否则提示「已载入上次填的数」是**半份**
        //   （用户改过 26 天、退出重进后被静默丢回 30 天，且他看不出来）。
        openDaysNum: this.data.openDaysNum,
        build: this.data.buildRows.map((r) => ({ key: r.key, yuan: r.yuan, years: r.years })),
        // 🔴 R296 拍1 / R296b：`fixed`（明细表）与 `varRows`（挂钩费用明细）均已删除，不再存草稿。
        presetKey: this.data.presetKey,
        // 🔴 R443：**金额格也必须进草稿**。原草稿只存了城市/业态/毛利率/期望/目标/天数/投资项/业态预设 9 项，
        //   而最费事的房租、人工、水电气、管理费、客单价、面积**一项没存** ⇒ 填完这几格退出重进全空，
        //   页面上刚加的「每月固定支出合计」一重进就变 0，等于自证草稿是半份。
        //   ⚠️ 这些是「元」字符串：原样存取，不做任何换算（换算会引入精度问题，见 check_money_precision）。
        rentYuan: this.data.rentYuan,
        laborTotalYuan: this.data.laborTotalYuan,
        energyMerged: this.data.energyMerged,
        energyYuan: this.data.energyYuan,
        waterYuan: this.data.waterYuan,
        electricYuan: this.data.electricYuan,
        gasYuan: this.data.gasYuan,
        manageYuan: this.data.manageYuan,
        // 🔴 R525：其他杂支 % 也要进草稿 —— 老板改成 0（不扣这项）后退出重进，不能被默认 2% 顶回来。
        otherPctNum: this.data.otherPctNum,
        avgPriceYuan: this.data.avgPriceYuan,
        initialInvestYuan: this.data.initialInvestYuan,
        areaNum: this.data.areaNum,
        // 🔴 R546：渠道参数进草稿 —— 原来 `channel` **整块不存**，老板填了抽成/折扣、
        //   退出重进全丢、静默回默认值（与 R443 修过的「半份草稿」同族病）。
        //   只存 8 个输入项，派生值（takeawayComm 等）不存 —— 回来重算，绝不存中间量。
        channel: {
          on: this.data.channel.on,
          takeawayRatio: this.data.channel.takeawayRatio,
          platformRate: this.data.channel.platformRate,
          packRate: this.data.channel.packRate,
          groupRatio: this.data.channel.groupRatio,
          groupPlatformRate: this.data.channel.groupPlatformRate,
          discountRate: this.data.channel.discountRate,
          cardRate: this.data.channel.cardRate,
        },
      });
    } catch (e) { /* 写盘失败不影响测算：草稿只是锦上添花，不打扰用户 */ }
  },

  restoreDraft() {
    let d = null;
    try { d = wx.getStorageSync(DRAFT_KEY); } catch (e) { d = null; }
    // 🔴 R443：草稿只认**本店** —— 切到 B 店后，A 店填的房租/毛利率/客单价绝不能回填进来
    //   （否则老板按 A 店的成本给 B 店做决策，且界面上看不出任何异常）。
    if (!d || d.v !== 1 || d.shop_id !== ss.currentShopId()) return false;
    // 🔴 R297：草稿里的年限可能为空/非法（老草稿无此字段）⇒ 走 `buildYearsOf` 归一，
    //   绝不把空串直接塞回输入框（空串 ⇒ 提交时若再兜错，保本点照样静默算错）。
    const build = (d.build || []).map((x) => mkRow(x.key, M.buildItems, M.buildItemNotes,
      { yuan: x.yuan, years: buildYearsOf(x.key, x.years) }));
    // 🔴 R296 拍1 / R296b：旧草稿里的 `d.fixed`（明细表）与 `d.varRows`（挂钩明细）**一并忽略**。
    const ci = d.cityIdx || 0;
    const bi = d.bizIdx || 0;
    // 🔴 R543：三种历史草稿都要能打开 ——
    //   ① 本版：有 `energyMerged` ⇒ 照它回填（两个框的值各归各位）；
    //   ② R541 版：只有 `energyYuan` 单值（两栏已被合并）⇒ 视为合并态；
    //   ③ R538 及更早：只有 `waterYuan` / `electricYuan` 两栏 ⇒ 分栏态各回各框。
    //   ⚠️ 不再把 legacy 水+电相加塞进合并框 —— 那会让"分栏的店"重进后突然变成合并态。
    const _hasWE = (d.waterYuan !== undefined) || (d.electricYuan !== undefined);
    const _merged = d.energyMerged !== undefined ? !!d.energyMerged : (!_hasWE && d.energyYuan !== undefined);
    this.setData({
      cityIdx: ci, cityName: M.cityTiers[ci].name,
      bizIdx: bi, bizName: M.bizTypes[bi].name,
      buildRows: build.length ? build : this.data.buildRows,
      marginPct: typeof d.marginPct === 'number' ? d.marginPct : this.data.marginPct,
      expectYuan: d.expectYuan || '',
      targetYuan: d.targetYuan || '',
      openDaysNum: d.openDaysNum || '30',   // R290：旧草稿没有该字段时兜底 30，绝不回退空串（空串 ⇒ 发 0 ⇒ fail-closed）
      presetKey: d.presetKey || '',   // 🔴 round279e · D：回存业态预设（老用户打开时选择器与计算口径一致，不再"显示通用、实际按别业态算"）
      // 🔴 R443：金额格回填 —— 判据用 `!== undefined`（不写 `|| 默认值`）：
      //   **空串是老板自己清空的状态**，不能被默认值顶回来（否则「我明明清空了，重进又有了」）。
      rentYuan: d.rentYuan !== undefined ? d.rentYuan : this.data.rentYuan,
      laborTotalYuan: d.laborTotalYuan !== undefined ? d.laborTotalYuan : this.data.laborTotalYuan,
      energyMerged: _merged,
      energyYuan: d.energyYuan !== undefined ? d.energyYuan : this.data.energyYuan,
      waterYuan: d.waterYuan !== undefined ? d.waterYuan : this.data.waterYuan,
      electricYuan: d.electricYuan !== undefined ? d.electricYuan : this.data.electricYuan,
      gasYuan: d.gasYuan !== undefined ? d.gasYuan : this.data.gasYuan,
      manageYuan: d.manageYuan !== undefined ? d.manageYuan : this.data.manageYuan,
      // 🔴 R525：杂支 % 同样是「空串/0 也是老板的选择」⇒ 用 `!== undefined` 判，别拿默认 2% 顶回来；
      //   回填了就算"用户已作答"（fieldTouched），后续切业态不得覆盖。
      otherPctNum: d.otherPctNum !== undefined ? d.otherPctNum : this.data.otherPctNum,
      'fieldTouched.otherPct': d.otherPctNum !== undefined ? true : this.data.fieldTouched.otherPct,
      avgPriceYuan: d.avgPriceYuan !== undefined ? d.avgPriceYuan : this.data.avgPriceYuan,
      initialInvestYuan: d.initialInvestYuan !== undefined ? d.initialInvestYuan : this.data.initialInvestYuan,
      areaNum: d.areaNum !== undefined ? d.areaNum : this.data.areaNum,
      draftRestored: true,
    });
    // 🔴 R546：回填渠道参数。老草稿没有 `channel` 字段 ⇒ 保留当前默认（不硬塞一个 0）；
    //   回填后**立刻重算派生值** —— 否则 on=true 但 takeawayComm 还是 0 ⇒ 渠道费率当 0 用，保本偏低。
    const dc = d.channel;
    if (dc && typeof dc === 'object') {
      const keep = (v, dflt) => (v !== undefined ? v : dflt);
      const cur = this.data.channel;
      this.setData({
        channel: Object.assign({}, cur, {
          on: !!dc.on,
          takeawayRatio: keep(dc.takeawayRatio, cur.takeawayRatio),
          platformRate: keep(dc.platformRate, cur.platformRate),
          packRate: keep(dc.packRate, cur.packRate),
          groupRatio: keep(dc.groupRatio, cur.groupRatio),
          groupPlatformRate: keep(dc.groupPlatformRate, cur.groupPlatformRate),
          discountRate: keep(dc.discountRate, cur.discountRate),
          cardRate: keep(dc.cardRate, cur.cardRate),
        }),
      });
      this.recomputeChannel();
    }
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
        wx.reLaunch({ url: '/subpkg/tools/sandbox/index' });
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
    const rows = this.data.buildRows.concat([mkRow(k, M.buildItems, M.buildItemNotes,
      { yuan: '', years: buildYearsOf(k, '') })]);
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

  // 🔴 R296b：`onVarPct` / `onAddVar` / `onDelVar` 三 handler **随 ④「挂钩费用」明细卡一并删除** ——
  //   挂钩费率改由「渠道佣金」卡自动算（`onChannelInput` → `recomputeChannel`），不再让用户逐项加行。

  // ===== 目标利润 =====
  onTarget(e) { this.setData({ targetYuan: e.detail.value }); this.scheduleCalc(); },

  // ===== 预计月营业额（锚点 · round114）=====
  onExpect(e) { this.setData({ expectYuan: e.detail.value }); this.scheduleCalc(); },

  // ===== M2v1.1 双 Tab + 反推输入 =====
  onTab(e) {
    const mode = e.currentTarget.dataset.mode;
    // 🔴 R323（P0-2）：清掉整段死分支 —— 原码在 `if (mode === 'reverse') navigate` 之后还有
    //   `setData({mode}) / refreshStick() / scheduleCalc()`，但 `data.mode` 恒为 'forward'，
    //   且「已有铺面」Tab 点一次会先被 `mode === this.data.mode` 早退 ⇒ 后半段**永远不执行**。
    //   现在只保留真实行为：点「寻找铺面」⇒ 进矩阵页；点「已有铺面」⇒ 什么都不用做。
    if (mode === 'reverse') {
      wx.navigateTo({ url: '/subpkg/tools/sandbox/matrix?mode=reverse' });
    }
  },
  // 🔴 R296 拍4：`onToggleTurnHelp` 随反推翻台展示一并删除（引擎仍算 turn_rate，仅不再展示）。
  // 🔴 P0#5：吸底条点开 ⇒ 滚到结果区（原生页面滚动用 pageScrollTo + selector）
  onStickTap() { wx.pageScrollTo({ selector: '#m2result', duration: 300 }); },
  // 🔴 P0#5：根据当前 Tab + 结果，算出吸底条要显示的核心数（只在出数且非红警时显示）
  refreshStick() {
    const t = this.data.t || {};
    const cur = (t.cur) || '¥';
    let kpi = false, lbl = '', val = '';
    let profitText = '', lvlText = '';
    // 🔴 R323：首页恒为「已有铺面」⇒ 吸底条只可能有正向 KPI（反推 KPI 在矩阵页）。
    const r = this.data.result;
    if (r && !r.red_alert) {
      kpi = true;
      lbl = t.stickBeLbl || t.stickFwdLbl || '保本';
      val = cur + (r.break_even_monthly != null ? r.break_even_monthly : '');
      // 🔴 R364（李老师「整个版面一坨，不知道在表达什么」）：
      //   吸底条原来只给一个「保本营业额」⇒ 老板滚到哪都只知道"要卖多少"，不知道"能赚多少"。
      //   补两个数：按**实际月营业额**（他填的那个数）算的月利润 + 主结论评级。
      //   ⚠️ 只有填了实际营业额才给利润 —— 没填就没有可信锚点，宁可空着也不拿目标利润冒充。
      const expYuan = Number(String(this.data.expectYuan == null ? '' : this.data.expectYuan).replace(/[^\d.]/g, ''));
      const k = Number(r.margin_rate) / 100;
      const fixed = Number(r.fixed_total);
      if (expYuan > 0 && isFinite(k) && k > 0 && isFinite(fixed)) {
        const pYuan = Math.round(expYuan * k - fixed);
        // R411：走单源 —— 先取整再分组，小数位绝不被千分位切碎
        const money = (n) => MoneyFmt.groupDigits(Math.abs(n));
        profitText = (pYuan >= 0 ? '+' : '−') + cur + money(pYuan);
      }
      const v = this.data.verdict;
      if (v && v.level && v.level !== 'na' && v.levelName) lvlText = v.levelName;
    }
    this.setData({ stickKpi: kpi, stickLbl: lbl, stickVal: val, stickProfit: profitText, stickLvl: lvlText });
  },
  // 🔴 R234：删掉 `onRevRentRate` / `onRevPixelEff` 两个 handler ——
  //    对应输入框已从 wxml 移除（R223 §3.2 明令「L1/L2 严禁以坪效/目标租金率作输入」）。
  //    留着孤立的 handler 会让后续维护误以为还有这条路。
  // 🔴 R526：`onTables`（桌数输入）已随桌数一起删除。
  //   按 R234 同一纪律（只删 UI 不删 handler 会让人以为功能还在，下一个加输入框的人一条就能接回来）：
  //   连根拔，不留孤立 handler。
  // 🔴 R525（方案 B）：其他杂支（占营业额 %）—— 老板可改 0 / 留空 = 不算这项。
  //   走**既有**引擎入参覆盖口 `feeOverrides`（buildPresetParam 里 `fo[v.key]`），不新开参数、
  //   不碰云端契约；`feeRows` 同步改 pct，让下面那行「≈ 每月多少钱（估算）」跟着变。
  onOtherPct(e) {
    const raw = e.detail.value;
    const n = (raw === '' || raw === null || raw === undefined) ? 0 : Number(raw);
    const pct = (isFinite(n) && n >= 0) ? n : 0;
    const fo = Object.assign({}, this.data.feeOverrides, { other: String(pct) });
    const rows = (this.data.feeRows || []).map((r) =>
      (r.key === 'other' ? Object.assign({}, r, { pct: String(pct) }) : r));
    this.setData({ otherPctNum: raw, 'fieldTouched.otherPct': true, feeOverrides: fo, feeRows: rows },
      () => this.refreshFeeAmt());
    this.scheduleCalc();
  },

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
    const base = Number(this.data.marginPct) || 0;   // R296b：毛利率不再被渠道折算（佣金走 var_items）
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

  // ===== R296b · 渠道佣金（原 #12「多渠道毛利率」改造 · 豆包评审定案）=====
  // 🔴 口径：佣金**进挂钩费率（var_items）**，**绝不揉进毛利率**（老板认知里毛利率=菜赚不赚钱）。
  //   老板填「各渠道占比 + 抽点」（他知道的数），系统算**加权挂钩费率**（占**总流水**%）。
  //   ⚠️「占比」是关键：老板嘴里的"抽点"是**该渠道收入**的百分比，直接乘总流水会高估 ⇒ 必须加权。
  recomputeChannel() {
    const c = this.data.channel;
    const rt = Number(c.takeawayRatio) || 0;
    const rg = Number(c.groupRatio) || 0;
    const off = !c.on;
    const r2 = (x) => Math.round(x * 100 + 1e-9) / 100;
    // 🔴 R546：三态取值 —— 空 / 读不成 / 负数 ⇒ 按行业参考值算并记 ※；填数 ⇒ 按他填的（含 0）。
    //   为什么不沿用 `Number(v) || 0`：那个写法把「空」和「0」混成同一个 0，
    //   正是旧病根源（老板没填 ≠ 老板说没有）。
    const take = (v, ref) => {
      if (v === '' || v === null || v === undefined) return { v: ref, useRef: 1 };
      const n = Number(v);
      if (!isFinite(n) || n < 0) return { v: ref, useRef: 1 };
      return { v: n, useRef: 0 };
    };
    const pr = take(c.platformRate, CHANNEL_REF.platformRate);
    const pk = take(c.packRate, CHANNEL_REF.packRate);
    const gp = take(c.groupPlatformRate, CHANNEL_REF.groupPlatformRate);
    const dc = take(c.discountRate, CHANNEL_REF.discountRate);
    const cf = take(c.cardRate, CHANNEL_REF.cardRate);
    const refs = {
      platformRate: pr.useRef, packRate: pk.useRef,
      groupPlatformRate: gp.useRef, discountRate: dc.useRef, cardRate: cf.useRef,
    };
    const anyRef = off ? false : !!(pr.useRef || pk.useRef || gp.useRef || dc.useRef || cf.useRef);
    const takeawayComm = off ? 0 : r2(rt * (pr.v + pk.v) / 100);
    // 🔴 R544 定案（见 review/NOTE_2026-10-27_R544）：团购渠道费率 = 折扣 + 抽成 − 折扣×抽成。
    //   依据 `utils/grouponDerive.js` 红线③：**佣金基数 = 顾客实付的团购价**，
    //   所以折扣与抽成在 d·c 那一小块上**交叠**，直减会重复扣（7 折+5% 时多扣 1.5 个点，保本虚高约 2.9%）。
    const gRatePct = dc.v + gp.v - (dc.v * gp.v) / 100;
    const grouponComm = off ? 0 : r2(rg * gRatePct / 100);
    const cardFee = off ? 0 : r2(cf.v);
    // 🔴 R412：占比合计 > 100% 时**必须提示**。老板填「外卖 60% + 团购 60%」时，
    //   上面两行佣金等于按 120% 的流水扣 ⇒ 挂钩费率虚高 ⇒ 保本额虚高，而全程零报错。
    //   为什么不静默钳到 100%：钳制会掩盖输入错误（钳完的数同样是错的，老板看不出自己填错）。
    //   关掉渠道时（off）不给提示：此时占比不参与计算，提示只会误导。
    const over100 = !off && ChannelRule.isChannelRatioOver100(rt, rg);
    this.setData({
      'channel.takeawayComm': takeawayComm,
      'channel.grouponComm': grouponComm,
      'channel.cardFee': cardFee,
      'channel.total': r2(takeawayComm + grouponComm + cardFee),
      'channel.over100': over100,
      'channel.refs': refs,
      'channel.anyRef': anyRef,
    });
  },

  onToggleChannel() {
    const on = !this.data.channel.on;
    // 🔴 R296b：开/关**都要**重算 —— 关掉时把佣金归零（否则关了还留着上次的值 ⇒ 静默多扣）。
    this.setData({ 'channel.on': on }, () => { this.recomputeChannel(); this.scheduleCalc(); });
  },
  // （R296b：原 `onToggleChannelParams` 随「默认参数」折叠区一并删除 —— 新卡无该折叠。）

  onChannelInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['channel.' + field]: e.detail.value }, () => {
      this.recomputeChannel();
      this.scheduleCalc();
    });
  },

  // ===== 自动重算（防抖；AD-6/AD-7 折中）=====
  scheduleCalc() {    this.setData({ dirty: true });
    // 🔴 R452（D 项）：`refreshFeeAmt()` **放回** —— R447 删它是因为消费端（wxml 的 `fee-amt` 行）
    //   已被 R441 一起删掉 ⇒ 纯写不读。本轮 wxml 已重新渲染费率行 ⇒ 消费端回来了，调用同步恢复。
    this.refreshFeeAmt();
    // R443：输入区同步「每月固定支出合计」—— 老板边填边自查，不用滚到结果区
    this.refreshFixedPreview();
    // R443：顶部「还差哪几格」—— 只提示三项影响最大的，全填完自动消失
    this.refreshMissing();
    // R414（队列 #25）：先体检金额框，再走防抖计算（体检本身零成本，不触发云端）
    this.checkAmountInputs();
    // R193：用户一改就存草稿（此处已是 700ms 防抖链路上，不会高频写盘）
    this.saveDraft();
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.onCalc(); }, DEBOUNCE_MS);
  },

  /**
   * R418：金额框体检（读不成数字的栏数 → data，wxml 提示）。只暴露，不改数。
   * 来由、实测数据与边界见 review/NOTE_2026-10-21_R418_金额输入可读性.md（注释不进包体，省体积）。
   */
  checkAmountInputs() {
    const KEYS = ['rentYuan', 'laborTotalYuan', 'waterYuan', 'electricYuan', 'energyYuan', 'gasYuan',
      'manageYuan', 'targetYuan', 'expectYuan', 'avgPriceYuan', 'initialInvestYuan'];
    const fields = {};
    for (let i = 0; i < KEYS.length; i++) fields[KEYS[i]] = this.data[KEYS[i]];
    const bad = AmountInput.findUnreadable(fields);
    const n = bad.length;
    // 只在数量变化时 setData（避免每次输入都重渲染）
    if (n !== this.data.badAmountCount) this.setData({ badAmountCount: n });
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
    if (isFirst === true) this.setData({ loading: true, calcError: '' });
    return this.onCalcPresetFwd();
  },

  /**
   * 🔴 R297 第四轮（M2 整体审计 B11）：【开始测算】按钮专用入口。
   *
   * 为什么必须有这一层：`bindtap="onCalc"` 会把**事件对象**当作第一个实参传进来
   * ⇒ `onCalc(isFirst)` 里 `isFirst` 恒为真 ⇒ 每次点按钮都 `setData({loading:true})`
   * ⇒ 根节点 `wx:if="{{!loading}}"` 整页切走再切回 = **整页重绘 + 滚动位置丢失**
   * （round114 明确修过的"改一个数就整页闪成加载中"，被按钮这条路重新引入；
   *  而 `onCalc(true)` 的本意只给首屏 bootstrap 用）。
   * ⇒ 按钮走这里、显式传 false；首屏仍由 bootstrap 走 `onCalc(true)`。
   */
  onCalcBtn() { return this.onCalc(false); },

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
    wx.navigateTo({ url: '/subpkg/tools/sandbox/list' });
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
    // 🔴 R297 第三轮：保存**不依赖先算成功**（原实现只校验方案名）⇒ 越界值会连快照一起落库
    //   （实测毛利率 150 ⇒ 快照保本 42564→18444 元、方案列表/对比页从此拿它当数）。
    const badParam = this.badParamOf(paramJson);
    if (badParam) { api.toastError({ msg: badParam }); return; }
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
  // 🔴 R366：把当前这一页的**事实**带进矩阵页 —— 已有铺面的矩阵要拿它当固定前提
  //   （房租就是他签的那个数、人数就是现在在岗的人数），否则进去是另一套默认值，
  //   老板会以为"这表跟我没关系"。reverse（寻找铺面）不带：那时房租还是变量。
  goMatrix() {
    const d = this.data;
    const q = ['mode=' + d.mode];
    if (d.mode === 'forward') {
      const add = (k, v) => { const n = Number(v); if (isFinite(n) && n > 0) q.push(k + '=' + Math.round(n)); };
      add('rent', d.rentYuan);
      add('labor', d.headcountNum);
      add('margin', d.marginPct);
      add('target', d.targetYuan);
    }
    // 🔴 R525：其他杂支 % 必须带给矩阵，**0 也要带**（0 = 老板明确不要这项；不带会被当成默认 2%）。
    //   不带就会出现"单页保本 X、矩阵保本 Y"的双口径，而且两边都不报错。
    if (d.otherPctNum !== '' && d.otherPctNum !== null && d.otherPctNum !== undefined
        && isFinite(Number(d.otherPctNum)) && Number(d.otherPctNum) >= 0) {
      q.push('other=' + Number(d.otherPctNum));
    }
    wx.navigateTo({ url: '/subpkg/tools/sandbox/matrix?' + q.join('&') });
  },
  goCompare() { wx.navigateTo({ url: '/subpkg/tools/sandbox/compare' }); },

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
    // 🔴 R438（李老师 2026-10-22）：「中餐 湘菜 东北菜 什么的，这个重复的东西核算也是按中餐核算，
    //   你让餐饮老板选择更细的二级也没意义呀」——查证属实：14 个预设只映射到 4 个 bizKey
    //   （fastfood / hotpot / dining / cafe），**光 dining 就占 5 个**（川菜/湘菜/粤菜/家常/其他）
    //   ⇒ 选哪个算出来一模一样，是伪选择。
    //   ⇒ 下拉只展示 6 个代表项；**被隐藏的 key 仍保留在 BIZ_PRESETS 里**，旧方案照常解析。
    // 🔴 R523：移除 fastfood_other（参数 100% 继承 fastfood_noodle，属伪选择）；
    //   火锅/烧烤都保留（53% vs 59% 真实差异）。旧方案用到被移除的 key 时，下方「补一条」逻辑兜底。
    //    顺序必须与 M1 的 `bizTypes` 一致（快餐 → 正餐 → 火锅 → 茶饮），否则同一套词在两个模块里排序不同。
    // 🔴 R524：hotpot_barbecue 也移出白名单 —— 行业基准只有一套 BANDS.hotpot，
    //   拆两项会让老板误以为火锅/烧烤是两套标准，且与 M1 的单一评价口径冲突。
    const DISPLAY_KEYS = ['fastfood_noodle', 'dining_sichuan', 'hotpot_half_self', 'cafe_tea'];
    let shownPresets = BIZ_PRESETS.filter((p) => DISPLAY_KEYS.indexOf(p.presetKey) >= 0)
      .sort((a, b) => DISPLAY_KEYS.indexOf(a.presetKey) - DISPLAY_KEYS.indexOf(b.presetKey));
    // 旧方案用到的 key 若不在白名单 ⇒ 临时补一条：否则 findIndex 找不到会回落 presetIdx=0
    // （显示成"通用餐饮"，老板会以为方案坏了）。
    const curKey = this.data.presetKey;
    if (curKey && curKey !== 'other' && !shownPresets.some((p) => p.presetKey === curKey)) {
      const old = BIZ_PRESETS.find((p) => p.presetKey === curKey);
      if (old) shownPresets = shownPresets.concat([old]);
    }
    const opts = shownPresets.map((p) => {
      // 🔴 R523：优先用 presetDisplay（与 M1 的 bizTypes 逐字对齐，且避免「大类 · 大类」重复）；
      //   取不到才回落到旧的「大类 · 细分名」。
      const d = (this.data.t.presetDisplay || {})[p.presetKey];
      if (d) return { key: p.presetKey, name: d };
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

  // ===== R526 · `seats` 出参口（桌数/座位数已全部下线）=====
  //
  // 沿革：R237 曾把「用户填桌数」乘以「单桌座位数」折成引擎契约字段 `seats`（用于算翻台率）；
  //   R525 删掉座位数、R526 删掉桌数 —— 李老师定的是「翻台率按桌数算、和座位数没关系」，
  //   且本页不再讨论翻台率（R296 拍4 已停展示、R323 首页反推已改跳矩阵）。
  //
  // 现状核实：正向引擎**不使用** `seats`（`validate` 对 forward 也不校验）；反推引擎已无调用方；
  //   矩阵页走正向口径、代码里没有 seats。⇒ 这里恒返回 0，仅保留**单一定义点**：
  //   让 `seats:` 只有一处取值（A-⑧ 守卫仍生效，防止将来有人在这里临时塞一个算法）。
  bizKeyNow() {
    const bt = this.data.t.bizTypes[this.data.bizIdx];
    return (bt && bt.key) || 'fastfood';
  },
  /** 送引擎的 `seats`：恒 0（桌数/座位数输入已删除；正向不消费该字段）。 */
  seatsNow() { return 0; },
  /**
   * 🔴 #1 收口（round272b）：每月营业天数 —— **正向 / 反向共用同一份输入**。
   *   R361 起页面上不再有这一行（只读值已删），值恒为 30；底部假设卡仍展示该口径。
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
  // 🔴 R327：正推 —— 做到某个营业额，能赚多少。
  //   为什么补：M2 原先只有**倒推**（要赚 X 需要卖多少），老板紧接着会问「那我大概能做到 15 万，能赚多少」。
  //   两者是同一根公式的两端：
  //     倒推 营收 = (固定费用 + 目标利润) ÷ 边际贡献率
  //     正推 利润 = 营收 × 边际贡献率 − 固定费用
  //   🔴 不依赖 M1/M3（李老师 2026-10-18 划的边界）：只用引擎已返回的 fixed_total 与 margin_rate。
  //   🔴 以**保本线为基准**取 4 档，不预设"8万/10万/15万" —— 每个店保本线不同，绝对值档位对多数店无意义。
  // 🔴 R367（李老师 2026-10-19）：目标反推 —— 「想月赚 X，要怎么做」。
  //   口径**逐项核对过引擎**（cloudfunctions/calcSandbox/service.js:88-103）：
  //     F  = fixed_ex_amort + build_amort_monthly   ← 固定总额**含摊销**
  //     v  = (100 − 菜品毛利率) + Σ渠道/损耗费率    ← 变动费率
  //     m  = 1 − v/100 = (毛利率 − 渠道费率)/100
  //     保本 = F / m ；目标营收 = (F + 目标利润) / m ；利润(在营收 R) = R×m − F
  //   ⇒ 反推时**必须**：① 用含摊销的 F；② 把渠道费率加回毛利率（否则算出"偏低若干点"）；
  //     ③ 两个结论是**各自单算**的（只动这一项），不能叠加 —— 页面上明写。
  targetReverseOf(r, p) {
    if (!r || r.red_alert) return null;
    const T = this.data.t || {};
    const fill = (tpl, o) => String(tpl || '').replace(/\{(\w+)\}/g, (mm, k) => (o[k] == null ? '' : o[k]));
    // R411：走单源（同上）
    const money = (n) => MoneyFmt.groupDigits(Math.abs(n));
    const profitYuan = Number(this.data.targetYuan) || 0;
    const revYuan = Number(this.data.expectYuan) || 0;
    if (!(profitYuan > 0)) return { has: false, tip: T.tgtRevNeedTarget || '' };
    if (!(revYuan > 0)) return { has: false, tip: T.tgtRevNeedRevenue || '' };
    // ⚠️ 单位陷阱（实测）：`result.margin_rate` 是**字符串百分数** "63.0"（不是 0~1），
    //   `result.fixed_total` 也带千分位（"12,345.00"）⇒ 直接 Number() 会得到 63 或 NaN。
    const m = Number(String(r.margin_rate).replace(/,/g, '')) / 100;   // ⇒ 0.63
    const F = Number(String(r.fixed_total).replace(/,/g, ''));
    const plat = Number(r.platform_pct) || 0;   // 渠道+损耗等费率（%），已是百分数
    if (!(m > 0) || !isFinite(F)) return null;
    // 需要的菜品毛利率 = 100×(F+P)/R + 渠道费率
    const marginNeed = ((F + profitYuan) / revYuan) * 100 + plat;
    const marginNow = m * 100 + plat;           // 还原成"菜品毛利率"口径
    // 人工上限 = R×m − P − (固定总额 − 人工)
    const laborItem = ((p && p.fixed_items) || []).filter((x) => x.key === 'labor')[0];
    const laborNow = laborItem && isFinite(Number(laborItem.fen))
      ? Number(laborItem.fen) / 100
      : (Number(this.data.laborTotalYuan) || 0);
    const otherFixed = F - laborNow;
    const laborCap = revYuan * m - profitYuan - otherFixed;
    const r1 = (x) => Math.round(x * 10) / 10;
    const rows = [];
    // ⚠️ 毛利率上限就是 100%（零食材成本）—— 算出来 >100% 说明这个目标在当前营业额下**根本做不到**，
    //   不能把一个不可能的数当建议摆出去（实测：营收 3 万、目标 1 万、固定 2.35 万 ⇒ 需要 113.7%）。
    if (marginNeed >= 100) {
      rows.push({ key: 'margin', text: (T.tgtRevMarginImpossible || '') });
    } else {
      rows.push({ key: 'margin', text: fill(T.tgtRevMarginLine, { m: r1(marginNeed), n: r1(marginNow) }) });
    }
    // 人工上限 ≤ 0 时不编造数字：说明"光靠压人工做不到"
    if (laborCap > 0) {
      rows.push({ key: 'labor', text: fill(T.tgtRevLaborLine, { c: money(laborCap), n: money(laborNow) }) });
    } else {
      rows.push({ key: 'labor', text: (T.tgtRevLaborImpossible || '') });
    }
    return {
      has: true,
      title: fill(T.tgtRevTitle, { p: money(profitYuan) }),
      rows,
      note: fill(T.tgtRevNote, {}),
      revYuan, profitYuan,
    };
  },

  profitLadderOf(r) {
    if (!r || r.red_alert) return null;
    const fixed = Number(r.fixed_total);
    const ratePct = Number(r.margin_rate);
    const be = Number(r.break_even_monthly);
    if (!isFinite(fixed) || !isFinite(ratePct) || !isFinite(be)) return null;
    if (!(ratePct > 0) || !(be > 0)) return null;

    const T = this.data.t;
    const k = ratePct / 100;
    const fill = (tpl, v) => String(tpl || '').replace('{x}', v);
    // R411：走单源 —— 万的门槛与小数位不在页面写
    const money = (yuan) => MoneyFmt.formatYuan(yuan, { wanUnit: T.profitWan, yuanUnit: T.profitYuan });

    const mults = [0.8, 1, 1.2, 1.5];
    return mults.map((m) => {
      const rev = Math.round(be * m);
      const profit = Math.round(rev * k - fixed);
      const isBreak = m === 1;
      return {
        key: 'm' + String(m).replace('.', '_'),
        revText: money(rev),
        // 保本档直接说"刚好保本"，不显示 ±0 的噪声（rev 取整后 profit 可能是 1 或 -1）
        resultText: isBreak ? T.profitAtBreak
          : (profit > 0 ? fill(T.profitGain, money(profit)) : fill(T.profitLoss, money(profit))),
        gain: !isBreak && profit > 0,
        loss: !isBreak && profit < 0,
      };
    });
  },

  // 🔴 R330：做活动会怎样 —— 折扣 / 参与率 对毛利率与保本线的影响。
  //   公式见 utils/promoImpact.js（GA 有分母，豆包第一版漏了）。
  //   🔴 只算单价影响，不算活动带来的客流增长：算不了，编一个就是假精确。
  // 🔴 R350：活动力度只有**一个**出口 —— 实收率优先，没填才用折扣档。
  //   为什么不再问"你想做哪种活动"：满减/团购/代金券/第二份半价 全都能折成"每 100 元实收多少"，
  //   而每种的额外参数（满多少减多少、券面额、平台抽点）让界面翻倍、老板还得学。
  //   一个实收率入口覆盖所有可折算形态；赠品不在此列（它不产生营收，会破坏统一成本率前提）。
  // 🔴 R370（缩小为「保本门槛」）：只剩**一个实收率**输入，不再有折扣档 / 几成订单两组 chips。
  //   理由：折扣档本质是在替老板反推实收率，而他手上直接就有"实收 ÷ 原价"这个数；
  //   多一组 chips 就多一层"我选哪个"的困惑，而且还要解释"几成订单"的口径近似（已删那段近似说明）。
  //   三态返回：null = 还没填；false = 填了但越界；数字 = 合法实收率（0~1）。
  promoNetRateOf() {
    const raw = String(this.data.promoRealPct == null ? '' : this.data.promoRealPct).trim();
    if (raw === '') return null;
    const v = Number(raw);
    if (isFinite(v) && v > 0 && v <= 100) return v / 100;
    return false;
  },

  onPromoCostInput(e) {
    this.setData({ promoCostPct: e.detail.value }, () => {
      this.setData({ promoRes: this.promoOf(this.data.result) });
    });
  },

  onPromoRealInput(e) {
    this.setData({ promoRealPct: e.detail.value }, () => {
      this.setData({ promoRes: this.promoOf(this.data.result) });
    });
  },

  promoOf(r) {
    if (!r || r.red_alert) return null;
    const T = this.data.t;
    const fixed = Number(String(r.fixed_total).replace(/,/g, ''));
    // 🔴🔴 R370（李老师 2026-10-20）：「这个活动是**纯堂食**的，跟外卖没关系」。
    //   原来这里取 `r.margin_rate`——那是**扣过渠道佣金**的合并边际率
    //   （m = (毛利率 − 渠道费率)/100）⇒ 拿它算堂食活动，会把外卖抽成算成活动的代价，**高估伤害**。
    //   纯堂食活动的基准只能是**菜品毛利率**本身（菜单口径，不扣渠道）。
    const marginPct = Number(this.data.marginPct);
    if (!isFinite(fixed) || !isFinite(marginPct) || !(fixed > 0)) return null;

    const d = this.promoNetRateOf();
    // 没填 ⇒ 提示去填；填错 ⇒ 说清楚（两者不能混成一句话）
    if (d === null) return { empty: true, text: T.promoNeedCalc };
    if (d === false) return { bad: true, text: T.promoRealBad };

    const out = Promo.promoImpact({
      fixedYuan: fixed,
      marginPct,
      discount: d,
      weightPct: 100,                       // 🔴 R370：只填实收率 ⇒ 等价于全部流水都参与
      costRatePct: Number(this.data.promoCostPct) || 0,
    });
    // 让价超过毛利率 ⇒ 没有保本点。这是确定结论，必须说出来（不是"算不出"）。
    if (out.ok === false && out.reason === 'negativeMargin') return { bad: true, text: T.promoNegText };
    if (!out.ok) return null;

    const fill = (tpl, map) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (map[k] != null ? map[k] : m));
    // R411：走单源 + 精度统一到 1 位（原为 2 位 ⇒ 同一页上一张卡「1.2万」、这张「1.23万」，老板会当成两个数）
    const money = (yuan) => MoneyFmt.formatYuan(yuan, { wanUnit: T.profitWan, yuanUnit: T.profitYuan });

    // 🔴 R443c：把「多来 X%」换成老板的日常量 —— 客单价与营业天数本来就在页面上，不再额外问。
    //   口径：多来的**金额** ÷ 营业天数 ÷ 客单价；与 beAfter/beBefore 同一「原价流水」口径，不外推。
    //   缺客单价（或 ≤0）⇒ 整句不出现，绝不编一个"多来 N 位"。
    const priceNum = Number(this.data.avgPriceYuan);
    const dayNum = Number(this.data.openDaysNum) || 30;
    const headsPerDay = (priceNum > 0 && dayNum > 0)
      ? Math.round((out.beAfterYuan - out.beBeforeYuan) / dayNum / priceNum)
      : 0;

    return {
      bad: false,
      gaText: out.gaPct + '%',
      dropText: fill(T.promoDropText, { x: out.dropPctPoints }),
      // 🔴 R370：两个数都是**原价流水**口径；现金实收单列，避免再次混口径
      beText: fill(T.promoBeText, {
        a: money(out.beBeforeYuan), b: money(out.beAfterYuan),
        p: out.beIncreasePct, n: money(out.beAfterNetYuan),
      }),
      // 🔴 R443c：有客单价 ⇒ 同一行里补「每天多来几位」；没有 ⇒ 退回纯百分比（不编数、不增行）
      trafficText: headsPerDay > 0
        ? fill(T.promoTrafficTextHeads, { p: out.needTrafficPct, n: headsPerDay })
        : fill(T.promoTrafficText, { p: out.needTrafficPct }),
      // 🔴 R344：把活动卡接到正推表 —— 取「日常保本 × 1.2」当参照营业额，
      //   与正推表第 3 档完全同基准（老板可以两张表对着看）。
      //   ⚠️ 前提写死：**客流不变**。所以这里说的是「代价」，不是「活动一定亏」——
      //   多来的客人能补多少，看上面那行 trafficText。
      // 🔴 R371（M2 审计）：这一段里有两个**不同性质**的数，口径必须分开取：
      //   ① 差额 Δ = R×(G0 − ga)：活动让利花掉多少 —— 只与菜单毛利率有关，与渠道费率无关
      //      ⇒ 用菜单口径 marginPct / gaPct（若用 margin_rate 会把外卖佣金算成活动代价）。
      //   ② 绝对盈亏 = R×margin_rate − fixed：与主结果卡**完全同口径**（margin_rate 已扣渠道）。
      //   原来的错法：亏损支路用 `R×ga − fixed`（菜单口径 ga 配**全店** fixed）
      //      ⇒ 有外卖/团购的店亏损被低估，且与主卡两个利润数打架。
      sameRevText: (function () {
        const R = Math.round(out.beBeforeYuan * 1.2);
        const delta = R * ((marginPct - out.gaPct) / 100);
        const mr = Number(String(r.margin_rate).replace(/,/g, ''));
        const profitYes = R * (mr / 100) - fixed;
        if (!isFinite(delta) || !(delta > 0) || !isFinite(profitYes)) return '';
        if (profitYes > 0) return fill(T.promoSameRevWin, { r: money(R), d: money(delta) });
        return fill(T.promoSameRevLoss, { r: money(R), d: money(Math.abs(profitYes)) });
      }()),
      // 🔴 R375（接 R367 的目标反推）：老板真正的问题不是"要多卖多少"，而是
      //   **"做了这个活动，我想月赚 X 还能不能做到、要做到多少"**。
      //   口径（与 R367 同源、与活动期同基准）：
      //     所需原价流水 = (固定费用 + 目标利润) ÷ 原价口径边际贡献率
      //   分母必须用 `out.marginalOnGross`（每 1 元**原价**流水留下多少），
      //   不能用 gaPct —— ga 是**实收**口径，配"原价流水"会把门槛算小（R370 同族坑）。
      goalText: (function () {
        const tgt = Number(this.data.targetYuan) || 0;
        if (!(tgt > 0) || !(out.marginalOnGross > 0)) return '';
        const need = Math.round((fixed + tgt) / out.marginalOnGross);
        const now = Math.round((fixed + tgt) / (marginPct / 100));
        if (!isFinite(need) || !(need > 0)) return '';
        return fill(T.promoGoalText, { p: money(tgt), a: money(need), b: money(now) });
      }.call(this)),
    };
  },




  crowdOf(result) {
    if (!result || result.red_alert) return null;
    const price = Number(this.data.avgPriceYuan);
    // 🔴 R525：**不再要求座位数/桌数** —— 李老师 2026-10-27「这里不考虑翻台率这个事情。去了这个」。
    //   翻台率已从本页下线（不设输入、不展示、不派生），所以 crowd 只保留「每天得来多少人」，
    //   fail-closed 判据同步收窄为「人均消费 > 0」这一条（其余缺一个数就不出数，绝不编造）。
    if (!(price > 0)) return null;
    const bd = Number(result.break_even_daily);
    const td = Number(result.target_daily);
    if (!isFinite(bd) || !isFinite(td) || bd <= 0 || td <= 0) return null;
    const breakPeople = Math.ceil(bd / price);
    const targetPeople = Math.ceil(td / price);
    return {
      breakPeople,
      targetPeople,
      price: String(price),
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
      // 🔴 R525：连同「其他杂支」回到通用默认 2%（fieldTouched 一并复位，避免上一业态的手改值黏住）
      this.setData({ presetKey: 'other', presetName: this.data.t.presetNone, presetPicked: false,
        feeRows: [], feeOverrides: {}, bizIsOther: true,
        otherPctNum: '2', 'fieldTouched.otherPct': false });
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
        // 🔴 R525：'other' 的显示名统一成界面上那行输入的名字（其他杂支），
        //   否则同一笔钱上面叫「其他杂支」、下面折算行叫「杂支损耗」，老板会以为是两项。
        .map((m) => ({ key: m.itemKey, label: m.itemKey === 'other' ? this.data.t.otherVarLabel : (m.labelKey === 'costLoss' ? this.data.t.costLoss : (this.data.t.fixedItems[m.itemKey] || m.itemKey)), pct: String(m.pct) })),
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
    // 🔴 R525/R526：座位数与桌数输入均已删除 ⇒ 这里不再刷新任何座位口径（`seatsNow()` 恒 0）。
    //   改为刷新「其他杂支 %」（方案 B）：随预设带出参考值，但**用户手改过就不覆盖**
    //   （沿用 R294-C 的同一纪律，防止"我明明改成 0 了，一切业态又变回 2%"）。
    if (!this.data.fieldTouched.otherPct) {
      const om = (preset.costMeta || []).find((m) => m.form === 'revenue_rate' && m.itemKey === 'other');
      patch.otherPctNum = om ? String(om.pct) : '0';
    }
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
  // 🔴 R296 拍1/拍2/拍3 · D3-C：结构化固定成本输入（人工总额 / 水电合计 + 燃气 / 管理费）。
  onLaborTotal(e) { this.setData({ laborTotalYuan: e.detail.value }); this.scheduleCalc(); },
  onEnergy(e) { this.setData({ energyYuan: e.detail.value }); this.scheduleCalc(); },
  // 🔴 R543：分栏态两个处理器（与 onEnergy 同构，只换字段）
  onWater(e) { this.setData({ waterYuan: e.detail.value }); this.scheduleCalc(); },
  onElectric(e) { this.setData({ electricYuan: e.detail.value }); this.scheduleCalc(); },
  // 开关：切到合并态时**不清空**已填的水/电（切回来还要用），只是不再送参
  onToggleEnergyMerge(e) {
    this.setData({ energyMerged: !!(e.detail && e.detail.value) });
    this.scheduleCalc();
  },
  onGas(e) { this.setData({ gasYuan: e.detail.value }); this.scheduleCalc(); },
  onManage(e) { this.setData({ manageYuan: e.detail.value }); this.scheduleCalc(); },
  // ⚠️ 原 `onLaborUnit`（员工月均工资输入）已随输入框删除 —— 人工改「直接填总额」，
  //    `laborUnitYuan` 降级为内部兜底（由预设带出），无 UI、无 handler。
  // 🔴 R290：营业天数改为常量 30 ⇒ 原 `onOpenDays2` 输入 handler 随 UI 一并删除（不留孤立 handler）。
  // 🔴 R234-实测修复：`onPixelEff` / `onTurn` 已随输入区一并删除（坪效/翻台率是算出来的，不是填的）。
  //    留着 handler 会让人以为"UI 删了、逻辑还在"，下次加回输入框只要一行 —— 必须连根拔。
  // 🔴 R447：原 `onFeePct`（费率框输入 handler）已删 —— 它是 L3「专业参数」里费率框的接线上端，
  //    R441 删掉那块 UI 之后 wxml 零绑定，成了孤儿 handler。按 R234 同一纪律（`onLaborUnit` /
  //    `onTurn` 同款）：**只删 UI 不删 handler 会让人以为功能还在**，下一个加输入框的人只要一行就能
  //    把它接回来，而它写的是引擎入参覆盖（`feeOverrides`）—— 半接回来的后果是静默改口径。
  //    ⇒ 连根拔。要重新显示「≈ 每月多少钱」＝产品拍板（改 wxml），见 `review/AUTO_QUEUE.md` #47。
  // R442：展开/收起「更多分析」四张卡
  onToggleMore() { this.setData({ showMore: !this.data.showMore }); },

  onToggleL2() { this.setData({ showL2: !this.data.showL2 }); },

  // 🔴 R452（D 项，李老师拍板：「费率折算放回，但必须标『估算』」）：`refreshFeeAmt()` 恢复。
  //   沿革：R439 加 → R447 删（因 R441 删 L3 时把消费端 `fee-amt` 行一起删了 ⇒ 纯写不读）
  //   → R452 恢复（wxml 重新渲染）。
  //   🔴 口径边界（易错，勿改）：只折算 `form === 'revenue_rate'` 的项（`onPreset` 已过滤，
  //   现只有「其他/损耗」2%）⇒ 基数 = **预计月营业额**。
  //   **不含** utility / manage：那两项是「房租 × rentPct」派生（R293，见 utils/bizPreset.js），
  //   基数是房租不是营业额 ⇒ 若在这里一并折算，就是 R292 同族错（基数换错、数字照出、零报错）。
  //   🔴 只做显示、**不参与任何计算**（真正入引擎的仍是 pct；本方法不写 feeOverrides）。
  refreshFeeAmt() {
    const rows = this.data.feeRows || [];
    if (!rows.length) return;
    const raw = this.data.expectYuan;
    // 读不成就**不显示**（同 refreshFixedPreview 口径：宁可不显示，也不显示一个错算的数）
    const rev = AmountInput.classifyAmount(raw).readable ? Number(raw) : 0;
    let changed = false;
    const out = rows.map((r) => {
      const p = Number(r.pct);
      const ok = rev > 0 && isFinite(p) && p > 0;
      const txt = ok ? ('≈ ' + MoneyFmt.groupDigits(Math.round(rev * p / 100)) + ' ' + (this.data.t.feeAmtUnit || '')) : '';
      if (txt !== (r.amtText || '')) changed = true;
      return Object.assign({}, r, { amtText: txt });
    });
    // 无变化就不 setData，避免每次输入都整表重渲染
    if (changed) this.setData({ feeRows: out });
  },

  // 🔴 R443：输入区实时「每月固定支出合计」——让老板**边填边自查**，不用滚到结果区才知道总数。
  //   为什么值得加：结果区那份合计在页面很下面，填到一半时最容易漏项（尤其"人工忘了填"）。
  //   边界：**只做展示**、不参与任何计算（口径单源仍是 buildPresetParam）；任一栏读不成数字
  //   ⇒ **不显示**（宁可不显示，也不显示一个少算的数；原因由金额提示那行说明）。
  refreshFixedPreview() {
    const KEYS = ['rentYuan', 'laborTotalYuan', 'waterYuan', 'electricYuan', 'energyYuan', 'gasYuan', 'manageYuan'];
    let sum = 0;
    for (const k of KEYS) {
      const v = this.data[k];
      if (!AmountInput.classifyAmount(v).readable) { this.setData({ fixedPreviewText: '' }); return; }
      sum += Number(v) || 0;
    }
    const txt = sum > 0 ? ('≈ ' + MoneyFmt.groupDigits(sum) + ' ' + (this.data.t.feeAmtUnit || '')) : '';
    if (txt !== this.data.fixedPreviewText) this.setData({ fixedPreviewText: txt });
  },

  // 🔴 R443：顶部一行「还差哪几格」——只报对保本影响最大的三项（房租 / 人工 / 水电气），
  //   不铺成清单（页面已在做减法：R441 删 L3、R442 折叠四卡）。三项都填了 ⇒ 整行消失。
  //   边界：只提示、不拦计算（缺项仍能出数，改由结果区说明口径）。
  refreshMissing() {
    const d = this.data;
    const filled = (k) => {
      const v = d[k];
      return AmountInput.classifyAmount(v).readable && Number(v) > 0;
    };
    const miss = [];
    // 用**短标签**（房租 / 人工 / 水电气），不用输入项的提问式长标签：
    // 「还差：房租、人工、水电气」比「还差：每月房租多少钱、人工每月总额」读得下去。
    if (!filled('rentYuan')) miss.push(M.fixedItems.rent);
    if (!filled('laborTotalYuan')) miss.push(M.fixedItems.labor);
    if (!(filled('energyYuan') || filled('waterYuan') || filled('electricYuan') || filled('gasYuan'))) miss.push(M.fixedItems.utility);
    const txt = miss.length ? (d.t.missingPrefix + miss.join('、')) : '';
    if (txt !== d.missingHint) this.setData({ missingHint: txt });
  },

  onTogglePromo() { this.setData({ showPromo: !this.data.showPromo }); },
  onToggleAssumptions() { this.setData({ showAssumptions: !this.data.showAssumptions }); },

  // R234/J4：**通用「行内提示折叠」开关**（与月录入页 `subpkg/biz/month/input.js` 同一实现，
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
  // 🔴 R518：算完"这家店能不能开" → 去记"每月真实账"（M1 是付费主链路，也是这份测算的落地处）。
  //   M1 月度页不是 tab（tabBar「核算」指向首页 pages/index/index），故用 navigateTo 而非 switchTab，保留返回。
  onGoM1() { wx.navigateTo({ url: '/subpkg/biz/month/index' }); },

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

  // 🔴 R342：固定费用构成 —— 让老板能核对「这个保本点是怎么来的」。
  //   为什么必须做：结果区只给 fixed_total 一个总数，老板无法核对"这 2.16 万人工怎么来的"，
  //   尤其人工是被「人数 × 人均」估出来的时候 —— 这是信任问题，不是美观问题。
  //   🔴 做法与矩阵页同源：前端用 assembleItems 装配出的 fixedItems，与引擎返回的
  //   `fixed_ex_amort_fen`（不含摊销固定费用）对账；**差 >1 元就整块不显示**（fail-closed）。
  //   宁可不说，也不给一个和引擎对不上的拆项。
  // 🔴 R353：入参统一为**分**（与引擎 `fixed_ex_amort_fen` 同单位，直接比整数）。
  //   原实现签名是 engineYuan，却由调用方传入 `d.fixed_ex_amort_fen`（分）
  //   ⇒ `sumFen / 100（元）` 与 `eng（分）` 比，永远差 100 倍 ⇒ **永远 return null**
  //   ⇒ R342 的「固定费用拆项」上线后**从未显示过一次**（跑模拟器才发现）。
  //   教训：跨层传值先在边界统一单位，别让函数名替调用方做假设。
  fixedBreakOf(fixedItems, engineFen) {
    if (!Array.isArray(fixedItems) || !fixedItems.length) return null;
    const T = this.data.t;
    const byKey = {};
    let sumFen = 0;
    for (let i = 0; i < fixedItems.length; i++) {
      const f = Number(fixedItems[i] && fixedItems[i].fen) || 0;
      const k = fixedItems[i] && fixedItems[i].key;
      if (!k) continue;
      sumFen += f;
      byKey[k] = (byKey[k] || 0) + f;
    }
    const engFen = Number(engineFen);
    // 容差 100 分 = 1 元：四舍五入到分的累积误差允许，但单位错（差 100 倍）必然判红
    if (!(engFen > 0) || Math.abs(sumFen - engFen) > 100) return null;
    const order = ['rent', 'labor', 'utility', 'manage', 'other'];
    const rows = [];
    let used = 0;
    const push = (k) => {
      const fen = byKey[k] || 0;
      used += fen;
      rows.push({ key: k, name: (T.fixedItems && T.fixedItems[k]) || k, text: Math.round(fen / 100) });
    };
    for (let i = 0; i < order.length; i++) {
      if (byKey[order[i]]) push(order[i]);
    }
    // 参数包若长出别的 key（如新增费用项），不丢 —— 归入「其他固定」而不是静默漏掉
    if (sumFen - used > 0) {
      rows.push({ key: 'rest', name: (T.fixedItems && T.fixedItems.other) || TERMS.matrix.fixedBreakOther, text: Math.round((sumFen - used) / 100) });
    }
    return rows;
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
    // 🔴 R297 真漏洞修复：原写 `years: Number(r.years) || 1` ——
    //   用户清空年限 ⇒ 前端硬兜 **1 年** ⇒ 月摊销虚高 3 倍（equip 5 倍）⇒ 保本点/目标营收虚高，
    //   且**零报错**（静默错账）；同时把云端 `BUILD_DEFAULT_YEARS` 单源兜底架空成死代码。
    //   现改走 `buildYearsOf`：空/非法 ⇒ 回落云端同口径默认值（transfer/decor/franchise/other=3、equip=5）。
    const userBuild = this.data.buildRows
      .filter((r) => api.yuanToFen(r.yuan) > 0)
      .map((r) => {
        const item = { key: r.key, fen: api.yuanToFen(r.yuan), years: buildYearsOf(r.key, r.years) };
        // ⚠️ `years === undefined`（key 不在白名单）时**必须删键**，别留 undefined ——
        //    留着会被序列化成 null 或直接丢键，行为取决于通道；删键 ⇒ 云端明确走单源兜底。
        if (item.years === undefined) delete item.years;
        return item;
      });
    const input = {
      area: Number(this.data.areaNum) || 0,
      headcount: Number(this.data.headcountNum) || 0,
      // 🔴 R296 拍1：人工**直接填总额**（laborTotalYuan）；`laborUnitYuan` 降级为兜底
      //   （用户没填总额时按「人数 × 该值 × 城市系数」估，避免人工=0 乐观化保本点）。
      laborTotalYuan: Number(this.data.laborTotalYuan) || 0,
      laborUnitYuan: Number(this.data.laborUnitYuan) || 0,
      rentYuan: Number(this.data.rentYuan) || 0,
      // 🔴 R543：这里先按合并态写 energyYuan，紧接着按开关改写/删键（见下方 if 块）。
      //   装配层判据是 `in_.energyYuan != null ? 用它 : water + electric` —— **送 0 会被当成"已填合计"**
      //   ⇒ 分栏态必须把 energyYuan 键**删掉**，否则水费电费被抹成 0（静默少算固定成本）。
      energyYuan: Number(this.data.energyYuan) || 0,
      gasYuan: Number(this.data.gasYuan) || 0,
      // 🔴 R219 口径（两道防线之一·装配层）：反推模式下 `fixed_items` **不得含 rent**。
      //    房租在此处是**求解目标**，把它当已知固定成本喂进去会**重复计租**。
      // 🔴 R296 拍2：**正向**的 `fixedYuan` **必须带 `manage` 键**（值可为空/0）——
      //    `fixed_opt` 以「键是否存在」判"用户是否作答"：键在（含 ''/0）⇒ 不评；键缺（找店/矩阵不传）⇒ 走兜底。
      //    反推模式给 `{}`（键缺）⇒ 管理费走「房租×占比」参考值（找店小白友好）。
      fixedYuan: isReverse ? {} : { rent: this.data.rentYuan, manage: this.data.manageYuan },
      buildItems: userBuild,
    };
    // 🔴 R543：水电两套填法 → 一套入参。装配层（utils/bizPreset.js）零改动。
    if (this.data.energyMerged) {
      delete input.waterYuan;
      delete input.electricYuan;
    } else {
      input.waterYuan = Number(this.data.waterYuan) || 0;
      input.electricYuan = Number(this.data.electricYuan) || 0;
      delete input.energyYuan;
    }
    const asm = assembleItems(preset, input, coef);
    // 第二道防线：装配产物里再滤一次（将来参数包长出别的形态也不会漏）
    const fixedItems = isReverse ? asm.fixedItems.filter((x) => x.key !== 'rent') : asm.fixedItems;
    const fo = this.data.feeOverrides || {};
    // 🔴 R525（方案 B）：覆盖值允许 0（= 老板明确「这项不算」）⇒ 0 直接从入参里剔除，
    //   不留一条 `pct:0` 的噪声项；非数字/负数一律按原预设走（不静默改口径）。
    const varItemsFinal = asm.varItems.map((v) => {
      if (fo[v.key] == null || fo[v.key] === '') return v;
      const p = Number(fo[v.key]);
      if (!isFinite(p) || p < 0) return v;
      return p > 0 ? { key: v.key, pct: p } : null;
    }).filter(Boolean);
    // 🔴 R296b：**渠道佣金**并入挂钩费率（占**总流水**%）。老板只填「占比 × 抽点」，此处取加权结果。
    //   ⚠️ 与 costMeta 的 var 项（如"其他=2%损耗"）**键不重叠**（此处只用 takeawayComm/grouponComm/cardFee）⇒ 不重复计。
    const cm = this.data.channel || {};
    if (cm.on) {
      const addComm = (k, p) => { const n = Number(p) || 0; if (n > 0) varItemsFinal.push({ key: k, pct: n }); };
      addComm('takeawayComm', cm.takeawayComm);
      addComm('grouponComm', cm.grouponComm);
      addComm('cardFee', cm.cardFee);
    }
    const buildItems = resolveBuild(preset, input);
    const openDays = (this.data.openDaysNum && this.data.openDaysNum !== '') ? Number(this.data.openDaysNum)
      : (preset.params && preset.params.openDays ? preset.params.openDays.v : 30);
    // 🔴 R526：`seats` 恒 0（桌数/座位数输入已删）。正向引擎不读它、validate 对 forward 不校验它；
    //   反推引擎已无调用方 ⇒ 这里只是保留契约字段。
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
      // 🔴 R526：`seats` 唯一出参口（恒 0）—— 桌数/座位数输入已删，详见 `seatsNow()` 注释。
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
  // 🔴 R297 第三轮：送云前体检（口径与云端 calcSandbox / savePlan 一致，但给**人话**）
  //   云端虽然也会拒（calcSandbox 单算路径一直有校验、savePlan 本轮补齐），
  //   但 `utils/api.js` 会把 fail 的 msg 覆盖成通用文案（R271）⇒ 老板只看到"出错了"、不知改哪一格。
  //   这里当场指出"哪一格、超了什么范围"。**只拦越界，不替老板改数**。
  badParamOf(p) {
    const g = Number(p.gross_margin_pct);
    if (!isFinite(g) || g < 0 || g > 100) return `毛利率要在 0~100（现在填了 ${p.gross_margin_pct}）`;
    const badFen = (arr) => (arr || []).find((it) => !isFinite(Number(it.fen)) || Number(it.fen) < 0);
    const b1 = badFen(p.fixed_items);
    if (b1) return `「${b1.key}」的金额不能为负`;
    const b2 = badFen(p.build_items);
    if (b2) return `「${b2.key}」的建店投入不能为负`;
    const badVar = (p.var_items || []).find((it) => !isFinite(Number(it.pct)) || Number(it.pct) < 0 || Number(it.pct) > 100);
    if (badVar) return `「${badVar.key}」的比例要在 0~100（现在填了 ${badVar.pct}）`;
    if (!isFinite(Number(p.target_profit_fen)) || Number(p.target_profit_fen) < 0) return '目标月利润不能为负';
    return '';
  },

  async onCalcPresetFwd() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const seq = ++this._seq;
    const p = this.buildPresetParam('forward');
    const bad = this.badParamOf(p);
    if (bad) { api.toastError({ msg: bad }); return; }
    const payload = {
      city_tier: p.city_tier, biz_type: p.biz_type,
      build_items: p.build_items, fixed_items: p.fixed_items, var_items: p.var_items,
      gross_margin_pct: p.gross_margin_pct, target_profit_fen: p.target_profit_fen,
      expected_revenue_fen: p.expected_revenue_fen,
      rev_price_fen: p.rev_price_fen, seats: p.seats, open_days: p.open_days,
      target_rent_rate: p.target_rent_rate, pixel_eff_fen: p.pixel_eff_fen,
      // 🔴 R297 第四轮（M2 整体审计 B3）：本 payload 原**漏传 `valid_days`** ⇒ 云端
      //   `service.js` 回落 30 天，与「敏感度」(buildForwardPayload) 和「保存后重算」
      //   (param_json) 三条入口口径不同源。当前被「营业天数恒 30」掩盖，一旦放开即分叉。
      valid_days: p.valid_days,
      client_request_id: 'sb_' + Date.now(),
    };
    try {
      const d = await api.call('calcSandbox', payload);
      if (seq !== this._seq) return;
      const fen = (v) => (v == null ? null : api.fenToYuan(v, 2));
      // 🔴 D1+D2（2026-10-27 拍板 + 豆包实现咨询确认）：房租或人工没填（装配后分=0）⇒ 整块不出数（fail-closed）。
      //   原 `p.fixed_items.length > 0` 恒真（rent/labor 总会 push 一个 0 分条目）⇒ 空表单照样出保本 5556、人工 0% 判绿。
      //   改为按装配后的实际分：房租分 >0 且 人工分 >0 才出数；否则结果区整块换引导语、不显示任何数字、不给参考值（豆包 Q1=A / Q2=不给参考值）。
      const rentFen = (p.fixed_items || []).reduce((s, x) => s + (x.key === 'rent' ? Number(x.fen) || 0 : 0), 0);
      const laborFen = (p.fixed_items || []).reduce((s, x) => s + (x.key === 'labor' ? Number(x.fen) || 0 : 0), 0);
      const hasFixed = rentFen > 0 && laborFen > 0;
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
      // 🔴 R338：安全垫 —— 与 M1 同一条算式（(营收 − 保本) ÷ 营收 × 100，一位小数）。
      //   为什么不直接用 target/break 的字符串：`fen()` 返回的是展示串，拿来算会带入格式化误差。
      const _beFen = Number(d.break_even_monthly_fen) || 0;
      const _tgFen = Number(d.target_monthly_fen) || 0;
      const _cushion = (_beFen > 0 && _tgFen > 0)
        ? Math.round(((_tgFen - _beFen) * 1000) / _tgFen) / 10
        : null;
      // 目标利润=0 ⇒ 目标营收 = 保本营收 ⇒ 安全垫恒为 0。
      // 🔴 这时显示「保本线」而不是「0%」：0% 会让老板以为系统算坏了（0% 是"一跌就亏"的意思，
      //   但真实语义是"你填的目标就是保本线"）。
      const _cushionText = _cushion == null ? ''
        : (Math.abs(_cushion) < 0.05
          ? TERMS.matrix.cushionBreakEven
          : String(TERMS.card.beMarginDrop || '').replace('{p}', String(_cushion)));

      // 🔴 R340：目标利润没填 ⇒ 引擎让 target_monthly = break_even_monthly（同一个数）。
      //   两行并排显示会让老板以为系统算错了（"我要的目标怎么等于保本"）。
      //   ⚠️ 判据必须用**目标利润**（yuanToFen(targetYuan) > 0），不能用 target_monthly > 0 —
      //     后者只要固定费用 > 0 就恒真，判了等于没判。
      const _hasTarget = api.yuanToFen(this.data.targetYuan) > 0;

      // 🔴 R343：现金保本（不含摊销）—— 调 utils/bizPreset.js::cashBreakeven，
      //   与矩阵页**同一个函数**。无摊销时它返回 null，页面只显示一行（两个数相同没意义）。
      const _beCash = cashBreakeven(
        Number(d.break_even_monthly_fen) / 100, d.fixed_ex_amort_fen, d.fixed_total_fen);

      const presetResultObj = !hasFixed ? null : {
        has_target: _hasTarget,
        break_even_cash: _beCash == null ? null : String(_beCash),
        cushion_pct: _cushion,
        cushion_text: _cushionText,
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
      // 🔴 D8（2026-10-27 拍板）：结果区派生项标注。本 handler 仅 forward，管理费键恒在 fixedYuan ⇒ 永不被派生；
      //   只有水电合计 + 燃气都为空时 utility 才走「房租 × 占比」派生。派生项名取自 M.fixedItems（与 fixedBreak 同源），
      //   来源文案走 terms 双副本（K11 守卫），绝不在 JS 里硬编码中文。
      const _derivedKeys = [];
      const _en = this.data.energyMerged
        ? (Number(this.data.energyYuan) || 0)
        : ((Number(this.data.waterYuan) || 0) + (Number(this.data.electricYuan) || 0));
      const _g = Number(this.data.gasYuan) || 0;
      if (_en + _g === 0) _derivedKeys.push('utility');
      const _derivedNote = _derivedKeys.length
        ? (M.derivedNotePrefix + _derivedKeys.map((k) => (M.fixedItems && M.fixedItems[k]) || k).join('、') + M.derivedNoteSuffix)
        : '';
      this.setData({
        // R234：`bands_preview` **原样留存** —— `rentRateDefault()` 要从这里取 rent.hi，
        //      若只留 decorate 后的 `bands`（只剩拼好的字串），就再也拿不到原始数值了。
        bandsRaw: d.bands_preview || [],
        bandsRawKey: this.bandsKeyNow(),
        bands: this.decorateBands(d.bands_preview || [], amt),
        marginBand: this.pickBand(d.bands_preview, 'grossMargin'),
        verdict: !hasFixed ? null : this.verdictOf(indTarget),
        result: presetResultObj,
        // 🔴 R395：分享卡片取数 —— 只留原始分（展示串 `break_even_monthly` 已 toFixed，反解会带误差）
        shareFacts: { ready: !!presetResultObj, breakEvenFen: Number(d.break_even_monthly_fen) || 0 },        // 🔴 R327：正推表 —— 与 result 同批写入，直接用局部变量算（不读 this.data，避免时序依赖）
        profitLadder: this.profitLadderOf(presetResultObj),
        // 🔴 R367：目标反推（想月赚 X 要怎么做）
        targetReverse: this.targetReverseOf(presetResultObj, p),
        promoRes: this.promoOf(presetResultObj),
        // 🔴 R342：与 result 同批写入，直接用局部变量 p（不读 this.data，避免时序依赖）
        fixedBreak: this.fixedBreakOf(p.fixed_items, d.fixed_ex_amort_fen),
        // 🔴 D8：派生项标注（水电气等按行业估算时明示来源，避免"系统悄悄改了老板填的数"）
        derivedNote: _derivedNote,
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
      if (e.code === 'M2_RED_ALERT') {
        this.setData({ loading: false, result: { red_alert: true }, calcError: '', shareFacts: null });
        return;
      }
      // 🔴 R359（与 R358 同族）：本次**没算出来** ⇒ 必须把上一次的结果整套清掉。
      //   原来只 `setData({ loading:false })` + calcError ⇒ 屏幕上留着旧数字
      //   （结果卡条件只判 `result && !result.red_alert`，它照样渲染），
      //   而老板刚改过输入 ⇒ 极易把旧数当新结果（静默错账，方向还是"看着挺好"）。
      //   ⚠️ **派生状态一个都不能漏**：漏一个就会出现「保本数没了、指标条还挂着」的自相矛盾，
      //      所以这里按「成功时写入过什么」逐项清回去（见下方 setData 的同一批键）。
      this.setData({
        loading: false,
        calcError: e.msg || '',
        result: null,
        // 🔴 R395：分享取数必须跟着清 —— 否则「保本数已经没了，分享出去还在说旧保本线」（静默错账同族）
        shareFacts: null,
        bands: [],
        bandsRaw: [],
        marginBand: '',
        verdict: null,
        profitLadder: null,
        promoRes: null,
        fixedBreak: null,
        // 🔴 D8：派生项标注必须跟着清，否则"派生项变了但旧标注还挂着"会误导老板
        derivedNote: '',
        crowd: null,
        eff: null,
        indicators: [],
        payback: null,
        presetAssumptions: [],
        targetReverse: null,
      });
      // 🔴 R359b（真机/模拟器行为核验才抓到）：吸底条 `stickKpi/stickLbl/stickVal` 是
      //   `result` 的**缓存副本**（`refreshStick()` 里由 result 派生），成功分支才刷新它。
      //   ⇒ 结果区已清空、底部却还挂着上一次的「保本营业额 ¥5,555.56」，比不清更糟（自相矛盾）。
      //   ✅ 不在 catch 里手写第二份清空逻辑，而是**按单一来源重算**：result 已为 null ⇒ 条自会隐藏。
      this.refreshStick();
      api.toastError(e);
    }
  },

  // 🔴 R296-E（P2 死代码清理）：`onCalcPresetRev` 整方法已删 —— 首页 mode 恒为 forward
  //   （onMode('reverse') 直接跳矩阵页），且 onCalc 内的 reverse 分派已改为恒走 forward，
  //   故本方法自 R290 起不可达。反推计算现完全由 matrix 页承载（buildClean → assembleItems
  //   → 云函数批量算），与首页无耦合；`seatsNow`（恒 0 的契约出参口）/`validDaysNow` 仍被上方共用，保留。



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

  /**
   * 🔴 R395（队列 #11）：分享卡片 —— 标题带本次算出的**保本营业额**。
   *
   * 为什么：开店测算最常见的传播场景就是「我把这个数发给合伙人/家人看看」，
   *   不自定义标题时微信只显示小程序名 ⇒ 对方不知道这张卡片里是什么结论。
   * 为什么只认 `shareFacts.ready`：`result` 在 red_alert / 计算失败时会变成空壳，
   *   拿空壳去拼标题会说出「要卖到 0 元才保本」这种假话（本仓最忌讳的静默错账）。
   */
  onShareAppMessage() {
    return shareCard.m2Share(this.data.shareFacts || {});
  },
});
