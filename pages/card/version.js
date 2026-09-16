// pages/card/version.js —— 批次 4 · M3 成本卡版本历史（只读）
//
// 数据来自 getCardVersions（后端只 INSERT 不 UPDATE 的版本模型，历史版本永不改写）。
// 展示每版：版本号、保存时间、单份成本、配方明细行（含净料单位成本快照）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      title: TERMS.card.versionHistory,
      version: TERMS.card.version,
      totalCost: TERMS.card.totalCost,
      versionCreatedAt: TERMS.card.versionCreatedAt,
      versionCostDiff: TERMS.card.versionCostDiff,
      versionLines: TERMS.card.versionLines,
      versionReadonly: TERMS.card.versionReadonly,
      oldVersionNote: TERMS.card.oldVersionNote,
      price: TERMS.card.price,
      qty: TERMS.card.qty,
      loading: TERMS.ui.loading,
      cur: '¥',
      calcModeA: TERMS.card.calcModeA,
      calcModeB: TERMS.card.calcModeB,
    },
    card_code: '',
    list: [],
    loading: true,
  },

  onLoad(q) {
    const cc = (q && q.card_code) || '';
    this.setData({ card_code: cc });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.versionHistory);
      const d = await api.call('getCardVersions', { card_code: this.data.card_code });
      // ⚠️ 计算下沉：版本差异不在前端算（减法也算金额计算，禁止）。
      //  每版金额均为后端 getCardVersions 返回的分整数，前端仅格式化展示。
      const list = (d.list || []).map((v) => ({
        version: v.version,
        name: v.name || '',
        total_cost: api.fenToYuan(v.total_cost_fen, 2),
        created_at: this.fmtTime(v.created_at),
        calc_mode: v.calc_mode === 'B' ? this.data.t.calcModeB : this.data.t.calcModeA,
        price: v.price_fen > 0 ? api.fenToYuan(v.price_fen, 2) : '—',
        lines: (v.lines || []).map((l) => ({
          material_name: l.material_name || '',
          quantity: l.quantity != null ? String(l.quantity) : '',
          net_unit_cost: l.net_unit_cost != null ? api.fenToYuan(l.net_unit_cost / 100, 4) : '',
          line_net_cost: api.fenToYuan(l.line_net_cost_fen, 2),
        })),
      }));
      this.setData({ list, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});