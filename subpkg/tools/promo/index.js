// subpkg/tools/promo/index.js —— 活动换算 · 回本测算（R757 建 / R759 重构 / R764 补口径+效果评估）
//
// 🔴 R759 纠偏（李老师 2026-11-25 原话）：
//   「我本意是做个计算工具，比如 2送1 相当于打几折，最终大部分都去到『是打了几折』这个问题；
//    然后有一个是做活动降低毛利率了，需要多少回到原来的利润水平。」
//   ⇒ 页面**有主次**：
//     ① 主：活动规则 → 相当于几折 + 推导式。**不需要毛利率**，进来就会。
//     ② 次：活动后毛利率降了 → 要做多少流水/多少单才回到原来的利润。这段才要毛利率。
//
// 🔴 R764（豆包会审缺口，李老师「赔多少赚多少」原话）：
//   · 满减分「单档 / 每满」并可封顶 —— 「满100减30」和「每满100减30」不是一回事；
//   · 赠品独立口径：赠品标价 30、成本率 30% ⇒ 真实让利只有 9 元/百元，
//     按标价当让利会高估 3 倍多，且会让客流倍数算错（赠品不降价，流水倍数=客流倍数）；
//   · 保本线同时给「实收」和「原价」两个口径，老板才和自账对得上；
//   · 新增第四段：填活动后预计流水/天数/投入 ⇒ 直接出「预计多赚或少赚多少元」。
//
// 🔴 零数据依赖：不 require api.js、不调云函数，没建店的老板也能用（拉新入口）。
// 🔴 输入即重算（李老师）：bindinput 即时出数，不设「计算」按钮。

const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const { promoCalc, promoConvert, reverseFromMargin, promoEffect } = require('../../../utils/promoCalc.js');

const t = TERMS.card;

// 活动形式清单（顺序＝页面 picker 顺序；显示名全走 terms）
const KINDS = [
  { key: 'off', nameKey: 'promoKindOff' },
  { key: 'threshold', nameKey: 'promoKindThreshold' },
  { key: 'gift', nameKey: 'promoKindGift' },      // R764
  { key: 'bogo', nameKey: 'promoKindBogo' },
  { key: 'nth', nameKey: 'promoKindNth' },
  { key: 'voucher', nameKey: 'promoKindVoucher' },
  { key: 'share', nameKey: 'promoKindShare' },
  { key: 'stored', nameKey: 'promoKindStored' },
  { key: 'offset', nameKey: 'promoKindOffset' },
  { key: 'direct', nameKey: 'promoKindDirect' },
];

Page({
  data: {
    t: {
      promoIntro: t.promoIntro,
      // 第一段：换算
      promoSecConvert: t.promoSecConvert,
      promoKindLabel: t.promoKindLabel,
      promoParamDiscount: t.promoParamDiscount,
      promoParamThreshold: t.promoParamThreshold,
      promoParamCut: t.promoParamCut,
      promoParamBuy: t.promoParamBuy,
      promoParamFree: t.promoParamFree,
      promoParamN: t.promoParamN,
      promoParamFace: t.promoParamFace,
      promoParamFaceHint: t.promoParamFaceHint,
      // R763/R764：满减客单价 + 单档/每满 + 封顶
      promoParamAvgPrice: t.promoParamAvgPrice,
      promoParamAvgPriceHint: t.promoParamAvgPriceHint,
      promoNoAvgPrefix: t.promoNoAvgPrefix,
      promoNoAvgSuffix: t.promoNoAvgSuffix,
      promoBelowThreshold: t.promoBelowThreshold,
      promoModeLabel: t.promoModeLabel,
      promoModeOnce: t.promoModeOnce,
      promoModeEach: t.promoModeEach,
      promoParamCap: t.promoParamCap,
      promoParamCapHint: t.promoParamCapHint,
      promoCappedPrefix: t.promoCappedPrefix,
      promoCappedSuffix: t.promoCappedSuffix,
      // R764：赠品口径
      promoParamGiftValue: t.promoParamGiftValue,
      promoParamGiftValueHint: t.promoParamGiftValueHint,
      promoParamGiftCostPct: t.promoParamGiftCostPct,
      promoParamGiftCostPctHint: t.promoParamGiftCostPctHint,
      promoGiftPrefix: t.promoGiftPrefix,
      promoGiftMid: t.promoGiftMid,
      promoGiftSuffix: t.promoGiftSuffix,
      promoParamLimit: t.promoParamLimit,
      promoLimitPrefix: t.promoLimitPrefix,
      promoLimitSuffix: t.promoLimitSuffix,
      promoParamPeople: t.promoParamPeople,
      promoParamPrincipal: t.promoParamPrincipal,
      promoParamBonus: t.promoParamBonus,
      promoParamPayable: t.promoParamPayable,
      promoParamOffset: t.promoParamOffset,
      promoZheUnit: t.promoZheUnit,
      promoResDiscount: t.promoResDiscount,
      promoFormulaPrefix: t.promoFormulaPrefix,
      promoConvertEmpty: t.promoConvertEmpty,
      promoConvertBad: t.promoConvertBad,
      // R764：统一对比口径
      promoResLossPer100: t.promoResLossPer100,
      promoLossUnit: t.promoLossUnit,
      // 第二段：回本
      promoSecBack: t.promoSecBack,
      promoBackIntro: t.promoBackIntro,
      promoMarginLabel: t.promoMarginLabel,
      promoMarginHint: t.promoMarginHint,
      promoRevenueLabel: t.promoRevenueLabel,
      promoRevenueHint: t.promoRevenueHint,
      promoPriceLabel: t.promoPriceLabel,
      promoPriceHint: t.promoPriceHint,
      promoYuanUnit: t.promoYuanUnit,
      promoOrdersUnit: t.promoOrdersUnit,
      promoBackEmpty: t.promoBackEmpty,
      promoBackBad: t.promoBackBad,
      promoResTitle: t.promoResTitle,
      promoResNewMargin: t.promoResNewMargin,
      promoResRevenue: t.promoResRevenue,
      promoResRevenueList: t.promoResRevenueList,
      promoResOrders: t.promoResOrders,
      promoResOrdersNow: t.promoResOrdersNow,
      promoResTraffic: t.promoResTraffic,
      promoResCritical: t.promoResCritical,
      promoResCriticalHint: t.promoResCriticalHint,
      // R764 赠品的临界值是「每百元让利上限」而不是折扣，文案要分开
      promoResCriticalLoss: t.promoResCriticalLoss,
      promoResCriticalLossHint: t.promoResCriticalLossHint,
      // 第三段：填活动后毛利率反算（R761）
      promoSecReverse: t.promoSecReverse,
      promoReverseIntro: t.promoReverseIntro,
      promoTargetMarginLabel: t.promoTargetMarginLabel,
      promoTargetMarginHint: t.promoTargetMarginHint,
      promoReverseEmpty: t.promoReverseEmpty,
      promoReverseBad: t.promoReverseBad,
      promoResReverseDiscount: t.promoResReverseDiscount,
      promoResReverseNeed: t.promoResReverseNeed,
      // 第四段：活动效果评估（R764）
      promoSecEffect: t.promoSecEffect,
      // 🔴 R779：①段防误导 + 基线缺失提示
      promoDiscountNote: t.promoDiscountNote,
      promoBaselineMissing: t.promoBaselineMissing,
      promoEffectIntro: t.promoEffectIntro,
      promoEffectExpLabel: t.promoEffectExpLabel,
      promoEffectExpHint: t.promoEffectExpHint,
      promoEffectDaysLabel: t.promoEffectDaysLabel,
      promoEffectDaysUnit: t.promoEffectDaysUnit,
      promoEffectOnceLabel: t.promoEffectOnceLabel,
      promoEffectOnceHint: t.promoEffectOnceHint,
      promoEffectFixedLabel: t.promoEffectFixedLabel,
      promoEffectFixedHint: t.promoEffectFixedHint,
      promoEffectEmpty: t.promoEffectEmpty,
      promoEffectBad: t.promoEffectBad,
      promoEffectTitle: t.promoEffectTitle,
      promoEffectProfit: t.promoEffectProfit,
      promoEffectLoss: t.promoEffectLoss,
      promoEffectOriginal: t.promoEffectOriginal,
      promoEffectPromo: t.promoEffectPromo,
      promoEffectGrossDiff: t.promoEffectGrossDiff,
      promoEffectInvest: t.promoEffectInvest,
      promoEffectBreakEven: t.promoEffectBreakEven,
      promoEffectBreakEvenHint: t.promoEffectBreakEvenHint,
      promoFoot: t.promoFoot,
    },
    kindNames: [],
    kindIndex: 0,
    kind: 'off',
    modeNames: [t.promoModeOnce, t.promoModeEach],
    modeIndex: 0,
    rule: {
      discount: '', threshold: '', cut: '', avgPrice: '', cap: '', mode: 'once',
      giftValue: '', giftCostPct: '',
      buy: '', free: '', n: '', face: '', limit: '', people: '',
      principal: '', bonus: '', payable: '', offset: '',
    },
    // 第二段三填（李老师要的"都他自己填"）
    marginPct: '',
    revenueYuan: '',
    avgPriceYuan: '',
    // 第三段两填（R761：直接填活动后毛利率反算）
    targetMarginPct: '',
    // 第二段（合并原④）：活动后预计流水 / 天数 / 一次性投入
    // 🔴 R779：删掉「日均固定成本」——做不做活动房租都要付，扣它等于扣两次（会诊+案例一致）
    expectedRevenueYuan: '',
    days: '',
    oneTimeCostYuan: '',
    // 各段结果彼此独立
    conv: null,     // 第一段：折扣换算（不依赖毛利率）
    back: null,     // 第二段：回本测算（依赖毛利率+折扣）
    reverse: null,  // 第三段：填活动后毛利率反算（R761）
    effect: null,   // 第四段：活动效果评估（R764）
    show: {},
  },

  onLoad() {
    this.setData({
      kindNames: KINDS.map((k) => t[k.nameKey]),
      show: this.showOf('off'),
    });
  },

  showOf(kind) {
    const m = {
      off: { discount: true },
      // R763/R764：满减的等效折扣依赖客单价；每满还要封顶
      threshold: { threshold: true, cut: true, avgPrice: true, mode: true, cap: true },
      // R764：赠品要客单价 + 赠品标价 + 赠品成本率
      gift: { avgPrice: true, giftValue: true, giftCostPct: true },
      bogo: { buy: true, free: true },
      nth: { n: true },
      voucher: { face: true, threshold: true, limit: true },
      share: { people: true, free: true },
      stored: { principal: true, bonus: true },
      offset: { payable: true, offset: true },
      direct: { discount: true },
    };
    return m[kind] || {};
  },

  onKindChange(e) {
    const i = Number(e.detail.value) || 0;
    const k = KINDS[i] || KINDS[0];
    this.setData({ kindIndex: i, kind: k.key, show: this.showOf(k.key) }, () => this.recalc());
  },

  onModeChange(e) {
    const i = Number(e.detail.value) || 0;
    const rule = Object.assign({}, this.data.rule);
    rule.mode = i === 1 ? 'each' : 'once';
    this.setData({ modeIndex: i, rule: rule }, () => this.recalc());
  },

  onInput(e) {
    const f = (e.currentTarget.dataset.f || '');
    if (!f) return;
    const v = e.detail.value;
    // 顶层字段（不属于活动规则的）
    const TOP = ['marginPct', 'revenueYuan', 'avgPriceYuan', 'targetMarginPct',
      'expectedRevenueYuan', 'days', 'oneTimeCostYuan'];
    if (TOP.indexOf(f) >= 0) {
      const patch = {}; patch[f] = v;
      this.setData(patch, () => this.recalc());
      return;
    }
    const rule = Object.assign({}, this.data.rule);
    rule[f] = v;
    this.setData({ rule: rule }, () => this.recalc());
  },

  /** 折扣展示：0.8 →「8 折」；用 toFixed 不吞小数（0.8333 不能显示成 8 折） */
  asZhe(x) {
    const n = Number(x);
    if (!isFinite(n) || n <= 0) return '';
    return String(Number((n * 10).toFixed(2))) + t.promoZheUnit;
  },

  /**
   * 各段分离重算（彼此独立，一段坏不影响另一段）：
   *   ① conv：只要活动规则填齐就算出折扣 —— **毛利率无关**，这是主入口。
   *   ② back：conv.ok 且毛利率 >0 才算回本；毛利率空 ⇒ back=null。
   *   ③ reverse：R761 填活动后毛利率反算 —— 只要两个毛利率填了就算，不依赖活动规则。
   *   ④ effect：R764 填活动后预计流水+天数 ⇒ 出预计赔赚（依赖 back 的活动后毛利率）。
   */
  recalc() {
    const d = this.data;
    // 第一段：独立折扣换算（不被毛利率卡住）
    const cv = promoConvert(d.kind, d.rule);
    // R763/R764：把引擎的 note 标记翻成老板看得懂的话
    let noteText = '';
    if (cv.ok) {
      if (cv.note === 'below_threshold') noteText = t.promoBelowThreshold;
      else if (cv.note === 'no_avg_price') {
        noteText = t.promoNoAvgPrefix + (Number(d.rule.threshold) || 0) + t.promoNoAvgSuffix;
      } else if (cv.note === 'gift_list_price') {
        // 🔴 赠品最关键的一条提示：折扣是宣传口径，算账看成本
        noteText = t.promoGiftPrefix + cv.giftCostYuan + t.promoGiftMid + cv.lossPer100 + t.promoGiftSuffix;
      }
      if (cv.capped) noteText += t.promoCappedPrefix + cv.cutTotal + t.promoCappedSuffix;
    }
    const conv = cv.ok
      ? { ok: true, discountText: this.asZhe(cv.discount), formula: cv.formula,
          note: cv.note, noteText: noteText, limitInfo: cv.limitInfo,
          lossPer100: cv.lossPer100, giftCostYuan: cv.giftCostYuan,
          mode: cv.mode, cutTotal: cv.cutTotal, capped: cv.capped }
      : { ok: false };

    // 第二段：回本（依赖第一段折扣 + 毛利率）
    let back = null;
    const m = Number(d.marginPct);
    if (conv.ok && m > 0) {
      const common = {
        marginPct: m,
        revenueYuan: Number(d.revenueYuan) || undefined,
        avgPriceYuan: Number(d.avgPriceYuan) || undefined,
      };
      // 🔴 R764：赠品走 engine 的独立 gift 模型（不套折扣口径，否则客流倍数失真）
      const r = (d.kind === 'gift')
        ? promoCalc(Object.assign({ kind: 'gift', rule: d.rule }, common))
        : promoCalc(Object.assign({ discount: cv.discount }, common));
      if (r && r.ok) {
        // 🔴 R764：赠品的临界值是「每百元让利上限」百分数，不是折扣系数 —— 不能套 asZhe
        if (d.kind === 'gift') {
          r.criticalShow = r.criticalLossPct + '%';
          r.criticalIsLoss = true;
        } else {
          r.criticalShow = this.asZhe(r.criticalDiscount);
          r.criticalIsLoss = false;
        }
      }
      back = r;
    }

    // 第三段（R761）：填活动后毛利率反算 —— 只需现毛利率 + 目标毛利率，不依赖活动规则。
    let reverse = null;
    const gm = Number(d.marginPct);
    const tm = Number(d.targetMarginPct);
    if (gm > 0 && tm > 0) {
      const rr = reverseFromMargin({
        marginPct: gm, targetMarginPct: tm,
        revenueYuan: Number(d.revenueYuan) || undefined,
        avgPriceYuan: Number(d.avgPriceYuan) || undefined,
      });
      if (rr && rr.ok) rr.discountText = this.asZhe(rr.discount);
      reverse = rr;
    }

    // 第二段下半（R764建/R779并）：赚赔评估 —— 必须已有活动后毛利率（back.ok）+ 预计流水 + 天数
    let effect = null;
    const expRaw = String(d.expectedRevenueYuan == null ? '' : d.expectedRevenueYuan).trim();
    const daysRaw = String(d.days == null ? '' : d.days).trim();
    const baseRaw = String(d.revenueYuan == null ? '' : d.revenueYuan).trim();
    // 🔴 R779：基线（现在日流水）是增量口径的必要条件 —— 缺它就让 effect 保持 null，
    //   页面走 !effect 分支显示「填现在日流水才能算赚还是赔」；不能丢个 ok:false 让老板以为是算错了。
    if (back && back.ok && baseRaw !== '' && Number(baseRaw) > 0 && expRaw !== '' && daysRaw !== '') {
      const eff = promoEffect({
        marginPct: m,
        newMarginPct: back.newMarginPct,
        newMarginPctExact: back.newMarginPctExact,
        baselineRevenueYuan: Number(d.revenueYuan),
        expectedRevenueYuan: Number(expRaw),
        days: Number(daysRaw),
        oneTimeCostYuan: d.oneTimeCostYuan,
      });
      if (eff && eff.ok) {
        eff.netText = (eff.netDiff > 0 ? '+' : '') + eff.netDiff;
        eff.grossDiffText = (eff.grossDiff > 0 ? '+' : '') + eff.grossDiff;
      }
      effect = eff;
    }

    // 🔴 一次 setData 设各段：嵌套回调在 evaluate/真机快速连填时会丢结果（R759 实拍踩到）
    this.setData({ conv: conv, back: back, reverse: reverse, effect: effect });
  },
});
