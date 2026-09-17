// pages/month/amortize.js —— 批次 4 · M1 摊销资产管理页（列表 + 当月合计 + 新增/编辑/报废）
//
// ⚠️ 计算下沉：当月摊销合计与各资产当月摊销由 getAmortSchedule 后端（calcAmortize 引擎）计算，
//   前端只展示返回的分整数；保存资产走 saveAsset（后端算，前端不重算）。
// ⚠️ 软删：报废资产走 saveAsset + 删除标记（is_deleted），列表经 DataAdapter 自动隐藏；
//   删除须二次确认（M3/摊销软删一致）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      title: TERMS.amortizePage.title,
      monthTotal: TERMS.amortizePage.monthTotal,
      add: TERMS.amortizePage.add,
      name: TERMS.amortizePage.name,
      value: TERMS.amortizePage.value,
      startMonth: TERMS.amortizePage.startMonth,
      totalMonths: TERMS.amortizePage.totalMonths,
      terminateMonth: TERMS.amortizePage.terminateMonth,
      monthAmountShort: TERMS.amortizePage.monthAmountShort,
      terminateNow: TERMS.amortizePage.terminateNow,
      confirmTerminate: TERMS.amortizePage.confirmTerminate,
      save: TERMS.amortizePage.save,
      edit: TERMS.amortizePage.edit,
      empty: TERMS.amortizePage.empty,
      namePh: TERMS.amortizePage.namePh,
      monthUnit: TERMS.amortizePage.monthUnit,
      optional: TERMS.amortizePage.optional,
      loading: TERMS.ui.loading,
      cur: '¥',
      cancel: TERMS.buttons.cancel,
      archiveReadonly: TERMS.inputPage.archiveReadonly,
      confirmLocked: TERMS.inputPage.confirmLocked,
    },
    month: '',
    totalFen: 0,
    totalYuan: '0.00',       // 修 2：初值必须有（接口失败/未返回时渲染「¥0.00」而非裸「¥」）
    assets: [],
    showForm: false,
    editing: null,           // 编辑中的资产（含 asset_id）
    formName: '',
    formValueYuan: '',
    formStartMonth: '',
    formTotalMonths: '',
    formTerminateMonth: '',
    readOnly: false,
    loading: true,
  },

  onLoad(q) {
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.amortizePage.title);
      const d = await api.call('getAmortSchedule', { month: this.data.month });
      const isArchive = false; // 摊销资产不属于月度归档（可跨月管理）；归档守卫只作用于记账录入
      const assets = (d.assets || []).map((a) => ({
        asset_id: a.asset_id,
        name: a.name,
        value: api.fenToYuan(a.value_fen, 2),
        start_month: a.start_month,
        total_months: a.total_months,
        terminate_month: a.terminate_month || '',
        amount_fen: this.findMonthAmount(d.details, a.asset_id),
        amountYuan: api.fenToYuan(this.findMonthAmount(d.details, a.asset_id), 2),
      }));
      this.setData({
        totalFen: d.total_amount_fen || 0,
        totalYuan: api.fenToYuan(d.total_amount_fen || 0, 2),
        assets,
        readOnly: isArchive,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // 从 getAmortSchedule.details 找该资产当月摊销（分）
  findMonthAmount(details, assetId) {
    const row = (details || []).find((x) => x.asset_id === assetId);
    return row ? (row.amount_fen || 0) : 0;
  },

  onAdd() {
    this.setData({
      showForm: true,
      editing: null,
      formName: '',
      formValueYuan: '',
      formStartMonth: this.data.month,
      formTotalMonths: '',
      formTerminateMonth: '',
    });
  },
  onEdit(e) {
    const a = e.currentTarget.dataset.asset;
    this.setData({
      showForm: true,
      editing: a,
      formName: a.name,
      formValueYuan: api.fenToYuan(Math.round(Number(a.value) * 100), 2),
      formStartMonth: a.start_month,
      formTotalMonths: String(a.total_months),
      formTerminateMonth: a.terminate_month || '',
    });
  },
  onCancelForm() { this.setData({ showForm: false, editing: null }); },

  onName(e) { this.setData({ formName: e.detail.value }); },
  onValue(e) { this.setData({ formValueYuan: e.detail.value }); },
  onStartMonth(e) { this.setData({ formStartMonth: e.detail.value }); },
  onTotalMonths(e) { this.setData({ formTotalMonths: e.detail.value }); },
  onTerminateMonth(e) { this.setData({ formTerminateMonth: e.detail.value }); },

  onSaveAsset() {
    const name = this.data.formName.trim();
    if (!name) { wx.showToast({ title: TERMS.amortizePage.name, icon: 'none' }); return; }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(this.data.formStartMonth)) {
      wx.showToast({ title: TERMS.amortizePage.startMonth, icon: 'none' }); return;
    }
    const totalMonths = Number(this.data.formTotalMonths);
    if (!Number.isInteger(totalMonths) || totalMonths < 1) {
      wx.showToast({ title: TERMS.amortizePage.totalMonths, icon: 'none' }); return;
    }
    this.saveAsset();
  },

  async saveAsset() {
    const asset = {
      name: this.data.formName.trim(),
      value_fen: api.yuanToFen(this.data.formValueYuan),
      start_month: this.data.formStartMonth,
      total_months: Number(this.data.formTotalMonths),
    };
    if (this.data.formTerminateMonth) asset.terminate_month = this.data.formTerminateMonth;
    if (this.data.editing && this.data.editing.asset_id) asset.asset_id = this.data.editing.asset_id;
    try {
      await api.call('saveAsset', { asset, client_request_id: 'as_' + Date.now() });
      wx.showToast({ title: TERMS.amortizePage.save, icon: 'success' });
      this.setData({ showForm: false, editing: null });
      this.load();
    } catch (e) { api.toastError(e); }
  },

  // 报废：软删除（is_deleted=true），二次确认
  onTerminate(e) {
    const a = e.currentTarget.dataset.asset;
    wx.showModal({
      title: TERMS.amortizePage.terminateNow,
      content: TERMS.amortizePage.confirmTerminate,
      confirmColor: '#e74c3c',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          // 报废 = 保留资产但标记终止（terminate_month=当前月）→ 未摊余额作为处置损失；
          // 资产本身保留在台账（不可复活），前端列表由 DataAdapter 只展示活跃。
          await api.call('saveAsset', {
            asset: {
              asset_id: a.asset_id,
              name: a.name,
              value_fen: api.yuanToFen(a.value),
              start_month: a.start_month,
              total_months: a.total_months,
              terminate_month: this.data.month,
            },
            client_request_id: 'at_' + Date.now(),
          });
          wx.showToast({ title: TERMS.amortizePage.terminateNow, icon: 'success' });
          this.load();
        } catch (err) { api.toastError(err); }
      },
    });
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});