// subpkg/biz/card/edit.js —— M3 成本卡新建 / 编辑（另存新版本）+ 反算售价 + 批次 P0 补全
//
// ⚠️ 计算下沉：本页**不做任何金额/成本/反算计算**。
//   · 保存 → saveCostCard（后端内嵌引擎算 total_cost 落库）
//   · 反算售价 / 预览成本 → calcBom（纯计算云函数，返回 reverse_price_fen / unit_cost_fen）
// ⚠️ 批次 P0（任务 3）补全：① 明细行临时手工录入（input_type=2，仅本卡生效）；
//   ② 分类 + 标签字段；③ 活动特价（第二条毛利率）；④ 售价低于成本预警；⑤ 反算结果填入建议售价。
//   · 手工行净料单位成本（万分）= round(单价元 × 10000 ÷ (出成率/100))，前端算一次（录入换算），
//     保存传 net_unit_cost 快照、反算传同一值 —— 单源，不做第二份真相源。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const units = require('../../../utils/units.js');
const CardPaste = require('../../../utils/cardPaste.js');
const AmountInput = require('../../../utils/amountInput.js');
const dh = require('../../../utils/dataHealth.js');   // R628：判列表是否被截断（数据不全就不给排名）   // R426（队列 #32）：金额栏体检（纯判定，不改数）
const { openPaywall } = require('../../../utils/paywall.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const { TEMPLATES, TEMPLATE_CATS, templatesByCat, applyTemplate, yieldOf, matchTemplateByName, suggestTemplates } = require('../../../utils/dishTemplates.js');
// 🔴 R678：组件类型（主料/辅料/调料）自动推断 —— 老板不用每行手点
const { inferLineKind, isUnset } = require('../../../utils/lineKind.js');   // M3.20/R671 菜品模板（只预填，不写库）
// 🔴 R675：品类预设（CATEGORY_PRESETS / CONDIMENT_NAME / ENERGY_NAME）在编辑页**不再引用**。
//   文件本身保留 —— 导入 Excel（import.js / dishImport.js）还在用它识别菜品分类。
// 🔴 R644（会审 R637）：金额化单源 —— 把「毛利率 18%」变成「每卖一份亏 1.2 元」
const { moneyHint } = require('../../../utils/moneyHint.js');
// 🔴 R566：批量导入草稿的映射与暂存键（单源）—— 本页只消费，不自己拼字段名/键名
const DI = require('../../../utils/dishImport.js');
const ss = require('../../../utils/shopSwitcher.js');   // R720：本地缓存 key 按店隔离（单源 shopKey）
const DRAFT_PREFILL_KEY = DI.DRAFT_PREFILL_KEY;
// 🔴 R675：`isEstimatedCard` 不再引入 —— 估算卡机制随品类默认模板一起删了，编辑页不再产生 isPreset 行。
//   utils/cardEst.js 本身保留（导入路径 dishImport.js 仍在用）。

// 本店填过的菜品分类（本地记忆，供下次点选；不新建集合、不上云 —— M3 v1.1 零新建集合红线）
const EDIT_CATS_KEY = 'm3_dish_cats';
// R666：分类候选的脏值判定（纯函数，便于真跑判据）
const catFilter = require('../../../utils/categoryFilter.js');
// 🔴 P0#7：新手/专业模式（与 M1 录入页同形）—— 本地记忆、按 shop 区分、换设备回默认
const INPUT_MODE_KEY = 'card_input_mode_';

// 明细行空行工厂（档案行）
// round149：新增 `qty_unit`（用量单位，枚举见 utils/units.js）+ `spec_hint`（该原料的换算说明）。
//   两者都是**本页展示/录入层**的东西 —— 提交给云端时 qty 一律换算成基准单位(克)，
//   ⚠️ 不新增云函数字段、不改快照契约、不碰引擎（红线段）。
// round150：新增 `line_kind`（组件类型，M3.14）—— 它**要**上云（是规格缩放的唯一依据）。
function emptyLine() { return ensureRid({ input_type: 1, material_id: '', material_name: '', qty: '', qty_unit: units.BASE_UNIT, spec_hint: '', line_kind: 'main' }); }
// 手工行工厂
// round151：新增 `price_unit`（**单价单位**，读作「元/X」）。改前单价恒被读作「元/克」——
//   老板买 6 元/斤的肉，得自己心算成 0.012 才敢填。现在选「斤」直接填 6，
//   提交前由 `units.priceToBase` 折算回元/克（折算只发生在录入层）。
function emptyManualLine() { return ensureRid({ input_type: 2, material_id: '', material_name: '', qty: '', qty_unit: units.BASE_UNIT, price_unit: units.BASE_UNIT, spec_hint: '', unit_warn: '', unit_price_yuan: '', yield_rate: '100', line_kind: 'main' }); }

// round156：规格行的「全新空态」工厂。抽成函数是为了让 data 初始化与「连续录入重置」共用**同一份**定义
//   —— 否则第二处手抄一遍，将来加一个规格键就会漏掉一处（抄一份必漂）。
function freshSpecRows() {
  return Object.keys(TERMS.card.specLabel).map((k) => ({
    spec_key: k, name: TERMS.card.specLabel[k], enabled: false, priceYuan: '', result: null,
    // 🔴 R547（M1）：「每100g」的**这一份多少克**（只有这个规格用；其它规格恒空）。
    //   没有它就算不出 100g 的成本 —— 而按"整份算"正是本缺陷（毛利率 11.76% vs 真值 82.35%）。
    portionG: '',
  }));
}

// R606-bis：行为行级可编辑循环提供**稳定身份键**（不随数组重排/重赋值而漂），
// 原生 <input> 用下标复用 DOM 会导致「框填不进/丢焦点」。镜像 month/input.js 写法。
const _ridPrefix = 'k' + Date.now().toString(36) + '_';
let _ridSeq = 0;
function ensureRid(r) {
  if (!r) r = {};
  if (!r.rid) r.rid = _ridPrefix + (_ridSeq++).toString(36);
  return r;
}

function renumber(lines) {
  return lines.map((l, i) => Object.assign({}, l, {
    idx: i,
    // R606-bis：注入**稳定身份键**（不随数组重排/重赋值而漂）。原生 <input> 按下标复用 DOM
    // ⇒ 位置键会在每次按键整体重赋值后错位，表现为「框填不进/丢焦点」。rid 为渲染层专用键，
    // 提交给云端时由 doSave/buildCalcLines 重建干净 payload（不含 rid），不影响契约。
    rid: l.rid || (_ridPrefix + (_ridSeq++).toString(36)),
    // 🔴 R297-⑥（审计 M3-B8）：**单位选择器的当前值必须由数据驱动**。
    //   本页三个单位 picker 原先都没绑 `value`，而 `<picker mode="selector">` 缺省 value=0
    //   ⇒ 打开时高亮**永远停在第一项「克」**，与行上真正的单位不符。
    //   用户为了"看一眼当前值"点开、再直接按确定 ⇒ `detail.value = 0` ⇒ 单位被静默改成「克」。
    //   单价那条尤其危险：`onManualPriceUnit` **故意不做数值换算**（保住老板敲的那个数，见其注释），
    //   于是「6 元/斤」摇身变成「6 元/克」⇒ **成本放大 1000 倍、零提示**。
    //   ⚠️ 不能写在 WXML 里：WXML 表达式**不支持方法调用**（`subpkg/biz/material/index.js:139` 已有同款注释），
    //      故下标在 js 侧算好。挂 `renumber` 是因为它是**所有行变更的公共出口** ⇒
    //      新增 / 回填 / 换单位三条路径自动全覆盖，不必在 6 处调用点各补一次（抄多份必漂）。
    qtyUnitIdx: Math.max(0, units.QTY_UNITS.indexOf(l.qty_unit || units.BASE_UNIT)),
    priceUnitIdx: Math.max(0, units.QTY_UNITS.indexOf(l.price_unit || units.BASE_UNIT)),
  }));
}

// 手工行净料单位成本（万分）：round(单价元/基准单位 × 10000 ÷ (出成率/100))
//   round151：加第三参 `priceUnit` —— 单价先折算到基准单位（元/克）再进这条**既有公式**。
//   ⚠️ 公式本体一字不改（引擎口径）；折算只发生在录入层，云端契约与快照格式零改动。
//
// 🔴🔴 R297 真漏洞修复：出成率改走 `units.yieldRateOf`（唯一入口，**带 (0,100] 上界**）。
//   原 `Number(yieldRate) || 100` 只兜 0/NaN，**没有上界** ⇒ 老板填 150 ⇒ 成本被 ÷1.5
//   ⇒ 毛利虚高，且**零报错**（云端只收 net_unit_cost 快照，那条 (0,100] 校验永远走不到）。
//   现在：非法/越界 ⇒ `yieldRateOf` 返回 null ⇒ 本函数返回 0 ⇒ 调用方**响亮提示**（不静默编数）。
// 🔴 R566：本函数**已收归** `utils/units.js::netUnitWanOf` —— 批量导入页也要把草稿行换成同一快照，
//   若留在页面里就会长出第二份公式（成本口径分叉最贵）。此处只保留别名，调用点不动。
const manualNetUnitWan = units.netUnitWanOf;

// 组件类型 line_kind 白名单（与 cloudfunctions 各函数 common 模块的 LINE_KINDS 同源；服务端只认这 5 类，
//   非法的「调料(含油盐酱醋)/燃气燃料分摊」等语义标签会被 saveCostCard/calcBom 硬拒）。
//   ⚠️ 2026-10-29 修复：P0-2 把 condiment 行写成 `line_kind:'condiment'`，真实保存/试算会触发
//   「明细行 line_kind 非法」——这里统一兜底成 'main'（单份成本计算与 line_kind 无关，只影响规格缩放）。
function normalizeKind(k) {
  const KINDS = ['main', 'aux', 'season', 'semi', 'pack'];
  return (typeof k === 'string' && KINDS.indexOf(k) >= 0) ? k : 'main';
}

Page({
  data: {
    // R692：售价预填的来源提示（空串 = 非预填，不显示）
    prefillPriceNote: '',
    // 🔴 R704：保存后横幅上那个出口的文案 —— 按来源变（见 onLoad 的 from_draft 分支）。
    //   默认「返回列表」；从导入页进来时它是**回导入页**，文案得如实说。
    backLabel: TERMS.card.backToList,
    // 🔴 R708：补价模式（从批量导入「去补价」进来）。草稿已带菜名/售价/示例主料/出成率，
    //   老板唯一要做的事就是补单价 ⇒ 本页默认只留 菜名 + 原料行 + 售价 + 保存。
    //   `patchMode` = 来源标记（onLoad 按 from_draft 置位，之后不变）；
    //   `patchFull` = 老板主动点「展开完整设置」（逃生口，随时能看全）。
    //   ⇒ `lean = patchMode && !patchFull` 才是「现在就精简」。
    patchMode: false,
    patchFull: false,
    lean: false,
    t: {
      dishName: TERMS.card.dishName,
      secBasic: TERMS.card.secBasic,
      secCost: TERMS.card.secCost,
      secPrice: TERMS.card.secPrice,
      grossMargin: TERMS.card.grossMargin,
      stickyRecalc: TERMS.card.stickyRecalc,
      stickyEmpty: TERMS.card.stickyEmpty,
      needLineForCalc: TERMS.card.needLineForCalc,
      stickyLast: TERMS.card.stickyLast,
    stickyStale: TERMS.card.stickyStale,
      saveShort: TERMS.card.saveShort,
    savingNow: TERMS.card.savingNow,
      dishNamePh: TERMS.card.dishNamePh,
      calcMode: TERMS.card.calcMode,
      calcModeA: TERMS.card.calcModeA,
      calcModeB: TERMS.card.calcModeB,
      batchOutput: TERMS.card.batchOutput,
      batchHint: TERMS.card.batchHint,
      lossRate: TERMS.card.lossRate,
      auxAmount: TERMS.card.auxAmount,
      price: TERMS.card.price,
      material: TERMS.card.material,
      qty: TERMS.card.qty,
      addLine: TERMS.card.addLine,
      // R693：两个概念的人话解释（新手模式才显示）
      yieldExplain: TERMS.card.yieldExplain,
      lossExplain: TERMS.card.lossExplain,
      pasteTitle: TERMS.card.pasteTitle,
      pasteHint: TERMS.card.pasteHint,
      pastePlaceholder: TERMS.card.pastePlaceholder,
      pasteParseBtn: TERMS.card.pasteParseBtn,
      pasteImportBtn: TERMS.card.pasteImportBtn,
      // 🔴 R675：catFrom / catPickPh / catHint / catClear 四条映射已删 ——
      //   它们对应的 wxml 元素（品类默认模板）整块删掉了，留着就是「映射到不存在的界面」。
      estRowTag: TERMS.card.estRowTag,
      estCardHint: TERMS.card.estCardHint,
      save: TERMS.card.save,
      reverseTitle: TERMS.card.reverseTitle,
      reverseHint: TERMS.card.reverseHint,
      targetMargin: TERMS.card.targetMargin,
      reverseResult: TERMS.card.reverseResult,
      totalCost: TERMS.card.totalCost,
      cur: '¥',
      cancel: TERMS.buttons.cancel,
      loading: TERMS.ui.loading,
      copyVersion: TERMS.card.copyVersion,
      // 批次 P0（任务 3）
      inputType: TERMS.card.inputType,
      inputTypeArchive: TERMS.card.inputTypeArchive,
      inputTypeManual: TERMS.card.inputTypeManual,
      // round153：删行按钮文案（挪到明细行末尾后的新语义）
      delLine: TERMS.card.delLine,
      manualName: TERMS.card.manualName,
      manualNamePh: TERMS.card.manualNamePh,
      manualUnitPrice: TERMS.card.manualUnitPrice,
      manualYield: TERMS.card.manualYield,
      activityPrice: TERMS.card.activityPrice,
      activityPriceHint: TERMS.card.activityPriceHint,
      warnPriceBelowCost: TERMS.card.warnPriceBelowCost,
      reverseApply: TERMS.card.reverseApply,
      // 🔴 P0#7：反算前置说明 + 新手/专业模式（wxml 用到就必须登记）
      reversePre: TERMS.card.reversePre,
      inputModeTitle: TERMS.card.inputModeTitle,
      inputModeNovice: TERMS.card.inputModeNovice,
      inputModeNoviceDesc: TERMS.card.inputModeNoviceDesc,
      inputModePro: TERMS.card.inputModePro,
      inputModeProDesc: TERMS.card.inputModeProDesc,
      expandProBtn: TERMS.card.expandProBtn,
      leanTitle: TERMS.card.leanTitle,
      leanDesc: TERMS.card.leanDesc,
      leanFullBtn: TERMS.card.leanFullBtn,
      leanFoldBtn: TERMS.card.leanFoldBtn,
      noviceTip: TERMS.card.noviceTip,
      category: TERMS.card.category,
      categoryPh: TERMS.card.categoryPh,
      categoryHint: TERMS.card.categoryHint,
      tagsPh: TERMS.card.tagsPh,
      tagsHint: TERMS.card.tagsHint,
      materialArchive: TERMS.card.materialListTitle,
      tags: TERMS.card.tags,
      qtyUnit: TERMS.card.qtyUnit,
      qtyUnitHint: TERMS.card.qtyUnitHint,
      matSpecHintEmpty: TERMS.card.matSpecHintEmpty,
    priceMainCap: TERMS.card.priceMainCap,
      // round150（M3.14/M3.15）
      lineKindTitle: TERMS.card.lineKindTitle,
      lineKindHint: TERMS.card.lineKindHint,
      specTitle: TERMS.card.specTitle,
      specHint: TERMS.card.specHint,
      specEnable: TERMS.card.specEnable,
      specPriceLabel: TERMS.card.specPriceLabel,
      specCostLabel: TERMS.card.specCostLabel,
      specMarginLabel: TERMS.card.specMarginLabel,
      specSuggestLabel: TERMS.card.specSuggestLabel,
      specCalc: TERMS.card.specCalc,
      specEmpty: TERMS.card.specEmpty,
      // M3v1.2_B（D21/M3.31）：每 100g 计价规格（展示单位 + 口径说明）
      specPer100gUnit: TERMS.card.specPer100gUnit,
      specPer100gNote: TERMS.card.specPer100gNote,
      specPortionLabel: TERMS.card.specPortionLabel,
      specPortionPh: TERMS.card.specPortionPh,
      specPortionHint: TERMS.card.specPortionHint,
      specNeedPortion: TERMS.card.specNeedPortion,
      // round156：连续录入横幅
      savedOk: TERMS.card.savedOk,
      savedHint: TERMS.card.savedHint,
      backToList: TERMS.card.backToList,
      // M3.16（批次 C）套餐
      cardTypeLabel: TERMS.card.cardType,
      cardTypeDish: TERMS.card.cardTypeDish,
      cardTypeCombo: TERMS.card.cardTypeCombo,
      cardTypeHint: TERMS.card.cardTypeHint,
      comboSubCardTitle: TERMS.card.comboSubCardTitle,
      comboSubCardPh: TERMS.card.comboSubCardPh,
      comboSubCardQty: TERMS.card.comboSubCardQty,
      comboAddSubCard: TERMS.card.comboAddSubCard,
      comboPickEmpty: TERMS.card.comboPickEmpty,
      comboInsightCustomerSave: TERMS.card.comboInsightCustomerSave,
      comboInsightMerchantLose: TERMS.card.comboInsightMerchantLose,
      comboInsightLoseWarn: TERMS.card.comboInsightLoseWarn,
      comboInsightCostShare: TERMS.card.comboInsightCostShare,
      // P1 · 套餐本身毛利（售价 − 套餐成本）
      comboSelfMarginTitle: TERMS.card.comboSelfMarginTitle,
      comboSelfMarginHint: TERMS.card.comboSelfMarginHint,
      // M3.37（R190）到店团购渠道层
      grouponGoLink: TERMS.card.grouponGoLink,
      // M3.20（批次 B 收尾）菜品模板
      templateFrom: TERMS.card.templateFrom,
      templatePickPh: TERMS.card.templatePickPh,
      templateCatPh: TERMS.card.templateCatPh,   // R671：两级选择第一步的占位
      // R676：输菜名自动匹配模板
      tplMatchTip: TERMS.card.tplMatchTip,
      tplMatchApply: TERMS.card.tplMatchApply,
      tplNoMatchTip: TERMS.card.tplNoMatchTip,
      tplSuggestTip: TERMS.card.tplSuggestTip,   // R677：有相关候选时只指路
      // R731：已套用模板的撤销口文案
      tplAppliedTip: TERMS.card.tplAppliedTip,
      tplClearBtn: TERMS.card.tplClearBtn,
      templateHint: TERMS.card.templateHint,
      // ── R234/J4f 行内长提示折叠（本页 1 处）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语）。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
      amountBadTip: TERMS.ui.amountBadTip,
      usageBadTip: TERMS.card.usageBadTip,
      // R547（M8）：批量产出没填时单独一条提示（文案只讲这一件事，不与"金额读不成"混用）
      batchOutputBadTip: TERMS.ui.batchOutputBadTip,
      // R547（M5）：编辑态读不到卡的错误页文案（4 键）
      loadMissingTitle: TERMS.card.loadMissingTitle,
      loadMissingBody: TERMS.card.loadMissingBody,
      loadRetry: TERMS.card.loadRetry,
      loadBack: TERMS.card.loadBack,
      // 🔴 R675：energyToggle / energyHint 两条映射已删（燃气分摊开关随品类一起删了 ——
      //   燃气属期间费用，M1 月度支出已有真实账单科目，菜品级不再重复摊）。
      //   costNote 保留：它标的是「成本预览口径」，与燃气无关。
      costNote: TERMS.card.costNote,
    },
    // R234/J4f：行内长提示折叠（本页 1 处，默认收起）。仓内统一实现。
    hintFold: {},
    // R426（队列 #32）：读不成金额的**栏数**（0 = 没填错）。只驱动一条横幅，不参与计算。
    badAmountCount: 0,
    // R547（M8）：模式 B 下「这批出多少份」缺失/读不成 ⇒ 1（0 = 正常）。只驱动一条横幅。
    badQtyCount: 0,
    // 🔴 R597：用量（克/份）读不成 ⇒ 整行会被 buildCalcLines 静默跳过 ⇒ 成本少算。
    badUsageCount: 0,
    card_code: '',
    isEdit: false,
    name: '',
    calcMode: 'A',
    batchOutput: '',
    lossRate: 0,
    auxYuan: 0,
    priceYuan: 0,
    activityPriceYuan: '',
    category: '',
    // 分类是**自由文本**（v1.0 §菜品分类 明写"支持自定义"）；下列只是冷启动建议 + 本店历史。
    // 组件已从 picker 改为「input + chips」（picker 只能选预设，火锅的锅底/荤菜/素菜、营销栏目
    // "大口吃肉"这类根本选不出来）。categoryOptions 保留变量名为兼容既有引用，语义=建议池。
    categoryOptions: TERMS.card.dishCats.slice(),
    catChips: [],
    tags: '',
    targetMargin: 60,
    reversePriceFen: 0,
    previewCostFen: 0,
    // 🔴 R374：吸底条上的毛利率。**不是实时**——它对应 previewCostFen 那次试算，
    //   所以文案写「上次试算」。与后端 saveCostCard/service.js:105 同式：
    //   round((priceFen − unitCostFen) / priceFen × 10000) / 100。
    stickyMargin: '',
    stickyHint: '',
    previewStale: false,   // R635：成本是上一次算的（当前明细不完整）
    reverseResultPreview: '',
    previewCost: '',
    // M3.37 团购试算（纯前端、不落库；费率无默认值 ⇒ 只进 placeholder）
    materials: [],
    // 用量单位枚举（单源 utils/units.js；round151 起 = 与采购单位同池，基准单位仍恒为克）
    qtyUnits: units.QTY_UNITS.slice(),
    // round153：wxml 兜底用的基准单位词 —— 改前在模板里写死 `'克'`，那等于在页面存了第二份单位口径。
    //   ⚠️ 只作 `|| baseUnit` 兜底，真正的枚举值一律来自 qtyUnits / priceUnits（单源 units.js）。
    baseUnit: units.BASE_UNIT,
    // round151：单价单位枚举 —— 与用量单位同池（老板按什么单位报的价，就该能选什么）
    priceUnits: units.QTY_UNITS.slice(),
    // round150（M3.14）组件类型 chips：**只有键 + 中文名**，键集 ≡ 服务端 LINE_KINDS。
    kindChips: Object.keys(TERMS.card.lineKind).map((k) => ({ key: k, label: TERMS.card.lineKind[k] })),
    // round150（M3.15）规格行：**只有键 + 中文名**（系数单源在服务端 ⇒ 页面只送 spec_key + 售价）。
    specRows: freshSpecRows(),
    lines: [],
    loading: true,
    // 🔴 R547（M5）：编辑态读不到卡 ⇒ 真（显式错误页；此时**禁止保存**，见 onSave）
    loadMissing: false,
    // round156：连续录入 —— 顶部「已保存」横幅记录刚存下的菜名；非空即显示（含返回列表出口）
    savedName: '',
    quotaTip: '',
    moneyTip: '',
    saving: false,   // 防重复提交（连击保存会生成两个版本）
    // M3.16（批次 C）套餐：卡片类型（'1'=单品 / '3'=套餐）+ 子卡选择行 + 三个显示数。
    cardType: '1',
    subCards: [],       // 候选子卡（非套餐的最新版本卡）：[{ card_code, name, total_cost_fen, price_fen }]
    subCardOptions: [], // picker range（[{ card_code, label }]）
    comboLines: [],     // 子卡行：[{ sub_card_ref, sub_card_name, qty }]
    comboInsight: null, // 回填的套餐三数（{ customer_save_fen, merchant_lose_fen, cost_share }）
    comboStaleText: '', // R443：子卡成本已变时的提示（空 = 不显示）
    // 🔴 R443：批量粘贴配料（只在本页暂存，导入后才进 lines；不落库、不联网）
    pasteOpen: false,
    pasteText: '',
    pasteRows: [],
    pasteOkCount: 0,
    pasteImportLabel: '',
    comboSelfMargin: null, // P1 · 套餐本身毛利（售价 − 套餐成本）：{ profit, rate } 或 null
    // 🔴 P0#7（2026-10-11）：新手/专业模式（与 M1 录入页同形）—— 默认新手，专业项收起
    inputMode: 'novice',
    showMore: false,
    // M3.20（批次 B 收尾）菜品模板：picker range（20 道菜名）+ 当前选中项（-1 = 未选）
    tplNames: TEMPLATES.map((t) => t.dish_name),
    tplPicked: -1,
    // 🔴 R671：两级选择 —— 先选业态大类（与 M2 同一套词），再选该品类下的菜
    //   为什么两级：22 道平铺在一个下拉里，老板要滚很久才能找到"宫保鸡丁"；
    //   按品类收窄后，正餐类 20 道里一眼就能挑到。
    tplCatNames: TEMPLATE_CATS.map((c) => c.label),
    tplCatIdx: -1,
    tplKeys: [],          // 当前品类下的 tpl_key 列表（onPickTemplate 用它换算）
    // 🔴 R676：输菜名自动匹配模板（替代已删的品类选择器）
    tplMatchKey: '',      // 匹配到的 tpl_key，空 = 不提示
    tplMatchName: '',     // 匹配到的标准菜名（提示语里显示）
    tplNoMatch: false,    // 菜名填了但库里没有 ⇒ 给「自己加原料」的引导
    tplSuggest: 0,        // 库里**有相关的**（如自制/外购两道）⇒ 只指路，不替老板选
    // 🔴 R731：模板**已套用**标记 —— 有它才有「清除」入口。
    //   为什么必须有：套用会把 lines 整块换成模板行（applyTplToCard），原状是**不可撤销**的
    //   ⇒ 老板误点一次只能退出重进（连已填的菜名/价格一起丢）。改前页面没有任何撤销口。
    tplApplied: false,
    tplAppliedName: '',   // 已套用的模板菜名（提示语里显示是哪道）
    // 🔴 R675：品类默认模板（catOptions/catPicked/catYieldDefault/catLabel）与
    //   燃气分摊（energyOn/energyFen）、估算卡横幅（hasPreset/estBanner）**全部删除**。
    //   原因见 edit.wxml 顶部注释。出净率改由模板行自带 + 选原料时按原料自动带出。
  },

  // R234/J4f：行内提示折叠开关（仓内统一形态 —— 多页同一实现）。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
  },

  onLoad(q) {
    // round156：本页进入时刻 —— 用作「原料选择页回传」的哨兵（见 onShow）
    this._loadedAt = Date.now();
    this.setData({ card_code: (q && q.card_code) || '', isEdit: !!((q && q.card_code) || '').length > 0 });
    // R264：从「单品毛利复盘」的未匹配行点「去建卡」带过来的菜名 ⇒ **预填**。
    //   🔴 必须 `decodeURIComponent`（复盘页用 `encodeURIComponent` 编码，防空格/括号/加号截断）。
    //   ⚠️ 只在**新建**时生效：编辑态下面 load() 会用卡里的名字回填，预填不该覆盖它。
    const prefillName = (q && q.dish_name) ? decodeURIComponent(q.dish_name) : '';
    if (prefillName && !((q && q.card_code) || '').length) this.setData({ name: prefillName });
    // R692（易填性）：**售价也预填** —— 从复盘页「去建卡」带上来的均价（销售额 ÷ 销量）。
    //   老板刚在榜上看到"这道菜卖了 1,234 元 / 43 份"，建卡时却要凭记忆再填一遍售价，
    //   而这个数就在眼前。少一次输入，也少一次记错。
    //   ⚠️ 只在新建态生效：编辑态 `load()` 会用卡里的真实售价回填（见 load 里 `init.priceYuan`），
    //      预填若在编辑态生效，会把用户已存的价盖掉。
    //   ⚠️ 均价含活动价（团购/满减）⇒ 可能低于门市价，所以带一句提示让他核对（不是静默填上）。
    const prefillPrice = (q && q.price) ? Number(q.price) : 0;
    if (prefillPrice > 0 && Number.isFinite(prefillPrice) && !((q && q.card_code) || '').length) {
      this.setData({
        priceYuan: prefillPrice.toFixed(2),
        prefillPriceNote: TERMS.card.prefillPriceNote,
      });
    }
    // 🔴 R566（P0-4 UI）：批量导入页点「去补价」⇒ 整张草稿预填进来。
    //   传参走本地暂存而不是 URL：草稿含几十行动态字段，URL 有长度上限且中文要逐层编码。
    //   ⚠️ 只在新建态生效（编辑态 load() 要用卡里的真实数据回填，不能被草稿盖掉）。
    if (!this.data.isEdit && q && q.from_draft) {
      this.loadDraftPrefill();
      // 🔴 R704：栈里上一页是**导入页**（…→import→edit），`navigateBack` 回的是它。
      //   改前这里恒显示「返回列表」＝指向一个不会去的地方。
      // 🔴 R708：同时进「补价模式」。草稿已经把菜名/售价/示例主料/出成率都填好了，
      //   老板唯一缺的是**单价**；改前进来仍是 20+ 控件的全功能页（套餐/模板/核算模式/
      //   规格/反算/团购 六块无关区域全在），补一道菜要跨六屏 —— 这是这条链最贵的一段。
      //   ⇒ 默认只留 菜名 + 原料行 + 售价 + 保存，其余收在「展开完整设置」后面（见 wxml 的 lean 守卫）。
      this.setData({ backLabel: TERMS.card.backToImport, patchMode: true, patchFull: false });
      // 🔴 不在这里写 `lean: true` —— lean 只能由 patchMode/patchFull 派生（见 applyLean）。
      //   直接写字面量＝第二份真相：哪天 patchFull 的默认值变了，这里就成了静默的错。
      this.applyLean();
    }
    // 🔴 P0#7：读本地记的专业/新手偏好（按 shop 区分；换设备回默认 novice）
    // 🔴 R708：补价模式下**强制 novice**。若老板本地记的是「专业」，这里会直接把
    //   核算模式/批量产出/规格一起铺开 —— 精简态当场失效，而且他不知道为什么。
    this.setData({ inputMode: this.data.patchMode ? 'novice' : (this.loadInputMode() || 'novice') });
    this.load();
  },

  // 🔴 R566：消费导入页暂存的草稿（**读完即删** —— 否则下次手动新建也会被这张草稿污染）。
  //   映射全部走 utils/dishImport.js::prefillOf（单源），本页只负责 setData 与 commitLines。
  //   ⚠️⚠️ 本函数只**读取暂存**、不 setData：必须等 `load()` 跑完再落。
  //     新建态 `load()` 有 `if (!init.lines.length) init.lines = renumber([emptyLine()])`，
  //     若在 onLoad 里先 commitLines，那行会把整张草图**覆盖成单个空行**（一行不报错、界面看着"没预填上"）。
  loadDraftPrefill() {
    let d = null;
    try {
      d = wx.getStorageSync(ss.shopKey(DRAFT_PREFILL_KEY));
      wx.removeStorageSync(ss.shopKey(DRAFT_PREFILL_KEY));
    } catch (e) { return; }              // 读不到就当没预填（不打断新建流程）
    if (!d || !d.name) return;
    const p = DI.prefillOf(d);
    // ⚠️ 不能因 `p.lines` 为空就整体放弃：品类未识别的菜**本来就没有示例主料**，
    //   若这里 return，用户点「去补价」会落到一张连菜名/售价都没填的空表单（点了像没反应）。
    //   空行交给 load() 的默认空行即可，菜名/售价照常带过去。
    this._draftPrefill = p;              // 交给 load() 在 setData(init) 之后应用
  },

  // load() 完成 setData(init) 后调用（此时 materials 已就位，commitLines 的换算说明才算得出来）
  applyDraftPrefill(p) {
    // 🔴 R675：不再回填品类索引/catLabel（品类默认模板已删）。
    //   `category` 只当**纯标签**回填（列表筛选还在用），不参与任何计算。
    this.setData({
      name: p.name,
      priceYuan: p.priceYuan,
      category: p.category || '',
      lossRate: p.lossRate,
    });
    // 有预填行才覆盖；没有就保留 load() 给的那一行空行
    if (p.lines && p.lines.length) this.commitLines(p.lines);
  },

  // 🔴 P0#7：新手/专业模式（与 M1 录入页同形）—— 本地记忆、按 shop 区分
  inputModeKey() {
    const app = getApp();
    const shopId = (app && app.globalData && app.globalData.shop_id) || '';
    return INPUT_MODE_KEY + shopId;
  },
  saveInputMode(m) {
    try { wx.setStorageSync(this.inputModeKey(), m); } catch (e) { /* 本地记忆失败不影响主流程 */ }
  },
  loadInputMode() {
    try { const v = wx.getStorageSync(this.inputModeKey()); if (v === 'novice' || v === 'pro') return v; } catch (e) { /* 忽略 */ }
    return null;
  },
  onPickInputMode(e) {
    const val = e.currentTarget.dataset.val === 'pro' ? 'pro' : 'novice';
    if (this.data.inputMode === val) return;
    this.setData({ inputMode: val, showMore: false });
    this.saveInputMode(val);
  },
  onExpandPro() { this.setData({ showMore: true }); },

  // 🔴 R708：补价模式的**逃生口**。
  //   为什么必须有：走到精简态，老板偶尔仍要改分类/损耗、看规格试算、或发现草稿的
  //   示例主料不对要走反算。若没有这个口，精简态就是**死胡同** —— 他只能退出去手动新建，
  //   导入页辛苦认出来的菜名/售价/sku 全白填。
  //   ⚠️ 这是「加一层」不是「换一页」：展开后就是原来那张全功能页，一个控件都没删。
  onLeanToggle() {
    this.setData({ patchFull: !this.data.patchFull });
    this.applyLean();
  },

  // 🔴 R708：`lean` 的**唯一**求值点。
  //   任何地方想让补价模式收起/展开，都只改 patchFull 再调这里 ——
  //   不许直接 `setData({ lean: true/false })`：那是第二份真相，
  //   与 patchFull 一旦不一致，wxml 里几十个 `!lean` 会一起指向错的那个。
  //   守 tools/check_card_field_gating.js 的 P-R708-②。
  applyLean() {
    this.setData({ lean: !!(this.data.patchMode && !this.data.patchFull) });
  },

  // round156：从「原料选择页」返回 → 消费回传。
  //   哨兵 `at`：进选择页**没选就返回**时，globalData 里没有新值（或还是上一轮的旧值），
  //   靠 `at < this._loadedAt` 丢弃旧值，避免"我只是点进去看了一眼"就把某一行原料换掉。
  onShow() {
    const app = getApp();
    const p = app && app.globalData && app.globalData.pickMaterial;
    if (!p || !p.at) return;
    app.globalData.pickMaterial = null;
    if (this._loadedAt && p.at < this._loadedAt) return;   // 上一轮遗留 ⇒ 丢弃
    // 原料表还没到（load 尚未返回）⇒ 挂起，等 load 末尾补做，避免"选了却没填上"
    if ((this.data.materials || []).length) this.applyPickedMaterial(Number(p.idx), p.id);
    else this._pendingPick = p;
  },

  // round156：原料选择改为**独立页**（`subpkg/biz/material/pick`）。
  //   改前是原生 `<picker mode="selector" range="{{materials}}">` —— 100 个原料只能靠手指滚，
  //   没有搜索、没有分组（李老师真机反馈：「如果有 100 道菜品，来回查找会很麻烦」）。
  goPickMaterial(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    wx.navigateTo({ url: '/subpkg/biz/material/pick?idx=' + idx });
  },

  // 把选中的原料填进第 idx 行（原 onMaterialChange 的语义；改为按 **id** 取而非按下标取 ——
  //   独立页回传的是 id，比下标稳：中途列表顺序变了也不会填错行）。
  applyPickedMaterial(idx, materialId) {
    if (!(idx >= 0)) return;
    const lines = this.data.lines.slice();
    if (!lines[idx]) return;
    const m = (this.data.materials || []).find((x) => x.id === materialId);
    if (!m) return;
    lines[idx] = Object.assign({}, lines[idx], {
      input_type: 1,
      material_id: m.id,
      material_name: m.name,
      spec_hint: this.specHintOf(m),
      // round151：换原料 ⇒ 跨族提示要跟着换（提示取决于该原料的采购单位）
      unit_warn: this.unitWarnOf(m, lines[idx]),
      // 🔴 R675：**选原料时按原料自动带出出净率**（草鱼 65 / 里脊 95 / 叶菜 78）。
      //   为什么必须有这一步：品类默认模板删掉后，手工行没人给净率了 ——
      //   若一律按 100 算，老板选「草鱼」成本会**低估 35%**，而且界面毫无提示。
      //   ⚠️ 只在该行还是「空/默认 100」时才覆盖：老板自己改过的值（如他买的是现成鱼片填 100）
      //      不能被机器改回去 —— R626 踩过「我明明填了却变了」。
      yield_rate: (!lines[idx].yield_rate || String(lines[idx].yield_rate) === '100')
        ? String(yieldOf(m.name)) : lines[idx].yield_rate,
      // 🔴 R678：组件类型同理 —— **只在没设过时推断**。
      //   老板明确选过「主料/辅料/调料」就不许改（R626 教训：「我明明填了却变了」）。
      line_kind: isUnset(lines[idx].line_kind) ? inferLineKind(m.name) : lines[idx].line_kind,
    });
    this.editLineStripPreset(idx, lines);
  },

  async load() {
    try {
      await api.ensureShop();          // 有缓存（app.globalData.shopLoaded）⇒ 二次进入是同步返回
      ui.setTitle(TERMS.card.listTitle);

      // 🔴 R678（李老师：「新建菜品成本卡要缓几秒才出来」）—— 三个真因，逐个修：
      //
      // ① **原来的顺序是三个串行 await**：ensureShop → getMaterial → getCostCard。
      //    一次等一次，全部回来才 `loading:false`，整页才渲染（wxml 第 1 行是
      //    `<view class="form" wx:if="{{!loading}}">`）⇒ 用户看到"加载中"好几秒。
      //    ⇒ 改成 **Promise.all 并行**，耗时 ≈ 最慢那一个，不是三个相加。
      //
      // ② **新建单品卡根本不需要 getCostCard**：那个列表只服务
      //    「套餐选子卡」和「编辑态回填」。原来新建时也照拉，白等一次完整往返
      //    （云函数冷启动时这一下就是 1–3 秒）。
      //    ⇒ 只在「编辑态」或「套餐」时才拉。
      //
      // ③ **原料表没有缓存**：每次进页面都重拉全部原料（可能上百条）。
      //    ⇒ 有缓存就**先渲染让页面立刻出来**，再后台静默刷新覆盖。
      //      老板改价后回列表再进来，看到的是新价（后台刷），但页面是秒开的。
      const MAT_CACHE = 'm3_materials_cache_v1';
      const isNewSingle = !this.data.isEdit && this.data.cardType !== '3';

      // ③ 先用缓存把页面撑起来（只在新建态：编辑态要用真数据回填，不能先渲染旧值）
      if (isNewSingle) {
        try {
          const c = wx.getStorageSync(ss.shopKey(MAT_CACHE));
          if (c && Array.isArray(c.materials) && c.materials.length) {
            this.setData({ materials: c.materials, loading: false });
          }
        } catch (e) { /* 缓存坏了不影响正确性，走下面真取 */ }
      }

      // ①② 并行取；不需要的调用直接不给
      const [mat, cd] = await Promise.all([
        api.call('getMaterial', {}),
        (this.data.isEdit || this.data.cardType === '3')
          ? api.call('getCostCard', {}).catch(() => ({ list: [] }))
          : Promise.resolve({ list: [] }),
      ]);

      // round149：把「买」的那一侧也带进来（采购单位/换算系数/出成率/采购价），
      //   好让老板在明细行直接看见「36 元/斤 ÷ 500 ÷ 92% ⇒ 0.0783 元/克」，不用去档案页心算。
      const materials = (mat.list || []).map((m) => ({
        id: m.id,
        name: m.name,
        is_virtual: m.is_virtual,
        net_unit_cost: m.net_unit_cost,
        purchase_unit: m.purchase_unit || '',
        purchase_price_fen: m.purchase_price_fen || 0,
        convert_factor: m.convert_factor || 0,
        yield_rate: m.yield_rate || 0,
      }));
      // 原料表写缓存（供下次进页面秒开）。只存新建态 —— 编辑态的数据本来就要准，不缓存。
      if (isNewSingle && materials.length) {
        try { wx.setStorageSync(ss.shopKey(MAT_CACHE), { at: Date.now(), materials }); } catch (e) { /* 存不下就算了 */ }
      }
      // M3.16（批次 C）：成本卡列表 —— 候选子卡（非套餐）+ 编辑回填。上面已按需并行取到。
      const cardList = (cd && cd.list) || [];
      const subCards = cardList
        .filter((x) => x.card_type !== 3)
        .map((x) => ({ card_code: x.card_code, name: x.name, total_cost_fen: x.total_cost_fen, price_fen: x.price_fen }));
      const subCardOptions = subCards.map((x) => ({ card_code: x.card_code, label: x.name }));
      const init = { materials, subCards, subCardOptions, loading: false };
      if (this.data.isEdit) {
        const c = cardList.find((x) => x.card_code === this.data.card_code);
        if (c) {
          init.name = c.name || '';
          init.lossRate = c.loss_rate || 0;
          init.auxYuan = api.fenToYuan(c.aux_fen, 2);
          init.priceYuan = c.price_fen > 0 ? api.fenToYuan(c.price_fen, 2) : '';
          init.category = c.category || '';
          init.tags = c.tags || '';
          init.previewCostFen = c.total_cost_fen || 0;
          // 🔴 R297-⑥（审计 M3-B2）：这里只设了「显示判据」previewCostFen，却没设「值」previewCost
          //   ⇒ wxml 的 `wx:if="{{previewCostFen > 0}}"` 成立、而 `{{previewCost}}` 是空串
          //   ⇒ 屏上渲染成「单份成本：¥」（有标题有货币符、没有数字）。原先只有用户手点一次
          //   反算/规格试算才会被填上 ⇒ 每次进编辑态都先看到一个"没算出来"的假象。
          init.previewCost = c.total_cost_fen ? api.fenToYuan(c.total_cost_fen, 2) : '';
          init.stickyMargin = this.marginTextOf(c.total_cost_fen || 0, init.priceYuan);
          // 🔴 R297-⑥（审计 M3-B1）：活动特价**从不回填** —— 后端其实早把它送出来了
          //   （getCostCard/service.js::price_promo_fen），这里却没用。
          //   后果不是"少显示"而是**静默清零**：输入框空着，老板以为本来没设，直接保存就把
          //   `activity_price_yuan` 提交成 0（第二档毛利率随之消失），全程零提示。
          init.activityPriceYuan = c.price_promo_fen > 0 ? api.fenToYuan(c.price_promo_fen, 2) : '';
          init.copyVersion = TERMS.card.copyVersion;
          if (c.card_type === 3) {
            // M3.16 套餐：回填子卡行 + 三个显示数（顾客省 / 我少赚 / 成本结构）
            init.cardType = '3';
            init.calcMode = 'A';
            init.comboLines = (c.lines || [])
              .filter((l) => l.line_type === 2 && l.sub_card_ref)
              .map((l) => ensureRid({
                sub_card_ref: l.sub_card_ref,
                sub_card_name: (subCards.find((s) => s.card_code === l.sub_card_ref) || {}).name || l.material_name || '',
                qty: String(l.quantity),
                // 🔴 R443：把**保存时**的子卡单份成本记下来（net_unit_cost 是万分之元 ⇒ 换成**分**存）——
                //   套餐成本是快照，子卡后来涨价/改配方不会自动更新（syncCostCard 跳过 card_type=3）。
                //   ⚠️ 一律在「分」上比较，不做 `fen * 100`（check_money_precision C-① 要求每处 ×100 登记，
                //      而这里本质是整数换算，没必要引入一处浮点乘法）。
                saved_fen: Math.round((Number(l.net_unit_cost) || 0) / 100),
              }));
            init.comboInsight = c.combo ? {
              customer_save_yuan: api.fenToYuan(c.combo.customerSaveFen, 2),
              merchant_lose_yuan: api.fenToYuan(Math.abs(c.combo.merchantLoseFen), 2),
              merchant_lose_neg: c.combo.merchantLoseFen < 0,
              cost_share: (c.combo.costShare || []).map((s) => ({ name: s.name, share_pct: s.share_pct })),
            } : null;
            // P1 · 套餐本身毛利（售价 − 套餐成本）：编辑回填时成本来自 c.total_cost_fen，售价来自 price_fen
            init.comboSelfMargin = this.comboSelfMarginOf(c.total_cost_fen || 0, init.priceYuan);
            init.comboStaleText = '';
          } else {
            // 单品：现有原料 / 手工行回填
            init.calcMode = c.calc_mode;
            init.batchOutput = c.batch_output || '';
            // ⚠️ 回填的单位口径：库里存的 quantity **恒为基准单位(克)**（round149 起前端提交前已换算），
            //   故回填一律按「克」显示 —— 这是**确定**的，不做"猜你原来填的是千克"（猜错会显示错数）。
            init.lines = renumber((c.lines || []).map((l) => {
              if (l.material_id) {
                return { input_type: 1, material_id: l.material_id, material_name: l.material_name, qty: String(l.quantity), qty_unit: units.BASE_UNIT, line_kind: l.line_kind || 'main' };
              }
              // 手工行（material_id 空）：从快照反推净料单价（元/克），出成率固定 100（快照已是净料）
              const unitPriceYuan = l.net_unit_cost ? (l.net_unit_cost / 10000).toFixed(4) : '';
              // 🔴 R639：若这张卡存过**老板当初填的原单位**（R639 之后保存的卡），按原单位还原显示 ——
              //   老板按「3 元/公斤」进货，就该看到「3 元/公斤」，而不是「0.003 元/克」（他对克价无感）。
              //   ⚠️ 老卡没有这两个字段 ⇒ 走下面的老逻辑（按克），不猜。
              if (l.price_unit && l.manual_price_fen > 0) {
                return {
                  input_type: 2, material_id: '', material_name: l.material_name,
                  qty: String(l.quantity), qty_unit: units.BASE_UNIT,
                  price_unit: l.price_unit,
                  unit_price_yuan: (l.manual_price_fen / 100).toFixed(2),
                  yield_rate: String(l.manual_yield || 100),
                  line_kind: l.line_kind || 'main',
                };
              }
              return { input_type: 2, material_id: '', material_name: l.material_name, qty: String(l.quantity), qty_unit: units.BASE_UNIT, unit_price_yuan: unitPriceYuan, yield_rate: '100', line_kind: l.line_kind || 'main' };
            }));
            // round150：规格快照回填（specs_json ⇒ 数组）。存量卡无此字段 ⇒ []。
            init.specRows = this.data.specRows.map((r) => {
              const hit = (c.specs || []).find((s) => s && s.spec_key === r.spec_key);
              if (!hit) return r;
              return Object.assign({}, r, {
                enabled: hit.enabled !== false,
                name: hit.name || r.name,
                priceYuan: hit.price_fen > 0 ? api.fenToYuan(hit.price_fen, 2) : '',
                // R547（M1）：克重快照回填（存量卡无此字段 ⇒ 空，进页面时会提示去补）
                portionG: hit.portion_g > 0 ? String(hit.portion_g) : '',
              });
            });
          }
        } else {
          // 🔴 R547（M5）：编辑态读不到卡 ⇒ 显式报错，绝不渲染空白表单。
          //   改前无 else ⇒ 表单空白但可保存 ⇒ 一保存就把有内容的卡盖成空白版本（或凭 card_code 凭空造卡），
          //   全程零提示。三条腿一起断：错误页 + 隐藏保存按钮 + onSave 硬拦。
          this.setData({ loading: false, loadMissing: true });
          return;
        }
      }
      if (!init.lines || init.lines.length === 0) init.lines = renumber([emptyLine()]);
      // 分类回显：自由文本，直接回显；候选 chips = 本店填过的 + 建议池（不再做"补进枚举"）
      init.catChips = this.buildCatChips(init.category);
      this.setData(init);
      if (init.cardType === '3') this.refreshComboStale();
      // 🔴 R566：导入草稿在此落盘（必须在 init 之后 —— 见 loadDraftPrefill 的覆盖坑说明）
      if (this._draftPrefill) {
        const p = this._draftPrefill;
        this._draftPrefill = null;
        this.applyDraftPrefill(p);
      }
      // 明细行的原料换算说明（须在 setData(materials) 之后算，否则找不到原料）
      this.refreshSpecHints();
      // round156：从原料选择页返回时原料表还没到 ⇒ 在此补做（见 onShow 的 _pendingPick）。
      //   没有它就会出现"明明选了原料、界面却没填上"这种最气人的静默失败。
      if (this._pendingPick) {
        const p = this._pendingPick;
        this._pendingPick = null;
        this.applyPickedMaterial(Number(p.idx), p.id);
      }
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // R547（M5）：错误页的「重新加载」—— 只重置判据再走**同一条** load()，不自造第二条取数路径
  onRetryLoad() {
    this.setData({ loadMissing: false, loading: true });
    this.load();
  },

  onName(e) { this.setData({ name: e.detail.value }); },

  // 🔴 R676（李老师：「删完品类，老板面对空白配料区不知道填什么」）：
  //   输完菜名 → 自动匹配模板库 → 提示「检测到「宫保鸡丁」　套用模板」
  //   这是**替代品类选择器**的入口（品类已删，R675）。
  //
  //   三个「不该提示」的条件，每个都有代价更高的反面：
  //   ① 配料区已经有内容 ⇒ 不提示（点了会**覆盖老板的手工录入**，比不提示糟得多）；
  //   ② 匹配不到 ⇒ 不提示套用，但给一句「库里没有，自己加原料」的引导
  //      （大部分菜不在库里，没这句话老板会以为功能坏了）；
  //   ③ 同一条已经提示过 ⇒ 不重复 setData（每次返回页面都闪一下很吵）。
  onNameBlur(e) {
    const name = String((e && e.detail && e.detail.value) || this.data.name || '').trim();
    if (!name) {
      if (this.data.tplMatchKey || this.data.tplNoMatch || this.data.tplSuggest) this.setData({ tplMatchKey: '', tplMatchName: '', tplNoMatch: false, tplSuggest: 0 });
      return;
    }
    // ① 已填了配料 ⇒ 一句话都不说
    if (!this.linesAllBlank()) {
      if (this.data.tplMatchKey || this.data.tplNoMatch || this.data.tplSuggest) this.setData({ tplMatchKey: '', tplMatchName: '', tplNoMatch: false, tplSuggest: 0 });
      return;
    }
    const tpl = matchTemplateByName(name);
    if (!tpl) {
      // ②-a 库里**有相关的**（老板输「牛油锅底」，库里有自制/外购两道）——
      //   🔴 **不能自动套**：自制和外购的成本结构完全不同（一个按桶÷锅数、一个按斤买），
      //   机器替他选等于让他拿错模型算账，而且算出来的数字看着还很正常。
      //   所以只指路：「库里有 2 个相关的，从下面挑」。
      const sug = suggestTemplates(name);
      if (sug.length) {
        if (this.data.tplSuggest !== sug.length || this.data.tplNoMatch || this.data.tplMatchKey) {
          this.setData({ tplMatchKey: '', tplMatchName: '', tplNoMatch: false, tplSuggest: sug.length });
        }
        return;
      }
      // ②-b 真的没有 —— 给「自己加」的引导，不要静默
      if (!this.data.tplNoMatch || this.data.tplMatchKey || this.data.tplSuggest) {
        this.setData({ tplMatchKey: '', tplMatchName: '', tplNoMatch: true, tplSuggest: 0 });
      }
      return;
    }
    if (tpl.tpl_key === this.data.tplMatchKey && !this.data.tplNoMatch && !this.data.tplSuggest) return;   // ③ 同一条不重复
    this.setData({ tplMatchKey: tpl.tpl_key, tplMatchName: tpl.dish_name, tplNoMatch: false, tplSuggest: 0 });
  },

  // 配料区是否「一点内容都没有」（全是空行也算空）
  // ⚠️ 判据用「行里有没有真内容」而不是 lines.length —— load() 初始就塞一行空行，
  //   按 length 判会恒假（R568 踩过同一个坑）。
  linesAllBlank() {
    const L = this.data.lines || [];
    if (!L.length) return true;
    return L.every((l) => !l
      || (!String(l.material_name || '').trim() && !String(l.qty || '').trim()));
  },

  // 点「套用模板」—— 用匹配到的模板，但**保留老板自己输的菜名**
  onApplyMatched() {
    const key = this.data.tplMatchKey;
    const tpl = key ? TEMPLATES.filter((t) => t.tpl_key === key)[0] : null;
    if (!tpl) return;
    this.applyTplToCard(tpl, -1, true);
  },
  // R547（M8）：改模式 / 改出货量都要重算体检 —— 否则切到「按一批算」后横幅不出现
  //   （checkAmounts 只在金额栏的 handler 里被调用，模式与出货量都不是金额栏）。
  onMode(e) { this.setData({ calcMode: e.detail.value }); this.checkAmounts(); },
  onBatch(e) { this.setData({ batchOutput: e.detail.value }); this.checkAmounts(); },

  // ===== M3.16（批次 C）套餐 =====
  // 切换卡片类型（单品 / 套餐）。切到套餐时，付费墙在**保存**时由后端拦（FEATURE_LOCKED → openPaywall('combo')）。
  onCardType(e) {
    const val = e.detail.value;   // '1' | '3'
    const patch = { cardType: val };
    if (val === '3') {
      patch.calcMode = 'A';   // 套餐固定按份聚合
      if (!this.data.comboLines.length) patch.comboLines = [{ sub_card_ref: '', sub_card_name: '', qty: '1' }];
    }
    this.setData(patch);
  },

  // ===== M3.20（批次 B 收尾）菜品模板：一键起行 =====
  // 选模板 → 预填行名 + 用量 + 单位（**价格全部留空**）；模板只省打字，保存仍走 saveCostCard、配额照扣。
  // R671：选品类 → 刷新该品类下的菜品列表
  onPickTplCat(e) {
    const idx = Number(e.detail.value);
    const cat = TEMPLATE_CATS[idx];
    if (!cat) return;
    const list = templatesByCat(cat.key);
    this.setData({
      tplCatIdx: idx,
      tplKeys: list.map((t) => t.tpl_key),
      // 菜品名用「品类内」列表，选中项归零（换品类后旧选择无意义）
      tplPicked: -1,
      tplNames: list.map((t) => t.dish_name),
    });
  },

  onPickTemplate(e) {
    const i = Number(e.detail.value);
    // 🔴 R671：i 是「当前品类内」的索引 ⇒ 必须经 tplKeys 换算，不能直接当 TEMPLATES 的全局下标
    //   （直接当全局下标会静默套错模板：选了「正餐」第 3 道，实际套上 TEMPLATES[3]）
    const key = (this.data.tplKeys || [])[i];
    const tpl = key ? TEMPLATES.filter((t) => t.tpl_key === key)[0] : null;
    if (!tpl) return;
    this.applyTplToCard(tpl, i, false);
  },

  // 🔴 R676：把「套用模板」抽出来 —— 两条入口共用一份逻辑：
  //   ① 下拉选模板（onPickTemplate）② 输菜名自动匹配后点「套用」（onApplyMatched）
  //   抄第二份必然漂移（R474 教训：抄一份必漂），而且套用涉及模式/批量产出/锅底提示三处边界。
  // @param pickedIdx 品类内索引（下拉用；自动匹配传 -1，因为没有"下拉选中项"）
  // @param keepName  保留老板自己输入的菜名（自动匹配时 true —— 他输「重庆小面」，
  //                  模板叫「重庆小面（素面）」，**不能被改成模板名**，R626：我明明填了却变了）
  applyTplToCard(tpl, pickedIdx, keepName) {
    if (!tpl) return;
    const rows = applyTemplate(tpl);
    // 模板行 → 手工行（input_type=2）：行名 + 用量 + 单位预填，单价留空等用户填
    const lines = rows.map((r) => Object.assign({}, emptyManualLine(), {
      material_name: r.line_name,
      qty: String(r.qty),
      qty_unit: r.unit,
      // 🔴 R674：出净率**按原料**从模板行带出来（里脊 95 / 整鱼 65 / 青菜 78），
      //   不再借「品类默认值」。
      //   为什么必须换：① 品类粒度太粗（同一类里净料和毛料混着，一个值必然一半偏一半欠）；
      //   ② 李老师要删掉「这道菜属于哪类」—— 品类一删，catYieldDefault 就是空的，
      //      若还走兜底 '100'，整鱼从 65% 掉到 100% ⇒ **成本直接低估 35%**（界面毫无提示）。
      yield_rate: String(r.yield_rate || '100'),
      // 🔴 R678：**套模板时自动标组件类型**。原来全标 main ⇒ 老板做「小份版」试算时
      //   糖/醋/酱油/油跟着主料一起减半 ⇒ 成本算错，而界面完全看不出来。
      //   （多规格试算按 line_kind 分别乘系数：主料 1→0.5，调料应该保持 1）
      line_kind: inferLineKind(r.line_name),
    }));
    // 🔴 R317：**模式随模板走**。火锅锅底这类「炒一批料 → 打 N 锅」必须 mode B + 批量产出；
    //   若仍按 mode A 套用，整批料的成本会被当成「一锅」的成本 ⇒ **静默算错 N 倍**（界面看不出）。
    //   mode B 时顺手把专业项展开（核算模式 / 批量产出就在那一区，不展开老板看不到、改不了）。
    const tplMode = tpl.mode === 'B' ? 'B' : 'A';
    const batch = Number(tpl.batch_output);
    const patch = {
      lines: renumber(lines), tplPicked: pickedIdx, cardType: '1', calcMode: tplMode,
      // 🔴 R731：置「已套用」标记 —— 有它页面才渲染「清除模板内容」。
      //   套用是**覆盖式**的（lines 整块被模板行替换），没有这个撤销口就只能退出重进。
      tplApplied: true, tplAppliedName: tpl.dish_name || '',
    };
    if (!keepName) patch.name = tpl.dish_name;      // 自动匹配时保留老板输入的菜名
    if (tplMode === 'B') {
      patch.batchOutput = batch > 0 ? String(batch) : '';
      patch.showMore = true;
    }
    this.setData(patch);
    this.refreshSpecHints();
    // R547（M8）：模板会把模式切到 B（火锅锅底这类）⇒ 出货量没预填时必须立刻挂横幅
    this.checkAmounts();
    // 🔴 R670（李老师：「锅底收费要」）：套用**锅底类**模板后提醒填售价。
    //   为什么必须提醒：锅底是火锅店最容易算错的隐形项 —— 老板常以为锅底赚钱，
    //   实际贴钱（一锅底料成本 40-60 元，重庆收 28-38 元、外地才敢收 58+）。
    //   不提醒的话，「售价」空着 ⇒ 系统只算出成本、算不出赚亏，这一项就白算了。
    //   用 toast 而不是弹窗：弹窗打断填卡，toast 只提示一次不拦路。
    if (tplMode === 'B' && /锅底|锅/.test(tpl.dish_name)) {
      wx.showToast({ title: TERMS.card.potPriceHint, icon: 'none', duration: 3000 });
    }
    // 套过了就清掉匹配提示（配料区已经不空了）
    this.setData({ tplMatchKey: '', tplMatchName: '', tplNoMatch: false, tplSuggest: 0 });
  },

  // 🔴 R731（李老师 2026-11-14 真机原话）：「不小心点成套用模板了，我现在要把它清了，
  //   你现在又没有清除这个套用模板这个选项，整个我还得重新退出去重新进来」。
  //   根因：`applyTplToCard` 是**覆盖式**的（lines 被模板行整块替换）⇒ 原状不可撤销，页面无任何出口。
  //   本方法补撤销口。边界三条（都不是可选）：
  //     ① 只清**配料行**：菜名是老板自己输的、售价与模板无关 ⇒ 一律保留；
  //     ② 已填单价时**先确认**：清掉的可能是他真金白银填过的数，一点就没比误套更气人；
  //     ③ 模式与批量产出一并复位：模板可能把 calcMode 切到 B（火锅锅底这类），
  //        留着会让「整批料钱当一道菜」继续算错（与 R317 同一个坑，只是反方向）。
  onClearTpl() {
    const hasPrice = (this.data.lines || []).some((l) => String((l && l.unit_price_yuan) || '').trim());
    const doClear = () => {
      this.setData({
        lines: renumber([emptyLine()]),   // 与新建态初始行**同一个工厂**，不另造形状
        tplApplied: false,
        tplAppliedName: '',
        tplPicked: -1,                    // picker 回到「再选这道菜」，否则看着像没清
        calcMode: 'A',
        batchOutput: '',
      });
      this.refreshSpecHints();
      this.checkAmounts();
    };
    if (!hasPrice) { doClear(); return; }
    wx.showModal({
      title: TERMS.card.tplClearTitle,
      content: TERMS.card.tplClearConfirm,
      // ⚠️ confirmText / cancelText 上限 4 字（tools/check_modal_button_len.js 红线）
      confirmText: TERMS.card.tplClearOk,
      cancelText: TERMS.card.tplClearCancel,
      success: (r) => { if (r.confirm) doClear(); },
    });
  },

  // 🔴 R675（李老师：「这道菜属于哪类」可以删除了）：原 `onPickCategory` / `onClearCategory`
  //   / `onToggleEnergy` 三个方法**整段删除**，不是注释掉。
  //
  //   删掉的是什么（三个方法一共扛了 7 件事）：
  //     示例主料行（荤菜→猪肉150克）· 调料每份 0.5 元 · 损耗率 · 出净率（catYieldDefault）
  //     燃气分摊 · 品类标签 catLabel · 估算卡横幅
  //
  //   为什么删：
  //   ① **示例主料是错的起点**：老板建「宫保鸡丁」拿到「猪肉 150 克」，不改就存 ⇒ 一张看着
  //      很赚的假数卡；全删重填 ⇒ 比从零填还多两步。**错的起点比空白更糟。**
  //   ② 调料 0.5 元/份、燃气 0.15~0.4 元/份**都没有出处**（当初按授权拍的）。
  //      燃气更严重：它属**期间费用**（categoryPresets.js:14 会诊已裁定不进单品毛利率），
  //      而 M1 月度支出里已有「燃气费」真实账单 ⇒ 菜品级再分摊一次＝**同一笔钱记两处**。
  //   ③ 出净率改由模板行自带（R674 `YIELD_RULES` 按原料给：里脊 95 / 整鱼 65 / 叶菜 78），
  //      比「按品类一个值兜全部」准得多 —— 这是删品类**必须先做**的前置。
  //
  //   保留：`category` 字段（列表筛选/搜索还在用），入口在「更多设置」里当**纯标签**，不参与任何计算。

  // 子卡选择（picker 按 index 取）
  onComboSubCard(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const opt = this.data.subCardOptions[Number(e.detail.value)];
    if (!opt) return;
    const comboLines = this.data.comboLines.slice();
    // ⚠️ 换了子卡 ⇒ 旧快照作废（否则会把「换了子卡」误报成「子卡成本变了」）
    comboLines[idx] = Object.assign({}, comboLines[idx], { sub_card_ref: opt.card_code, sub_card_name: opt.label, saved_fen: 0 });
    this.setData({ comboLines });
  },
  onComboQty(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const comboLines = this.data.comboLines.slice();
    comboLines[idx] = Object.assign({}, comboLines[idx], { qty: e.detail.value });
    this.setData({ comboLines });
    this.refreshComboStale();
  },

  // ===== R443：三处「说出来」的辅助 =====
  /**
   * 把 {name} 这类占位符替换掉（3 行模板串替换，与 sandbox/matrix 同一写法；不涉及任何计算）。
   */
  // eslint-disable-next-line
  fillTpl(tpl, map) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (map[k] != null ? map[k] : m));
  },

  /**
   * 🔴 R443：套餐成本是**保存时的子卡快照** —— 子卡后来改价/改配方不会自动更新套餐
   *   （`cloudfunctions/syncCostCard/index.js:77` 明确 `card_type === 3` 跳过）。
   *   结果：老板看到的套餐毛利可能是几个月前的成本，**零提示**。
   *   这里只做「告诉你一声」，**绝不自动改数**（与 R406 原料改价同口径：不自动改，但必须让人知道）。
   */
  refreshComboStale() {
    if (this.data.cardType !== '3') {
      if (this.data.comboStaleText) this.setData({ comboStaleText: '' });
      return;
    }
    let n = 0;
    let deltaFen = 0;
    for (const cl of (this.data.comboLines || [])) {
      if (!cl || !cl.sub_card_ref) continue;
      const cur = (this.data.subCards || []).find((s) => s.card_code === cl.sub_card_ref);
      if (!cur) continue;
      const curFen = Math.round(Number(cur.total_cost_fen || 0));   // 整数分
      const savedFen = Math.round(Number(cl.saved_fen || 0));        // 整数分
      if (!(savedFen > 0)) continue;                                 // 没快照（新建行）⇒ 无从判断，不报
      if (curFen === savedFen) continue;
      n += 1;
      deltaFen += (curFen - savedFen) * (Number(cl.qty) || 0);       // 整数分 × 份数，无浮点
    }
    const text = n > 0
      ? this.fillTpl(TERMS.card.comboStaleTip, {
        n: n,
        sign: deltaFen >= 0 ? '+' : '−',
        money: api.fenToYuan(Math.abs(Math.round(deltaFen)), 2),
      })
      : '';
    if (text !== this.data.comboStaleText) this.setData({ comboStaleText: text });
  },

  /**
   * 🔴 R443：新建前查同名 —— 老板很容易建两张「宫保鸡丁」（一张 12.75、一张 11.90），
   *   外卖/团购选卡时不知道选哪张 ⇒ 选错就按错成本算毛利。
   *   ⚠️ 查询失败**放行**（不能因为一次网络抖动挡住保存）。
   * @returns {Promise<boolean>} true = 继续保存
   */
  async confirmDupName(name) {
    const nm = String(name || '').trim();
    if (!nm) return true;
    let list = [];
    try {
      const r = await api.call('getCostCard', {});
      list = (r && r.list) || [];
    } catch (e) { return true; }
    const hit = list.find((x) => String(x.name || '').trim() === nm);
    if (!hit) return true;
    const cost = api.fenToYuan(hit.total_cost_fen || 0, 2);
    return new Promise((resolve) => {
      wx.showModal({
        title: TERMS.card.dupCardTitle,
        content: this.fillTpl(TERMS.card.dupCardTip, { name: nm, cost: cost }),
        cancelText: TERMS.card.dupCardGoEdit,
        confirmText: TERMS.card.dupCardKeepNew,
        success: (res) => {
          if (!res.confirm && hit.card_code) {
            // 去改那张：redirectTo 顶掉当前新建页，避免栈里留一个空白新建页
            wx.redirectTo({ url: '/subpkg/biz/card/edit?card_code=' + hit.card_code });
            resolve(false);
            return;
          }
          resolve(!!res.confirm);
        },
        fail: () => resolve(true),
      });
    });
  },

  addComboLine() {
    this.setData({ comboLines: this.data.comboLines.concat([ensureRid({ sub_card_ref: '', sub_card_name: '', qty: '1' })]) });
  },
  delComboLine(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rest = this.data.comboLines.filter((l, i) => i !== idx);
    this.setData({ comboLines: rest.length ? rest : [ensureRid({ sub_card_ref: '', sub_card_name: '', qty: '1' })] });
  },

  onLoss(e) { this.setData({ lossRate: e.detail.value }); this.scheduleLive(); },
  onAux(e) { this.setData({ auxYuan: e.detail.value }); this.checkAmounts(); this.scheduleLive(); },
  onPrice(e) {
    const patch = { priceYuan: e.detail.value, stickyMargin: this.marginTextOf(this.data.previewCostFen, e.detail.value) };
    // P1 · 套餐本身毛利：售价变动即时重算（仅套餐卡）
    if (this.data.cardType === '3') patch.comboSelfMargin = this.comboSelfMarginOf(this.data.previewCostFen, e.detail.value);
    this.setData(patch);
    this.checkAmounts();
    this.refreshHint();
  },
  onActivityPrice(e) { this.setData({ activityPriceYuan: e.detail.value }); this.checkAmounts(); },
  onCategoryInput(e) { this.setData({ category: e.detail.value }); },
  pickCat(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!ds.cat) return;
    this.setData({ category: ds.cat });
  },
  // 候选分类 = 当前值 + **本店填过的**（记住即复用，火锅店不会每次重打"锅底"）+ 建议池补齐。
  // 上限 14：再多会刷屏，且老板实际用的分类就那么几个。
  // 🔴 R666（李老师反馈）：新建成本卡选「菜品分类」时，候选里冒出「猪肉 200g」这种**食材+用量**的词。
  //
  //   查证过程（都已排除）：预置表 `TERMS.card.dishCats` 是干净的（热菜/凉菜/荤菜…）；
  //   写入点只存 `this.data.category`（老板自己填的）；导入按 `line.category` 匹配、默认空。
  //   ⇒ **代码里找不到「猪肉 200g」变成分类的路径**，根因待定（可能是历史版本留下的脏数据、
  //     或老板手填过）。**所以在入口做防御**：把明显不是分类的值挡在外面。
  //
  //   判据只挡「一眼是食材/用量」的，宁可漏挡不可误挡 ——
  //   「大口吃肉」这种营销栏目名是老板有意为之（R626 已有教训：程序替他改字会造成"我明明填了却变了"）。
  buildCatChips(cur) {
    const seen = [];
    const push = (v) => {
      const s = String(v == null ? '' : v).trim();
      if (s && seen.indexOf(s) < 0) seen.push(s);
    };
    // ⚠️ 当前值**不过滤**：万一已存的就是脏的，要让老板看见、能改；悄悄藏起来等于让他在错误的分类上继续存
    push(cur);
    let hist = [];
    try { hist = wx.getStorageSync(ss.shopKey(EDIT_CATS_KEY)) || []; } catch (err) { hist = []; }
    // 历史里挡掉脏值（R666）—— 历史是自动累积的，脏一条会永久污染候选列表
    if (Array.isArray(hist)) {
      hist.forEach((v) => { if (!catFilter.isDirtyCat(v)) push(v); });
    }
    (this.data.categoryOptions || TERMS.card.dishCats).forEach(push);
    return seen.slice(0, 14);
  },
  onTags(e) { this.setData({ tags: e.detail.value }); },
  onTargetMargin(e) { this.setData({ targetMargin: e.detail.value }); },
  // 真机反馈：改第 N 道菜的原料必须回列表页最顶部 ⇒ 编辑页给直达入口
  goMaterial() { wx.navigateTo({ url: '/subpkg/biz/material/index' }); },
  // R626：团购价移到团购页填 —— 这里只负责把他送过去（路由与 hub 完全一致）
  goGrouponPage() { wx.navigateTo({ url: '/subpkg/biz/groupon/index' }); },

  // ===== round149：用量单位 / 原料换算说明 =====
  // 单条原料的换算说明：采购价 ÷ 换算系数 ÷ 出成率 ⇒ 净料单价（元/克）。
  //   这几步都是**原料档案里已存的**，此处只做展示串联，不重算成本、不改任何落库值。
  specHintOf(m) {
    const f = Number(m.convert_factor) || 0;
    const yr = Number(m.yield_rate) || 0;
    if (!m || !f || !yr) return TERMS.card.matSpecHintEmpty;
    return TERMS.card.matSpecHintOf(
      api.fenToYuan(m.purchase_price_fen || 0, 2),
      m.purchase_unit || TERMS.card.matUnitDefault,
      f, yr,
      ((Number(m.net_unit_cost) || 0) / 10000).toFixed(4)
    );
  },
  refreshSpecHints(lines) {
    const src = lines || this.data.lines;
    const mats = this.data.materials || [];
    const out = src.map((l) => {
      if (l.input_type === 2) return Object.assign({}, l, { spec_hint: '', unit_warn: '' });
      const m = l.material_id ? mats.find((x) => x.id === l.material_id) : null;
      // 🔴 R640：进货价主显（老板的语言）+ 换算公式副显（机器的语言）。
      //   真机实测：整句以「⇒ 净料 0.0783 元/克」收尾，老板只看见克价 ⇒ 涨价也看不出。
      const f = m ? Number(m.convert_factor) || 0 : 0;
      const yr2 = m ? Number(m.yield_rate) || 0 : 0;
      return Object.assign({}, l, {
        spec_hint: m ? this.specHintOf(m) : TERMS.card.matSpecHintEmpty,
        price_main: (m && f && yr2)
          ? TERMS.card.matPriceMain(api.fenToYuan(m.purchase_price_fen || 0, 2), m.purchase_unit || TERMS.card.matUnitDefault)
          : '',
        spec_formula: (m && f && yr2)
          ? TERMS.card.matSpecFormulaOf(f, yr2, ((Number(m.net_unit_cost) || 0) / 10000).toFixed(4))
          : '',
        unit_warn: m ? this.unitWarnOf(m, l) : '',
      });
    });
    this.setData({ lines: out });
  },
  // round151：跨计量族提示（**只提示、不拦截**）。
  //   由来：参考产品在这里栽过 —— 采购单位选「个」、用量单位选「千克」，它静默按 1:1 硬算，
  //   界面直接跳出 ¥6,000,000.00，**一个字都不提示**（2026-09-26 键鼠实测）。
  //   规则：只有「计数族 ↔ 计量族」才算跨族。重量↔体积**不算** —— 既有口径就是 1 毫升≈1 克
  //   （水/油/酱油密度≈1），那是**有意支持**的换算，不该报警。
  unitWarnOf(m, l) {
    const pu = m.purchase_unit || TERMS.card.matUnitDefault;
    const qu = l.qty_unit || units.BASE_UNIT;
    return units.isCrossFamily(pu, qu) ? TERMS.card.unitCrossWarn(pu, qu) : '';
  },
  // 换用量单位：**必须同步换算数值**（1000 克 → 1 千克），否则同一个菜换个单位成本差 1000 倍。
  //   ⚠️ 这是本页最容易写错的一格，守卫 tools/check_unit_convert.js 专盯「只改标签不改数」。
  onQtyUnit(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const next = this.data.qtyUnits[Number(e.detail.value)] || units.BASE_UNIT;
    const lines = this.data.lines.slice();
    const cur = lines[idx] || {};
    const from = cur.qty_unit || units.BASE_UNIT;
    if (from === next) return;
    lines[idx] = Object.assign({}, cur, { qty_unit: next, qty: units.convertQtyText(cur.qty, from, next) });
    this.editLineStripPreset(idx, lines);
    // round151：跨族提示是「用量单位 × 原料采购单位」的函数 ⇒ 换完单位必须重算，
    //   否则提示停在换单位之前的状态（用户看到的是过期提示）。
    this.refreshSpecHints(this.data.lines);
  },

  // ===== 明细行 =====
  // round156：原 `onMaterialChange`（原生 picker 的 bindchange，按下标取）已由
  //   `goPickMaterial` + `onShow` + `applyPickedMaterial` 取代。**不保留死代码**：
  //   留着会让下一个人以为还有第二条选原料的路径（两条路径 = 两份真相）。
  // 切换录入方式（档案 ↔ 手工）
  // 🔴 round129 修复（真机「临时手工录入点不了」根因）：
  //   `radio-group` 的选中值在 `e.detail.value`，而此前读的是 `e.currentTarget.dataset.val`
  //   —— wxml 从未传过 `data-val` ⇒ 恒为 undefined ⇒ 每次都走 else 分支重建为**档案行**，
  //   用户点「临时手工录入」界面毫无变化（看起来就是"点不了"）。
  //   ⚠️ 配套：wxml 的 radio-group 必须带受控 `value`（子 radio 的 checked 仅认初始值）。
  onLineType(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const val = (e && e.detail && e.detail.value) || 'archive';   // 'archive' | 'manual'
    const lines = this.data.lines.slice();
    // 🔴 R675：出净率不再借品类默认值。新建行还不知道是什么原料 ⇒ 先按 100（不做任何损耗假设），
    //   老板选定原料后由 applyPickedMaterial 按**原料**自动带出（草鱼 65 / 里脊 95 / 叶菜 78）。
    lines[idx] = val === 'manual' ? Object.assign(emptyManualLine(), { yield_rate: '100' }) : emptyLine();
    this.commitLines(lines);
  },
  // 手工行：名称 / 单价 / 出成率
  onManualName(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { material_name: e.detail.value });
    this.editLineStripPreset(idx, lines);
  },
  onManualPrice(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { unit_price_yuan: e.detail.value });
    this.editLineStripPreset(idx, lines);
    this.checkAmounts();
  },
  // round151：手工行的**单价单位**（元/X）。
  //   ⚠️ 与「用量单位」是两件事，且**故意不做数值换算**（与 onQtyUnit 相反）：
  //     用量单位变了必须换数（否则同一个菜成本差 1000 倍）；单价单位变了则是
  //     「我报的价本来就按这个单位」—— 老板要的是保住他敲的那个数字
  //     （6 元/斤 改成 6 元/千克 = 我报的就是 6，别替我算成 12）。
  onManualPriceUnit(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const next = this.data.priceUnits[Number(e.detail.value)] || units.BASE_UNIT;
    const lines = this.data.lines.slice();
    const cur = (lines[idx] && lines[idx].price_unit) || units.BASE_UNIT;
    const num = Number(lines[idx] && lines[idx].unit_price_yuan);
    const patch = { price_unit: next };
    // 🔴 R650（李老师两次提到）：切单价单位时**必须换算数值**。
    //   改前是「故意不换算，保住老板敲的那个数」——本意是防手抖，
    //   但后果是：填 6 元/斤 → 切到「克」→ 还是 6 ⇒ 变成 **6 元/克 = 3000 元/斤**，
    //   成本凭空放大 500 倍，且**零提示**。这个错会直接算错菜价，比"手抖"严重得多。
    //   换算后物理量不变（6 元/斤 ≈ 0.012 元/克），老板想改数字再改，只是多一步。
    if (cur !== next && isFinite(num) && num > 0) {
      const fNext = units.factorOf(next);
      const fCur = units.factorOf(cur);
      if (fNext > 0 && fCur > 0) {
        // toPrecision(12) 去掉二进制浮点尾巴（0.012 而不是 0.011999999999999999）
        const conv = Number((num * (fNext / fCur)).toPrecision(12));
        patch.unit_price_yuan = String(conv);
        // 只在真的变了的时候说一句，且不打断（toast 2 秒）
        wx.showToast({
          title: this.fillTpl(TERMS.card.priceUnitConv, { from: num, fromU: cur, to: conv, toU: next }),
          icon: 'none',
          duration: 2000,
        });
      }
    }
    lines[idx] = Object.assign({}, lines[idx], patch);
    this.editLineStripPreset(idx, lines);
  },
  onManualYield(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { yield_rate: e.detail.value });
    this.editLineStripPreset(idx, lines);
  },
  onQty(e) {
    const idx = e.currentTarget.dataset.idx;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { qty: e.detail.value });
    this.editLineStripPreset(idx, lines);
  },
  addLine() { this.commitLines(this.data.lines.concat([emptyLine()])); },

  // ===== P0-3 估算卡：落盘明细行并重算「估算卡」标记（黄标 + 横幅） =====
  // 所有改动明细行的入口都走这里，避免「改了行却忘了更新 hasPreset」的漂移。
  // ===== R624：改了哪行料，成本自己重算（不用再手点）=====
  // 老板的痛：改完用量要往左上角点一下才看到新毛利。填表本就枯燥，还多一步。
  // 做法：停手 900ms 后自动调一次 calcBom，让吸底条的「成本 / 毛利率」自己跳。
  // 🔴 三条纪律：
  //   ① 成本**仍然只在 calcBom 里算** —— 本页不复制引擎（R131 副本等价守卫兜底）。
  //      本地只做「成本 → 毛利率」这一层展示换算（marginTextOf，本来就是展示层）。
  //   ② **静默**：不 setTitle、不 toast、不 showLoading。他改个数，不该被打断。
  //   ③ 算不出来就**保持上次的数**，并把 stale 标出来 —— 宁可显示旧数，不显示假数。
  scheduleLive() {
    // 套餐行改动走子卡聚合，先在单品链路上验证，套餐单独一轮再做
    if (this.data.cardType === '3') return;
    if (this._liveTimer) clearTimeout(this._liveTimer);
    this._liveTimer = setTimeout(() => {
      this._liveTimer = null;
      this.liveCost();
    }, 900);
  },

  // 反算/保存/自动重算共用同一份入参构造，防止三处各拼一套参数而漂移
  buildCalcPayload(opts) {
    const lines = this.buildCalcLines(opts);
    if (!lines || lines.length === 0) return null;
    const mode = this.data.cardType === '3' ? 'A' : this.data.calcMode;
    return {
      lines,
      mode,
      batch_output: mode === 'B' ? Number(this.data.batchOutput) : 0,
      loss_pct: Number(this.data.lossRate) || 0,
      auxYuan: Number(this.data.auxYuan) || 0,
      target_margin_pct: Number(this.data.targetMargin) || 0,
    };
  },

  async liveCost() {
    if (this._liveBusy) return;              // 上一轮还没回来，别叠着发
    const payload = this.buildCalcPayload({ silent: true });
    // 🔴 R635：原来这里 `if (!payload) return;` ——「绝不清空已有结果」本意是防闪烁，
    //   但老板**删掉用量**后成本还挂着旧值（他会拿这个旧数字去定价）。
    //   ⇒ 改成：数字保留，但标记 `previewStale`（横条显示「上次试算」），并刷新「还差哪个数」。
    if (!payload) {
      // 🔴 R637（真机二次实测）：上一轮我只把数字标灰、值仍留着 —— 老板原话
      //   「把用量去掉之后，单份成本那块还是没有变化，卡死在那儿」。
      //   对，**删了用量就算不出来，不该还挂一个数**：那个数是另一份配方的成本。
      //   ⇒ 明细不完整时直接清空（而不是"保留+标灰"）。防闪烁仍由 900ms 防抖负责，
      //     不会有"打一个字就闪"的问题 —— 只有当明细真的不完整时才清。
      this.setData({
        previewCostFen: 0,
        previewCost: '',
        stickyMargin: '',
        previewStale: true,
      });
      this.refreshHint();
      return;
    }
    this._liveBusy = true;
    try {
      const d = await api.call('calcBom', payload);
      const costFen = (d && Number(d.unit_cost_fen)) || 0;
      if (!(costFen > 0)) return;
      this.setData({
        previewCostFen: costFen,
        previewCost: api.fenToYuan(costFen, 2),
        stickyMargin: this.marginTextOf(costFen, this.data.priceYuan),
        previewStale: false,          // R635：算成功了就不再是"上次"
      });
      if (this.data.cardType === '3') {
        this.setData({ comboSelfMargin: this.comboSelfMarginOf(costFen, this.data.priceYuan) });
      }
      this.refreshHint();
    } catch (e) {
      // 静默失败：网络断了就保留上次的试算值，不弹错、不清空
    } finally {
      this._liveBusy = false;
    }
  },

  // ===== R628：回执里加一句「在店里排第几」 =====
  // 🔴 只在**数据全**的时候说（列表未被截断）。卡多时接口会截断且无排序，
  //   在残缺数据上算名次 = 给老板一个错名次，比不给更糟 —— 宁可闭嘴。
  // 口径：只统计「已定价」的卡（price_fen>0 且毛利率有值），未定价的不参与，否则会被当成 0% 拉低所有人。
  rankLine(myMargin, list) {
    if (myMargin == null || !isFinite(Number(myMargin))) return '';
    const arr = (list || [])
      .filter((c) => c && Number(c.price_fen) > 0 && c.gross_margin_pct != null)
      .map((c) => Number(c.gross_margin_pct));
    if (arr.length < 2) return '';
    const better = arr.filter((v) => v > Number(myMargin) + 1e-9).length;
    const rank = better + 1;
    if (rank === 1) return String(TERMS.card.rankFirst).replace('{n}', String(arr.length));
    return String(TERMS.card.rankTpl).replace('{k}', String(rank)).replace('{n}', String(arr.length));
  },

  async showSavedReceipt(receipt, o) {
    // 排名只是加成：取不到就只说回执，绝不因为它失败而影响「已保存」这件事
    let extra = '';
    try {
      const d = await api.call('getCostCard', {});
      if (!dh.isTruncated(d)) extra = this.rankLine(o && o.gross_margin_pct, (d && d.list) || []);
    } catch (e) {
      extra = '';
    }
    wx.showModal({
      title: TERMS.ui.savedDone,
      content: receipt + (extra ? '\n' + extra : ''),
      showCancel: false,
      success: () => wx.navigateBack(),
    });
  },

  // ===== R625：把「还差哪一个数」说清楚 =====
  // 空态原来是「还没算成本 · 试算成本」—— 只说没数，不告诉下一步，老板会反复点、最后放弃。
  // 这里按「加行 → 填用量 → 填售价」的顺序指路，一次只说**一个**缺口（说三个等于没说）。
  liveHint() {
    if (this.data.cardType === '3') return '';   // 套餐走子卡聚合，提示另做
    const lines = this.data.lines || [];
    const named = (l) => !!(l && (l.material_id || String(l.material_name || '').trim()));
    if (!lines.some(named)) return TERMS.card.hintNeedLine;
    const idx = lines.findIndex((l) => named(l) && !(Number(l.qty) > 0));
    if (idx >= 0) return String(TERMS.card.hintNeedQty).replace('{n}', String(idx + 1));
    if (!(Number(this.data.previewCostFen) > 0)) {
      return TERMS.card.stickyEmpty + ' · ' + TERMS.card.stickyRecalc;
    }
    // 这里只判「有没有填」，不做元→分换算 ⇒ 不碰乘 100 的精度口径（金额守卫 C-① 也不该被这行触发）
    if (!(Number(this.data.priceYuan) > 0)) return TERMS.card.hintNeedPrice;
    return '';
  },

  refreshHint() {
    const h = this.liveHint();
    if (h !== this.data.stickyHint) this.setData({ stickyHint: h });
  },

  commitLines(lines) {
    const rn = renumber(lines);
    // 🔴 R675：不再同步 hasPreset / estBanner —— 估算卡机制随品类默认模板一起删掉了
    //   （编辑页已经**不可能**产生 isPreset 行，横幅永远不显示，留着就是死代码）。
    this.setData({ lines: rn });
    this.scheduleLive();          // R624：料一变，成本与毛利率自己跟着变
    this.refreshHint();           // R625：同时更新「还差哪个数」
    return rn;
  },
  // 用户动了某行 → 该行不再是「系统估」（自校正：系统估标记只认未被人碰过的行）
  editLineStripPreset(idx, lines) {
    if (idx >= 0 && lines[idx]) lines[idx] = Object.assign({}, lines[idx], { isPreset: false });
    return this.commitLines(lines);
  },

  // ===== R443：批量粘贴配料（解析在 utils/cardPaste.js，这里只做展示与导入）=====
  onPasteToggle() { this.setData({ pasteOpen: !this.data.pasteOpen }); },
  onPasteInput(e) { this.setData({ pasteText: e.detail.value }); },
  pasteStatusText(r) {
    if (r.status === 'ok') return '';
    if (r.status === 'no_match') return TERMS.card.pasteNoMatch;
    if (r.status === 'bad_unit') return TERMS.card.pasteBadUnit;
    return TERMS.card.pasteBadQty;
  },
  onPasteParse() {
    const r = CardPaste.parseCardPaste(this.data.pasteText, this.data.materials || []);
    const rows = r.rows.map((x) => Object.assign({}, x, { statusText: this.pasteStatusText(x) }));
    this.setData({
      pasteRows: rows,
      pasteOkCount: r.okCount,
      pasteImportLabel: this.fillTpl(TERMS.card.pasteImportBtn, { n: r.okCount }),
    });
  },
  onPasteImport() {
    const ok = (this.data.pasteRows || []).filter((r) => r.status === 'ok' && r.material);
    if (!ok.length) { wx.showToast({ title: TERMS.card.pasteNoOk, icon: 'none' }); return; }
    const add = ok.map((r) => ({
      input_type: 1,
      material_id: r.material.id,
      material_name: r.material.name,
      qty: String(r.qtyText),
      // ⚠️ 存**老板写的单位**，不存折克后的数：保存时 `units.toBase(l.qty, l.qty_unit)` 还要再换算一次
      qty_unit: r.unit,
      spec_hint: '',
      line_kind: 'main',
    }));
    // 全空行先丢掉，别让导入的行上面挂一条空行
    const cur = (this.data.lines || []).filter((l) => l.qty || l.material_id || l.material_name);
    this.commitLines(cur.concat(add));
    this.setData({
      pasteRows: [], pasteText: '', pasteOkCount: 0, pasteImportLabel: '', pasteOpen: false,
    });
    wx.showToast({ title: this.fillTpl(TERMS.card.pasteImported, { n: add.length }), icon: 'success' });
  },
  // round153：删行按钮从「录入方式」那行的红 × 挪到行尾并改名 ⇒ 顺手补上防误触。
  //   规则：**只有这行已经填了东西才问一句**，空行直接删 —— 不为没内容的东西增加摩擦。
  //   ⚠️ wx.showModal 的 confirmText/cancelText 上限 4 字符（真机事故见 terms.js paywall 注释）
  //      ⇒ 「删除」「取消」都在限内，长文案只放 title/content。
  delLine(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const cur = this.data.lines[idx] || {};
    const name = String(cur.material_name || '').trim();
    const filled = !!cur.material_id || !!name || Number(cur.qty) > 0 || Number(cur.unit_price_yuan) > 0;
    const doDel = () => {
      const rest = this.data.lines.filter((l, i) => i !== idx);
      this.commitLines(rest.length ? rest : [emptyLine()]);
    };
    if (!filled) { doDel(); return; }
    wx.showModal({
      title: TERMS.card.delLineTitle,
      content: name ? TERMS.card.delLineConfirmOf(name) : TERMS.card.delLineConfirmBare,
      confirmText: TERMS.card.delLineConfirmOk,
      cancelText: TERMS.buttons.cancel,
      success: (r) => { if (r.confirm) doDel(); },
    });
  },

  // 🔴 R374：吸底条的毛利率 —— 只用**页面上已有的两个数**（售价、上次试算成本），
  //   公式与后端 saveCostCard/service.js 完全一致（两位小数）。
  //   ⚠️ 不在这里重算成本：成本必须走 calcBom（引擎单源），本页**不抄成本算法**。
  marginTextOf(costFen, priceYuan) {
    const p = Math.round(Number(((Number(priceYuan) || 0) * 100).toFixed(10)));
    if (!(p > 0) || !(costFen > 0)) return '';
    return (Math.round(((p - costFen) / p) * 10000) / 100) + '%';
  },

  // 🔴 P1 · 套餐本身毛利（售价 − 套餐成本）：成本走引擎（calcBom / 回填 total_cost_fen），本方法只做展示换算。
  //   返回 { profit: '¥X.XX', rate: 'Y%' }，金额或售价缺失时返回 null（fail-closed，不显示假数）。
  comboSelfMarginOf(costFen, priceYuan) {
    const cost = Number(costFen) || 0;
    const p = Math.round(Number(((Number(priceYuan) || 0) * 100).toFixed(10)));
    if (!(p > 0) || !(cost > 0)) return null;
    const profitFen = p - cost;
    const rate = Math.round((profitFen / p) * 10000) / 100;
    return { profit: (profitFen / 100).toFixed(2), rate: rate + '%' };
  },

  // 反算售价 / 预览成本：调 calcBom（后端纯计算），不本地算
  async reverseCalc() {
    const linesInput = this.buildCalcLines();
    if (!linesInput) return;
    // 🔴 R383：空明细**不许试算**。实测 calcBom 对 `lines: []` 返回 `unit_cost_fen=0 / margin=100`，
    //   吸底条会显示「成本 ¥0.00 · 毛利率 100%」——一个看起来很美的假数（R380 结论②）。
    //   为什么不在引擎里拦：calcCostCard 属禁区；且"空数组"对引擎是合法的（套餐派生等场景）。
    if (linesInput.length === 0) {
      wx.showToast({ title: TERMS.card.needLineForCalc, icon: 'none' });
      return;
    }
    try {
      ui.setTitle(TERMS.card.reverseTitle);
      // 套餐固定按「份」聚合（M3.16：calc_mode 对套餐无意义）⇒ 强制 mode='A'
      const mode = this.data.cardType === '3' ? 'A' : this.data.calcMode;
      const d = await api.call('calcBom', {
        lines: linesInput,
        mode,
        batch_output: mode === 'B' ? Number(this.data.batchOutput) : 0,
        loss_pct: Number(this.data.lossRate) || 0,
        auxYuan: Number(this.data.auxYuan) || 0,
        target_margin_pct: Number(this.data.targetMargin) || 0,
      });
      const rp = d.reverse_price_fen || 0;
      this.setData({
        reversePriceFen: rp,
        previewCostFen: d.unit_cost_fen || 0,
        reverseResultPreview: rp > 0 ? api.fenToYuan(rp, 2) : '',
        previewCost: d.unit_cost_fen ? api.fenToYuan(d.unit_cost_fen, 2) : '',
        stickyMargin: this.marginTextOf(d.unit_cost_fen || 0, this.data.priceYuan),
      });
      if (rp > 0) {
        wx.showToast({ title: TERMS.card.reverseResult + ' ' + api.fenToYuan(rp, 2), icon: 'none' });
      }
      // P1 · 套餐本身毛利：反算拿到套餐成本后即时补算（仅套餐卡）
      if (this.data.cardType === '3') {
        this.setData({ comboSelfMargin: this.comboSelfMarginOf(d.unit_cost_fen || 0, this.data.priceYuan) });
      }
    } catch (e) { api.toastError(e); }
  },

  // 反算结果填入建议售价（用户可再手改）
  applyReverse() {
    if (!this.data.reversePriceFen) { this.reverseCalc(); return; }
    this.setData({ priceYuan: api.fenToYuan(this.data.reversePriceFen, 2) });
  },

  // 🔴 R426（队列 #32）：本页金额栏体检 —— 与 M1 录入页**同一个** `utils/amountInput`、同一套判定。
  //   为什么这页更需要它（比 M1 更狠）：本页金额全是 `Number(x) || 0` 直转（没走 `yuanToFen`），
  //   粘贴「12,000」⇒ `Number` 得 **NaN** ⇒ `Math.round(NaN * 100)` 仍是 NaN ⇒ 提交上云的
  //   `price_fen` / `aux_fen` 变 null 或 0，而 0 是**合法金额** ⇒ 云端校验无从拒 ⇒
  //   成本卡按 0 元落库、毛利率显示照常 ⇒ 老板拿它去定价，**全程零报错**。
  //   🔴 边界（与 R419/R425 同口径）：**只判定、只暴露，不改数** ——
  //     不替老板去掉逗号（`1,5` 可能是欧洲写法 15 或 1.5，猜错比不猜更糟）。
  //   返回：读不成的栏数（onSave 据此拦提交；0 = 全部读得成）。
  checkAmounts() {
    const rows = this.data.specRows || [];
    const lines = this.data.lines || [];
    let n = 0;
    const chk = (v) => { if (!AmountInput.classifyAmount(v).readable) n++; };
    chk(this.data.priceYuan);
    chk(this.data.auxYuan);
    chk(this.data.activityPriceYuan);
    for (let i = 0; i < rows.length; i++) chk(rows[i] && rows[i].priceYuan);
    // 手工行单价（input_type=2）——它直接进净料成本，最不能读错的一格
    for (let j = 0; j < lines.length; j++) {
      if (Number(lines[j].input_type) !== 2) continue;
      chk(lines[j].unit_price_yuan);
    }
    // 🔴 R547（M8）：三项**直接进引擎**的数值栏，原实现一个都不查。它们和金额栏同一个死法
    //   （提交时 `Number(x) || 0`）：填成「1.5%」/「6 0」/全角 ⇒ 静默读成 0 ⇒
    //   损耗率归零（成本偏低）、目标毛利率归零（建议价归零却照常显示）、出货量归零。
    //   不改引擎口径、不改提交写法，只在**体检**这一处把"读不成"暴露出来。
    chk(this.data.lossRate);
    chk(this.data.targetMargin);
    // 出货量：只在模式 B 用（模式 A 提交时强制 0）；但模式 B 下**没填比填错更常见**，
    //   而引擎对 ≤0 是 `out = 1` 兜底（calcBom/service.js:129）⇒ 整批成本被当成**一份**，
    //   成本虚高 N 倍且零提示。这属于"必填却没填"，与"读不成数字"分开记一笔。
    let q = 0;
    if (this.data.calcMode === 'B') {
      const raw = this.data.batchOutput;
      const rr = AmountInput.classifyAmount(raw);
      if (!rr.readable || !(Number(raw) > 0)) q = 1;
    }
    if (q !== this.data.badQtyCount) this.setData({ badQtyCount: q });
    // 🔴 R597：用量栏（克/份）读不成 ⇒ `units.toBase` 返回 0 ⇒ buildCalcLines 里 `continue` **跳过整行**
    //   ⇒ 成本少算、毛利虚高（只有所有行都被跳过时才提示"用量"）。与金额/出货量分开计数、分开讲。
    let u = 0;
    const chkQty = (v) => { if (!AmountInput.classifyAmount(v).readable) u++; };
    for (let i = 0; i < lines.length; i++) chkQty(lines[i] && lines[i].qty);
    if (this.data.cardType === '3') {
      const cl = this.data.comboLines || [];
      for (let i = 0; i < cl.length; i++) chkQty(cl[i] && cl[i].qty);
    }
    if (u !== this.data.badUsageCount) this.setData({ badUsageCount: u });
    // 金额类横幅只数金额（文案讲的是"金额栏"）；出货量/用量各自一条横幅。
    if (n !== this.data.badAmountCount) this.setData({ badAmountCount: n });
    this._badQty = q > 0;
    return n + q + u;
  },

  // 🔴 R297：出成率**上界**校验（手工行）—— 越界**绝不静默回落 100**（那等于替老板编一个数）。
  //   返回第一处越界 { idx, raw }；全部合法返回 null。
  //   为什么必须前置：净料成本 = 单价 ÷ 出成率，出成率 150 ⇒ 成本被 ÷1.5 ⇒ **毛利虚高**，
  //   而云端只收 net_unit_cost 快照、验不到出成率 ⇒ 不在这里拦就一路静默到老板眼前。
  badYieldOf() {
    const lines = this.data.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (Number(l.input_type) !== 2) continue;
      if (units.yieldRateOf(l.yield_rate) === null) return { idx: i, raw: l.yield_rate };
    }
    return null;
  },

  buildCalcLines(opts) {
    // R624：silent=true 供「自动重算成本」用 —— 自动跑的时候不许弹 toast，
    //   老板只是改了个用量，不该被他没点过的提示打断。
    const silent = !!(opts && opts.silent);
    const warn = (msg) => { if (!silent) wx.showToast({ title: msg, icon: 'none' }); };
    const out = [];
    // 🔴 R297：先过出成率上界（反算 / 保存两条路共用，防「试算出的成本也偏低」）
    if (this.badYieldOf()) {
      warn(TERMS.card.yieldRangeErr);
      return null;
    }
    // M3.16 / R190：**套餐也能算**（此前反算区只给单品用，套餐点了没反应）
    //   子卡行 → 引擎行：net_unit_cost = 子卡单份成本(分) × 100（与引擎「万分之一元」同尺度）；quantity = 份数。
    if (this.data.cardType === '3') {
      for (const l of this.data.comboLines) {
        const qty = Number(l.qty) || 0;
        if (!(qty > 0)) continue;
        const sub = this.data.subCards.find((x) => x.card_code === l.sub_card_ref);
        if (!sub || !(Number(sub.total_cost_fen) > 0)) continue;
        out.push({ quantity: qty, net_unit_cost: Number(sub.total_cost_fen) * 100, line_kind: 'main' });
      }
      if (out.length === 0) { warn(TERMS.card.comboSubCardPh); return null; }
      return out;
    }
    for (const l of this.data.lines) {
      if (!l.qty) continue;
      // round149：用量一律换算成**基准单位(克)**再送引擎（引擎口径一字不改）
      const qtyBase = units.toBase(l.qty, l.qty_unit);
      if (!(qtyBase > 0)) continue;
      if (l.input_type === 2) {
        // 手工行：前端算净料单位成本（录入换算），反算与保存用同一值（单源）
        const wan = manualNetUnitWan(l.unit_price_yuan, l.yield_rate, l.price_unit);
        if (wan <= 0) continue;      // 🔴 R297：出成率越界已在 `badYieldOf` 前置拦下并提示，此处兜底
        out.push({ quantity: qtyBase, net_unit_cost: wan, line_kind: normalizeKind(l.line_kind) });
      } else {
        if (!l.material_id) continue;
        const m = this.data.materials.find((x) => x.id === l.material_id);
        if (!m) continue;
        out.push({ quantity: qtyBase, net_unit_cost: m.net_unit_cost, line_kind: normalizeKind(l.line_kind) });
      }
    }
    if (out.length === 0) { warn(TERMS.card.qty); return null; }
    return out;
  },

  // ===== round150（M3.14）组件类型 =====
  pickKind(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const key = e.currentTarget.dataset.kind;
    if (!key) return;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { line_kind: key });
    this.editLineStripPreset(idx, lines);
  },

  // ===== round150（M3.15）规格 =====
  toggleSpec(e) {
    const key = e.currentTarget.dataset.spec;
    this.setData({
      specRows: this.data.specRows.map((r) => (r.spec_key === key ? Object.assign({}, r, { enabled: !r.enabled, result: r.enabled ? null : r.result }) : r)),
    });
  },
  onSpecPrice(e) {
    const key = e.currentTarget.dataset.spec;
    const v = e.detail.value;
    // 🔴 R298Y 修复：**改了售价就必须清掉该行试算结果**。
    //   改前只改 `priceYuan`、保留 `result` ⇒ 老板把该规格从 100 改成 200 后，
    //   该行仍显示**按 100 算出的**毛利率/成本/建议价（`result.marginPct` 直接来自服务端试算入参），
    //   数字看着正常、其实已经过期 —— 而**同一页**的失效策略本来是齐的：
    //     · `toggleSpec`（启用/停用）⇒ `result: ... null ...`
    //   （「同一个修复合集的另一半没做完」——同族病第 4 型。）
    this.setData({
      specRows: this.data.specRows.map((r) => (r.spec_key === key ? Object.assign({}, r, { priceYuan: v, result: null }) : r)),
    });
    this.checkAmounts();
  },
  // R547（M1）：改「这一份多少克」⇒ 该行试算结果作废（成本/毛利/建议价全都随克重变）
  onSpecPortion(e) {
    const key = e.currentTarget.dataset.spec;
    const v = e.detail.value;
    this.setData({
      specRows: this.data.specRows.map((r) => (r.spec_key === key ? Object.assign({}, r, { portionG: v, result: null }) : r)),
    });
    this.checkAmounts();
  },
  // 把某规格行的输入拼成 spec_prices（整数分）；空/非法 ⇒ 该规格不带价（只出成本与建议价）
  specPriceFen(r) {
    const yuan = Number(r.priceYuan);
    if (!isFinite(yuan) || yuan <= 0) return null;
    return Math.round(Number((yuan * 100).toFixed(10)));
  },
  // 提交给云端的规格列表：**只送键 + 售价 + 启用位**（系数/名称由服务端单源补齐）
  // 🔴 R547（M2）：**停用行也必须提交**。改前这里是 `.filter((r) => r.enabled)`
  //   ⇒ 停用的规格一保存就从 `specs_json` 里消失（服务端按"整份覆盖"落库）——
  //   老板以为"我先关掉，以后还能打开"，实际是**永久删除**：下次进编辑页没这一行，
  //   要重新启用只能重新勾选并重新填价，且历史版本里也查不到"曾经有过这个规格"。
  //   服务端 `sanitizeSpecs` 本就保留了 `enabled` 位（`enabled !== false`）⇒ 只是前端没送。
  collectSpecs() {
    return this.data.specRows.map((r) => {
      const pf = this.specPriceFen(r);
      const o = { spec_key: r.spec_key, enabled: !!r.enabled };
      // 没填价 ⇒ 不带 price_fen（服务端缺省 0），但**行本身保留**
      if (pf != null) o.price_fen = pf;
      // R547（M1）：克重随规格一起落库（快照）——它是算 100g 成本的唯一依据。
      //   没填就不带（服务端存 0），页面会提示补；**绝不替老板猜一个克重**（猜错比不给数更糟）。
      if (r.spec_key === 'per100g') {
        const g = Number(r.portionG);
        if (isFinite(g) && g > 0) o.portion_g = g;
      }
      return o;
    });
  },
  // 规格试算：一次调用把启用的规格全部算回来（成本 / 毛利率 / 建议价），并刷新原成本预览
  async calcSpecs() {
    const linesInput = this.buildCalcLines();
    if (!linesInput) return;
    const rows = this.data.specRows.filter((r) => r.enabled);
    if (rows.length === 0) { wx.showToast({ title: TERMS.card.specEmpty, icon: 'none' }); return; }
    const specPrices = {};
    for (const r of rows) {
      const pf = this.specPriceFen(r);
      if (pf != null) specPrices[r.spec_key] = pf;
    }
    // R547（M1）：克重是 per100g 的**必填入参**（没填 ⇒ 云端返回 need_portion，不出数）
    const specPortions = {};
    for (const r of rows) {
      if (r.spec_key !== 'per100g') continue;
      const g = Number(r.portionG);
      if (isFinite(g) && g > 0) specPortions[r.spec_key] = g;
    }
    try {
      ui.setTitle(TERMS.card.specCalc);
      // 套餐固定按「份」聚合（M3.16：calc_mode 对套餐无意义）⇒ 强制 mode='A'
      const mode = this.data.cardType === '3' ? 'A' : this.data.calcMode;
      const d = await api.call('calcBom', {
        lines: linesInput,
        mode,
        batch_output: mode === 'B' ? Number(this.data.batchOutput) : 0,
        loss_pct: Number(this.data.lossRate) || 0,
        auxYuan: Number(this.data.auxYuan) || 0,
        target_margin_pct: Number(this.data.targetMargin) || 0,
        spec_keys: rows.map((r) => r.spec_key),
        spec_prices: specPrices,
        spec_portions: specPortions,
      });
      const byKey = {};
      for (const s of (d.spec_results || [])) {
        // 出参 → 展示字段（页面零计算：元/百分号都在这里格式化，wxml 只摆位）
        byKey[s.spec_key] = {
          spec_key: s.spec_key,
          name: s.name,
          coef: s.coef,
          price_fen: s.price_fen,
          unit_cost_fen: s.unit_cost_fen,
          // R547（M1）：没填克重 ⇒ 云端不出数（need_portion）。这里**不许把 0 元当成本显示**
          //   （0 成本 = 100% 毛利，是最容易被老板当真的错数）⇒ 成本位留空、毛利率不出。
          needPortion: !!s.need_portion,
          costYuan: s.need_portion ? '' : api.fenToYuan(s.unit_cost_fen || 0, 2),
          marginPct: s.need_portion ? null : s.gross_margin_pct,
          suggestYuan: (!s.need_portion && s.reverse_price_fen > 0) ? api.fenToYuan(s.reverse_price_fen, 2) : '',
        };
      }
      this.setData({
        previewCostFen: d.unit_cost_fen || 0,
        previewCost: d.unit_cost_fen ? api.fenToYuan(d.unit_cost_fen, 2) : '',
        stickyMargin: this.marginTextOf(d.unit_cost_fen || 0, this.data.priceYuan),
        specRows: this.data.specRows.map((r) => (r.enabled && byKey[r.spec_key] ? Object.assign({}, r, { result: byKey[r.spec_key] }) : r)),
      });
    } catch (e) { api.toastError(e); }
  },
  // 用「按目标毛利率的建议价」回填该规格售价（老板可再手改）
  useSpecSuggest(e) {
    const key = e.currentTarget.dataset.spec;
    this.setData({
      specRows: this.data.specRows.map((r) => {
        if (r.spec_key !== key || !r.result || !(r.result.reverse_price_fen > 0)) return r;
        return Object.assign({}, r, { priceYuan: api.fenToYuan(r.result.reverse_price_fen, 2) });
      }),
    });
  },

  // 保存 → saveCostCard（后端重算落库；编辑 = 带 card_code 另存新版本）
  async onSave() {
    // 🔴 R547（M5）：读不到卡（loadMissing）⇒ **一律不保存**。
    //   按钮虽然已隐藏，但页面里还有别的入口可能回到保存路径（返回键/二次渲染/未来新增的入口），
    //   这条判据是最后一道闸：保住"空白表单不会被当成用户本意写进版本链"。
    if (this.data.loadMissing) { wx.showToast({ title: TERMS.card.loadMissingRetry, icon: 'none' }); return; }
    if (!this.data.name.trim()) { wx.showToast({ title: TERMS.card.dishName, icon: 'none' }); return; }
    // 🔴 R426（队列 #32）：金额栏读不成 ⇒ **拦在提交前**。为什么必须这里拦：
    //   本页金额走 `Number(x) || 0`，读不成会变成 0 / NaN 一路到云端（0 是合法金额 ⇒ 无从拒），
    //   而 `utils/api.js` 会把后端 fail 的 msg 覆盖成通用文案（R271）⇒ 真出错老板也不知道是哪一格。
    //   横幅只能提醒，**保存这条路必须硬拦**，否则「提示归提示、照样存 0 元卡」。
    if (this.checkAmounts() > 0) {
      // title 留空（系统默认「提示」）—— 不为一句标题新造文案（新增可见文案要走 i18n 三处，代价大于收益）
      // R547（M8）：出货量那条与金额那条**分开讲**，否则老板按"纯数字"去改一格金额，改完还是存不了。
      // R597：三种"读不成/没填"分开讲 —— 金额 / 出货量 / 用量，各自改各自的格。
      const tips = [];
      if (this.data.badAmountCount > 0) tips.push(TERMS.ui.amountBadTip);
      if (this._badQty) tips.push(TERMS.ui.batchOutputBadTip);
      if (this.data.badUsageCount > 0) tips.push(TERMS.card.usageBadTip);
      wx.showModal({ content: tips.join('\n'), showCancel: false, confirmText: TERMS.buttons.gotIt });
      return;
    }
    // 售价低于成本预警（M3.7 #15）：先反算拿成本对比，不阻断保存
    const priceFen = Math.round(Number(((Number(this.data.priceYuan) || 0) * 100).toFixed(10)));
    if (priceFen > 0) {
      const linesInput = this.buildCalcLines();
      if (linesInput) {
        let costFen = 0;
        try {
          const d = await api.call('calcBom', {
            lines: linesInput,
            mode: this.data.calcMode,
            batch_output: this.data.calcMode === 'B' ? Number(this.data.batchOutput) : 0,
            loss_pct: Number(this.data.lossRate) || 0,
            auxYuan: Number(this.data.auxYuan) || 0,
            target_margin_pct: 0,
          });
          costFen = d.unit_cost_fen || 0;
        } catch (e) { /* 预警失败不阻断 */ }
        // 🔴 R675：条件里的 `!hasPreset` 去掉 —— 原来「估算卡不弹警告」是因为按品类估的成本不准，
        //   弹了会误伤。现在没有估算了（成本全部来自模板行自带出净率 + 老板自己填的单价），
        //   **售价低于成本就是真要亏**，必须弹。
        if (costFen > 0 && priceFen < costFen) {
          wx.showModal({
            title: TERMS.card.warnPriceBelowCost,
            content: TERMS.card.warnPriceBelowCost,
            confirmColor: '#e74c3c',
            cancelText: TERMS.buttons.cancel,
            success: (r) => { if (r.confirm) this.doSave(); },
          });
          return;
        }
      }
    }
    this.doSave();
  },

  async doSave() {
    const lines = [];
    // 🔴 R297：保存前同样先过出成率上界（与反算同一入口，两条路口径一致）
    if (this.badYieldOf()) {
      wx.showToast({ title: TERMS.card.yieldRangeErr, icon: 'none' });
      return;
    }
    // M3.16（批次 C）套餐：明细行 = 子卡引用行（sub_card_ref + 份数），不走原料/手工分支。
    if (this.data.cardType === '3') {
      for (const cl of this.data.comboLines) {
        if (!cl.sub_card_ref) { wx.showToast({ title: TERMS.card.comboSubCardPh, icon: 'none' }); return; }
        const qty = Number(cl.qty);
        if (!isFinite(qty) || qty <= 0) { wx.showToast({ title: TERMS.card.comboSubCardQty, icon: 'none' }); return; }
        lines.push({ sub_card_ref: cl.sub_card_ref, qty: qty });
      }
      if (lines.length === 0) { wx.showToast({ title: TERMS.card.comboSubCardPh, icon: 'none' }); return; }
    } else {
      for (const l of this.data.lines) {
        if (!l.qty) continue;
        // round149：同 buildCalcLines —— 提交前换算到基准单位(克)，云端契约与引擎零改动
        const qtyBase = units.toBase(l.qty, l.qty_unit);
        if (!(qtyBase > 0)) continue;
        // round150：组件类型随行上云（规格缩放的唯一依据）；缺省 main（服务端同样兜底）
        const kind = normalizeKind(l.line_kind);
        if (l.input_type === 2) {
          const wan = manualNetUnitWan(l.unit_price_yuan, l.yield_rate, l.price_unit);
          if (wan <= 0) {
            // 🔴 R297：区分「单价没填」与「出成率越界」—— 改前两者共用「单价」提示，
            //   老板填错出成率却被告知"单价有问题"，等于指错路（且越界那条本会**静默按 100 算**）。
            const bad = units.yieldRateOf(l.yield_rate) === null;
            wx.showToast({ title: bad ? TERMS.card.yieldRangeErr : TERMS.card.manualUnitPrice, icon: 'none' });
            return;
          }
          lines.push({
            input_type: 2, name: (l.material_name || '').trim(), qty: qtyBase, net_unit_cost: wan, line_kind: kind,
            // 🔴 R639（真机实测）：把**老板填的原单位**一起送上去。
            //   改前只送 net_unit_cost（折算成元/克）⇒ 二次打开只剩「0.003 元/克」，
            //   而老板是按「3 元/公斤」进货的，对克价完全无感（涨价也看不出来）。
            //   引擎计算**一分不动**（仍用 net_unit_cost），这两个字段只供回显还原。
            price_unit: l.price_unit || units.BASE_UNIT,
            manual_price_fen: api.yuanToFen(l.unit_price_yuan) || 0,
            manual_yield: units.yieldRateOf(l.yield_rate) == null ? 100 : units.yieldRateOf(l.yield_rate),
          });
        } else {
          if (!l.material_id) continue;
          lines.push({ material_id: l.material_id, qty: qtyBase, line_kind: kind });
        }
      }
      if (lines.length === 0) { wx.showToast({ title: TERMS.card.material, icon: 'none' }); return; }
    }
    const card = {
      name: this.data.name.trim(),
      mode: this.data.calcMode,
      lines,
      loss_pct: Number(this.data.lossRate) || 0,
      auxYuan: Number(this.data.auxYuan) || 0,
      priceYuan: Number(this.data.priceYuan) || 0,
      category: this.data.category,
      tags: this.data.tags,
      activity_price_yuan: Number(this.data.activityPriceYuan) || 0,
      // round150：规格只送 **键 + 售价**（系数与可读名由服务端单源补齐并**快照**落库）
      specs: this.collectSpecs(),
    };
    // M3.16：套餐卡类型（3）上云
    if (this.data.cardType === '3') card.card_type = 3;
    if (this.data.calcMode === 'B') card.batch_output = Number(this.data.batchOutput) || 0;
    if (this.data.card_code) card.card_code = this.data.card_code;
    // 分类归一化：只 trim（去首尾空格）。⚠️ 不做"折叠中间空格/同义词归并"——
    //   老板填"大口吃肉"是有意的营销栏目名，程序替他改字会造成"我明明填了却变了"。
    card.category = String(this.data.category || '').trim();
    if (card.category) {
      try {
        const hist = wx.getStorageSync(ss.shopKey(EDIT_CATS_KEY)) || [];
        const arr = Array.isArray(hist) ? hist.slice() : [];
        if (arr.indexOf(card.category) < 0) arr.push(card.category);
        wx.setStorageSync(ss.shopKey(EDIT_CATS_KEY), arr.slice(-40));
      } catch (err) { /* 本地字典失败不影响保存 */ }
    }
    if (this.data.saving) return;   // 连击保护：重复提交会生成两个版本
    // 🔴 H3（2026-10-27 审计）：闸门必须在**首个 await 之前**关上。
    //   原写法先 `await confirmDupName` 再置位 ⇒ 连点两次都能通过上面那行，
    //   回来后各发一次 saveCostCard（幂等键各取 Date.now()）⇒ 落两张同名卡。
    this.setData({ saving: true });
    // 🔴 R443：新建态先查同名卡（编辑态不必查 —— 改的是同一张）
    if (!this.data.isEdit && !(await this.confirmDupName(card.name))) { this.setData({ saving: false }); return; }
    // ⚠️ 必须在 afterSaved 之前取：afterSaved 会把 isEdit 清成 false（转新建态）
    const wasEdit = this.data.isEdit;
    try {
      ui.setTitle(TERMS.buttons.save);
      const out = await api.call('saveCostCard', { card, client_request_id: 'cc_' + Date.now() });
      if (wasEdit) {
        // 编辑态：**改完即走**（老板改的是一道具体的菜，不是要连录一批）。
        //   ⚠️ 这里**不能**走 afterSaved —— 那会把 card_code 清掉，老板以为还在改这道菜。
        // 🔴 R443：保存回执 —— 不只说「已保存」，直接把这张卡的结果报给老板，
        //   他当场就能判断对不对，不用再点进版本页核对。数字全部来自服务端返回值。
        const o = out || {};
        const receipt = this.fillTpl(TERMS.card.savedReceipt, {
          cost: api.fenToYuan(o.total_cost_fen || 0, 2),
          gross: api.fenToYuan(o.gross_profit_fen || 0, 2),
          margin: o.gross_margin_pct != null ? o.gross_margin_pct : '—',
        });
        this.showSavedReceipt(receipt, o);
      } else {
        // round156（新增态）：**不跳走**。改前是 `setTimeout(navigateBack, 600)` —— 存一道菜就被踢回列表，
        //   录 30 道菜要来回 60 次（李老师「100 道菜品，来回查找会很麻烦」的痛点之一）。
        // 🔴 R644（会审 R637）：金额化 —— 老板看得懂「亏 1.2 元」，看不懂「毛利率 18%」。
        //   ⚠️ 出参名有历史包袱：`total_cost_fen` 实为**单份**成本（= result.unit_cost_fen）。
        //   这里只算单份金额；总额必须等老板自己填销量（见 utils/moneyHint.js 头注）。
        const oc = out || {};
        const cFen = Number(oc.total_cost_fen) || 0;
        const gFen = Number(oc.gross_profit_fen) || 0;
        const mh = moneyHint(cFen, cFen + gFen, this.data.targetMargin);
        this.afterSaved(card.name, oc.quota, mh.text);
      }
    } catch (e) {
      this.setData({ saving: false });
      // 🔴 A10（2026-11-05）：套餐已**并入成本卡配额**，云端不再返回套餐专属的 FEATURE_LOCKED
      //   ⇒ 这里不再有 `openPaywall('combo')` 分支。套餐超限走通用配额错误码（FREE_LIMIT_EXCEEDED），
      //   由 `api.toastError` 统一映射成人话，与普通成本卡超限**同一个提示**。
      api.toastError(e);
    }
  },

  // round156：连续录入 —— 保存成功后**留在本页**，清掉这道菜特有的字段，接着录下一道。
  //   🔴 必须清 `card_code` + `isEdit`：否则第二道菜会被当成「编辑第一道」⇒ 后端按同一 card_code
  //      **另存新版本**，第一道菜的内容被静默顶掉。这是**数据正确性**问题，不是手感问题。
  //   ✅ **刻意保留门店级默认**（核算模式 / 损耗率 / 辅料 / 分类 / 标签 / 目标毛利率）：
  //      连续录同一家店的同类菜时这些大概率一样，留着才叫"连续"。
  afterSaved(name, quota, moneyText) {
    // 🔴 R643（会审 R636 段1）：把「还能建 N 张」放进保存成功的常驻条。
    //   只对**未付费**且拿得到额度时提示；编辑已有卡（不占额度）云端 quota 为 null ⇒ 不提示。
    let quotaTip = '';
    if (quota && !quota.is_paid && Number(quota.limit) > 0) {
      const r = Number(quota.remain) || 0;
      quotaTip = r <= 0 ? TERMS.card.quotaUsedUp
        : (r === 1 ? TERMS.card.quotaLastOne : this.fillTpl(TERMS.card.quotaRemainTpl, { n: r }));
    }
    this.setData({
      quotaTip,
      moneyTip: moneyText || '',   // R644：金额化（「每卖一份亏 1.2 元」）
      savedName: name || '',
      saving: false,
      // —— 这道菜特有的：清 ——
      name: '',
      lines: renumber([emptyLine()]),
      priceYuan: '',
      activityPriceYuan: '',
      batchOutput: '',
      reversePriceFen: 0, previewCostFen: 0, reverseResultPreview: '', previewCost: '',
      // 🔴 R297-⑥（审计 M3-B10）：团购那一组**同属「这道菜特有」**，必须跟 priceYuan 一起清。
      // R626：团购那组字段已随输入块一起从本页移除（团购价属于渠道，去团购页填）。
      specRows: freshSpecRows(),
      // M3.16（批次 C）套餐：清空套餐特有字段（连续录入下一道默认回到单品）
      cardType: '1',
      comboLines: [],
      comboInsight: null,
      // M3.20（批次 B 收尾）模板：清空选中项（连续录入下一道回到空模板态）
      tplPicked: -1,
      // —— 编辑态 → 新建态（见上 🔴）——
      isEdit: false,
      card_code: '',
      catChips: this.buildCatChips(this.data.category),
    });
    wx.showToast({ title: TERMS.card.savedOk, icon: 'success' });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    // 🔴 R709：补价模式**没有「连续录入」这个语义** —— 入口是导入页里的某一道菜，
    //   下一道还在导入页等着。留在这页只会得到一片空白精简态（name / lines / priceYuan
    //   上面刚被清空），而横幅仍写着「其余已填好」⇒ **文案与机制不一致**（R406 同族）。
    //   回导入页后 `onShow → confirmSaved` 才会核对这道菜真存上了没并标「已保存」，
    //   这条链才闭合；不回就等于 R704 那个校验在白等。
    //   ⚠️ 900ms 不是拍脑袋：round156 的 600ms 被骂过「存一道菜就被踢回去」，但那是
    //   新建连录场景（一盘 30 道菜要来回 60 次）。补价模式一次就是一道，连录发生在导入页，
    //   性质相反；900ms 只为让「已保存」这条 toast 先露脸，不是拖延。
    if (this.data.patchMode) {
      this._backTimer = setTimeout(() => { this._backTimer = null; wx.navigateBack(); }, 900);
    }
  },

  // 连续录入的显式出口（横幅上的「返回列表」）——不打断，也不把人困在本页
  backToList() {
    // 🔴 R709：补价模式存完会自动回（见 afterSaved）。老板若在 toast 那 900ms 里**抢先**
    //   点了「返回导入，继续下一道」，两个 navigateBack 会叠成「退两层」—— 编辑页 → 导入页
    //   （自动那次）→ M3 枢纽（手动那次），导入页被一闪而过，老板以为这批菜丢了。
    //   所以手动出口必须先撤掉待执行的自动回退。
    if (this._backTimer) { clearTimeout(this._backTimer); this._backTimer = null; }
    wx.navigateBack();
  },
});
