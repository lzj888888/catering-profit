// subpkg/tools/promo/index.js —— 做活动划算吗（R757 · 2026-11-25）
//
// 🔴 定位：**纯手填轻工具，零数据依赖**。
//   · 不调任何云函数（本文件没有 require api.js）⇒ 没建店、没记账的老板也能用 ⇒ 可做拉新入口。
//   · 与 M2 沙盘里那个（PROMO_ENABLED=false）不是一回事：沙盘要固定费用、算保本营业额；
//     本页不要固定费用，算「要保住原来那笔毛利，得多来多少客人」。
//   · 算法全在 utils/promoCalc.js（46 条自测，与国外 Breakeven Sales Uplift 基准对拍）。
//
// 🔴 交互要求（李老师 2026-11-25）：「好多数都他自己填…满多少减多少，那都他自己填，
//   满 100 他填个减 20 减 30 自动变化」。⇒ 一律 `bindinput` 即时重算，**不设「计算」按钮**。
//   纯本地算术，不做防抖（一次几微秒，防抖反而让数字跳得慢）。

const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const { promoCalc } = require('../../../utils/promoCalc.js');

const t = TERMS.card;

// 活动形式清单（顺序＝页面 picker 顺序；显示名全走 terms，不在这里写字面量）
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
      promoSecNow: t.promoSecNow,
      promoMarginLabel: t.promoMarginLabel,
      promoMarginHint: t.promoMarginHint,
      promoRevenueLabel: t.promoRevenueLabel,
      promoYuanUnit: t.promoYuanUnit,
      promoRevenueHint: t.promoRevenueHint,
      promoPriceLabel: t.promoPriceLabel,
      promoPriceHint: t.promoPriceHint,
      promoSecAct: t.promoSecAct,
      promoKindLabel: t.promoKindLabel,
      promoParamDiscount: t.promoParamDiscount,
      promoParamThreshold: t.promoParamThreshold,
      promoParamCut: t.promoParamCut,
      promoBelowThresholdHint: t.promoBelowThresholdHint,
      promoParamBuy: t.promoParamBuy,
      promoParamN: t.promoParamN,
      promoParamFace: t.promoParamFace,
      promoParamPeople: t.promoParamPeople,
      promoParamFree: t.promoParamFree,
      promoParamPrincipal: t.promoParamPrincipal,
      promoParamBonus: t.promoParamBonus,
      promoParamPayable: t.promoParamPayable,
      promoParamOffset: t.promoParamOffset,
      promoEmptyHint: t.promoEmptyHint,
      promoResTitle: t.promoResTitle,
      promoRiskPrefix: t.promoRiskPrefix,
      promoRiskOk: t.promoRiskOk,
      promoRiskWatch: t.promoRiskWatch,
      promoRiskRisky: t.promoRiskRisky,
      promoResDiscount: t.promoResDiscount,
      promoResNewMargin: t.promoResNewMargin,
      promoResTraffic: t.promoResTraffic,
      promoResRevenue: t.promoResRevenue,
      promoResOrders: t.promoResOrders,
      promoOrdersUnit: t.promoOrdersUnit,
      promoResOrdersNow: t.promoResOrdersNow,
      promoResCritical: t.promoResCritical,
      promoResCriticalHint: t.promoResCriticalHint,
      promoBelowThreshold: t.promoBelowThreshold,
      promoAltTitle: t.promoAltTitle,
      promoAlt1: t.promoAlt1,
      promoAlt2: t.promoAlt2,
      promoAlt3: t.promoAlt3,
      promoRiskImpossible: t.promoRiskImpossible,
      promoImpossibleHint: t.promoImpossibleHint,
      promoFoot: t.promoFoot,
    },
    kindNames: [],
    kindIndex: 0,
    kind: 'off',
    // 基础三填（李老师要的"都他自己填"）
    marginPct: '',
    revenueYuan: '',
    avgPriceYuan: '',
    // 活动规则参数（按 kind 只显示相关的几个）
    rule: { discount: '', threshold: '', cut: '', buy: '', free: '', n: '', face: '', people: '', principal: '', bonus: '', payable: '', offset: '' },
    res: null,
    // 渲染开关（wxml 用它决定显示哪几个输入框）
    show: {},
  },

  onLoad() {
    const kindNames = KINDS.map((k) => t[k.nameKey]);
    this.setData({ kindNames: kindNames, show: this.showOf('off') });
  },

  /** 某个活动形式需要显示哪些参数框 */
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
    const v = e.detail.value;
    if (!f) return;
    if (f === 'marginPct' || f === 'revenueYuan' || f === 'avgPriceYuan') {
      const patch = {}; patch[f] = v;
      this.setData(patch, () => this.recalc());
      return;
    }
    const rule = Object.assign({}, this.data.rule);
    rule[f] = v;
    this.setData({ rule: rule }, () => this.recalc());
  },

  /**
   * 重算。
   * 🔴 空输入 ⇒ res = null（显示提示语），**不显示 0**：
   *   给 0 会让老板以为"这活动不亏"，是最危险的误导。
   */
  recalc() {
    const d = this.data;
    const m = Number(d.marginPct);
    if (!(m > 0)) { this.setData({ res: null }); return; }
    const r = promoCalc({
      marginPct: m,
      revenueYuan: Number(d.revenueYuan) || undefined,
      avgPriceYuan: Number(d.avgPriceYuan) || undefined,
      kind: d.kind,
      rule: d.rule,
    });
    // 折扣展示：0.8 ⇒「8 折」、0.625 ⇒「6.25 折」。用 toFixed 而非 *10 取整，
    // 避免 0.8333 显示成「8 折」把 3 个点吃掉（老板会按 8 折去定价）。
    const asZhe = (x) => {
      const n = Number(x);
      if (!isFinite(n) || n <= 0) return '';
      const z = Number((n * 10).toFixed(2));
      return String(z) + t.promoZheUnit;
    };
    if (r && r.ok) {
      r.discountShow = asZhe(r.discount);
      r.criticalDiscountShow = asZhe(r.criticalDiscount);
    } else if (r && r.criticalDiscount) {
      r.criticalDiscountShow = asZhe(r.criticalDiscount);
    }
    this.setData({ res: r });
  },
});
