// pages/month/input.js —— 批次 4/8 · M1 收入/费用/食材消耗录入页
//
// ⚠️ 计算下沉：金额一律「元」界面输入 → 适配层 Math.round(元×100) 转「分」number 传后端；
//   大类金额由云函数按细项汇总（saveLedger/validate cleanItems），前端不汇总、不重算。
// ⚠️ A1/A2（批次 8）：收入/费用为「大类 → 二级细项」两级结构；
//   每大类默认单行（细项名可空 = 整类总额），可展开添加多行细项（新增/删除）。
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
      income: TERMS.ledger.income,          // [{category,label,items:[...]}]
      expense: TERMS.ledger.expense,        // [{category,label,items:[...]}]
      subItem: TERMS.ledger.subItem,
      subItemPh: TERMS.ledger.subItemPh,
      addSubItem: TERMS.ledger.addSubItem,
      delSubItem: TERMS.ledger.delSubItem,
      amount: TERMS.ledger.amount,
      incomeHint: TERMS.ledger.incomeHint,   // E1
      expenseHint: TERMS.ledger.expenseHint, // E1
      // E2（批次 8c）：每类「包括 / 不包括」+ 顶部填写口径折叠块
      fillGuideTitle: TERMS.ledger.fillGuideTitle,
      fillGuide: TERMS.ledger.fillGuide,
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
    // A2：每大类一组细项行 rows: [{ subItem, amountYuan }]；expanded 控制该大类展开
    incomeGroups: [],          // [{ category, label, items(模板), expanded, rows }]
    expenseGroups: [],
    fillGuideOpen: false,      // E2：顶部「填写口径」折叠块（默认收起）
    directConsumeYuan: '',
    loading: true,
  },

  onLoad(q) {
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.initGroups();
    this.load();
  },
  onShow() {
    // AD-10/AD-23：回来回填草稿（仅当本页还有未保存内容时）
    const draft = wx.getStorageSync(DRAFT_KEY + this.data.month);
    if (draft && !this.data.saved) {
      this.setData({
        incomeGroups: draft.incomeGroups || this.data.incomeGroups,
        expenseGroups: draft.expenseGroups || this.data.expenseGroups,
        directConsumeYuan: draft.directConsumeYuan !== undefined ? draft.directConsumeYuan : this.data.directConsumeYuan,
      });
    }
  },
  onHide() {
    // AD-10：自动存草稿（含已录入值）
    wx.setStorageSync(DRAFT_KEY + this.data.month, {
      incomeGroups: this.data.incomeGroups,
      expenseGroups: this.data.expenseGroups,
      directConsumeYuan: this.data.directConsumeYuan,
    });
  },

  // A2：按模板初始化大类组（每类默认单行：细项名空 = 整类总额）
  // ⚠️ showRows = 实际渲染行：折叠时仅首行（整类总额），展开时全部细项行（WXML 不支持方法调用，故预计算）
  // E2：每类带一句 scope（包括 / 不包括），来源 i18n（incomeScope / expenseScope），页面不写死文案
  initGroups() {
    const mk = (defs, scopeMap) => defs.map((g) => {
      const rows = [{ subItem: '', amountYuan: '' }];
      return {
        category: g.category, label: g.label, items: g.items || [],
        scope: (scopeMap || {})[g.category] || '',
        expanded: false, rows, showRows: rows,
      };
    });
    this.setData({
      incomeGroups: mk(TERMS.ledger.income, TERMS.ledger.incomeScope),
      expenseGroups: mk(TERMS.ledger.expense, TERMS.ledger.expenseScope),
    });
  },

  // E2：顶部「填写口径」折叠块开关
  onToggleFillGuide() {
    this.setData({ fillGuideOpen: !this.data.fillGuideOpen });
  },

  // 从后端明细（snake_case income_items/expense_items）重建组：每大类 → rows = sub_items（无细项则单行整类）
  rebuildFromItems(defs, items, scopeMap) {
    return defs.map((g) => {
      const found = (items || []).find((it) => (it.category || '') === g.category);
      let rows = [{ subItem: '', amountYuan: '' }];
      if (found) {
        const subs = found.sub_items || [];
        if (subs.length > 0) {
          rows = subs.map((si) => ({ subItem: si.sub_item || '', amountYuan: si.amount_fen ? api.fenToYuan(si.amount_fen) : '' }));
        } else if (found.amount_fen) {
          rows = [{ subItem: '', amountYuan: api.fenToYuan(found.amount_fen) }];
        }
      }
      const expanded = rows.length > 1;
      return {
        category: g.category, label: g.label, items: g.items || [],
        scope: (scopeMap || {})[g.category] || '',
        expanded, rows, showRows: expanded ? rows : rows.slice(0, 1),
      };
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
      const incomeGroups = this.rebuildFromItems(TERMS.ledger.income, d.income_items, TERMS.ledger.incomeScope);
      const expenseGroups = this.rebuildFromItems(TERMS.ledger.expense, d.expense_items, TERMS.ledger.expenseScope);
      const directConsumeYuan = d.direct_consume_fen ? api.fenToYuan(d.direct_consume_fen) : '';
      // 若草稿存在且已保存过 → 用后端值（服务端为准）；否则后端值直接回填
      this.setData({
        isArchive, archivedAtMs, inGrace, readOnly,
        inventory: d.inventory || {},          // 原样带回，库存页保存时不丢
        incomeGroups,
        expenseGroups,
        directConsumeYuan: directConsumeYuan || this.data.directConsumeYuan,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // ===== 大类展开/收起 =====
  onToggleGroup(e) {
    const kind = e.currentTarget.dataset.kind;   // 'income' | 'expense'
    const idx = Number(e.currentTarget.dataset.idx);
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[idx]);
    g.expanded = !g.expanded;
    g.showRows = g.expanded ? g.rows : g.rows.slice(0, 1); // 折叠只显示首行（整类总额）
    groups[idx] = g;
    this.setData({ [key]: groups });
  },

  // ===== 细项行：细项名 / 金额 / 新增 / 删除 =====
  onSubItem(e) {
    const { kind, gidx, ridx } = e.currentTarget.dataset;
    this.updateRow(kind, Number(gidx), Number(ridx), { subItem: e.detail.value });
  },
  onSubAmount(e) {
    const { kind, gidx, ridx } = e.currentTarget.dataset;
    this.updateRow(kind, Number(gidx), Number(ridx), { amountYuan: e.detail.value });
  },
  updateRow(kind, gidx, ridx, patch) {
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[gidx]);
    const rows = g.rows.slice();
    rows[ridx] = Object.assign({}, rows[ridx], patch);
    g.rows = rows;
    g.showRows = g.expanded ? rows : rows.slice(0, 1);
    groups[gidx] = g;
    this.setData({ [key]: groups });
  },
  addRow(e) {
    const { kind, gidx } = e.currentTarget.dataset;
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[Number(gidx)]);
    g.rows = g.rows.concat([{ subItem: '', amountYuan: '' }]);
    g.showRows = g.rows;
    groups[Number(gidx)] = g;
    this.setData({ [key]: groups });
  },
  delRow(e) {
    const { kind, gidx, ridx } = e.currentTarget.dataset;
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[Number(gidx)]);
    let rows = g.rows.slice();
    rows.splice(Number(ridx), 1);
    if (rows.length === 0) rows = [{ subItem: '', amountYuan: '' }]; // 至少保留一行（老板只填一行也能走）
    g.rows = rows;
    g.showRows = g.expanded ? rows : rows.slice(0, 1);
    groups[Number(gidx)] = g;
    this.setData({ [key]: groups });
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
        confirmColor: '#1e3a5f',
        success: (r) => { if (r.confirm) doSave(); },
      });
    } else {
      doSave();
    }
  },

  // 组装提交：每大类 → sub_items（云函数汇总大类金额，前端不汇总）；旧调用兼容（无细项时也走 sub_items 单行）
  buildItems(groups) {
    return groups.map((g) => ({
      category: g.category,
      name: g.label,
      sub_items: g.rows.map((r) => ({ sub_item: (r.subItem || '').trim(), amount_fen: api.yuanToFen(r.amountYuan) })),
    }));
  },

  async save(archiveOverride) {
    try {
      ui.setTitle(TERMS.buttons.save);
      await api.call('saveLedger', {
        month: this.data.month,
        income_items: this.buildItems(this.data.incomeGroups),
        expense_items: this.buildItems(this.data.expenseGroups),
        direct_consume_fen: api.yuanToFen(this.data.directConsumeYuan),
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