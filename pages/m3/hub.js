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
const dh = require('../../utils/dataHealth.js');   // 🔴 R299：出参 `truncated` 的可见降级（单源）

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
      grouponTitle: TERMS.hub.grouponTitle,
      grouponSub: TERMS.hub.grouponSub,
      reconTitle: TERMS.hub.reconTitle,
      reconSub: TERMS.hub.reconSub,
      reviewTitle: TERMS.hub.reviewTitle,
      reviewSub: TERMS.hub.reviewSub,
      countPrefix: TERMS.card.countPrefix,
      countSuffix: TERMS.card.countSuffix,
      // R299：数据截断的可见降级文案（单源 TERMS.ui.dataTruncated）
      dataTruncated: TERMS.ui.dataTruncated,
      // R263：三步走 / 分层 / 空状态（wxml 用到就必须登记 —— 漏登记 ⇒ 页面静默空白）
      flowTitle: TERMS.hub.flowTitle,
      flowSteps: TERMS.hub.flowSteps,
      secStart: TERMS.hub.secStart,
      secAfter: TERMS.hub.secAfter,
      emptyTitle: TERMS.hub.emptyTitle,
      emptyDesc: TERMS.hub.emptyDesc,
      emptyBtn: TERMS.hub.emptyBtn,
      emptyTplHint: TERMS.hub.emptyTplHint,
      // R192：图标块单字（wxml 用到就必须登记 —— 漏登记 ⇒ 页面静默空白，本仓 R189 P2-1 同族）
      icoCard: TERMS.hub.icoCard,
      icoMaterial: TERMS.hub.icoMaterial,
      icoTakeaway: TERMS.hub.icoTakeaway,
      icoGroupon: TERMS.hub.icoGroupon,
      icoRecon: TERMS.hub.icoRecon,
      icoReview: TERMS.hub.icoReview,
      // 🔴 P0#6：快捷操作 + 付费小字（wxml 用到就必须登记 —— 漏登记 ⇒ 静默空白）
      quickAdd: TERMS.hub.quickAdd,
      payTag: TERMS.hub.payTag,
      // 🔴 R281 O3：三步走线性化新增键（wxml 用到就必须登记 —— 漏登记 ⇒ 静默空白）
      flowBtns: TERMS.hub.flowBtns,
      flowAllDone: TERMS.hub.flowAllDone,
      flowNextHint: TERMS.hub.flowNextHint,
    },
    // -1 = 没取到（就不显示这行）。🔴 **绝不能默认 0**：读不到时显示「共 0 张」
    //   会让老板以为卡丢了 —— 与本仓「不替用户编数」同一条纪律（M2 参考值只提示不预填）。
    cardCount: -1,
    // 🔴 R299（豆包评审采纳 · 修正我自己的初判）：本页把 `card.list.length` 当**精确张数**显示
    //   （`hub.wxml:47` 「共 N 张」）。若 `getCostCard` 命中 `LIST_TOTAL_CAP`（20000 行）被截断，
    //   这个数就是**偏小的精确数** —— 属豆包给的判断标准里的「**精确计数**」一类
    //   ⇒ 必须可见降级（我原先把它列入 EXEMPT 是**判错了**：它不只是"取 length 做入口判断"，
    //   它把那个 length **渲染给用户看了**）。见 utils/dataHealth.js 头注。
    truncated: false,
    // 🔴 R281 O3：三步完成态（初值全 false = 未完成；fail-closed：读失败也保持 false）。
    //   nextStep = 第一个未完成的步序号；全部完成 = -1（此时显示「三步都做完了」而不是按钮）。
    stepFlags: [false, false, false],
    nextStep: 0,
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
    // 三个接口**都不加付费墙**（getMaterial / getCostCard / getSalesBills 属基础读能力）；
    // 且一次并发取回，不额外增加往返（原来只取卡数，现在顺带喂三步完成态）。
    // 🔴 fail-closed：任一接口失败 ⇒ 该项为 null ⇒ 对应步**保持未完成**（false / -1），
    //    绝不把"没读到"当成"已完成"或"共 0"（同一条纪律：不替用户编数）。
    const [mat, card, sales] = await Promise.all([
      api.call('getMaterial', {}).catch(() => null),
      api.call('getCostCard', {}).catch(() => null),
      api.call('getSalesBills', {}).catch(() => null),
    ]);
    const cardN = (card && Array.isArray(card.list)) ? card.list.length : -1;
    const flags = [
      !!(mat && Array.isArray(mat.list) && mat.list.length > 0),
      cardN > 0,
      !!(sales && Array.isArray(sales.list) && sales.list.length > 0),
    ];
    // 🔴 R299：三次读取任一被服务端标记 `truncated` ⇒ 上方「共 N 张」是偏小的精确数 ⇒ 可见降级。
    this.setData({
      cardCount: cardN,
      stepFlags: flags,
      nextStep: flags.indexOf(false),
      truncated: dh.isTruncated(card) || dh.isTruncated(sales),
    });
  },

  // 🔴 R281 O3：从引导块直接跳到「当前该做的那一步」，不用老板自己在 5 张卡里猜。
  goStep(e) {
    const i = Number((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.step) || 0);
    if (i === 0) return wx.navigateTo({ url: '/subpkg/biz/material/index' });
    if (i === 1) return wx.navigateTo({ url: '/subpkg/biz/card/index' });
    // 第③步落在「外卖」页的第二个 tab（销量导入入口，R259 起该 tab 主载形态 A/B/C 销量）
    return wx.navigateTo({ url: '/subpkg/biz/takeaway/index?tab=import' });
  },

  // ===== 四个分区（跳转目标均已在 app.json::pages 注册）=====
  goCard() { wx.navigateTo({ url: '/subpkg/biz/card/index' }); },
  goMaterial() { wx.navigateTo({ url: '/subpkg/biz/material/index' }); },
  goTakeaway() { wx.navigateTo({ url: '/subpkg/biz/takeaway/index' }); },
  goGroupon() { wx.navigateTo({ url: '/subpkg/biz/groupon/index' }); },
  goRecon() { wx.navigateTo({ url: '/subpkg/tools/recon/index' }); },
  goReview() { wx.navigateTo({ url: '/pages/m3/dishreview/index' }); },

  // R193：全局开了下拉刷新但本页未实现 ⇒ 下拉转圈、松手没反应（假刷新）。
  onPullDownRefresh() { this.loadCount().then(() => wx.stopPullDownRefresh()); },
});
