// pages/sandbox/matrix.js —— M2 G1 场景矩阵生成器（2026-10-11 改造）
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
  // R297：全局开店投入的年限兜底（与云端 indicatorRef 同口径，不再硬写 1）
  BUILD_DEFAULT_YEARS, buildYearsOf,
} = require('../../utils/bizPreset.js');
const { deliver } = require('../../utils/exportFile.js');
// 🔴 R325：开店现金需求（装修/押金/预付/设备/货款）+ 周转金能撑几个月
const OpenCash = require('../../utils/openCash.js');

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
      advDimsShow: M.advDimsShow,
      advDimsHide: M.advDimsHide,
      dimLabor: M.dimLabor,
      dimMargin: M.dimMargin,
      dimTarget: M.dimTarget,
      // 🔴 round276：屏幕表头短名（见 terms.js 同名注释块）—— 只改显示用列，导出 Excel 仍用长名
      colRent: M.colRent,
      colLabor: M.colLabor,
      colMargin: M.colMargin,
      colTarget: M.colTarget,
      addDim: M.addDim,
      delDim: M.delDim,
      buildLabel: M.buildLabel,
      buildTotalLabel: M.buildTotalLabel,
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
      laborFixedHint: M.laborFixedHint,
      laborTotalHint: M.laborTotalHint,
      laborUnitLabel: M.laborUnitLabel,
      laborUnitNote: M.laborUnitNote,
      laborTotalLabel2: M.laborTotalLabel2,
      laborTotalNote2: M.laborTotalNote2,
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
    },
    // 🔴 R332 修 bug：原先名字只拼「大类·预设」⇒ 同大类的两个细分（半自助 / 烤肉）**显示成一模一样**，
    //   老板选哪个都看不出区别。现改为「大类 · 细分」；通用兜底不加大类前缀（否则重复成一串）。
    presets: BIZ_PRESETS.map((p) => {
      const bt = TERMS.m2.bizTypes.find((b) => b.key === p.bizKey);
      const sub = TERMS.m2.bizPresets[p.presetKey] || p.presetKey;
      const cat = (bt && p.bizKey !== 'other') ? bt.name + ' · ' : '';
      return { key: p.presetKey, name: cat + sub };
    }),
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
    global: { area: 60, buildTotalYuan: 0, buildYears: 3, laborTotalYuan: '', laborUnitYuan: '' },
    // 🔴 R331：老板手改过毛利率档位 ⇒ 切业态时不再覆盖（与 index 页 fieldTouched 同一判据）
    fieldTouched: { margin: false, labor: false, unit: false },
    // 🔴 round273：多一个 `rent` —— A 场景透视主轴是毛利率 ⇒ 被固定住的是月租金（反之亦然）
    pivotFix: { margin: 55, labor: 2, rent: 5000 },
    // 🔴 round273 · 场景：'forward' 已有铺面（店已开，扫毛利率）/ 'reverse' 寻找铺面（扫租金档位）。
    //   ⚠️ 默认 reverse：本页最初就是按「扫租金档位」造的（G1），**保持原行为不回退**；
    //      只有从沙盘页带 `?mode=forward` 进来才切成 A 场景口径。
    // 🔴 R322：高级维度（毛利率/人工）默认收起 —— 小白只填租金与目标利润
    advOpen: false,
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
    exporting: false,
    result: null, // { rows:[], view, count, pivot }
  },

  onLoad(options) {
    const mode = (options && options.mode === 'forward') ? 'forward' : 'reverse';
    // 🔴 round273：按进来的场景切「透视行维度」与标题/引导语（维度**全保留**，只是透视主轴不同 ——
    //   A 也可以扫租金做敏感性分析，故不删维度，只换默认主轴）。
    const pivotRowDim = mode === 'forward' ? 'margin' : 'rent';
    this.setData({
      mode,
      pivotRowDim,
      't.title': mode === 'forward' ? M.titleFwd : M.titleRev,
      't.subtitle': mode === 'forward' ? M.subtitleFwd : M.subtitleRev,
      't.pivotRowLabel': mode === 'forward' ? M.pivotRowLabelFwd : M.pivotRowLabelRev,
    });
    // 🔴 R322：收起态下要显示「按毛利率 X% · 人工 N 人测算」，进页就先把这句算好
    this.setData({ advNote: this.buildAdvNote() });
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
        buildYears: ref ? buildYearsOf('other', ref.years) : BUILD_DEFAULT_YEARS.other,
      },
    });
  },

  onPresetChange(e) {
    const idx = Number(e.detail.value);
    const p = BIZ_PRESETS[idx] ? findPreset(BIZ_PRESETS[idx].presetKey) : null;
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
    this.setData({ cityIdx: Number(e.detail.value) });
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
    // 🔴 R333：填了人工总额之后，"人数是否影响人工"的结论会变，提示要跟着变
    if (key === 'laborTotalYuan') patch.laborHint = this.laborHintOf();
    this.setData(patch);
  },

  // 🔴 R333：人数档位到底有没有用 —— 有些业态人工是固定额（火锅半自助 = 25000 写死），
  //   改人数完全不影响结果。界面上必须说清，否则老板调了半天以为系统坏了。
  //   三种情形：填了总额 ⇒ 人数只影响人效；labor_total/headcount_linear ⇒ 人数有效；fixed ⇒ 明说固定额。
  laborHintOf() {
    const T = this.data.t;
    const preset = findPreset(BIZ_PRESETS[this.data.presetIdx].presetKey);
    if (!preset) return '';
    if (Number(this.data.global.laborTotalYuan) > 0) return T.laborTotalHint;
    const m = (preset.costMeta || []).filter((x) => x.itemKey === 'labor')[0];
    if (!m) return '';
    if (m.form === 'labor_total' || m.form === 'headcount_linear') return '';
    const fy = Number(m.defaultYuan) || 0;
    if (!(fy > 0)) return '';
    return String(T.laborFixedHint).replace('{x}', String(fy));
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
    const money = (fen) => {
      const yuan = fen / 100;
      if (Math.abs(yuan) >= 10000) return (yuan / 10000).toFixed(1) + T.cashWan;
      return Math.round(yuan) + T.yuan;
    };
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
    const preset = findPreset(BIZ_PRESETS[this.data.presetIdx].presetKey);
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
      fixedYuan: { rent: rentYuan },
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

    const preset = findPreset(BIZ_PRESETS[this.data.presetIdx].presetKey);
    if (!preset) return null;
    const tiers = ['tier1', 'tier23', 'county'];
    const coef = CITY_COEF[tiers[this.data.cityIdx] || 'tier23'] || CITY_COEF.tier23;
    const ltYuan = Number(this.data.global.laborTotalYuan);

    const { fixedItems } = assembleItems(preset, {
      area: Number(this.data.global.area) || 0,
      headcount: row.labor,
      rentYuan: row.rent,
      laborTotalYuan: ltYuan > 0 ? ltYuan : undefined,
      fixedYuan: { rent: row.rent },
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
    const money = (fen) => (Math.abs(fen) >= 1000000
      ? (fen / 1000000).toFixed(1) + T.cashWan
      : Math.round(fen / 100) + T.yuan);

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
    // 🔴 R297：原 `|| 1` / `years > 0 ? years : 1` 双重硬兜 1 年 —— 清空年限即按 1 年摊，
    //   月摊销虚高 3 倍 ⇒ 整张矩阵的保本点系统性偏高。改走同口径归一。
    const years = buildYearsOf('other', this.data.global.buildYears);
    return [{ key: 'other', fen: api.yuanToFen(yuan), years }];
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

  buildAdvNote() {
    const m = (this.data.dims.margin || [])[0];
    const tpl = (TERMS.matrix && TERMS.matrix.advDimsUsed) || '';
    // 🔴 R334：人工不再是档位（老板直接填总额），这里只交代毛利率这一个隐含维度
    return String(tpl).replace('{m}', String(m == null ? '' : m));
  },

  async onGenerate() {
    if (this.data.loading) return;
    const presetKey = BIZ_PRESETS[this.data.presetIdx].presetKey;
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
    this.setData({ loading: true });
    try {
      const d = await api.call('calcSandbox', { action: 'matrix', clean_array: cleanArr });
      const rows = (d.rows || []).map((res, i) => this.toRow(meta[i], res));
      const pivot = this.buildPivot(rows);
      const insight = this.buildInsight(rows);
      // 🔴 R297：云端拒掉的档位（rejected）**必须让人看见** —— 静默丢档 = 老板以为算过了。
      const rejected = d.rejected || [];
      this.setData({
        loading: false,
        result: { rows, view: 'detail', count: rows.length, pivot, insight, rejected },
      });
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
      this.setData({ loading: false });
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
        red: false, invalid: true, fixedExAmort: null, laborYuan: null,
      };
    }
    const rentFen = Math.round(Number((meta.rent * 100).toFixed(10)));   // R298-B2：原式**连取整都没有** ⇒ 分不是整数，违约铁律
    const targetMonthlyFen = res.target_monthly_fen;
    // 房租占比：两个引擎返回数值的简单比值（展示用，非测算公式）
    const rentPct = (targetMonthlyFen && targetMonthlyFen > 0)
      ? Math.round((rentFen / targetMonthlyFen) * 1000) / 10
      : null;
    const breakMonthly = res.break_even_monthly_fen != null ? res.break_even_monthly_fen / 100 : null;
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
      labor: meta.labor,
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
    // 目标利润锚点：取维度里最大的目标利润档（最紧张、最有参考意义）
    const targetDims = this.data.dims.target.map(Number).filter(isFinite);
    const targetAnchor = targetDims.length ? Math.max(...targetDims) : 0;
    let filtered = rows.filter((r) => !r.red
      && Number(r[fixKey === 'rent' ? 'rent' : 'marginPct']) === fixVal
      && (targetAnchor === 0 || r.targetYuan === targetAnchor));
    if (!filtered.length) {
      // 退一步：放宽目标利润约束，只看固定维度 + 人工
      filtered = rows.filter((r) => !r.red
        && Number(r[fixKey === 'rent' ? 'rent' : 'marginPct']) === fixVal
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
    const filtered = rows.filter((r) => !r.red
      && Number(r[FIELD[fixKey]]) === fixVal);
    const cells = {};
    for (const r of filtered) cells[r[FIELD[dim]] + '|' + r.targetYuan] = r.targetDaily;
    return {
      fixMargin: Number(this.data.pivotFix.margin),
      fixLabor: null,   // 🔴 R334：人工已不是维度，保留字段位防旧模板取空
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
    const header = [
      t.dimRent, t.dimLabor, t.dimMargin, t.dimTarget,
      t.colBreakMonthly, t.colBreakDaily, t.colTargetMonthly, t.colTargetDaily,
      t.rentPct, t.payback, t.colLeverExport, t.colCushionExport,
    ];
    const body = rows.map((r) => [
      r.rent, r.labor, r.marginPct, r.targetYuan,
      r.breakMonthly != null ? r.breakMonthly : '—',
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
  goCompare() { wx.navigateTo({ url: '/pages/sandbox/compare' }); },
});
