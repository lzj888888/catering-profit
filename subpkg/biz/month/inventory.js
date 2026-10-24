// subpkg/biz/month/inventory.js —— 批次 4 · M1 库存录入页（期初/采购/期末盘点，写 shop_inventory）
//
// ⚠️ 计算下沉：金额一律「元」→ 适配层转「分」；真实消耗由服务端 saveLedger 倒轧，前端不算。
// ⚠️ 库存开关：以服务端 getLedger 读回 switches.inventorySwitchOn 为准（前端仅展示）。
// ⚠️ 归档守卫：is_archive=true 且超 7 天宽限 → 硬锁只读；宽限内补录需二次确认。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const ss = require('../../../utils/shopSwitcher.js');   // R443：草稿必须按店隔离
const { TERMS } = require('../../../miniprogram/i18n/terms.js');

const DRAFT_KEY = 'draft_month_inv_';

Page({
  data: {
    t: {
      title: TERMS.inventoryPage.title,
      opening: TERMS.inventoryPage.opening,
      openingHint: TERMS.inventoryPage.openingHint,
      purchase: TERMS.inventoryPage.purchase,
      purchaseHint: TERMS.inventoryPage.purchaseHint,
      closing: TERMS.inventoryPage.closing,
      closingHint: TERMS.inventoryPage.closingHint,
      openingAux: TERMS.inventoryPage.openingAux,
      purchaseAux: TERMS.inventoryPage.purchaseAux,
      closingAux: TERMS.inventoryPage.closingAux,
      save: TERMS.inventoryPage.save,
      hintFormula: TERMS.inventoryPage.hintFormula,
      realConsumePreview: TERMS.inventoryPage.realConsumePreview,
      realConsumePreviewNote: TERMS.inventoryPage.realConsumePreviewNote,
      cur: '¥',
      loading: TERMS.ui.loading,
      archiveReadonly: TERMS.inputPage.archiveReadonly,
      graceNote: TERMS.inputPage.graceNote,
      saveArchiveOverride: TERMS.inputPage.saveArchiveOverride,
      confirmGraceSave: TERMS.inputPage.confirmGraceSave,
      confirmLocked: TERMS.inputPage.confirmLocked,
      openingUnlock: TERMS.inventoryPage.openingUnlock,
      openingFix: TERMS.inventoryPage.openingFix,
      // ── R234/J4e 行内长提示折叠（本页 1 处）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语）。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    // R234/J4e：行内长提示折叠（本页 1 处，默认收起）。仓内统一实现。
    hintFold: {},
    month: '',
    inventorySwitchOn: false,
    isArchive: false,
    inGrace: false,
    readOnly: false,
    openingYuan: '',
    purchaseYuan: '',
    closingYuan: '',
    // B：实时预览「本月真实食材消耗」（纯前端读 getLedger.result.real_consume_fen，零后端改动）
    realConsumeFen: 0,
    realConsumeYuan: '0.00',
    // round103：期初来源三态（自动结转 / 与上月期末不符 / 首月待填）
    openingAuto: false,
    prevMonth: '',
    openingNote: '',
    loading: true,
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
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.load();
  },
  /**
   * 🔴 R443b：盘点草稿回填（可重复调用）。理由同 `input.js::applyDraftFromStorage`：
   *   冷启动 `onShow` 早于 `ensureShop` ⇒ shop_id 为空 ⇒ 不匹配；随后写盘还会用空店覆盖真草稿。
   */
  applyDraftFromStorage() {
    const sid = ss.currentShopId();
    if (!sid) return;   // 店铺上下文未就绪 ⇒ 等 load() 末尾再来
    const draft = wx.getStorageSync(DRAFT_KEY + this.data.month);
    // 🔴 同 M1 填表页 —— 盘点草稿也按店隔离（期初/采购/期末都是**金额**，串店即污染账本）。
    if (!draft || this.data.saved || draft.shop_id !== sid) return;
    this.setData({
      openingYuan: draft.openingYuan !== undefined ? draft.openingYuan : this.data.openingYuan,
      purchaseYuan: draft.purchaseYuan !== undefined ? draft.purchaseYuan : this.data.purchaseYuan,
      closingYuan: draft.closingYuan !== undefined ? draft.closingYuan : this.data.closingYuan,
    });
  },

  onShow() {
    this.applyDraftFromStorage();
    // round104：从「上月库存页」（去改上月期末）返回时，本页期初若处于**自动结转只读态**，
    //   数值已随上月期末变化 ⇒ 必须重读（详见 refreshOpeningCarry 注释）。
    if (this._shown) this.refreshOpeningCarry();
    this._shown = true;
  },
  onHide() {
    // 🔴 R443b：拿不到店铺就不写盘（否则用空店草稿覆盖真草稿）
    const sid = ss.currentShopId();
    if (!sid) return;
    wx.setStorageSync(DRAFT_KEY + this.data.month, {
      shop_id: sid,   // R443：切店后不得回填到别的店
      openingYuan: this.data.openingYuan,
      purchaseYuan: this.data.purchaseYuan,
      closingYuan: this.data.closingYuan,
    });
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.inventoryPage.title);
      const d = await api.call('getLedger', { month: this.data.month });
      const sw = d.switches || {};
      const isArchive = !!d.is_archive;
      const inGrace = ui.withinGrace(d.archived_at || 0, Date.now());
      const readOnly = isArchive && !inGrace;
      // round103：字段名必须与契约一致（getLedger 出参 inventory 已转 snake_case）。
      //   此前本页**照契约**读 snake_case，而后端把 DB 的 camelCase 原样透传 ⇒ 预填恒为空。
      const inv = d.inventory || {};
      const openingAuto = !!d.opening_auto;
      const prevMonth = d.opening_source_month || '';
      const openingFen = Number(inv.opening_fen) || 0;
      const purchaseFen = Number(inv.purchase_fen) || 0;
      const closingFen = Number(inv.closing_fen) || 0;
      const prevFen = Number(d.opening_prev_fen) || 0;
      // 期初三态：① 自动结转（只读）② 与上月期末不符（提示差异 + 修正入口）③ 首月待填
      const openingNote = openingAuto
        ? (prevFen > 0
          ? TERMS.inventoryPage.openingCarryNote(prevMonth)
          : TERMS.inventoryPage.openingEmptyNote)
        : ((openingFen > 0 && prevFen > 0 && prevFen !== openingFen)
          ? TERMS.inventoryPage.openingDiffNote(
            api.fenToYuan(prevFen),
            openingFen > prevFen ? '多' : '少',
            api.fenToYuan(Math.abs(openingFen - prevFen)))
          : '');
      this.setData({
        inventorySwitchOn: !!sw.inventorySwitchOn,
        isArchive, inGrace, readOnly,
        incomeItems: d.income_items || [],          // 原样带回，保存时不丢收入/费用
        expenseItems: d.expense_items || [],
        directConsumeFen: d.direct_consume_fen || 0,
        openingYuan: openingFen > 0 ? api.fenToYuan(openingFen) : '',
        purchaseYuan: purchaseFen > 0 ? api.fenToYuan(purchaseFen) : '',
        closingYuan: closingFen > 0 ? api.fenToYuan(closingFen) : '',
        // B：getLedger 已重算 result，真实消耗直接取（结果页同口径）；本页只读展示，不重算
        realConsumeFen: (d.result && d.result.real_consume_fen) || 0,
        realConsumeYuan: api.fenToYuan((d.result && d.result.real_consume_fen) || 0, 2),
        openingAuto, prevMonth, openingNote,
        loading: false,
      });
      // 🔴 R443b：冷启动 onShow 早于 ensureShop ⇒ 这里兜一次（位置在云端装配之后，不会被覆盖）
      this.applyDraftFromStorage();
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // round104：**只**刷新「期初自动结转」相关的只读态 —— 上月期末改了，本页只读期初必须跟着变，
  //   否则用户一点保存就把**旧期初**落库（与上月期末打架）。
  //   ⚠️ 绝不覆盖用户可编辑的三格（草稿优先）；非自动态只更新来源月份，不碰金额与提示。
  async refreshOpeningCarry() {
    try {
      const d = await api.call('getLedger', { month: this.data.month });
      const openingAuto = !!d.opening_auto;
      const prevMonth = d.opening_source_month || '';
      const prevFen = Number(d.opening_prev_fen) || 0;
      const patch = { prevMonth };
      if (openingAuto) {
        patch.openingAuto = true;
        patch.openingYuan = prevFen > 0 ? api.fenToYuan(prevFen) : '';
        patch.openingNote = prevFen > 0
          ? TERMS.inventoryPage.openingCarryNote(prevMonth)
          : TERMS.inventoryPage.openingEmptyNote;
      }
      this.setData(patch);
    } catch (e) { /* 静默：本页主流程不受影响 */ }
  },

  onOpening(e) { this.setData({ openingYuan: e.detail.value }); },

  // round103：期初默认是「上月期末结转」的**只读**态。老板发现期初算错时给两条腿 ——
  //   ① 根因修正：去改**上月期末**（期初是它的影射，改源头才不会出现「上月 3000 / 本月 5000」两数打架）
  //   ② 就地修正：解锁本页期初手填覆盖（保存即生效，页面会提示与上月期末的差异）
  onUnlockOpening() { this.setData({ openingAuto: false }); },
  onFixPrev() {
    if (!this.data.prevMonth) return;
    wx.navigateTo({ url: '/subpkg/biz/month/inventory?month=' + this.data.prevMonth });
  },
  onPurchase(e) { this.setData({ purchaseYuan: e.detail.value }); },
  onClosing(e) { this.setData({ closingYuan: e.detail.value }); },

  onSave() {
    if (this.data.readOnly) {
      wx.showModal({ title: TERMS.inputPage.archiveReadonly, content: TERMS.inputPage.confirmLocked, showCancel: false });
      return;
    }
    const doSave = () => this.save(!!this.data.isArchive);
    if (this.data.isArchive && this.data.inGrace) {
      wx.showModal({
        title: TERMS.inputPage.saveArchiveOverride,
        content: TERMS.inputPage.confirmGraceSave,
        confirmColor: '#1e3a5f',
        success: (r) => { if (r.confirm) doSave(); },
      });
    } else {
      doSave();
    }
  },

  async save(archiveOverride) {
    // 🔴 R470：无店铺态不要发写请求（服务端回 INVALID_PARAM，前端会显示成「填写有误」）
    const _app = getApp && getApp();
    if (!(_app && _app.globalData && _app.globalData.shop_id)) {
      wx.showModal({ title: TERMS.exp.noShop, content: TERMS.exp.noShopHint, showCancel: false });
      return;
    }
    // 元 → 分（适配层）
    const inventory = {
      opening_fen: api.yuanToFen(this.data.openingYuan),
      purchase_fen: api.yuanToFen(this.data.purchaseYuan),
      closing_fen: api.yuanToFen(this.data.closingYuan),
    };
    try {
      await api.call('saveLedger', {
        month: this.data.month,
        // 原样带回收入/费用/直接消耗（saveLedger 缺省即 []，会清空，必须回带）
        income_items: this.data.incomeItems || [],
        expense_items: this.data.expenseItems || [],
        direct_consume_fen: this.data.directConsumeFen || 0,
        // 库存页只写库存
        inventory,
        archive_override: archiveOverride || undefined,
        client_request_id: 'in_' + Date.now(),
      });
      this.setData({ saved: true });
      wx.removeStorageSync(DRAFT_KEY + this.data.month);
      wx.showToast({ title: TERMS.ui.savedDone, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});