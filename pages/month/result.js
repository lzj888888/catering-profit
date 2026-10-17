// pages/month/result.js —— 批次 4/5 · M1 结果展示页（收入/费用/毛利/毛利率/双利润/差异）
//
// ⚠️ 计算下沉：所有数值来自 getLedger 后端重算返回的分整数，前端仅格式化展示（分→元）。
// ⚠️ 批次 5 · 到期提醒双渠道：① 结果页**常驻提示条**（到期前 7 天内，读 payQueryEntitlement 的
//   days_left，前端只读 expire_at 系）；② 订阅消息（请求授权，用户拒绝不影响常驻条兜底）。
// ⚠️ 归档态展示：归档月显示只读提示，不提供任何编辑入口。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const entitle = require('../../utils/entitlement.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const exportFile = require('../../utils/exportFile.js');   // R265：导出投递单源（落盘 + 打开 + 转发兜底）
// 🔴 R302：外卖到手账 —— 口径全部在 `utils/takeaway.js`（纯函数单源），页面只做「名字→数字」解析与格式化
const { settleSummary } = require('../../utils/takeaway.js');

Page({
  data: {
    t: {
      title: TERMS.resultPage.title,
      monthTotal: TERMS.resultPage.monthTotal,
      income: TERMS.resultPage.income,
      expense: TERMS.resultPage.expense,
      grossProfit: TERMS.resultPage.grossProfit,
      grossMargin: TERMS.resultPage.grossMargin,
      materialCost: TERMS.resultPage.materialCost,
      realConsume: TERMS.resultPage.realConsume,
      effectiveAmortize: TERMS.resultPage.effectiveAmortize,
      refProfit: TERMS.resultPage.refProfit,
      trueProfit: TERMS.resultPage.trueProfit,
      profitDiff: TERMS.resultPage.profitDiff,
      // C：钱去哪了 故事线（专业术语保留 + 白话流向）
      flowTitle: TERMS.resultPage.flowTitle,
      flowSell: TERMS.resultPage.flowSell,
      flowMaterial: TERMS.resultPage.flowMaterial,
      flowExpense: TERMS.resultPage.flowExpense,
      flowAmort: TERMS.resultPage.flowAmort,
      flowLand: TERMS.resultPage.flowLand,
      flowPer100: TERMS.resultPage.flowPer100,
      flowHint: TERMS.resultPage.flowHint,
      // 暖化：结果页顶部「一句话结论 + 红黄绿带」（装饰性，判定只看真利润正负 + 毛利率）
      bandLabel: TERMS.resultPage.bandLabel,
      bandRed: TERMS.resultPage.bandRed,
      bandYellow: TERMS.resultPage.bandYellow,
      bandGreen: TERMS.resultPage.bandGreen,
      refNote: TERMS.resultPage.refNote,
      trueNote: TERMS.resultPage.trueNote,
      archiveLocked: TERMS.resultPage.archiveLocked,
      // R302：外卖到手账（M1 已录数反算）—— 逐条列举，漏登记 = 页面静默空白（本仓红线，守 check_page_terms）
      settleTitle: TERMS.resultPage.settleTitle,
      settleIncome: TERMS.resultPage.settleIncome,
      settlePlatformFee: TERMS.resultPage.settlePlatformFee,
      settleNet: TERMS.resultPage.settleNet,
      settleNetRate: TERMS.resultPage.settleNetRate,
      settlePerOrder: TERMS.resultPage.settlePerOrder,
      settleUnfilled: TERMS.resultPage.settleUnfilled,
      settleNote: TERMS.resultPage.settleNote,
      settleMissingFee: TERMS.resultPage.settleMissingFee,
      loading: TERMS.ui.loading,
      cur: '¥',
      pendingArchive: TERMS.ui.pendingArchive,
      expireSoonTitle: TERMS.pay.expireSoonTitle,
      renewEntry: TERMS.pay.renewEntry,
      subscribeTip: TERMS.pay.subscribeTip,
      subscribeDenied: TERMS.pay.subscribeDenied,
      exportBtn: TERMS.exportBtn.m1Report,
      exportIng: TERMS.exp.exportIng,
      exportDone: TERMS.exp.exportDone,
      fileSaved: TERMS.exp.fileSaved,
      viewFile: TERMS.exp.viewFile,
      exportHint: TERMS.expFile.hint,
      resultEmpty: TERMS.uiFix.resultEmpty,
      resultEmptyGoInput: TERMS.uiFix.resultEmptyGoInput,
      subItem: TERMS.ledger.subItem,
      // round115：行业指标对照 —— 文案复用 M2 术语（indNames/indLevels/indLevelsGain/indBand/indMine），
      // 本页只新增「区块标题 + 缺项说明 + 两项口径小字 + 默认范围提示」这几条 M1 特有文案。
      indTitle: TERMS.resultPage.indTitle,
      indSub: TERMS.resultPage.indSub,
      indMissing: TERMS.resultPage.indMissing,
      indMarginNote: TERMS.resultPage.indMarginNote,
      indMktNote: TERMS.resultPage.indMktNote,
      indScopeTip: TERMS.resultPage.indScopeTip,
      indScopeChange: TERMS.resultPage.indScopeChange,
      indBand: TERMS.m2.indBand,
      indMine: TERMS.m2.indMine,
      indNames: TERMS.m2.indNames,
      indLevels: TERMS.m2.indLevels,
      indLevelsGain: TERMS.m2.indLevelsGain,
      indGainKey: TERMS.m2.indGainKey,
    },
    month: '',
    isArchive: false,
    loading: true,
    showPer100: false,
    bandClass: '',
    bandText: '',
    r: null,       // 展示用已格式化数据
    // 🔴 三态判据（R298·C1）：必须是「账本存在性」，**不能**用 r —— getLedger 对无账本记录月
    //   返回「默认空账」（getLedger/index.js:4），result 恒存在 ⇒ r 在成功路径恒真 ⇒ 空态分支不可达。
    hasLedger: false,
    incDetail: [],
    expDetail: [],
    showIncDrill: false,
    showExpDrill: false,
    expireSoonDays: 0,
    expireSoonText: '',
    subscribeAsked: false,
    // round115：行业指标对照（后端出 pct/lo/hi/level，中文名与评级文案在前端补）
    inds: [],
    scope: {},
    // R302：外卖到手账的展示对象（`has:false` ⇒ 不渲染该卡；没做外卖的店不显示空卡）
    settle: { has: false },
    bizTypes: TERMS.m2.bizTypes,
    cityTiers: TERMS.m2.cityTiers,
    bizIdx: 1,      // 默认「中式正餐」（bizTypes[1]），与后端 bandOf 的兜底口径一致
    cityIdx: 1,     // 默认「二三线」（cityTiers[1]）
    bizText: '',
    cityText: '',
  },

  onLoad(q) {
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.resultPage.title);
      const d = await api.call('getLedger', { month: this.data.month });
      const res = d.result || {};
      const fen = (v) => api.fenToYuan(v || 0, 2);
      // C：每卖 100 元约落袋多少（纯前端换算，前端不重算利润口径）
      const incomeFen = res.income_total_fen || 0;
      const trueFen = res.total_factor_real_profit_fen || 0;
      const ratio = incomeFen > 0 ? Math.round((trueFen / incomeFen) * 100) : 0;
      const per100Text = (ratio < 0 ? '−' : '') + Math.abs(ratio);
      // 暖化：顶部「一句话结论 + 红黄绿带」（装饰性，仅判后端真利润正负 + 毛利率，不碰引擎）
      //   红=亏损；黄=赚钱但毛利率<30%偏薄；绿=赚钱且毛利率达标。阈值 30 仅作白话提示，非业务红线。
      const gmPct = res.gross_margin_pct != null ? res.gross_margin_pct : 0;
      let bandClass = 'green', bandText = this.data.t.bandGreen;
      if (trueFen <= 0) { bandClass = 'red'; bandText = this.data.t.bandRed; }
      else if (gmPct < 30) { bandClass = 'yellow'; bandText = this.data.t.bandYellow; }
      // D1：保存原始明细（snake_case，含 sub_items），供下钻面板展示（前端不重算金额）
      const incDetail = this.buildDetail(d.income_items || []);
      const expDetail = this.buildDetail(d.expense_items || []);
      // R302：外卖到手账 —— 由 M1 **已录**的数反算（详见 buildSettle 头注）
      const settle = this.buildSettle(d.income_items || [], d.expense_items || []);
      // round115：行业指标对照 —— 后端只回 key/数值/level 枚举，中文名与评级文案在前端补齐（术语单源在前端）
      const inds = this.decorateInds(d.indicators || []);
      const scope = d.indicator_scope || {};
      const sv = this.scopeView(scope);
      this.setData({
        isArchive: !!d.is_archive,
        // R298·C1：账本存在性单源判据 —— 与首页 pages/index/index.js:98 同一字段、同一含义。
        //   缺它 ⇒ 「无账本」这个正常态永远走结果分支 ⇒ 未建档月份显示红带「亏损」+ 全 ¥0.00 + 可导出空报表。
        hasLedger: !!(d && d.account_id),
        incDetail,
        expDetail,
        settle,
        r: {
          income: fen(res.income_total_fen),
          expense: fen(res.expense_total_fen),
          grossProfit: fen(res.gross_profit_fen),
          grossMargin: res.gross_margin_pct != null ? res.gross_margin_pct : '—',
          materialCost: fen(res.material_cost_fen),
          realConsume: fen(res.real_consume_fen),
          effectiveAmortize: fen(res.effective_amortize_fen),
          refProfit: fen(res.operation_ref_profit_fen),
          trueProfit: fen(res.total_factor_real_profit_fen),
          profitDiff: fen(res.profit_diff_fen),
          per100: per100Text,
        },
        loading: false,
        showPer100: incomeFen > 0,
        bandClass, bandText,
        inds, scope,
        bizIdx: sv.bizIdx, cityIdx: sv.cityIdx, bizText: sv.bizText, cityText: sv.cityText,
      });
      // 批次 5：到期前 7 天常驻提示条（双渠道兜底）
      try {
        const ent = await entitle.fetchEntitlement();
        const soon = entitle.expireSoonDays(ent);
        this.setData({ expireSoonDays: soon, expireSoonText: soon > 0 ? TERMS.pay.expireSoonBody(soon) : '' });
      } catch (e) { /* 权限查询失败不阻断结果页 */ }
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // ===== R302：外卖到手账（M1 已录数反算 · 零新增输入 · 零云函数改动）=====

  /**
   * 由 M1 **已录入**的明细反算「外卖到手账」。
   *
   * 🔴 为什么做它（R300 决策 §2「D 主」）：京东/美团的《商品销量》表拿不到、且**平台 App 上老板每天
   *   看的就是汇总级**（营业额 / 回款）。⇒ 把 M1 已录的外卖整体口径用起来，给他看得懂的粒度。
   *   **不新增输入、不新建页面**（否则与 M1 重复 ⇒ 第二套口径，本仓最贵的病）。
   *
   * 分工：本函数只做两件事 —— ①用**术语单源**把"哪一个费用项是佣金/配送费/补贴"认出来；
   *   ②把分整数喂给 `settleSummary`。**金额口径全在 utils/takeaway.js**（纯函数，可单测）。
   *
   * ⚠️ 项名单源：`TERMS.ledger.takeawayMode.reconcileRoles`（佣金/配送费/配送补贴）+
   *   `TERMS.semantic.expenseMktSubsidy`（商家承担补贴）—— **页面零中文字面量**（守 check_page_terms 判据③）。
   *   收入侧用**机器值** `category === 'takeaway'`（与 `pages/month/input.js` 同一判据）。
   *
   * @param {Array} incItems getLedger 出参 `income_items`（含 sub_items）
   * @param {Array} expItems getLedger 出参 `expense_items`
   * @returns {object} 给 wxml 的展示对象（`has:false` ⇒ 不渲染）
   */
  buildSettle(incItems, expItems) {
    const roles = ((TERMS.ledger.takeawayMode || {}).reconcileRoles) || {};
    const subsidyName = TERMS.semantic.expenseMktSubsidy;
    const fenOf = (items, nm) => {
      if (!nm) return 0;
      const it = (items || []).find((x) => x && x.name === nm);
      return it ? (Number(it.amount_fen) || 0) : 0;
    };
    const twRows = (incItems || []).filter((x) => x && x.category === 'takeaway');
    const incomeFen = twRows.reduce((s, x) => s + (Number(x.amount_fen) || 0), 0);
    // 有效订单数只在子项上（R162：qty 不进任何金额，只派生单均）
    let orderCount = 0;
    for (const r of twRows) {
      for (const si of (r.sub_items || [])) orderCount += Number(si && si.qty) || 0;
    }
    const st = settleSummary({
      incomeFen,
      commissionFen: fenOf(expItems, roles.commission),
      deliveryFeeFen: fenOf(expItems, roles.deliveryFee),
      deliverySubsidyFen: fenOf(expItems, roles.deliverySubsidy),
      subsidyFen: fenOf(expItems, subsidyName),
      orderCount,
    });
    if (!st.hasIncome) return { has: false };
    const rate = st.netRatePct;
    return {
      has: true,
      income: api.fenToYuan(st.incomeFen, 2),
      // 佣金/配送费一项都没录 ⇒ **显示「未填」而不是 0.00**（0 会被读成"平台不扣费"，到手额因此偏高）
      platformFeeText: st.platformFeeKnown
        ? (this.data.t.cur + api.fenToYuan(st.platformFeeFen, 2))
        : (this.data.t.settleUnfilled || ''),
      net: api.fenToYuan(st.netFen, 2),
      netRate: rate === null ? null : (rate < 0 ? '−' + Math.abs(rate) : String(rate)),
      perOrder: st.perOrderText,
      showPerOrder: !!st.perOrderText,
      showMissingFee: !st.platformFeeKnown,
    };
  },

  // ===== round115：行业指标对照 =====

  // 后端只回 { key, pct, lo, hi, level, redline, redlineHit }；中文名与评级文案在前端补（术语单源在前端）。
  // 🔴 pct === null 表示「这项没数据」⇒ has=false ⇒ 页面显示「本月没填」，**绝不显示 0%**
  //    （算成 0% 会得出「房租占比 0%，优秀」这种荒谬结论 —— round115 后端真有此 bug，已修并被 selftest 钉住）。
  decorateInds(list) {
    const lvCost = TERMS.m2.indLevels, lvGain = TERMS.m2.indLevelsGain;
    const names = TERMS.m2.indNames, gainKey = TERMS.m2.indGainKey;
    return (list || []).map((it) => {
      const has = it.pct !== null && it.pct !== undefined;
      return {
        key: it.key,
        name: names[it.key] || it.key,
        pct: it.pct,
        lo: it.lo,
        hi: it.hi,
        level: it.level,
        has,
        lvText: (it.key === gainKey ? lvGain : lvCost)[it.level] || '',
      };
    });
  },

  // 业态/城市 → picker 索引与显示文案；库里没存过则回落「中式正餐 × 二三线」
  //（与后端 bandOf 的兜底一致：`BANDS[bizKey] || BANDS.dining` + CITY_TIERS[1]）
  scopeView(scope) {
    const bs = TERMS.m2.bizTypes, cs = TERMS.m2.cityTiers;
    let bi = bs.findIndex((x) => x.key === (scope && scope.biz_type));
    let ci = cs.findIndex((x) => x.key === (scope && scope.city_tier));
    if (bi < 0) bi = 1;
    if (ci < 0) ci = 1;
    return { bizIdx: bi, cityIdx: ci, bizText: bs[bi].name, cityText: cs[ci].name };
  },

  onBiz(e) { this.saveScope({ biz_type: TERMS.m2.bizTypes[Number(e.detail.value)].key }); },
  onCity(e) { this.saveScope({ city_tier: TERMS.m2.cityTiers[Number(e.detail.value)].key }); },

  // 业态/城市是「你的店是什么」，一次设定长期有效 ⇒ 落库（shop 集合）；改完重拉，参考带跟着变
  async saveScope(patch) {
    try {
      await api.call('saveShopSetting', Object.assign({
        shop_id: (getApp().globalData && getApp().globalData.shop_id) || '',
      }, patch));
      await this.load();
    } catch (e) {
      api.toastError(e);
    }
  },

  // D1：把后端明细（snake_case 大类列表）转为下钻面板数据（大类 → 细项，金额仅格式化展示）
  buildDetail(items) {
    return (items || []).map((it) => {
      const subs = (it.sub_items || []).map((si) => ({
        name: si.sub_item || '',
        amount: si.amount_fen ? api.fenToYuan(si.amount_fen, 2) : '0.00',
      }));
      return {
        name: it.name || '',
        amount: it.amount_fen ? api.fenToYuan(it.amount_fen, 2) : '0.00',
        sub_items: subs,
      };
    });
  },

  // D1：切换下钻面板（income / expense）
  toggleDrill(e) {
    const kind = e.currentTarget.dataset.kind;   // 'income' | 'expense'
    const key = kind === 'income' ? 'showIncDrill' : 'showExpDrill';
    this.setData({ [key]: !this.data[key] });
  },

  // 订阅消息授权（双渠道①）；拒绝不影响常驻提示条（兜底），提示一次即可
  onAskSubscribe() {
    if (this.data.subscribeAsked) return;
    this.setData({ subscribeAsked: true });
    wx.requestSubscribeMessage({
      tmplIds: [], // 模板 ID 由后端配置下发；当前阶段未配置 → 直接回落兜底
      success: () => {
        // 授权成功：后续到期前 7 天由 payExpireNotify 定时推送
      },
      fail: () => {
        wx.showToast({ title: TERMS.pay.subscribeDenied, icon: 'none' });
      },
    });
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
  goOrders() { wx.navigateTo({ url: '/pages/pay/orders' }); },
  goInput() { wx.navigateTo({ url: '/pages/month/input?month=' + this.data.month }); },

  // M1 报表导出：权限只读 expire_at（前端先查，后端 exportData 再兜底校验）；免费用户触发付费墙
  async onExport() {
    // 2026-09-20 加固：此前整段无 try/catch —— 一旦取权益/弹窗任一步抛异常，点击就是「毫无反应」，
    // 用户无从判断是没权限还是坏了。现统一兜底：任何异常都 toast 出来（可证伪，不静默）。
    try {
      const ent = await require('../../utils/entitlement.js').fetchEntitlement().catch(() => null);
      if (!ent || !ent.is_active) {
        require('../../utils/paywall.js').openPaywall('export', {
          shopId: (getApp().globalData && getApp().globalData.shop_id) || '',
        });
        return;
      }
      await this.doExport();
    } catch (e) {
      require('../../utils/api.js').toastError(e);
    }
  },

  async doExport() {
    wx.showLoading({ title: this.data.t.exportIng, mask: true });   // 进度提示：生成中不阻塞
    try {
      const d = await require('../../utils/api.js').call('exportData', {
        scope: 'm1_report',
        // R265：'excel'(=CSV) 在微信里打不开（openDocument 不认 csv）⇒ 改要真 xlsx
        format: 'xlsx',
        month: this.data.month,
        client_request_id: 'ex_' + Date.now(),
      });
      wx.hideLoading();
      exportFile.deliver(d);   // 落盘 + 打开；打不开时给「转发到微信」兜底（提示/成功态由单源负责）
    } catch (e) {
      wx.hideLoading();
      require('../../utils/api.js').toastError(e);
    }
  },
});