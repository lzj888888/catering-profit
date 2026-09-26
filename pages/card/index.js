// pages/card/index.js —— 批次 4/5 / 批次 P0（M3 v1.2）· M3 成本卡列表
// ⚠️ 批次 5 付费边界：只有「保存超限」「导出」才触发付费弹窗；M2 永不弹。
// ⚠️ M3.22（批次 A1）：免费张数不再硬编码，一律取 checkQuota 出参。
// ⚠️ 批次 P0（任务 2）：补齐搜索/筛选/删除（软删全部版本）/复制（新 card_code）/
//   同步至原料最新价（接 syncCostCard，单张+批量）；加「原料档案」入口。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { openPaywall } = require('../../utils/paywall.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

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
      deleteCardConfirm: TERMS.card.deleteCardConfirm,
      copyCard: TERMS.card.copyCard,
      copyCardConfirm: TERMS.card.copyCardConfirm,
      syncCard: TERMS.card.syncCard,
      batchSync: TERMS.card.batchSync,
      batchSyncConfirm: TERMS.card.batchSyncConfirm,
      syncDone: TERMS.card.syncDone,
      selectSync: TERMS.card.selectSync,
      cancel: TERMS.buttons.cancel,
      materialArchive: TERMS.card.materialListTitle,
      filterTags: TERMS.card.filterTags,
    },
    all: [],           // 全量列表（前端过滤）
    list: [],
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

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.listTitle);
      const d = await api.call('getCostCard', {});
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
      this.setData({ all, categoryOptions, tagOptions, loading: false });
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
    this.setData({ list });
  },

  // 原料档案入口
  goMaterial() { wx.navigateTo({ url: '/pages/material/index' }); },

  // 新增：先配额预检（免费张数由后端 checkQuota 出参决定；进列表不弹）
  async goAdd() {
    try {
      const q = await api.call('checkQuota', { scope: 'cost_card' });
      if (q.hit_free_limit) {
        openPaywall('saveLimit', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
        return;
      }
      if (q.hit_hard_limit) {
        api.toastError({ msg: TERMS.pay.contactServiceHint });
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
      const d = await api.call('exportData', { scope: 'm3_cards', format: 'excel', client_request_id: 'ex3_' + Date.now() });
      wx.hideLoading();
      this.downloadContent(d.filename, d.content, d.format);
      wx.showToast({ title: TERMS.exp.exportDone, icon: 'success' });
    } catch (e) { wx.hideLoading(); api.toastError(e); }
  },

  downloadContent(filename, content, format) {
    const fs = wx.getFileSystemManager();
    const tmp = `${wx.env.USER_DATA_PATH}/${filename}`;
    // S0（任务4）：exportData 声明的 format='excel' 实际落盘为 CSV 内容（带 BOM，Excel 可开），
    //   fileType 按「json / csv」二选一，'excel' 显式映射为 'csv'（避免隐式 else 碰巧对）。
    const fileType = format === 'json' ? 'json' : 'csv';
    try {
      fs.writeFileSync(tmp, format === 'json' ? JSON.stringify(content) : String(content), 'utf8');
      wx.openDocument({ filePath: tmp, showMenu: true, fileType, fail: () => {} });
    } catch (e) { api.toastError(e); }
  },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
