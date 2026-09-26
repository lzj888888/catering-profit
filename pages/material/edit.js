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
    convertHint: '',    // 动态：1 <采购单位> = <换算系数> <基准单位词>（净料口径）
    // round151：换算系数标签的基准词随**计量族**走（→克 / →毫升 / →个）。
    //   ⚠️ 改前恒为「换算系数（→克）」⇒ 按「个/箱」采购的老板看到的字面量根本没有对应含义。
    convertLabel: '',
    // round153：换算系数组合行的左右陪衬字 —— 「1 斤 = [ 500 ] 克」。
    //   左取 `terms.matConvertLeftOf(u)`（拼串在术语表），右取 `units.baseWordOf()` 单源。
    //   ⚠️ 页面不自己写死单位词 —— 那是第二份口径（守卫 check_unit_family.js 反查）。
    convertLeft: TERMS.card.matConvertLeftOf(TERMS.card.matUnitDefault),
    convBaseWord: units.baseWordOf(TERMS.card.matUnitDefault),
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
          this.setData({
            name: m.name || '',
            brand_spec: m.brand_spec || '',
            purchase_unit: m.purchase_unit || TERMS.card.matUnitDefault,
            priceYuan: m.purchase_price_fen > 0 ? api.fenToYuan(m.purchase_price_fen, 2) : '',
            convert_factor: String(m.convert_factor || units.suggestConvert(m.purchase_unit || TERMS.card.matUnitDefault) || 1),
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
  // round152：手改换算系数 ⇒ 立 `convertTouched`（此后换单位也不再被建议值覆盖）
  onConvert(e) {
    this.setData({ convert_factor: e.detail.value, convertTouched: true }, () => this.refreshUnitHint());
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
    if (sug != null && !this.data.convertTouched) patch.convert_factor = String(sug);
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
    this.setData({
      convertLabel: TERMS.card.matConvertOf(w),
      convertHint: TERMS.card.matConvertHintOf(u, f, w),
      convertLeft: TERMS.card.matConvertLeftOf(u),
      convBaseWord: w,
    });
  },
  onYield(e) { this.setData({ yield_rate: e.detail.value }); },
  onCategory(e) { this.setData({ categoryIndex: Number(e.detail.value) }); },
  onAliases(e) { this.setData({ aliasesYuan: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  async onSave() {
    if (!this.data.name.trim()) { wx.showToast({ title: TERMS.card.matName, icon: 'none' }); return; }
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
      convert_factor: Number(this.data.convert_factor) || units.suggestConvert(TERMS.card.matUnitDefault) || 1,
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
