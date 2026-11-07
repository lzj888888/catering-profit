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

// 千分位：老板看「3,200.00」比「3200.00」快
const money = (v) => (Number(v) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// 上一个月（不要用 setMonth 直接减：1 月会减成「0 月」）
const prevMonth = (m) => {
  const y = Number(String(m).slice(0, 4));
  const mo = Number(String(m).slice(5, 7));
  const d = new Date(y, mo - 2, 1);
  const mm = d.getMonth() + 1;
  return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm;
};

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
    baseMode: '',       // '' | 'prefill'（本月已填，预填现值）| 'ref'（拿上月当灰字参考）
    baseTip: '',
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
        items: g.items.map((it) => ({ key: it.key, label: it.label, hint: it.hint, kb: it.kb, val: '', ph: '' })),
      })),
      openMap: GROUPS.reduce((m, g) => { m[g.key] = !g.collapse; return m; }, {}),
    });
    this.loadBase(month);
  },

  // 填表能力弱的人最缺的不是"框"，是"上次填了多少"和"这次填的对不对"。
  // 这里做两件事：
  //   ① 本月已填过 ⇒ **把存着的值预填回来**（他要改的是现值，不是重新回忆一遍）
  //   ② 本月没填过 ⇒ 拿上个月的数当灰色提示（照抄改数，比凭空填容易一个量级）
  // 拿不到就静默 —— 参考值只是帮忙，不能因为取不到就挡住他填数。
  async loadBase(month) {
    const setItems = (fields, mode) => {
      const groups = this.data.groups.map((g) => Object.assign({}, g, {
        items: g.items.map((it) => Object.assign({}, it, mode === 'prefill'
          ? { val: (fields[it.key] != null ? String(fields[it.key]) : '') }
          : { ph: (Number(fields[it.key]) > 0 ? (T.refPh + money(fields[it.key])) : '') })),
      }));
      this.setData({ groups, baseMode: mode, baseTip: mode === 'prefill' ? T.preTip : T.refTip });
    };
    try {
      const got = await api.call('importSalesBill', { action: 'revenue_get', month });
      const rs = got && got.revenue_stored;
      if (rs && rs.source === 'manual' && rs.manual_fields) {
        setItems(rs.manual_fields, 'prefill');
        return;
      }
      const prev = prevMonth(month);
      const g2 = await api.call('importSalesBill', { action: 'revenue_get', month: prev });
      const rs2 = g2 && g2.revenue_stored;
      if (rs2 && rs2.source === 'manual' && rs2.manual_fields) {
        setItems(rs2.manual_fields, 'ref');
        return;
      }
    } catch (e) {
      // 参考值取不到不算错
    }
    this.setData({ baseMode: '', baseTip: '' });
  },

  onMonthChange(e) {
    const month = e.detail.value;
    // 换月必须清掉上一个月残留的预填/参考，否则会把 9 月的数当成 10 月的（串月是最难发现的错）
    const groups = this.data.groups.map((g) => Object.assign({}, g, {
      items: g.items.map((it) => Object.assign({}, it, { val: '', ph: '' })),
    }));
    this.setData({ month, groups, baseMode: '', baseTip: '' });
    this.loadBase(month);
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
        // 🔴 明确填 0 也要送出去：老板要「把这项清零」时得有路可走。
        //   空着 = 没填（分次填时沿用上次），填 0 = 就是 0（覆盖上次）。
        if (raw !== '' && isFinite(Number(raw))) fields[it.key] = Number(raw);
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
      // 填完必须当场告诉他"记下了多少" —— 只弹"存好了"，他还是不知道自己填对没填对
      const tot = (d && d.revenue_manual && d.revenue_manual.revenueM1
        && d.revenue_manual.revenueM1.totalYuan) || 0;
      const mg = (d && d.merged) || {};
      const lines = [T.savedTotalTpl.replace('{x}', money(tot))];
      if (mg.kept > 0) lines.push(T.mergedTpl.replace('{a}', mg.added).replace('{k}', mg.kept));
      lines.push(miss.length ? T.savedWithMissing : T.savedOk);
      wx.showModal({
        title: T.savedTitle,
        content: lines.join('\n'),
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
