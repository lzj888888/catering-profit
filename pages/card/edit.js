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
// round150：新增 `line_kind`（组件类型，M3.14）—— 它**要**上云（是规格缩放的唯一依据）。
function emptyLine() { return { input_type: 1, material_id: '', material_name: '', qty: '', qty_unit: units.BASE_UNIT, spec_hint: '', line_kind: 'main' }; }
// 手工行工厂
// round151：新增 `price_unit`（**单价单位**，读作「元/X」）。改前单价恒被读作「元/克」——
//   老板买 6 元/斤的肉，得自己心算成 0.012 才敢填。现在选「斤」直接填 6，
//   提交前由 `units.priceToBase` 折算回元/克（折算只发生在录入层）。
function emptyManualLine() { return { input_type: 2, material_id: '', material_name: '', qty: '', qty_unit: units.BASE_UNIT, price_unit: units.BASE_UNIT, spec_hint: '', unit_warn: '', unit_price_yuan: '', yield_rate: '100', line_kind: 'main' }; }

function renumber(lines) {
  return lines.map((l, i) => Object.assign({}, l, { idx: i }));
}

// 手工行净料单位成本（万分）：round(单价元/基准单位 × 10000 ÷ (出成率/100))
//   round151：加第三参 `priceUnit` —— 单价先折算到基准单位（元/克）再进这条**既有公式**。
//   ⚠️ 公式本体一字不改（引擎口径）；折算只发生在录入层，云端契约与快照格式零改动。
function manualNetUnitWan(unitPriceYuan, yieldRate, priceUnit) {
  const p = units.priceToBase(unitPriceYuan, priceUnit || units.BASE_UNIT);
  const y = Number(yieldRate) || 100;
  if (!(p > 0)) return 0;
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
      // round150（M3.14/M3.15）
      lineKindTitle: TERMS.card.lineKindTitle,
      lineKindHint: TERMS.card.lineKindHint,
      specTitle: TERMS.card.specTitle,
      specHint: TERMS.card.specHint,
      specEnable: TERMS.card.specEnable,
      specPriceLabel: TERMS.card.specPriceLabel,
      specCostLabel: TERMS.card.specCostLabel,
      specMarginLabel: TERMS.card.specMarginLabel,
      specSuggestLabel: TERMS.card.specSuggestLabel,
      specCalc: TERMS.card.specCalc,
      specEmpty: TERMS.card.specEmpty,
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
    // 用量单位枚举（单源 utils/units.js；round151 起 = 与采购单位同池，基准单位仍恒为克）
    qtyUnits: units.QTY_UNITS.slice(),
    // round151：单价单位枚举 —— 与用量单位同池（老板按什么单位报的价，就该能选什么）
    priceUnits: units.QTY_UNITS.slice(),
    // round150（M3.14）组件类型 chips：**只有键 + 中文名**，键集 ≡ 服务端 LINE_KINDS。
    kindChips: Object.keys(TERMS.card.lineKind).map((k) => ({ key: k, label: TERMS.card.lineKind[k] })),
    // round150（M3.15）规格行：**只有键 + 中文名**（系数单源在服务端 ⇒ 页面只送 spec_key + 售价）。
    specRows: Object.keys(TERMS.card.specLabel).map((k) => ({ spec_key: k, name: TERMS.card.specLabel[k], enabled: false, priceYuan: '', result: null })),
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
              return { input_type: 1, material_id: l.material_id, material_name: l.material_name, qty: String(l.quantity), qty_unit: units.BASE_UNIT, line_kind: l.line_kind || 'main' };
            }
            // 手工行（material_id 空）：从快照反推净料单价（元/克），出成率固定 100（快照已是净料）
            const unitPriceYuan = l.net_unit_cost ? (l.net_unit_cost / 10000).toFixed(4) : '';
            return { input_type: 2, material_id: '', material_name: l.material_name, qty: String(l.quantity), qty_unit: units.BASE_UNIT, unit_price_yuan: unitPriceYuan, yield_rate: '100', line_kind: l.line_kind || 'main' };
          }));
          // round150：规格快照回填（specs_json ⇒ 数组）。存量卡无此字段 ⇒ []。
          init.specRows = this.data.specRows.map((r) => {
            const hit = (c.specs || []).find((s) => s && s.spec_key === r.spec_key);
            if (!hit) return r;
            return Object.assign({}, r, {
              enabled: hit.enabled !== false,
              name: hit.name || r.name,
              priceYuan: hit.price_fen > 0 ? api.fenToYuan(hit.price_fen, 2) : '',
            });
          });
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
      if (l.input_type === 2) return Object.assign({}, l, { spec_hint: '', unit_warn: '' });
      const m = l.material_id ? mats.find((x) => x.id === l.material_id) : null;
      return Object.assign({}, l, {
        spec_hint: m ? this.specHintOf(m) : TERMS.card.matSpecHintEmpty,
        unit_warn: m ? this.unitWarnOf(m, l) : '',
      });
    });
    this.setData({ lines: out });
  },
  // round151：跨计量族提示（**只提示、不拦截**）。
  //   由来：参考产品在这里栽过 —— 采购单位选「个」、用量单位选「千克」，它静默按 1:1 硬算，
  //   界面直接跳出 ¥6,000,000.00，**一个字都不提示**（2026-09-26 键鼠实测）。
  //   规则：只有「计数族 ↔ 计量族」才算跨族。重量↔体积**不算** —— 既有口径就是 1 毫升≈1 克
  //   （水/油/酱油密度≈1），那是**有意支持**的换算，不该报警。
  unitWarnOf(m, l) {
    const pu = m.purchase_unit || TERMS.card.matUnitDefault;
    const qu = l.qty_unit || units.BASE_UNIT;
    return units.isCrossFamily(pu, qu) ? TERMS.card.unitCrossWarn(pu, qu) : '';
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
    // round151：跨族提示是「用量单位 × 原料采购单位」的函数 ⇒ 换完单位必须重算，
    //   否则提示停在换单位之前的状态（用户看到的是过期提示）。
    this.refreshSpecHints(this.data.lines);
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
      // round151：换原料 ⇒ 跨族提示要跟着换（提示取决于该原料的采购单位）
      unit_warn: this.unitWarnOf(m, lines[idx]),
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
  // round151：手工行的**单价单位**（元/X）。
  //   ⚠️ 与「用量单位」是两件事，且**故意不做数值换算**（与 onQtyUnit 相反）：
  //     用量单位变了必须换数（否则同一个菜成本差 1000 倍）；单价单位变了则是
  //     「我报的价本来就按这个单位」—— 老板要的是保住他敲的那个数字
  //     （6 元/斤 改成 6 元/千克 = 我报的就是 6，别替我算成 12）。
  onManualPriceUnit(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const next = this.data.priceUnits[Number(e.detail.value)] || units.BASE_UNIT;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { price_unit: next });
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
        const wan = manualNetUnitWan(l.unit_price_yuan, l.yield_rate, l.price_unit);
        if (wan <= 0) continue;
        out.push({ quantity: qtyBase, net_unit_cost: wan, line_kind: l.line_kind || 'main' });
      } else {
        if (!l.material_id) continue;
        const m = this.data.materials.find((x) => x.id === l.material_id);
        if (!m) continue;
        out.push({ quantity: qtyBase, net_unit_cost: m.net_unit_cost, line_kind: l.line_kind || 'main' });
      }
    }
    if (out.length === 0) { wx.showToast({ title: TERMS.card.qty, icon: 'none' }); return null; }
    return out;
  },

  // ===== round150（M3.14）组件类型 =====
  pickKind(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const key = e.currentTarget.dataset.kind;
    if (!key) return;
    const lines = this.data.lines.slice();
    lines[idx] = Object.assign({}, lines[idx], { line_kind: key });
    this.setData({ lines });
  },

  // ===== round150（M3.15）规格 =====
  toggleSpec(e) {
    const key = e.currentTarget.dataset.spec;
    this.setData({
      specRows: this.data.specRows.map((r) => (r.spec_key === key ? Object.assign({}, r, { enabled: !r.enabled, result: r.enabled ? null : r.result }) : r)),
    });
  },
  onSpecPrice(e) {
    const key = e.currentTarget.dataset.spec;
    const v = e.detail.value;
    this.setData({
      specRows: this.data.specRows.map((r) => (r.spec_key === key ? Object.assign({}, r, { priceYuan: v }) : r)),
    });
  },
  // 把某规格行的输入拼成 spec_prices（整数分）；空/非法 ⇒ 该规格不带价（只出成本与建议价）
  specPriceFen(r) {
    const yuan = Number(r.priceYuan);
    if (!isFinite(yuan) || yuan <= 0) return null;
    return Math.round(yuan * 100);
  },
  // 提交给云端的规格列表：**只送键 + 售价**（系数/名称由服务端单源补齐）
  collectSpecs() {
    return this.data.specRows
      .filter((r) => r.enabled)
      .map((r) => {
        const pf = this.specPriceFen(r);
        return pf == null ? { spec_key: r.spec_key } : { spec_key: r.spec_key, price_fen: pf };
      });
  },
  // 规格试算：一次调用把启用的规格全部算回来（成本 / 毛利率 / 建议价），并刷新原成本预览
  async calcSpecs() {
    const linesInput = this.buildCalcLines();
    if (!linesInput) return;
    const rows = this.data.specRows.filter((r) => r.enabled);
    if (rows.length === 0) { wx.showToast({ title: TERMS.card.specEmpty, icon: 'none' }); return; }
    const specPrices = {};
    for (const r of rows) {
      const pf = this.specPriceFen(r);
      if (pf != null) specPrices[r.spec_key] = pf;
    }
    try {
      ui.setTitle(TERMS.card.specCalc);
      const d = await api.call('calcBom', {
        lines: linesInput,
        mode: this.data.calcMode,
        batch_output: this.data.calcMode === 'B' ? Number(this.data.batchOutput) : 0,
        loss_pct: Number(this.data.lossRate) || 0,
        auxYuan: Number(this.data.auxYuan) || 0,
        target_margin_pct: Number(this.data.targetMargin) || 0,
        spec_keys: rows.map((r) => r.spec_key),
        spec_prices: specPrices,
      });
      const byKey = {};
      for (const s of (d.spec_results || [])) {
        // 出参 → 展示字段（页面零计算：元/百分号都在这里格式化，wxml 只摆位）
        byKey[s.spec_key] = {
          spec_key: s.spec_key,
          name: s.name,
          coef: s.coef,
          price_fen: s.price_fen,
          unit_cost_fen: s.unit_cost_fen,
          costYuan: api.fenToYuan(s.unit_cost_fen || 0, 2),
          marginPct: s.gross_margin_pct,
          suggestYuan: s.reverse_price_fen > 0 ? api.fenToYuan(s.reverse_price_fen, 2) : '',
        };
      }
      this.setData({
        previewCostFen: d.unit_cost_fen || 0,
        previewCost: d.unit_cost_fen ? api.fenToYuan(d.unit_cost_fen, 2) : '',
        specRows: this.data.specRows.map((r) => (r.enabled && byKey[r.spec_key] ? Object.assign({}, r, { result: byKey[r.spec_key] }) : r)),
      });
    } catch (e) { api.toastError(e); }
  },
  // 用「按目标毛利率的建议价」回填该规格售价（老板可再手改）
  useSpecSuggest(e) {
    const key = e.currentTarget.dataset.spec;
    this.setData({
      specRows: this.data.specRows.map((r) => {
        if (r.spec_key !== key || !r.result || !(r.result.reverse_price_fen > 0)) return r;
        return Object.assign({}, r, { priceYuan: api.fenToYuan(r.result.reverse_price_fen, 2) });
      }),
    });
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
      // round150：组件类型随行上云（规格缩放的唯一依据）；缺省 main（服务端同样兜底）
      const kind = l.line_kind || 'main';
      if (l.input_type === 2) {
        const wan = manualNetUnitWan(l.unit_price_yuan, l.yield_rate, l.price_unit);
        if (wan <= 0) { wx.showToast({ title: TERMS.card.manualUnitPrice, icon: 'none' }); return; }
        lines.push({ input_type: 2, name: (l.material_name || '').trim(), qty: qtyBase, net_unit_cost: wan, line_kind: kind });
      } else {
        if (!l.material_id) continue;
        lines.push({ material_id: l.material_id, qty: qtyBase, line_kind: kind });
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
      // round150：规格只送 **键 + 售价**（系数与可读名由服务端单源补齐并**快照**落库）
      specs: this.collectSpecs(),
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
