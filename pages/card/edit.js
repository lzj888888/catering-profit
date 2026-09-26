// pages/card/edit.js —— M3 成本卡新建 / 编辑（另存新版本）+ 反算售价 + 批次 P0 补全
//
// ⚠️ 计算下沉：本页**不做任何金额/成本/反算计算**。
//   · 保存 → saveCostCard（后端内嵌引擎算 total_cost 落库）
//   · 反算售价 / 预览成本 → calcBom（纯计算云函数，返回 reverse_price_fen / unit_cost_fen）
// ⚠️ 批次 P0（任务 3）补全：① 明细行临时手工录入（input_type=2，仅本卡生效）；
//   ② 分类 + 标签字段；③ 活动特价（第二条毛利率）；④ 售价低于成本预警；⑤ 反算结果填入建议售价。
//   · 手工行净料单位成本（万分）= round(单价元 × 10000 ÷ (出成率/100))，前端算一次（录入换算），
//     保存传 net_unit_cost 快照、反算传同一值 —— 单源，不做第二份真相源。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

// 明细行空行工厂（档案行）
function emptyLine() { return { input_type: 1, material_id: '', material_name: '', qty: '' }; }
// 手工行工厂
function emptyManualLine() { return { input_type: 2, material_id: '', material_name: '', qty: '', unit_price_yuan: '', yield_rate: '100' }; }

function renumber(lines) {
  return lines.map((l, i) => Object.assign({}, l, { idx: i }));
}

// 手工行净料单位成本（万分）：round(单价元 × 10000 ÷ (出成率/100))
function manualNetUnitWan(unitPriceYuan, yieldRate) {
  const p = Number(unitPriceYuan) || 0;
  const y = Number(yieldRate) || 100;
  if (p <= 0) return 0;
  return Math.round((p * 10000) / (y / 100));
}

Page({
  data: {
    t: {
      dishName: TERMS.card.dishName,
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
      // 批次 P0（任务 3）
      inputType: TERMS.card.inputType,
      inputTypeArchive: TERMS.card.inputTypeArchive,
      inputTypeManual: TERMS.card.inputTypeManual,
      manualName: TERMS.card.manualName,
      manualNamePh: TERMS.card.manualNamePh,
      manualUnitPrice: TERMS.card.manualUnitPrice,
      manualYield: TERMS.card.manualYield,
      activityPrice: TERMS.card.activityPrice,
      activityPriceHint: TERMS.card.activityPriceHint,
      warnPriceBelowCost: TERMS.card.warnPriceBelowCost,
      reverseApply: TERMS.card.reverseApply,
      category: TERMS.card.category,
      tags: TERMS.card.tags,
    },
    card_code: '',
    isEdit: false,
    name: '',
    calcMode: 'A',
    batchOutput: '',
    lossRate: 0,
    auxYuan: 0,
    priceYuan: 0,
    activityPriceYuan: '',
    category: '',
    tags: '',
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
          init.category = c.category || '';
          init.tags = c.tags || '';
          init.lines = renumber((c.lines || []).map((l) => {
            if (l.material_id) {
              return { input_type: 1, material_id: l.material_id, material_name: l.material_name, qty: String(l.quantity) };
            }
            // 手工行（material_id 空）：从快照反推净料单价（元/克），出成率固定 100（快照已是净料）
            const unitPriceYuan = l.net_unit_cost ? (l.net_unit_cost / 10000).toFixed(4) : '';
            return { input_type: 2, material_id: '', material_name: l.material_name, qty: String(l.quantity), unit_price_yuan: unitPriceYuan, yield_rate: '100' };
          }));
          init.previewCostFen = c.total_cost_fen || 0;
          init.copyVersion = TERMS.card.copyVersion;
        }
      }
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
  onActivityPrice(e) { this.setData({ activityPriceYuan: e.detail.value }); },
  onCategory(e) { this.setData({ category: e.detail.value }); },
  onTags(e) { this.setData({ tags: e.detail.value }); },
  onTargetMargin(e) { this.setData({ targetMargin: e.detail.value }); },

  // ===== 明细行 =====
  onMaterialChange(e) {
    const idx = e.currentTarget.dataset.idx;
    const mi = Number(e.detail.value);
    const m = this.data.materials[mi];
    if (!m) return;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { input_type: 1, material_id: m.id, material_name: m.name });
    this.setData({ lines });
  },
  // 切换录入方式（档案 ↔ 手工）
  // 🔴 round129 修复（真机「临时手工录入点不了」根因）：
  //   `radio-group` 的选中值在 `e.detail.value`，而此前读的是 `e.currentTarget.dataset.val`
  //   —— wxml 从未传过 `data-val` ⇒ 恒为 undefined ⇒ 每次都走 else 分支重建为**档案行**，
  //   用户点「临时手工录入」界面毫无变化（看起来就是"点不了"）。
  //   ⚠️ 配套：wxml 的 radio-group 必须带受控 `value`（子 radio 的 checked 仅认初始值）。
  onLineType(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const val = (e && e.detail && e.detail.value) || 'archive';   // 'archive' | 'manual'
    const lines = this.data.lines.slice();
    lines[idx] = val === 'manual' ? emptyManualLine() : emptyLine();
    this.setData({ lines: renumber(lines) });
  },
  // 手工行：名称 / 单价 / 出成率
  onManualName(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { material_name: e.detail.value });
    this.setData({ lines });
  },
  onManualPrice(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { unit_price_yuan: e.detail.value });
    this.setData({ lines });
  },
  onManualYield(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { yield_rate: e.detail.value });
    this.setData({ lines });
  },
  onQty(e) {
    const idx = e.currentTarget.dataset.idx;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { qty: e.detail.value });
    this.setData({ lines });
  },
  addLine() { this.setData({ lines: renumber(this.data.lines.concat([emptyLine()])) }); },
  delLine(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rest = this.data.lines.filter((l, i) => i !== idx);
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

  // 反算结果填入建议售价（用户可再手改）
  applyReverse() {
    if (!this.data.reversePriceFen) { this.reverseCalc(); return; }
    this.setData({ priceYuan: api.fenToYuan(this.data.reversePriceFen, 2) });
  },

  buildCalcLines() {
    const out = [];
    for (const l of this.data.lines) {
      if (!l.qty) continue;
      if (l.input_type === 2) {
        // 手工行：前端算净料单位成本（录入换算），反算与保存用同一值（单源）
        const wan = manualNetUnitWan(l.unit_price_yuan, l.yield_rate);
        if (wan <= 0) continue;
        out.push({ quantity: Number(l.qty), net_unit_cost: wan });
      } else {
        if (!l.material_id) continue;
        const m = this.data.materials.find((x) => x.id === l.material_id);
        if (!m) continue;
        out.push({ quantity: Number(l.qty), net_unit_cost: m.net_unit_cost });
      }
    }
    if (out.length === 0) { wx.showToast({ title: TERMS.card.qty, icon: 'none' }); return null; }
    return out;
  },

  // 保存 → saveCostCard（后端重算落库；编辑 = 带 card_code 另存新版本）
  async onSave() {
    if (!this.data.name.trim()) { wx.showToast({ title: TERMS.card.dishName, icon: 'none' }); return; }
    // 售价低于成本预警（M3.7 #15）：先反算拿成本对比，不阻断保存
    const priceFen = Math.round((Number(this.data.priceYuan) || 0) * 100);
    if (priceFen > 0) {
      const linesInput = this.buildCalcLines();
      if (linesInput) {
        let costFen = 0;
        try {
          const d = await api.call('calcBom', {
            lines: linesInput,
            mode: this.data.calcMode,
            batch_output: this.data.calcMode === 'B' ? Number(this.data.batchOutput) : 0,
            loss_pct: Number(this.data.lossRate) || 0,
            auxYuan: Number(this.data.auxYuan) || 0,
            target_margin_pct: 0,
          });
          costFen = d.unit_cost_fen || 0;
        } catch (e) { /* 预警失败不阻断 */ }
        if (costFen > 0 && priceFen < costFen) {
          wx.showModal({
            title: TERMS.card.warnPriceBelowCost,
            content: TERMS.card.warnPriceBelowCost,
            confirmColor: '#e74c3c',
            cancelText: TERMS.buttons.cancel,
            success: (r) => { if (r.confirm) this.doSave(); },
          });
          return;
        }
      }
    }
    this.doSave();
  },

  async doSave() {
    const lines = [];
    for (const l of this.data.lines) {
      if (!l.qty) continue;
      if (l.input_type === 2) {
        const wan = manualNetUnitWan(l.unit_price_yuan, l.yield_rate);
        if (wan <= 0) { wx.showToast({ title: TERMS.card.manualUnitPrice, icon: 'none' }); return; }
        lines.push({ input_type: 2, name: (l.material_name || '').trim(), qty: Number(l.qty), net_unit_cost: wan });
      } else {
        if (!l.material_id) continue;
        lines.push({ material_id: l.material_id, qty: Number(l.qty) });
      }
    }
    if (lines.length === 0) { wx.showToast({ title: TERMS.card.material, icon: 'none' }); return; }
    const card = {
      name: this.data.name.trim(),
      mode: this.data.calcMode,
      lines,
      loss_pct: Number(this.data.lossRate) || 0,
      auxYuan: Number(this.data.auxYuan) || 0,
      priceYuan: Number(this.data.priceYuan) || 0,
      category: this.data.category,
      tags: this.data.tags,
      activity_price_yuan: Number(this.data.activityPriceYuan) || 0,
    };
    if (this.data.calcMode === 'B') card.batch_output = Number(this.data.batchOutput) || 0;
    if (this.data.card_code) card.card_code = this.data.card_code;
    try {
      ui.setTitle(TERMS.buttons.save);
      await api.call('saveCostCard', { card, client_request_id: 'cc_' + Date.now() });
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
