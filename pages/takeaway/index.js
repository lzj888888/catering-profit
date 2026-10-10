// pages/takeaway/index.js —— M3.17 外卖单均 + M3.32 补贴拆行/固定佣金（纯试算页）
//
// ⚠️ 计算下沉：本页**不做任何金额口径计算**，只把用户录入转成分、喂给纯计算单源
//   `utils/takeawayDerive.js`（calcTakeawayOrder / resolveCommission / reverseListedPrice）。
//   试算结果**不落库**；只把「平台参数默认值」经 saveShopSetting 存 shop_switch。
// ⚠️ 付费域：M3 外卖属付费功能（m3_takeaway）⇒ 点「计算」时经 fetchEntitlement 判定，
//   未开通走 openPaywall('takeaway')（与 R159 付费墙口径一致，不自造判断分支）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { openPaywall } = require('../../utils/paywall.js');
const { fetchEntitlement } = require('../../utils/entitlement.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const { calcTakeawayOrder, reverseListedPrice } = require('../../utils/takeawayDerive.js');
// 🔴 R259：产品级开关**单源**（账单导入暂停展示）。⚠️ 只作用"账单"，形态 A/B/C 不受影响 ——
//   它们与账单同出一个 tab 与同一个云函数（云函数按表头自动判形态），藏整个 tab 会连带
//   砍掉外卖单品复盘的输入通道。详见 utils/featureFlags.js 头注 + NOTE_2026-10-10。
const FLAGS = require('../../utils/featureFlags.js');

const TK = TERMS.ledger.takeaway;

// 🔴 表形态**机器值**（必须与云函数 cloudfunctions/importSalesBill/service.js::DISH_SHAPES 逐字一致）。
//   契约：云函数返回的 `shape` 是 **机器值**（'dish_sales' / 'combo_detail' / 'waimai_goods'），
//   不是字母序号。曾在此写 `d.shape === 'C'` ⇒ 与 'waimai_goods' 永不相等 ⇒ **恒走账单分支**
//   （真实缺陷：形态 C 表格渲染出「平台/识别到/归月到」全空白、无平台 picker、门禁必挂）。
//   伴侣守卫：tools/check_shape_machine_value.js。
const DISH_SHAPES = {
  A: 'dish_sales',
  B: 'combo_detail',
  C: 'waimai_goods',
};

// v1.7 形态 C（外卖商品销量）：外卖平台选择项（label 来自 terms 单源；不含 pos —— 堂食不走这条路）
// 🔴 R246：加京东 —— 但**只列 `jd_sku`**（SKU 级 = 商品销量表，正是形态 C 要的表型）；
//   `jd_order`（订单级）是**账单**、走对账路（M3 外卖账单导入），不是"商品销量表" ⇒ 不进本 picker。
//   ⚠️ 两个 enum 值仍都在 `reviewPlatformNames` 里登记（榜单显示名要用），只是 picker 不列 jd_order。
const IMPORT_PLATFORM_OPTIONS = ['meituan', 'eleme', 'taobao', 'jd_sku', 'other']
  .map((v) => ({ value: v, label: (TERMS.card.reviewPlatformNames[v] || v) }));

// 🔴 R250：甲级门禁失败**原因**映射（按 `grade.failures[0].code`）。
//   现场：李老师导入京东「sku对账单下载」（**只有表头的空模板**）⇒ 云函数回
//   `CHANNEL_EMPTY 未解析到任何数据行`，而界面只有一句「门禁未通过，已阻断导入」
//   ⇒ 他看不出"是这份文件没数据"，只能反复重试。原因必须透出。
//   口径：**不直接显示云函数原文**（那会让英文 code / 技术措辞漏到界面），一律经本表映射到
//   `TERMS.ledger.takeaway.*`；未登记的 code 走 `importFailRow` 兜底（fail-safe，不静默）。
//   ⚠️ 键必须与云函数 `service.js::checkGradeA` 产出的 code 逐字一致（漏一个 ⇒ 兜底文案，不空白）。
const FAIL_REASON_KEY = {
  CHANNEL_EMPTY: 'importFailEmpty',
  CHANNEL_TOTAL_MISSING: 'importFailTotal',
  SCHEMA_PLATFORM: 'importFailPlatform',
  SCHEMA_BIZDATE: 'importFailRow',
  SCHEMA_AMOUNT: 'importFailRow',
  SCHEMA_QTY: 'importFailRow',
  REQUIRED_SHOP_ID: 'importFailRow',
  REQUIRED_BIZDATE: 'importFailRow',
  REQUIRED_AMOUNT: 'importFailRow',
};

// 门禁失败 ⇒ 一句人话原因（无失败/未登记 code ⇒ 空串，界面不渲染那一行）。
function failReasonText(grade) {
  const f = grade && grade.failures && grade.failures[0];
  if (!f) return '';
  const key = FAIL_REASON_KEY[f.code] || 'importFailRow';
  return TK[key] || '';
}

function newItem() { return { card_id: '', card_name: '', qty: '1' }; }
function newPack() { return { material_id: '', qty: '1', unit_price_yuan: '' }; }
function defaultParams() {
  return {
    commission_mode: 'rate',
    commission_rate: '6',
    commission_min_yuan: '',
    commission_fixed_yuan: '',
    delivery_fee_yuan: '',
    delivery_subsidy_yuan: '',
    promo_yuan: '',
    pack_fee_yuan: '',
    delivery_customer_yuan: '',
    s_user: { amount_yuan: '', payer: '' },
    s_merchant: { amount_yuan: '', payer: 'merchant' },
  };
}

Page({
  data: {
    t: {
      title: TK.title,
      modeCash: TK.modeCash,
      modeAccrual: TK.modeAccrual,
      modeCashDesc: TK.modeCashDesc,
      modeAccrualDesc: TK.modeAccrualDesc,
      commissionBaseNote: TK.commissionBaseNote,
      dishTitle: TK.dishTitle,
      dishPick: TK.dishPick,
      dishPickPh: TK.dishPickPh,
      qty: TK.qty,
      addDish: TK.addDish,
      packTitle: TK.packTitle,
      packTempPh: TK.packTempPh,
      packQty: TK.packQty,
      addPack: TK.addPack,
      paramsTitle: TK.paramsTitle,
      commissionMode: TK.commissionMode,
      commissionModeRate: TK.commissionModeRate,
      commissionModeFixed: TK.commissionModeFixed,
      commissionRate: TK.commissionRate,
      commissionMin: TK.commissionMin,
      commissionFixed: TK.commissionFixed,
      deliveryFee: TK.deliveryFee,
      deliverySubsidy: TK.deliverySubsidy,
      promoFee: TK.promoFee,
      packFee: TK.packFee,
      deliveryCustomer: TK.deliveryCustomer,
      subsidyTitle: TK.subsidyTitle,
      subsidyUser: TK.subsidyUser,
      subsidyMerchant: TK.subsidyMerchant,
      payer: TK.payer,
      payerUnset: TK.payerUnset,
      payerMerchant: TK.payerMerchant,
      payerPlatform: TK.payerPlatform,
      resultTitle: TK.resultTitle,
      payment: TK.payment,
      receipt: TK.receipt,
      profit: TK.profit,
      receiptRate: TK.receiptRate,
      dishCost: TK.dishCost,
      packCost: TK.packCost,
      revenue: TK.revenue,
      expense: TK.expense,
      reverseTitle: TK.reverseTitle,
      targetProfit: TK.targetProfit,
      reverseBtn: TK.reverseBtn,
      reverseResult: TK.reverseResult,
      rateLowHint: TK.rateLowHint,
      // M3.17 账单导入（批次 F 阶段① 第二 tab）
      importTab: TK.importTab,
      importPick: TK.importPick,
      importPickHint: TK.importPickHint,
      importPlatformLabel: TK.importPlatformLabel,
      importRowsLabel: TK.importRowsLabel,
      importMonthsLabel: TK.importMonthsLabel,
      importTotalLabel: TK.importTotalLabel,
      importExcludedLabel: TK.importExcludedLabel,
      importRowUnit: TK.importRowUnit,
      importDaysUnit: TK.importDaysUnit,
      importConfirm: TK.importConfirm,
      importSuccess: TK.importSuccess,
      // R238：导入成功后的**下游引导**（modal 用键）。`t:{}` 严格说只管 wxml 渲染，
      //   但本页所有可见文案一律在此登记（同一风格），避免"这键到底登记没"要靠猜。
      importSuccessGo: TK.importSuccessGo,
      importGoReview: TK.importGoReview,
      importGoLater: TK.importGoLater,
      importFail: TK.importFail,
      // 🔴 R250：门禁失败原因四键（`failReasonText()` 按 failures[0].code 取）
      importFailEmpty: TK.importFailEmpty,
      importFailTotal: TK.importFailTotal,
      importFailPlatform: TK.importFailPlatform,
      importFailRow: TK.importFailRow,
      importNoFile: TK.importNoFile,
      importEmpty: TK.importEmpty,
      // R259：账单暂停态文案（第三处登记 —— 漏映射 ⇒ 页面渲染成**空白**且零报错，R124 同族）
      importBillPaused: TK.importBillPaused,
      importBillPausedHint: TK.importBillPausedHint,
      // v1.7 形态 C（外卖商品销量）：平台机器判不出 ⇒ 必须选平台
      importShapeCHint: TK.importShapeCHint,
      importPickPlatform: TK.importPickPlatform,
      importPickPlatformHint: TK.importPickPlatformHint,
      importZeroAmountLabel: TK.importZeroAmountLabel,
      save: TERMS.buttons.save,
      cancel: TERMS.buttons.cancel,
      cur: '¥',
      loading: TERMS.ui.loading,
      // ── R234/J4d 行内长提示折叠（本页 2 处：importPickHint 33 字 / importShapeCHint 20 字）──
      // ⚠️ R238：importPickHint 由 22 字改到 **33 字**（补「堂食《菜品销售统计》也从这里导」）——
      //    改的是**文案、不是节点** ⇒ 仍 ≥18 字、仍在折叠块内，`check_hint_fold` 的分层线
      //    （takeaway.keepPlain=1）不受影响。
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语），**不在** TK(takeaway) 里。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    tab: 'calc',          // 'calc' 单均测算 | 'import' 导入
    // 🔴 R259：账单导入开关（单源 utils/featureFlags.js）。false ⇒ 账单预览不展示数字、
    //   不给「确认导入」按钮；形态 A/B/C（堂食菜品统计 / 套餐明细 / 外卖商品销量）照常可导。
    billImportOn: FLAGS.BILL_IMPORT_ENABLED,
    mode: 'cash',          // 'cash' 到手口径 | 'accrual' 总额法口径
    // R234/J4d：行内长提示折叠（本页 2 处，默认收起）。与月录入页 / M2 / assetEdit / amortize **同一实现**。
    hintFold: {},
    dishes: [],            // 候选卡/套餐（含 card_type）
    items: [newItem()],
    packs: [newPack()],
    params: defaultParams(),
    // 承担方 picker：值序 = ['', 'merchant', 'platform']（未选/商家/平台）
    payerOptions: ['', 'merchant', 'platform'],
    payerLabels: [TK.payerUnset, TK.payerMerchant, TK.payerPlatform],
    result: null,          // calcTakeawayOrder 双口径输出
    reverseResultFen: 0,
    targetProfitYuan: '',
    loading: true,
    saving: false,
    // M3.17 账单导入（批次 F 阶段①）
    importFileID: '',      // 云存储 fileID
    importPlatform: '',    // 检测到的平台
    importGrade: null,     // 甲级门禁结果
    importFailReason: '',  // 🔴 R250：门禁失败原因（failures[0].code → 人话），空串 ⇒ 不渲染该行
    importPreview: null,   // 预览 { rows, totals, months, excluded }
    importing: false,      // 防重复提交
    // v1.7 形态 C（外卖商品销量）：platform 机器判不出 ⇒ 必须选平台
    importShape: '',                    // 机器值：'' | 'dish_sales' | 'waimai_goods'（见顶部 DISH_SHAPES）
    shapeC: DISH_SHAPES.C,              // wxml 不读 JS 常量 ⇒ 单源经 data 下发（禁止在 wxml 里写字面量）
    importPlatformOptions: IMPORT_PLATFORM_OPTIONS,   // [{ value, label }]（label 来自 terms 单源）
    importPlatformIndex: -1,            // -1 = 未选
    importPlatformChoice: '',           // 提交值（形态 C 落库用）
    importPlatformChoiceLabel: '',      // picker 显示名
    importZeroAmountQty: [],            // 预览：零元行（v1.7 C-5）
    importPlatformMissing: false,       // 预览期平台必空（云函数回该标志）⇒ 不据此禁用「确认导入」
  },

  onLoad() { this.load(); },

  // R234/J4d：行内提示折叠开关（仓内统一形态，五页同一实现 —— 不各写一套，否则改判据要改五处）。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;                       // 无 key ⇒ 静默返回（不误翻别人的状态）
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
  },

  async load() {
    try {
      await api.ensureShop();
      ui.setTitle(TK.title);
      // 候选卡/套餐：非套餐卡（单品）+ 套餐卡都可作为一单的组成项
      const cd = await api.call('getCostCard', {});
      const dishes = (cd.list || []).map((c) => ({
        card_id: c.card_code,
        name: c.name || '',
        card_type: c.card_type,
        unit_cost_fen: c.total_cost_fen || 0,
        price_fen: c.price_fen || 0,
      }));
      // 读回平台参数默认值（shop_switch.m3_takeaway_params）
      let params = defaultParams();
      try {
        const sc = await api.call('getShopContext', {});
        if (sc.takeaway_params) {
          const saved = JSON.parse(sc.takeaway_params);
          params = Object.assign(defaultParams(), saved, {
            s_user: Object.assign(defaultParams().s_user, saved.s_user),
            s_merchant: Object.assign(defaultParams().s_merchant, saved.s_merchant),
          });
        }
      } catch (e) { /* 参数读失败用默认，不阻断 */ }
      this.setData({ dishes, params, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // ===== 录入事件 =====
  onMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); },
  onItemPick(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const opt = this.data.dishes[Number(e.detail.value)];
    if (!opt) return;
    const items = this.data.items.slice();
    items[idx] = Object.assign({}, items[idx], { card_id: opt.card_id, card_name: opt.name });
    this.setData({ items });
  },
  onItemQty(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const items = this.data.items.slice();
    items[idx] = Object.assign({}, items[idx], { qty: e.detail.value });
    this.setData({ items });
  },
  addItem() { this.setData({ items: this.data.items.concat([newItem()]) }); },
  delItem(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rest = this.data.items.filter((x, i) => i !== idx);
    this.setData({ items: rest.length ? rest : [newItem()] });
  },
  onPackPrice(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const packs = this.data.packs.slice();
    packs[idx] = Object.assign({}, packs[idx], { unit_price_yuan: e.detail.value });
    this.setData({ packs });
  },
  onPackQty(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const packs = this.data.packs.slice();
    packs[idx] = Object.assign({}, packs[idx], { qty: e.detail.value });
    this.setData({ packs });
  },
  addPack() { this.setData({ packs: this.data.packs.concat([newPack()]) }); },
  delPack(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rest = this.data.packs.filter((x, i) => i !== idx);
    this.setData({ packs: rest.length ? rest : [newPack()] });
  },
  onParam(e) {
    const field = e.currentTarget.dataset.field;   // params 顶层字段名
    const params = this.data.params;
    params[field] = e.detail.value;
    this.setData({ params });
  },
  onCommissionMode(e) {
    this.setData({ 'params.commission_mode': e.detail.value });
  },
  onSubsidyAmount(e) {
    const which = e.currentTarget.dataset.which;   // 's_user' | 's_merchant'
    const params = this.data.params;
    params[which].amount_yuan = e.detail.value;
    this.setData({ params });
  },
  onPayer(e) {
    const which = e.currentTarget.dataset.which;
    const idx = Number(e.detail.value);
    const params = this.data.params;
    params[which].payer = this.data.payerOptions[idx] || '';
    this.setData({ params });
  },
  onTargetProfit(e) { this.setData({ targetProfitYuan: e.detail.value }); },

  // ===== 组装订单（元→分） =====
  buildOrder() {
    const fen = (v) => Math.round((Number(v) || 0) * 100);
    const p = this.data.params;
    const items = this.data.items.filter((it) => it.card_id).map((it) => ({ card_id: it.card_id, qty: Number(it.qty) || 0 }));
    const packs = this.data.packs.filter((pk) => fen(pk.unit_price_yuan) > 0).map((pk) => ({ qty: Number(pk.qty) || 0, unit_price_fen: fen(pk.unit_price_yuan) }));
    const params = {
      commission_mode: p.commission_mode,
      commission_rate: Number(p.commission_rate) || 0,
      commission_min_fen: fen(p.commission_min_yuan),
      commission_fixed_fen: fen(p.commission_fixed_yuan),
      delivery_fee_fen: fen(p.delivery_fee_yuan),
      delivery_subsidy_fen: fen(p.delivery_subsidy_yuan),
      promo_fen: fen(p.promo_yuan),
      pack_fee_fen: fen(p.pack_fee_yuan),
      delivery_customer_fen: fen(p.delivery_customer_yuan),
      s_user: { amount_fen: fen(p.s_user.amount_yuan), payer: p.s_user.payer || null },
      s_merchant: { amount_fen: fen(p.s_merchant.amount_yuan), payer: p.s_merchant.payer || null },
    };
    return { items, packs, params };
  },
  lookup(id) {
    const d = this.data.dishes.find((x) => x.card_id === id);
    return d ? { unit_cost_fen: d.unit_cost_fen, price_fen: d.price_fen } : {};
  },

  // ===== 计算（付费墙：点「计算」时拦）=====
  async onCalc() {
    const ent = await fetchEntitlement().catch(() => null);
    if (!ent || !ent.is_active) {
      openPaywall('takeaway', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });
      return;
    }
    const order = this.buildOrder();
    if (order.items.length === 0) { wx.showToast({ title: TK.dishPick, icon: 'none' }); return; }
    const result = calcTakeawayOrder(order, (id) => this.lookup(id));
    const fmt = (fen) => (fen / 100).toFixed(2);
    this.setData({
      result,
      view: {
        payment: fmt(result.cash.payment_fen),
        receipt: fmt(result.cash.receipt_fen),
        profit: fmt(result.cash.profit_fen),
        receipt_rate: result.cash.receipt_rate,
        dish_cost: fmt(result.cash.dish_cost_fen),
        pack_cost: fmt(result.cash.pack_cost_fen),
        revenue: fmt(result.accrual.revenue_fen),
        expense: fmt(result.accrual.expense_fen),
        profit_accrual: fmt(result.accrual.profit_fen),
        rate_low: result.cash.receipt_rate < 70,
      },
    });
  },

  // ===== 挂牌价反算（P* = 商品挂牌总价，不含打包费）=====
  onReverse() {
    const order = this.buildOrder();
    const subsidyMerchantFen =
      (order.params.s_user.payer === 'merchant' ? order.params.s_user.amount_fen : 0) +
      (order.params.s_merchant.payer === 'merchant' ? order.params.s_merchant.amount_fen : 0);
    const cf = this.data.result ? this.data.result.cash.dish_cost_fen : 0;
    const cp = this.data.result ? this.data.result.cash.pack_cost_fen : 0;
    const pStar = reverseListedPrice({
      dish_cost_fen: cf,
      pack_cost_fen: cp,
      target_profit_fen: Math.round((Number(this.data.targetProfitYuan) || 0) * 100),
      subsidy_merchant_fen: subsidyMerchantFen,
      delivery_fee_fen: order.params.delivery_fee_fen,
      delivery_customer_fen: order.params.delivery_customer_fen,
      pack_fee_fen: order.params.pack_fee_fen,
      commission_rate: order.params.commission_rate,
    });
    this.setData({ reverseResultFen: pStar, reverseResultYuan: pStar > 0 ? (pStar / 100).toFixed(2) : '' });
  },

  // ===== 保存平台参数默认值（shop_switch，试算结果不落库）=====
  async onSaveParams() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api.call('saveShopSetting', { takeaway_params: JSON.stringify(this.data.params) });
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
    } catch (e) { api.toastError(e); }
    this.setData({ saving: false });
  },

  // ===== M3.17 账单导入（批次 F 阶段① 第二 tab）=====
  onTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },

  // 选文件 → 上传云存储 → importSalesBill(confirm=false) 预览（不落库）
  async onChooseFile() {
    if (this.data.importing) return;
    try {
      const res = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx'] });
      const file = res.tempFiles && res.tempFiles[0];
      if (!file) return;
      this.setData({ importing: true });
      wx.showLoading({ title: TERMS.ui.loading, mask: true });
      // 上传到云存储（路径带时间戳，防同名覆盖）
      const cloudPath = 'sales_bills/' + Date.now() + '_' + (file.name || 'bill.xlsx');
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: file.path });
      const fileID = up.fileID;
      // 调云函数解析 + 甲级门禁，confirm=false 只预览
      const d = await api.call('importSalesBill', { fileID, confirm: false });
      wx.hideLoading();
      const p = d.preview || null;
      const isC = d.shape === DISH_SHAPES.C;
      let preview = null;
      if (isC) {
        // 形态 C：按天分组（groups），无 months/excluded；零元行必须可见（v1.7 C-5）。
        // 🔴 分 → 元 必须**在括号外**除（R232j 修）：原写法 `(x || 0 / 100).toFixed(2)`
        //   把 `/100` 放进了 `||` 右支 ⇒ 只在 x 为假时才除，真值时原样输出分值（182308.00，放大 100 倍）。
        const amtFen = (p && p.totals && typeof p.totals.amountFen === 'number') ? p.totals.amountFen : 0;
        // 日期范围（首日 ~ 末日）：groups 已按 bizDate 升序排（云函数 sort 保证）
        const gs = (p && p.groups) ? p.groups : [];
        const first = gs.length ? String(gs[0].bizDate || '') : '';
        const last = gs.length ? String(gs[gs.length - 1].bizDate || '') : '';
        preview = {
          groupCount: gs.length,
          dateRangeText: (first && last) ? (first === last ? first : (first + ' ~ ' + last)) : '',
          amountYuan: (amtFen / 100).toFixed(2),
        };
      } else {
        // 账单（批次 F）：amount 分→元、months join 都在这里做（wxml 不做法调用 / 浮点除法）
        preview = p ? {
          rowCount: p.totals.rowCount,
          amountYuan: (p.totals.amountFen / 100).toFixed(2),
          monthsText: (p.months || []).join('、'),
          excludedRows: (p.excluded && p.excluded.rows) || 0,
        } : null;
      }
      this.setData({
        importing: false,
        importFileID: fileID,
        importShape: d.shape || '',
        importPlatform: d.platform || '',
        importGrade: d.grade || null,
        // 🔴 形态 C：预览期 platform 必空（用户还没选）⇒ 云函数回 platform_missing，
        //   此时**不能**用 grade.pass 挡住确认按钮（否则 picker 在按钮旁边却永远点不到 = 死锁）。
        //   平台的阻断在 confirm 分支（云函数 `if (!platform) return fail`）+ 前端
        //   `onConfirmImport` 的 picker 兜底，两处都拦得住，不必在预览期拦。
        importPlatformMissing: !!d.platform_missing,
        // 🔴 R250：门禁没过时把**原因**一并落到 data（wxml 在那句笼统提示下面渲染一行人话）
        importFailReason: failReasonText(d.grade),
        importPreview: preview,
        importZeroAmountQty: (isC && p && p.zeroAmountQty) ? p.zeroAmountQty : [],
        // 形态 C 平台选择重置
        importPlatformIndex: -1,
        importPlatformChoice: '',
        importPlatformChoiceLabel: '',
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ importing: false });
      api.toastError(e);
    }
  },

  // 形态 C 平台选择（v1.7 §2.5：platform 机器判不出 ⇒ 必须选平台；未选 ⇒ 提交禁用）
  onImportPlatformPick(e) {
    const i = Number(e.detail.value);
    const opt = this.data.importPlatformOptions[i];
    this.setData({
      importPlatformIndex: i,
      importPlatformChoice: opt ? opt.value : '',
      importPlatformChoiceLabel: opt ? opt.label : '',
    });
  },

  // 用户确认 → importSalesBill(confirm=true) 落库
  async onConfirmImport() {
    if (!this.data.importFileID) { wx.showToast({ title: TK.importNoFile, icon: 'none' }); return; }
    if (this.data.importing) return;
    // 形态 C：必须先选平台（缺值云函数也会 fail，此处前端兜底拦住，避免白跑一趟）
    const platform = this.data.importShape === DISH_SHAPES.C ? this.data.importPlatformChoice : this.data.importPlatform;
    if (this.data.importShape === DISH_SHAPES.C && !platform) {
      wx.showToast({ title: this.data.t.importPickPlatform, icon: 'none' });
      return;
    }
    this.setData({ importing: true });
    try {
      wx.showLoading({ title: TK.importConfirm, mask: true });
      await api.call('importSalesBill', { fileID: this.data.importFileID, platform, confirm: true });
      wx.hideLoading();
      // 导入成功后清空预览态（含形态 C 的平台选择）
      this.setData({
        importing: false, importFileID: '', importShape: '', importPlatform: '', importGrade: null,
        importFailReason: '',
        importPreview: null, importPlatformIndex: -1, importPlatformChoice: '', importPlatformChoiceLabel: '', importZeroAmountQty: [],
      });
      // 🔴 R238：导入成功后给**下游引导** —— 此前只有一个 toast、零跳转，用户到这就断了。
      //   现场（2026-10-08 李老师真机实测原话）：
      //     「能导入了，导入后显示 已落库，然后呢，去哪里看什么？感觉导入后没有变化呀？」
      //   根因：本页只负责**导入**，展示在 `pages/m3/dishreview`（单品毛利复盘）——
      //         用户不可能自己猜到这个跳跃（且导入入口在「外卖」页、展示在「配方」页，跨了两个模块）。
      //   · 用 showModal 而非 showToast：toast 没有按钮，给不了"下一步"。
      //   · dishreview **不是 tabBar 页**（tabBar = 核算 / 配方 / 我的）⇒ 必须 `navigateTo`。
      //   · 正文**刻意不带条数**：幂等重放分支是 `return ok(prior)`，prior **不含 `written`**
      //     ⇒ 若写成「已写入 {n} 条」，重复导入时会渲染「已写入 0 条」= 把"重导"说成"没导进去"。
      wx.showModal({
        title: TK.importSuccess,
        content: TK.importSuccessGo,
        confirmText: TK.importGoReview,
        cancelText: TK.importGoLater,
        success: (m) => { if (m.confirm) wx.navigateTo({ url: '/pages/m3/dishreview/index' }); },
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ importing: false });
      api.toastError(e);
    }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
