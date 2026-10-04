// pages/index/index.js —— 批次 4 · 模块入口首页
// 首次进入拉 getShopContext（店铺 + 服务端权威开关），写入 app.globalData 后供全站请求携带 shop_id。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();
const shopGuard = require('../../utils/shopGuard.js');

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
    },
    shopName: '',
    loading: true,
    // ── R207 头卡数据区 ──
    curMonth: ui.nowMonth(),
    refProfit: '0.00',
    hasProfit: false,
    // 🔴 三态标志：**未确定 ≠ 无数据**。为 false 时既不显示数字、也不显示「还没有本月数据」，
    //    否则老用户每次进首页都会先闪一帧空态文案再跳成数字（观感像抖屏）。
    profitKnown: false,
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
   * R207：头卡的「本月经营参考利润」。
   * 口径：取 getLedger 的 result.operation_ref_profit_fen —— 与月度结果页 netRef **同一字段**，
   *       不在这里另算一遍（另算必漂）。
   * 🔴 静默降级：本请求只服务于一块**装饰性总结**，失败/未建档一律转空态，
   *    **不弹 toast、不阻塞主流程** —— 首页已经有一个 getShopContext 的失败提示，再加一个就是噪音。
   */
  async loadRefProfit() {
    try {
      const d = await api.call('getLedger', { month: ui.nowMonth() });
      const fen = d && d.result && d.result.operation_ref_profit_fen;
      if (typeof fen === 'number' && Number.isFinite(fen)) {
        // 有建档月（含利润恰为 0 的极端情况：这里 fen===0 仍算「有数据」，因为那是一个**真实算出来的 0**，
        // 与「没录过」是两回事 ⇒ 显示 0.00 是诚实的，不显示才是虚报）
        this.setData({ refProfit: api.fenToYuan(fen, 2), hasProfit: true, profitKnown: true });
      } else {
        this.setData({ hasProfit: false, profitKnown: true });
      }
    } catch (e) {
      this.setData({ hasProfit: false, profitKnown: true });
    }
  },

  goMonth() { wx.navigateTo({ url: '/pages/month/index' }); },
  goSandbox() { wx.navigateTo({ url: '/pages/sandbox/index' }); },
  // R191：M3 入口改指向**枢纽页**（pages/m3/hub），不再直接落进成本卡列表页。
  //   原因：原料库 / 外卖 / 对账 此前只能寄生在列表页顶部当按钮 ⇒ 分类说不明白。
  //   枢纽页只做「去哪」，列表页只做「找东西 + 新增」。
  // 🔴 R199：`pages/m3/hub` 已改为**底部 tabBar 页** ⇒ `wx.navigateTo` 到 tabBar 页会**失败**
  //   （微信限制：tabBar 页只能 `switchTab`，且不能带参数）。故改用 `wx.switchTab`。
  //   同理 `goMine()`（`pages/mine/index` 也在 tabBar 里）。
  goCard() { wx.switchTab({ url: '/pages/m3/hub' }); },
  goSettings() { wx.navigateTo({ url: '/pages/shop/setting' }); },
  goSwitch() { wx.navigateTo({ url: '/pages/shop/switch' }); },
  goMine() { wx.switchTab({ url: '/pages/mine/index' }); },

  // R193：全局开了 enablePullDownRefresh，但本页**没实现** ⇒ 下拉转圈、松手没反应（假刷新）。
  onPullDownRefresh() {
    Promise.all([this.bootstrap(), this.loadRefProfit()]).then(() => wx.stopPullDownRefresh());
  },
});
