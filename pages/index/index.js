// pages/index/index.js —— 批次 4 · 模块入口首页
// 首次进入拉 getShopContext（店铺 + 服务端权威开关），写入 app.globalData 后供全站请求携带 shop_id。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();
const shopGuard = require('../../utils/shopGuard.js');
// R493：免费档锁在付费墙后 ⇒ 首页也要读权益，免费显示参考口径、付费才显示会计利润
const entitle = require('../../utils/entitlement.js');
// R488：利润标签单一来源（名随数走）—— 首页/月首页/结果页三处共用，禁止各自再写一份判断
const profitLabel = require('../../utils/profitLabel.js');

Page({
  data: {
    t: {
      m1: TERMS.modules.m1.display,
      m1Sub: TERMS.modules.m1.subtitle,
      m2: TERMS.modules.m2.display,
      m2Sub: TERMS.modules.m2.subtitle,
      m3: TERMS.modules.m3.display,
      m3Sub: TERMS.modules.m3.subtitle,
      addShop: TERMS.buttons.addShop,
      shopName: TERMS.ui.shopName,
      defaultShopName: TERMS.ui.defaultShopName,
      settings: TERMS.ui.settings,
      loading: TERMS.ui.loading,
      tipMore: TERMS.ui.tipMore,
      switchShop: TERMS.exp.switchTitle,
      mine: TERMS.exp.mineTitle,
      // ── R207 头卡文案（新可见文案一律过 terms 单源，页面零硬编码）──
      heroSwitch: TERMS.ui.heroSwitch,
      heroRefLabel: TERMS.ui.heroRefLabel,
      heroNoData: TERMS.ui.heroNoData,
      heroNoDataHint: TERMS.ui.heroNoDataHint,
      heroCtaEnter: TERMS.ui.heroCtaEnter,
      heroCtaDetail: TERMS.ui.heroCtaDetail,
      cur: TERMS.ui.currencySymbol,
      // ── R234/J3 首页折叠引导条（复用 exp.guideBody 四步，不新写文案）──
      // 🔴 三处登记的第二处：术语源有了、wxml 用了，这里漏映射 ⇒ 页面渲染成**空白**且零报错
      //    （R124 同族：WXML 对 {{undefined}} 不报错、静默空）⇒ 由 check_page_terms 守。
      guideFoldShow: TERMS.exp.guideFoldShow,
      guideFoldHide: TERMS.exp.guideFoldHide,
      guideBody: TERMS.exp.guideBody,
    },
    shopName: '',
    loading: true,
    // R234/J3：首页折叠引导条**默认收起**（与月录入页 hintFold 的默认观感一致）。
    //   ⚠️ 只放展示态：不入库、不进快照 —— 用户下次进来回到「收起」，不占首屏。
    //   为什么不给「看过就不再显示」的持久化：本仓存储键约定要带 shopId+month，
    //   而这条引导与月份无关；为它单开一套存储键（还要处理换设备回默认）不如常驻折叠条简单。
    guideOpen: false,
    // ── R207 头卡数据区 ──
    curMonth: ui.nowMonth(),
    refProfit: '0.00',
    hasProfit: false,
    // 🔴 三态标志：**未确定 ≠ 无数据**。为 false 时既不显示数字、也不显示「还没有本月数据」，
    //    否则老用户每次进首页都会先闪一帧空态文案再跳成数字（观感像抖屏）。
    profitKnown: false,
    // 🔴 R488：这个数（total_factor_real_profit_fen）叫什么，由 utils/profitLabel.js 决定：
    //   盘点过 ⇒「本月利润」/ 没盘点 ⇒「估算利润」。取数回来前先用占位（= 常见情形），
    //   避免先闪一帧「本月利润」再跳成「估算利润」——两帧都带"利润"，不会读成别的意思。
    profitTitle: TERMS.ui.heroRefLabel,
  },

  onShow() {
    this.setData({ curMonth: ui.nowMonth() });
    this.bootstrap();
    this.loadRefProfit();
  },

  async bootstrap() {
    ui.setTitle(TERMS.app.title);
    this.setData({ loading: true });
    try {
      const ctx = await api.call('getShopContext', {});
      app.setShopContext(ctx);
      // R215：无店铺态（用户把店删空）⇒ 弹一次引导送往店铺页。
      //   ⚠️ 本页**保持「每次 onShow 都直拉」的语义**（不切到带缓存的 ensureShop），
      //   否则在设置页改完店铺名回首页会看到旧名 —— 那是「页面读缓存」的回退。
      if (ctx.no_shop) shopGuard.promptNoShop();
      this.setData({ shopName: ctx.shop_name || '', loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: (e && e.msg) || TERMS.ui.loadFailed, icon: 'none' });
    }
  },

  /**
   * R207：头卡的「本月利润」。
   * 🔴 R484：口径改为取 result.total_factor_real_profit_fen（**会计利润**，权责发生制）。
   *   原因：R484 定案"一个月只出一个数"，结果页已取消并排的双利润，首页必须跟到**同一个字段**，
   *   否则会出现「首页一个数、结果页另一个数」（两者差当月摊销），那正是本次要消灭的困惑。
   *   —— 与月度结果页**同一字段**，不在这里另算一遍（另算必漂）。
   * 🔴 静默降级：本请求只服务于一块**装饰性总结**，失败/未建档一律转空态，
   *    **不弹 toast、不阻塞主流程** —— 首页已经有一个 getShopContext 的失败提示，再加一个就是噪音。
   */
  async loadRefProfit() {
    try {
      const d = await api.call('getLedger', { month: ui.nowMonth() });
      // 🔴 R298 判据：有账本记录（account_id 非空）才算"有数据"，否则走空态（绝不显示 ¥0）。
      if (!d || !d.account_id) {
        this.setData({ hasProfit: false, profitKnown: true });
        return;
      }
      // R493：免费档（未开通）锁在付费墙后 ⇒ 只显示**参考口径**（operation_ref_profit_fen / 经营参考利润）；
      //   付费档才显示**会计利润**（total_factor_real_profit_fen / 本月利润）。两口径取数来源不同，
      //   必须按权益分流，否则免费档在首页看到的数会跟月首页（已按权益分流）对不上。
      const ent = await entitle.fetchEntitlement();
      const isPaid = entitle.isPaid(ent);
      const res = d.result || {};
      // 🔴 R298 判据：hasProfit 为真必须以「有账本记录（account_id）+ 有限数」为前置（无记录情形上面已 early-return）。
      //   R493：两档口径取数不同（付费=会计利润 / 免费=经营参考利润），按 isPaid 选字段，仍是同一个 if 守"有记录+有限数"。
      const fen = isPaid ? res.total_factor_real_profit_fen : res.operation_ref_profit_fen;
      if (d.account_id && typeof fen === 'number' && Number.isFinite(fen)) {
        // 🔴 R488：标签由单一来源生成（名随数走）—— 同一个数在这里、月首页、结果页必然同名。
        const lab = profitLabel.pickProfitLabel(d, isPaid ? 'real' : 'ref');
        this.setData({ hasProfit: true, refProfit: api.fenToYuan(fen, 2), profitKnown: true, profitTitle: lab.title });
      } else {
        this.setData({ hasProfit: false, profitKnown: true });
      }
    } catch (e) {
      this.setData({ hasProfit: false, profitKnown: true });
    }
  },

  goMonth() { wx.navigateTo({ url: '/subpkg/biz/month/index' }); },
  goSandbox() { wx.navigateTo({ url: '/subpkg/tools/sandbox/index' }); },
  // R191：M3 入口改指向**枢纽页**（pages/m3/hub），不再直接落进成本卡列表页。
  //   原因：原料库 / 外卖 / 对账 此前只能寄生在列表页顶部当按钮 ⇒ 分类说不明白。
  //   枢纽页只做「去哪」，列表页只做「找东西 + 新增」。
  // 🔴 R199：`pages/m3/hub` 已改为**底部 tabBar 页** ⇒ `wx.navigateTo` 到 tabBar 页会**失败**
  //   （微信限制：tabBar 页只能 `switchTab`，且不能带参数）。故改用 `wx.switchTab`。
  //   同理 `goMine()`（`pages/mine/index` 也在 tabBar 里）。
  goCard() { wx.switchTab({ url: '/pages/m3/hub' }); },
  goSettings() { wx.navigateTo({ url: '/subpkg/tools/shop/setting' }); },
  goSwitch() { wx.navigateTo({ url: '/subpkg/tools/shop/switch' }); },
  goMine() { wx.switchTab({ url: '/pages/mine/index' }); },

  // R234/J3：首页折叠引导条开关。
  //   ⚠️ 与月录入页的 `onToggleHintFold`（多键 map）**故意不同形**：那里是 15 处并列的提示、
  //      需要 map 记住每一处的开合；这里只有一条引导、单个布尔量即可 ⇒ 不硬套 map 形状。
  //   ⚠️ 与 mine 页 `onGuide`（wx.showModal 弹窗）并存：一个是「随时能看的常驻条」，
  //      一个是「我的 → 使用指引」的一次性弹窗，入口不同、不互相替代。
  onToggleGuide() {
    this.setData({ guideOpen: !this.data.guideOpen });
  },

  // R193：全局开了 enablePullDownRefresh，但本页**没实现** ⇒ 下拉转圈、松手没反应（假刷新）。
  onPullDownRefresh() {
    Promise.all([this.bootstrap(), this.loadRefProfit()]).then(() => wx.stopPullDownRefresh());
  },
});
