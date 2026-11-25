// subpkg/tools/promo/index.js —— 活动换算 · 回本测算（R757 建 / R759 按李老师纠偏重构）
//
// 🔴 R759 纠偏（李老师 2026-11-25 原话）：
//   「我本意是做个计算工具，比如 2送1 相当于打几折，最终大部分都去到『是打了几折』这个问题；
//    然后有一个是做活动降低毛利率了，需要多少回到原来的利润水平。」
//   ⇒ 页面**两段、有主次**：
//     ① 主（80% 心智）：活动规则 → 相当于几折 + 推导式。**不需要毛利率**，进来就会。
//     ② 次：活动后毛利率降了 → 要做多少流水/多少单才回到原来的利润。这段才要毛利率。
//   旧版病根：把「相当于几折」藏在结果区小格、还被「先填毛利率」的 return 卡住 —— 主次颠倒。
//
// 🔴 零数据依赖：不 require api.js、不调云函数，没建店的老板也能用（拉新入口）。
// 🔴 输入即重算（李老师）：bindinput 即时出数，不设「计算」按钮。

const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const { promoCalc, promoConvert } = require('../../../utils/promoCalc.js');

const t = TERMS.card;

// 活动形式清单（顺序＝页面 picker 顺序；显示名全走 terms）
const KINDS = [
  { key: 'off', nameKey: 'promoKindOff' },
  { key: 'threshold', nameKey: 'promoKindThreshold' },
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
      promoResOrders: t.promoResOrders,
      promoResOrdersNow: t.promoResOrdersNow,
      promoResTraffic: t.promoResTraffic,
      promoResCritical: t.promoResCritical,
      promoResCriticalHint: t.promoResCriticalHint,
      promoFoot: t.promoFoot,
    },
    kindNames: [],
    kindIndex: 0,
    kind: 'off',
    rule: { discount: '', threshold: '', cut: '', buy: '', free: '', n: '', face: '', people: '', principal: '', bonus: '', payable: '', offset: '' },
    // 第二段三填（李老师要的"都他自己填"）
    marginPct: '',
    revenueYuan: '',
    avgPriceYuan: '',
    // 两段结果彼此独立
    conv: null,   // 第一段：折扣换算（不依赖毛利率）
    back: null,   // 第二段：回本测算（依赖毛利率）
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
      threshold: { threshold: true, cut: true },
      bogo: { buy: true, free: true },
      nth: { n: true },
      voucher: { face: true, threshold: true },
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

  onInput(e) {
    const f = (e.currentTarget.dataset.f || '');
    if (!f) return;
    const v = e.detail.value;
    if (f === 'marginPct' || f === 'revenueYuan' || f === 'avgPriceYuan') {
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
   * 两段分离重算：
   *   ① conv：只要活动规则填齐就算出折扣 —— **毛利率无关**，这是 80% 心智。
   *   ② back：conv.ok 且毛利率 >0 才算回本；毛利率空 ⇒ back=null（不显示假数）。
   */
  recalc() {
    const d = this.data;
    // 第一段：独立折扣换算（不被毛利率卡住）
    const cv = promoConvert(d.kind, d.rule);
    const conv = cv.ok
      ? { ok: true, discountText: this.asZhe(cv.discount), formula: cv.formula, note: cv.note }
      : { ok: false };
    // 第二段：回本（依赖第一段折扣 + 毛利率）
    let back = null;
    const m = Number(d.marginPct);
    if (conv.ok && m > 0) {
      const r = promoCalc({
        marginPct: m,
        revenueYuan: Number(d.revenueYuan) || undefined,
        avgPriceYuan: Number(d.avgPriceYuan) || undefined,
        discount: cv.discount,
      });
      if (r && r.ok) r.criticalDiscountShow = this.asZhe(r.criticalDiscount);
      back = r;
    }
    // 🔴 一次 setData 设两段：嵌套回调在 evaluate/真机快速连填时会丢 back（本次实拍踩到）
    this.setData({ conv: conv, back: back });
  },
});
