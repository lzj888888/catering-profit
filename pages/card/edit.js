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
const units = require('../../utils/units.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

// 本店填过的菜品分类（本地记忆，供下次点选；不新建集合、不上云 —— M3 v1.1 零新建集合红线）
const EDIT_CATS_KEY = 'm3_dish_cats';

// 明细行空行工厂（档案行）
// round149：新增 `qty_unit`（用量单位，枚举见 utils/units.js）+ `spec_hint`（该原料的换算说明）。
//   两者都是**本页展示/录入层**的东西 —— 提交给云端时 qty 一律换算成基准单位(克)，
//   ⚠️ 不新增云函数字段、不改快照契约、不碰引擎（红线段）。
function emptyLine() { return { input_type: 1, material_id: '', material_name: '', qty: '', qty_unit: units.BASE_UNIT, spec_hint: '' }; }
// 手工行工厂
function emptyManualLine() { return { input_type: 2, material_id: '', material_name: '', qty: '', qty_unit: units.BASE_UNIT, spec_hint: '', unit_price_yuan: '', yield_rate: '100' }; }

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
      categoryPh: TERMS.card.categoryPh,
      categoryHint: TERMS.card.categoryHint,
      tagsPh: TERMS.card.tagsPh,
      tagsHint: TERMS.card.tagsHint,
      materialArchive: TERMS.card.materialListTitle,
      tags: TERMS.card.tags,
      qtyUnit: TERMS.card.qtyUnit,
      qtyUnitHint: TERMS.card.qtyUnitHint,
      matSpecHintEmpty: TERMS.card.matSpecHintEmpty,
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
    // 分类是**自由文本**（v1.0 §菜品分类 明写"支持自定义"）；下列只是冷启动建议 + 本店历史。
    // 组件已从 picker 改为「input + chips」（picker 只能选预设，火锅的锅底/荤菜/素菜、营销栏目
    // "大口吃肉"这类根本选不出来）。categoryOptions 保留变量名为兼容既有引用，语义=建议池。
    categoryOptions: TERMS.card.dishCats.slice(),
    catChips: [],
    tags: '',
    targetMargin: 60,
    reversePriceFen: 0,
    previewCostFen: 0,
    reverseResultPreview: '',
    previewCost: '',
    materials: [],
    // 用量单位枚举（单源 utils/units.js；基准单位恒为克）
    qtyUnits: units.QTY_UNITS.slice(),
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
      // round149：把「买」的那一侧也带进来（采购单位/换算系数/出成率/采购价），
      //   好让老板在明细行直接看见「36 元/斤 ÷ 500 ÷ 92% ⇒ 0.0783 元/克」，不用去档案页心算。
      const materials = (mat.list || []).map((m) => ({
        id: m.id,
        name: m.name,
        is_virtual: m.is_virtual,
        net_unit_cost: m.net_unit_cost,
        purchase_unit: m.purchase_unit || '',
        purchase_price_fen: m.purchase_price_fen || 0,
        convert_factor: m.convert_factor || 0,
        yield_rate: m.yield_rate || 0,
      }));
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
          // ⚠️ 回填的单位口径：库里存的 quantity **恒为基准单位(克)**（round149 起前端提交前已换算），
          //   故回填一律按「克」显示 —— 这是**确定**的，不做"猜你原来填的是千克"（猜错会显示错数）。
          init.lines = renumber((c.lines || []).map((l) => {
            if (l.material_id) {
              return { input_type: 1, material_id: l.material_id, material_name: l.material_name, qty: String(l.quantity), qty_unit: units.BASE_UNIT };
            }
            // 手工行（material_id 空）：从快照反推净料单价（元/克），出成率固定 100（快照已是净料）
            const unitPriceYuan = l.net_unit_cost ? (l.net_unit_cost / 10000).toFixed(4) : '';
            return { input_type: 2, material_id: '', material_name: l.material_name, qty: String(l.quantity), qty_unit: units.BASE_UNIT, unit_price_yuan: unitPriceYuan, yield_rate: '100' };
          }));
          init.previewCostFen = c.total_cost_fen || 0;
          init.copyVersion = TERMS.card.copyVersion;
        }
      }
      if (!init.lines || init.lines.length === 0) init.lines = renumber([emptyLine()]);
      // 分类回显：自由文本，直接回显；候选 chips = 本店填过的 + 建议池（不再做"补进枚举"）
      init.catChips = this.buildCatChips(init.category);
      this.setData(init);
      // 明细行的原料换算说明（须在 setData(materials) 之后算，否则找不到原料）
      this.refreshSpecHints();
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
  onCategoryInput(e) { this.setData({ category: e.detail.value }); },
  pickCat(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!ds.cat) return;
    this.setData({ category: ds.cat });
  },
  // 候选分类 = 当前值 + **本店填过的**（记住即复用，火锅店不会每次重打"锅底"）+ 建议池补齐。
  // 上限 14：再多会刷屏，且老板实际用的分类就那么几个。
  buildCatChips(cur) {
    const seen = [];
    const push = (v) => {
      const s = String(v == null ? '' : v).trim();
      if (s && seen.indexOf(s) < 0) seen.push(s);
    };
    push(cur);
    let hist = [];
    try { hist = wx.getStorageSync(EDIT_CATS_KEY) || []; } catch (err) { hist = []; }
    if (Array.isArray(hist)) hist.forEach(push);
    (this.data.categoryOptions || TERMS.card.dishCats).forEach(push);
    return seen.slice(0, 14);
  },
  onTags(e) { this.setData({ tags: e.detail.value }); },
  onTargetMargin(e) { this.setData({ targetMargin: e.detail.value }); },
  // 真机反馈：改第 N 道菜的原料必须回列表页最顶部 ⇒ 编辑页给直达入口
  goMaterial() { wx.navigateTo({ url: '/pages/material/index' }); },

  // ===== round149：用量单位 / 原料换算说明 =====
  // 单条原料的换算说明：采购价 ÷ 换算系数 ÷ 出成率 ⇒ 净料单价（元/克）。
  //   这几步都是**原料档案里已存的**，此处只做展示串联，不重算成本、不改任何落库值。
  specHintOf(m) {
    const f = Number(m.convert_factor) || 0;
    const yr = Number(m.yield_rate) || 0;
    if (!m || !f || !yr) return TERMS.card.matSpecHintEmpty;
    return TERMS.card.matSpecHintOf(
      api.fenToYuan(m.purchase_price_fen || 0, 2),
      m.purchase_unit || TERMS.card.matUnitDefault,
      f, yr,
      ((Number(m.net_unit_cost) || 0) / 10000).toFixed(4)
    );
  },
  refreshSpecHints(lines) {
    const src = lines || this.data.lines;
    const mats = this.data.materials || [];
    const out = src.map((l) => {
      if (l.input_type === 2) return Object.assign({}, l, { spec_hint: '' });
      const m = l.material_id ? mats.find((x) => x.id === l.material_id) : null;
      return Object.assign({}, l, { spec_hint: m ? this.specHintOf(m) : TERMS.card.matSpecHintEmpty });
    });
    this.setData({ lines: out });
  },
  // 换用量单位：**必须同步换算数值**（1000 克 → 1 千克），否则同一个菜换个单位成本差 1000 倍。
  //   ⚠️ 这是本页最容易写错的一格，守卫 tools/check_unit_convert.js 专盯「只改标签不改数」。
  onQtyUnit(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const next = this.data.qtyUnits[Number(e.detail.value)] || units.BASE_UNIT;
    const lines = this.data.lines.slice();
    const cur = lines[idx] || {};
    const from = cur.qty_unit || units.BASE_UNIT;
    if (from === next) return;
    lines[idx] = Object.assign({}, cur, { qty_unit: next, qty: units.convertQtyText(cur.qty, from, next) });
    this.setData({ lines: renumber(lines) });
  },

  // ===== 明细行 =====
  onMaterialChange(e) {
    const idx = e.currentTarget.dataset.idx;
    const mi = Number(e.detail.value);
    const m = this.data.materials[mi];
    if (!m) return;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], {
      input_type: 1,
      material_id: m.id,
      material_name: m.name,
      spec_hint: this.specHintOf(m),
    });
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
      // round149：用量一律换算成**基准单位(克)**再送引擎（引擎口径一字不改）
      const qtyBase = units.toBase(l.qty, l.qty_unit);
      if (!(qtyBase > 0)) continue;
      if (l.input_type === 2) {
        // 手工行：前端算净料单位成本（录入换算），反算与保存用同一值（单源）
        const wan = manualNetUnitWan(l.unit_price_yuan, l.yield_rate);
        if (wan <= 0) continue;
        out.push({ quantity: qtyBase, net_unit_cost: wan });
      } else {
        if (!l.material_id) continue;
        const m = this.data.materials.find((x) => x.id === l.material_id);
        if (!m) continue;
        out.push({ quantity: qtyBase, net_unit_cost: m.net_unit_cost });
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
      // round149：同 buildCalcLines —— 提交前换算到基准单位(克)，云端契约与引擎零改动
      const qtyBase = units.toBase(l.qty, l.qty_unit);
      if (!(qtyBase > 0)) continue;
      if (l.input_type === 2) {
        const wan = manualNetUnitWan(l.unit_price_yuan, l.yield_rate);
        if (wan <= 0) { wx.showToast({ title: TERMS.card.manualUnitPrice, icon: 'none' }); return; }
        lines.push({ input_type: 2, name: (l.material_name || '').trim(), qty: qtyBase, net_unit_cost: wan });
      } else {
        if (!l.material_id) continue;
        lines.push({ material_id: l.material_id, qty: qtyBase });
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
    // 分类归一化：只 trim（去首尾空格）。⚠️ 不做"折叠中间空格/同义词归并"——
    //   老板填"大口吃肉"是有意的营销栏目名，程序替他改字会造成"我明明填了却变了"。
    card.category = String(this.data.category || '').trim();
    if (card.category) {
      try {
        const hist = wx.getStorageSync(EDIT_CATS_KEY) || [];
        const arr = Array.isArray(hist) ? hist.slice() : [];
        if (arr.indexOf(card.category) < 0) arr.push(card.category);
        wx.setStorageSync(EDIT_CATS_KEY, arr.slice(-40));
      } catch (err) { /* 本地字典失败不影响保存 */ }
    }
    try {
      ui.setTitle(TERMS.buttons.save);
      await api.call('saveCostCard', { card, client_request_id: 'cc_' + Date.now() });
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
