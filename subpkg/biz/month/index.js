// subpkg/biz/month/index.js —— 批次 4/5 · M1 月度经营首页
// 月份选择器 + 结果卡（单数字摘要）+ 待归档徽标 + 结账归档。
// ⚠️ 计算下沉：金额一律取 getLedger 返回的整数「分」，前端仅展示不计算。
// ⚠️ 批次 5 权限（§2.1.1/§2.4）：免费用户摘要卡看参考口径（operation_ref_profit_fen），
//   付费用户（expire_at 有效）看会计利润（total_factor_real_profit_fen）。
//   🔴 R486：已去掉"经营参考估算 / 真实利润"双 tab（并排两个数 ⇒ 老板不知信哪个）；
//   🔴 R488：一个数配一个名 —— 名字由 utils/profitLabel.js 按"盘没盘点"生成，与首页/结果页同名。
//   · 前端只读 payQueryEntitlement 的 expire_at/is_active，不读 plan_id；
//   · 看哪个数不触发付费弹窗（交互边界：仅保存超限/导出触发）；
//   · 到期前 7 天展示常驻提示条（双渠道之一，订阅消息为另一渠道）。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const entitle = require('../../../utils/entitlement.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
// R488：利润标签单一来源（禁止在本页另写"看哪个开关"的判断）
const profitLabel = require('../../../utils/profitLabel.js');
const app = getApp();

Page({
  data: {
    t: {
      m1: TERMS.modules.m1.navTitle,
      freeHint: TERMS.freeHint,
      loading: TERMS.ui.loading,
      month: TERMS.ui.month,
      cur: '¥',
      totalRevenue: TERMS.ui.totalRevenue,
      totalExpense: TERMS.ui.totalExpense,
      grossProfit: TERMS.ui.grossProfit,
      netRef: TERMS.ui.netRef,
      netTrue: TERMS.ui.netTrue,
      profitDiff: TERMS.ui.profitDiff,
      caliberRefHint: TERMS.ui.caliberRefHint,
      caliberTrueHint: TERMS.ui.caliberTrueHint,
      // 🔴 R489：把「倒轧用的期末库存」摆出来 + 一句「去核对」——
      //   系统不判断老板填得对不对（实测有人随手填 28000），只让他看见自己填的数。
      basisGo: TERMS.resultPage.basisGo,
      pendingArchive: TERMS.ui.pendingArchive,
      archivedLock: TERMS.ui.archivedLock,
      graceArchive: TERMS.ui.graceArchive,
      goInput: TERMS.nav.goInput,
      goInventory: TERMS.nav.goInventory,
      goAmortize: TERMS.nav.goAmortize,
      goResult: TERMS.nav.goResult,
      archiveNow: TERMS.nav.archiveNow,
      archivePrev: TERMS.nav.archivePrev,
      clearMonth: TERMS.nav.clearMonth,
      clearMonthTitle: TERMS.nav.clearMonthTitle,
      clearMonthConfirm: TERMS.nav.clearMonthConfirm,
      clearMonthDone: TERMS.nav.clearMonthDone,
      confirmArchive: TERMS.ui.confirmArchive,
      confirmArchivePrev: TERMS.ui.confirmArchivePrev,
      // 🔴 R516：归档点错月的自救（云函数早已支持 archive:false，缺的只是前端入口文案）
      unarchive: TERMS.nav.unarchive,
      confirmUnarchive: TERMS.ui.confirmUnarchive,
      unarchivedDone: TERMS.ui.unarchivedDone,
      history: TERMS.ui.history,
      expireSoonTitle: TERMS.pay.expireSoonTitle,
      renewEntry: TERMS.pay.renewEntry,
      goOrders: TERMS.pay.goOrders,
      expiredLocked: TERMS.pay.expiredLocked,
      monthEmpty: TERMS.uiFix.monthEmpty,
      // 🔴 R372（M1 账套裁决）：无账本月份不能只留一片空白 —— 结果卡是 `wx:if="{{result}}"`，
      //   空月什么都不渲染，老板不知道是"没数据"还是"加载失败"。复用 result 页已有文案（不新增术语键）。
      resultEmpty: TERMS.uiFix.resultEmpty,
      resultEmptyGoInput: TERMS.uiFix.resultEmptyGoInput,
      // ── R234/J4e 行内长提示折叠（本页 1 处）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语）。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    // R234/J4e：行内长提示折叠（本页 1 处，默认收起）。仓内统一实现。
    hintFold: {},
    months: [],              // 可选月份（倒序）
    monthIndex: 0,           // R209：picker 的选中下标（WXML 里不做 indexOf 表达式，避免依赖解析器白名单）
    curMonth: '',
    isPaid: false,           // 权限判定（只读 expire_at / is_active）
    expireSoonDays: 0,       // 到期前 7 天内天数（0 = 不提示）
    expireSoonText: '',      // 预计算提示文案（WXML 不支持函数调用）
    isExpired: false,        // 曾付费但已过期 → 回落到免费档 + 提示
    isArchive: false,
    archivedAtMs: 0,
    canArchive: false,
    prevMonth: '',
    canArchivePrev: false,
    switches: {},
    result: null,
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

  onShow() { this.bootstrap(); },

  async bootstrap() {
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.modules.m1.navTitle);
      // 批次 5：拉权限（只读 expire_at），免费用户 tab 锁定在 free
      let ent = null;
      try { ent = await entitle.fetchEntitlement(); } catch (e) { /* 权限查询失败回落免费档 */ }
      const isPaid = entitle.isPaid(ent);
      const expireSoonDays = entitle.expireSoonDays(ent);
      const isExpired = !!(ent && ent.expire_at > 0 && !isPaid);
      this.setData({
        isPaid,
        expireSoonDays,
        expireSoonText: expireSoonDays > 0 ? TERMS.pay.expireSoonBody(expireSoonDays) : '',
        isExpired,
      });
      const cur = this.data.curMonth || ui.nowMonth();
      const ml = await api.call('getMonthList', {});
      // 月份下拉 = 滚动窗口（最近 24 个月）∪ 已建档月份 ∪ 当前月，倒序去重。
      // 🔴 不能只用 getMonthList：它只返回「已建档」月份（shop_monthly_account 有行）⇒ 新店首次只剩当月，
      //    想补录上个月连选项都没有（李老师真机反馈「月份选择 只有两个月份」）。单源 = utils/ui.recentMonths。
      const months = Array.from(new Set(
        ui.recentMonths(24)
          .concat((ml.list || []).map((m) => m.month))
          .concat([cur])
          .filter(Boolean),
      )).sort().reverse();
      await this.loadMonth(cur);
      this.setData({ months, curMonth: cur, monthIndex: Math.max(0, months.indexOf(cur)), loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  async loadMonth(month) {
    try {
      const d = await api.call('getLedger', { month });
      // 统一用服务端读回的开关（getLedger 返回的 switches 为权威）
      const sw = d.switches || app.globalData.switches;
      // ⚠️ 计算下沉：金额一律由后端返回分整数，此处仅格式化展示（分→元），不做任何业务计算
      // R298·C2：d.result 对无账本记录月**恒为对象**（getLedger 返回「默认空账」）⇒ `|| null` 恒真。
      //   必须用 account_id 判「有没有账本」——与下方 canArchive、首页 index.js:98 同一单源判据。
      const hasLedger = !!d.account_id;
      const r = hasLedger ? (d.result || null) : null;
      // 🔴 R488：这个数（total_factor_real_profit_fen）叫什么 —— 与首页、结果页**同一来源、同一判断**。
      //   盘点过 ⇒「本月利润」；没盘点 ⇒「估算利润」；副标题跟着算法变（摊销开没开也算进去）。
      //   以前本页固定写「真实利润」而结果页写「本月利润」，同一个数两个名 ⇒ 已消灭。
      const labReal = profitLabel.pickProfitLabel(d, 'real');
      const fmt = (v) => (v == null ? '0.00' : api.fenToYuan(v, 2));
      // 🔴 R489：倒轧用的期末库存**原样上屏**。系统分不出"真盘点"和"随手填"（服务端不返回该事实），
      //   所以不判断准不准 —— 把老板自己填的那个数摆出来（"本数按期末库存 ¥28,000 倒轧"），
      //   他一看就想起来"这数我是随手填的"。零判断、零误报，也不撞「不给行业均值」的口径红线。
      const basisText = (labReal.basis === 'stocktake' && labReal.closingFen != null)
        ? TERMS.resultPage.basisStock(fmt(labReal.closingFen)) : '';
      this.setData({
        curMonth: month,
        isArchive: !!d.is_archive,
        archivedAtMs: d.archived_at || 0,
        switches: sw,
        result: r ? {
          income_total_fen: r.income_total_fen,
          expense_total_fen: r.expense_total_fen,
          gross_profit_fen: r.gross_profit_fen,
          gross_margin_pct: r.gross_margin_pct,
          operation_ref_profit_fen: r.operation_ref_profit_fen,
          total_factor_real_profit_fen: r.total_factor_real_profit_fen,
          profit_diff_fen: r.profit_diff_fen,
          // 展示用格式化值
          income_total: fmt(r.income_total_fen),
          expense_total: fmt(r.expense_total_fen),
          gross_profit: fmt(r.gross_profit_fen),
          ref_profit: fmt(r.operation_ref_profit_fen),
          true_profit: fmt(r.total_factor_real_profit_fen),
          profit_diff: fmt(r.profit_diff_fen),
          // R488：标签与副标题（付费档渲染 true_profit 时用；免费档走 t.netRef/caliberRefHint）
          profitTitle: labReal.title,
          profitNote: labReal.note,
          noStockTakeTip: labReal.tip,
          // 🔴 R489：钱扣在哪 —— 摊销金额、一次算清投入、倒轧用的期末库存（都是"解释这个数"的一部分）
          basisText,
          amortText: labReal.amortText,
          lumpText: labReal.lumpText,
        } : null,
      });
      // 归档状态：次月 1 日起软提示（待归档徽标）；归档月只读标识
      const canArchive = !d.is_archive && !!d.account_id;
      // P1：一键归档上月 —— 取「上一月」归档态，给老板每月初一键归档上月（复用 archiveMonth）
      const prevM = ui.prevMonth(month);
      let canArchivePrev = false;
      try {
        const pd = await api.call('getLedger', { month: prevM });
        canArchivePrev = !pd.is_archive && !!pd.account_id;
      } catch (e) { canArchivePrev = false; }
      this.setData({ canArchive, prevMonth: prevM, canArchivePrev });
    } catch (e) { api.toastError(e); }
  },

  onMonthChange(e) {
    // 🔴 R209：`<picker mode="selector">` 的 `e.detail.value` 是**选中项下标（数字）**，不是月份字符串。
    //   旧实现直接 `const month = e.detail.value` 往下传 ⇒ 后端 getLedger 收到 month=0/1/2
    //   ⇒ validate 判 INVALID_PARAM ⇒ 前端弹 ERR.INVALID_PARAM「填写有误，请检查后重试」。
    //   真机表现正是「月份只能停在本月、点任何一个月就报错」（李老师 2026-10-04 反馈）。
    //   ⚠️ 全站其余 12 处 selector picker 都是 `Number(e.detail.value)` 取数组元素，这里是唯一走漏的一处。
    const i = Number(e.detail.value);
    const month = this.data.months[i];
    if (!month || month === this.data.curMonth) return;   // 越界/重复选择：不发起无效请求
    this.setData({ monthIndex: i, loading: true });
    this.loadMonth(month).then(() => this.setData({ loading: false }));
  },
  goInput() { wx.navigateTo({ url: '/subpkg/biz/month/input?month=' + this.data.curMonth }); },
  goInventory() { wx.navigateTo({ url: '/subpkg/biz/month/inventory?month=' + this.data.curMonth }); },
  goAmortize() { wx.navigateTo({ url: '/subpkg/biz/month/amortize?month=' + this.data.curMonth }); },
  goResult() { wx.navigateTo({ url: '/subpkg/biz/month/result?month=' + this.data.curMonth }); },
  goOrders() { wx.navigateTo({ url: '/subpkg/tools/pay/orders' }); },

  onArchive() {
    wx.showModal({
      title: TERMS.nav.archiveNow,
      content: TERMS.ui.confirmArchive,
      confirmColor: '#1e3a5f',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.call('archiveMonth', { month: this.data.curMonth, archive: true });
          wx.showToast({ title: TERMS.ui.archivedDone, icon: 'success' });
          this.loadMonth(this.data.curMonth);
        } catch (e) { api.toastError(e); }
      },
    });
  },

  // 🔴 R376（M1 清空某月）：**软删**，不是硬删 —— 清空后该月回到「未建档」，
  //   重新录入时 saveLedger 会复活同一行（唯一索引 shop_id+month 不允许重建）。
  //   破坏性操作 ⇒ 弹窗必须同时写清「会怎样」和「能不能找回」，不给模糊措辞。
  onClearMonth() {
    const m = this.data.curMonth;
    if (!m) return;
    const content = String(TERMS.nav.clearMonthConfirm || '').replace('{m}', m);
    wx.showModal({
      title: TERMS.nav.clearMonthTitle,
      content,
      // 弹窗按钮 ≤4 字（check_modal_button_len 红线）：行尾不能带注释，否则判据会把注释当键值
      confirmText: TERMS.nav.clearMonthOk,
      confirmColor: '#c0392b',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.call('clearMonth', { month: m, confirm: true });
          wx.showToast({ title: TERMS.nav.clearMonthDone, icon: 'success' });
          // 清空后该月不再出现在「已建档」里 ⇒ 重新拉月份列表 + 重载当月（显示空态卡）
          const ml = await api.call('getMonthList', {});
          const months = Array.from(new Set(
            ui.recentMonths(24).concat((ml.list || []).map((x) => x.month)).concat([m]),
          )).sort().reverse();
          this.setData({ months, monthIndex: Math.max(0, months.indexOf(m)) });
          this.loadMonth(m);
        } catch (e) { api.toastError(e); }
      },
    });
  },

  // P1：一键归档上月（复用 archiveMonth，归档「上一月」）
  onArchivePrev() {
    const m = this.data.prevMonth;
    if (!m) return;
    wx.showModal({
      title: TERMS.nav.archivePrev,
      content: (TERMS.ui.confirmArchivePrev || '').replace('{m}', m),
      confirmColor: '#1e3a5f',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.call('archiveMonth', { month: m, archive: true });
          wx.showToast({ title: TERMS.ui.archivedDone, icon: 'success' });
          this.loadMonth(this.data.curMonth);
        } catch (e) { api.toastError(e); }
      },
    });
  },

  // 🔴 R516：取消归档（归档点错月的自救入口）
  //   背景：云函数 archiveMonth 自始支持 archive:false，但前端从未给入口 ⇒ 老板归档错月只能找客服改库；
  //   且 7 天宽限过后 saveLedger 报「先取消归档再改」，指向的能力并不存在（断链）。
  //   取消后 is_archive=false、该月恢复可编辑，随时可再归档正确月份（不删任何数据）。
  onUnarchive() {
    const m = this.data.curMonth;
    if (!m) return;
    wx.showModal({
      title: TERMS.nav.unarchive,
      content: (TERMS.ui.confirmUnarchive || '').replace('{m}', m),
      confirmColor: '#1e3a5f',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.call('archiveMonth', { month: m, archive: false });
          wx.showToast({ title: TERMS.ui.unarchivedDone, icon: 'success' });
          this.loadMonth(m);
        } catch (e) { api.toastError(e); }
      },
    });
  },

  onPullDownRefresh() { this.bootstrap().then(() => wx.stopPullDownRefresh()); },
});