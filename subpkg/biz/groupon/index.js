// subpkg/biz/groupon/index.js —— M3.37/R190 到店团购渠道层（纯试算页）
//
// ⚠️ 计算下沉：本页**不做任何金额口径计算**，只把用户录入转成分、喂给纯计算单源
//   `utils/grouponDerive.js::calcGrouponOrder`。试算结果**不落库**。
// ⚠️ 付费域：团购复用外卖权益（m3_takeaway）⇒ 点「算到手」时经 fetchEntitlement 判定，
//   未开通走 openPaywall('takeaway')（与 R159 付费墙口径一致，不自造判断分支）。
// 🔴 R190：团购是 M3 的**第二个渠道**（外卖是第一个）。成本侧只在选卡时取一次
//   （card_type 仅 1/3），到手侧按渠道算多次；本页只补「到手侧」——**不新增卡类型**。
// 🔴 红线（与 grouponDerive.js 头部一致）：
//   ① 佣金基数 = 顾客实付团购价（不是原价）；② 费率无默认值（R128，不填按 0）；
//   ③ 与堂食对比只在给了挂牌价时才出；④ 结果不进 M1（输出不含任何 monthly 字段）。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const { openPaywall } = require('../../../utils/paywall.js');
const { fetchEntitlement } = require('../../../utils/entitlement.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const { calcGrouponOrder } = require('../../../utils/grouponDerive.js');
const dh = require('../../../utils/dataHealth.js'); // R299：getCostCard 出参 truncated 必须透传（选卡清单可能不全）

const G = TERMS.card; // groupon* 文案挂在 TERMS.card 下

Page({
  data: {
    t: {
      title: G.grouponTitle,
      hint: G.grouponHint,
      pick: G.grouponPick,
      pickPh: G.grouponPickPh,
      price: G.grouponPrice,
      pricePh: G.grouponPricePh,
      rate: G.grouponRate,
      ratePh: G.grouponRatePh,
      promo: G.grouponPromo,
      dine: G.grouponDine,
      calc: G.grouponCalc,
      result: G.grouponResult,
      commission: G.grouponCommission,
      net: G.grouponNet,
      profit: G.grouponProfit,
      netRate: G.grouponNetRate,
      vsDine: G.grouponVsDine,
      vsDineMore: G.grouponVsDineMore,
      lossHint: G.grouponLossHint,
      dataTruncated: TERMS.ui.dataTruncated,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    dishes: [],          // 候选卡/套餐（含 card_type、unit_cost_fen）
    cardIndex: -1,       // 当前选中的候选下标
    priceYuan: '',       // 团购价（元，录入）
    ratePct: '',         // 佣金率（%，无默认）
    promoYuan: '',       // 推广费（选填，元）
    dineYuan: '',        // 堂食挂牌价（选填，元）
    result: null,        // calcGrouponOrder 输出
    view: null,          // 展示用（分→元）
    truncated: false,    // R299：成本卡列表可能被服务端截断
    loading: true,
  },

  onLoad() { this.load(); },

  async load() {
    try {
      await api.ensureShop();
      ui.setTitle(G.grouponTitle);
      // 候选卡/套餐：单品卡 + 套餐卡都可作为一单的组成项（与外卖页同构）
      const cd = await api.call('getCostCard', {});
      const dishes = (cd.list || []).map((c) => ({
        card_id: c.card_code,
        name: c.name || '',
        card_type: c.card_type,
        // 🔴 成本口径（R443 核验，勿再"修"）：total_cost_fen = 卡引擎 unit_cost_fen
        //   = (Σ原料明细 + 辅料) ÷ (1 − 损耗率)，**不含任何包材/打包费**（见
        //   cloudfunctions/saveCostCard/service.js:66-96）。外卖的包材是 packs 独立行、
        //   由 takeawayDerive 单独算 pack_cost_fen；到店团购本就无包材（R190）⇒ 此处直接取用即正确。
        unit_cost_fen: c.total_cost_fen || 0,
        price_fen: c.price_fen || 0,
      }));
      // 🔴 R299：列表达上限会被服务端截断 ⇒ 候选卡不全 ⇒ 选卡清单静默缺行，必须可见降级。
      this.setData({ dishes, truncated: dh.isTruncated(cd), loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onPick(e) {
    const i = Number(e.detail.value);
    this.setData({ cardIndex: i });
  },
  onPrice(e) { this.setData({ priceYuan: e.detail.value }); },
  onRate(e) { this.setData({ ratePct: e.detail.value }); },
  onPromo(e) { this.setData({ promoYuan: e.detail.value }); },
  onDine(e) { this.setData({ dineYuan: e.detail.value }); },

  // ===== 计算（付费墙：点「算到手」时拦）=====
  async onCalc() {
    const ent = await fetchEntitlement().catch(() => null);
    if (!ent || !ent.is_active) {
      openPaywall('groupon', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
      return;
    }
    const idx = this.data.cardIndex;
    if (idx < 0 || !this.data.dishes[idx]) { wx.showToast({ title: this.data.t.pick, icon: 'none' }); return; }
    if (!this.data.priceYuan) { wx.showToast({ title: G.grouponNeedPrice, icon: 'none' }); return; }
    // 元→分（与外卖页同一换算，乘 100 取整）
    const fen = (v) => Math.round(Number(((Number(v) || 0) * 100).toFixed(10)));
    const r = calcGrouponOrder({
      priceFen: fen(this.data.priceYuan),
      costFen: this.data.dishes[idx].unit_cost_fen,
      ratePct: Number(this.data.ratePct) || 0,
      promoFen: fen(this.data.promoYuan),
      dineFen: fen(this.data.dineYuan),
    });
    const fmt = (v) => (v / 100).toFixed(2);
    this.setData({
      result: r,
      view: {
        price: fmt(r.priceFen),
        commission: fmt(r.commissionFen),
        promo: fmt(r.promoFen),
        net: fmt(r.netFen),
        profit: fmt(r.profitFen),
        netRate: r.netRatePct,
        profitRate: r.profitRatePct,
        // vsDineFen = 堂食毛利 − 团购利润（见 grouponDerive.js）⇒ < 0 才是团购多赚；
        // 与 card/edit.js 的 vsDineNeg（> 0 = 团购拉低毛利）同源，勿反。
        // 金额一律取绝对值，避免「多赚 ¥-5.00」
        vsDine: fmt(Math.abs(r.vsDineFen)),
        vsDineMore: r.vsDineFen < 0,
        hasDine: r.hasDine,
      },
    });
  },
});
