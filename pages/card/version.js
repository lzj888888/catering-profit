// pages/card/version.js —— 批次 4 / 批次 S0 · M3 成本卡版本历史 + 恢复入口
//
// 数据来自 getCardVersions（后端只 INSERT 不 UPDATE 的版本模型，历史版本永不改写）。
// 展示每版：版本号、保存时间、单份成本、配方明细行（含净料单位成本快照 + 5 字段快照）。
// S0（任务 2）：每个版本加「恢复此版本」—— 恢复 = 把历史版本数据 INSERT 成新版本（复用 saveCostCard），
//   旧版本原样保留（只 INSERT 不 UPDATE；最新 = card_code 下 version 最大者，不用 is_latest）。
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
      cancel: TERMS.buttons.cancel,
      // S0（任务 2）
      restoreVersion: TERMS.card.restoreVersion,
      restoreVersionConfirm: TERMS.card.restoreVersionConfirm,
      restoreDone: TERMS.card.restoreDone,
      snapshotBrand: TERMS.card.snapshotBrand,
      snapshotUnit: TERMS.card.snapshotUnit,
      snapshotPrice: TERMS.card.snapshotPrice,
      snapshotConvert: TERMS.card.snapshotConvert,
      snapshotYield: TERMS.card.snapshotYield,
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
      // S0：保留恢复所需原始字段（name/mode/loss/aux/price/category/tags/promo/lines 原始 material_id+net_unit_cost）。
      const list = (d.list || []).map((v) => ({
        version: v.version,
        name: v.name || '',
        total_cost: api.fenToYuan(v.total_cost_fen, 2),
        created_at: this.fmtTime(v.created_at),
        calc_mode: v.calc_mode === 'B' ? this.data.t.calcModeB : this.data.t.calcModeA,
        calc_mode_key: v.calc_mode || 'A',
        price: v.price_fen > 0 ? api.fenToYuan(v.price_fen, 2) : '—',
        // 恢复用原始字段
        loss_rate: v.loss_rate || 0,
        aux_fen: v.aux_fen || 0,
        price_fen: v.price_fen || 0,
        price_promo_fen: v.price_promo_fen || 0,
        category: v.category || '',
        tags: v.tags || '',
        batch_output: v.batch_output || 0,
        lines: (v.lines || []).map((l) => ({
          material_id: l.material_id || '',
          material_name: l.material_name || '',
          quantity: l.quantity != null ? String(l.quantity) : '',
          net_unit_cost: l.net_unit_cost != null ? l.net_unit_cost : 0,
          line_net_cost: api.fenToYuan(l.line_net_cost_fen, 2),
          // S0 快照 5 字段（灰字展示）
          brand_spec: l.brand_spec || '',
          purchase_unit: l.purchase_unit || '',
          purchase_price: l.purchase_price != null ? api.fenToYuan(l.purchase_price, 2) : '',
          convert_factor: l.convert_factor != null ? String(l.convert_factor) : '',
          yield_rate: l.yield_rate != null ? String(l.yield_rate) : '',
        })),
      }));
      this.setData({ list, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // S0（任务 2）恢复此版本：二次确认 → 复用 saveCostCard 生成新版本
  onRestore(e) {
    const v = e.currentTarget.dataset.v;
    wx.showModal({
      title: TERMS.card.restoreVersion,
      content: TERMS.card.restoreVersionConfirm,
      confirmColor: '#1e3a5f',
      cancelText: TERMS.buttons.cancel,
      success: async (r) => {
        if (!r.confirm) return;
        await this.doRestore(v);
      },
    });
  },

  async doRestore(v) {
    // 明细行：material_id 非空 = 档案行；空 = 手工行（快照直传 net_unit_cost，validate 认）
    const lines = (v.lines || []).map((l) => {
      if (l.material_id) return { material_id: l.material_id, qty: Number(l.quantity) || 0 };
      return { input_type: 2, name: l.material_name || '', qty: Number(l.quantity) || 0, net_unit_cost: l.net_unit_cost };
    });
    if (lines.length === 0) { wx.showToast({ title: TERMS.card.versionLines, icon: 'none' }); return; }
    const card = {
      name: v.name || '',
      mode: v.calc_mode_key,
      lines,
      loss_pct: v.loss_rate || 0,
      aux_fen: v.aux_fen || 0,
      price_fen: v.price_fen || 0,
      activity_price_fen: v.price_promo_fen || 0,
      category: v.category,
      tags: v.tags,
      card_code: this.data.card_code,   // 带 card_code → saveCostCard 生成新版本
    };
    if (v.calc_mode_key === 'B') card.batch_output = v.batch_output || 0;
    try {
      wx.showLoading({ title: TERMS.card.restoring, mask: true });
      await api.call('saveCostCard', { card, client_request_id: 'rc_' + Date.now() });
      wx.hideLoading();
      wx.showToast({ title: TERMS.card.restoreDone, icon: 'success' });
      this.load();
    } catch (err) { wx.hideLoading(); api.toastError(err); }
  },

  fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
