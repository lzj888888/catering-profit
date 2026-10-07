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
const { openPaywall } = require('../../utils/paywall.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const { TEMPLATES, applyTemplate } = require('../../utils/dishTemplates.js');   // M3.20 菜品模板（只预填，不写库）
const { calcGrouponOrder } = require('../../utils/grouponDerive.js');            // M3.37 团购渠道层（纯计算，不落库）

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

// round156：规格行的「全新空态」工厂。抽成函数是为了让 data 初始化与「连续录入重置」共用**同一份**定义
//   —— 否则第二处手抄一遍，将来加一个规格键就会漏掉一处（抄一份必漂）。
function freshSpecRows() {
  return Object.keys(TERMS.card.specLabel).map((k) => ({ spec_key: k, name: TERMS.card.specLabel[k], enabled: false, priceYuan: '', result: null }));
}

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
      // round153：删行按钮文案（挪到明细行末尾后的新语义）
      delLine: TERMS.card.delLine,
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
      // M3v1.2_B（D21/M3.31）：每 100g 计价规格（展示单位 + 口径说明）
      specPer100gUnit: TERMS.card.specPer100gUnit,
      specPer100gNote: TERMS.card.specPer100gNote,
      // round156：连续录入横幅
      savedOk: TERMS.card.savedOk,
      savedHint: TERMS.card.savedHint,
      backToList: TERMS.card.backToList,
      // M3.16（批次 C）套餐
      cardTypeLabel: TERMS.card.cardType,
      cardTypeDish: TERMS.card.cardTypeDish,
      cardTypeCombo: TERMS.card.cardTypeCombo,
      cardTypeHint: TERMS.card.cardTypeHint,
      comboSubCardTitle: TERMS.card.comboSubCardTitle,
      comboSubCardPh: TERMS.card.comboSubCardPh,
      comboSubCardQty: TERMS.card.comboSubCardQty,
      comboAddSubCard: TERMS.card.comboAddSubCard,
      comboPickEmpty: TERMS.card.comboPickEmpty,
      comboInsightCustomerSave: TERMS.card.comboInsightCustomerSave,
      comboInsightMerchantLose: TERMS.card.comboInsightMerchantLose,
      comboInsightLoseWarn: TERMS.card.comboInsightLoseWarn,
      comboInsightCostShare: TERMS.card.comboInsightCostShare,
      // M3.37（R190）到店团购渠道层
      grouponTitle: TERMS.card.grouponTitle,
      grouponHint: TERMS.card.grouponHint,
      grouponPrice: TERMS.card.grouponPrice,
      grouponPricePh: TERMS.card.grouponPricePh,
      grouponRate: TERMS.card.grouponRate,
      grouponRatePh: TERMS.card.grouponRatePh,
      grouponPromo: TERMS.card.grouponPromo,
      grouponCalc: TERMS.card.grouponCalc,
      grouponCommission: TERMS.card.grouponCommission,
      grouponNet: TERMS.card.grouponNet,
      grouponProfit: TERMS.card.grouponProfit,
      grouponNetRate: TERMS.card.grouponNetRate,
      grouponVsDine: TERMS.card.grouponVsDine,
      // M3.20（批次 B 收尾）菜品模板
      templateFrom: TERMS.card.templateFrom,
      templatePickPh: TERMS.card.templatePickPh,
      templateHint: TERMS.card.templateHint,
      // ── R234/J4f 行内长提示折叠（本页 1 处）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语）。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    // R234/J4f：行内长提示折叠（本页 1 处，默认收起）。仓内统一实现。
    hintFold: {},
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
    // M3.37 团购试算（纯前端、不落库；费率无默认值 ⇒ 只进 placeholder）
    grouponPriceYuan: '',
    grouponRate: '',
    grouponPromoYuan: '',
    grouponView: null,
    materials: [],
    // 用量单位枚举（单源 utils/units.js；round151 起 = 与采购单位同池，基准单位仍恒为克）
    qtyUnits: units.QTY_UNITS.slice(),
    // round153：wxml 兜底用的基准单位词 —— 改前在模板里写死 `'克'`，那等于在页面存了第二份单位口径。
    //   ⚠️ 只作 `|| baseUnit` 兜底，真正的枚举值一律来自 qtyUnits / priceUnits（单源 units.js）。
    baseUnit: units.BASE_UNIT,
    // round151：单价单位枚举 —— 与用量单位同池（老板按什么单位报的价，就该能选什么）
    priceUnits: units.QTY_UNITS.slice(),
    // round150（M3.14）组件类型 chips：**只有键 + 中文名**，键集 ≡ 服务端 LINE_KINDS。
    kindChips: Object.keys(TERMS.card.lineKind).map((k) => ({ key: k, label: TERMS.card.lineKind[k] })),
    // round150（M3.15）规格行：**只有键 + 中文名**（系数单源在服务端 ⇒ 页面只送 spec_key + 售价）。
    specRows: freshSpecRows(),
    lines: [],
    loading: true,
    // round156：连续录入 —— 顶部「已保存」横幅记录刚存下的菜名；非空即显示（含返回列表出口）
    savedName: '',
    saving: false,   // 防重复提交（连击保存会生成两个版本）
    // M3.16（批次 C）套餐：卡片类型（'1'=单品 / '3'=套餐）+ 子卡选择行 + 三个显示数。
    cardType: '1',
    subCards: [],       // 候选子卡（非套餐的最新版本卡）：[{ card_code, name, total_cost_fen, price_fen }]
    subCardOptions: [], // picker range（[{ card_code, label }]）
    comboLines: [],     // 子卡行：[{ sub_card_ref, sub_card_name, qty }]
    comboInsight: null, // 回填的套餐三数（{ customer_save_fen, merchant_lose_fen, cost_share }）
    // M3.20（批次 B 收尾）菜品模板：picker range（20 道菜名）+ 当前选中项（-1 = 未选）
    tplNames: TEMPLATES.map((t) => t.dish_name),
    tplPicked: -1,
  },

  // R234/J4f：行内提示折叠开关（仓内统一形态 —— 多页同一实现）。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
  },

  onLoad(q) {
    // round156：本页进入时刻 —— 用作「原料选择页回传」的哨兵（见 onShow）
    this._loadedAt = Date.now();
    this.setData({ card_code: (q && q.card_code) || '', isEdit: !!((q && q.card_code) || '').length > 0 });
    this.load();
  },

  // round156：从「原料选择页」返回 → 消费回传。
  //   哨兵 `at`：进选择页**没选就返回**时，globalData 里没有新值（或还是上一轮的旧值），
  //   靠 `at < this._loadedAt` 丢弃旧值，避免"我只是点进去看了一眼"就把某一行原料换掉。
  onShow() {
    const app = getApp();
    const p = app && app.globalData && app.globalData.pickMaterial;
    if (!p || !p.at) return;
    app.globalData.pickMaterial = null;
    if (this._loadedAt && p.at < this._loadedAt) return;   // 上一轮遗留 ⇒ 丢弃
    // 原料表还没到（load 尚未返回）⇒ 挂起，等 load 末尾补做，避免"选了却没填上"
    if ((this.data.materials || []).length) this.applyPickedMaterial(Number(p.idx), p.id);
    else this._pendingPick = p;
  },

  // round156：原料选择改为**独立页**（`pages/material/pick`）。
  //   改前是原生 `<picker mode="selector" range="{{materials}}">` —— 100 个原料只能靠手指滚，
  //   没有搜索、没有分组（李老师真机反馈：「如果有 100 道菜品，来回查找会很麻烦」）。
  goPickMaterial(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    wx.navigateTo({ url: '/pages/material/pick?idx=' + idx });
  },

  // 把选中的原料填进第 idx 行（原 onMaterialChange 的语义；改为按 **id** 取而非按下标取 ——
  //   独立页回传的是 id，比下标稳：中途列表顺序变了也不会填错行）。
  applyPickedMaterial(idx, materialId) {
    if (!(idx >= 0)) return;
    const lines = this.data.lines.slice();
    if (!lines[idx]) return;
    const m = (this.data.materials || []).find((x) => x.id === materialId);
    if (!m) return;
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
      // M3.16（批次 C）：拉一次成本卡列表 —— 候选子卡（非套餐）+ 编辑回填（单品/套餐都用它）。
      let cardList = [];
      try {
        const cd = await api.call('getCostCard', {});
        cardList = cd.list || [];
      } catch (e) { cardList = []; }
      const subCards = cardList
        .filter((x) => x.card_type !== 3)
        .map((x) => ({ card_code: x.card_code, name: x.name, total_cost_fen: x.total_cost_fen, price_fen: x.price_fen }));
      const subCardOptions = subCards.map((x) => ({ card_code: x.card_code, label: x.name }));
      const init = { materials, subCards, subCardOptions, loading: false };
      if (this.data.isEdit) {
        const c = cardList.find((x) => x.card_code === this.data.card_code);
        if (c) {
          init.name = c.name || '';
          init.lossRate = c.loss_rate || 0;
          init.auxYuan = api.fenToYuan(c.aux_fen, 2);
          init.priceYuan = c.price_fen > 0 ? api.fenToYuan(c.price_fen, 2) : '';
          init.category = c.category || '';
          init.tags = c.tags || '';
          init.previewCostFen = c.total_cost_fen || 0;
          init.copyVersion = TERMS.card.copyVersion;
          if (c.card_type === 3) {
            // M3.16 套餐：回填子卡行 + 三个显示数（顾客省 / 我少赚 / 成本结构）
            init.cardType = '3';
            init.calcMode = 'A';
            init.comboLines = (c.lines || [])
              .filter((l) => l.line_type === 2 && l.sub_card_ref)
              .map((l) => ({
                sub_card_ref: l.sub_card_ref,
                sub_card_name: (subCards.find((s) => s.card_code === l.sub_card_ref) || {}).name || l.material_name || '',
                qty: String(l.quantity),
              }));
            init.comboInsight = c.combo ? {
              customer_save_yuan: api.fenToYuan(c.combo.customerSaveFen, 2),
              merchant_lose_yuan: api.fenToYuan(Math.abs(c.combo.merchantLoseFen), 2),
              merchant_lose_neg: c.combo.merchantLoseFen < 0,
              cost_share: (c.combo.costShare || []).map((s) => ({ name: s.name, share_pct: s.share_pct })),
            } : null;
          } else {
            // 单品：现有原料 / 手工行回填
            init.calcMode = c.calc_mode;
            init.batchOutput = c.batch_output || '';
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
          }
        }
      }
      if (!init.lines || init.lines.length === 0) init.lines = renumber([emptyLine()]);
      // 分类回显：自由文本，直接回显；候选 chips = 本店填过的 + 建议池（不再做"补进枚举"）
      init.catChips = this.buildCatChips(init.category);
      this.setData(init);
      // 明细行的原料换算说明（须在 setData(materials) 之后算，否则找不到原料）
      this.refreshSpecHints();
      // round156：从原料选择页返回时原料表还没到 ⇒ 在此补做（见 onShow 的 _pendingPick）。
      //   没有它就会出现"明明选了原料、界面却没填上"这种最气人的静默失败。
      if (this._pendingPick) {
        const p = this._pendingPick;
        this._pendingPick = null;
        this.applyPickedMaterial(Number(p.idx), p.id);
      }
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onMode(e) { this.setData({ calcMode: e.detail.value }); },
  onBatch(e) { this.setData({ batchOutput: e.detail.value }); },

  // ===== M3.16（批次 C）套餐 =====
  // 切换卡片类型（单品 / 套餐）。切到套餐时，付费墙在**保存**时由后端拦（FEATURE_LOCKED → openPaywall('combo')）。
  onCardType(e) {
    const val = e.detail.value;   // '1' | '3'
    const patch = { cardType: val };
    if (val === '3') {
      patch.calcMode = 'A';   // 套餐固定按份聚合
      if (!this.data.comboLines.length) patch.comboLines = [{ sub_card_ref: '', sub_card_name: '', qty: '1' }];
    }
    this.setData(patch);
  },

  // ===== M3.20（批次 B 收尾）菜品模板：一键起行 =====
  // 选模板 → 预填行名 + 用量 + 单位（**价格全部留空**）；模板只省打字，保存仍走 saveCostCard、配额照扣。
  onPickTemplate(e) {
    const i = Number(e.detail.value);
    const tpl = TEMPLATES[i];
    if (!tpl) return;
    const rows = applyTemplate(tpl);
    // 模板行 → 手工行（input_type=2）：行名 + 用量 + 单位预填，单价留空等用户填
    const lines = rows.map((r) => Object.assign({}, emptyManualLine(), {
      material_name: r.line_name,
      qty: String(r.qty),
      qty_unit: r.unit,
    }));
    this.setData({ name: tpl.dish_name, lines: renumber(lines), tplPicked: i, cardType: '1', calcMode: 'A' });
    this.refreshSpecHints();
  },
  // 子卡选择（picker 按 index 取）
  onComboSubCard(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const opt = this.data.subCardOptions[Number(e.detail.value)];
    if (!opt) return;
    const comboLines = this.data.comboLines.slice();
    comboLines[idx] = Object.assign({}, comboLines[idx], { sub_card_ref: opt.card_code, sub_card_name: opt.label });
    this.setData({ comboLines });
  },
  onComboQty(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const comboLines = this.data.comboLines.slice();
    comboLines[idx] = Object.assign({}, comboLines[idx], { qty: e.detail.value });
    this.setData({ comboLines });
  },
  addComboLine() {
    this.setData({ comboLines: this.data.comboLines.concat([{ sub_card_ref: '', sub_card_name: '', qty: '1' }]) });
  },
  delComboLine(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rest = this.data.comboLines.filter((l, i) => i !== idx);
    this.setData({ comboLines: rest.length ? rest : [{ sub_card_ref: '', sub_card_name: '', qty: '1' }] });
  },

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
  // round156：原 `onMaterialChange`（原生 picker 的 bindchange，按下标取）已由
  //   `goPickMaterial` + `onShow` + `applyPickedMaterial` 取代。**不保留死代码**：
  //   留着会让下一个人以为还有第二条选原料的路径（两条路径 = 两份真相）。
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
  // round153：删行按钮从「录入方式」那行的红 × 挪到行尾并改名 ⇒ 顺手补上防误触。
  //   规则：**只有这行已经填了东西才问一句**，空行直接删 —— 不为没内容的东西增加摩擦。
  //   ⚠️ wx.showModal 的 confirmText/cancelText 上限 4 字符（真机事故见 terms.js paywall 注释）
  //      ⇒ 「删除」「取消」都在限内，长文案只放 title/content。
  delLine(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const cur = this.data.lines[idx] || {};
    const name = String(cur.material_name || '').trim();
    const filled = !!cur.material_id || !!name || Number(cur.qty) > 0 || Number(cur.unit_price_yuan) > 0;
    const doDel = () => {
      const rest = this.data.lines.filter((l, i) => i !== idx);
      this.setData({ lines: renumber(rest.length ? rest : [emptyLine()]) });
    };
    if (!filled) { doDel(); return; }
    wx.showModal({
      title: TERMS.card.delLineTitle,
      content: name ? TERMS.card.delLineConfirmOf(name) : TERMS.card.delLineConfirmBare,
      confirmText: TERMS.card.delLineConfirmOk,
      cancelText: TERMS.buttons.cancel,
      success: (r) => { if (r.confirm) doDel(); },
    });
  },

  // 反算售价 / 预览成本：调 calcBom（后端纯计算），不本地算
  async reverseCalc() {
    const linesInput = this.buildCalcLines();
    if (!linesInput) return;
    try {
      ui.setTitle(TERMS.card.reverseTitle);
      // 套餐固定按「份」聚合（M3.16：calc_mode 对套餐无意义）⇒ 强制 mode='A'
      const mode = this.data.cardType === '3' ? 'A' : this.data.calcMode;
      const d = await api.call('calcBom', {
        lines: linesInput,
        mode,
        batch_output: mode === 'B' ? Number(this.data.batchOutput) : 0,
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

  // ============ M3.37 团购到手试算（R190） ============
  // 口径（李老师 2026-10-02 定）：佣金基数 = **顾客实付的团购价**（不是原价）；费率店家自己填、无默认值。
  // 成本来自引擎 calcBom（与单品/套餐同一条路，不另算一份）；费用侧纯前端，**不落库**。
  onGrouponPrice(e) { this.setData({ grouponPriceYuan: e.detail.value, grouponView: null }); },
  onGrouponRate(e) { this.setData({ grouponRate: e.detail.value, grouponView: null }); },
  onGrouponPromo(e) { this.setData({ grouponPromoYuan: e.detail.value, grouponView: null }); },
  async calcGroupon() {
    const priceYuan = Number(this.data.grouponPriceYuan) || 0;
    if (!(priceYuan > 0)) { wx.showToast({ title: TERMS.card.grouponNeedPrice, icon: 'none' }); return; }
    const linesInput = this.buildCalcLines();
    if (!linesInput) return;
    try {
      ui.setTitle(TERMS.card.grouponCalc);
      const mode = this.data.cardType === '3' ? 'A' : this.data.calcMode;
      const d = await api.call('calcBom', {
        lines: linesInput,
        mode,
        batch_output: mode === 'B' ? Number(this.data.batchOutput) : 0,
        loss_pct: Number(this.data.lossRate) || 0,
        auxYuan: Number(this.data.auxYuan) || 0,
      });
      const costFen = d.unit_cost_fen || 0;
      if (!(costFen > 0)) { wx.showToast({ title: TERMS.card.grouponNeedCost, icon: 'none' }); return; }
      const v = calcGrouponOrder({
        priceFen: Math.round(priceYuan * 100),
        costFen,
        ratePct: Number(this.data.grouponRate) || 0,
        promoFen: Math.round((Number(this.data.grouponPromoYuan) || 0) * 100),
        dineFen: Math.round((Number(this.data.priceYuan) || 0) * 100),
      });
      // vsDineNeg = 堂食毛利 − 团购到手毛利 > 0 ⇒ 这个团购在拉低毛利 ⇒ 红字
      this.setData({
        grouponView: {
          cost: api.fenToYuan(v.costFen, 2),
          commission: api.fenToYuan(v.commissionFen, 2),
          net: api.fenToYuan(v.netFen, 2),
          profit: api.fenToYuan(v.profitFen, 2),
          netRate: v.netRatePct,
          profitRate: v.profitRatePct,
          vsDine: api.fenToYuan(Math.abs(v.vsDineFen), 2),
          vsDineNeg: v.vsDineFen > 0,
          hasDine: v.hasDine,
        },
        previewCostFen: costFen,
        previewCost: api.fenToYuan(costFen, 2),
      });
    } catch (e) { api.toastError(e); }
  },

  buildCalcLines() {
    const out = [];
    // M3.16 / R190：**套餐也能算**（此前反算区只给单品用，套餐点了没反应）
    //   子卡行 → 引擎行：net_unit_cost = 子卡单份成本(分) × 100（与引擎「万分之一元」同尺度）；quantity = 份数。
    if (this.data.cardType === '3') {
      for (const l of this.data.comboLines) {
        const qty = Number(l.qty) || 0;
        if (!(qty > 0)) continue;
        const sub = this.data.subCards.find((x) => x.card_code === l.sub_card_ref);
        if (!sub || !(Number(sub.total_cost_fen) > 0)) continue;
        out.push({ quantity: qty, net_unit_cost: Number(sub.total_cost_fen) * 100, line_kind: 'main' });
      }
      if (out.length === 0) { wx.showToast({ title: TERMS.card.comboSubCardPh, icon: 'none' }); return null; }
      return out;
    }
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
      // 套餐固定按「份」聚合（M3.16：calc_mode 对套餐无意义）⇒ 强制 mode='A'
      const mode = this.data.cardType === '3' ? 'A' : this.data.calcMode;
      const d = await api.call('calcBom', {
        lines: linesInput,
        mode,
        batch_output: mode === 'B' ? Number(this.data.batchOutput) : 0,
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
    // M3.16（批次 C）套餐：明细行 = 子卡引用行（sub_card_ref + 份数），不走原料/手工分支。
    if (this.data.cardType === '3') {
      for (const cl of this.data.comboLines) {
        if (!cl.sub_card_ref) { wx.showToast({ title: TERMS.card.comboSubCardPh, icon: 'none' }); return; }
        const qty = Number(cl.qty);
        if (!isFinite(qty) || qty <= 0) { wx.showToast({ title: TERMS.card.comboSubCardQty, icon: 'none' }); return; }
        lines.push({ sub_card_ref: cl.sub_card_ref, qty: qty });
      }
      if (lines.length === 0) { wx.showToast({ title: TERMS.card.comboSubCardPh, icon: 'none' }); return; }
    } else {
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
    }
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
    // M3.16：套餐卡类型（3）上云
    if (this.data.cardType === '3') card.card_type = 3;
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
    if (this.data.saving) return;   // 连击保护：重复提交会生成两个版本
    // ⚠️ 必须在 afterSaved 之前取：afterSaved 会把 isEdit 清成 false（转新建态）
    const wasEdit = this.data.isEdit;
    this.setData({ saving: true });
    try {
      ui.setTitle(TERMS.buttons.save);
      await api.call('saveCostCard', { card, client_request_id: 'cc_' + Date.now() });
      if (wasEdit) {
        // 编辑态：**改完即走**（老板改的是一道具体的菜，不是要连录一批）。
        //   ⚠️ 这里**不能**走 afterSaved —— 那会把 card_code 清掉，老板以为还在改这道菜。
        wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      } else {
        // round156（新增态）：**不跳走**。改前是 `setTimeout(navigateBack, 600)` —— 存一道菜就被踢回列表，
        //   录 30 道菜要来回 60 次（李老师「100 道菜品，来回查找会很麻烦」的痛点之一）。
        this.afterSaved(card.name);
      }
    } catch (e) {
      this.setData({ saving: false });
      // M3.16（批次 C）：套餐未开通 → 弹付费墙（openPaywall('combo')，与云端 PAID_FEATURES.m3_combo 对齐）。
      if (e && e.code === 'FEATURE_LOCKED' && this.data.cardType === '3') { openPaywall('combo'); return; }
      api.toastError(e);
    }
  },

  // round156：连续录入 —— 保存成功后**留在本页**，清掉这道菜特有的字段，接着录下一道。
  //   🔴 必须清 `card_code` + `isEdit`：否则第二道菜会被当成「编辑第一道」⇒ 后端按同一 card_code
  //      **另存新版本**，第一道菜的内容被静默顶掉。这是**数据正确性**问题，不是手感问题。
  //   ✅ **刻意保留门店级默认**（核算模式 / 损耗率 / 辅料 / 分类 / 标签 / 目标毛利率）：
  //      连续录同一家店的同类菜时这些大概率一样，留着才叫"连续"。
  afterSaved(name) {
    this.setData({
      savedName: name || '',
      saving: false,
      // —— 这道菜特有的：清 ——
      name: '',
      lines: renumber([emptyLine()]),
      priceYuan: '',
      activityPriceYuan: '',
      batchOutput: '',
      reversePriceFen: 0, previewCostFen: 0, reverseResultPreview: '', previewCost: '',
      specRows: freshSpecRows(),
      // M3.16（批次 C）套餐：清空套餐特有字段（连续录入下一道默认回到单品）
      cardType: '1',
      comboLines: [],
      comboInsight: null,
      // M3.20（批次 B 收尾）模板：清空选中项（连续录入下一道回到空模板态）
      tplPicked: -1,
      // —— 编辑态 → 新建态（见上 🔴）——
      isEdit: false,
      card_code: '',
      catChips: this.buildCatChips(this.data.category),
    });
    wx.showToast({ title: TERMS.card.savedOk, icon: 'success' });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  // 连续录入的显式出口（横幅上的「返回列表」）——不打断，也不把人困在本页
  backToList() { wx.navigateBack(); },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
