// subpkg/biz/diag/result.js —— R612（2026-11-06）· 深度诊断 · **结论页**
//
// 角色：`cloudfunctions/getDiagnosis` 的唯一前端出口。
//   引擎（11 项加权 + 红线一票否决）此前全仓零调用；本页把结论真正摆到老板面前。
//
// ============ 三条对外口径（豆包会诊结论，改代码时勿破） ============
// 🔴 1. **不叫「红线」**。对外一律「风险信号」，且**一次只显示最严重的一条**。
//      理由：直接抛「命中 5 条红线」会让个体老板觉得被咒店倒，直接弃用。
// 🔴 2. **用事实句，不用判决句**。引擎给的是「现金枯竭」，页面必须译成
//      「账上的钱撑不到下个月的开支」。翻译表在 TERMS.diagResult.sigR1~R6，页面不写中文。
// 🔴 3. **先给结论，再引导补录**。一进页面就有结论（有多少数据算多少），
//      缺项只作为「补这一两项会更准」的单点提示，绝不做成"填完 9 项才出结果"的问卷。
//
// ============ 数据来源 ============
// 全部来自 getDiagnosis 的返回：diagnosis（等级/分数/覆盖/信号/11 项/缺项）
//   + derived（连亏月数、月均净亏损、用了几月账）+ basis（近三月利润明细）。
//   ⚠️ 云函数**不回传 input**（里面含账面现金等敏感数）⇒ 本页不自己算钱，
//       "还能撑几个月"直接用引擎 metrics[cash].note（那边是唯一口径）。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');

const T = TERMS.diagResult;

// 等级 / 结论 / 风险信号 的**对外译法**（页面零中文，全部来自 terms 单源）
const LV = {
  good: T.lvGood, watch: T.lvWatch, warn: T.lvWarn,
  critical: T.lvCritical, insufficient: T.lvInsufficient,
};
const CONCL = {
  good: T.conclGood, watch: T.conclWatch, warn: T.conclWarn,
  critical: T.conclCritical, insufficient: T.conclInsufficient,
};
// 六条信号的**事实化**表述。键与引擎 REDLINES 的 code 一一对应（R1~R6）。
const SIG = {
  R1: T.sigR1, R2: T.sigR2, R3: T.sigR3,
  R4: T.sigR4, R5: T.sigR5, R6: T.sigR6,
};
// 缺项一次只指 1~2 项（豆包：一次抛一堆 = 问卷，老板直接放弃）
const MISS_SHOW_MAX = 2;

// 分 → 元展示（≥1 元取整；<1 元保留两位，避免"月均净亏 0 元"这种假精度）
function yuanText(fen) {
  const n = Number(fen);
  if (!Number.isFinite(n)) return '';
  const y = n / 100;
  return Math.abs(y) >= 1 ? String(Math.round(y)) : y.toFixed(2);
}

Page({
  data: {
    loading: true,
    errText: '',
    t: {
      title: T.title,
      loading: T.loading,
      errLoad: T.errLoad,
      retry: T.retry,
      signalTitle: T.signalTitle,
      signalNone: T.signalNone,
      focusTitle: T.focusTitle,
      indTitle: T.indTitle,
      indHint: T.indHint,
      missTitle: T.missTitle,
      missHint: T.missHint,
      missGo: T.missGo,
      basisTitle: T.basisTitle,
      asOfPre: T.asOfPre,
      basisMonthsTitle: T.basisMonthsTitle,
      disclaimer: T.disclaimer,
    },
    levelClass: 'na',
    levelLabel: '',
    scoreText: '',
    covText: '',
    concl: '',
    signal: null,
    focusIsSignal: true,
    signalMore: 0,
    signalMoreText: '',
    inds: [],
    miss: [],
    missMoreText: '',
    missAutoHint: '',
    basisLines: [],
    asOfText: '',
    basisMonths: [],
  },

  onLoad() {
    ui.setTitle(T.title);
    this.load();
  },

  onRetry() { this.load(); },

  // 去补录页填完回来，下拉就重算 —— 不让老板以为必须退出去重进
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  goInput() {
    wx.navigateTo({ url: '/subpkg/biz/diag/input' });
  },

  async load() {
    this.setData({ loading: true, errText: '' });
    try {
      const shopId = (getApp().globalData && getApp().globalData.shop_id) || '';
      if (!shopId) await api.ensureShop();
      const d = await api.call('getDiagnosis', {});
      this.buildView(d || {});
      this.setData({ loading: false });
    } catch (e) {
      // 失败必须说出来，不许停在转圈（老板会以为卡死）
      this.setData({ loading: false, errText: (e && e.msg) || T.errLoad });
    }
  },

  // 纯函数式装配：入参 = 云函数返回，出参 = 纯展示态。
  //   单独成方法是为了能被页面桩直接调，不必走 onLoad 的云调用。
  buildView(d) {
    const dg = (d && d.diagnosis) || {};
    const dv = (d && d.derived) || {};
    const level = dg.level || 'insufficient';
    const rawMetrics = dg.metrics || [];

    // ---- 11 项拆解：有数据的排前面（按"丢分×权重"降序 = 最该动的在最上）----
    const inds = rawMetrics.map((m) => {
      const has = !!m.hasData;
      const lost = has ? Math.round((100 - m.score) * m.weight / 100 * 10) / 10 : 0;
      const sc = has ? m.score : 0;
      return {
        key: m.key,
        label: m.label,
        weight: m.weight,
        kind: m.kind || 'manual',
        hasData: has,
        _lost: lost,
        scoreText: has ? String(Math.round(sc)) : T.indNoData,
        barW: has ? Math.max(0, Math.min(100, Math.round(sc))) : 0,
        lostText: has ? (T.indLostPre + lost + T.indLostSuf) : '',
        note: m.note || '',
        cls: !has ? 'na' : (sc >= 80 ? 'good' : (sc >= 60 ? 'watch' : 'warn')),
      };
    });
    inds.sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
      return b._lost - a._lost;
    });

    // ---- 最该看的一条：先看有没有命中，再看短板 ----
    //   为什么无命中时要拿短板充位：否则会出现「预警 77 分」+「没有触发风险信号」
    //   这种自相矛盾的组合，老板只会觉得这工具在敷衍。
    const hits = dg.redlineHit || [];
    const anchors = dg.anchors || [];
    let signal = null;
    let focusIsSignal = true;
    if (hits.length) {
      // REDLINES 定义顺序 R1→R6，R1（现金）最急，天然排最前 ⇒ 取第一条即可
      signal = {
        code: hits[0].code,
        text: SIG[hits[0].code] || hits[0].label || '',
        evidence: hits[0].evidence || '',
      };
    } else if (anchors.length) {
      // 短板充位时把 note 拼进正文：只说「盈利能力」太空，带上「净利率 -6.7%」才有信息量。
      signal = {
        code: anchors[0].key,
        text: (anchors[0].label || '') + (anchors[0].note ? (T.focusJoin + anchors[0].note) : ''),
        evidence: '',
      };
      focusIsSignal = false;
    }
    const signalMore = Math.max(0, hits.length - 1);

    // ---- 缺项：**只列手填项**（补录页真能补的），自动算的另说 ----
    //   🔴 这是本次最容易做错的一处：引擎的 missing 把「盈利/连亏/毛利/人工/房租」也算缺，
    //      但那几项补录页里根本没有输入框 —— 列出来再给一个"去补录"按钮，
    //      等于把老板骗到一个填不了的空页面。所以按 kind 分流。
    const missSrc = rawMetrics
      .filter((m) => !m.hasData && (m.kind || 'manual') === 'manual')
      .sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const missAutoCount = rawMetrics.filter((m) => !m.hasData && m.kind === 'auto').length;
    const miss = missSrc.slice(0, MISS_SHOW_MAX).map((x) => ({
      key: x.key,
      label: x.label,
      weightText: T.missWeightPre + (x.weight || 0),
    }));
    const missMoreText = missSrc.length > MISS_SHOW_MAX
      ? (T.missMorePre + (missSrc.length - MISS_SHOW_MAX) + T.missMoreSuf)
      : '';

    // ---- 依据：这个结论是按什么算的 ----
    const basisLines = [];
    if (dv.monthsUsed) basisLines.push(T.basisMonthsPre + dv.monthsUsed + T.basisMonthsSuf);
    if (dv.lossMonths >= 1) basisLines.push(T.basisLossPre + dv.lossMonths + T.basisLossSuf);
    if (dv.avgMonthlyNetLossFen > 0) {
      basisLines.push(T.basisBurnPre + yuanText(dv.avgMonthlyNetLossFen) + T.basisBurnSuf);
    }
    // 近三月利润明细：结论要能被自己核对（老板看到"连续亏损 3 个月"最想知道的
    // 就是"哪三个月、各亏多少"）。数据来自 getDiagnosis 的 basis.months，页面不重算。
    const bm = (d && d.basis && d.basis.months) || [];
    const basisMonths = bm.map((x) => {
      const p = Number(x.profitFen);
      const neg = Number.isFinite(p) && p < 0;
      return {
        month: x.month || '',
        profitText: Number.isFinite(p) ? ((neg ? '-' : '') + T.cur + yuanText(Math.abs(p))) : T.indNoData,
        neg,
      };
    });
    const cashM = rawMetrics.find((m) => m.key === 'cash');
    basisLines.push((cashM && cashM.hasData && cashM.note) ? cashM.note : T.basisNoCash);
    if (dv.lossTruncated) basisLines.push(T.basisTrunc);

    // ---- 分数：数据不足时**不给分** ----
    //   覆盖率不到 70% 的"100 分"是归一化出来的幻觉（只剩口碑/租约在算），
    //   摆在"数据不足"旁边就是自相矛盾，直接不说分。
    const hasScore = (level !== 'insufficient') && dg.score !== null && dg.score !== undefined;

    this.setData({
      levelClass: level,
      levelLabel: LV[level] || LV.insufficient,
      scoreText: hasScore ? (T.scorePre + dg.score + T.scoreSuf) : T.scoreNa,
      covText: dg.coverage === null || dg.coverage === undefined
        ? ''
        : (T.covPre + dg.coverage + T.covSuf),
      concl: CONCL[level] || CONCL.insufficient,
      signal,
      focusIsSignal,
      signalMore,
      signalMoreText: signalMore > 0 ? (T.signalMorePre + signalMore + T.signalMoreSuf) : '',
      inds,
      miss,
      missMoreText,
      // 🔴 只在**一本账都没有**时提示"先记一个月账"。
      //   有账本但某一自动项缺（如某月没填库存导致毛利率算不出）不是"没记账"，
      //   拿这句话去说会冤枉老板（他明明记了），所以按 monthsUsed 判，不按 missAutoCount。
      missAutoHint: (missAutoCount > 0 && !(dv.monthsUsed > 0)) ? T.missAutoHint : '',
      basisLines,
      asOfText: dv.month ? (T.asOfPre + dv.month) : '',
      basisMonths,
    });
  },
});
