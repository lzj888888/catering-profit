// pages/m3/dishreview/index.js —— M3.33 单品毛利复盘（只读排名页）
//
// 数据：getDishReview() 读 external_sales_daily（堂食+外卖）+ shop_cost_card → 服务端排名（§2.4 口径写死）。
// 🔴 只读：本页只调 getDishReview，**绝不**写成本卡 / M1 / 销量。
// 🔴 付费墙：看复盘才拦（m3_dishreview）。getDishReview 返回 FEATURE_LOCKED ⇒ openPaywall('dishreview')；
//    导入可免费保存（见 terms.paywall.dishreview.content）。
// 🔴 两来源分开呈现：堂食榜 + 外卖榜（按平台分块）。红线 18：不默认外卖=0，无数据 ⇒ 空态。
// 🔴 未匹配菜品单列 + 「去映射」入口（红线 17：不静默归零）。
// 🔴 v1.7 C-5：零价高销量行（amount=0 且 qty>0）标「口味询问类 SKU，不计营收」，不剔除。
// 毛利率阈值用户自定义（默认 30 仅占位，不做成警戒线 —— R128 同族）。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const { openPaywall } = require('../../../utils/paywall.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');

const fenYuan = (fen) => (Number(fen) || 0) / 100;
const fmtYuan = (fen) => fenYuan(fen).toFixed(2);
const fmtPct = (p) => (Number(p) || 0).toFixed(2) + '%';

Page({
  data: {
    t: {
      reviewTitle: TERMS.card.reviewTitle,
      reviewAfterFact: TERMS.card.reviewAfterFact,
      reviewDineIn: TERMS.card.reviewDineIn,
      reviewTakeaway: TERMS.card.reviewTakeaway,
      reviewTakeawayEmpty: TERMS.card.reviewTakeawayEmpty,
      reviewZeroAmount: TERMS.card.reviewZeroAmount,
      reviewRankTitle: TERMS.card.reviewRankTitle,
      reviewDish: TERMS.card.reviewDish,
      reviewQty: TERMS.card.reviewQty,
      reviewRevenue: TERMS.card.reviewRevenue,
      reviewCost: TERMS.card.reviewCost,
      reviewGross: TERMS.card.reviewGross,
      reviewMargin: TERMS.card.reviewMargin,
      reviewThreshold: TERMS.card.reviewThreshold,
      reviewThresholdHint: TERMS.card.reviewThresholdHint,
      reviewUnmatched: TERMS.card.reviewUnmatched,
      reviewUnmatchedHint: TERMS.card.reviewUnmatchedHint,
      reviewGoMap: TERMS.card.reviewGoMap,
      reviewGoCard: TERMS.card.reviewGoCard,
      reviewEmpty: TERMS.card.reviewEmpty,
      reviewTotals: TERMS.card.reviewTotals,
      reviewTotalQty: TERMS.card.reviewTotalQty,
      reviewTotalRevenue: TERMS.card.reviewTotalRevenue,
      reviewTotalCost: TERMS.card.reviewTotalCost,
      reviewTotalGross: TERMS.card.reviewTotalGross,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    loading: true,
    locked: false,
    threshold: 30,           // 用户自定义阈值（默认占位值，非警戒线）
    thresholdInput: '30',
    curMonth: '',
    dineIn: [],              // 堂食排行（已预处理展示字段）
    takeaway: null,          // 外卖：null=空态；否则 [{ platform, platformName, ranked, totals }]
    unmatched: [],           // 未匹配菜品
    totals: null,
    empty: false,
  },

  onLoad() { this.init(); },
  onShow() { if (this.data.locked) this.init(); },   // 从付费弹窗返回后重试

  async init() {
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.reviewTitle);
      this.setData({ curMonth: ui.nowMonth() });
      await this.load();
    } catch (e) {
      this.setData({ loading: false });
      if (e && e.code === 'FEATURE_LOCKED') {
        this.setData({ locked: true });
        openPaywall('dishreview', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
        return;
      }
      api.toastError(e);
    }
  },

  // 预处理一行排行为展示字段（堂食/外卖共用；zeroAmount 仅外卖）
  fmtRanked(x) {
    const snapMonth = x.snapshot_month || '';
    const isOld = snapMonth && snapMonth !== this.data.curMonth;
    return {
      name: x.name || x.dish_key,
      qty: x.qty,
      revenueText: fmtYuan(x.amountFen),
      costText: fmtYuan(x.totalCostFen),
      grossText: fmtYuan(x.grossFen),
      marginPct: x.marginPct,
      marginText: fmtPct(x.marginPct),
      snapshotNote: isOld ? TERMS.card.reviewSnapshotOf(snapMonth) : '',
      zeroAmount: !!x.zeroAmount,   // v1.7 C-5：口味询问类 SKU
      below: false,
    };
  },

  fmtTotals(t) {
    return t ? {
      qty: t.qty,
      revenueText: fmtYuan(t.amountFen),
      costText: fmtYuan(t.costFen),
      grossText: fmtYuan(t.grossFen),
      // 🔴 R251：`unmatchedCount` 必须带出来 —— 它是**判「平台块为什么是空的」的唯一准确依据**
      //   （前端**不许**自己猜：拿 qty>0 当判据会把「全 0 份的菜」误判成账单级）。
      unmatchedCount: t.unmatchedCount || 0,
    } : null;
  },

  async load() {
    this.setData({ loading: true });
    const d = await api.call('getDishReview', {});

    const dineIn = (d.dine_in || []).map((x) => this.fmtRanked(x));

    // 🔴 R249-B（附带发现，与 is_deleted 同轮修）：外卖的「未匹配菜品」**只**嵌在
    //   `takeaway.by_platform[p].unmatched` 里，而前端**从不读**它（只读顶层 `d.unmatched`，
    //   而顶层那份是 `buildDishInReview` 的产物 = **仅堂食**）⇒ 外卖路径下
    //   「红线 17：不静默归零」**未落地**：外卖商品全部匹配不上成本卡时，
    //   外卖榜区块因 `ranked.length === 0` 连表头都不渲染，只留一个**空标题**，
    //   用户可见 =「导了但什么都没变」（正是 R249 报障现场的第二层）。
    //   修法：按菜名合并（堂食 + 各外卖平台）后并入下方同一张「未匹配菜品」表 ——
    //   复用既有文案 `reviewUnmatched/reviewUnmatchedHint/reviewGoMap` 与既有渲染块
    //   ⇒ **零新增可见文案**（不必动术语三处同步面）。同名单跨平台只出一行、qty/金额相加。
    const unmatchedMap = new Map();
    const pushUnmatched = (x, platName) => {
      const nm = x.name || x.dish_key || '';
      if (!nm) return;
      const cur = unmatchedMap.get(nm) || { name: nm, qty: 0, amountFen: 0, platforms: new Set() };
      cur.qty += x.qty || 0;
      cur.amountFen += x.amountFen || 0;
      if (platName) cur.platforms.add(platName);
      unmatchedMap.set(nm, cur);
    };
    // 🔴 R251：合并时**必须带上来源平台** —— 否则跨平台合并成一张表后，
    //   用户看不出某道菜来自淘宝还是京东（真机报障：「京东我也导入了，可是没看到 JD 字样」）。
    //   平台名走既有单源 `TERMS.card.reviewPlatformNames`（+ 堂食名 `reviewDineIn`），**零新增文案**。
    const PLAT_NAMES = TERMS.card.reviewPlatformNames;
    (d.unmatched || []).forEach((x) => pushUnmatched(x, TERMS.card.reviewDineIn));
    if (d.takeaway && d.takeaway.by_platform) {
      for (const p of Object.keys(d.takeaway.by_platform)) {
        const pn = PLAT_NAMES[p] || p;
        (((d.takeaway.by_platform[p] || {}).unmatched) || []).forEach((x) => pushUnmatched(x, pn));
      }
    }
    const unmatched = Array.from(unmatchedMap.values()).map((x) => ({
      name: x.name,
      qty: x.qty,
      amountText: fmtYuan(x.amountFen),
      platformText: Array.from(x.platforms).join(' / '),
      // 🔴 R251：0 元高份数行 = v1.7 C-5 的「口味询问类 SKU」（如「来点辣椒吗」43 份 / 0 元）。
      //   该标记原先**只在 `ranked` 分支里打**（service.js::buildTakeawayReview），
      //   一旦这行没有成本卡、掉进 `unmatched`，标记就丢了 ⇒ 43 份 0 元混在未匹配里，
      //   把读者对「份数」的观感推高。此处按同一口径（amount 0 且 qty>0）在前端补回，复用既有文案。
      zeroAmount: x.amountFen === 0 && x.qty > 0,
    }));
    const totals = this.fmtTotals(d.totals);

    // 外卖：按平台分块（无数据 ⇒ null 空态，不默认 0）
    // 🔴 R251：每块必须带出「合计 + 未匹配数 + 空榜成因」，否则榜为空时页面上只剩一个**光标题**
    //   （李老师 2026-10-09 真机报障：「又有京东又有淘宝…是不是混乱了」）。
    //   成因判据用后端已算好的 `totals.unmatchedCount`，**不用前端猜**：
    //     unmatchedCount > 0 ⇒ 有菜品行但一张卡都没匹配上；
    //     unmatchedCount = 0 且 ranked 空 ⇒ 该平台只进了「账单级」行（dish_key 为空，被 rankReview 跳过）。
    const names = TERMS.card.reviewPlatformNames;
    let takeaway = null;
    if (d.takeaway && d.takeaway.by_platform) {
      takeaway = Object.keys(d.takeaway.by_platform).map((p) => {
        const b = d.takeaway.by_platform[p];
        const ranked = (b.ranked || []).map((x) => this.fmtRanked(x));
        const totals = this.fmtTotals(b.totals);
        const unmatchedCount = (totals && totals.unmatchedCount) || 0;
        return {
          platform: p,
          platformName: names[p] || p,
          ranked,
          totals,
          unmatchedCount,
          emptyReason: ranked.length ? ''
            : (unmatchedCount > 0 ? TERMS.card.reviewPlatformAllUnmatched : TERMS.card.reviewPlatformBillOnly),
        };
      });
    }

    this.setData({
      loading: false,
      locked: false,
      dineIn,
      takeaway,
      unmatched,
      totals,
      empty: dineIn.length === 0 && unmatched.length === 0 && !takeaway,
    });
    this.markRows();
  },

  // 阈值变化 → 重标红（仅提示，不影响任何计算口径）
  onThreshold(e) {
    const raw = e.detail.value;
    const n = Number(raw);
    this.setData({
      thresholdInput: raw,
      threshold: isFinite(n) && n >= 0 ? n : 0,
    });
    this.markRows();
  },

  markRows() {
    const th = this.data.threshold;
    const dineIn = this.data.dineIn.map((x) => Object.assign({}, x, { below: x.marginPct < th }));
    const takeaway = this.data.takeaway
      ? this.data.takeaway.map((b) => Object.assign({}, b, {
          ranked: b.ranked.map((x) => Object.assign({}, x, { below: x.marginPct < th })),
        }))
      : null;
    this.setData({ dineIn, takeaway });
  },

  // 「去映射」= 去建缺失的成本卡（未匹配菜品没有对应卡 ⇒ 建了卡即自动匹配）
  goMap() { wx.navigateTo({ url: '/pages/card/index' }); },
});
