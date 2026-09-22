// pages/month/assetEdit.js —— round107 · 一次性投入的**独立编辑页**
//
// 为什么单独一页（而不是继续用摊销页的底部弹层）：
//   真机截图显示，底部弹层（.mask{position:fixed} + .sheet 底部对齐）碰上 5 个字段 + 键盘时必然打架 ——
//   面板整个被键盘盖住、输入框浮到卡片上，用户「看不见、存不了」。独立页没有「弹层 + 键盘」这层耦合：
//   字段、提示、报错都有位置放，键盘顶起来也只是正常滚动。M3 菜品卡（pages/card/edit）已是同款先例。
//
// ⚠️ 计算下沉：本页**不做任何金额/摊销/合计计算**
//   · kind='lump'  → saveAsset({ asset: { mode:'lump', total_months:1, start_month } })
//                     —— 金额进台账；当月「一次算清合计」由 saveLedger 服务端求和后进双利润引擎。
//   · kind='amort' → saveAsset（分期摊销）
//   · 删除         → saveAsset({ asset: { asset_id, delete:true } })（软删，不可复活）
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

const T = TERMS.amortizePage;

Page({
  data: {
    t: {
      lumpTitle: T.editLumpTitle,
      amortTitle: T.editAmortTitle,
      lumpHint: T.editLumpHint,
      amortHint: T.editAmortHint,
      appendTitle: T.appendTitle,
      appendHint: T.appendHint,
      fName: T.fName,
      fNamePh: T.fNamePh,
      fAmount: T.fAmount,
      fAmountHint: T.fAmountHint,
      fStartMonth: T.fStartMonth,
      fStartHint: T.fStartHint,
      fStartPh: T.fStartPh,
      fTotalMonths: T.fTotalMonths,
      fTotalHint: T.fTotalHint,
      fTerminateMonth: T.fTerminateMonth,
      fTerminateHint: T.fTerminateHint,
      fSave: T.fSave,
      fDelete: T.lumpDelete,
      confirmDelete: T.confirmDeleteLump,
      optional: T.optional,
      monthUnit: T.monthUnit,
      loading: TERMS.ui.loading,
      cancel: TERMS.buttons.cancel,
      save: TERMS.buttons.save,
      archiveReadonly: TERMS.inputPage.archiveReadonly,
      lumpMonthLabel: T.lumpMonthLabel,
      lumpMonthHint: T.lumpMonthHint,
    },
    kind: 'lump',        // 'lump'（一次算清）| 'amort'（分期摊销）
    month: '',
    mode: 'new',         // 'new' | 'edit' | 'append'
    assetId: '',
    groupKey: '',
    batchSeq: 1,
    name: '',
    amountYuan: '',
    startMonth: '',
    totalMonths: '',
    terminateMonth: '',
    readOnly: false,
    loading: true,
    saving: false,
  },

  onLoad(q) {
    const o = q || {};
    const kind = o.kind === 'amort' ? 'amort' : 'lump';
    const month = o.month || ui.nowMonth();
    const assetId = o.asset_id || '';
    const groupKey = o.group || '';
    const mode = assetId ? 'edit' : (groupKey ? 'append' : 'new');
    this.setData({
      kind, month, assetId, groupKey, mode,
      batchSeq: 1,
      // 新建默认值：一次性投入固定摊 1 个月（= 当月一次算清）；摊销默认从本月起、月数留空让老板填
      startMonth: month,
      totalMonths: kind === 'lump' ? '1' : '',
      name: '', amountYuan: '', terminateMonth: '',
    });
    ui.setTitle(kind === 'lump' ? T.editLumpTitle : T.editAmortTitle);
    this.load();
  },

  // 预填一律回源后端（getAmortSchedule）：不靠上一页把对象塞进 URL
  async load() {
    try {
      await api.ensureShop();
      const d = await api.call('getAmortSchedule', { month: this.data.month });
      const init = { loading: false, readOnly: !!d.is_archive };
      const rows = (d.assets || []).filter((a) => a.asset_id);

      if (this.data.mode === 'edit') {
        if (this.data.kind === 'lump') {
          const it = (d.lumps || []).find((x) => x.item_id === this.data.assetId);
          if (it) {
            init.name = it.name || '';
            init.amountYuan = api.fenToYuan(it.amount_fen || 0, 2);
            init.startMonth = it.month || this.data.month;
            init.totalMonths = '1';
          }
        } else {
          const a = rows.find((x) => x.asset_id === this.data.assetId);
          if (a) {
            init.name = a.name || '';
            init.amountYuan = api.fenToYuan(a.value_fen || 0, 2);
            init.startMonth = a.start_month || this.data.month;
            init.totalMonths = String(a.total_months || '');
            init.terminateMonth = a.terminate_month || '';
          }
        }
      } else if (this.data.mode === 'append') {
        // 「再投一笔」：沿用同一组的名称，起摊月默认本月（每笔各自独立起摊）
        const gk = this.data.groupKey;
        const sibs = rows.filter((x) => (x.group_id || x.asset_id) === gk);
        if (sibs.length) {
          init.name = sibs[0].name || '';
          init.batchSeq = sibs.length + 1;
        } else {
          init.batchSeq = 1;
        }
      }
      this.setData(init);
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onBack() { wx.navigateBack(); },
  onAmount(e) { this.setData({ amountYuan: e.detail.value }); },
  onTotalMonths(e) { this.setData({ totalMonths: e.detail.value }); },
  // B1：年月选择统一用原生 picker（mode=date fields=month），返回 YYYY-MM
  onMonthPick(e) {
    const field = e.currentTarget.dataset.field;   // 'start' | 'end'
    const v = e.detail.value || '';
    if (field === 'start') this.setData({ startMonth: v });
    else this.setData({ terminateMonth: v });
  },

  onSave() {
    const name = (this.data.name || '').trim();
    if (!name) { wx.showToast({ title: T.fErrName, icon: 'none' }); return; }
    const fen = api.yuanToFen(this.data.amountYuan);
    if (!(fen > 0)) { wx.showToast({ title: T.fErrAmount, icon: 'none' }); return; }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(this.data.startMonth)) {
      wx.showToast({ title: T.fErrStart, icon: 'none' }); return;
    }
    if (this.data.kind === 'amort') {
      const n = Number(this.data.totalMonths);
      if (!Number.isInteger(n) || n < 1) { wx.showToast({ title: T.fErrMonths, icon: 'none' }); return; }
    }
    this.saveAsset(fen, name);
  },

  async saveAsset(valueFen, name) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    const isLump = this.data.kind === 'lump';
    const asset = {
      name,
      value_fen: valueFen,
      start_month: this.data.startMonth,
      // 一次算清 = 只摊 1 个月（等价「全部算进 start_month 当月」），口径由后端 mode 决定
      total_months: isLump ? 1 : Number(this.data.totalMonths),
      mode: isLump ? 'lump' : 'amort',
    };
    if (!isLump && this.data.terminateMonth) asset.terminate_month = this.data.terminateMonth;
    if (this.data.mode === 'edit') {
      asset.asset_id = this.data.assetId;
    } else if (this.data.mode === 'append') {
      asset.group_id = this.data.groupKey;
      asset.batch_seq = this.data.batchSeq;
    }
    try {
      await api.call('saveAsset', { asset, client_request_id: 'as_' + Date.now() });
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      this.setData({ saving: false });
      api.toastError(e);
    }
  },

  // 删除（仅「一次算清」的投入；摊销资产请用列表里的「提前报废」保留痕迹）
  onDelete() {
    if (this.data.mode !== 'edit') return;
    wx.showModal({
      title: T.lumpDelete,
      content: T.confirmDeleteLump,
      confirmColor: '#e74c3c',
      success: async (r) => {
        if (!r.confirm) return;
        // G6：不可逆操作 → 触觉反馈
        if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'medium' }); } catch (err) { /* 部分机型不支持，忽略 */ } }
        try {
          await api.call('saveAsset', {
            asset: { asset_id: this.data.assetId, delete: true },
            client_request_id: 'ad_' + Date.now(),
          });
          wx.showToast({ title: T.lumpDelete, icon: 'success' });
          setTimeout(() => wx.navigateBack(), 600);
        } catch (e) { api.toastError(e); }
      },
    });
  },
});
