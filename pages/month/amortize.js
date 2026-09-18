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
      // H1（批次 8c）：同一资产多次采购
      scopeHint: TERMS.amortizePage.scopeHint,
      appendPurchase: TERMS.amortizePage.appendPurchase,
      appendTitle: TERMS.amortizePage.appendTitle,
      batchPrefix: TERMS.amortizePage.batchPrefix,
      batchSuffix: TERMS.amortizePage.batchSuffix,
      batchTotalPrefix: TERMS.amortizePage.batchTotalPrefix,
      batchTotalSuffix: TERMS.amortizePage.batchTotalSuffix,
      groupValueLabel: TERMS.amortizePage.groupValueLabel,
      expandHint: TERMS.amortizePage.expandHint,
      appendHint: TERMS.amortizePage.appendHint,
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
    groups: [],              // H1：按「同一资产」分组的视图（每组 = 该资产的 N 笔采购）
    showForm: false,
    editing: null,           // 编辑中的资产（含 asset_id）
    appendGroup: '',         // H1：追加采购时的目标组键（'' = 普通新增）
    appendSeq: 1,            // H1：追加采购的笔次
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
      const assets = (d.assets || []).map((a) => {
        const amountFen = this.findMonthAmount(d.details, a.asset_id);
        return {
          asset_id: a.asset_id,
          name: a.name,
          value_fen: a.value_fen,
          value: api.fenToYuan(a.value_fen, 2),
          start_month: a.start_month,
          total_months: a.total_months,
          terminate_month: a.terminate_month || '',
          group_id: a.group_id || '',
          batch_seq: a.batch_seq || 1,
          amount_fen: amountFen,
          amountYuan: api.fenToYuan(amountFen, 2),
        };
      });
      this.setData({
        totalFen: d.total_amount_fen || 0,
        totalYuan: api.fenToYuan(d.total_amount_fen || 0, 2),
        assets,
        groups: this.buildGroups(assets),
        readOnly: isArchive,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // H1：把资产行按组键（group_id || asset_id）聚成「同一资产的多次采购」
  //   ⚠️ 计算仍全部由后端算：这里只做展示合计（元金额由 fenToYuan 换算），不参与摊销公式。
  buildGroups(rows) {
    const map = {};
    const order = [];
    (rows || []).forEach((r) => {
      const key = r.group_id || r.asset_id;   // 无 group_id 的独立资产 = 自成一组（老数据行为不变）
      if (!map[key]) {
        map[key] = { key, name: r.name, count: 0, valueFen: 0, monthFen: 0, batches: [], expanded: false };
        order.push(key);
      }
      const g = map[key];
      g.batches.push(r);
      g.count += 1;
      g.valueFen += r.value_fen || 0;
      g.monthFen += r.amount_fen || 0;
    });
    return order.map((k) => {
      const g = map[k];
      g.batches.sort((x, y) => (x.batch_seq || 1) - (y.batch_seq || 1));
      g.valueYuan = api.fenToYuan(g.valueFen, 2);
      g.monthYuan = api.fenToYuan(g.monthFen, 2);
      g.multi = g.count > 1;
      return g;
    });
  },

  // H1：展开/收起某组的多笔明细
  onToggleGroup(e) {
    const key = e.currentTarget.dataset.group;
    const groups = this.data.groups.map((g) => (g.key === key ? Object.assign({}, g, { expanded: !g.expanded }) : g));
    this.setData({ groups });
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
      appendGroup: '',
      appendSeq: 1,
      formName: '',
      formValueYuan: '',
      formStartMonth: this.data.month,
      formTotalMonths: '',
      formTerminateMonth: '',
    });
  },
  // H1：追加采购 —— 同一资产再投一笔：沿用组名/组键，起摊月默认当前月，保存后成为组内下一笔（独立起摊）
  onAppend(e) {
    const g = e.currentTarget.dataset.group;
    const group = (this.data.groups || []).find((x) => x.key === g);
    if (!group) return;
    this.setData({
      showForm: true,
      editing: null,
      appendGroup: group.key,
      appendSeq: group.count + 1,
      formName: group.name,
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
      appendGroup: '',
      appendSeq: 1,
      formName: a.name,
      formValueYuan: api.fenToYuan(Math.round(Number(a.value) * 100), 2),
      formStartMonth: a.start_month,
      formTotalMonths: String(a.total_months),
      formTerminateMonth: a.terminate_month || '',
    });
  },
  onCancelForm() { this.setData({ showForm: false, editing: null, appendGroup: '', appendSeq: 1 }); },

  onName(e) { this.setData({ formName: e.detail.value }); },
  onValue(e) { this.setData({ formValueYuan: e.detail.value }); },
  // B1：年月选择（mode=date fields=month 返回 YYYY-MM）
  onMonthPick(e) {
    const field = e.currentTarget.dataset.field;   // 'start' | 'end'
    const v = e.detail.value || '';
    if (field === 'start') this.setData({ formStartMonth: v });
    else this.setData({ formTerminateMonth: v });
  },
  onTotalMonths(e) { this.setData({ formTotalMonths: e.detail.value }); },

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
    if (this.data.editing && this.data.editing.asset_id) {
      asset.asset_id = this.data.editing.asset_id;
      // 编辑某一笔时保留它的组归属，别把多笔资产拆散
      if (this.data.editing.group_id) { asset.group_id = this.data.editing.group_id; asset.batch_seq = this.data.editing.batch_seq || 1; }
    } else if (this.data.appendGroup) {
      // H1 追加采购：新行 + 组键指向首笔 + 组内序号（后端按行独立起摊，互不干扰）
      asset.group_id = this.data.appendGroup;
      asset.batch_seq = this.data.appendSeq;
    }
    try {
      await api.call('saveAsset', { asset, client_request_id: 'as_' + Date.now() });
      wx.showToast({ title: TERMS.amortizePage.save, icon: 'success' });
      this.setData({ showForm: false, editing: null, appendGroup: '', appendSeq: 1 });
      this.load();
    } catch (e) { api.toastError(e); }
  },

  // 报废：软删除（is_deleted=true），二次确认 + 触觉反馈（G6 不可逆操作）
  onTerminate(e) {
    const a = e.currentTarget.dataset.asset;
    wx.showModal({
      title: TERMS.amortizePage.terminateNow,
      content: TERMS.amortizePage.confirmTerminate,
      confirmColor: '#e74c3c',
      success: async (r) => {
        if (!r.confirm) return;
        // G6：不可逆操作（报废资产）→ 触觉反馈
        if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'medium' }); } catch (err) { /* 部分机型不支持，忽略 */ } }
        try {
          // 报废 = 保留资产但标记终止（terminate_month=当前月）→ 未摊余额作为处置损失；
          // 资产本身保留在台账（不可复活），前端列表由 DataAdapter 只展示活跃。
          const payload = {
            asset_id: a.asset_id,
            name: a.name,
            value_fen: api.yuanToFen(a.value),
            start_month: a.start_month,
            total_months: a.total_months,
            terminate_month: this.data.month,
          };
          // H1：只报废这一笔，保留它的组归属（多笔资产的其他笔不受影响）
          if (a.group_id) { payload.group_id = a.group_id; payload.batch_seq = a.batch_seq || 1; }
          await api.call('saveAsset', {
            asset: payload,
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