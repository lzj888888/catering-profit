// pages/card/edit.js —— M3 成本卡新建 / 编辑（另存新版本）+ 反算售价
//
// ⚠️ 计算下沉：本页**不做任何金额/成本/反算计算**。
//   · 保存 → saveCostCard（后端内嵌引擎算 total_cost 落库）
//   · 反算售价 / 预览成本 → calcBom（纯计算云函数，返回 reverse_price_fen / unit_cost_fen）
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

// 明细行空行工厂（不携带 idx，索引唯一性统一由 renumber 维护）
function emptyLine() { return { material_id: '', material_name: '', qty: '' }; }

// 🔴 修复（round123，李老师真机反馈）——`wx:key="idx"` 的唯一性维护。
// 现象：打开**已有多个原料**的菜品后，「添加明细行」/数量栏「输入不进去，一点就被清空或删行」。
// 根因：onLoad 预填时 `.map(() => ({ idx: 0, ... }))` 把**每一行的 idx 都写死成 0**
//   ⇒ wxml 的 `wx:key="idx"` 全部重复（微信告警 `Do not set same key`）
//   ⇒ 列表节点复用错乱：一次 setData 后输入框被错误复用/回写 ⇒ 表现为「输入即丢」。
//   旧 delLine 只 filter、不重排 idx（3 行删 1 行 ⇒ idx 变 0,2；再新增 ⇒ 0,2,2）会再制造重复键。
// 修法：凡改动 lines 的路径，末了都过一遍 renumber，保证 `idx === 数组下标`（唯一且稳定）。
//   业务侧仍以**数组下标**为准（wxml 用 `index` 取 data-idx），idx 字段只服务 wx:key。
function renumber(lines) {
  return lines.map((l, i) => Object.assign({}, l, { idx: i }));
}

Page({
  data: {
    t: {
      dishName: TERMS.card.dishName,
      // round108 修复：菜品名输入框的 placeholder（「如 宫保鸡丁」）此前没映射 ⇒ 取到 undefined ⇒ 空白
      dishNamePh: TERMS.card.dishNamePh,
      calcMode: TERMS.card.calcMode,
      calcModeA: TERMS.card.calcModeA,
      calcModeB: TERMS.card.calcModeB,
      batchOutput: TERMS.card.batchOutput,
      lossRate: TERMS.card.lossRate,
      auxAmount: TERMS.card.auxAmount,
      price: TERMS.card.price,
      material: TERMS.card.material,
      qty: TERMS.card.qty,
      addLine: TERMS.card.addLine,
      save: TERMS.card.save,
      reverseTitle: TERMS.card.reverseTitle,
      reverseHint: TERMS.card.reverseHint,
      targetMargin: TERMS.card.targetMargin,
      reverseResult: TERMS.card.reverseResult,
      totalCost: TERMS.card.totalCost,
      cur: '¥',
      cancel: TERMS.buttons.cancel,
      loading: TERMS.ui.loading,
      copyVersion: TERMS.card.copyVersion,
    },
    card_code: '',
    isEdit: false,
    name: '',
    calcMode: 'A',
    batchOutput: '',
    lossRate: 0,
    auxYuan: 0,
    priceYuan: 0,
    targetMargin: 60,
    reversePriceFen: 0,
    previewCostFen: 0,
    reverseResultPreview: '',
    previewCost: '',
    materials: [],
    lines: [],
    loading: true,
  },

  onLoad(q) {
    this.setData({ card_code: (q && q.card_code) || '', isEdit: !!((q && q.card_code) || '').length > 0 });
    this.load();
  },

  async load() {
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.listTitle);
      const mat = await api.call('getMaterial', {});
      const materials = (mat.list || []).map((m) => ({ id: m.id, name: m.name, is_virtual: m.is_virtual, net_unit_cost: m.net_unit_cost }));
      const init = { materials, loading: false };
      // 编辑：预填最新版本（另存新版本）
      if (this.data.isEdit) {
        const d = await api.call('getCostCard', { card_code: this.data.card_code });
        const c = d.list && d.list[0];
        if (c) {
          init.name = c.name || '';
          init.calcMode = c.calc_mode;
          init.batchOutput = c.batch_output || '';
          init.lossRate = c.loss_rate || 0;
          init.auxYuan = api.fenToYuan(c.aux_fen, 2);
          init.priceYuan = c.price_fen > 0 ? api.fenToYuan(c.price_fen, 2) : '';
          init.lines = renumber((c.lines || []).map((l) => ({ material_id: l.material_id, material_name: l.material_name, qty: String(l.quantity) })));
          init.previewCostFen = c.total_cost_fen || 0;
          init.copyVersion = TERMS.card.copyVersion;
        }
      }
      // 🔴 修复（round123）：非编辑（新增）路径下 init.lines **从未被赋值**（只有 isEdit 分支里才赋）
      //   ⇒ 旧代码 `init.lines.length` 抛 TypeError ⇒ 被外层 catch 吞掉 ⇒ toast「系统异常，请稍后重试」
      //   ⇒ 这正是「点新增菜品就报系统异常」的真凶之一（纯前端、必现、与云端配额配置无关）。
      if (!init.lines || init.lines.length === 0) init.lines = renumber([emptyLine()]);
      this.setData(init);
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onMode(e) { this.setData({ calcMode: e.detail.value }); },
  onBatch(e) { this.setData({ batchOutput: e.detail.value }); },
  onLoss(e) { this.setData({ lossRate: e.detail.value }); },
  onAux(e) { this.setData({ auxYuan: e.detail.value }); },
  onPrice(e) { this.setData({ priceYuan: e.detail.value }); },
  onTargetMargin(e) { this.setData({ targetMargin: e.detail.value }); },

  onMaterialChange(e) {
    const idx = e.currentTarget.dataset.idx;
    const mi = Number(e.detail.value);
    const m = this.data.materials[mi];
    if (!m) return;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { material_id: m.id, material_name: m.name });
    this.setData({ lines });
  },
  onQty(e) {
    const idx = e.currentTarget.dataset.idx;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { qty: e.detail.value });
    this.setData({ lines });
  },
  addLine() {
    // 末尾追加后整体重排 idx，保证「新增行」不会与残留 idx 撞键
    this.setData({ lines: renumber(this.data.lines.concat([emptyLine()])) });
  },
  delLine(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rest = this.data.lines.filter((l, i) => i !== idx);
    // 删中间行会让后续 idx 断号（如 0,2），再新增即撞键 ⇒ 必须重排；删空则保留一行空行
    this.setData({ lines: renumber(rest.length ? rest : [emptyLine()]) });
  },

  // 反算售价 / 预览成本：调 calcBom（后端纯计算），不本地算
  async reverseCalc() {
    const linesInput = this.buildCalcLines();
    if (!linesInput) return;
    try {
      ui.setTitle(TERMS.card.reverseTitle);
      const d = await api.call('calcBom', {
        lines: linesInput,
        mode: this.data.calcMode,
        batch_output: this.data.calcMode === 'B' ? Number(this.data.batchOutput) : 0,
        loss_pct: Number(this.data.lossRate) || 0,
        auxYuan: Number(this.data.auxYuan) || 0,
        target_margin_pct: Number(this.data.targetMargin) || 0,
      });
      const rp = d.reverse_price_fen || 0;
      this.setData({
        reversePriceFen: rp,
        previewCostFen: d.unit_cost_fen || 0,
        reverseResultPreview: rp > 0 ? api.fenToYuan(rp, 2) : '',
        previewCost: d.unit_cost_fen ? api.fenToYuan(d.unit_cost_fen, 2) : '',
      });
      if (rp > 0) {
        wx.showToast({ title: TERMS.card.reverseResult + ' ' + api.fenToYuan(rp, 2), icon: 'none' });
      }
    } catch (e) { api.toastError(e); }
  },

  buildCalcLines() {
    // 由选中的原料 net_unit_cost（万分快照）构 calcBom 入参 lines
    const out = [];
    for (const l of this.data.lines) {
      if (!l.material_id || !l.qty) continue;
      const m = this.data.materials.find((x) => x.id === l.material_id);
      if (!m) continue;
      out.push({ quantity: Number(l.qty), net_unit_cost: m.net_unit_cost });
    }
    if (out.length === 0) { wx.showToast({ title: TERMS.card.qty, icon: 'none' }); return null; }
    return out;
  },

  // 保存 → saveCostCard（后端重算落库；编辑 = 带 card_code 另存新版本）
  async onSave() {
    if (!this.data.name.trim()) { wx.showToast({ title: TERMS.card.dishName, icon: 'none' }); return; }
    const lines = this.data.lines.filter((l) => l.material_id && l.qty);
    if (lines.length === 0) { wx.showToast({ title: TERMS.card.material, icon: 'none' }); return; }
    const card = {
      name: this.data.name.trim(),
      mode: this.data.calcMode,
      lines: lines.map((l) => ({ material_id: l.material_id, qty: Number(l.qty) })),
      loss_pct: Number(this.data.lossRate) || 0,
      auxYuan: Number(this.data.auxYuan) || 0,
      priceYuan: Number(this.data.priceYuan) || 0,
    };
    if (this.data.calcMode === 'B') card.batch_output = Number(this.data.batchOutput) || 0;
    if (this.data.card_code) card.card_code = this.data.card_code; // 编辑 → 另存新版本
    try {
      ui.setTitle(TERMS.buttons.save);
      await api.call('saveCostCard', { card, client_request_id: 'cc_' + Date.now() });
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});