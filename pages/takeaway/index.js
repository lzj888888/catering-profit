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

const TK = TERMS.ledger.takeaway;

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
      importConfirm: TK.importConfirm,
      importSuccess: TK.importSuccess,
      importFail: TK.importFail,
      importNoFile: TK.importNoFile,
      importEmpty: TK.importEmpty,
      save: TERMS.buttons.save,
      cancel: TERMS.buttons.cancel,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    tab: 'calc',          // 'calc' 单均测算 | 'import' 账单导入
    mode: 'cash',          // 'cash' 到手口径 | 'accrual' 总额法口径
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
    importPreview: null,   // 预览 { rows, totals, months, excluded }
    importing: false,      // 防重复提交
  },

  onLoad() { this.load(); },

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
      // 预览格式化（wxml 不做法调用 / 浮点除法；amount 分→元、months join 都在这里做）
      const p = d.preview || null;
      const preview = p ? {
        rowCount: p.totals.rowCount,
        amountYuan: (p.totals.amountFen / 100).toFixed(2),
        monthsText: (p.months || []).join('、'),
        excludedRows: (p.excluded && p.excluded.rows) || 0,
      } : null;
      this.setData({
        importing: false,
        importFileID: fileID,
        importPlatform: d.platform || '',
        importGrade: d.grade || null,
        importPreview: preview,
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ importing: false });
      api.toastError(e);
    }
  },

  // 用户确认 → importSalesBill(confirm=true) 落库
  async onConfirmImport() {
    if (!this.data.importFileID) { wx.showToast({ title: TK.importNoFile, icon: 'none' }); return; }
    if (this.data.importing) return;
    this.setData({ importing: true });
    try {
      wx.showLoading({ title: TK.importConfirm, mask: true });
      await api.call('importSalesBill', { fileID: this.data.importFileID, platform: this.data.importPlatform, confirm: true });
      wx.hideLoading();
      wx.showToast({ title: TK.importSuccess, icon: 'success' });
      // 导入成功后清空预览态
      this.setData({ importing: false, importFileID: '', importPlatform: '', importGrade: null, importPreview: null });
    } catch (e) {
      wx.hideLoading();
      this.setData({ importing: false });
      api.toastError(e);
    }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
