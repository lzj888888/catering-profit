// subpkg/biz/month/result.js —— 批次 4/5 · M1 结果展示页（收入/费用/毛利/毛利率/一个利润）
//
// ⚠️ R484 起：本页**只出一个利润**（会计利润 total_factor_real_profit_fen），不再并排参考口径；
//   🔴 R488：这个数的标题/副标题由 utils/profitLabel.js 按"盘没盘点"生成，与首页/月首页同名。
//
// ⚠️ 计算下沉：所有数值来自 getLedger 后端重算返回的分整数，前端仅格式化展示（分→元）。
// ⚠️ 批次 5 · 到期提醒双渠道：① 结果页**常驻提示条**（到期前 7 天内，读 payQueryEntitlement 的
//   days_left，前端只读 expire_at 系）；② 订阅消息（请求授权，用户拒绝不影响常驻条兜底）。
// ⚠️ 归档态展示：归档月显示只读提示，不提供任何编辑入口。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const entitle = require('../../../utils/entitlement.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
// 🔴 R311：体检算法（纯函数）—— 保本区间/归因/健康营收/结构性诊断
const BE = require('../../../utils/breakeven.js');
// R443：现金存本机（不上云 —— 这是老板最敏感的数，先本地）
const RUNWAY_CASH_KEY = 'runway_cash_v1';
// R444 收口：金额可读性判定（纯函数）—— 不静默清洗，读不成必须说出来（与 #25 同口径）
const amt = require('../../../utils/amountInput.js');
// 🔴 R488：利润标题/副标题的**单一来源** —— 与首页、月首页同一份判断（名随数走）
const profitLabel = require('../../../utils/profitLabel.js');

// 🔴 R313：上一个月（跨月对比用）。纯字符串运算，不依赖 this / ui。
function prevMonthOf(m) {
  const mt = /^(\d{4})-(\d{2})$/.exec(String(m || ''));
  if (!mt) return '';
  let y = Number(mt[1]); let mo = Number(mt[2]) - 1;
  if (mo === 0) { mo = 12; y -= 1; }
  return y + '-' + String(mo).padStart(2, '0');
}
const exportFile = require('../../../utils/exportFile.js');   // R265：导出投递单源（落盘 + 打开 + 转发兜底）
// 🔴 R302：外卖到手账 —— 口径全部在 `utils/takeaway.js`（纯函数单源），页面只做「名字→数字」解析与格式化
const { settleSummary } = require('../../../utils/takeaway.js');
// 🔴 R395：分享卡片标题装配（纯函数单源）—— 见 `utils/shareCard.js` 头注
const shareCard = require('../../../utils/shareCard.js');
// 🔴 R464（PLAN_AI P0-①）：AI 诊断包 —— 纯函数装配，不调模型、不联网（见 utils/diagnosisPack.js 头注）
const pack = require('../../../utils/diagnosisPack.js');
// 🔴 R466：truncated 的单源判据（不许在页面里自己读 `d.truncated`）——
//   本页不渲染截断横幅，但**必须消费**：诊断包会把「明细被截断」写进文本（可见降级）。
const dh = require('../../../utils/dataHealth.js');
// 🔴 R399（队列 #16）：异常核对清单「规则层」—— 纯函数，只跟本店自己的历史比（见 `utils/anomalyRules.js` 头注）。
//   本页只做两件事：① 编排取数（月份列表 + 逐月账本）② 把规则层的出参译成页面文案。
//   ⚠️ 阈值/中位数/排序一律在规则层，页面零阈值、零金额差（PLAN_AI §3 口径红线）。
const anomaly = require('../../../utils/anomalyRules.js');

// 清单最多显示几项（其余折叠成一句「另有 N 项」）：老板一次最多看 5 条，再多等于没看。
//   与规则层的 maxItems(=20) 不是同一件事：那是**算多少**，这是**显示多少**。
const ANOM_SHOW_MAX = 5;

Page({
  data: {
    // 🔴 R314：体检卡「依据」默认收起（老板先看结论/动作，想追依据再展开）
    beMore: false,
    cashYuan: '',       // R443：账面可动用现金（本机保存）
    runwayText: '',     // R443：可撑月数文案
    runwayNoData: false, // R443：固定支出没填全
    runwayBadCash: false, // R444：现金那格读不成金额（带逗号/空格/全角…）
    t: {
      beMoreShow: TERMS.card.beMoreShow,
      beMoreHide: TERMS.card.beMoreHide,
      // R433：行业指标对照卡文案
      indTitle: TERMS.modules.m1.indTitle,
      indBandLbl: TERMS.modules.m1.indBandLbl,
      indEmpty: TERMS.modules.m1.indEmpty,
      indFoot: TERMS.modules.m1.indFoot,
      // R443：结果页「下一步」—— 去看是哪道菜在拖毛利
      nextDishReview: TERMS.m2.nextDishReview,
      // R443：现金流体检
      runwayTitle: TERMS.modules.m1.runwayTitle,
      runwayLabel: TERMS.modules.m1.runwayLabel,
      runwayHint: TERMS.modules.m1.runwayHint,
      runwayMonthsPre: TERMS.modules.m1.runwayMonthsPre,
      runwayMonthsSuf: TERMS.modules.m1.runwayMonthsSuf,
      runwayNoData: TERMS.modules.m1.runwayNoData,
      runwayNeedInput: TERMS.modules.m1.runwayNeedInput,
      runwaySaved: TERMS.modules.m1.runwaySaved,
      runwayOver2y: TERMS.modules.m1.runwayOver2y,
      runwayBadCash: TERMS.modules.m1.runwayBadCash,
      bePathText: TERMS.card.bePathText,
      bePathRevOnly: TERMS.card.bePathRevOnly,
      beMomMore: TERMS.card.beMomMore,
      beMomLess: TERMS.card.beMomLess,
      beYuanUnit: TERMS.card.beYuanUnit,
      beMarginDrop: TERMS.card.beMarginDrop,
      beMarginRise: TERMS.card.beMarginRise,
      beHealthyText: TERMS.card.beHealthyText,
      // 🔴 R529（2026-10-27 审计）：`result.js:542` 读 `T.beHealthyScope`，但这里**一直没映射**这个键
      //   ⇒ `|| ''` 兜底 ⇒ 那句「按「业态 · 城市」的行业区间算」**恒空白、零报错**（R480 修完的可见凭证是空的）。
      //   守卫只守「terms 里有这个键」，不守「页面把它映射进了 data.t」⇒ 盲区。现补上。
      beHealthyScope: TERMS.card.beHealthyScope,
      beRangeText: TERMS.card.beRangeText,
      beWan: TERMS.card.beWan,
      beGmText: TERMS.card.beGmText,
      beVerdictLoss: TERMS.card.beVerdictLoss,
      beVerdictWin: TERMS.card.beVerdictWin,
      beAttrLead: TERMS.card.beAttrLead,
      beAttrDenom: TERMS.card.beAttrDenom,
      beAttrNumer: TERMS.card.beAttrNumer,
      beTitle: TERMS.card.beTitle,
      beBreakeven: TERMS.card.beBreakeven,
      // R482：确定的盈亏平衡点（结论层用）+ 区间来源标注（不许让老板以为是"算不准"）
      bePoint: TERMS.card.bePoint,
      bePointNote: TERMS.card.bePointNote,
      beMargin: TERMS.card.beMargin,
      beHealthy: TERMS.card.beHealthy,
      beStructural: TERMS.card.beStructural,
      beNoData: TERMS.card.beNoData,
      beUnknown: TERMS.card.beUnknown,
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
      trendTitle: TERMS.resultPage.trendTitle,
      trendNote: TERMS.resultPage.trendNote,
      trueProfit: TERMS.resultPage.trueProfit,
      // R485：不盘点月份给提示（WXML 引用 t.noStockTakeTip ⇒ 必须在这里注册，否则 page-terms 判红）
      noStockTakeTip: TERMS.resultPage.noStockTakeTip,
      profitDiff: TERMS.resultPage.profitDiff,
      profitDiffWhy: TERMS.resultPage.profitDiffWhy,
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
      // 🔴 R399（队列 #16）：异常核对清单（文案口径 = 只跟自店历史比，不给金额差/行业均值）
      anomTitle: TERMS.resultPage.anomTitle,
      anomSub: TERMS.resultPage.anomSub,
      anomBasis: TERMS.resultPage.anomBasis,
      anomEmpty: TERMS.resultPage.anomEmpty,
      anomMore: TERMS.resultPage.anomMore,
      anomGo: TERMS.resultPage.anomGo,
      anomUp: TERMS.resultPage.anomUp,
      anomDown: TERMS.resultPage.anomDown,
      anomMissing: TERMS.resultPage.anomMissing,
      anomNew: TERMS.resultPage.anomNew,
      anomMarginUp: TERMS.resultPage.anomMarginUp,
      anomMarginLow: TERMS.resultPage.anomMarginLow,
      anomHighTag: TERMS.resultPage.anomHighTag,
      loading: TERMS.ui.loading,
      cur: '¥',
      pendingArchive: TERMS.ui.pendingArchive,
      // 🔴 R489：倒轧依据那行的可点提示（「本数按期末库存 ¥X 倒轧 · 去核对」）
      basisGo: TERMS.resultPage.basisGo,
      expireSoonTitle: TERMS.pay.expireSoonTitle,
      renewEntry: TERMS.pay.renewEntry,
      subscribeTip: TERMS.pay.subscribeTip,
      subscribeDenied: TERMS.pay.subscribeDenied,
      exportBtn: TERMS.exportBtn.m1Report,
      aiPackBtn: TERMS.exportBtn.aiPackBtn,
      aiPackHint: TERMS.exportBtn.aiPackHint,
      aiPackLoading: TERMS.exportBtn.aiPackLoading,
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
    // 🔴 R399：核对清单的展示对象（`has:false` ⇒ 整卡不渲染）。
    //   为什么历史不足时连卡都不出：只有 1 个月不叫「历史」，摆一张空卡会让人以为"没问题"。
    anom: { has: false },
    trend: [],   // R443：近 6 个月走势 [{month,label,text,h,up,isCur}]
    profitCalcOpen: false,   // R515：利润卡内「这笔钱怎么算的」折叠态（默认收起，点开原地展开）
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
    // R443：恢复上次填的现金（本机保存，不读云 —— 这个数老板最敏感）
    try {
      const c = wx.getStorageSync(RUNWAY_CASH_KEY);
      if (c !== '' && c != null) this.setData({ cashYuan: String(c) });
    } catch (err) { /* 忽略 */ }
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
      // 🔴🔴 R480 修（真机暴露，2026-10-25）：**inds 必须先于 be 定义**。
      //   原因：`buildBreakeven` 的「达标营业额」要取 inds 里的业态区间（房租/人工上限）。
      //   原实现把 `const inds` 写在 `const be` **之后** ⇒ 同一块作用域内的 TDZ
      //   （Cannot access 'inds' before initialization）⇒ be 拿不到业态区间、回落写死常数
      //   ⇒ **改业态时保本营收/达标营业额纹丝不动**（李老师真机反馈"现在是没有变化的"）。
      //   ⚠️ 顺序本身就是判据：别再把这三行挪回 be 后面（已由 check_m1_indicator_view H-⑨ 守）。
      const inds = this.decorateInds(d.indicators || []);
      const scope = d.indicator_scope || {};
      const sv = this.scopeView(scope);
      // 🔴 R311：体检（纯读 M1 结果做解释，**不改任何既有计算**）
      // 🔴 R313：上月真钱利润（跨月对比）。**只读、失败不阻断**——拿不到就当没上月，
      //   绝不编 0（编 0 会让"比上月多赚"凭空出现）。
      let prevProfitFen = null;
      try {
        const curM = d.month || this.data.month || '';
        const pm = prevMonthOf(curM);
        if (pm) {
          const pd = await api.call('getLedger', { month: pm });
          // 🔴 R510：`getLedger` 的利润在 `data.result` 里（ok() 不摊平、api.call 只解到 data），
          //   原实现读顶层 `pd.total_factor_real_profit_fen` 恒 undefined ⇒ 上月对比从不生效。
          const pdr = (pd && pd.result) || {};
          if (pd && pd.account_id && pdr.total_factor_real_profit_fen != null) {
            prevProfitFen = Number(pdr.total_factor_real_profit_fen);
          }
        }
      } catch (e) { prevProfitFen = null; }
      const be = this.buildBreakeven(d, res, prevProfitFen, inds);
      // 🔴 R395（队列 #11）：分享卡片取数 —— 只留**原始分**。分享时不再从展示串反解：
      //   展示串经过 `fenToYuan(2)` ⇒「9,160.00」，反解回分必然带格式误差，也会在分享路径上再算一遍业务。
      // ⚠️ 这里**不放** `hasLedger`：它的单源是下面 setData 里那句（R298 定的 `d.account_id` 判据），
      //   在这里再写一遍 `!!(d && d.account_id)` 就是同一语义两份实现 —— 分享时由 handler 读 `data.hasLedger`。
      const shareFacts = {
        month: d.month || this.data.month || '',
        breakEvenFen: (be && be.ok) ? (Number(be.breakevenFen) || 0) : 0,
        profitFen: Number(res.total_factor_real_profit_fen) || 0,
      };
      // （inds / scope / sv 已在上方定义 —— 见上面 R480 顺序注释，勿挪动）
      // R443：固定支出金额（分）留给「可撑月数」用；缺项为 null，不按 0 算
      this._fixedFen = (d && d.fixed_items_fen) || null;
      this.recalcRunway();
      // R464：诊断包只搬「已经算好的数」—— 原始分口径单独留一份，避免从展示串反解
      this._res = res;
      this._ledger = d;
      // 🔴 R488：利润卡的「标题 / 副标题 / 没盘点提示」统一由单一来源产出 ——
      //   以前这里是 `inventorySwitchOn ? 本月利润 : 估算利润`，只看开关、不看**有没有真盘点**，
      //   而且和首页、月首页各判一套 ⇒ 同一个数出现三个名。现在三处共用这一份。
      const lab = profitLabel.pickProfitLabel(d, 'real');
      // 🔴 R479：差异说明 / 参考口径注释必须按「参考口径用的哪份食材消耗」**条件化** ——
      //   固定写「食材 + 摊销」在两种情形下会说谎：
      //     ① R477 后库存模式没填消耗 ⇒ 参考已回落倒轧 ⇒ 差异**只剩摊销**，没有食材项；
      //     ② 库存关 ⇒ 两个口径用同一份消耗 ⇒ 差异同样只剩摊销。
      //   取不到来源（旧账/脏数据）⇒ 回落到不点名食材的中性兜底文案，绝不硬猜。
      const _src = (res && res.ref_material_source) || '';
      const _tp = TERMS.resultPage;
      const t = Object.assign({}, this.data.t, {
        profitDiffWhy: _src === 'reverse' ? _tp.profitDiffWhyAmort
          : (_src === 'direct' ? _tp.profitDiffWhyConsume : _tp.profitDiffWhy),
        refNote: _src === 'reverse' ? _tp.refNoteReverse : _tp.refNoteDirect,
      });
      this.setData({
        isArchive: !!d.is_archive,
        t,
        // R298·C1：账本存在性单源判据 —— 与首页 pages/index/index.js:98 同一字段、同一含义。
        //   缺它 ⇒ 「无账本」这个正常态永远走结果分支 ⇒ 未建档月份显示红带「亏损」+ 全 ¥0.00 + 可导出空报表。
        hasLedger: !!(d && d.account_id),

        incDetail,
        expDetail,
        settle,
        be,
        shareFacts,
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
          // 🔴 R488：标题按"盘没盘点 + 摊销开没开"选，副标题说清算的是哪种账；
          //   没有真盘点时才给提示（有盘点还给提示 = 噪音）。判断全在 utils/profitLabel.js。
          profitTitle: lab.title,
          profitNote: lab.note,
          noStockTakeTip: lab.tip,
          // 🔴 R489：钱扣在哪 + 倒轧用了哪个期末库存（都是"解释这个数"，与标题同一来源）
          //   · amortText：实际扣掉的摊销金额（开关关/没摊销时为空或"本月没有摊销"）
          //   · lumpText：「一次算清」的投入，只在当月扣、不受摊销开关控制
          //   · profitBasis：把老板填的期末库存摆出来 —— 系统不判断准不准，让他自己看
          amortText: lab.amortText,
          lumpText: lab.lumpText,
          profitBasis: (lab.basis === 'stocktake' && lab.closingFen != null)
            ? TERMS.resultPage.basisStock(fen(lab.closingFen)) : '',
          per100: per100Text,
        },
        loading: false,
        showPer100: incomeFen > 0,
        bandClass, bandText,
        inds, scope,
        bizIdx: sv.bizIdx, cityIdx: sv.cityIdx, bizText: sv.bizText, cityText: sv.cityText,
      });
      // 🔴 R399：核对清单在**主数据渲染完之后**再取（最多 6 次 getLedger）——
      //   `this.loadChecklist` 内部自带 try/catch 且**不返回 Promise 给调用方**：
      //   结果页先出，清单后到；清单失败只丢这张卡，不影响任何已算出的数。
      this.loadChecklist(d);
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
   *   收入侧用**机器值** `category === 'takeaway'`（与 `subpkg/biz/month/input.js` 同一判据）。
   *
   * @param {Array} incItems getLedger 出参 `income_items`（含 sub_items）
   * @param {Array} expItems getLedger 出参 `expense_items`
   * @returns {object} 给 wxml 的展示对象（`has:false` ⇒ 不渲染）
   */
  // 🔴 R311：体检结论（**只解释、不重算利润**）
  //   食材成本**不在 expense_items 里**（calcMonthlyProfit/service.js:22-27 明写其属费用非食材成本），
  //   而它是最**大**的变动成本 ⇒ 必须显式传，否则保本线会大幅偏低（最危险的方向）。
  buildBreakeven(d, res, prevProfitFen, inds) {
    const T = this.data.t;
    // 🔴 R312：分 → "X.X万"（一位小数）。老板看"10.8万"比"¥108,491.00"快得多。
    const wan = (fen) => (Math.round((Number(fen || 0) / 100 / 10000) * 10) / 10) + String(T.beWan || '万');
    const rows = [];
    for (const it of (d.expense_items || [])) {
      const subs = it && it.sub_items;
      if (subs && subs.length) {
        for (const si of subs) rows.push({ name: (si && si.sub_item) || (it && it.name) || '', amountFen: (si && si.amount_fen) || 0 });
      } else if (it && it.amount_fen) {
        rows.push({ name: it.name || '', amountFen: it.amount_fen });
      }
    }
    const revFen = (res && res.income_total_fen) || 0;
    const matFen = (res && res.material_cost_fen) || 0;
    const sp = BE.splitFixedVariable(rows, { materialCostFen: matFen });
    const bk = BE.breakeven({ revenueFen: revFen, fixedFen: sp.fixedFen, variableFen: sp.variableFen });
    this._beRaw = bk;   // R464：诊断包取原始出参（页面展示用的是加工后的 be）
    if (!bk.ok) {
      return { ok: false, reason: bk.reason, needRevenue: bk.needRevenue,
        noDataText: bk.needRevenue ? '' : (matFen > 0 ? '' : T.beNoData) };
    }
    const rentFen = this._sumByName(rows, '房租');
    const laborFen = this._sumByName(rows, '工资') + this._sumByName(rows, '社保');
    // 🔴 R480：达标营业额必须用**与下方指标卡同一套**「业态 × 城市」区间。
    //   原先房租 15% / 人工 22% / 房租目标 12% 是**前端写死**的常数，而下方指标卡的参考带
    //   来自后端 indicatorRef（分业态 × 分城市）⇒ **同一页两个"正常"口径**：
    //   老板改业态时只有下面那块跟着变，上面这块纹丝不动（真机：一块能改、一块不能改，不知信哪个）。
    //   现在统一从后端 indicators 取；**取不到才回落旧常数**（零回归，绝不硬崩）。
    const indOf = (k) => (inds || []).find((x) => x && x.key === k) || null;
    const hiOf = (k, fb) => {
      const it = indOf(k);
      return (it && typeof it.hi === 'number') ? it.hi : fb;
    };
    const rentIt = indOf('rent');
    const rentHi = hiOf('rent', 15);
    const laborHi = hiOf('labor', 22);
    // 房租目标率 = 该业态区间**中点**（原来是写死的 12，即 8~15 的中点）
    const rentTarget = (rentIt && typeof rentIt.lo === 'number' && typeof rentIt.hi === 'number')
      ? (rentIt.lo + rentIt.hi) / 2 : 12;
    const healthyFen = BE.healthyRevenue([
      { amountFen: rentFen, hiPct: rentHi },
      { amountFen: laborFen, hiPct: laborHi },
    ]);
    // 🔴 R311③：归因 —— 房租占比偏高里，"营收不足"与"房租本身贵"各占多少点。
    const at = BE.attribution({ revenueFen: revFen, itemFen: rentFen, targetRatePct: rentTarget, targetRevenueFen: healthyFen });
    // ⚠️ 只在**占比确实偏高**（diffPp > 0）时才给归因：
    //   若房租本来就在区间内，说"有 X 点来自营收不足"是**误导**（它没偏高，不需要解释）。
    //   分母/分子**保留符号**（不取绝对值）：两者可能一正一负，取绝对值会让"加起来等于率差"不成立。
    const attr = (!at.needTarget && at.diffPp > 0)
      ? { rate: String(at.ratePct), denom: String(at.denomPp), numer: String(at.numerPp) }
      : null;
    // 🔴 R311-A：毛利率差距 → **金额化**（全页面唯一"带得出确定金额、又不怨营业额"的建议）。
    //   为什么只做毛利率：不受营业额影响的四个指标里（毛利率/单份毛利/租金单价/人均人工成本），
    //   只有毛利率 M1 自己就有（res.gross_margin_pct + d.indicators 的 grossMargin 区间）。
    //   ⚠️ 匹配必须用**机器键** `key === 'grossMargin'`，**不能**用中文名（改名会静默失效）；
    //   ⚠️ fail-soft：找不到 / 已达下限 / lo 缺失 ⇒ null（**不显示**），绝不凑一条假建议。
    let gm = null;
    {
      const list = (d && d.indicators) || [];
      const g = list.find((it) => it && it.key === 'grossMargin');
      const gPct = g ? Number(g.pct !== undefined ? g.pct : g.mine) : NaN;
      const gLo = g ? Number(g.lo) : NaN;
      if (g && g.has !== false && Number.isFinite(gPct) && Number.isFinite(gLo) && gPct < gLo) {
        const gapPp = Math.round((gLo - gPct) * 10) / 10;
        const moneyText = api.fenToYuan(Math.round((revFen * gapPp) / 100), 2);
        gm = { text: String(T.beGmText || '').replace('{a}', String(gPct)).replace('{b}', String(gapPp)).replace('{c}', moneyText) };
      }
    }
    // 🔴 老板视角：标题直接给"亏/赚"结论 —— 老板不该自己从"安全边际 -19.3%"换算"我在亏"。
    //   ⚠️ 判据 = 安全边际 < 0（营收低于保本线，按定义就是亏）；**不给**"接近保本"这种模糊话。
    let title = (bk.safeMarginPct != null && bk.safeMarginPct < 0) ? T.beVerdictLoss : T.beVerdictWin;
    // 🔴 R313：跨月对比 —— 只在**上月账本存在**时追加；差额 < 1 元视为"没变"，不打扰。
    if (prevProfitFen != null && Number.isFinite(Number(prevProfitFen))) {
      const nowP = Number((res && res.total_factor_real_profit_fen) || 0);
      const diff = nowP - Number(prevProfitFen);
      if (Math.abs(diff) >= 100) {
        const money = api.fenToYuan(Math.abs(diff), 0) + String(T.beYuanUnit || '元');
        title += (diff > 0
          ? String(T.beMomMore || '').replace('{a}', money)
          : String(T.beMomLess || '').replace('{a}', money));
      }
    }
    return {
      ok: true,
      // 🔴 R395：保本额的**原始分**（分享标题要整数元，不能从 `lowText` 这种带千分位的串反解）
      breakevenFen: Number(bk.breakevenFen) || 0,
      title,
      gm,
      attr,
      revText: api.fenToYuan(revFen, 2),
      fixedText: api.fenToYuan(sp.fixedFen, 2),
      varText: api.fenToYuan(sp.variableFen, 2),
      lowText: api.fenToYuan(bk.lowFen, 2),
      highText: api.fenToYuan(bk.highFen, 2),
      // 🔴 R312：不再叫"安全边际 xx%"。直接说人话。
      // 🔴 R315：**亏损月份不再显示这一行**（只给"要涨 X%"是一条路），改显示"回本两条路"；
      //   赚钱的月份保留"营收再掉 X% 就亏"——那时老板问的是抗风险，不是回本。
      marginText: (bk.safeMarginPct == null || bk.safeMarginPct < 0) ? ''
        : String(T.beMarginDrop || '').replace('{p}', String(bk.safeMarginPct)),
      pathText: (() => {
        if (!(bk.safeMarginPct != null && bk.safeMarginPct < 0)) return '';
        const rp = BE.recoverPaths({ revenueFen: revFen, fixedFen: sp.fixedFen, variableFen: sp.variableFen });
        if (!rp.ok) return '';
        // 🔴 固定成本已超过营收 ⇒ 降变动成本永远回不了本，**只给营收一条路**（不编"压到 0%"）。
        if (!rp.varPathPossible) {
          return String(T.bePathRevOnly || '').replace('{a}', wan(rp.needRevenueFen));
        }
        return String(T.bePathText || '')
          .replace('{a}', wan(rp.needRevenueFen))
          .replace('{b}', String(rp.targetVarRatePct));
      })(),
      // 🔴 R312：金额改"万"—— ¥108,491.00 老板记不住；区间用**中文"到"**，
      //   不用 `~`（李老师反馈：容易被看成减号，以为两个数相减）。
      rangeText: String(T.beRangeText || '').replace('{a}', wan(bk.lowFen)).replace('{b}', wan(bk.highFen)),
      // 🔴 R482（李老师 2026-10-25 追问：「录完确定的数，为什么出来两个模糊的数？」）：
      //   **确定的盈亏平衡点是存在的** —— bk.breakevenFen = 固定成本 ÷ 边际贡献率，只用老板填的数。
      //   之前页面上只有 ±10% 敏感性**区间**（low~high），那个区间是我方自己加的容错带，
      //   不是老板填出来的 ⇒ 结论层应给**确定的点**，区间降级并标明"±10% 估算"。
      pointText: bk.breakevenFen > 0 ? wan(bk.breakevenFen) : '',
      pointNoteText: bk.breakevenFen > 0
        ? String(T.bePointNote || '').replace('{a}', wan(bk.lowFen)).replace('{b}', wan(bk.highFen))
        : '',
      marginNeg: bk.safeMarginPct != null && bk.safeMarginPct < 0,
      healthyText: healthyFen > 0 ? String(T.beHealthyText || '').replace('{a}', wan(healthyFen)) : '',
      // R480：把"这个达标线是按哪个业态 × 城市算的"**写在旁边** —— 老板不用猜它跟下面
      //   指标卡是不是一回事；且它现在**真的会跟着业态变**（口径已同源），说了才不作假。
      healthyScopeText: (() => {
        if (!(healthyFen > 0)) return '';
        const sv = this.scopeView(d && d.indicator_scope);
        return String(T.beHealthyScope || '').replace('{b}', sv.bizText).replace('{c}', sv.cityText);
      })(),
      diag: BE.diagnose(healthyFen, bk.breakevenFen),
      unknownText: (sp.unknown && sp.unknown.length) ? T.beUnknown : '',
    };
  },

  // 🔴 R314：展开/收起体检卡的「依据」三行（保本区间 / 达标营业额 / 房租归因）。
  //   为什么默认收起：这 6 行里只有 3 行是「结论/动作」，其余是「依据」；
  //   老板第一眼要的是"我在亏吗、能撑多少、哪里漏钱"，依据想追再看。
  onToggleBeMore() {
    this.setData({ beMore: !this.data.beMore });
  },

  // 🔴 R515（李老师 2026-10-26）：利润卡内「这笔钱怎么算出来的」展开/收起。
  //   原来这块水面线是独立第 7 张卡，老板看到利润想知道"凭什么"要往下滚 6 张卡 ⇒ 收进利润卡。
  onToggleProfitCalc() {
    this.setData({ profitCalcOpen: !this.data.profitCalcOpen });
  },

  _sumByName(rows, kw) {
    let n = 0;
    for (const r of (rows || [])) if (r && String(r.name || '').indexOf(kw) >= 0) n += Number(r.amountFen) || 0;
    return n;
  },

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
    // 🔴 R468：原始出参留一份 —— 诊断包只搬原值（展示对象里的 netRate 是字符串、还加了「−」号）
    this._settleRaw = st;
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

  // ===== 🔴 R399（队列 #16）：异常核对清单（接线层 · 零阈值 · 零金额）=====

  /**
   * 编排取数并生成清单（由 load() 在主数据渲染完后调用，**不 await**）。
   *
   * 为什么取 N 个月：规则层要「本店自己的历史中位数」，少于 2 个有效历史月不出项。
   * 为什么逐月取、不新造批量接口：`getMonthList`（只回 month/is_archive）+ `getLedger`（逐月账本）
   *   都是既有能力；6 次调用是低频动作（每月看一次），先看真实耗时再决定要不要批量（R396 已登记）。
   * 为什么目标月直接喂 `curLedger`：它就是 load() 刚拿到的 getLedger 出参 —— 再取一次＝同一口径算两遍
   *   （本仓最贵的病：第二套口径）。
   * 为什么单月失败只跳过：历史少一个月 ⇒ 规则层按「有效历史月」自动重算；一个月份取失败不该把整卡弄没。
   */
  async loadChecklist(curLedger) {
    const empty = { has: false };
    if (!curLedger || !curLedger.account_id) { this.setData({ anom: empty }); return; }
    // 换月时先清：否则上一月的清单会挂在新月份下面（张冠李戴比不显示更糟）
    this.setData({ anom: empty });
    try {
      const ml = await api.call('getMonthList', {});
      const target = curLedger.month || this.data.month || '';
      const lookback = Number(anomaly.THRESHOLDS.lookbackMonths) || 6;
      const need = Number(anomaly.THRESHOLDS.minHistoryMonths) || 2;
      // 只取**早于目标月**的已建档月，新在前，最多 lookback 个（餐饮季节性强，半年前不可比）
      const built = ((ml && ml.list) || [])
        .map((x) => (x && x.month) || '')
        .filter((m) => m.length === 7 && m < target)
        .sort((a, b) => (a < b ? 1 : -1))
        .slice(0, lookback);
      // 历史太短 ⇒ 连卡都不出（fail-closed：只有 1 个月不叫「历史」，出空卡会被读成"没问题"）
      if (built.length < need) { this.setData({ anom: empty, trend: [] }); return; }
      const snaps = [curLedger];
      for (const m of built) {
        try {
          const d = await api.call('getLedger', { month: m });
          if (d && d.account_id) snaps.push(d);
        } catch (e) { /* 单月失败跳过，不阻断 */ }
      }
      const cl = anomaly.buildChecklist({ month: target, months: snaps });
      this._anomRaw = cl;   // R464：诊断包要的是规则层原始出参（页面拿到的是翻译后的视图对象）
      this.setData({ anom: this.viewChecklist(cl), trend: this.buildTrend(snaps) });
    } catch (e) {
      this.setData({ anom: empty });   // 取数失败 ⇒ 静默不出卡（结果页自身仍完整）
    }
  },

  /**
   * 规则层出参 → 页面展示对象。**只翻译，不判断**：
   *   · 出不出卡、够不够历史、装哪些项、怎么排序 —— 全在 `utils/anomalyRules.js`；
   *   · 本函数只把 rule/direction/ratio_pct 换成术语文案，绝不自己算百分比、绝不加金额差。
   */

  /**
   * 🔴 R443：近 6 个月真钱利润 → 柱状数据（**纯展示换算，不参与任何计算**）。
   *   数据来源 = `loadChecklist` 已经拉回来的那批账本（当前月 + 最多 5 个历史月）⇒ **零额外云调用**。
   *   口径：一律取 `total_factor_real_profit_fen`（与结果页「真钱利润」同一字段，不另算）。
   *   边界：少于 2 个月 ⇒ 返回空（一个月不叫"走势"；出空图会被读成"没数据/坏了"）。
   */
  buildTrend(snaps) {
    const rows = (snaps || [])
      .filter((d) => d && d.account_id && d.month)
      // 🔴 R510：利润在 `d.result` 里（getLedger 出参是 `{ ..., result:{ total_factor_real_profit_fen } }`，
      //   ok() 不摊平）—— 原实现读顶层 `d.total_factor_real_profit_fen` 恒 undefined ⇒ 每根柱子都算成 0
      //   ⇒ 趋势图恒为「全 0 平线」（且无任何守卫 ⇒ 静默）。同 R298Y「读到了 ≠ 送出去了」一族。
      .map((d) => ({ month: d.month, fen: Number((d.result || {}).total_factor_real_profit_fen) || 0 }))
      .sort((a, b) => (a.month < b.month ? -1 : 1))
      .slice(-6);
    if (rows.length < 2) return [];
    const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.fen)), 0) || 1;
    const cur = this.data.month;
    return rows.map((r) => ({
      month: r.month,
      label: r.month.slice(5) + '月',
      isCur: r.month === cur,
      text: api.fenToYuan(r.fen, 0),
      h: Math.max(8, Math.round((Math.abs(r.fen) / maxAbs) * 120)),
      up: r.fen >= 0,
    }));
  },

  goMonthResult(e) {
    const m = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.month) || '';
    if (!m || m === this.data.month) return;   // 点当前月 = 原地，不重复入栈
    wx.navigateTo({ url: '/subpkg/biz/month/result?month=' + m });
  },

  /**
   * 🔴 R489：从「本数按期末库存 ¥X 倒轧」直接去核对那个数。
   * 为什么给这个入口：系统分不出"真盘点"和"随手填"（服务端不返回该事实），
   * 所以不判断、也不弹"可能填错了"，只把**老板自己填的数**摆在利润旁边；
   * 他要改，一步就到库存页 —— 比任何"异常提示"都准，且零误报。
   */
  goInventory() {
    const m = this.data.month;
    if (!m) return;
    wx.navigateTo({ url: '/subpkg/biz/month/inventory?month=' + m });
  },

  viewChecklist(cl) {
    const T = this.data.t;
    if (!cl || !cl.basis || cl.basis.insufficient) return { has: false };
    const items = (cl.items || []).map((it) => this.viewAnomItem(it, T));
    const shown = items.slice(0, ANOM_SHOW_MAX);
    return {
      has: true,
      version: cl.version || '',
      historyMonths: cl.basis.history_months || 0,
      basisText: String(T.anomBasis || '').replace('{n}', String(cl.basis.history_months || 0)),
      items: shown,
      more: items.length > ANOM_SHOW_MAX
        ? String(T.anomMore || '').replace('{n}', String(items.length - ANOM_SHOW_MAX))
        : '',
      // 「跟自己历史差不多」也要说一句：空白卡会被读成"没算完/坏了"，而不是"一切正常"
      emptyText: items.length ? '' : (T.anomEmpty || ''),
    };
  },

  // 单条：rule → 文案。百分比取整（老板不需要 133.3% 这种精度），**不带金额**（口径红线 PLAN_AI §3）。
  viewAnomItem(it, T) {
    const row = it || {};
    const p = String(Math.round(Math.abs(Number(row.ratio_pct) || 0)));
    let text = '';
    if (row.rule === 'r1_up') text = String(T.anomUp || '').replace('{a}', row.name || '').replace('{p}', p);
    else if (row.rule === 'r2_down') text = String(T.anomDown || '').replace('{a}', row.name || '').replace('{p}', p);
    else if (row.rule === 'r3_missing') text = String(T.anomMissing || '').replace('{a}', row.name || '');
    else if (row.rule === 'r4_new') text = String(T.anomNew || '').replace('{a}', row.name || '');
    else if (row.rule === 'r5_margin') {
      // 毛利率的幅度是**百分点**，不是相对百分比 —— 两个量纲绝不混用（规则层已分开，这里只取模板）
      const tpl = row.direction === 'up' ? T.anomMarginUp : T.anomMarginLow;
      text = String(tpl || '').replace('{p}', p);
    }
    return {
      key: row.key || '',
      text,
      // 高优先项只加「优先看」小标 + 警示色（排序已在规则层做过，页面不再排）
      tag: row.attention === 'high' ? (T.anomHighTag || '') : '',
      tone: row.attention === 'high' ? 'warn' : '',
      show: !!text,
    };
  },

  // ===== round115：行业指标对照 =====

  // 后端只回 { key, pct, lo, hi, level, redline, redlineHit }；中文名与评级文案在前端补（术语单源在前端）。
  // 🔴 pct === null 表示「这项没数据」⇒ has=false ⇒ 页面显示「本月没填」，**绝不显示 0%**
  //    （算成 0% 会得出「房租占比 0%，优秀」这种荒谬结论 —— round115 后端真有此 bug，已修并被 selftest 钉住）。
  // R443：现金输入 —— 存本机（不上云），并立刻重算可撑月数
  onCash(e) {
    const v = e.detail.value;
    this.setData({ cashYuan: v });
    try { wx.setStorageSync(RUNWAY_CASH_KEY, v); } catch (err) { /* 忽略 */ }
    this.recalcRunway();
  },

  // R443：可撑月数 = 账面现金 ÷ 月刚性支出（房租+人工+水电）
  // 🔴 三项任一缺失 ⇒ 不计算（显示「算不出来」），**绝不按 0 元算**
  //    （按 0 算会让可撑月数变成无穷大，是"静默错账"里最危险的一种）。
  // 🔴 R444 收口：现金输入改走 `classifyAmount` 三态，**不做 `replace(/[^\d.]/g,'')` 静默清洗** ——
  //    静默清洗会把「12,000」读成 12000（看似帮了忙），也会把「1,2」读成 12（凭猜测改数），
  //    而猜错的方向既可能是高估也可能是低估 ⇒ 违反「不猜数、如实暴露」。
  recalcRunway() {
    const t = this.data.t || {};
    const fi = this._fixedFen;
    const r = amt.classifyAmount(this.data.cashYuan);
    const hasCash = r.readable && r.state === amt.STATE.OK && r.fen > 0;
    // 读不成金额（带逗号/全角/空格/负号…）：只提示怎么改，**不参与任何计算**
    if (!r.readable) {
      this.setData({ runwayText: '', runwayBadCash: true, runwayNoData: false });
      return;
    }
    if (!fi || fi.rent == null || fi.labor == null || fi.utility == null) {
      this.setData({ runwayText: '', runwayBadCash: false, runwayNoData: hasCash });
      return;
    }
    const fixedFen = fi.rent + fi.labor + fi.utility;
    if (!(fixedFen > 0)) {
      this.setData({ runwayText: '', runwayBadCash: false, runwayNoData: hasCash });
      return;
    }
    if (!hasCash) {
      this.setData({ runwayText: '', runwayBadCash: false, runwayNoData: false });
      return;
    }
    const m = r.fen / fixedFen;
    // 保留 1 位小数；≥24 个月就不再刺激老板（"两年以上"比"31.4 个月"更稳）
    // 🔴 R444：文案走 terms（新增可见文案三处同步，不在页面里留硬编码中文）
    const txt = m >= 24 ? (t.runwayOver2y || '') : (Math.round(m * 10) / 10) + ' ' + (t.runwayMonthsSuf || '');
    this.setData({ runwayText: txt, runwayBadCash: false, runwayNoData: false });
  },

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
        api.say(TERMS.pay.subscribeDenied);
      },
    });
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
  goOrders() { wx.navigateTo({ url: '/subpkg/tools/pay/orders' }); },
  // 🔴 R443：去「单品毛利复盘」——把「毛利低」变成「是哪道菜」
  //   ⚠️ 目标页在 pages/ 下（非分包），路径与 app.json 一致；没建卡时那边有自己的空态。
  goDishReview() { wx.navigateTo({ url: '/pages/m3/dishreview/index' }); },
  goInput() { wx.navigateTo({ url: '/subpkg/biz/month/input?month=' + this.data.month }); },

  // M1 报表导出：权限只读 expire_at（前端先查，后端 exportData 再兜底校验）；免费用户触发付费墙
  // 🔴 R464（PLAN_AI P0-①）：复制「AI 诊断包」。
  //   为什么不吃付费墙：它不给任何结论，只是把本月**已算好的数字 + 已判好的结论**整理成文本，
  //   让老板带去问外部 AI（零资质、零成本）；真报表走 onExport 的付费墙，两者不是一件事。
  //   为什么用剪贴板：不新增文件权限、不依赖 openDocument 的格式支持，粘到哪里都由老板决定。
  async onCopyPack() {
    try {
      if (!this.data.hasLedger) {
        wx.showModal({ title: this.data.t.aiPackBtn, content: this.data.t.aiPackEmpty, showCancel: false });
        return;
      }
      // 菜品事实**按需取**：失败 / 未开权限都不能挡住整包（包的主体是本月数字与判断）。
      //   拿不到就如实写进 unavailable，绝不用 0 或空排行冒充「本月没卖菜」。
      let dishes = this._dishes;
      let dishesReason = this._dishesReason || 'not_loaded_on_this_page';
      if (dishes === undefined) {
        wx.showLoading({ title: this.data.t.aiPackLoading, mask: true });
        try {
          const rng = ui.monthRange(this.data.month);
          const d = await api.call('getDishReview', { biz_date_from: rng.from, biz_date_to: rng.to });
          dishes = {
            range: d.range, dineIn: d.dine_in || [], totals: d.totals || null,
            coverageA: d.coverageA, coverageC: d.coverageC,
            unmatched: (d.unmatched || []).length, truncated: dh.isTruncated(d),
          };
        } catch (e) {
          dishes = null;
          dishesReason = 'fetch_failed_or_locked';   // 未开权限 / 取数失败：如实说，不编
        }
        this._dishes = dishes;
        this._dishesReason = dishes ? '' : dishesReason;
        wx.hideLoading();
      }
      const p = pack.buildDiagnosisPack({
        month: this.data.month,
        hasLedger: true,
        shop: { bizText: this.data.bizText, cityText: this.data.cityText },
        ledger: this._res || {},
        breakeven: this._beRaw || {},
        anomalies: this._anomRaw || {},
        dishes: dishes,
        dishesReason: dishes ? '' : dishesReason,
        // 外卖：就是本页那张「外卖到手账」的原始出参（同一函数），不另算一遍。
        // 团购**不传**：按红线不进 M1，传了也会被装配层忽略（见 utils/grouponDerive.js 红线②）。
        channels: { takeaway: this._settleRaw || null },
      });
      wx.setClipboardData({
        data: pack.packToText(p),
        fail: () => wx.showModal({ title: this.data.t.aiPackBtn, content: this.data.t.aiPackFail, showCancel: false }),
      });
    } catch (e) {
      wx.hideLoading();
      api.toastError(e);
    }
  },

  async onExport() {
    // 2026-09-20 加固：此前整段无 try/catch —— 一旦取权益/弹窗任一步抛异常，点击就是「毫无反应」，
    // 用户无从判断是没权限还是坏了。现统一兜底：任何异常都 toast 出来（可证伪，不静默）。
    try {
      const ent = await require('../../../utils/entitlement.js').fetchEntitlement().catch(() => null);
      if (!ent || !ent.is_active) {
        require('../../../utils/paywall.js').openPaywall('export', {
          shopId: (getApp().globalData && getApp().globalData.shop_id) || '',
        });
        return;
      }
      await this.doExport();
    } catch (e) {
      require('../../../utils/api.js').toastError(e);
    }
  },

  async doExport() {
    wx.showLoading({ title: this.data.t.exportIng, mask: true });   // 进度提示：生成中不阻塞
    try {
      const d = await require('../../../utils/api.js').call('exportData', {
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
      require('../../../utils/api.js').toastError(e);
    }
  },

  /**
   * 🔴 R395（队列 #11）：分享卡片 —— 标题带**本店已算出的结论**，不是只有小程序名。
   *
   * 为什么必须自定义：不写 `onShareAppMessage` 时微信一律用小程序名当标题
   *   ⇒ 对方收到的卡片只说「店算」，看不出这工具能替老板算清什么（PLAN_AI §2 的落点）。
   * 为什么只读 `shareFacts`：见 load() 里的取数注释 —— 展示串带格式，反解必然引入误差。
   * 为什么把这个能力放在这里：本页是 M1 的唯一结论页，也是老板最可能「截个图发出去」的地方。
   */
  onShareAppMessage() {
    const f = this.data.shareFacts || {};
    // `hasLedger` 不复制进 shareFacts —— 直接读本页 `data.hasLedger`（R298 单源判据，全页只此一处表达式）
    return shareCard.m1Share({
      hasLedger: this.data.hasLedger === true,
      month: f.month,
      breakEvenFen: f.breakEvenFen,
      profitFen: f.profitFen,
    });
  },
});