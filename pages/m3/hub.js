// pages/m3/hub.js —— R191：M3 模块枢纽页（「菜品成本」的家）
//
// 为什么要单独建这一页（根因，不是拍脑袋美化）：
//   此前首页点「M3」是**直接进成本卡列表页**，于是原料库 / 外卖 / 对账这三块**别的模块**
//   只能寄生在列表页顶部当按钮。而顶部那两行里，上一行是「找东西」（筛选）、下一行是
//   「去别处」（跳转），还共用同一个 `.tool-btn` 灰块 ⇒ 分类说不明白（李老师 2026-10-02 反馈）。
//   ⇒ 解耦：本页只管「去哪」，列表页只管「找东西 + 新增」。
//
// ⚠️ 本页**零写库、零计算、零新增云函数/集合**：只做导航 + 一个只读数量。
// ⚠️ 以后新增 M3 能力（套餐分析 / 外卖分析…）＝ 加一张分区卡，列表页顶部不再膨胀。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const shopGuard = require('../../utils/shopGuard.js');

Page({
  data: {
    t: {
      title: TERMS.hub.title,
      subtitle: TERMS.hub.subtitle,
      cardTitle: TERMS.hub.cardTitle,
      cardSub: TERMS.hub.cardSub,
      materialTitle: TERMS.hub.materialTitle,
      materialSub: TERMS.hub.materialSub,
      takeawayTitle: TERMS.hub.takeawayTitle,
      takeawaySub: TERMS.hub.takeawaySub,
      reconTitle: TERMS.hub.reconTitle,
      reconSub: TERMS.hub.reconSub,
      countPrefix: TERMS.card.countPrefix,
      countSuffix: TERMS.card.countSuffix,
      // R192：图标块单字（wxml 用到就必须登记 —— 漏登记 ⇒ 页面静默空白，本仓 R189 P2-1 同族）
      icoCard: TERMS.hub.icoCard,
      icoMaterial: TERMS.hub.icoMaterial,
      icoTakeaway: TERMS.hub.icoTakeaway,
      icoRecon: TERMS.hub.icoRecon,
    },
    // -1 = 没取到（就不显示这行）。🔴 **绝不能默认 0**：读不到时显示「共 0 张」
    //   会让老板以为卡丢了 —— 与本仓「不替用户编数」同一条纪律（M2 参考值只提示不预填）。
    cardCount: -1,
  },

  onShow() {
    ui.setTitle(TERMS.hub.title);
    this.boot();
  },

  // 🔴 R215：本页是 tabBar 页 ⇒ **冷启动直达**时 app.globalData 尚空，必须先确保店铺上下文，
  //   否则 loadCount 的 getCostCard 会带空 shop_id 发请求（表现为「卡片数不显示」，且静默）。
  //   上下文失败不阻塞本页导航（四个分区入口与上下文无关）。
  async boot() {
    try { await shopGuard.ensureShop(); } catch (e) { /* 静默：导航功能不受影响 */ }
    this.loadCount();
  },

  // 只读展示「你已有多少张卡」，给第一张分区卡一个锚点。
  // fail-closed：失败保持 -1（不显示），数量只是锦上添花，不打扰用户。
  async loadCount() {
    try {
      const d = await api.call('getCostCard', {});
      const n = (d && Array.isArray(d.list)) ? d.list.length : -1;
      this.setData({ cardCount: n });
    } catch (e) { /* 静默：本页导航功能不受影响 */ }
  },

  // ===== 四个分区（跳转目标均已在 app.json::pages 注册）=====
  goCard() { wx.navigateTo({ url: '/pages/card/index' }); },
  goMaterial() { wx.navigateTo({ url: '/pages/material/index' }); },
  goTakeaway() { wx.navigateTo({ url: '/pages/takeaway/index' }); },
  goRecon() { wx.navigateTo({ url: '/pages/recon/index' }); },

  // R193：全局开了下拉刷新但本页未实现 ⇒ 下拉转圈、松手没反应（假刷新）。
  onPullDownRefresh() { this.loadCount().then(() => wx.stopPullDownRefresh()); },
});
