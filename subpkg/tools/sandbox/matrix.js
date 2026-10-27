// subpkg/tools/sandbox/matrix.js —— M2 G1 场景矩阵生成器（2026-10-11 改造）
//
// ⚠️ 计算下沉（铁律不变）：每一行的测算全部由云函数 calcSandbox 算（经新增 matrix action 批量调），
//   本页只做「维度组合 → assembleItems 装配 clean 参数 → 整批送云 → 展示分整数」。
//   前端不编任何保本/摊销/占比公式：占比等展示量要么取自引擎出参，要么是两个已返回数值的简单比值（展示用）。
//
// ⚠️ 免费引流：本页矩阵与导出均免费（G4 李老师拍板），不触发付费墙、不要求先开店铺。
const api = require('../../../utils/api.js');
// R411：金额展示单源（万/元口径与小数位只在这里定，页面不许再各写一份）
const MoneyFmt = require('../../../utils/moneyFmt.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const {
  BIZ_PRESETS, CITY_COEF, assembleItems, resolveBuild, findPreset, bizKeyOfPreset,
  // R297：全局开店投入的年限兜底（与云端 indicatorRef 同口径，不再硬写 1）
  BUILD_DEFAULT_YEARS, buildYearsOf, cashBreakeven } = require('../../../utils/bizPreset.js');
const { deliver } = require('../../../utils/exportFile.js');
// 🔴 R325：开店现金需求（装修/押金/预付/设备/货款）+ 周转金能撑几个月
const OpenCash = require('../../../utils/openCash.js');

const M = TERMS.matrix;

// 🔴 round279 · 模板替换（术语单源：文案在 terms.js，数字在此填，避免 wxml 里拼字符串）
function fmt(tpl, map) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (map[k] != null ? map[k] : ''));
}

// 默认扫维度档位（照搬小面表 + 毛利率 4 档，即「升级」核心）
// 🔴 R335：每个业态的合理人数档位 —— 快餐 2/3 人，火锅与正餐 5/6 人（2 人的火锅店不现实）。
//   这张表替代原来的「全业态都用 2/3 人」。
const LABOR_DIMS = {
  fastfood: [2, 3],
  hotpot: [5, 6],
  dining: [5, 6],
  cafe: [2, 3],
  other: [3, 4],
};

// 🔴 R346：面积按业态给建议值 —— 原来固定 60㎡，而 60㎡ 开火锅和开面馆都不对。
//   面积直接影响：装修估算、水电参考值（房租×占比不涉及面积）、坪效分母。
//   这是**建议值**，老板可以改；手改过就再也不覆盖（fieldTouched.area）。
const AREA_DEFAULT = {
  fastfood: 40,     // 面馆/快餐
  hotpot: 120,      // 火锅/烤肉（含厨房与走道）
  dining: 150,      // 中式正餐（含包间）
  cafe: 30,         // 茶饮咖啡（档口/小店为主）
  other: 60,
};

// 🔴 R345：租金档位按城市给三套 —— 原来县城和一线用同一套 3000~10000，
//   县城老板扫到的全是"不可能租得起"的档，一线老板扫到的全是"根本租不到"的档，两端都失真。
//   档数固定 8 个（与原一致）：行数不变，透视/导出不受影响。
const RENT_DIMS = {
  tier1: [6000, 8000, 10000, 12000, 15000, 18000, 22000, 28000],
  tier23: [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000],
  county: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000],
};

const DEFAULT_DIMS = {
  rent: RENT_DIMS.tier23.slice(),
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
      advDimsShow: M.advDimsShow,
      advDimsHide: M.advDimsHide,
      dimLabor: M.dimLabor,
      dimMargin: M.dimMargin,
      dimTarget: M.dimTarget,
      // 🔴 round276：屏幕表头短名（见 terms.js 同名注释块）—— 只改显示用列，导出 Excel 仍用长名
      colRent: M.colRent,
      matrixSwipeHint: M.matrixSwipeHint,
      matrixEmptyTip: M.matrixEmptyTip,
      matrixReadGrid: M.matrixReadGrid,
      colLabor: M.colLabor,
      colMargin: M.colMargin,
      colTarget: M.colTarget,
      addDim: M.addDim,
      delDim: M.delDim,
      buildLabel: M.buildLabel,
      // 🔴 R529：原 `buildTotalLabel` / `buildYearsLabel` 两行已删 —— terms 全仓**没有这两个键**
      //   （`M.` 取出来恒 undefined），且 wxml/js 也从未引用 ⇒ 纯死映射，留着只会误导后来人
      //   以为"这个键是有的"。全仓 grep 只有这两行本身。
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
      // 🔴 round273：透视表首列表头 + A 场景的"固定月租金"输入标签（初值按默认场景 reverse 给，
      //   进入时 onLoad 会按 `?mode=` 覆盖成对应场景的那一份）
      pivotRowLabel: M.pivotRowLabelRev,
      pivotFixRent: M.pivotFixRent,
      pivotCellBreak: M.pivotCellBreak,
      pivotCellTarget: M.pivotCellTarget,
      backToSandbox: M.backToSandbox,
      toCompare: M.toCompare,
      yuan: M.yuan,
      pct: M.pct,
      person: M.person,
      // 🔴 round279 · #9 矩阵杠杆术语（纯展示增强，引擎零改）
      insightTitle: M.insightTitle,
      insightNone: M.insightNone,
      leverRule: M.leverRule,
      colLever: M.colLever,
      colCushion: M.colCushion,
      colLeverExport: M.colLeverExport,
      colCushionExport: M.colCushionExport,
      cushionBreakEven: M.cushionBreakEven,
      cashTitle: M.cashTitle,
      cashLead: M.cashLead,
      cashRentLabel: M.cashRentLabel,
      cashBudgetLabel: M.cashBudgetLabel,
      cashEquipLabel: M.cashEquipLabel,
      cashStockLabel: M.cashStockLabel,
      cashDepositNote: M.cashDepositNote,
      colLaborFee: M.colLaborFee,
      buildDecorLabel: M.buildDecorLabel,
      buildEquipLabel: M.buildEquipLabel,
      buildFranchiseLabel: M.buildFranchiseLabel,
      buildTransferLabel: M.buildTransferLabel,
      buildTransferAmort: M.buildTransferAmort,
      buildTransferNote: M.buildTransferNote,
      buildYearPh: M.buildYearPh,
      colBreakCash: M.colBreakCash,
      buildYearsUnit: M.buildYearsUnit,
      buildSumNote: M.buildSumNote,
      // 🔴 R529（2026-10-27 审计）：`buildSumOf()`（:748）读 `T.buildSumText`，但这里**一直没映射**
      //   ⇒ 恒走兜底串 `'{total} · {amort}'` ⇒ 那行显示成「15万 · 4167」两个裸数字，
      //   "合计 / 每月摊"四个字凭空消失、零报错（文案在 terms.js 的 matrix 区块里躺着）。
      buildSumText: M.buildSumText,
      beCashNote: M.beCashNote,
      laborTotalHint: M.laborTotalHint,
      // 🔴 R529（2026-10-27 审计）：这两个键**只在 terms.m2 区块**（全仓仅一处），
      //   而本页 `M = TERMS.matrix`（:20）⇒ 原写法 `M.laborUnitLabel` 恒 undefined
      //   ⇒ 「员工月均工资」输入框**没有标签**、下面的说明也空白。改取 m2 区块（不复制键，保持单源）。
      laborUnitLabel: TERMS.m2.laborUnitLabel,
      laborUnitNote: TERMS.m2.laborUnitNote,
      laborTotalLabel2: M.laborTotalLabel2,
      laborTotalNote2: M.laborTotalNote2,
      // 🔴 D4（2026-10-27 拍板）：矩阵补「管理费」输入，与单页（forward）同形状；
      //   留空=不评（默认 0，不自动派生），解决同店两页管理费口径相反（单页 0 / 矩阵原派生 房租×80%）的问题。
      //   文案取自 m2 区块（单源，不复制键）。
      manageOptLabel: TERMS.m2.manageOptLabel,
      manageOptNote: TERMS.m2.manageOptNote,
      fixedBreakTitle: M.fixedBreakTitle,
      fixedBreakNote: M.fixedBreakNote,
      fixedBreakRent: M.fixedBreakRent,
      fixedBreakLabor: M.fixedBreakLabor,
      fixedBreakUtility: M.fixedBreakUtility,
      fixedBreakOther: M.fixedBreakOther,
      cashYuanPh: M.cashYuanPh,
      // 🔴 下面这些是 buildCash() 里直接读 T.xxx 的键 —— 少一个就是 undefined（文案变成空/报错，且不报任何错）
      cashNeedText: M.cashNeedText,
      cashPartsText: M.cashPartsText,
      cashEquipMissing: M.cashEquipMissing,
      cashStockMissing: M.cashStockMissing,
      cashRemainText: M.cashRemainText,
      cashLevelSafe: M.cashLevelSafe,
      cashLevelTight: M.cashLevelTight,
      cashLevelDanger: M.cashLevelDanger,
      cashLevelShort: M.cashLevelShort,
      cashNeedBudget: M.cashNeedBudget,
      cashIncompleteNote: M.cashIncompleteNote,
      cashWan: M.cashWan,
      // 🔴 R528：明细表「更多列」开关的文案（默认只显示 6 列，其余 8 列点开才显示）
      moreCols: M.moreCols,
      lessCols: M.lessCols,
    },
    // 🔴 R332 修 bug：原先名字只拼「大类·预设」⇒ 同大类的两个细分（半自助 / 烤肉）**显示成一模一样**，
    //   老板选哪个都看不出区别。现改为「大类 · 细分」；通用兜底不加大类前缀（否则重复成一串）。
    // 🔴 R524：与 `sandbox/index.js` 的 DISPLAY_KEYS **同一套 5 项、同一套名字**
    //   （4 大类 + 通用兜底，通用放最后）。此前这里是全量 14 个预设 ⇒ 同一家店在
    //   「已有铺面」页和「场景矩阵（寻找铺面）」页看到的经营类型不一样，且名字拼成
    //   「中式正餐 · 中式正餐（川湘粤家常菜）」这种重复串。
    //   ⚠️ 两个页面必须同步改（本数组改动后，下面的 presetIdx 语义仍指向本数组）。
    //   ⚠️ 顺序也与 index 页一致：**通用在最前**（默认不预设业态，避免"默认按面馆算"的误导）。
    presets: ['other', 'fastfood_noodle', 'dining_sichuan', 'hotpot_half_self', 'cafe_tea']
      .map((k) => {
        const hit = BIZ_PRESETS.find((x) => x.presetKey === k);
        if (!hit) return null;
        const label = k === 'other'
          ? TERMS.m2.presetNone
          : (TERMS.m2.presetDisplay[k] || TERMS.m2.bizPresets[k] || k);
        return { key: k, name: label };
      })
      .filter(Boolean),
    presetIdx: 0,
    cityIdx: 1, // tier23
    dims: {
      rent: DEFAULT_DIMS.rent.slice(),
      // 🔴 R335：人数档位回来了（按业态给默认，见 LABOR_DIMS）——
      //   矩阵的核心价值是"多请一个人会怎样"，去掉这一维就只剩单价推演了。
      labor: DEFAULT_DIMS.labor.slice(),
      margin: DEFAULT_DIMS.margin.slice(),
      target: DEFAULT_DIMS.target.slice(),
    },
    // 🔴 R336：开店投入拆 4 项、各自年限（原来「一个总额 + 一个年限」把 5 年摊的设备压成 3 年
    //   ⇒ 月摊销虚高 11~20% ⇒ 保本线连锁虚高）。转让费默认**不摊**（买位置，不是可摊资产）。
    global: {
      area: 60,
      buildDecorYuan: '', buildDecorYears: 3,
      buildEquipYuan: '', buildEquipYears: 5,
      buildFranchiseYuan: '', buildFranchiseYears: 3,
      buildTransferYuan: '', buildTransferYears: 3, buildTransferAmort: false,
      laborTotalYuan: '', laborUnitYuan: '', manageYuan: '',
    },
    // 合计 / 每月摊销 一行话（纯展示派生，改任一项就跟着变）
    buildSumText: '',
    // 🔴 R331：老板手改过毛利率档位 ⇒ 切业态时不再覆盖（与 index 页 fieldTouched 同一判据）
    fieldTouched: { margin: false, labor: false, unit: false },
    // 🔴 round273：多一个 `rent` —— A 场景透视主轴是毛利率 ⇒ 被固定住的是月租金（反之亦然）
    pivotFix: { margin: 55, labor: 2, rent: 5000 },
    // 🔴 round273 · 场景：'forward' 已有铺面（店已开，扫毛利率）/ 'reverse' 寻找铺面（扫租金档位）。
    //   ⚠️ 默认 reverse：本页最初就是按「扫租金档位」造的（G1），**保持原行为不回退**；
    //      只有从沙盘页带 `?mode=forward` 进来才切成 A 场景口径。
    // 🔴 R322：高级维度（毛利率/人工）默认收起 —— 小白只填租金与目标利润
    advOpen: false,
    // 🔴 R528：明细表默认只显示 6 列。14 列 × 200rpx ≈ 1400px，手机上只能看到 2 列半
    //   ⇒ 老板在表里根本比较不了。默认给「房租/人工/目标利润/保本月营收/目标月营收/回本」6 列，
    //   其余 8 列（人工费/毛利率/现金保本/保本日营收/目标日营收/房租占比/涨租需多卖/淡季安全垫）
    //   收进「更多列」。⚠️ 只影响屏幕显示，**导出 Excel 仍是全 14 列**（R349 对齐判据不受影响）。
    colsOpen: false,
    narrow: false,   // R378：窄屏才显示横滑提示（width < 400）
    advNote: '',
    // 🔴 R325：现金卡输入。租金默认跟透视表的固定租金走（老板已在页面上填过），只需再给一个「手上现金」
    cash: { rentYuan: 5000, budgetYuan: '', equipYuan: '', stockYuan: '' },
    cashRes: null,
    // 🔴 R331：固定费用构成（对不上账就是 null，不显示）
    fixedBreak: null,
    // 🔴 R333：人数档位的有效性提示（空=不提示）
    laborHint: '',
    mode: 'reverse',
    pivotRowDim: 'rent',   // 透视表**行**维度：forward ⇒ margin，reverse ⇒ rent
    loading: false,
    // 🔴 R525：「其他杂支占营业额 %」由单测页经 URL 带进来（`?other=`）。
    //   null = 没带（按业态预设 2% 算）；0 = 老板明确不要这项（从入参里剔除）。
    //   为什么必须带：否则单页改成 0 后，矩阵仍按 2% 算 ⇒ 同一家店两个页面给出不同保本额，
    //   而且**零报错**（R292 同族：数字不一致比算错更难发现）。
    otherPct: null,
    exporting: false,
    result: null, // { rows:[], view, count, pivot }
  },

  onLoad(options) {
    // 🔴 R378：矩阵 14 列 ≈ 1400px，手机屏只能看到 2 列半 ⇒ 窄屏给一句横滑提示。
    try { const wi = wx.getSystemInfoSync(); this.setData({ narrow: (wi.windowWidth || 375) < 400 }); } catch (e) {}
    const opt = options || {};
    const mode = (opt.mode === 'forward') ? 'forward' : 'reverse';
    // 🔴 round273：按进来的场景切「透视行维度」与标题/引导语（维度**全保留**，只是透视主轴不同 ——
    //   A 也可以扫租金做敏感性分析，故不删维度，只换默认主轴）。
    const pivotRowDim = mode === 'forward' ? 'margin' : 'rent';
    const patch = {
      mode,
      pivotRowDim,
      // 🔴 R525：接住单测页带过来的「其他杂支 %」（没带 ⇒ null ⇒ 仍按业态预设）
      otherPct: (opt.other === undefined || opt.other === '' || !isFinite(Number(opt.other)))
        ? null : Number(opt.other),
      't.title': mode === 'forward' ? M.titleFwd : M.titleRev,
      't.subtitle': mode === 'forward' ? M.subtitleFwd : M.subtitleRev,
      't.pivotRowLabel': mode === 'forward' ? M.pivotRowLabelFwd : M.pivotRowLabelRev,
    };
    // 🔴🔴 R366（李老师 2026-10-19）：「已有店铺的矩阵」和「寻找铺面的矩阵」原来**是同一张表**——
    //   默认（高级维度收起）两种模式都只扫 8 个**租金档**（onGenerate: advOpen ? dims : slice(0,1)）。
    //   而房租对已有店铺是**既定前提**（房东报价，签了就是签了），扫它等于给老板看一堆与他无关的假设。
    //   他真正能动的只有：请几个人、毛利率定多少、目标利润要多少。
    //   ⇒ 已有铺面（forward）：房租**固定成他填的那一档**（不再作为扫描维），改扫
    //      「人工（当前人数 / +1 人）× 毛利率（±5%）× 目标利润」；
    //      reverse（寻找铺面）保持原样：扫 8 个租金档 —— 那才是"还没签、可以选"的人该看的。
    if (mode === 'forward') {
      const tiers = ['tier1', 'tier23', 'county'];
      const cityTier = tiers[this.data.cityIdx] || 'tier23';
      const rentPool = RENT_DIMS[cityTier] || RENT_DIMS.tier23;
      const presetNow = findPreset(this.data.presets[this.data.presetIdx].key);
      const bk = presetNow ? presetNow.bizKey : '';
      const laborDef = LABOR_DIMS[bk] || [2, 3];
      const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n) : 0; };
      // 房租：优先用首页填的实际房租；没传就用本城市中位档（说明见页面副标题）
      const rentIn = num(opt.rent);
      const rentAnchor = rentIn > 0 ? rentIn : rentPool[Math.floor(rentPool.length / 2)];
      // 人工：当前人数 + 1 人 —— 矩阵的核心问句是「多请一个人会怎样」（R335 注释原话）
      const laborBase = num(opt.labor) || laborDef[0];
      const labor = [laborBase, laborBase + 1];
      // 毛利率：他现在的毛利率，上下各 5 个百分点（越界不收）
      const mIn = Number(opt.margin);
      const margin = isFinite(mIn) && mIn > 0
        ? [mIn - 5, mIn, mIn + 5].map((x) => Math.round(x)).filter((x) => x > 0 && x < 100)
          .filter((x, i, a) => a.indexOf(x) === i)
        : [55, 60, 65];
      // 目标利润：0（保本）+ 他填的目标
      const tIn = num(opt.target);
      const target = tIn > 0 ? [0, tIn] : [0, 10000];
      patch.advOpen = true;          // 展开"高级维度"，否则下面这些档位不参与扫描
      patch['dims.rent'] = [rentAnchor];
      patch['dims.labor'] = labor;
      patch['dims.margin'] = margin;
      patch['dims.target'] = target;
      // 副标题里把"房租已固定"讲明白 —— 否则老板会以为页面还是让他扫租金
      patch['t.subtitle'] = String(M.subtitleFwdLocked || '').replace('{rent}', String(rentAnchor));
    }
    this.setData(patch);
    // 🔴 R322：收起态下要显示「按毛利率 X% · 人工 N 人测算」，进页就先把这句算好
    this.setData({ advNote: this.buildAdvNote() });
    this.syncBuildDefault();
  },

  // 切换业态预设时，把「开店一次性投入」默认值带出来（有 buildRef 才带，否则留空让用户填）
  syncBuildDefault() {
    const p = findPreset(this.data.presets[this.data.presetIdx].key);
    const ref = (p && p.buildRef) || [];
    const by = {};
    for (let i = 0; i < ref.length; i++) by[ref[i].key] = ref[i];
    // 🔴 R336 修 bug：原来这里 setData 整个 `global` **替换**成只有 area/buildTotal/buildYears 的对象
    //   ⇒ 切业态会把老板填的「人工总额 / 人均工资」**清空**（R335 引入后实测存在，静默丢输入）。
    //   改为在原对象上合并：只覆盖 4 项投入。
    const g = Object.assign({}, this.data.global);
    const fill = (key, yuanKey, yearsKey, defYears) => {
      const b = by[key];
      if (b) {
        g[yuanKey] = String(Math.round(Number(b.fen) / 100));
        g[yearsKey] = buildYearsOf(key, b.years);
      } else {
        g[yuanKey] = '';
        g[yearsKey] = BUILD_DEFAULT_YEARS[key] || defYears;
      }
    };
    fill('decor', 'buildDecorYuan', 'buildDecorYears', 3);
    fill('equip', 'buildEquipYuan', 'buildEquipYears', 5);
    fill('franchise', 'buildFranchiseYuan', 'buildFranchiseYears', 3);
    fill('transfer', 'buildTransferYuan', 'buildTransferYears', 3);
    // 🔴 R346：面积跟着业态走，但**手改过就不动**（老板量过自己的铺子，比预设可信）
    if (!this.data.fieldTouched.area) {
      const bk = (p && p.bizKey) || 'other';
      g.area = AREA_DEFAULT[bk] || AREA_DEFAULT.other;
    }
    this.setData({ global: g }, () => this.setData({ buildSumText: this.buildSumOf() }));
  },

  onPresetChange(e) {
    const idx = Number(e.detail.value);
    const p = this.data.presets[idx] ? findPreset(this.data.presets[idx].key) : null;
    const patch = { presetIdx: idx };
    // 🔴 R331：矩阵页原先毛利率档位**硬编码 45% 起步、切业态不变**，而 index 页用的是业态预设值
    //   （面馆 63% / 火锅 53% / 咖啡 67%）⇒ 同店两页保本点最多差 49%。
    //   这里只改「第一档」（高级维度收起时就是它），且老板手改过就不动。
    const g = p && p.params && p.params.grossMarginPct ? Number(p.params.grossMarginPct.v) : 0;
    if (g > 0 && !this.data.fieldTouched.margin) {
      const dims = this.data.dims;
      dims.margin[0] = g;
      patch.dims = dims;
    }
    // 🔴 R335：换了业态 ⇒ 人数档位与人均都跟着换（快餐 2/3 人、火锅正餐 5/6 人）。
    //   老板手改过人数档位就不动。
    const bk = p ? p.bizKey : '';
    const ld = LABOR_DIMS[bk];
    if (ld && !this.data.fieldTouched.labor) {
      const dims2 = patch.dims || this.data.dims;
      dims2.labor = ld.slice();
      patch.dims = dims2;
    }
    const u = p && p.params && p.params.laborUnitYuan ? Number(p.params.laborUnitYuan.v) : 0;
    if (u > 0 && !this.data.fieldTouched.unit) patch.global = Object.assign({}, this.data.global, { laborUnitYuan: String(u) });
    this.setData(patch, () => { this.syncBuildDefault(); this.setData({ laborHint: this.laborHintOf() }); });
  },
  onCityChange(e) {
    const idx = Number(e.detail.value);
    const patch = { cityIdx: idx };
    // 🔴 R345：切城市必须换租金档位（手改过就不动 —— 老板自己敲的档位比预设更可信）
    if (!this.data.fieldTouched.rent) {
      const tier = (this.data.t.cityTiers || [])[idx] || {};
      const dims = this.data.dims;
      dims.rent = (RENT_DIMS[tier.key] || RENT_DIMS.tier23).slice();
      patch.dims = dims;
    }
    this.setData(patch);
  },

  // ===== 维度档位编辑 =====
  onDimInput(e) {
    const { dim, idx } = e.currentTarget.dataset;
    const val = e.detail.value;
    const dims = this.data.dims;
    dims[dim][idx] = val;
    // 🔴 R331：改了毛利率档位就标记为"手改过" ⇒ 之后切业态不再用预设值覆盖它
    if (dim === 'margin') this.setData({ dims, 'fieldTouched.margin': true });
    else if (dim === 'labor') this.setData({ dims, 'fieldTouched.labor': true });
    // 🔴 R345：改过租金档位就是"手改过" —— 没有这一行，onCityChange 的保护就是空修复
    else if (dim === 'rent') this.setData({ dims, 'fieldTouched.rent': true });
    else this.setData({ dims });
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
    const patch = { global };
    // 🔴 R346：老板手改面积 ⇒ 之后切业态不再用建议值覆盖
    if (key === 'area') patch['fieldTouched.area'] = true;
    // 🔴 R351：人均工资同病 —— `onPresetChange` 里读了 `fieldTouched.unit`，
    //   但**全文件从来没有把它置 true** ⇒ 保护条件恒为真 ⇒ 老板手填 7000，
    //   一切业态就被预设值（5000/5500）**静默换掉**，页面上不会提示任何变化。
    //   ⇒ 读标记的地方，必须同时有写标记的地方（这条已入判据）。
    if (key === 'laborUnitYuan') patch['fieldTouched.unit'] = true;
    // 🔴 R333：填了人工总额之后，"人数是否影响人工"的结论会变，提示要跟着变
    if (key === 'laborTotalYuan') patch.laborHint = this.laborHintOf();
    this.setData(patch, () => {
      // 🔴 R336：投入 4 项任一项或年限变了 ⇒ 合计/月摊销必须跟着变（否则显示旧数）
      if (String(key).indexOf('build') === 0) this.setData({ buildSumText: this.buildSumOf() });
    });
  },

  // 🔴 R333：人数档位到底有没有用 —— 有些业态人工是固定额（火锅半自助 = 25000 写死），
  //   改人数完全不影响结果。界面上必须说清，否则老板调了半天以为系统坏了。
  //   三种情形：填了总额 ⇒ 人数只影响人效；labor_total/headcount_linear ⇒ 人数有效；fixed ⇒ 明说固定额。
  // 🔴 R347 清理死逻辑：R333 曾为「人工 = 固定额」的业态写过一条提示
  //   （"本业态人工按固定 X 元/月"），但 R335 把火锅的 `fixed 25000` 改成了 `labor_total`
  //   ⇒ 实测 **13 个业态已全部是 labor_total** ⇒ 那段分支永远走不到，是死代码。
  //   现在只剩一种有效提示：老板直接填了人工总额时，告诉他"人数只影响人效"。
  laborHintOf() {
    const T = this.data.t;
    if (Number(this.data.global.laborTotalYuan) > 0) return T.laborTotalHint;
    return '';
  },

  // ===== 🔴 R325：钱够不够开 · 能撑几个月 =====
  //   定位：矩阵答「稳态能不能赚钱」（要卖多少才保本），这块答「有没有命等到稳态」。
  //   老板自己会算够不够，但他系统性漏算四笔：押金 / 预付租金 / 首批货款 / 开业前爬坡期。
  onCashInput(e) {
    const key = e.currentTarget.dataset.key;
    const cash = this.data.cash;
    cash[key] = e.detail.value;
    this.setData({ cash });
    this.buildCash();
  },

  // 从矩阵结果反推「每月固定支出」。
  //   🔴 引擎口径（cloudfunctions/calcSandbox/service.js:100）：保本营收 = 固定费用 ÷ 综合毛利率
  //      ⇒ 固定费用 = 保本营收 × 毛利率。
  //      这里用页面展示的毛利率（grossMarginPct）反推；若存在平台佣金，算出来的固定费用**略偏高**
  //      ⇒ 能撑月数偏少 ⇒ 结论偏保守（安全方向，宁可说紧不说松）。
  //   取「目标利润 = 0（保本行）」且租金最接近老板填的那一档。
  fixedMonthlyYuan(rentYuan) {
    const rows = (this.data.result && this.data.result.rows) || [];
    let best = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.invalid || r.breakMonthly == null || r.targetYuan !== 0) continue;
      if (!best || Math.abs(r.rent - rentYuan) < Math.abs(best.rent - rentYuan)) best = r;
    }
    if (!best) return null;
    // 🔴 R336 修双计：必须用**不含摊销**的固定费用。
    //   原因：「签约到开业要拿」里已经把装修/设备一次性扣掉了；若每月净流出再用**含摊销**的固定费用，
    //   同一笔装修钱被扣两次 ⇒ 剩余现金被高估消耗 ⇒ 能撑月数被**低估**（方向保守，但账是错的）。
    //   摊销不是现金流出 —— 它只是把已经花掉的钱摊到账上。
    if (best.fixedExAmort != null && best.fixedExAmort > 0) {
      // 行里的固定费用是按「该行档位租金」算的；老板填的租金可能不在档位上（如填 5500、最近档 5000）
      // ⇒ 用房租金替换档位租金，避免房租部分跟着档位走。
      const rentDelta = rentYuan - (Number(best.rent) || 0);
      // 🔴 R530（2026-10-27 审计 P2）：**必须 Number()** —— `fixedExAmort` 来自
      //   `api.fenToYuan()`（utils/api.js:88-92 `v.toFixed(d)`），返回的是**字符串**。
      //   不转数字时 `"14250" + 0` = `"142500"`（放大 10 倍）、`"14250" + 3000` = `"142503000"`（放大 1 万倍）
      //   ⇒ 「每月净流出」暴涨 ⇒ 「能撑几个月」恒判「危险」，真值 6.5 个月/safe 的店会被自己的工具吓退。
      return Math.round(Number(best.fixedExAmort) + rentDelta);
    }
    // 兜底（旧结果没有该字段）：仍按「保本营收 × 毛利率」反推，宁可保守
    return Math.round(best.breakMonthly * best.marginPct / 100);
  },

  buildCash() {
    const T = this.data.t;
    const c = this.data.cash;
    const area = Number(this.data.global.area) || 0;
    const rentYuan = Number(c.rentYuan) || 0;
    const budgetYuan = Number(c.budgetYuan) || 0;
    // 金额换算一律走统一入口（check_money_precision：页面内不得手写 * 100）
    const y2f = (v) => api.yuanToFen(v);

    // 金额显示：≥1 万用「万」，否则用「元」（单位都取自 terms，不硬写中文）
    // R411：走单源（分→元→万 的阈值换算收进 utils/moneyFmt.js）
    const money = (fen) => MoneyFmt.formatFen(fen, { wanUnit: T.cashWan, yuanUnit: T.yuan });
    const fill = (tpl, map) => fmt(tpl, map);

    const fixedMonthly = this.fixedMonthlyYuan(rentYuan);
    const r = OpenCash.estimateOpenCash({
      areaM2: area,
      rentFen: y2f(rentYuan),
      budgetFen: y2f(budgetYuan),
      equipFen: y2f(c.equipYuan),
      stockFen: y2f(c.stockYuan),
      fixedMonthlyFen: y2f(fixedMonthly),
    });

    if (!r.ok) { this.setData({ cashRes: null }); return; }

    const partsText = fill(T.cashPartsText, {
      decor: money(r.decorFen),
      deposit: money(r.depositFen),
      prepay: money(r.prepayFen),
      equip: r.equipMissing ? T.cashEquipMissing : money(r.equipFen),
      stock: r.stockMissing ? T.cashStockMissing : money(r.stockFen),
    });

    // 🔴 缺设备/货款 ⇒ 上面的现金需求只是**下限**，此时不给「够/能撑几个月」的结论。
    //   反例：60㎡/租5000 只算装修+押金+预付是 7.4 万，看起来能撑 11 个月；
    //   但补上 8 万设备后只剩 4.6 万、只撑 4 个月 —— 先报「够」就是把人往坑里带。
    //   例外：连**下限**都不够（short）是确定性结论，照报。
    const incomplete = r.equipMissing || r.stockMissing;
    let verdictText = '';
    let levelCls = '';
    if (!r.budgetFen) {
      verdictText = T.cashNeedBudget;
    } else if (r.level === 'short') {
      verdictText = fill(T.cashLevelShort, { gap: money(-r.remainFen) });
      levelCls = 'warn';
    } else if (r.level === 'danger') {
      verdictText = fill(T.cashLevelDanger, { remain: money(r.remainFen) });
      levelCls = 'warn';
    } else if (incomplete) {
      verdictText = T.cashIncompleteNote;
    } else if (r.level === 'tight') {
      verdictText = fill(T.cashLevelTight, { m: String(r.runwayMonths) });
      levelCls = 'warn';
    } else if (r.level === 'safe') {
      verdictText = fill(T.cashLevelSafe, { m: String(r.runwayMonths) });
      levelCls = 'ok';
    } else {
      // 有剩余但算不出月固定支出（该档位无有效保本行）—— 只说剩多少，不编月数
      verdictText = r.remainFen >= 0
        ? fill(T.cashRemainText, { remain: money(r.remainFen) })
        : fill(T.cashLevelShort, { gap: money(-r.remainFen) });
      levelCls = r.remainFen >= 0 ? '' : 'warn';
    }

    this.setData({
      cashRes: {
        needText: fill(T.cashNeedText, { need: money(r.cashNeedFen) }),
        partsText,
        // 🔴 未填设备/货款 ⇒ 明确说「实际更多」，绝不让下限当成完整数（R324 的 equipMissing/stockMissing）
        noteText: '',
        verdictText,
        levelCls,
      },
    });
  },

  // 🔴 R334：本业态的「人工参考值」—— 老板没填时用它兜底，并**明说是参考值**。
  //   来源：costMeta 里的 defaultYuan（如火锅 25000）；没有则按「人均 × 2 人」折一个（面馆 9000）。
  //   🔴 不给 0：labor_total 分支乘 0 会让保本虚低，是最危险的方向。
  laborRefYuan(preset) {
    if (!preset) return 0;
    const m = (preset.costMeta || []).filter((x) => x.itemKey === 'labor')[0];
    if (m && Number(m.defaultYuan) > 0) return Number(m.defaultYuan);
    const u = preset.params && preset.params.laborUnitYuan ? Number(preset.params.laborUnitYuan.v) : 0;
    if (u > 0) return Math.round(u * 2);
    return 0;
  },

  // 🔴 R334：实际采用的人工总额 = 老板填的；没填则用参考值。
  laborEffYuan(preset) {
    const v = Number(this.data.global.laborTotalYuan);
    if (v > 0) return v;
    const ref = this.laborRefYuan(preset);
    return ref > 0 ? ref : undefined;
  },

  // 🔴 R332：某一行的人工成本（元/月）—— 给明细表加「人工/月」列。
  //   🔴 必须走 assembleItems，不能自己按「人数 × 工资」算：
  //     · 面馆是 labor_total（人数 × 预设工资 × 城市系数）
  //     · **火锅半自助是 fixed 25000（跟人数完全无关）** ⇒ 自己乘就会算错。
  laborOf(rentYuan, laborN) {
    const preset = findPreset(this.data.presets[this.data.presetIdx].key);
    if (!preset) return null;
    const tiers = ['tier1', 'tier23', 'county'];
    const coef = CITY_COEF[tiers[this.data.cityIdx] || 'tier23'] || CITY_COEF.tier23;
    // 🔴 R335：与 buildClean 同口径 —— 总额优先，否则 人数 × 人均
    const lt = Number(this.data.global.laborTotalYuan);
    const un = Number(this.data.global.laborUnitYuan);
    const { fixedItems } = assembleItems(preset, {
      area: Number(this.data.global.area) || 0,
      headcount: laborN,
      rentYuan,
      laborTotalYuan: lt > 0 ? lt : undefined,
      laborUnitYuan: (lt > 0 || !(un > 0)) ? undefined : un,
      fixedYuan: { rent: rentYuan, manage: this.data.global.manageYuan },
      buildItems: this.buildItems(),
    }, coef);
    let fen = 0;
    for (let i = 0; i < fixedItems.length; i++) {
      if (fixedItems[i].key === 'labor') fen += Number(fixedItems[i].fen) || 0;
    }
    return fen > 0 ? Math.round(fen / 100) : null;
  },

  // 🔴 R331：固定费用构成 —— 让老板能核对「这个保本点是怎么来的」。
  //   做法：用**同一个** assembleItems（前端同源）把固定项重算一遍；
  //   🔴 与引擎返回的 fixed_ex_amort 对账，差 >1 元就整个不显示 —— 宁可不说，也不给一个对不上的拆项。
  fixedBreakOf() {
    const r = this.data.result;
    if (!r || !r.rows || !r.rows.length) return null;
    const row = r.rows[0];
    if (!row || row.invalid || row.fixedExAmort == null) return null;

    const preset = findPreset(this.data.presets[this.data.presetIdx].key);
    if (!preset) return null;
    const tiers = ['tier1', 'tier23', 'county'];
    const coef = CITY_COEF[tiers[this.data.cityIdx] || 'tier23'] || CITY_COEF.tier23;
    const ltYuan = Number(this.data.global.laborTotalYuan);

    const { fixedItems } = assembleItems(preset, {
      area: Number(this.data.global.area) || 0,
      headcount: row.labor,
      rentYuan: row.rent,
      laborTotalYuan: ltYuan > 0 ? ltYuan : undefined,
      fixedYuan: { rent: row.rent, manage: this.data.global.manageYuan },
      buildItems: this.buildItems(),
    }, coef);

    let sumFen = 0;
    const byKey = {};
    for (let i = 0; i < fixedItems.length; i++) {
      const f = Number(fixedItems[i].fen) || 0;
      sumFen += f;
      const k = fixedItems[i].key;
      byKey[k] = (byKey[k] || 0) + f;
    }

    const engineYuan = Number(row.fixedExAmort);
    // 对账：同源函数 + 同参数 ⇒ 必须相等；不等说明两侧参数包/入参已分叉 ⇒ fail-closed
    if (!(engineYuan > 0) || Math.abs(sumFen / 100 - engineYuan) > 1) return null;

    const T = this.data.t;
    // R411：走单源（两处同形，一并收口）
    const money = (fen) => MoneyFmt.formatFen(fen, { wanUnit: T.cashWan, yuanUnit: T.yuan });

    const rows = [
      { key: 'rent', name: T.fixedBreakRent, text: money(byKey.rent || 0) },
      { key: 'labor', name: T.fixedBreakLabor, text: money(byKey.labor || 0) },
      { key: 'utility', name: T.fixedBreakUtility, text: money(byKey.utility || 0) },
    ];
    const other = sumFen - (byKey.rent || 0) - (byKey.labor || 0) - (byKey.utility || 0);
    if (other > 0) rows.push({ key: 'other', name: T.fixedBreakOther, text: money(other) });
    return rows;
  },

  // ===== 装配单行的 clean 参数（与单测口径一致，走 assembleItems 唯一入口）=====
  buildClean(preset, coef, rentYuan, laborN, marginPct, targetYuan, cityTier) {
    const buildItems = this.buildItems();
    // 🔴 R335（B 方案）：两条路都留，优先级从高到低
    //   ① 老板直接填了「人工总额」⇒ 用它（覆盖人数×人均）
    //   ② 否则用「人数 × 人均」（人均老板可改，默认取业态值）
    const ltYuan = Number(this.data.global.laborTotalYuan);
    const unitYuan = Number(this.data.global.laborUnitYuan);
    const input = {
      area: Number(this.data.global.area) || 0,
      headcount: laborN,
      rentYuan,
      laborTotalYuan: ltYuan > 0 ? ltYuan : undefined,
      laborUnitYuan: (ltYuan > 0 || !(unitYuan > 0)) ? undefined : unitYuan,
      fixedYuan: { rent: rentYuan, manage: this.data.global.manageYuan },
      buildItems,
    };
    const { fixedItems, varItems } = assembleItems(preset, input, coef);
    // 🔴 R525：其他杂支 % 覆盖（与 index 的 `buildPresetParam` 同一规则，逐字对齐）：
    //   0 ⇒ **剔除**该项（老板认为没这笔）；>0 ⇒ 用老板的值；非数字/负数 ⇒ 原样按预设走。
    //   不做这层，单页改成 0 后矩阵仍扣 2% ⇒ 两页保本额不一致且零报错。
    const otherRaw = this.data.otherPct;
    const varFinal = (otherRaw === null || otherRaw === undefined || otherRaw === '')
      ? varItems
      : varItems.map((v) => {
          if (v.key !== 'other') return v;
          const n = Number(otherRaw);
          if (!isFinite(n) || n < 0) return v;
          return n > 0 ? { key: 'other', pct: n } : null;
        }).filter(Boolean);
    return {
      cityTier,
      bizType: bizKeyOfPreset(preset.presetKey),
      fixedItems,
      varItems: varFinal,
      buildItems,
      grossMarginPct: marginPct,
      targetProfitFen: api.yuanToFen(targetYuan),
      expectedRevenueFen: 0,
    };
  },
  // 全局开店投入 → buildItems（与 bizPreset.resolveBuild 同形：[{key,fen,years}]）
  // 🔴 R336：4 项各自年限。老板只要知道「每样花了多少、几年摊回去」，不需要懂会计。
  buildItems() {
    const g = this.data.global || {};
    const it = [];
    const add = (key, yuanRaw, yearsRaw, forceYears) => {
      const fen = api.yuanToFen(yuanRaw);
      if (!(fen > 0)) return;
      // forceYears 用 0 表示「不摊」——引擎是 `if (years > 0) amort += ...`，
      // 所以 years:0 **不参与摊销但仍计入 build_total**（回本月数要用总额），正是转让费要的。
      const years = (forceYears === 0) ? 0 : buildYearsOf(key, yearsRaw);
      it.push({ key, fen, years });
    };
    add('decor', g.buildDecorYuan, g.buildDecorYears);
    add('equip', g.buildEquipYuan, g.buildEquipYears);
    add('franchise', g.buildFranchiseYuan, g.buildFranchiseYears);
    add('transfer', g.buildTransferYuan, g.buildTransferYears,
      g.buildTransferAmort ? undefined : 0);
    if (it.length) return it;
    // 一项都没填 ⇒ 退回业态参考值（同 resolveBuild「两条路二选一」，**不叠加**；
    //   也不做「填了一项就替你补其他项」——那会让老板以为填的是全量）
    const pst = findPreset(this.data.presets[this.data.presetIdx].key);
    const ref = (pst && pst.buildRef) || [];
    return ref.map((b) => ({ key: b.key, fen: Number(b.fen), years: Number(b.years) }));
  },

  // 合计 + 每月摊销 的展示文本（纯派生，直接读 buildItems 同一份结果，不另算一套）
  buildSumOf() {
    const T = this.data.t || {};
    const items = this.buildItems();
    let totalFen = 0;
    let amortFen = 0;
    for (let i = 0; i < items.length; i++) {
      const fen = Number(items[i].fen) || 0;
      const years = Number(items[i].years) || 0;
      totalFen += fen;
      if (years > 0) amortFen += fen / (years * 12);
    }
    if (!(totalFen > 0)) return '';
    // R411：走单源（两处同形，一并收口）
    const money = (fen) => MoneyFmt.formatFen(fen, { wanUnit: T.cashWan, yuanUnit: T.yuan });
    return String(T.buildSumText || '{total} · {amort}')
      .replace('{total}', money(totalFen))
      .replace('{amort}', money(amortFen));
  },

  // 转让费「计入摊销」勾选（默认不勾 = 买位置的钱不摊）
  onTransferAmortTap() {
    const global = this.data.global;
    global.buildTransferAmort = !global.buildTransferAmort;
    this.setData({ global }, () => this.setData({ buildSumText: this.buildSumOf() }));
  },

  // ===== R297 第二轮：四档维度体检（越界即人话，绝不静默送云）=====
  //   dims 是自由文本数组；空档由 onGenerate 自己跳过（不在这里判），只管**填了却越界**。
  badDimOf() {
    const d = this.data.dims || {};
    const chk = (arr, name, min, max) => {
      const list = arr || [];
      for (let i = 0; i < list.length; i++) {
        const raw = String(list[i] === undefined || list[i] === null ? '' : list[i]).trim();
        if (raw === '') continue;                 // 空档 = 没填，不算越界
        const v = Number(raw);
        if (!isFinite(v)) continue;               // 非数字由 onGenerate 跳过
        if (v < min || v > max) return `第 ${i + 1} 档${name}要在 ${min}~${max}（现在填了 ${raw}）`;
      }
      return '';
    };
    return chk(d.margin, '毛利率', 0, 100)
      || chk(d.rent, '房租', 0, 100000000)
      || chk(d.labor, '人数', 0, 999)
      || chk(d.target, '目标利润', 0, 100000000);
  },

  // ===== 生成矩阵（批量送云）=====
  // 🔴 R322：展开/收起「高级维度（毛利率 / 人工）」。
  //   收起时两维各取第 1 档（= 参数包默认/行业值），矩阵只剩「租金 × 目标利润」。
  //   为什么必须给一句「按毛利率 X% · 人工 N 人测算」：收起的维度**仍然是测算输入**，
  //   不写明等于让老板以为只按租金算 —— 那是另一种假精确。
  onToggleAdv() {
    const open = !this.data.advOpen;
    this.setData({ advOpen: open, advNote: this.buildAdvNote() });
  },

  // 🔴 R528：明细表「更多列 / 收起」—— 纯显示开关，不重算、不改数据
  //   （rows 里 14 个字段一直都在，只是屏幕上不渲染那一列）
  onToggleCols() {
    this.setData({ colsOpen: !this.data.colsOpen });
  },

  buildAdvNote() {
    const m = (this.data.dims.margin || [])[0];
    const tpl = (TERMS.matrix && TERMS.matrix.advDimsUsed) || '';
    // 🔴 R334：人工不再是档位（老板直接填总额），这里只交代毛利率这一个隐含维度
    return String(tpl).replace('{m}', String(m == null ? '' : m));
  },

  async onGenerate() {
    if (this.data.loading) return;
    const presetKey = this.data.presets[this.data.presetIdx].key;
    const preset = findPreset(presetKey);
    if (!preset) { api.toastError({ msg: '请选择经营类型' }); return; }
    const tiers = ['tier1', 'tier23', 'county'];
    const cityTier = tiers[this.data.cityIdx] || 'tier23';
    const coef = CITY_COEF[cityTier] || CITY_COEF.tier23;
    // 🔴 R297 第二轮：四档维度是**自由文本**（onDimInput 只管存、onGenerate 只判 isFinite）
    //   ⇒ 老板把「毛利率」填 150 / 房租填 -8000 时，旧码照发不误；云端矩阵分支当年又**零校验**
    //   ⇒ 保本 46111→18444 元、房租负数→19444 元，**零提示**（静默错账，方向还是"更好看"）。
    //   这里先挡一道：省一次云调用，且当场说清"第几档、哪一项、超了什么范围"。
    const badDim = this.badDimOf();
    if (badDim) { api.toastError({ msg: badDim }); return; }
    const { rent, labor, margin, target } = this.data.dims;
    // 🔴 R322：高级维度收起 ⇒ 人工/毛利率各只取第 1 档（否则行数被撑 8 倍，小白看到噪声表）。
    // 🔴 R335：人数档位已恢复（按业态给默认值），所以这里两维都要处理。
    const laborUse = this.data.advOpen ? labor : (labor || []).slice(0, 1);
    const marginUse = this.data.advOpen ? margin : (margin || []).slice(0, 1);
    const cleanArr = [];
    const meta = []; // 与 cleanArr 对齐的维度标注
    for (const r of rent) for (const l of laborUse) for (const m of marginUse) for (const tg of target) {
      const rv = Number(r), lv = Number(l), mv = Number(m), tgv = Number(tg);
      if (![rv, lv, mv, tgv].every((x) => isFinite(x))) continue;
      cleanArr.push(this.buildClean(preset, coef, rv, lv, mv, tgv, cityTier));
      meta.push({ rent: rv, labor: lv, marginPct: mv, targetYuan: tgv });
    }
    if (!cleanArr.length) { api.toastError({ msg: '维度档位不能为空' }); return; }
    // 🔴 R356：云端矩阵分支的 clean_array 上限是 1000（超过直接 fail）。
    //   前端先挡一道并说清「多少行 / 上限多少」，而不是让云端回一句通用错误。
    const MAX_ROWS = 1000;
    if (cleanArr.length > MAX_ROWS) {
      api.toastError({ msg: fmt(M.matrixRowsTooMany, { n: cleanArr.length, max: MAX_ROWS }) });
      return;
    }
    this.setData({ loading: true });
    let shown = false;   // R358：本次是否已把新结果送上屏（决定 catch 里要不要清旧表）
    try {
      // 🔴🔴 R356：**必须分批**。云端 matrix 分支一次返回每行的完整引擎结果（约 1.1KB/行），
      //   960 行时响应 ≈ 1.05MB ⇒ 云开发直接报
      //     `errCode: -501000 response size exceeded 1048576 bytes`
      //   而 api.js 会把它归入 NETWORK_ERROR ⇒ 页面显示「网络不可用，请检查网络连接」
      //   ⇒ 老板以为手机网络坏了，反复重试（实测：960 行 3.6 秒失败、0 行结果、无有效提示）。
      //   每批 150 行 ≈ 165KB，安全；批次顺序拼接，行序与 meta 一一对应。
      const CHUNK = 150;
      const allRows = [];
      const rejected = [];
      // 🔴 R357：分批中途失败**不能把已算好的也丢掉**（原来外层 catch ⇒ 整张表空白 + 一句笼统错误，
      //   老板分不清"全错"还是"错了一部分"）。改为逐批 try，失败即停，但保留已算出的行，
      //   并在页面上明说「第 a-b 档没算出来」。
      let failedAt = -1;
      let failedMsg = '';
      for (let off = 0; off < cleanArr.length; off += CHUNK) {
        const part = cleanArr.slice(off, off + CHUNK);
        try {
          const d = await api.call('calcSandbox', { action: 'matrix', clean_array: part });
          const got = d.rows || [];
          for (let k = 0; k < got.length; k++) allRows.push(got[k]);
          (d.rejected || []).forEach((x) => {
            rejected.push({ index: (Number(x.index) || 0) + off, code: x.code, msg: x.msg });
          });
        } catch (e) {
          failedAt = off;
          failedMsg = (e && e.msg) || '';
          break;
        }
      }
      // 第一批就失败 ⇒ 没有可展示的结果，保持原语义：报错退出
      if (failedAt === 0 || (!allRows.length && failedAt > 0)) {
        // 🔴 R358：**必须清掉上一次的结果**。原来只 setData({loading:false}) ⇒ 屏幕上留着旧表，
        //   而老板刚改过租金/目标档位、又只看到一句「网络不可用」⇒ 极易把旧数字当成新结果
        //   （静默错账，方向还是"看着挺好"）。toast 已说明这次没算出来，清空不会让人误以为成功。
        this.setData({ loading: false, result: null });
        api.toastError({ msg: failedMsg });
        return;
      }
      const partialText = failedAt >= 0
        ? fmt(M.matrixPartial, {
          a: failedAt + 1,
          b: Math.min(failedAt + CHUNK, cleanArr.length),
          n: cleanArr.length,
          m: allRows.length,
        })
        : '';
      const rows = allRows.map((res, i) => this.toRow(meta[i], res));
      const pivot = this.buildPivot(rows);
      const insight = this.buildInsight(rows);
      // 🔴 R297：云端拒掉的档位（rejected）**必须让人看见** —— 静默丢档 = 老板以为算过了。
      this.setData({
        loading: false,
        result: { rows, view: 'detail', count: rows.length, pivot, insight, rejected, partialText },
      });
      shown = true;
      // 🔴 R325：结果变了 ⇒ 反推的「每月固定支出」也变了，现金卡必须跟着重算（否则显示上一次的数）
      this.buildCash();
      // 🔴 R331：固定费用构成（前端同源装配 + 与引擎对账）
      this.setData({ fixedBreak: this.fixedBreakOf() });
      if (rejected.length) {
        wx.showToast({
          title: `有 ${rejected.length} 档算不出来：${rejected[0].msg}`,
          icon: 'none', duration: 3000,
        });
      }
    } catch (e) {
      // 🔴 R358：本次**还没**把新结果送上屏 ⇒ 清掉旧表（同上的静默错账）；
      //   若已经上屏（如此后 buildCash/fixedBreakOf 才抛错），保留这一份有效结果，只报错。
      this.setData({ loading: false, result: shown ? this.data.result : null });
      api.toastError(e);
    }
  },

  toRow(meta, res) {
    // 🔴 R297：云端把「算不出的那一档」返回 **null**（不是编一个数顶上）⇒ 这里给占位行。
    //   旧码直接解引用 res ⇒ TypeError ⇒ 整张矩阵崩成一句「出错」，老板连哪一档都不知道。
    if (!res) {
      return {
        rent: meta.rent, labor: meta.labor, marginPct: meta.marginPct, targetYuan: meta.targetYuan,
        breakMonthly: null, breakDaily: null, targetMonthly: null, targetDaily: null,
        rentPct: null, leverYuan: null, cushionPct: null, payback: null,
        red: false, invalid: true, fixedExAmort: null, laborYuan: null, beCashMonthly: null,
      };
    }
    const rentFen = Math.round(Number((meta.rent * 100).toFixed(10)));   // R298-B2：原式**连取整都没有** ⇒ 分不是整数，违约铁律
    const targetMonthlyFen = res.target_monthly_fen;
    // 房租占比：两个引擎返回数值的简单比值（展示用，非测算公式）
    const rentPct = (targetMonthlyFen && targetMonthlyFen > 0)
      ? Math.round((rentFen / targetMonthlyFen) * 1000) / 10
      : null;
    const breakMonthly = res.break_even_monthly_fen != null ? res.break_even_monthly_fen / 100 : null;
    // 🔴 R336：现金保本（不含摊销）—— 纯比例派生，不需要前端知道边际贡献率：
    //   账面 = (固定含摊) ÷ rate；现金 = (固定不含摊) ÷ rate
    //   ⇒ 现金 = 账面 × 不含摊销 / 含摊销（同一个 rate 约掉）
    //   引擎三个数都返回了（fixed_total_fen / fixed_ex_amort_fen / break_even_monthly_fen）。
    // 🔴 R343：改调 utils/bizPreset.js::cashBreakeven —— 与 index 页共用**同一个函数**。
    //   原先这里自己写了一份算式，index 页再写一份就是两套口径 ⇒ 必然漂移。
    const beCashMonthly = cashBreakeven(breakMonthly, res.fixed_ex_amort_fen, res.fixed_total_fen);
    const breakDaily = res.break_even_daily_fen != null ? res.break_even_daily_fen / 100 : null;
    const targetMonthly = targetMonthlyFen != null ? targetMonthlyFen / 100 : null;
    const targetDaily = res.target_daily_fen != null ? res.target_daily_fen / 100 : null;
    // 🔴 R331：引擎的「不含摊销固定费用」——用于和前端同源装配对账（对不上就不显示构成）
    const fixedExAmort = res.fixed_ex_amort_fen != null ? api.fenToYuan(res.fixed_ex_amort_fen, 0) : null;
    // 🔴 round279 · #9 派生（纯展示，引擎零改）：
    //   ① 房租杠杆：房租每涨 ¥1000，需多做到手营收 = 1000 ÷ 毛利率（按本行毛利率计）
    const mRate = meta.marginPct > 0 ? meta.marginPct / 100 : 0;
    const leverYuan = mRate > 0 ? Math.round(1000 / mRate) : null;
    //   ② 淡季安全垫：目标营收相对保本线的缓冲百分比（营收可跌这么多才到保本；
    //      目标利润=0 即保本线本身 ⇒ 缓冲为 0，前端标「保本线」而非 0%）
    let cushionPct = null;
    if (meta.targetYuan > 0 && targetMonthly != null && breakMonthly != null && targetMonthly > 0) {
      cushionPct = Math.round((targetMonthly - breakMonthly) / targetMonthly * 100);
    }
    return {
      rent: meta.rent,
      labor: meta.labor,
      marginPct: meta.marginPct,
      targetYuan: meta.targetYuan,
      breakMonthly,
      beCashMonthly,
      breakDaily,
      targetMonthly,
      targetDaily,
      rentPct,
      leverYuan,
      cushionPct,
      payback: res.payback_months != null ? res.payback_months : null,
      red: !!res.red_alert,
      fixedExAmort,
      // 🔴 R332：人工/月（走 assembleItems 同源，与业态的人工形态一致）
      laborYuan: this.laborOf(meta.rent, meta.labor),
    };
  },

  // ===== #9 结论高亮：在「当前透视固定维度」下从已算 rows 抽可行子集，给出扛租/杠杆/淡季安全垫 =====
  // 🔴 round279 · 纯前端派生，引擎零改。结论跟着透视固定维度走：
  //   reverse（寻找铺面，扫租金档位）→ 固定毛利率/人工 ⇒ 结论「可承受最高月租」
  //   forward（已有铺面，扫毛利率）  → 固定月租金/人工 ⇒ 结论「最低可行毛利率」
  buildInsight(rows) {
    if (!rows || !rows.length) return { has: false };
    const dim = this.data.pivotRowDim;                 // 'rent' | 'margin'
    const fixKey = dim === 'margin' ? 'rent' : 'margin'; // 被固定的另一个维度
    // 🔴 R332 修必现 bug：`pivotFix` 是**写死的**（margin 55 / labor 2），而实际生成的行用的是 `dims` 档位
    //   ——高级维度收起时只取第一档（茶饮 67%、火锅 53%…）⇒ 拿 55 去筛**永远筛不到**
    //   ⇒ 不管有没有可行组合，结论一律显示"当前筛选无可行组合"。
    //   修法：优先用 pivotFix；若该值在结果里不存在，退到结果中**实际出现的第一档**。
    const uniqOf = (fn) => {
      const out = [];
      rows.forEach((r) => { const v = Number(fn(r)); if (isFinite(v) && out.indexOf(v) < 0) out.push(v); });
      return out;
    };
    const pool = uniqOf((r) => r[fixKey === 'rent' ? 'rent' : 'marginPct']);
    let fixVal = Number(this.data.pivotFix[fixKey]);
    if (pool.indexOf(fixVal) < 0) fixVal = pool[0];
    if (!isFinite(fixVal)) return { has: false };
    // 🔴 D6：与 buildPivot 同口径 —— 结论框也必须按人工过滤，
    //   否则结论可能取到被透视表隐藏的另一档人工的行，表里表外对不上。
    const laborPool = uniqOf((r) => r.labor);
    let fixLaborVal = Number(this.data.pivotFix.labor);
    if (laborPool.indexOf(fixLaborVal) < 0) fixLaborVal = laborPool[0];
    if (!isFinite(fixLaborVal)) return { has: false };
    // 目标利润锚点：取维度里最大的目标利润档（最紧张、最有参考意义）
    const targetDims = this.data.dims.target.map(Number).filter(isFinite);
    const targetAnchor = targetDims.length ? Math.max(...targetDims) : 0;
    let filtered = rows.filter((r) => !r.red
      && Number(r[fixKey === 'rent' ? 'rent' : 'marginPct']) === fixVal
      && Number(r.labor) === fixLaborVal
      && (targetAnchor === 0 || r.targetYuan === targetAnchor));
    if (!filtered.length) {
      // 退一步：放宽目标利润约束，只看固定维度 + 人工
      filtered = rows.filter((r) => !r.red
        && Number(r[fixKey === 'rent' ? 'rent' : 'marginPct']) === fixVal
        && Number(r.labor) === fixLaborVal
);
    }
    if (!filtered.length) return { has: false };

    let bestLabel, bestVal, bestText;
    if (dim === 'rent') {
      bestVal = Math.max(...filtered.map((r) => r.rent));
      bestText = fmt(M.insightMaxRent, { rent: bestVal, target: targetAnchor, margin: fixVal });
    } else {
      bestVal = Math.min(...filtered.map((r) => r.marginPct));
      bestText = fmt(M.insightMinMargin, { margin: bestVal, rent: fixVal, target: targetAnchor });
    }
    // 房租杠杆：按锚定毛利率计（reverse=fixVal 毛利率；forward=最低可行毛利率本身）
    const leverMargin = dim === 'rent' ? fixVal : bestVal;
    const leverYuan = Math.round(1000 / (leverMargin / 100));
    const leverText = fmt(M.insightLever, { lever: leverYuan, margin: leverMargin });
    // 淡季安全垫：取最优档那一行
    const bestRow = filtered.find((r) => (dim === 'rent' ? r.rent === bestVal : r.marginPct === bestVal));
    let cushionText = null;
    if (bestRow && bestRow.targetMonthly != null && bestRow.breakMonthly != null && bestRow.targetMonthly > 0) {
      const cushion = Math.round((bestRow.targetMonthly - bestRow.breakMonthly) / bestRow.targetMonthly * 100);
      cushionText = fmt(M.insightCushion, { cushion });
    }
    return { has: true, bestLabel: dim === 'rent' ? 'maxRent' : 'minMargin', bestText, leverText, cushionText };
  },

  // ===== 透视表：行=月租金档，列=目标利润档，单元格=目标日均(元) =====
  // 顶部固定 毛利率 / 人工，从已算结果里筛出对应子集（无需重新调云）
  buildPivot(rows) {
    // 🔴 round273：透视**主轴**按场景走 —— A（forward）扫毛利率、B（reverse）扫租金档位。
    //   被"固定住"的则是另一个成本维度（A 固定月租金 / B 固定毛利率），人工两边都固定。
    //   维度**一个都没删**（rent/labor/margin/target 全在），只是换默认主轴 ⇒ 旧行为零回退。
    const dim = this.data.pivotRowDim;                    // 'rent' | 'margin'
    const FIELD = { rent: 'rent', margin: 'marginPct' };  // 维度 → toRow 里的字段名
    const fixKey = dim === 'margin' ? 'rent' : 'margin';  // 固定住的**另一个**维度
    // 🔴 R332 修必现 bug：`pivotFix` 是**写死的**（margin 55 / labor 2），而实际生成的行用的是 `dims` 档位
    //   ——高级维度收起时只取第一档（茶饮 67%、火锅 53%…）⇒ 拿 55 去筛**永远筛不到**
    //   ⇒ 不管有没有可行组合，结论一律显示"当前筛选无可行组合"。
    //   修法：优先用 pivotFix；若该值在结果里不存在，退到结果中**实际出现的第一档**。
    const uniqOf = (fn) => {
      const out = [];
      rows.forEach((r) => { const v = Number(fn(r)); if (isFinite(v) && out.indexOf(v) < 0) out.push(v); });
      return out;
    };
    const pool = uniqOf((r) => r[fixKey === 'rent' ? 'rent' : 'marginPct']);
    let fixVal = Number(this.data.pivotFix[fixKey]);
    if (pool.indexOf(fixVal) < 0) fixVal = pool[0];
    if (!isFinite(fixVal)) return { has: false };
    // 🔴 D6（2026-10-27 拍板）：人工本就是矩阵维度（dims.labor 可改，默认 [2,3]），
    //   透视表必须按人工过滤，否则 2 人/3 人的数字叠在同一格被后者覆盖，人工维度在透视视图里完全失效。
    //   套用 R332 同款"优先 pivotFix、取不到退实际第一档"。
    const laborPool = uniqOf((r) => r.labor);
    let fixLaborVal = Number(this.data.pivotFix.labor);
    if (laborPool.indexOf(fixLaborVal) < 0) fixLaborVal = laborPool[0];
    if (!isFinite(fixLaborVal)) return { has: false };
    const filtered = rows.filter((r) => !r.red
      && Number(r[FIELD[fixKey]]) === fixVal
      && Number(r.labor) === fixLaborVal);
    const cells = {};
    for (const r of filtered) cells[r[FIELD[dim]] + '|' + r.targetYuan] = r.targetDaily;
    return {
      fixMargin: Number(this.data.pivotFix.margin),
      fixLabor: fixLaborVal,
      fixRent: Number(this.data.pivotFix.rent),
      rows: this.data.dims[dim].slice(),
      cols: this.data.dims.target.slice(),
      cells,
    };
  },
  // 🔴 R297 第四轮（审计 B6）：原 `onPivotFixChange` 与下面的 `onPivotFixInput` **函数体完全等价**，
  //   且 wxml 只绑了 `onPivotFixInput`（matrix.wxml 三处）⇒ 前者不可达（死代码），已删。
  onPivotFixInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = Number(e.detail.value);
    const pivotFix = this.data.pivotFix;
    pivotFix[key] = val;
    this.setData({ pivotFix }, () => {
      if (this.data.result) {
        this.setData({
          'result.pivot': this.buildPivot(this.data.result.rows),
          'result.insight': this.buildInsight(this.data.result.rows),
        });
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
    // 🔴 R349 修漏洞：页面 14 列、导出只有 12 列 —— 少了「人工/月」(R332) 和「现金保本/月」(R336)。
    //   老板在页面看到两列，导出 Excel 却没有 ⇒ 导出件比他看到的少信息，且**不报错**。
    //   顺序与 matrix.wxml 表头逐列一致，改一处必须改另一处（列数由守卫钉住）。
    const header = [
      t.dimRent, t.dimLabor, t.colLaborFee, t.dimMargin, t.dimTarget,
      t.colBreakMonthly, t.colBreakCash, t.colBreakDaily,
      t.colTargetMonthly, t.colTargetDaily,
      t.rentPct, t.payback, t.colLeverExport, t.colCushionExport,
    ];
    // 🔴 R352：页面对算不出来的档位会在租金后标 `⚠`（见 matrix.wxml 的 item.invalid），
    //   导出**必须同样标** —— 否则 Excel 里那行是"5000 | — | — | …"，
    //   老板会读成"这一档不划算"，实际是"这一档没算出来"。同一份数据，两个含义。
    const markInvalid = (r) => (r.invalid ? String(r.rent) + ' ⚠' : r.rent);
    const body = rows.map((r) => [
      markInvalid(r), r.labor,
      r.laborYuan != null ? r.laborYuan : '—',
      r.marginPct, r.targetYuan,
      r.breakMonthly != null ? r.breakMonthly : '—',
      r.beCashMonthly != null ? r.beCashMonthly : '—',
      r.breakDaily != null ? r.breakDaily : '—',
      r.targetMonthly != null ? r.targetMonthly : '—',
      r.targetDaily != null ? r.targetDaily : '—',
      r.rentPct != null ? r.rentPct : '—',
      r.payback != null ? r.payback : '—',
      r.leverYuan != null ? r.leverYuan : '—',
      r.cushionPct != null ? r.cushionPct : '—',
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
  goCompare() { wx.navigateTo({ url: '/subpkg/tools/sandbox/compare' }); },
});
