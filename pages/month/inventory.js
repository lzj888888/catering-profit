// pages/month/inventory.js —— 批次 4 · M1 库存录入页（期初/采购/期末盘点，写 shop_inventory）
//
// ⚠️ 计算下沉：金额一律「元」→ 适配层转「分」；真实消耗由服务端 saveLedger 倒轧，前端不算。
// ⚠️ 库存开关：以服务端 getLedger 读回 switches.inventorySwitchOn 为准（前端仅展示）。
// ⚠️ 归档守卫：is_archive=true 且超 7 天宽限 → 硬锁只读；宽限内补录需二次确认。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

const DRAFT_KEY = 'draft_month_inv_';

Page({
  data: {
    t: {
      title: TERMS.inventoryPage.title,
      opening: TERMS.inventoryPage.opening,
      openingHint: TERMS.inventoryPage.openingHint,
      purchase: TERMS.inventoryPage.purchase,
      purchaseHint: TERMS.inventoryPage.purchaseHint,
      closing: TERMS.inventoryPage.closing,
      closingHint: TERMS.inventoryPage.closingHint,
      save: TERMS.inventoryPage.save,
      hintFormula: TERMS.inventoryPage.hintFormula,
      loading: TERMS.ui.loading,
      archiveReadonly: TERMS.inputPage.archiveReadonly,
      graceNote: TERMS.inputPage.graceNote,
      saveArchiveOverride: TERMS.inputPage.saveArchiveOverride,
      confirmGraceSave: TERMS.inputPage.confirmGraceSave,
      confirmLocked: TERMS.inputPage.confirmLocked,
    },
    month: '',
    inventorySwitchOn: false,
    isArchive: false,
    inGrace: false,
    readOnly: false,
    openingYuan: '',
    purchaseYuan: '',
    closingYuan: '',
    loading: true,
  },

  onLoad(q) {
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.load();
  },
  onShow() {
    const draft = wx.getStorageSync(DRAFT_KEY + this.data.month);
    if (draft && !this.data.saved) {
      this.setData({
        openingYuan: draft.openingYuan !== undefined ? draft.openingYuan : this.data.openingYuan,
        purchaseYuan: draft.purchaseYuan !== undefined ? draft.purchaseYuan : this.data.purchaseYuan,
        closingYuan: draft.closingYuan !== undefined ? draft.closingYuan : this.data.closingYuan,
      });
    }
  },
  onHide() {
    wx.setStorageSync(DRAFT_KEY + this.data.month, {
      openingYuan: this.data.openingYuan,
      purchaseYuan: this.data.purchaseYuan,
      closingYuan: this.data.closingYuan,
    });
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.inventoryPage.title);
      const d = await api.call('getLedger', { month: this.data.month });
      const sw = d.switches || {};
      const isArchive = !!d.is_archive;
      const inGrace = ui.withinGrace(d.archived_at || 0, Date.now());
      const readOnly = isArchive && !inGrace;
      const inv = d.inventory || {};
      this.setData({
        inventorySwitchOn: !!sw.inventorySwitchOn,
        isArchive, inGrace, readOnly,
        incomeItems: d.income_items || [],          // 原样带回，保存时不丢收入/费用
        expenseItems: d.expense_items || [],
        directConsumeFen: d.direct_consume_fen || 0,
        openingYuan: inv.opening_fen != null && inv.opening_fen > 0 ? api.fenToYuan(inv.opening_fen) : '',
        purchaseYuan: inv.purchase_fen != null && inv.purchase_fen > 0 ? api.fenToYuan(inv.purchase_fen) : '',
        closingYuan: inv.closing_fen != null && inv.closing_fen > 0 ? api.fenToYuan(inv.closing_fen) : '',
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onOpening(e) { this.setData({ openingYuan: e.detail.value }); },
  onPurchase(e) { this.setData({ purchaseYuan: e.detail.value }); },
  onClosing(e) { this.setData({ closingYuan: e.detail.value }); },

  onSave() {
    if (this.data.readOnly) {
      wx.showModal({ title: TERMS.inputPage.archiveReadonly, content: TERMS.inputPage.confirmLocked, showCancel: false });
      return;
    }
    const doSave = () => this.save(!!this.data.isArchive);
    if (this.data.isArchive && this.data.inGrace) {
      wx.showModal({
        title: TERMS.inputPage.saveArchiveOverride,
        content: TERMS.inputPage.confirmGraceSave,
        confirmColor: '#ff6b35',
        success: (r) => { if (r.confirm) doSave(); },
      });
    } else {
      doSave();
    }
  },

  async save(archiveOverride) {
    // 元 → 分（适配层）
    const inventory = {
      opening_fen: api.yuanToFen(this.data.openingYuan),
      purchase_fen: api.yuanToFen(this.data.purchaseYuan),
      closing_fen: api.yuanToFen(this.data.closingYuan),
    };
    try {
      await api.call('saveLedger', {
        month: this.data.month,
        // 原样带回收入/费用/直接消耗（saveLedger 缺省即 []，会清空，必须回带）
        income_items: this.data.incomeItems || [],
        expense_items: this.data.expenseItems || [],
        direct_consume_fen: this.data.directConsumeFen || 0,
        // 库存页只写库存
        inventory,
        archive_override: archiveOverride || undefined,
        client_request_id: 'in_' + Date.now(),
      });
      this.setData({ saved: true });
      wx.removeStorageSync(DRAFT_KEY + this.data.month);
      wx.showToast({ title: TERMS.inventoryPage.save, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});