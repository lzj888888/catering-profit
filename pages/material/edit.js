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
const { suggestByName } = require('../../utils/materialLexicon.js');   // M3.20 词库（只读建议）

// category 枚举（采购视角，独立于 M1 ITEM_TAGS，不建映射）
const CATEGORY_OPTIONS = [
  { value: 'meat', label: TERMS.card.catMeat },
  { value: 'veg', label: TERMS.card.catVeg },
  { value: 'dry', label: TERMS.card.catDry },
  { value: 'season', label: TERMS.card.catSeason },
  { value: 'pack', label: TERMS.card.catPack },
  { value: 'other', label: TERMS.card.catOther },
];

// 🔴 R406（队列 #19）：把「影响成本卡成本的三要素」拼成一个可比较的键。
//   三要素 = 采购单价(分) / 换算系数 / 出成率 —— 成本卡快照里存的净料单位成本 = 单价 ÷ 系数 ÷ 出成率。
//   ⚠️ 单源说明：这里只做**相等性比较**，不重算任何成本（引擎口径仍在 calcCostCard，本函数不碰）。
//   为什么不直接比 `this.data.priceYuan` 字符串：'20' 与 '20.00' 是同一个价，
//   字符串比较会误报「改了」⇒ 一路弹窗骚扰；统一折成「分」整数再比才对得上实际落库值。
function costKeyOf(priceFen, convertFactor, yieldRate) {
  return [Number(priceFen) || 0, Number(convertFactor) || 0, Number(yieldRate) || 0].join('|');
}

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
      // round156：连续录入横幅
      savedOk: TERMS.card.savedOk,
      savedHint: TERMS.card.savedHint,
      backToList: TERMS.card.backToList,
      // M3.20 词库建议
      matLexiconHint: TERMS.card.matLexiconHint,
      // ── R234/J4e 行内长提示折叠（本页 1 处）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语）。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    // R234/J4e：行内长提示折叠（本页 1 处，默认收起）。仓内统一实现。
    hintFold: {},
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
    // 🔴 R406（队列 #19）：编辑态记下「影响成本卡成本的三要素」原值，保存时比对。
    //   三要素 = 采购单价 / 换算系数 / 出成率 —— 成本卡快照里存的净料单位成本就是
    //   「单价 ÷ 换算系数 ÷ 出成率」。
    //   为什么不只盯价格：老板把「1 件 = 20 公斤」改成「= 25 公斤」，单价一分没动，
    //   但每克成本已经变了 ⇒ 只比价格就会漏提醒（漏提醒 = 他按旧成本去定价）。
    //   只改别名 / 备注 / 分类时不打扰（那些不进成本）。
    origCostKey: '',
    // 默认换算系数 = 「默认采购单位（斤）」的建议值，取自单源 units.js（页面不写死 500）
    convert_factor: String(units.suggestConvert(TERMS.card.matUnitDefault) || 1),
    yield_rate: '100',
    categoryIndex: 5,   // 默认 other
    categoryOptions: CATEGORY_OPTIONS,
    aliasesYuan: '',    // 逗号分隔原始输入
    remark: '',
    loading: true,
    // round156：连续录入 —— 顶部「已保存」横幅记录刚存下的原料名；非空即显示（含返回列表出口）
    savedName: '',
    saving: false,      // 防重复提交
    // M3.20（批次 B 收尾）：词库建议 chips（只建议、绝不自动改写 name）+ 选中的词库条目 key
    lexiconSuggests: [],
    std_key: '',
  },

  // R234/J4e：行内提示折叠开关（仓内统一形态 —— 多页同一实现，不各写一套）。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;                       // 无 key ⇒ 静默返回（不误翻别人的状态）
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
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
          // 🔴 R406：原值快照取**表单即将呈现的值**（而不是库里的裸值）——
          //   库里缺字段时表单会回落成 100/建议换算，若拿裸值做基线，老板什么都没改也会被判成"改了"。
          const yr0 = String(m.yield_rate || 100);
          this.setData({
            name: m.name || '',
            brand_spec: m.brand_spec || '',
            purchase_unit: pu,
            priceYuan: m.purchase_price_fen > 0 ? api.fenToYuan(m.purchase_price_fen, 2) : '',
            origCostKey: costKeyOf(m.purchase_price_fen, cf, yr0),
            convert_factor: cf,
            convUnit: cw,
            convQty: cf,
            convUnitIndex: Math.max(0, units.QTY_UNITS.indexOf(cw)),
            priceLabel: TERMS.card.matPriceOf(pu),
            yield_rate: yr0,
            categoryIndex: ci >= 0 ? ci : 5,
            aliasesYuan,
            remark: m.remark || '',
            std_key: m.std_key || '',
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

  onName(e) {
    const v = e.detail.value;
    // M3.20：输入过程中**绝不自动改写 name**，只更新建议 chips；手改名字 ⇒ 清掉 std_key（不再是词库条目）
    this.setData({ name: v, std_key: '', lexiconSuggests: suggestByName(v, 5).map((it) => ({ std_key: it.std_key, std_name: it.std_name })) });
  },
  // M3.20：点 chip 才把标准名填进输入框并记下 std_key（**只建议、绝不自动替换**）
  pickLexicon(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!ds.name) return;
    this.setData({ name: ds.name, std_key: ds.key || '', lexiconSuggests: [] });
  },
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
    // 🔴 R297：出成率**上界**也在这里前置拦（与菜品卡手工行同一入口 `units.yieldRateOf`）。
    //   云端 `saveMaterial/validate.js` 有 (0,100] 校验 ⇒ 不会静默算错；但它的 msg 到不了用户眼前
    //   （R271：`utils/api.js` 把 fail 的 msg 覆盖成通用文案）⇒ 老板只会看到一句"出错了"、
    //   不知道是哪一格。这里前置给**人话**，让他在点保存当场就知道改哪。
    const yr = units.yieldRateOf(this.data.yield_rate);
    if (yr === null) { wx.showToast({ title: TERMS.card.yieldRangeErr, icon: 'none' }); return; }
    // 元 → 分整数（前端换算，禁止字符串/小数元透传）
    const purchasePriceFen = Math.round(Number(((Number(this.data.priceYuan) || 0) * 100).toFixed(10)));
    // aliases：逗号分隔 → JSON 数组字符串（仅检索，不替换原料名）
    const aliases = this.data.aliasesYuan.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const material = {
      id: this.data.id,                        // '' = 新增
      name: this.data.name.trim(),
      brand_spec: this.data.brand_spec,
      purchase_unit: String(this.data.purchase_unit || '').trim() || TERMS.card.matUnitDefault,
      purchase_price_fen: purchasePriceFen,
      convert_factor: cf,
      yield_rate: yr,
      is_virtual: false,
      category: this.data.categoryOptions[this.data.categoryIndex].value,
      aliases: JSON.stringify(aliases),
      remark: this.data.remark,
      // M3.20：本料取自词库哪一条（可选，空 = 未取自词库）
      std_key: this.data.std_key,
    };
    if (this.data.saving) return;   // 连击保护
    // ⚠️ 必须在 afterSaved 之前取：afterSaved 会把 isEdit 清成 false（转新建态）
    const wasEdit = this.data.isEdit;
    // 🔴 R406（队列 #19）：保存后的成本三要素键 vs 加载时的基线（origCostKey）。
    //   只有它们变了才提醒 —— 老板只改个别名/备注时不该被弹窗打断。
    const origCostKey = this.data.origCostKey;
    const newCostKey = costKeyOf(purchasePriceFen, cf, yr);
    this.setData({ saving: true });
    try {
      await api.call('saveMaterial', { material, client_request_id: 'mat_' + Date.now() });
      if (wasEdit) {
        // 编辑态：**改完即走**。老板修的是一个具体的原料（改个价、补个别名），不是要连录一批；
        //   停下来反而让他对着一个不该再填的表单发愣。
        // 🔴 R406：但「改的正好是进成本的那三个字段」时，走之前必须把真相说清 ——
        //   成本卡是快照隔离，不点「同步至最新价」它不会跟着变（见云函数头注）。
        //   改前这里只有一句「已保存」，老板会顺手按旧成本去定价 = 静默算错。
        if (newCostKey !== origCostKey) {
          // 兜底 catch：保存**已经成功**，此处任何异常都不许冒到外层
          // （外层 catch 会把它渲染成"保存失败"，那是假话）。
          await this.tellPriceImpact().catch(() => {});
        } else {
          wx.showToast({ title: TERMS.ui.savedDone, icon: 'success' });
          setTimeout(() => wx.navigateBack(), 600);
        }
      } else {
        // round156（新增态）：**不跳走**。改前 `setTimeout(navigateBack, 600)` 每存一个原料就回列表。
        //   原料页尤其需要连续录入：进价表一次要录一批（"一件 20 公斤 195 元"这种整包采买），
        //   来回跳转是最费手的一环。
        this.afterSaved(material.name);
      }
    } catch (e) { this.setData({ saving: false }); api.toastError(e); }
  },

  // 🔴 R406（队列 #19）：改价后如实告知「成本卡不会自己跟着变」，并给一条直达影响面的路。
  //
  //   为什么不能照豆包 O5 的原话（「所有用该原料的菜成本已自动更新」）：
  //     本仓成本卡是**快照隔离** —— 改原料价后旧卡成本不变，只有手动走 `syncCostCard`
  //     才生成新版本（`cloudfunctions/syncCostCard/index.js:4-5`）。
  //     落那句原文 = 承诺一件没发生的事 ⇒ 老板按没变的成本定价，比不提示更贵。
  //
  //   为什么先探一次 `dry_run`：没有菜用到这个原料时不该弹（批量调价会变成一路骚扰）。
  //     `dry_run` 是**只读预览**：零写库、零新版本、不计写限额（同文件 index.js:51-53），探一次无副作用。
  //
  //   fail-soft 的边界（想清楚才敢这么写）：
  //     探数失败 ⇒ 仍弹**不带数量**的通用版。「成本卡不会自己跟着变」这句话与影响数无关、
  //     永远成立 ⇒ 宁可多说一句，也不许让老板误以为已自动更新。
  //     唯一「不弹」的分支是**确实为 0 道菜**（读成功了才算数，读失败不当成 0）。
  async tellPriceImpact() {
    let n = -1;   // -1 = 没读到（不等于 0）
    try {
      const d = await api.call('syncCostCard', {
        material_id: this.data.id,
        dry_run: true,
        client_request_id: 'mimp_' + Date.now(),
      });
      n = (d.affected || []).length;
    } catch (e) { n = -1; }

    if (n === 0) {   // 真的没有菜用到它 ⇒ 不值得打断（此时说"成本卡不会变"是废话）
      wx.showToast({ title: TERMS.ui.savedDone, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }

    const content = n > 0 ? TERMS.card.matImpactAsk(n) : TERMS.card.matImpactAskUnknown;
    const materialId = this.data.id;
    const materialName = String(this.data.name || '').trim();
    wx.showModal({
      title: TERMS.card.matPriceSaved,
      content,
      // ⚠️ 平台硬限制 ≤4 字符（2026-09-26 真机事故 showmodal:fail confirm text length），
      //   由 tools/check_modal_button_len.js 守着。
      confirmText: TERMS.card.matImpactGo,
      cancelText: TERMS.card.matImpactSkip,
      confirmColor: '#1e3a5f',
      success: (r) => {
        if (!r.confirm) { wx.navigateBack(); return; }
        // 用 redirectTo 而非 navigateTo：把编辑页从栈里**换掉**。
        //   这张表单已经存过了，留在栈里只会让"返回"退回到一个不该再填的页面
        //   （与 round156「改完即走」同一条纪律）。
        wx.redirectTo({
          url: '/pages/metrics/impact?material_id=' + materialId
            + '&name=' + encodeURIComponent(materialName),
        });
      },
      // modal 起不来也不能把老板困在「已保存但仍显示为编辑中」的表单上
      fail: () => { wx.navigateBack(); },
    });
  },

  // round156：连续录入 —— 保存成功后**留在本页**，清掉这个原料特有的字段，接着录下一个。
  //   🔴 必须清 `id` + `isEdit`：否则第二个原料会被当成「编辑第一个」⇒ **把第一个原料覆盖掉**。
  //      这是数据正确性问题，不是手感问题。
  //   ✅ 刻意保留 `categoryIndex`（同一批原料分类往往相同，连续录入时不用重选）。
  afterSaved(name) {
    this.setData({
      savedName: name || '',
      saving: false,
      // —— 这个原料特有的：清 ——
      name: '',
      brand_spec: '',
      priceYuan: '',
      aliasesYuan: '',
      remark: '',
      lexiconSuggests: [],
      std_key: '',
      // 换算/单位回默认。新原料的采购单位大概率与上一条不同 ⇒ 留着是最容易填错的一格，
      //   宁可让老板重选（单位池 chips 就在手边），也不让他在"上一条的单位"上填下一条的数。
      //   ⚠️ 表达式与 data 初值同源（都取 units/TERMS 单源，页面不写死 500 /「斤」）。
      purchase_unit: TERMS.card.matUnitDefault,
      convert_factor: String(units.suggestConvert(TERMS.card.matUnitDefault) || 1),
      convQty: String(units.suggestConvert(TERMS.card.matUnitDefault) || 1),
      convUnit: units.baseWordOf(TERMS.card.matUnitDefault),
      convUnitIndex: Math.max(0, units.QTY_UNITS.indexOf(units.baseWordOf(TERMS.card.matUnitDefault))),
      convertTouched: false,
      yield_rate: '100',
      unitChipsOpen: false,
      // —— 编辑态 → 新建态（见上 🔴）——
      id: '',
      isEdit: false,
    }, () => this.refreshUnitHint());   // 换算提示/标签依赖采购单位与所选单位 ⇒ 重置后必须重算
    wx.showToast({ title: TERMS.card.savedOk, icon: 'success' });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  // 连续录入的显式出口（横幅上的「返回列表」）
  backToList() { wx.navigateBack(); },
});
