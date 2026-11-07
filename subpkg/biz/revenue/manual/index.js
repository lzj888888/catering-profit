// subpkg/biz/revenue/manual/index.js —— R620 手填整月汇总
//
// 为什么要有这个页面：**大部分餐饮老板不会用 Excel**。
//   原来的入口是"选一张收款日报表（Excel）"，对会做表的人是省事，对不会的人是死路。
//   这个页面让他用嘴能说出来的话把数填进来：每个框都写明"这个数去哪看"。
//
// 🔴 三条设计红线：
//   1. **全部选填**，填几个算几个 —— 老板手边通常只有其中几个数，逼他填全等于劝退。
//      填了哪个算哪个，缺的渠道由云端算出来告诉他"还差这几项"。
//   2. 手填的数与 Excel 走**同一个解析器**（云端拼成一行日报表再 parse）⇒ 口径不会分叉。
//   3. 手填的数据**必须标来源**：它不是平台原始凭证，不能当成"已对账"。
const api = require('../../../../utils/api.js');
const ui = require('../../../../utils/ui.js');
const { TERMS } = require('../../../../miniprogram/i18n/terms.js');
const T = TERMS.revenueManual;

// 分组：组标题 + 项。order 决定视觉顺序，也决定"最常用"的放前面。
const GROUPS = [
  {
    key: 'dinein',
    title: T.gDinein,
    hint: T.gDineinHint,
    collapse: false,
    items: [
      { key: 'cash', label: T.fCash, hint: T.hCash, kb: 'digit' },
      { key: 'scan', label: T.fScan, hint: T.hScan, kb: 'digit' },
    ],
  },
  {
    key: 'takeaway',
    title: T.gTakeaway,
    hint: T.gTakeawayHint,
    collapse: false,
    items: [
      { key: 'waimaiMeituan', label: T.fWaimaiMt, hint: T.hWaimaiMt, kb: 'digit' },
      { key: 'waimaiJd', label: T.fWaimaiJd, hint: T.hWaimaiJd, kb: 'digit' },
      { key: 'waimaiTaobao', label: T.fWaimaiTb, hint: T.hWaimaiTb, kb: 'digit' },
    ],
  },
  {
    key: 'groupon',
    title: T.gGroupon,
    hint: T.gGrouponHint,
    collapse: false,
    items: [
      { key: 'grouponMeituan', label: T.fGrouponMt, hint: T.hGrouponMt, kb: 'digit' },
      { key: 'grouponDouyin', label: T.fGrouponDy, hint: T.hGrouponDy, kb: 'digit' },
    ],
  },
  {
    key: 'credit',
    title: T.gCredit,
    hint: T.gCreditHint,
    collapse: true,          // 默认收起：这几项老板常常答不上来，但要让他知道存在
    items: [
      { key: 'recharge', label: T.fRecharge, hint: T.hRecharge, kb: 'digit' },
      { key: 'memberConsume', label: T.fMember, hint: T.hMember, kb: 'digit' },
      { key: 'ledgerNew', label: T.fLedgerNew, hint: T.hLedgerNew, kb: 'digit' },
      { key: 'ledgerRepay', label: T.fLedgerRepay, hint: T.hLedgerRepay, kb: 'digit' },
    ],
  },
];

Page({
  data: {
    month: '',
    groups: [],
    openMap: {},        // 折叠组展开状态
    saving: false,
    t: {
      title: T.title,
      monthLabel: T.monthLabel,
      save: T.save,
      saving: T.saving,
      back: T.back,
      expand: T.expand,
      collapse: T.collapse,
      tip: T.tip,
      note: T.note,
      emptyTip: T.emptyTip,
    },
  },

  onLoad() {
    ui.setTitle(T.title);
    // 默认填上个月（老板通常是月初来记上个月的账）
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const month = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
    this.setData({
      month,
      groups: GROUPS.map((g) => ({
        key: g.key, title: g.title, hint: g.hint, collapse: g.collapse,
        items: g.items.map((it) => ({ key: it.key, label: it.label, hint: it.hint, kb: it.kb, val: '' })),
      })),
      openMap: GROUPS.reduce((m, g) => { m[g.key] = !g.collapse; return m; }, {}),
    });
  },

  onMonthChange(e) {
    this.setData({ month: e.detail.value });
  },

  onToggleGroup(e) {
    const k = e.currentTarget.dataset.key;
    const m = Object.assign({}, this.data.openMap);
    m[k] = !m[k];
    this.setData({ openMap: m });
  },

  onInput(e) {
    const { g, i } = e.currentTarget.dataset;
    const groups = this.data.groups.slice();
    groups[g].items[i].val = e.detail.value;
    this.setData({ groups });
  },

  // 收集成 { cash: '123', scan: '456', ... } —— 只收非空的
  collect() {
    const fields = {};
    this.data.groups.forEach((g) => {
      g.items.forEach((it) => {
        const raw = String(it.val == null ? '' : it.val).trim();
        if (raw !== '' && Number(raw) > 0) fields[it.key] = Number(raw);
      });
    });
    return fields;
  },

  async onSave() {
    if (this.data.saving) return;
    const fields = this.collect();
    if (!Object.keys(fields).length) {
      wx.showModal({ title: T.title, content: T.emptyTip, showCancel: false });
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: T.saving, mask: true });
    try {
      const d = await api.call('importSalesBill', {
        action: 'revenue_save_manual',
        input: { month: this.data.month, fields },
      });
      wx.hideLoading();
      this.setData({ saving: false });
      if (d && d.need_confirm) {
        const df = d.diff || {};
        this.confirmOverwrite(df, fields);
        return;
      }
      const miss = (d && d.missingChannels) || [];
      wx.showModal({
        title: T.savedTitle,
        content: miss.length ? T.savedWithMissing : T.savedOk,
        showCancel: false,
        success: () => wx.navigateBack(),
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ saving: false });
      api.toastError(e);
    }
  },

  confirmOverwrite(df, fields) {
    const money = (v) => (Number(v) || 0).toFixed(2);
    wx.showModal({
      title: T.dupTitle,
      content: [
        '这个月已经有数了。',
        '原来：' + money(df.oldTotalYuan) + ' 元',
        '这份：' + money(df.newTotalYuan) + ' 元',
        '差额：' + (df.totalDeltaYuan >= 0 ? '+' : '') + money(df.totalDeltaYuan) + ' 元',
        '',
        '确认替换？旧版本会保留，以后能查。',
      ].join('\n'),
      confirmText: '换成这份',
      cancelText: '先不动',
      success: (m) => { if (m.confirm) this.recommit(fields); },
    });
  },

  async recommit(fields) {
    this.setData({ saving: true });
    wx.showLoading({ title: T.saving, mask: true });
    try {
      await api.call('importSalesBill', {
        action: 'revenue_save_manual',
        input: { month: this.data.month, fields, confirm: true },
      });
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showModal({
        title: T.savedTitle, content: T.savedOk, showCancel: false,
        success: () => wx.navigateBack(),
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ saving: false });
      api.toastError(e);
    }
  },
});
