// pages/card/index.js —— 批次 4/5 / 批次 P0（M3 v1.2）· M3 成本卡列表
// ⚠️ 批次 5 付费边界：只有「保存超限」「导出」才触发付费弹窗；M2 永不弹。
// ⚠️ M3.22（批次 A1）：免费张数不再硬编码，一律取 checkQuota 出参。
// ⚠️ 批次 P0（任务 2）：补齐搜索/筛选/删除（软删全部版本）/复制（新 card_code）/
//   同步至原料最新价（接 syncCostCard，单张+批量）；加「原料档案」入口。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { openPaywall, openService } = require('../../utils/paywall.js');
const exportFile = require('../../utils/exportFile.js');   // R265：导出投递单源（落盘 + 打开 + 转发兜底）
const { TERMS } = require('../../miniprogram/i18n/terms.js');

// 本店用过的菜品分类（本地字典，与 edit.js 同一 key；不新建集合 —— M3 v1.1 零新建集合红线）
const LIST_CATS_KEY = 'm3_dish_cats';

// 毛利率区间筛选项（v1.0 M3.8：≥60% 绿 / 40%~60% 黄 / <40% 红，未定价灰）
const MARGIN_OPTIONS = [
  { value: 'all', label: TERMS.card.marginAll },
  { value: 'high', label: TERMS.card.marginHigh },
  { value: 'mid', label: TERMS.card.marginMid },
  { value: 'low', label: TERMS.card.marginLow },
];

Page({
  data: {
    t: {
      listTitle: TERMS.card.listTitle,
      addCard: TERMS.buttons.addCostCard,
      totalCost: TERMS.card.totalCost,
      price: TERMS.card.price,
      grossMargin: TERMS.card.grossMargin,
      version: TERMS.card.version,
      viewVersion: TERMS.nav.viewVersion,
      syncPrice: TERMS.nav.syncPrice,
      empty: TERMS.card.empty,
      hintAlways: TERMS.card.hintAlways,
      loading: TERMS.ui.loading,
      cur: '¥',
      calcModeA: TERMS.card.calcModeA,
      calcModeB: TERMS.card.calcModeB,
      export: TERMS.buttons.export,
      exportHint: TERMS.expFile.hint,
      goOrders: TERMS.pay.goOrders,
      exportIng: TERMS.exp.exportIng,
      exportDone: TERMS.exp.exportDone,
      // 批次 P0（任务 2）
      searchPh: TERMS.card.searchPh,
      filterMargin: TERMS.card.filterMargin,
      filterCategory: TERMS.card.filterCategory,
      marginAll: TERMS.card.marginAll,
      marginHigh: TERMS.card.marginHigh,
      marginMid: TERMS.card.marginMid,
      marginLow: TERMS.card.marginLow,
      deleteCard: TERMS.card.deleteCard,
      // R192：「⋯」菜单里的「编辑」（卡片主体点击也是进编辑，但菜单里必须还能找到）
      editCard: TERMS.card.editCard,
      deleteCardConfirm: TERMS.card.deleteCardConfirm,
      copyCard: TERMS.card.copyCard,
      copyCardConfirm: TERMS.card.copyCardConfirm,
      syncCard: TERMS.card.syncCard,
      // R192：卡片按钮上的短文案（全名 8 字并排会挤到换行）
      syncShort: TERMS.card.syncShort,
      batchSync: TERMS.card.batchSync,
      batchSyncConfirm: TERMS.card.batchSyncConfirm,
      syncDone: TERMS.card.syncDone,
      selectSync: TERMS.card.selectSync,
      cancel: TERMS.buttons.cancel,
      filterTags: TERMS.card.filterTags,
      // R191：结果计数（筛选后必须回报「找到了多少」，否则看着像没数据）
      countPrefix: TERMS.card.countPrefix,
      countSuffix: TERMS.card.countSuffix,
      // round156：列表排序/置顶
      pinOn: TERMS.card.pinOn,
      pinOff: TERMS.card.pinOff,
      pinTag: TERMS.card.pinTag,
      // M3.16（批次 C）套餐标记
      cardTypeCombo: TERMS.card.cardTypeCombo,
      comboInsightLoseWarn: TERMS.card.comboInsightLoseWarn,
      // R191：原料库 / 外卖 / 对账 的入口已从本页顶部撤走 —— 改由 pages/m3/hub 枢纽页承接
      //   （「找东西」与「去别处」混在同一行、还共用同一个 .tool-btn 样式 ⇒ 分类说不明白）。
      // ── R234/J4e 行内长提示折叠（本页 1 处）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语）。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    // R234/J4e：行内长提示折叠（本页 1 处，默认收起）。仓内统一实现。
    hintFold: {},
    all: [],           // 全量列表（前端过滤）
    list: [],
    // round156：置顶的 card_code（顺序 = 老板点选先后）。店铺级偏好，存 shop 文档 ⇒ 零新建集合。
    pinned: [],
    keyword: '',
    marginFilter: 'all',
    marginLabel: '',   // 当前选中毛利率区间展示名
    marginOptions: MARGIN_OPTIONS,
    categoryFilter: '',   // S0（任务 3）：分类筛选（''=全部）
    categoryLabel: '',
    categoryOptions: [],  // [{ value, label }]（从数据去重，不写死枚举）
    tagFilter: '',        // S0：标签筛选
    tagLabel: '',
    tagOptions: [],
    selectMode: false, // 批量同步选择模式
    selected: {},      // { card_code: true }
    loading: true,
  },

  // R234/J4e：行内提示折叠开关（仓内统一形态 —— 多页同一实现，不各写一套）。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;                       // 无 key ⇒ 静默返回（不误翻别人的状态）
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.listTitle);
      const d = await api.call('getCostCard', {});
      // round156：置顶（店铺级偏好）—— 读失败**不阻断列表**：它只是排序偏好，不是数据。
      let pinned = [];
      try {
        const sc = await api.call('getShopContext', {});
        pinned = Array.isArray(sc.pinned_cards) ? sc.pinned_cards : [];
      } catch (err) { pinned = []; }
      const all = (d.list || []).map((c) => ({
        card_code: c.card_code,
        version: c.version,
        name: c.name || '',
        category: c.category || '',
        tags: c.tags || '',
        total_cost: api.fenToYuan(c.total_cost_fen, 2),
        price: c.price_fen > 0 ? api.fenToYuan(c.price_fen, 2) : '—',
        price_fen: c.price_fen,
        margin: c.price_fen > 0 ? c.gross_margin_pct : null,
        calc_mode: c.calc_mode,
        // M3.16（批次 C）：卡片类型（1=单品 / 3=套餐）；套餐「我少赚」为负 ⇒ 红字提示。
        card_type: c.card_type,
        combo_lose_neg: !!(c.combo && c.combo.merchantLoseFen < 0),
        // round156：排序键（「最近编辑在前」）。存量卡没有 updated_at ⇒ 0（排最后，不插队到新卡前面）
        updated_at: Number(c.updated_at) || 0,
      }));
      // S0（任务 3）：分类/标签筛选选项 —— 从数据去重（不写死枚举；tag 按逗号分隔后取单项去重）
      const catSeen = new Set();
      const tagSeen = new Set();
      const categoryOptions = [{ value: '', label: TERMS.card.marginAll }];
      for (const c of TERMS.card.dishCats) categoryOptions.push({ value: c, label: c });
      const tagOptions = [{ value: '', label: TERMS.card.marginAll }];
      for (const c of all) {
        if (c.category && !catSeen.has(c.category)) { catSeen.add(c.category); categoryOptions.push({ value: c.category, label: c.category }); }
        for (const t of c.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) {
          if (!tagSeen.has(t)) { tagSeen.add(t); tagOptions.push({ value: t, label: t }); }
        }
      }
      // 本店用过的分类写进本地字典 ⇒ 编辑页 chips 直接可点（新建卡也不用重打"锅底"）
      try { wx.setStorageSync(LIST_CATS_KEY, Array.from(catSeen).slice(0, 40)); } catch (err) { /* 忽略 */ }
      this.setData({ all, categoryOptions, tagOptions, pinned, loading: false });
      this.applyFilter();
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onKeyword(e) { this.setData({ keyword: e.detail.value }); this.applyFilter(); },
  onMarginFilter(e) {
    const opt = this.data.marginOptions[Number(e.detail.value)];
    this.setData({ marginFilter: opt ? opt.value : 'all', marginLabel: opt ? opt.label : '' });
    this.applyFilter();
  },
  onCategoryFilter(e) {
    const opt = this.data.categoryOptions[Number(e.detail.value)];
    this.setData({ categoryFilter: opt ? opt.value : '', categoryLabel: opt ? opt.label : '' });
    this.applyFilter();
  },
  onTagFilter(e) {
    const opt = this.data.tagOptions[Number(e.detail.value)];
    this.setData({ tagFilter: opt ? opt.value : '', tagLabel: opt ? opt.label : '' });
    this.applyFilter();
  },

  // 名称模糊 + 分类 + 标签 + 毛利率区间（「与」关系，统一在此过滤）
  applyFilter() {
    const kw = this.data.keyword.trim().toLowerCase();
    const mf = this.data.marginFilter;
    const cat = this.data.categoryFilter;
    const tag = this.data.tagFilter;
    const list = this.data.all.filter((c) => {
      if (kw && !c.name.toLowerCase().includes(kw)) return false;
      if (cat && c.category !== cat) return false;
      if (tag) {
        const tags = c.tags.split(/[,，]/).map((x) => x.trim());
        if (!tags.includes(tag)) return false;
      }
      if (mf === 'high') return c.margin !== null && c.margin >= 60;
      if (mf === 'mid') return c.margin !== null && c.margin >= 30 && c.margin < 60;
      if (mf === 'low') return c.margin !== null && c.margin < 30;
      return true;
    });
    // round156：过滤完再排序（置顶在前 + 最近编辑在前），并给每条打 `pinned` 标记
    //   ⚠️ 标记必须在这里打：WXML 表达式**不支持方法调用**（写 `pinned.indexOf(...)` 是无效的）。
    const pins = this.data.pinned || [];
    const marked = list.map((c) => Object.assign({}, c, { pinned: pins.indexOf(c.card_code) >= 0 }));
    this.setData({ list: this.sortList(marked) });
  },

  // round156：列表排序 —— ① 置顶的在前（顺序 = 老板点选先后）② 其余「最近编辑在前」。
  //   ⚠️ 为什么在**前端**排、不做服务端 orderBy：本页本就持有**全量**列表做搜索/筛选（`all`），
  //     排序只是把已到手的数据再排一次 —— 不新增查询、不改 DataAdapter、不动 42 份派生副本。
  //   ⚠️ 排序键 missing（存量卡没有 updated_at）按 0 ⇒ 排最后，不会插队到新卡前面。
  sortList(list) {
    const pins = this.data.pinned || [];
    const rank = (c) => {
      const i = pins.indexOf(c.card_code);
      return i < 0 ? pins.length + 1 : i;
    };
    return list.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0);
    });
  },

  // round156：置顶 / 取消置顶（店铺级偏好，复用 saveShopSetting ⇒ 零新建集合、零新云函数。
  //   ⚠️ 为什么不存在成本卡记录上：M3 成本卡是**版本模型（只 INSERT 不 UPDATE）**，
  //     置顶写进卡记录就得插新版本 ⇒ 每置顶一次多一版历史，纯污染）。
  //   乐观更新：点击立刻有反馈；**失败必须回滚** —— 界面不能停在"看起来成功"的状态。
  async onPin(e) {
    const cc = e.currentTarget.dataset.code;
    if (!cc) return;
    const backup = (this.data.pinned || []).slice();
    const pins = backup.slice();
    const i = pins.indexOf(cc);
    const wasPinned = i >= 0;
    if (wasPinned) pins.splice(i, 1);
    else pins.unshift(cc);        // 新置顶的排最前（刚点的就是最想要的）
    this.setData({ pinned: pins });
    this.applyFilter();
    try {
      await api.call('saveShopSetting', { pinned_cards: pins, client_request_id: 'pc_' + Date.now() });
      wx.showToast({ title: wasPinned ? TERMS.card.unpinnedDone : TERMS.card.pinnedDone, icon: 'none' });
    } catch (err) {
      this.setData({ pinned: backup });
      this.applyFilter();
      api.toastError(err);
    }
  },

  // ===== R192：卡片操作 =====
  // 高频两项（版本历史 / 同步至原料最新价）已**常驻在卡片上**（ops-mini 行），
  //   ⇒ 这里只收低频 + 破坏性操作：置顶 / 复制 / 删除。
  // 🔴 R191 曾把 5 个按钮全收进「⋯」⇒ 李老师反馈「历史版本、同步最新价都丢了」。
  //    **教训（写进红线）：高频操作不能只靠「⋯」承载 —— 藏起来的功能等于没有。**
  // 🔴 为什么「⋯」而不是缩小按钮：.btn-small { min-height: 88rpx } 是触控硬红线
  //    （老板在店里手湿、手抖、边走边点），缩小＝引入误触。⇒ 正解是**分级**，不是全收。
  // 🔴 为什么用原生 showActionSheet 而不是自绘浮层：触控区/安全区/取消手势全部由平台保证，
  //    自绘要自己处理遮挡与底部安全区，风险面大得多，收益只是"能给删除上红色"
  //    —— 而红色已经在删除的**二次确认弹窗**里给到了（confirmColor: #e74c3c）。
  onMore(e) {
    const cc = e.currentTarget.dataset.code;
    if (!cc) return;
    const item = (this.data.list || []).filter((x) => x.card_code === cc)[0];
    const T = TERMS.card;
    // 置顶是**开关**，文案必须按当前状态走（否则点了像没反应）
    const pinLabel = item && item.pinned ? T.pinOff : T.pinOn;
    // 「编辑」也列出来：卡片主体点了就是进编辑，但**按钮不能凭空消失** ——
    //   老板的肌肉记忆在按钮上（李老师 2026-10-03：「编辑按钮也没有了」）⇒ 菜单里必须还能找到。
    wx.showActionSheet({
      itemList: [pinLabel, T.editCard, T.copyCard, T.deleteCard],
      success: (r) => {
        const ev = { currentTarget: { dataset: { code: cc } } };
        const idx = r.tapIndex;
        if (idx === 0) this.onPin(ev);
        else if (idx === 1) this.goEdit(ev);
        else if (idx === 2) this.onCopy(ev);
        else if (idx === 3) this.onDelete(ev);
      },
      fail: () => { /* 用户取消：不做任何事 */ },
    });
  },

  // 新增：先配额预检（免费张数由后端 checkQuota 出参决定；进列表不弹）
  async goAdd() {
    try {
      const q = await api.call('checkQuota', { scope: 'cost_card' });
      if (q.hit_free_limit) {
        openPaywall('saveLimit', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
        return;
      }
      if (q.hit_hard_limit) {
        // R193：硬上限（2000 张）—— 原是 toast 一句「请联系客服」，**没有任何可点的地方**
        //   ⇒ 改成可点：确认键直接进客服会话（fail-closed 兜底见 utils/paywall.js::openService）。
        wx.showModal({
          title: TERMS.pay.contactService,
          content: TERMS.pay.contactServiceHint,
          cancelText: TERMS.buttons.thinkAgain,
          confirmText: TERMS.exp.serviceEntry,
          confirmColor: '#1e3a5f',
          success: (r) => { if (r.confirm) openService(); },
        });
        return;
      }
      wx.navigateTo({ url: '/pages/card/edit?card_code=' });
    } catch (e) { api.toastError(e); }
  },
  goEdit(e) {
    const cc = e.currentTarget.dataset.code;
    wx.navigateTo({ url: '/pages/card/edit?card_code=' + (cc || '') });
  },
  goVersion(e) {
    const cc = e.currentTarget.dataset.code;
    wx.navigateTo({ url: '/pages/card/version?card_code=' + (cc || '') });
  },
  goOrders() { wx.navigateTo({ url: '/pages/pay/orders' }); },

  // ===== 批次 P0（任务 2）· 删除 / 复制 / 同步 =====
  // 删除 = 软删该 card_code 所有版本（二次确认；历史版本不物理删）
  onDelete(e) {
    const cc = e.currentTarget.dataset.code;
    wx.showModal({
      title: TERMS.card.deleteCard,
      content: TERMS.card.deleteCardConfirm,
      confirmColor: '#e74c3c',
      cancelText: TERMS.buttons.cancel,
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.call('saveCostCard', { card: { _delete: true, card_code: cc }, client_request_id: 'ccd_' + Date.now() });
          wx.showToast({ title: TERMS.card.deleteCard, icon: 'success' });
          this.load();
        } catch (err) { api.toastError(err); }
      },
    });
  },

  // 复制 = 基于最新版生成全新 card_code（复用 saveCostCard 不带 card_code → 新卡）
  async onCopy(e) {
    const cc = e.currentTarget.dataset.code;
    wx.showModal({
      title: TERMS.card.copyCard,
      content: TERMS.card.copyCardConfirm,
      confirmColor: '#1e3a5f',
      cancelText: TERMS.buttons.cancel,
      success: async (r) => {
        if (!r.confirm) return;
        try {
          const d = await api.call('getCostCard', { card_code: cc });
          const src = d.list && d.list[0];
          if (!src) { api.toastError({ msg: TERMS.card.empty }); return; }
          // 复制明细行：档案行 material_id+qty；手工行（material_id 空）→ input_type=2 + net_unit_cost 快照
          const lines = (src.lines || []).map((l) => {
            if (l.material_id) return { material_id: l.material_id, qty: l.quantity };
            return { input_type: 2, name: l.material_name || '', qty: l.quantity, net_unit_cost: l.net_unit_cost };
          });
          const card = {
            name: (src.name || '') + '',
            mode: src.calc_mode || 'A',
            lines,
            loss_pct: src.loss_rate || 0,
            aux_fen: src.aux_fen || 0,
            price_fen: src.price_fen || 0,
            activity_price_fen: src.price_promo_fen || 0,   // 任务4：复制带活动特价（分，validate 认 activity_price_fen）
            category: src.category || '',
            tags: src.tags || '',
          };
          if (card.mode === 'B') card.batch_output = src.batch_output || 0;
          await api.call('saveCostCard', { card, client_request_id: 'ccc_' + Date.now() });
          wx.showToast({ title: TERMS.card.copyCard, icon: 'success' });
          this.load();
        } catch (err) { api.toastError(err); }
      },
    });
  },

  // 同步单张至原料最新价（生成新版本，旧版本保留）
  async onSync(e) {
    const cc = e.currentTarget.dataset.code;
    try {
      wx.showLoading({ title: TERMS.exp.exportIng, mask: true });
      await api.call('syncCostCard', { card_code: cc, client_request_id: 'ccs_' + Date.now() });
      wx.hideLoading();
      wx.showToast({ title: TERMS.card.syncDone, icon: 'success' });
      this.load();
    } catch (err) { wx.hideLoading(); api.toastError(err); }
  },

  // 批量同步：进入选择模式 → 多选 → 执行
  onBatchSyncEnter() { this.setData({ selectMode: true, selected: {} }); },
  onBatchSyncCancel() { this.setData({ selectMode: false, selected: {} }); },
  onSelect(e) {
    const cc = e.currentTarget.dataset.code;
    const selected = Object.assign({}, this.data.selected);
    if (selected[cc]) delete selected[cc]; else selected[cc] = true;
    this.setData({ selected });
  },
  onBatchSyncRun() {
    const codes = Object.keys(this.data.selected).filter((k) => this.data.selected[k]);
    if (codes.length === 0) { wx.showToast({ title: TERMS.card.selectSync, icon: 'none' }); return; }
    wx.showModal({
      title: TERMS.card.batchSync,
      content: TERMS.card.batchSyncConfirm,
      confirmColor: '#1e3a5f',
      cancelText: TERMS.buttons.cancel,
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: TERMS.exp.exportIng, mask: true });
        try {
          for (const cc of codes) {
            await api.call('syncCostCard', { card_code: cc, client_request_id: 'ccb_' + cc + '_' + Date.now() });
          }
          wx.hideLoading();
          wx.showToast({ title: TERMS.card.syncDone, icon: 'success' });
          this.setData({ selectMode: false, selected: {} });
          this.load();
        } catch (err) { wx.hideLoading(); api.toastError(err); }
      },
    });
  },

  // 导出：付费功能，免费触发付费墙
  async onExport() {
    const ent = await require('../../utils/entitlement.js').fetchEntitlement().catch(() => null);
    if (!ent || !ent.is_active) {
      openPaywall('export', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
      return;
    }
    await this.doExport();
  },

  async doExport() {
    wx.showLoading({ title: TERMS.exp.exportIng, mask: true });
    try {
      // R265：'excel'(=CSV) 在微信里打不开（openDocument 不认 csv）⇒ 改要真 xlsx
      const d = await api.call('exportData', { scope: 'm3_cards', format: 'xlsx', client_request_id: 'ex3_' + Date.now() });
      wx.hideLoading();
      exportFile.deliver(d);   // 单源投递：落盘 + 打开 + 打不开时转发兜底
    } catch (e) { wx.hideLoading(); api.toastError(e); }
  },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
