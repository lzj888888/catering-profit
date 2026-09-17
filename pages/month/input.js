// pages/month/input.js —— 批次 4 · M1 收入/费用/食材消耗录入页
//
// ⚠️ 计算下沉：金额一律「元」界面输入 → 适配层 Math.round(元×100) 转「分」number 传后端；
//   展示/回填用 getLedger 返回的分整数，前端不做任何利润计算。
// ⚠️ 归档守卫：is_archive=true → 全字段只读；归档后 7 天内补录需二次确认 + archive_override=true。
// ⚠️ AD-10/AD-23：onHide 自动存草稿（wx.setStorageSync），返回自动回填，不静默丢数据。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

const DRAFT_KEY = 'draft_month_input_';

Page({
  data: {
    t: {
      title: TERMS.inputPage.title,
      incomeTitle: TERMS.ledger.incomeTitle,
      expenseTitle: TERMS.ledger.expenseTitle,
      income: TERMS.ledger.income,          // [{category,label}]
      expense: TERMS.ledger.expense,        // [{category,label}]
      subItem: TERMS.ledger.subItem,
      amount: TERMS.ledger.amount,
      directConsume: TERMS.ledger.directConsume,
      directConsumeHint: TERMS.ledger.directConsumeHint,
      directConsumeSec: TERMS.uiFix.directConsumeSec,
      directConsumeField: TERMS.uiFix.directConsumeField,
      save: TERMS.buttons.save,
      archiveReadonly: TERMS.inputPage.archiveReadonly,
      graceNote: TERMS.inputPage.graceNote,
      saveArchiveOverride: TERMS.inputPage.saveArchiveOverride,
      confirmGraceSave: TERMS.inputPage.confirmGraceSave,
      confirmLocked: TERMS.inputPage.confirmLocked,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    month: '',
    isArchive: false,
    archivedAtMs: 0,
    inGrace: false,            // 归档后 7 天内
    readOnly: false,           // 归档且超宽限 → 硬锁
    incomeVals: [],            // 每行「元」字符串（与 t.income 对齐）
    expenseVals: [],
    directConsumeYuan: '',
    loading: true,
  },

  onLoad(q) {
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.load();
  },
  onShow() {
    // AD-10/AD-23：回来回填草稿（仅当本页还有未保存内容时）
    const draft = wx.getStorageSync(DRAFT_KEY + this.data.month);
    if (draft && !this.data.saved) {
      this.setData({
        incomeVals: draft.incomeVals || this.data.incomeVals,
        expenseVals: draft.expenseVals || this.data.expenseVals,
        directConsumeYuan: draft.directConsumeYuan !== undefined ? draft.directConsumeYuan : this.data.directConsumeYuan,
      });
    }
  },
  onHide() {
    // AD-10：自动存草稿（含已录入值）
    wx.setStorageSync(DRAFT_KEY + this.data.month, {
      incomeVals: this.data.incomeVals,
      expenseVals: this.data.expenseVals,
      directConsumeYuan: this.data.directConsumeYuan,
    });
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.inputPage.title);
      const d = await api.call('getLedger', { month: this.data.month });
      const sw = d.switches || {};
      const isArchive = !!d.is_archive;
      const archivedAtMs = d.archived_at || 0;
      const inGrace = ui.withinGrace(archivedAtMs, Date.now());
      const readOnly = isArchive && !inGrace;   // 归档且超 7 天 → 硬锁
      // 回填（元 = 分 / 100，仅展示用）
      const incomeVals = (d.income_items || []).map((it) => (it.amount_fen ? api.fenToYuan(it.amount_fen) : ''));
      const expenseVals = (d.expense_items || []).map((it) => (it.amount_fen ? api.fenToYuan(it.amount_fen) : ''));
      const directConsumeYuan = d.direct_consume_fen ? api.fenToYuan(d.direct_consume_fen) : '';
      // 若草稿存在且已保存过 → 用后端值（服务端为准）；否则后端值直接回填
      this.setData({
        isArchive, archivedAtMs, inGrace, readOnly,
        inventory: d.inventory || {},          // 原样带回，库存页保存时不丢
        incomeVals: incomeVals.length ? incomeVals : this.data.incomeVals.length ? this.data.incomeVals : ['', '', ''],
        expenseVals: expenseVals.length ? expenseVals : this.data.expenseVals.length ? this.data.expenseVals : ['', '', '', ''],
        directConsumeYuan: directConsumeYuan || this.data.directConsumeYuan,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onIncome(e) {
    const idx = e.currentTarget.dataset.idx;
    const incomeVals = this.data.incomeVals.slice();
    incomeVals[idx] = e.detail.value;
    this.setData({ incomeVals });
  },
  onExpense(e) {
    const idx = e.currentTarget.dataset.idx;
    const expenseVals = this.data.expenseVals.slice();
    expenseVals[idx] = e.detail.value;
    this.setData({ expenseVals });
  },
  onDirectConsume(e) { this.setData({ directConsumeYuan: e.detail.value }); },

  // 归档守卫 + 保存（保存时带已有库存数据，避免丢失）
  onSave() {
    if (this.data.readOnly) {
      wx.showModal({ title: TERMS.inputPage.archiveReadonly, content: TERMS.inputPage.confirmLocked, showCancel: false });
      return;
    }
    const doSave = () => this.save(!!this.data.isArchive); // 归档补录 → archive_override
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
    // 金额：元 → 分（适配层 Math.round(元×100)，禁止字符串透传）
    const toFen = (yuanStr) => api.yuanToFen(yuanStr);
    const incomeItems = this.data.incomeVals.map((v, i) => ({ amount_fen: toFen(v), name: this.data.t.income[i].label }));
    const expenseItems = this.data.expenseVals.map((v, i) => ({ amount_fen: toFen(v), name: this.data.t.expense[i].label }));
    try {
      ui.setTitle(TERMS.buttons.save);
      await api.call('saveLedger', {
        month: this.data.month,
        income_items: incomeItems,
        expense_items: expenseItems,
        direct_consume_fen: toFen(this.data.directConsumeYuan),
        inventory: this.data.inventory || undefined,
        archive_override: archiveOverride || undefined,
        client_request_id: 'li_' + Date.now(),
      });
      this.setData({ saved: true });
      wx.removeStorageSync(DRAFT_KEY + this.data.month); // 已保存 → 清草稿
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});