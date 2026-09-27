// pages/material/edit.js —— 批次 P0（M3 v1.2）· 原料新增/编辑表单页（独立成页，不用弹层）
//
// 写：api.call('saveMaterial', { material:{...} })。
// ⚠️ 金额铁律：采购单价「元」输入 → 前端 Math.round(元×100) 转「分」整数（后端不收字符串/小数元）。
// ⚠️ 三可选字段（M3.30）：category 下拉 6 类；aliases 逗号分隔 → JSON 数组字符串（仅检索）；remark 文本域。
// ⚠️ 虚拟原料（is_virtual=true）只读（列表页已拦编辑入口，此处兜底不给存）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const units = require('../../utils/units.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

// category 枚举（采购视角，独立于 M1 ITEM_TAGS，不建映射）
const CATEGORY_OPTIONS = [
  { value: 'meat', label: TERMS.card.catMeat },
  { value: 'veg', label: TERMS.card.catVeg },
  { value: 'dry', label: TERMS.card.catDry },
  { value: 'season', label: TERMS.card.catSeason },
  { value: 'pack', label: TERMS.card.catPack },
  { value: 'other', label: TERMS.card.catOther },
];

Page({
  data: {
    t: {
      title: TERMS.card.materialListTitle,
      matName: TERMS.card.matName,
      matNamePh: TERMS.card.matNamePh,
      matBrand: TERMS.card.matBrand,
      matUnit: TERMS.card.matUnit,
      matUnitDefault: TERMS.card.matUnitDefault,
      matPrice: TERMS.card.matPrice,
      matNetCost: TERMS.card.matNetCost,
      matCategory: TERMS.card.matCategory,
      matAliases: TERMS.card.matAliases,
      matAliasesHint: TERMS.card.matAliasesHint,
      matRemark: TERMS.card.matRemark,
      matConvert: TERMS.card.matConvert,
      matUnitHint: TERMS.card.matUnitHint,
      matYield: TERMS.card.matYield,
      matEdit: TERMS.card.matEdit,
      matAdd: TERMS.card.matAdd,
      save: TERMS.buttons.save,
      cancel: TERMS.buttons.cancel,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    id: '',            // '' = 新增；非空 = 编辑
    isEdit: false,
    name: '',
    brand_spec: '',
    purchase_unit: TERMS.card.matUnitDefault,
    // 采购单位建议池：**只许追加**（旧档案里是自由文本，删值会让老数据找不到对应项）
    unitChips: units.PURCHASE_UNITS.slice(),
    // round152：建议池 chips 的展开态。**默认收起** —— round151 把池从 4 项扩到 14 项 ⇒
    //   chips 由 1 行涨到 2~3 行，常驻展开会把下方「换算系数 / 出成率」顶下去（真机实测反馈：
    //   老板以为换算系数是系统算出的死值）。收起后由 ▾ 随时展开，选完即收。
    unitChipsOpen: false,
    // round152：换算系数**是否已被手改**。立起后 pickUnit 不再用建议值覆盖老板敲的数
    //   （改前：手改 480 → 再点单位「斤」 ⇒ 被 500 冲掉，表现为"改了存不住"）。
    convertTouched: false,
    convertHint: '',    // 动态：1 <采购单位> = <换算系数> <基准单位词>（归一化口径，恒回克/毫升/个）
    // round151：换算系数标签的基准词随**计量族**走。
    // round155：改为随**右侧所选单位**走 —— 「1 件 = [20] [公斤▾]」时标签读作「换算系数（→公斤）」，
    //   它现在真的在说"这个系数用哪个单位表达"（改前恒回克 ⇒ 按个/箱买的老板字面上对不上）。
    convertLabel: '',
    // round153：句子式组合行的左短句「1 斤 =」。取 `terms.matConvertLeftOf(u)`（拼串在术语表），
    //   ⚠️ 页面不自己写死单位词 —— 那是第二份口径（守卫 check_unit_family.js 反查）。
    convertLeft: TERMS.card.matConvertLeftOf(TERMS.card.matUnitDefault),
    // round155：右侧 =「值 + 单位」二元组 —— 「1 件 = [ 20 ] [ 公斤 ▾ ]」。
    //   由来（李老师真机反馈）：店里大量按**整包**采买（一件 20 公斤 195 元），而换算系数原只收克数
    //   ⇒ 老板被迫先心算 20×1000=20000。右侧给出单位后直接填「20 公斤」，零心算。
    //   ⚠️ 落库口径**一字不改**：convert_factor 仍是「1 个采购单位 = ? 克」那个数（引擎不动）。
    convQty: String(units.suggestConvert(TERMS.card.matUnitDefault) || 1),
    convUnit: units.baseWordOf(TERMS.card.matUnitDefault),
    convUnits: units.QTY_UNITS.slice(),
    // ⚠️ picker 的 `value` 只决定**展开时的选中项**，显示的字仍是 {{convUnit}}
    //   ⇒ 索引必须与 convUnit **同源派生**；写死 0 时格子显示「克」而展开高亮「斤」（round155 自查抓到的自伤）。
    convUnitIndex: Math.max(0, units.QTY_UNITS.indexOf(units.baseWordOf(TERMS.card.matUnitDefault))),
    // round155：单价标签带上采购单位（「采购单价（元/件）」）—— 一件多少钱，一眼看清。
    priceLabel: TERMS.card.matPriceOf(TERMS.card.matUnitDefault),
    priceYuan: '',
    // 默认换算系数 = 「默认采购单位（斤）」的建议值，取自单源 units.js（页面不写死 500）
    convert_factor: String(units.suggestConvert(TERMS.card.matUnitDefault) || 1),
    yield_rate: '100',
    categoryIndex: 5,   // 默认 other
    categoryOptions: CATEGORY_OPTIONS,
    aliasesYuan: '',    // 逗号分隔原始输入
    remark: '',
    loading: true,
  },

  onLoad(q) {
    const id = (q && q.id) || '';
    this.setData({ id, isEdit: !!id });
    this.load();
  },

  async load() {
    try {
      await api.ensureShop();
      ui.setTitle(this.data.isEdit ? TERMS.card.matEdit : TERMS.card.matAdd);
      if (this.data.isEdit) {
        const d = await api.call('getMaterial', {});
        const m = (d.list || []).find((x) => x.id === this.data.id);
        if (m) {
          let aliasesYuan = '';
          try { aliasesYuan = (JSON.parse(m.aliases || '[]') || []).join(','); } catch (e) { aliasesYuan = ''; }
          const ci = CATEGORY_OPTIONS.findIndex((c) => c.value === m.category);
          const pu = m.purchase_unit || TERMS.card.matUnitDefault;
          const cf = String(m.convert_factor || units.suggestConvert(pu) || 1);
          // round155：把库里存的「克数」还原成右侧二元组（右单位默认取该采购单位的基准词）
          const cw = units.baseWordOf(pu);
          this.setData({
            name: m.name || '',
            brand_spec: m.brand_spec || '',
            purchase_unit: pu,
            priceYuan: m.purchase_price_fen > 0 ? api.fenToYuan(m.purchase_price_fen, 2) : '',
            convert_factor: cf,
            convUnit: cw,
            convQty: cf,
            convUnitIndex: Math.max(0, units.QTY_UNITS.indexOf(cw)),
            priceLabel: TERMS.card.matPriceOf(pu),
            yield_rate: String(m.yield_rate || 100),
            categoryIndex: ci >= 0 ? ci : 5,
            aliasesYuan,
            remark: m.remark || '',
          });
        }
      }
      this.setData({ loading: false });
      this.refreshUnitHint();
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onBrand(e) { this.setData({ brand_spec: e.detail.value }); },
  onUnit(e) { this.setData({ purchase_unit: e.detail.value }, () => this.refreshUnitHint()); },
  onPrice(e) { this.setData({ priceYuan: e.detail.value }); },
  // round152/155：手改右侧的**值** ⇒ 立 `convertTouched`（此后换采购单位也不再被建议值覆盖），
  //   并把「值 × 单位」折算回 `convert_factor`（引擎口径仍是克数）。
  onConvQty(e) {
    const q = e.detail.value;
    this.setData({ convQty: q, convertTouched: true, convert_factor: String(units.toBase(q, this.data.convUnit)) },
      () => this.refreshUnitHint());
  },
  // round155：右侧**单位**改动 ⇒ **保住物理量**（20000 克 → 20 公斤）：换的是说法、不是数。
  //   ⚠️ 与卡片页 onQtyUnit 同一条纪律；对照 onManualPriceUnit「只换标签不反算」——
  //   这里是"同一个包装重量的两种表达"，反算才对；单价那里是"老板敲的数"，反算会篡改它。
  onConvUnit(e) {
    const i = Number(e.detail.value);
    const u = this.data.convUnits[i] || this.data.convUnit;
    const q = units.convertQtyText(this.data.convQty, this.data.convUnit, u);
    this.setData({ convUnit: u, convUnitIndex: i, convQty: q, convertTouched: true,
      convert_factor: String(units.toBase(q, u)) }, () => this.refreshUnitHint());
  },

  // 采购单位 chips（round149）：点一下填入 + **自动带出建议换算系数**（斤→500 / 千克→1000 / 克→1）。
  //   ⚠️ 只对建议池里有的单位带出；「箱/桶/件」这类没有通用换算 ⇒ 不动用户已填的值（不许瞎猜）。
  //   带出的是**建议值**，用户随后可在换算系数里手改（仍是原料档案里那个可编辑数字，引擎口径不变）。
  // round152 两处修正（真机实测反馈）：
  //   ① 选完**立即收起** chips —— 14 项常驻会把下方字段顶下去，且收起动作不该让用户再做一遍。
  //   ② 已手改过系数（convertTouched）⇒ **不再覆盖**，与「不许静默改掉老板敲的数」同一条纪律
  //      （对齐 `onManualPriceUnit` 只换标签不反算）。此时 hint 会显示成「1 千克 = 500 克」这种
  //      自相矛盾的口径，反而提醒他该改 —— 这正是我们要的可见信号，不是 bug。
  pickUnit(e) {
    const u = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.unit) || '';
    if (!u) return;
    const sug = units.suggestConvert(u);
    const patch = { purchase_unit: u, unitChipsOpen: false };
    if (sug != null && !this.data.convertTouched) {
      // round155：带出建议值的同时，右侧二元组一并归位（值 = 建议克数、单位 = 该族基准词）
      patch.convert_factor = String(sug);
      patch.convQty = String(sug);
      patch.convUnit = units.baseWordOf(u);
      patch.convUnitIndex = Math.max(0, units.QTY_UNITS.indexOf(patch.convUnit));
    }
    this.setData(patch, () => this.refreshUnitHint());
  },
  // round151：▾ 展开/收起建议池。与 pickUnit 分开两件事 —— 点单位是选中，点箭头是收放。
  toggleUnitChips() { this.setData({ unitChipsOpen: !this.data.unitChipsOpen }); },
  // 动态换算说明：1 <采购单位> = <换算系数> <基准单位词>（把口径写在用户眼前，不靠他猜）
  //   round151：基准词由 `units.baseWordOf()` 单源给出（重量→克 / 体积→毫升 / 计数→个）。
  //   页面**不得**自己写「克」—— 那是第二份口径表（守卫 tools/check_unit_family.js 反查）。
  refreshUnitHint() {
    const u = String(this.data.purchase_unit || TERMS.card.matUnitDefault).trim() || TERMS.card.matUnitDefault;
    const f = Number(this.data.convert_factor) || 0;
    const w = units.baseWordOf(u);
    const cu = this.data.convUnit || w;
    this.setData({
      // 标签说「这个系数用哪个单位表达」（round155 起随右侧所选单位走，不再恒为克）
      convertLabel: TERMS.card.matConvertOf(cu),
      // 提示说**归一化后**的口径：1 件 = 20000 克（净料口径 · 可手改）—— 老板据此复核
      convertHint: TERMS.card.matConvertHintOf(u, f, w),
      convertLeft: TERMS.card.matConvertLeftOf(u),
      priceLabel: TERMS.card.matPriceOf(u),
    });
  },
  onYield(e) { this.setData({ yield_rate: e.detail.value }); },
  onCategory(e) { this.setData({ categoryIndex: Number(e.detail.value) }); },
  onAliases(e) { this.setData({ aliasesYuan: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  async onSave() {
    if (!this.data.name.trim()) { wx.showToast({ title: TERMS.card.matName, icon: 'none' }); return; }
    // round155：换算系数必须 >0 —— **不再静默兜底**（改前 `|| suggestConvert() || 1` 会把老板
    //   清空的系数悄悄换回 500，正是「不许静默改掉老板敲的数」要禁的行为）。
    const cf = Number(this.data.convert_factor) || 0;
    if (!(cf > 0)) { wx.showToast({ title: TERMS.card.matConvert, icon: 'none' }); return; }
    // 元 → 分整数（前端换算，禁止字符串/小数元透传）
    const purchasePriceFen = Math.round((Number(this.data.priceYuan) || 0) * 100);
    // aliases：逗号分隔 → JSON 数组字符串（仅检索，不替换原料名）
    const aliases = this.data.aliasesYuan.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const material = {
      id: this.data.id,                        // '' = 新增
      name: this.data.name.trim(),
      brand_spec: this.data.brand_spec,
      purchase_unit: String(this.data.purchase_unit || '').trim() || TERMS.card.matUnitDefault,
      purchase_price_fen: purchasePriceFen,
      convert_factor: cf,
      yield_rate: Number(this.data.yield_rate) || 100,
      is_virtual: false,
      category: this.data.categoryOptions[this.data.categoryIndex].value,
      aliases: JSON.stringify(aliases),
      remark: this.data.remark,
    };
    try {
      await api.call('saveMaterial', { material, client_request_id: 'mat_' + Date.now() });
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) { api.toastError(e); }
  },
});
