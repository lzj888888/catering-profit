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
// R260：菜名映射「建议卡」纯函数（**只预选、不落库**，规范 v1.9 §0 D32）
const { suggestCardIndex, BATCH_CHUNK } = require('../../../utils/dishMapSuggest.js');

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
      // R259：外卖毛利率的**口径说明** —— 李老师 2026-10-10 裁定指标名保持「毛利率」，
      //   所以防误导不靠改名，靠**同屏把差在哪讲清**（外卖侧金额是平台侧金额、非商家到手）。
      reviewTakeawayMarginNote: TERMS.card.reviewTakeawayMarginNote,
      reviewMargin: TERMS.card.reviewMargin,
      reviewThreshold: TERMS.card.reviewThreshold,
      reviewThresholdHint: TERMS.card.reviewThresholdHint,
      reviewUnmatched: TERMS.card.reviewUnmatched,
      reviewUnmatchedHint: TERMS.card.reviewUnmatchedHint,
      reviewGoMap: TERMS.card.reviewGoMap,
      reviewGoCard: TERMS.card.reviewGoCard,
      // R255：菜名映射写侧（关联到成本卡 / 解除）
      reviewMapPick: TERMS.card.reviewMapPick,
      reviewMapTitle: TERMS.card.reviewMapTitle,
      reviewMapHint: TERMS.card.reviewMapHint,
      reviewMapEmpty: TERMS.card.reviewMapEmpty,
      reviewMapLinked: TERMS.card.reviewMapLinked,
      reviewMapUnlink: TERMS.card.reviewMapUnlink,
      reviewMapNoCard: TERMS.card.reviewMapNoCard,
      reviewMapShortCard: TERMS.card.reviewMapShortCard,
      // R260 批量关联（第三处登记）
      reviewBatchEnter: TERMS.card.reviewBatchEnter,
      reviewBatchExit: TERMS.card.reviewBatchExit,
      reviewBatchHint: TERMS.card.reviewBatchHint,
      reviewBatchSuggest: TERMS.card.reviewBatchSuggest,
      reviewBatchSave: TERMS.card.reviewBatchSave,
      reviewBatchNone: TERMS.card.reviewBatchNone,
      reviewBatchSaving: TERMS.card.reviewBatchSaving,
      reviewBatchDone: TERMS.card.reviewBatchDone,
      reviewEmpty: TERMS.card.reviewEmpty,
      // R252：已导入账单「查看 + 清除」
      reviewBillsTitle: TERMS.card.reviewBillsTitle,
      reviewBillsHint: TERMS.card.reviewBillsHint,
      reviewBillsEmpty: TERMS.card.reviewBillsEmpty,
      reviewBillsBill: TERMS.card.reviewBillsBill,
      reviewBillsDish: TERMS.card.reviewBillsDish,
      reviewBillsUnit: TERMS.card.reviewBillsUnit,
      reviewBillsRows: TERMS.card.reviewBillsRows,
      reviewBillsQty: TERMS.card.reviewBillsQty,
      reviewBillsCleared: TERMS.card.reviewBillsCleared,
      reviewBillsClear: TERMS.card.reviewBillsClear,
      reviewBillsClearAll: TERMS.card.reviewBillsClearAll,
      reviewBillsClearedNone: TERMS.card.reviewBillsClearedNone,
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
    // R252：已导入账单列表（getSalesBills 读侧；与复盘榜同源集合，但**独立读取**）
    bills: [],
    billsSummary: null,
    clearing: false,
    // ===== R255：菜名映射写侧 =====
    cardOptions: [],      // picker 的 range（成本卡名）
    cardCodes: [],        // 与 cardOptions 同序的 card_code（picker 只给索引 ⇒ 必须自己对齐）
    // R262：「卡不够挂」引导（未匹配数 − 卡数；>0 才显示，见 load() 内 shortCardText）
    shortCardGap: 0,
    shortCardText: '',
    mappings: [],         // 已关联菜品（来自 getDishReview 出参 mapping）+ 展示字段
    // ===== R260 批量关联（规范 v1.9）=====
    batchMode: false,     // 批量模式：行的选择只记在本机，点「保存全部关联」才提交
    batchCount: 0,        // 已选行数（按钮上的计数）
    batchSaving: false,   // 提交中（防连点）
    mappingBusy: false,   // 写操作进行中（防连点重复提交）
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
    // 🔴 R255：成本卡列表（「关联」picker 用）。**必须在这里先拉** —— 下面构造
    //   unmatched（显示已关联卡名）与 mappings（显示卡名）都要用它做 code→name。
    const { cardOptions, cardCodes, nameByCode } = await this.loadCards();

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
      // 🔴 R255：必须保留**原始 dish_key** —— 写侧映射的键就是它（`platform + '|' + dish_key`）。
      //   unmatched 行里 name 与 dish_key 目前同源（service.js 两字段都写 dishKey），
      //   但显式带 dish_key 才不依赖这个巧合：哪天后端给 name 换成人读名，这里不至于失配。
      const cur = unmatchedMap.get(nm) || { name: nm, dishKey: x.dish_key || nm, qty: 0, amountFen: 0, platforms: new Set() };
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
    // 🔴 R255：dish_key → card_code（来自 getDishReview 出参 mapping）
    //   用途①：未匹配行显示「已关联：X」（映射写了但读侧没生效 ⇒ 卡被删了或 platform 不匹配，
    //           此时用户看到的仍是未匹配，最容易困惑）；
    const mapByDishKey = new Map();
    for (const m of (d.mapping || [])) {
      if (!m || !m.dish_key || !m.card_code) continue;
      mapByDishKey.set(m.dish_key, m.card_code);
    }
    // 🔴 R261：**按营收降序** —— 真实数据下未匹配清单有 51 行（外卖商品表）/ 270 行（堂食菜品表），
    //   而后端返回的是"首见顺序"。按首见顺序排，用户得逐行读才知道**哪道菜影响最大**；
    //   降序后大头永远在最上面，批量关联（R260）也就能先处理真正值得处理的那批。
    //   ⚠️ 排序必须在 `.map()` **之前**：map 之后的行里只有 `amountText`（字符串），
    //      拿它做减法排序会得到 NaN ⇒ 顺序不动（**静默失效**，页面看着正常）。
    //   ⚠️ 同额时按份数、再按菜名兜底 ⇒ **顺序稳定**（否则两次 load 顺序抖动，用户以为数据变了）。
    const unmatchedSorted = Array.from(unmatchedMap.values()).sort((a, b) =>
      (b.amountFen - a.amountFen) || (b.qty - a.qty) || String(a.name).localeCompare(String(b.name)));
    const unmatched = unmatchedSorted.map((x) => ({
      name: x.name,
      dishKey: x.dishKey,
      mappedCardName: nameByCode[mapByDishKey.get(x.dishKey) || ''] || '',
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

    // ===== R255：「已关联菜品」列表（**解除入口**）=====
    //   为什么必须有这一块：**关联成功后该菜会从 unmatched 变 ranked** ⇒ 未匹配清单里没有它了。
    //   若不给独立的解除入口，用户既改不了也删不掉 ⇒ 挂错一次卡就是死结（A1 锚点的反面）。
    //   `platform` 为空 = 跨所有平台生效 ⇒ 不显示平台名（不为此新增文案）。
    const mappings = (d.mapping || []).map((m) => ({
      dishKey: m.dish_key,
      platformText: m.platform ? (PLAT_NAMES[m.platform] || m.platform) : '',
      cardCode: m.card_code,
      cardName: nameByCode[m.card_code] || m.card_code,
    }));

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

    // ===== R262：「卡不够挂」显式引导 =====
    //   真机实证：3 张卡 vs 51 道外卖菜 ⇒ 每行 picker 只有这 3 张可选；界面既不显示"没卡"
    //   （cardOptions 非空）也不提示"卡不够" ⇒ 用户只能盲目关联，而**挂错卡 = 成本算错**（比不算更坏）。
    //   ⇒ 未匹配数 > 卡数时明说还差几道菜，并给出去建卡的入口。
    const shortCardGap = unmatched.length - (cardOptions || []).length;
    const shortCardText = shortCardGap > 0
      ? String(TERMS.card.reviewMapShortCard).replace('{n}', String(shortCardGap))
      : '';

    this.setData({
      loading: false,
      locked: false,
      dineIn,
      takeaway,
      unmatched,
      totals,
      shortCardGap,
      shortCardText,
      // R255：卡列表 + 已关联列表（picker 与解除入口的数据源）
      cardOptions,
      cardCodes,
      mappings,
      empty: dineIn.length === 0 && unmatched.length === 0 && !takeaway,
      // R260：批量模式开着时，刷新后重新算建议（已挂上的菜会消失，剩下的重算）
      batchCount: this.data.batchMode ? this.countBatchSel(unmatched) : 0,
    });
    this.markRows();
    // R252：账单列表**单独一次调用**（读侧独立函数；失败不影响复盘主区渲染）
    await this.loadBills();
  },

  // ===== R255：成本卡列表（供「关联」picker 用）=====
  //   复用既有 `getCostCard({})`（出参 list[] = 该店各卡的最新版本），**不新增读接口**。
  //   🔴 失败不阻断：卡列表拉不到 ⇒ 只影响「关联」入口（数组置空 ⇒ picker 不渲染），
  //      复盘主区照常渲染 —— 附加载荷不该拖垮主功能（与 loadBills 同一条纪律）。
  async loadCards() {
    try {
      const res = await api.call('getCostCard', {});
      const list = (res && res.list) || [];
      const byCode = new Map();
      for (const c of list) {
        const cc = c.card_code;
        if (!cc) continue;
        const cur = byCode.get(cc);
        if (!cur || (Number(c.version) || 0) > (Number(cur.version) || 0)) byCode.set(cc, c);
      }
      const codes = Array.from(byCode.keys());
      const nameByCode = {};
      const cardOptions = codes.map((cc) => {
        const nm = byCode.get(cc).name || cc;
        nameByCode[cc] = nm;
        return nm;
      });
      return { cardCodes: codes, cardOptions, nameByCode };
    } catch (e) {
      return { cardCodes: [], cardOptions: [], nameByCode: {} };
    }
  },

  // ===== R255：把未匹配菜名**关联**到成本卡 =====
  //   🔴 键口径（与读侧 lookupCardCode 对齐，错位 = 挂了也读不到、静默失效）：
  //     · `dish_key` = **原始菜名**（不归一 —— 读侧按原样查）；
  //     · `platform` **不传**（空 ⇒ 跨所有平台生效，读侧有 mapIndex.get('|' + k) 兜底）。
  async onPickCard(e) {
    if (this.data.mappingBusy) return;
    const pick = Number(e.detail.value);
    const rowIdx = Number(e.currentTarget.dataset.idx);
    const row = this.data.unmatched[rowIdx];
    const cardCode = this.data.cardCodes[pick];
    if (!row || !cardCode) return;
    this.setData({ mappingBusy: true });
    try {
      await api.call('saveDishMapping', { dish_key: row.dishKey, card_code: cardCode });
      wx.showToast({ title: TERMS.card.reviewMapOk, icon: 'none' });
      await this.load();   // 重算：该菜应从 unmatched 变 ranked
    } catch (err) {
      api.toastError(err);
    } finally {
      this.setData({ mappingBusy: false });
    }
  },

  // ===================== R260：批量关联（规范 v1.9）=====================
  // 现状痛点（实测）：R255 的入口是「一道菜一次 picker + 选完 `await this.load()` 重算整页」
  //   ⇒ 51 道外卖菜 = 51 次全页往返。批量把往返压成 ⌈N/BATCH_CHUNK⌉ 次。
  // 🔴 三条不可动摇（规范 v1.9 D29/D30/D32）：
  //   ① 行的选择**只记在本机**（选择路径内**不得**调 saveDishMapping）；
  //   ② 建议**只预选**，绝不自动提交（归一化匹配必然会误判，如"来点辣椒?吗"这类口味询问 SKU）；
  //   ③ 提交载荷只来自**用户确认后的选择集**（selCode），不回读建议函数的返回值。

  // 给未匹配行算「建议卡」（只预选；`how` 用于在界面上标「建议」二字）
  applyBatchSuggestions(rows) {
    const names = this.data.cardOptions || [];
    const codes = this.data.cardCodes || [];
    return (rows || []).map((x) => {
      const s = suggestCardIndex(x.name, names);
      const sel = s.index >= 0 && codes[s.index] ? codes[s.index] : '';
      return Object.assign({}, x, {
        pickIdx: s.index >= 0 ? s.index : 0,
        selCode: sel,
        selLabel: sel ? names[s.index] : '',
        suggestHow: sel ? s.how : '',
      });
    });
  },

  countBatchSel(rows) {
    return (rows || []).filter((x) => x.selCode).length;
  },

  onToggleBatch() {
    if (this.data.batchSaving) return;
    if (this.data.batchMode) { this.setData({ batchMode: false, batchCount: 0 }); return; }
    if (!this.data.cardOptions.length) { wx.showToast({ title: TERMS.card.reviewMapNoCard, icon: 'none' }); return; }
    const rows = this.applyBatchSuggestions(this.data.unmatched);
    this.setData({ batchMode: true, unmatched: rows, batchCount: this.countBatchSel(rows) });
  },

  // 行内选择：**只改本地**（不调云函数、不重载整页）
  onPickLocal(e) {
    if (this.data.batchSaving) return;
    const idx = Number(e.currentTarget.dataset.idx);
    const pick = Number(e.detail.value);
    const code = (this.data.cardCodes || [])[pick];
    if (!code) return;
    const rows = this.data.unmatched.slice();
    if (!rows[idx]) return;
    rows[idx] = Object.assign({}, rows[idx], {
      pickIdx: pick, selCode: code, selLabel: this.data.cardOptions[pick],
      // 用户改过 ⇒ 不再是"建议"（界面上的「建议」标记随之消失，避免误导"这是系统推荐的"）
      suggestHow: '',
    });
    this.setData({ unmatched: rows, batchCount: this.countBatchSel(rows) });
  },

  // 行内清掉本地选择（保留本行在未匹配清单里，稍后再选）
  onClearLocal(e) {
    if (this.data.batchSaving) return;
    const idx = Number(e.currentTarget.dataset.idx);
    const rows = this.data.unmatched.slice();
    if (!rows[idx]) return;
    rows[idx] = Object.assign({}, rows[idx], { selCode: '', selLabel: '', suggestHow: '' });
    this.setData({ unmatched: rows, batchCount: this.countBatchSel(rows) });
  },

  // 一次提交（分块 ≤ BATCH_CHUNK；上限的硬约束在云端 MAX_BATCH，守卫钉住两者关系）
  async onSaveBatch() {
    if (this.data.batchSaving) return;
    const items = this.data.unmatched
      .filter((x) => x.selCode)
      .map((x) => ({ dish_key: x.dishKey, card_code: x.selCode }));
    if (!items.length) { wx.showToast({ title: TERMS.card.reviewBatchNone, icon: 'none' }); return; }
    this.setData({ batchSaving: true });
    wx.showLoading({ title: TERMS.card.reviewBatchSaving });
    let done = 0;
    try {
      for (let i = 0; i < items.length; i += BATCH_CHUNK) {
        const chunk = items.slice(i, i + BATCH_CHUNK);
        await api.call('saveDishMapping', {
          items: chunk,
          client_request_id: 'dm_' + Date.now() + '_' + i,
        });
        done += chunk.length;
        wx.showLoading({ title: TERMS.card.reviewBatchSaving + ' ' + done + '/' + items.length });
      }
      wx.hideLoading();
      wx.showToast({ title: TERMS.card.reviewBatchDone + ' ' + done, icon: 'success' });
      // 重算：已挂上的菜从候选里消失、剩下的重新给建议（batchMode 保持开启，便于继续）
      await this.load();
    } catch (err) {
      wx.hideLoading();
      api.toastError(err);
    } finally {
      this.setData({ batchSaving: false });
    }
  },

  // ===== R255：**解除**已关联（card_code 传空串即解除）=====
  async onUnlinkMap(e) {
    if (this.data.mappingBusy) return;
    const rowIdx = Number(e.currentTarget.dataset.idx);
    const m = this.data.mappings[rowIdx];
    if (!m) return;
    this.setData({ mappingBusy: true });
    try {
      await api.call('saveDishMapping', { dish_key: m.dishKey, card_code: '' });
      wx.showToast({ title: TERMS.card.reviewMapUnlinkOk, icon: 'none' });
      await this.load();
    } catch (err) {
      api.toastError(err);
    } finally {
      this.setData({ mappingBusy: false });
    }
  },

  // ===== R252：已导入账单（查看 + 清除）=====
  //   为什么单独一次调用：`getSalesBills` 与 `getDishReview` 是两个读侧函数
  //   （一个列"导过什么"、一个算"毛利多少"）。分开 ⇒ 账单区失败不拖垮复盘主区。
  async loadBills() {
    try {
      const res = await api.call('getSalesBills', {});
      const names = TERMS.card.reviewPlatformNames;
      const bills = (res.list || []).map((x) => ({
        bill_id: x.bill_id,
        kind: x.kind,
        kindText: x.kind === 'bill' ? TERMS.card.reviewBillsBill : TERMS.card.reviewBillsDish,
        platform: x.platform,
        platformText: names[x.platform] || x.platform,
        bizDate: x.biz_date,
        rowCount: x.row_count,
        qtyText: String(x.qty),
        amountText: fmtYuan(x.amount_fen),
        cleared: !!x.cleared,
      }));
      this.setData({ bills, billsSummary: res.summary || null });
    } catch (e) {
      // 账单区是"附加信息"：失败就留空，不 toast（复盘主区已渲染，不该被它打断）
      this.setData({ bills: [], billsSummary: null });
    }
  },

  // 清除单条（二次确认 → clearSalesBills({targets}) → 刷新账单区 + 复盘主区）
  onClearBill(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const b = this.data.bills[idx];
    if (!b) return;
    wx.showModal({
      title: TERMS.card.reviewBillsClear,
      content: TERMS.card.reviewBillsClearConfirm,
      confirmColor: '#e74c3c',
      success: (r) => {
        if (!r.confirm) return;
        this.doClear([{ platform: b.platform, biz_date: b.bizDate, kind: b.kind }], false);
      },
    });
  },

  // 全部清除（二次确认 → clearSalesBills({all,confirm_all}) ）
  onClearAllBills() {
    if (!this.data.bills.length) {
      wx.showToast({ title: TERMS.card.reviewBillsClearedNone, icon: 'none' });
      return;
    }
    wx.showModal({
      title: TERMS.card.reviewBillsClearAll,
      content: TERMS.card.reviewBillsClearAllConfirm,
      confirmColor: '#e74c3c',
      success: (r) => {
        if (!r.confirm) return;
        this.doClear([], true);
      },
    });
  },

  async doClear(targets, all) {
    if (this.data.clearing) return;         // 防连点（同一动作并发 = 幂等键之外的第二道闸）
    this.setData({ clearing: true });
    try {
      const req = { shop_id: (getApp().globalData && getApp().globalData.shop_id) || '' };
      if (all) { req.all = true; req.confirm_all = true; } else { req.targets = targets; }
      await api.call('clearSalesBills', req);
      wx.showToast({ title: TERMS.card.reviewBillsClearedToast, icon: 'success' });
      // 清除后**两个区都要刷**：账单区（行消失/标已清除）+ 复盘主区（数字自然不含被清的行）
      await this.loadBills();
      await this.load();
    } catch (e) {
      api.toastError(e);
    } finally {
      this.setData({ clearing: false });
    }
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
