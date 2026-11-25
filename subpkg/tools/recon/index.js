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
// 🔴 2026-11-24 第二期：原料级用量核对（理论 vs 实际）。口径见 utils/materialUsage.js 文件头
//   （关键：成本卡的 quantity 是**净料克数**，理论采购量要 ÷出成率 ÷换算系数 还原成毛料）。
const { materialUsage, theoryQtyOf, missingKeyOf } = require('../../../utils/materialUsage.js');
// 🔴 2026-11-24 第三期：量价拆分 —— 把「多花了多少」拆成「买贵了多少」+「多买了多少」。
//   恒等式：价格影响 + 数量影响 ≡ 金额总变化（见 utils/priceVariance.js 文件头证明）。
const { priceVariance, priceAlertOf } = require('../../../utils/priceVariance.js');
// 🔴 T1（2026-11-25）：核查数据持久化 —— 云存储 JSON + 本地兜底（换设备能读回）
const store = require('../../../utils/consumeStore.js');

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
      reconConsumeNonsalesTooBig: TERMS.card.reconConsumeNonsalesTooBig,
      // ===== 段三 · 分原料看（第二期）=====
      // ⚠️ wxml 用到的每个 t.<键> 都必须在此登记（漏登记 ⇒ 静默空白）
      reconMaterialTitle: TERMS.card.reconMaterialTitle,
      reconMaterialWhy: TERMS.card.reconMaterialWhy,
      reconMaterialTheory: TERMS.card.reconMaterialTheory,
      reconMaterialOpening: TERMS.card.reconMaterialOpening,
      reconMaterialPurchase: TERMS.card.reconMaterialPurchase,
      reconMaterialClosing: TERMS.card.reconMaterialClosing,
      reconMaterialAmount: TERMS.card.reconMaterialAmount,
      reconMaterialActual: TERMS.card.reconMaterialActual,
      reconMaterialDiff: TERMS.card.reconMaterialDiff,
      reconMaterialNote: TERMS.card.reconMaterialNote,
      reconMaterialPctSuppressed: TERMS.card.reconMaterialPctSuppressed,
      // ===== 第三期 · 量价拆分 =====
      // ⚠️ wxml 用到的每个 t.<键> 都必须在此登记（漏登记 ⇒ 静默空白）
      reconPriceCur: TERMS.card.reconPriceCur,
      reconPriceChange: TERMS.card.reconPriceChange,
      reconPriceImpact: TERMS.card.reconPriceImpact,
      reconQtyImpact: TERMS.card.reconQtyImpact,
      reconPriceNeedAmount: TERMS.card.reconPriceNeedAmount,
      reconPriceNeedPrev: TERMS.card.reconPriceNeedPrev,
      reconPriceNote: TERMS.card.reconPriceNote,
      // ===== 第三期 · 量价拆分 =====
      reconPriceCur: TERMS.card.reconPriceCur,
      reconPriceChange: TERMS.card.reconPriceChange,
      reconPriceImpact: TERMS.card.reconPriceImpact,
      reconQtyImpact: TERMS.card.reconQtyImpact,
      reconPriceNeedAmount: TERMS.card.reconPriceNeedAmount,
      reconPriceNeedPrev: TERMS.card.reconPriceNeedPrev,
      reconPriceNote: TERMS.card.reconPriceNote,
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
      // 🔴 T1：先本地秒开，再异步从云端同步一次（云端有更新就覆盖；云端没有就把本地推上去）
      this.syncFromCloud(cur).catch(() => { /* 云端不可用不影响本次查看 */ });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  /** 上一个月（months 是倒序列表 ⇒ curMonth 的下一项即上月）；找不到 ⇒ 空串 */
  prevMonthOf(month) {
    const ms = this.data.months || [];
    const i = ms.indexOf(month);
    return (i >= 0 && i + 1 < ms.length) ? ms[i + 1] : '';
  },

  /**
   * 读某月已存的「原料盘点」：{ [material_id]: {o, p, c, a} }（数量按采购单位，a=采购金额元）。
   * 与非线性耗用同机制：本地按店按月存，换设备会丢（第二期暂不迁云端）。
   */
  loadMatInv(month) {
    try {
      const v = wx.getStorageSync(ss.shopKey('matinv_' + month));
      return (v && typeof v === 'object') ? v : {};
    } catch (e) { return {}; }
  },

  saveMatInv(month, obj) {
    try { wx.setStorageSync(ss.shopKey('matinv_' + month), obj); } catch (e) { /* 存不下不影响本次计算 */ }
  },

  /**
   * 段三 · 分原料看：从「总额差多少」下到「哪个原料超了」。
   * 🔴 候选自动排序：成本卡里出现过的原料，按「理论采购金额」降序取前 8 —— 老板不用自己挑，
   *   系统已经按值钱程度排好（top3~5 通常覆盖食材成本 60%+，是性价比最高的盘点范围）。
   * 🔴 理论量口径见 utils/materialUsage.js 文件头：净料克数 ÷ 出成率 ÷ 换算系数 = 毛料采购量。
   * @returns {{ok:boolean, reason?:string, missText?:string, rows:Array}}
   */
  buildMaterialView(month, cardsRes, reviewRes, matRes) {
    const matList = (matRes && Array.isArray(matRes.list)) ? matRes.list : [];
    const dineIn = (reviewRes && Array.isArray(reviewRes.dine_in)) ? reviewRes.dine_in : [];
    const cards = (cardsRes && Array.isArray(cardsRes.list)) ? cardsRes.list : [];
    if (!matList.length) {
      return { ok: false, reason: 'no_material', missText: TERMS.card.reconMaterialNeedItems, rows: [] };
    }

    // 逐菜销量：{ card_code → qty }（materialUsage/theoryQtyOf 都用这个口径）
    const qMap = {};
    for (const d of dineIn) {
      const c = String((d && d.card_code) || '').trim();
      if (!c) continue;
      qMap[c] = (Number(qMap[c]) || 0) + (Number(d && d.qty) || 0);
    }

    // 候选：有理论用量的原料，按「理论采购金额」降序（单价×理论量）
    const cand = [];
    for (const m of matList) {
      const th = theoryQtyOf(cards, qMap, m);
      if (!(th.theoryQty > 0)) continue;
      // 🔴🔴 getMaterial 返回的单价字段是 `purchase_price_fen`（分），**不是** `purchase_price`。
      //   2026-11-25 实测抓到的隐蔽 bug：写成 purchase_price ⇒ 恒 0 ⇒ 每个原料的
      //   「理论采购金额」都等于 0 ⇒ 排序全平 ⇒「最值钱的排前面」静默失效
      //   （不崩、不报错、门禁全绿，只有真接上后端才会发现）。
      //   ⚠️ 桩测试救不了这一类：fixture 若按页面写的名字造数，桩自己也绿 —— 与 R737 同族
      //   （「按引擎的样子造而不按库的样子造」）。fixture 必须用**云函数真实出参字段名**。
      //   保留 purchase_price 兜底：万一以后契约改名成裸字段也不至于又静默归零。
      const priceRaw = (m.purchase_price_fen != null) ? m.purchase_price_fen : m.purchase_price;
      const price = Number(priceRaw) || 0;
      cand.push({ m, th, amount: th.theoryQty * price });
    }
    cand.sort((a, b) => b.amount - a.amount);
    const top = cand.slice(0, 8);
    if (!top.length) {
      return { ok: false, reason: 'no_theory', missText: TERMS.card.reconMaterialNeedCards, rows: [] };
    }

    const savedInv = this.loadMatInv(month);
    // 第三期：上月盘点（用于量价对比）。上月没填 ⇒ priceVariance 只给本期均价、不编同比。
    const prevMonth = this.prevMonthOf(month);
    const savedPrev = prevMonth ? this.loadMatInv(prevMonth) : {};
    const invItems = [];
    for (const x of top) {
      const mid = String(x.m.material_id || x.m.id || '').trim();
      const v = savedInv[mid] || {};
      invItems.push({
        material_id: mid,
        opening_qty: Number(v.o) || 0,
        purchase_qty: Number(v.p) || 0,
        closing_qty: Number(v.c) || 0,
      });
    }
    const calcRes = materialUsage({ cards, dineIn, materials: matList, inventoryItems: invItems });
    const byId = {};
    for (const it of (calcRes.items || [])) byId[it.material_id] = it;

    const rows = top.map((x) => {
      const mid = String(x.m.material_id || x.m.id || '').trim();
      const v = savedInv[mid] || {};
      const it = byId[mid] || null;
      // 只有老板真填了数（三栏非全 0）才显示「实际/差」；没填只显示理论值，避免"用 0 斤"的假结论
      const filled = it && (Number(it.actualQty) !== 0 || Number(v.o) || Number(v.p) || Number(v.c));

      // ===== 第三期 · 量价拆分（本月 vs 上月）=====
      // 🔴 恒等式：价格影响 + 数量影响 ≡ 金额总变化（见 utils/priceVariance.js 文件头证明）。
      //   金额持平也可能是"买贵 + 少买"互相抵消 —— 只有拆开才看得见。
      const amtYuanCur = Number(v.a);
      const amtFenCur = (isFinite(amtYuanCur) && amtYuanCur > 0) ? api.yuanToFen(amtYuanCur) : 0;
      const pvObj = (savedPrev[mid]) ? {
        qty: Number(savedPrev[mid].p) || 0,
        amountFen: (() => { const a = Number(savedPrev[mid].a); return (isFinite(a) && a > 0) ? api.yuanToFen(a) : 0; })(),
      } : null;
      const pv = priceVariance({ qty: Number(v.p) || 0, amountFen: amtFenCur }, pvObj);
      const alert = priceAlertOf(pv);

      return {
        material_id: mid,
        name: String(x.m.name || mid),
        unit: String(x.m.purchase_unit || ''),
        openVal: (v.o == null || v.o === '') ? '' : String(v.o),
        purVal: (v.p == null || v.p === '') ? '' : String(v.p),
        closeVal: (v.c == null || v.c === '') ? '' : String(v.c),
        amtVal: (v.a == null || v.a === '') ? '' : String(v.a),
        // G3 连带：理论量 < 0.01 时显示「<0.01」而不是「0.00」（0.00 会被读成根本不用买）
        theoryText: (x.th.theoryQty >= 0.01) ? x.th.theoryQty.toFixed(2) : '<0.01',
        // 实际与差：填了才出；没填留空（wxml 用 wx:if 控制）
        actualText: filled ? it.actualQty.toFixed(2) : '',
        diffText: (filled && it.diffPct != null)
          ? ((it.diffPct > 0 ? '+' : '') + it.diffPct.toFixed(1) + '%') : '',
        diffOver: !!(filled && it.diffPct != null && it.diffPct > 0),
        // G3（审计）：理论量太小 ⇒ 只给差量、不给差率，页面说明原因
        pctSuppressed: !!(it && it.pctSuppressed),
        noTheory: !x.th.theoryQty,
        // 量价拆分展示（只给事实；有值才显示）
        hasPrice: !!(pv && pv.ok),
        priceCurText: (pv && pv.ok) ? api.fenToYuan(pv.priceCurFen, 2) : '',
        priceChgText: (pv && pv.ok && pv.decomposed)
          ? ((pv.priceChangePct > 0 ? '+' : '') + pv.priceChangePct.toFixed(1) + '%') : '',
        priceChgLevel: alert.level,
        priceImpactText: (pv && pv.ok && pv.decomposed) ? api.fenToYuan(Math.abs(pv.priceImpactFen), 2) : '',
        priceImpactOver: !!(pv && pv.ok && pv.decomposed && pv.priceImpactFen > 0),
        qtyImpactText: (pv && pv.ok && pv.decomposed) ? api.fenToYuan(Math.abs(pv.qtyImpactFen), 2) : '',
        qtyImpactOver: !!(pv && pv.ok && pv.decomposed && pv.qtyImpactFen > 0),
        // 没填采购金额 / 上月没填 —— 两种"算不了"要分开说，否则老板会去补错地方
        priceNeedAmount: !!(pv && pv.ok === false && pv.reason === 'no_amount'),
        priceNeedPrev: !!(pv && pv.ok && !pv.decomposed),
      };
    });

    return { ok: true, rows };
  },

  /**
   * 段三输入：老板填原料的期初/采购/期末（数量，按采购单位 = 毛料）。
   * 🔴 只重算段三，不重跑云函数收数（原始返回缓存在 this._matRaw）——否则每敲一个数字就打 4 个云函数。
   * 🔴 读不成数字 ⇒ 不落库（避免把脏值存下来），但输入框已由 setData 保留用户所见。
   */
  onMatQty(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const mid = String(ds.mid || '');
    const k = String(ds.k || '');
    if (!mid || ['o', 'p', 'c', 'a'].indexOf(k) < 0) return;
    const val = (e.detail && e.detail.value != null) ? String(e.detail.value) : '';
    const n = Number(val);
    if (val !== '' && (!isFinite(n) || n < 0)) return;   // 非法输入不落库

    const month = this.data.curMonth;
    const saved = this.loadMatInv(month);
    const cur = saved[mid] || {};
    cur[k] = (val === '') ? '' : n;
    saved[mid] = cur;
    this.saveMatInv(month, saved);

    const raw = this._matRaw;
    // 🔴 T1：上传与渲染**解绑** —— 即使 _matRaw 没缓存（理论上不该发生），老板填的数也必须存下来，
    //   否则会出现"看着填进去了、切个月回来没了"。
    this.schedulePush(month);
    if (!raw) return;
    this.setData({ material: this.buildMaterialView(month, raw.cardsRes, raw.reviewRes, raw.matRes) });
  },

  /**
   * 🔴 T1（2026-11-25）：把本地存储的原料盘点转成 consumeStore 的 items 结构。
   * 本地格式 { [mid]: {o,p,c,a} }（a=采购金额元），云端格式 [{material_id, *_qty, purchase_amount_fen}]。
   */
  matItemsOf(month) {
    const saved = this.loadMatInv(month);
    const out = [];
    for (const mid of Object.keys(saved)) {
      const v = saved[mid] || {};
      const amtYuan = Number(v.a);
      out.push({
        material_id: mid,
        opening_qty: Number(v.o) || 0,
        purchase_qty: Number(v.p) || 0,
        closing_qty: Number(v.c) || 0,
        purchase_amount_fen: (isFinite(amtYuan) && amtYuan > 0) ? api.yuanToFen(amtYuan) : 0,
      });
    }
    return out;
  },

  /** 把云端读到的数据**写回本地**（保持既有读取路径不变：本地永远是渲染来源） */
  applyCloud(month, payload) {
    if (!payload) return;
    try { wx.setStorageSync(ss.shopKey('nonsales_' + month), payload.nonsalesFen || 0); } catch (e) { /* 忽略 */ }
    const inv = {};
    for (const it of (payload.items || [])) {
      if (!it || !it.material_id) continue;
      inv[it.material_id] = {
        o: it.opening_qty,
        p: it.purchase_qty,
        c: it.closing_qty,
        a: it.purchase_amount_fen > 0 ? (it.purchase_amount_fen / 100) : '',
      };
    }
    try { wx.setStorageSync(ss.shopKey('matinv_' + month), inv); } catch (e) { /* 忽略 */ }
  },

  /**
   * 推送到云存储（长期真相）。
   * 🔴 失败不提示、不阻塞：本地已经写过，本次会话不受影响（网络抖动时弹"保存失败"只会吓人）。
   */
  pushToCloud(month) {
    const sid = ss.currentShopId();
    if (!sid) return Promise.resolve({ ok: false, reason: 'no_sid' });
    let payload;
    try {
      payload = store.payloadOf(month, this.loadNonsales(month), this.matItemsOf(month));
    } catch (e) {
      // 构造 payload 就炸（比如 api.yuanToFen 不存在）—— 原来这里会被 setTimeout 吞掉，
      // 表现为"本地写进去了、云端没有"，极难排查。现在留痕。
      const r = { ok: false, reason: 'payload:' + ((e && e.message) || String(e)) };
      try { wx.setStorageSync(ss.shopKey('consume_upload_err'), JSON.stringify(r)); } catch (e2) { /* 忽略 */ }
      return Promise.resolve(r);
    }
    return store.saveCloud(sid, month, payload).then((r) => {
      // 失败留痕（只在本地记一条，不弹 toast 打扰老板）；成功则清掉旧痕迹
      try {
        if (r && r.ok) wx.removeStorageSync(ss.shopKey('consume_upload_err'));
        else wx.setStorageSync(ss.shopKey('consume_upload_err'), JSON.stringify(Object.assign({ month: month }, r)));
      } catch (e3) { /* 忽略 */ }
      return r;
    });
  },

  /** 防抖：老板每敲一个数字不能都发一次上传 */
  schedulePush(month) {
    if (this._pushTimer) clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this._pushTimer = null;
      this.pushToCloud(month);
    }, 800);
  },

  /**
   * 从云端同步一次。
   * 二分：
   *   · 云端**有**数据 ⇒ 覆盖本地并重算（换设备后第一次进页面就是走这条）
   *   · 云端**没有**   ⇒ 把本地现有数据推上去（老用户已填的本地数据自动迁移）
   */
  async syncFromCloud(month) {
    const sid = ss.currentShopId();
    if (!sid) return;
    const cloud = await store.loadCloud(sid, month);
    if (cloud) {
      // 云端更新过才算（防止把刚填的覆盖成旧的）
      const localAt = Number(wx.getStorageSync(ss.shopKey('consume_sync_at_' + month)) || 0);
      if (Number(cloud.updatedAt) > localAt) {
        this.applyCloud(month, cloud);
        try { wx.setStorageSync(ss.shopKey('consume_sync_at_' + month), Number(cloud.updatedAt) || 0); } catch (e) { /* 忽略 */ }
        this.setData({ nonsalesYuan: cloud.nonsalesFen > 0 ? api.fenToYuan(cloud.nonsalesFen, 2) : '' });
        this.calc(month, this.data.savedDishCount, cloud.nonsalesFen || 0);
      }
    } else {
      this.pushToCloud(month);   // 首次/老数据：把本地推上去
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
      const [ledger, cardsRes, reviewRes, matRes] = await Promise.all([
        api.call('getLedger', { month }),
        api.call('getCostCard', {}),
        (rng.from && rng.to)
          ? api.call('getDishReview', { biz_date_from: rng.from, biz_date_to: rng.to })
              .catch(() => ({}))
          : Promise.resolve({}),
        // 原料档案（含出成率/换算系数/单价）：算理论用量必须用。取不到 ⇒ 段三显示算不了，不影响段一段二
        api.call('getMaterial', {}).catch(() => ({})),
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
          // G2（审计）：填的损耗超过实际用掉的料 ⇒ 页面提示核对，但不改数
          nonsalesTooBig: cv.nonsalesTooBig === true,
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

      // 段三 · 分原料看（2026-11-24 第二期）：从「总额差多少」下到「哪个原料超了」
      // 🔴 缓存原始返回：onMatQty 每敲一个数字都要重算段三，不能每次都重跑 4 个云函数
      this._matRaw = { cardsRes, reviewRes, matRes };
      const materialView = this.buildMaterialView(month, cardsRes, reviewRes, matRes);

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
        material: materialView,
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
    this.schedulePush(this.data.curMonth);   // T1：防抖上传云端
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
