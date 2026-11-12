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
const { PAYWALL_ENABLED } = require('../../utils/featureFlags.js');

Page({
  data: {
    t: {
      title: TERMS.hub.title,
      subtitle: TERMS.hub.subtitle,
      cardTitle: TERMS.hub.cardTitle,
      cardSub: TERMS.hub.cardSub,
      materialTitle: TERMS.hub.materialTitle,
      materialSub: TERMS.hub.materialSub,
      // 🔴 R707：「销量表导入」卡已从本页移除（导入是动作、不是目的地）⇒
      //   importTitle / importSub / icoImport 三项**不再登记**，terms 里的同名键也已删。
      //   导入入口挪到「外卖每单赚多少」（页内 tab2）与「菜品赚多赚少排行榜」（首屏按钮）。
      revenueTitle: TERMS.hub.revenueTitle,
      revenueSub: TERMS.hub.revenueSub,
      icoRevenue: TERMS.hub.icoRevenue,
      takeawayTitle: TERMS.hub.takeawayTitle,
      takeawaySub: TERMS.hub.takeawaySub,
      grouponTitle: TERMS.hub.grouponTitle,
      grouponSub: TERMS.hub.grouponSub,
      reconTitle: TERMS.hub.reconTitle,
      reconSub: TERMS.hub.reconSub,
      reviewTitle: TERMS.hub.reviewTitle,
      reviewSub: TERMS.hub.reviewSub,
      // 🔴 R704：两列宫格的短描述（wxml 用到就必须登记 —— 漏登记 ⇒ 静默空白）
      cardShort: TERMS.hub.cardShort,
      materialShort: TERMS.hub.materialShort,
      takeawayShort: TERMS.hub.takeawayShort,
      grouponShort: TERMS.hub.grouponShort,
      reviewShort: TERMS.hub.reviewShort,
      revenueShort: TERMS.hub.revenueShort,
      reconShort: TERMS.hub.reconShort,
      countPrefix: TERMS.card.countPrefix,
      countSuffix: TERMS.card.countSuffix,
      // R299：数据截断的可见降级文案（单源 TERMS.ui.dataTruncated）
      dataTruncated: TERMS.ui.dataTruncated,
      // R706：三步走独立块已删（折叠成卡片名称前的序号徽章）⇒ flowTItle/flowSteps 不再登记。
      //   保留分区标题两键（它们现在承担"序号是什么意思"的唯一解释）。
      secStart: TERMS.hub.secStart,
      secAfter: TERMS.hub.secAfter,
      // 🔴 R717：分区标题下的「数从哪来」小字（wxml 用到就必须登记 —— 漏登记 ⇒ 静默空白，本仓 R189 P2-1 同族）
      secStartNote: TERMS.hub.secStartNote,
      secAfterNote: TERMS.hub.secAfterNote,
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
      // 🔴 P0#6：付费小字（wxml 用到就必须登记 —— 漏登记 ⇒ 静默空白）
      //   R706：quickAdd 已删 —— 「＋新建菜品成本卡」与「菜品成本毛利」卡完全重复。
      //   🔴 R724h（2026-11-13 模拟器实测，台账 R3-5）：
      //   这里此前是**无条件硬编码** `TERMS.hub.payTag`（「需开通」）。但当前
      //   前端 `PAYWALL_ENABLED=false`、云端 `FREE_ACCESS=true`（提审期全开）⇒
      //   外卖/团购/复盘/对账 四张卡片**点进去就能用**，标签却写「需开通」
      //   ⇒ 老板以为要付钱、不敢点 —— 正是李老师说的「人点都不敢点进去」。
      //   ⇒ 改为随付费墙开关：只有真正开启付费墙时才显示这个标签。
      //   判据由 `tools/check_hub_paytag.js` 守（标签真值 ≡ PAYWALL_ENABLED）。
      payTag: PAYWALL_ENABLED ? TERMS.hub.payTag : '',
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
    // 🔴 R281 O3：步骤完成态（初值全 false = 未完成；fail-closed：读失败也保持 false）。
    //   R707：从 3 项降到 2 项 —— 第③步「销量表导入」那张卡已从本页移除。
    //   原 nextStep（第一个未完成步序号）没有任何消费者（wxml 与守卫都不读）⇒ 一并删除。
    stepFlags: [false, false],
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
    // 两个接口**都不加付费墙**（getMaterial / getCostCard 属基础读能力）；
    // 且一次并发取回，不额外增加往返。
    // 🔴 R707：原先还并发一个 getSalesBills（只为第③步「销量表导入」的完成态）——
    //   该卡已从本页移除 ⇒ 这一次往返**直接省掉**，M3 每次进页面少打一个云函数。
    // 🔴 fail-closed：任一接口失败 ⇒ 该项为 null ⇒ 对应步**保持未完成**（false / -1），
    //    绝不把"没读到"当成"已完成"或"共 0"（同一条纪律：不替用户编数）。
    const [mat, card] = await Promise.all([
      api.call('getMaterial', {}).catch(() => null),
      api.call('getCostCard', {}).catch(() => null),
    ]);
    const cardN = (card && Array.isArray(card.list)) ? card.list.length : -1;
    const flags = [
      !!(mat && Array.isArray(mat.list) && mat.list.length > 0),
      cardN > 0,
    ];
    // 🔴 R299：三次读取任一被服务端标记 `truncated` ⇒ 上方「共 N 张」是偏小的精确数 ⇒ 可见降级。
    this.setData({
      cardCount: cardN,
      stepFlags: flags,
      truncated: dh.isTruncated(card),
    });
  },

  // 🔴 R706：goStep 已删 —— 引导块的直达按钮被移除，序号徽章所在的卡片本身就是入口
  //   （① = goMaterial / ② = goCard），再留一个中介按钮只会多一条死路径。
  // 🔴 R707：goImport 也已删 —— 第③步那张「销量表导入」卡从本页移除了。

  // ===== 四个分区（跳转目标均已在 app.json::pages 注册）=====
  goCard() { wx.navigateTo({ url: '/subpkg/biz/card/index' }); },
  goMaterial() { wx.navigateTo({ url: '/subpkg/biz/material/index' }); },
  goTakeaway() { wx.navigateTo({ url: '/subpkg/biz/takeaway/index' }); },
  // 🔴 R616：渠道营收 —— 选收款日报 → 出「经营营收 + 现金流入 + 差额桥」。只读，不写库。
  goRevenue() { wx.navigateTo({ url: '/subpkg/biz/revenue/index' }); },
  goGroupon() { wx.navigateTo({ url: '/subpkg/biz/groupon/index' }); },
  goRecon() { wx.navigateTo({ url: '/subpkg/tools/recon/index' }); },
  goReview() { wx.navigateTo({ url: '/pages/m3/dishreview/index' }); },

  // R193：全局开了下拉刷新但本页未实现 ⇒ 下拉转圈、松手没反应（假刷新）。
  onPullDownRefresh() { this.loadCount().then(() => wx.stopPullDownRefresh()); },
});
