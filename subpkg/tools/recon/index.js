// subpkg/tools/recon/index.js —— M3.21 M1↔M3 率对率对账（只读对照，绝不写 M1）
//
// 数据：getLedger(month) 拿 M1 实际 + getCostCard() 拿全部卡 → 喂 utils/reconDerive.js。
// 🔴 只读：本页只调 getLedger / getCostCard / getShopContext / saveShopSetting，**绝不**调 saveLedger / archiveMonth 等 M1 写路径。
// 🔴 覆盖率分母：用户在页面上填「本月在售菜品数」，存 shop_switch（m3_menu_dish_count）；未填 ⇒ coverage null ⇒ 抑制。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
// 🔴 2026-11-24：非销售耗用（员工餐/试吃/报损）按月存本地，必须按店隔离（与库存页草稿同机制）
const ss = require('../../../utils/shopSwitcher.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const { calcMenuMargin, calcActualDishMargin, reconcile, suppressKeyOf, fixTargetOf } = require('../../../utils/reconDerive.js');
// 🔴 2026-11-24（李老师提需求）：耗用核查 —— 理论耗用 vs 实际耗用 → 偏差 + 倒推应有采购。
//   与上面「率对率」是同一问题的两个视角（率 vs 金额），数据同源（getLedger + getDishReview），
//   故并入本页成一个页面两段，不新建页面（见 review/PLAN_2026-11-24_采购合理性与食材跑冒滴漏_诊断方案.md）。
const { consumeVariance, missingOf } = require('../../../utils/consumeDerive.js');

Page({
  data: {
    t: {
      reconTitle: TERMS.card.reconTitle,
      // 🔴 R717：整页定位句（wxml 用到就必须登记 —— 漏登记 ⇒ 静默空白）
      reconWhatFor: TERMS.card.reconWhatFor,
      reconMenuMargin: TERMS.card.reconMenuMargin,
      // 🔴 R726（R714 E-1）：菜单毛利率是售价加权估算，必须让老板知道它不等于实际菜结构
      reconMenuPriceNote: TERMS.card.reconMenuPriceNote,
      reconWeightedLabel: TERMS.card.reconWeightedLabel,
      reconWeightedNote: TERMS.card.reconWeightedNote,
      reconWeightedMissing: TERMS.card.reconWeightedMissing,
      reconActualMargin: TERMS.card.reconActualMargin,
      reconDiffPp: TERMS.card.reconDiffPp,
      reconDiffFen: TERMS.card.reconDiffFen,
      reconCoverage: TERMS.card.reconCoverage,
      reconCoveragePh: TERMS.card.reconCoveragePh,
      // 🔴 R712：这个数是覆盖率分母，原来只有一个标签、没解释用途（李老师：「本意是算什么的」）
      reconCoverageWhy: TERMS.card.reconCoverageWhy,
      reconSave: TERMS.card.reconSave,
      reconIncludeCombo: TERMS.card.reconIncludeCombo,
      reconMonth: TERMS.card.reconMonth,
      reconSuppressCoverage: TERMS.card.reconSuppressCoverage,
      reconSuppressDetail: TERMS.card.reconSuppressDetail,
      reconSuppressNoCount: TERMS.card.reconSuppressNoCount,
      reconAttributionTitle: TERMS.card.reconAttributionTitle,
      reconAttr1: TERMS.card.reconAttr1,
      reconAttr2: TERMS.card.reconAttr2,
      reconAttr3: TERMS.card.reconAttr3,
      reconAttr4: TERMS.card.reconAttr4,
      // ===== 段二 · 耗用核查（2026-11-24 新增）=====
      // ⚠️ wxml 用到的每个 t.<键> 都必须在此登记（漏登记 ⇒ 静默空白，本仓踩过的坑）
      reconConsumeTitle: TERMS.card.reconConsumeTitle,
      reconConsumeWhatFor: TERMS.card.reconConsumeWhatFor,
      reconConsumeTheoryLabel: TERMS.card.reconConsumeTheoryLabel,
      reconConsumeActualLabel: TERMS.card.reconConsumeActualLabel,
      reconConsumeVarianceLabel: TERMS.card.reconConsumeVarianceLabel,
      reconConsumeShouldPurchase: TERMS.card.reconConsumeShouldPurchase,
      reconConsumeActualPurchaseLabel: TERMS.card.reconConsumeActualPurchaseLabel,
      reconConsumeCoverageNote: TERMS.card.reconConsumeCoverageNote,
      reconConsumeNoJudge: TERMS.card.reconConsumeNoJudge,
      reconConsumeCrossWarn: TERMS.card.reconConsumeCrossWarn,
      reconConsumeGoFix: TERMS.card.reconConsumeGoFix,
      reconConsumeTheoryEst: TERMS.card.reconConsumeTheoryEst,
      reconConsumeNonsales: TERMS.card.reconConsumeNonsales,
      reconConsumeNonsalesPh: TERMS.card.reconConsumeNonsalesPh,
      reconConsumeNonsalesWhy: TERMS.card.reconConsumeNonsalesWhy,
      reconConsumeReal: TERMS.card.reconConsumeReal,
      reconConsumeRealNote: TERMS.card.reconConsumeRealNote,
      cur: '¥',
      loading: TERMS.ui.loading,
      save: TERMS.buttons.save,
    },
    months: [],
    monthIndex: 0,
    curMonth: '',
    includeCombo: false,
    menuDishCount: '',   // 输入框字符串值
    nonsalesYuan: '',    // 员工餐/试吃/报损占用的食材金额（元，字符串）
    savedDishCount: null, // 库内存的（null = 未填）
    result: null,        // { menuPct, actualPct, diffPp, diffFen, suppressed, reason, income_fen }
    loading: true,
    saving: false,
  },

  onLoad() { this.init(); },

  async init() {
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.reconTitle);
      const cur = ui.nowMonth();
      const ml = await api.call('getMonthList', {});
      const months = Array.from(new Set(
        ui.recentMonths(24).concat((ml.list || []).map((m) => m.month)).concat([cur]).filter(Boolean),
      )).sort().reverse();
      // 读本月在售菜品数（shop_switch）
      let savedDishCount = null;
      try {
        const sc = await api.call('getShopContext', {});
        savedDishCount = (sc.menu_dish_count == null) ? null : sc.menu_dish_count;
      } catch (e) { savedDishCount = null; }
      this.setData({
        months,
        curMonth: cur,
        savedDishCount,
        menuDishCount: savedDishCount == null ? '' : String(savedDishCount),
        loading: false,
      });
      // 读回本月已存的「非销售耗用」（按店按月隔离；换设备会丢，第二期迁进云函数时解决）
      const nonsalesFen = this.loadNonsales(cur);
      this.setData({ nonsalesYuan: nonsalesFen > 0 ? api.fenToYuan(nonsalesFen, 2) : '' });
      this.calc(cur, savedDishCount, nonsalesFen);
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  /**
   * 读某月已存的「非销售耗用」（分）；读不到 = 0。
   * 🔴 按店按月隔离（ss.shopKey）。换设备/重装会丢，届时需重填 —— 第二期迁进云函数时解决。
   */
  loadNonsales(month) {
    try {
      const v = wx.getStorageSync(ss.shopKey('nonsales_' + month));
      return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 0;
    } catch (e) { return 0; }
  },

  onMonthChange(e) {
    const i = Number(e.detail.value);
    const m = this.data.months[i];
    if (!m) return;
    // 🔴 必须同时把该月的非销售耗用读回来：否则输入框显示上月数、计算却用 0，两者打架
    const fen = this.loadNonsales(m);
    this.setData({
      monthIndex: i,
      curMonth: m,
      nonsalesYuan: fen > 0 ? api.fenToYuan(fen, 2) : '',
    });
    this.calc(m, this.data.savedDishCount, fen);
  },
  onIncludeCombo(e) { this.setData({ includeCombo: e.detail.value }); this.calc(this.data.curMonth, this.data.savedDishCount); },
  onDishCount(e) { this.setData({ menuDishCount: e.detail.value }); },
  // 🔴 R723：抑制提示的回头路。navigateTo 是压栈，本页只有 onLoad、不重建，
  //   刚输未保存的 menuDishCount 回来仍在（R721 挑毛病曾担心会丢，已按源码排除）。
  goFix() {
    const url = this.data.result && this.data.result.fixUrl;
    if (!url) return;
    wx.navigateTo({ url: url });
  },

  // 🔴 2026-11-24：段二「算不了」时的直达入口（与 goFix 同构，读 consume.missUrl）
  goConsumeFix(e) {
    const url = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url)
      || (this.data.consume && this.data.consume.missUrl);
    if (!url) return;
    wx.navigateTo({ url: url });
  },

  async calc(month, savedCount, nonsalesFen) {
    try {
      // 🔴 R729：第三个数据源 = 免费档 getDishReview 的聚合标量（result.js:730 同款既有用法）。
      //   ui.monthRange 给闭区间，与云端 filterByRange 一致；异常时返回空对象 ⇒ 下面降级，
      //   **绝不因为取数失败就把整个对账页搞挂，也绝不静默把加权口径当成售价口径**。
      const rng = ui.monthRange(month);
      const [ledger, cardsRes, reviewRes] = await Promise.all([
        api.call('getLedger', { month }),
        api.call('getCostCard', {}),
        (rng.from && rng.to)
          ? api.call('getDishReview', { biz_date_from: rng.from, biz_date_to: rng.to })
              .catch(() => ({}))
          : Promise.resolve({}),
      ]);
      const cards = (cardsRes.list || []).map((c) => ({
        card_type: c.card_type,
        price_fen: c.price_fen,
        total_cost_fen: c.total_cost_fen,
      }));
      const menu = calcMenuMargin(cards, { includeCombo: this.data.includeCombo });
      const actual = calcActualDishMargin(ledger);
      // 已建卡菜品数 = 非套餐卡数（套餐是引用型卡，不算独立菜品）
      const cardCount = cards.filter((c) => c.card_type !== 3).length;
      const coverage = (savedCount == null || savedCount <= 0) ? null : (cardCount / savedCount);
      const rec = reconcile({ menuPct: menu.pct, actualPct: actual.pct, coverage, incomeFen: actual.income_fen });
      // 🔴 R298X：抑制原因 → 文案键**走单源**（utils/reconDerive.js::suppressKeyOf）。
      //   修前这里是内联 if/else，只给 3 个分支，把 `menu_no_price`（菜品卡没填售价）与
      //   `actual_no_data`（本月没录收入）**兜底**成「覆盖率不足（<60%）」——而 reconcile 的
      //   判定顺序决定了：能走到这两种 reason，说明覆盖率**是够的**。于是用户在覆盖率 100% 的
      //   页面上读到「覆盖率不足」，会去补在售菜品数，而真问题是没填售价 / 没录收入 ⇒ 诊断反了。
      let suppressText = '';
      if (rec.suppressed) {
        suppressText = TERMS.card[suppressKeyOf(rec, actual.reason)] || TERMS.card.reconSuppressGeneric;
      }
      // 🔴 R723：去哪儿补数只在单源 reconDerive.fixTargetOf 里判，页面不写 reason 字面量
      const fix = fixTargetOf(rec, actual.reason);

      // ===== 段二 · 耗用核查（2026-11-24）=====
      // 🔴 数据同源、口径独立：理论耗用来自 getDishReview.totals.costFen（只含已建卡菜），
      //   实际耗用由 consumeDerive 按库存三栏自己倒轧（并与引擎 real_consume_fen 交叉印证）。
      //   ⚠️ 与段一的「实际毛利率」不是同一个算法（段一用引擎 material_cost_fen，段二用三栏直算），
      //     两者可能因入库时点差异而不同 —— 这是**如实反映**，不是矛盾，页面上都摆出来。
      const cv = consumeVariance({ ledger: ledger, review: reviewRes, nonsalesFen: nonsalesFen });
      let consume;
      if (cv.ok) {
        consume = {
          ok: true,
          theoryText: api.fenToYuan(cv.theoreticalFen, 2),
          actualText: api.fenToYuan(cv.actualFen, 2),
          varianceText: api.fenToYuan(cv.varianceFen, 2),
          // 正数=比应有多花，负数=比应有少用；给符号让老板一眼看方向
          variancePctText: (cv.variancePct > 0 ? '+' : '') + cv.variancePct.toFixed(1) + '%',
          over: cv.varianceFen > 0,
          shouldPurchaseText: api.fenToYuan(cv.shouldPurchaseFen, 2),
          actualPurchaseText: api.fenToYuan(cv.actualPurchaseFen, 2),
          coveragePct: Math.round(cv.qtyCoverage * 100),
          // 🔴 扣掉员工餐/试吃/报损后的「真正说不清的」——这才是老板该去查的数
          nonsalesText: cv.nonsalesFen > 0 ? api.fenToYuan(cv.nonsalesFen, 2) : '',
          realVarianceText: api.fenToYuan(cv.realVarianceFen, 2),
          realVariancePctText: (cv.realVariancePct > 0 ? '+' : '') + cv.realVariancePct.toFixed(1) + '%',
          realOver: cv.realVarianceFen > 0,
          // 覆盖率不满 100% ⇒ 理论耗用是外推估算，页面须标明（见 wxml 理论行下方）
          extrapolated: cv.extrapolated === true,
          // 三栏直算 与 引擎倒轧 不一致 ⇒ 提示"数据可能被改动过"，但不改数
          crossWarn: cv.crossCheckOk === false,
        };
      } else {
        // 🔴 算不了必须说清缺什么、去哪儿补（文案键走单源 missingOf，页面不写 reason 字面量）
        const miss = missingOf(cv.reason);
        consume = {
          ok: false,
          missText: TERMS.card[miss.labelKey] || '',
          missUrl: miss.url,
          coveragePct: (cv.qtyCoverage != null) ? Math.round(cv.qtyCoverage * 100) : null,
        };
      }

      this.setData({
        result: {
          menuPct: menu.pct,
          actualPct: actual.pct,
          diffPp: rec.diffPp,
          diffFen: rec.diffFen,
          suppressed: rec.suppressed,
          reason: rec.reason,
          income_fen: actual.income_fen,
          coverage,
          suppressText,
          // 🔴 R723：直达入口由单源给出；其余抑制原因 fixUrl 为空 ⇒ wxml 不渲染按钮
          fixUrl: fix.url,
          fixLabel: fix.labelKey ? (TERMS.card[fix.labelKey] || '') : '',
          // 展示格式化（分→元、百分号拼接都在 js 做，wxml 只摆位）
          menuPctText: menu.pct == null ? '—' : (menu.pct.toFixed(2) + '%'),
          // 🔴 R729：并列双口径。weighted_menu_pct 缺失/为 null ⇒ 明示原因，绝不静默回落售价口径。
          weightedPct: (reviewRes && typeof reviewRes.weighted_menu_pct === 'number')
            ? reviewRes.weighted_menu_pct : null,
          weightedPctText: (reviewRes && typeof reviewRes.weighted_menu_pct === 'number')
            ? (reviewRes.weighted_menu_pct.toFixed(2) + '%') : '—',
          weightedReason: (reviewRes && reviewRes.weighted_reason) || 'unavailable',
          weightedCoverage: (reviewRes && reviewRes.weighted_coverage) || 0,
          actualPctText: actual.pct == null ? '—' : (actual.pct.toFixed(2) + '%'),
          diffPpText: rec.diffPp == null ? '—' : (rec.diffPp.toFixed(2) + ' pp'),
          diffFenText: rec.diffFen == null ? '—' : api.fenToYuan(rec.diffFen, 2),
        },
        consume,
      });
    } catch (e) { api.toastError(e); }
  },

  // 🔴 员工餐/试吃/报损：占用店里食材但**不产生销售**，不扣掉就会被当成差额，等于冤枉老板。
  //   只算「用店里食材做的」；不含发给员工的现金餐补（在人工费用里）、不含请客招待。
  onNonsales(e) {
    const raw = e.detail.value;
    this.setData({ nonsalesYuan: raw });
    const fen = this.nonsalesFenOf(raw);
    // 读不成数字 ⇒ 不写存储、不重算（避免把错数存下来，页面仍显示上一次的有效结果）
    if (fen == null) return;
    try { wx.setStorageSync(ss.shopKey('nonsales_' + this.data.curMonth), fen); } catch (err) { /* 存不下不影响本次计算 */ }
    this.calc(this.data.curMonth, this.data.savedDishCount, fen);
  },

  /**
   * 元字符串 → 分；空 = 0；读不成/负数 = null（调用方据此不落库、不重算）。
   * 走 api.yuanToFen 而非自己 *100：金额换算必须单一入口（本仓金额精度守卫的要求）。
   */
  nonsalesFenOf(raw) {
    const str = String(raw == null ? '' : raw).trim();
    if (str === '') return 0;
    const n = Number(str);
    if (!isFinite(n) || n < 0) return null;
    return api.yuanToFen(n);
  },

  async onSaveCount() {
    const n = Number(this.data.menuDishCount);
    if (!Number.isInteger(n) || n < 0) { wx.showToast({ title: TERMS.card.reconCoveragePh, icon: 'none' }); return; }
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await api.call('saveShopSetting', { menu_dish_count: n, client_request_id: 'mdc_' + Date.now() });
      this.setData({ savedDishCount: n, menuDishCount: String(n) });
      wx.showToast({ title: TERMS.ui.savedDone, icon: 'success' });
      this.calc(this.data.curMonth, n);
    } catch (e) { api.toastError(e); }
    this.setData({ saving: false });
  },
});
