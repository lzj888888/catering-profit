// cloudfunctions/getDiagnosis/actions.js —— 处方层（R615 · 李老师授权总设计师拍板）
//
// 定位：把智库三元组里躺着的「动作」列接进诊断结论。
//   `智库规则体系_三元组合并扩充版_20261104.md` 每条规则都有「触发条件 / 结论基准 / 动作 / 边界」四列，
//   但引擎此前一个动作都不输出 ⇒ 老板看到「房租占 18%」就停，不知道下一步做什么。
//
// 🔴 五条硬标准（缺一条就是正确的废话，守卫逐条钉住）：
//   1. 带数：动作句里的金额必须来自**已算好的 facts**（input / derived），本文件只做字符串填空，不做算术决策；
//   2. 分级：按「现金可撑月数」分档（智库 V断-3：<3 别大动作 / 3-6 可试 1-2 个 / >6 别慌）；
//   3. 有边界：业态不适用要说（火锅/烧烤共点强场景，引流菜别乱涨价缩份）；
//   4. 可追溯：动作一律来自本表预设条目，**不是生成式自由发挥**；每条带 ruleId 指回智库；
//   5. 合规：禁止终局判决（建议闭店/该关了）、绝对承诺（一定能救活/保证不亏）、生成式措辞。
//      底部兜底句由上层渲染（智库 §十一 / 规范 §12.7）。
//
// ⚠️ 为什么不放 `common/`：改 common 一个文件要重生成 56 份 cx_* 副本 + A15 白名单逐条登记。
//   处方层只有一个消费方（getDiagnosis），放本函数目录内即可，零同步成本。
// ⚠️ 本文件是**纯函数、零 IO**，可独立 require 自测。
//
// 引擎边界（diagnosisEngine.js 三条底线之 3，R615 订正）：
//   旧版「不给行动指令」把「替老板做终局决定」和「给可执行选项」混为一谈；
//   回查规范 §12.7 只禁算命类措辞 / 绝对化承诺 / 「食材成本率」对外，并未禁带数的改善动作。

'use strict';

/** 金额分 → 元（只做展示，不参与任何判定）。与前端 yuanText 同口径。 */
function yuan(fen) {
  const n = Number(fen);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n)) / 100;
}
/** 千分位，仅用于展示；不产生新数值 */
function fmt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 🔴 阈值单源：房租警戒从引擎导出的 RENT_WARN_HI（由 BANDS 派生，A16 教训）取，
//   并按城市系数换算 —— 不许在处方层另抄一个 15。
//   `./common` 是 sync_common 生成的扁平副本，云端每函数独立包内能 require 到。
const ENG = require('./common').diagnosisEngine;
function rentWarnOf(bizType, cityTier) {
  const HI = ENG.RENT_WARN_HI || { other: 15 };
  const COEF = ENG.RENT_COEF || {};
  const hi = HI[bizType] !== undefined ? HI[bizType] : HI.other;
  const coef = COEF[cityTier] !== undefined ? COEF[cityTier] : 1;
  return Math.round(hi * coef * 10) / 10;
}

/**
 * 处方规则表 —— 单源。每条：
 *   key       : 对应引擎 METRICS 的 key（或 'risk' 表示红线触发时附加）
 *   ruleId    : 智库三元组编号，供追溯
 *   when      : (m) => 是否触发（只认引擎已算好的 score / note，不重新取数判断）
 *   text      : (f) => 动作句；f 里的数字全部由 buildActions 预先算好
 *   boundary  : 业态不适用说明（没有则空串）
 *   level     : 'now' 立刻做 / 'try' 可试 / 'later' 慢慢调（分级用）
 *
 * 🔴 表里**每一句都是预设原文或它的最小填空**，没有一句是运行时拼出来的判断。
 */
const RULES = [
  {
    key: 'rent', ruleId: 'V钱-3', level: 'now', needs: ['rentPct', 'rentWarnPct'],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: (f) => `房租占营业额 ${f.rentPct}%，同业态警戒约 ${f.rentWarnPct}%。`
      + `先拿近几个月流水跟房东谈降租；谈不动就把目标放在提坪效（延长高峰时段、翻台或外卖）。`,
    boundary: '若租约还剩很久且是自建/自有房产，谈降租这条不适用，只看坪效。',
  },
  {
    key: 'labor', ruleId: 'V钱-2 / V人-1', level: 'now', needs: ['laborPct'],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: (f) => `人工成本率 ${f.laborPct}%，偏高。先看排班：把高峰时段的人手补齐、平峰通岗，`
      + `再核对管桌数是否超出同业态常见区间；不要一上来就裁人。`,
    boundary: '',
  },
  {
    key: 'grossMargin', ruleId: 'V钱-1 / V菜-2', level: 'now', needs: ['grossPct'],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: (f) => `毛利率 ${f.grossPct}%，低于同业态健康线。先建标准成本卡，`
      + `再按「高价值原料日盘、干货双周盘、全盘月底」把损耗和偷拿看住；改菜价前先把成本核准。`,
    boundary: '火锅/烧烤/家常菜这类共点强的场景，别直接给引流菜涨价或缩份——会压低整桌客单。',
  },
  {
    key: 'loss', ruleId: 'V钱-4 / V断-1 / V断-3', level: 'now', needs: ['burnYuan', 'bleedPct', 'lossMonths'],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: (f) => `每月净亏约 ${fmt(f.burnYuan)} 元，占营业额 ${f.bleedPct}%。`
      + `先逐项拆「食材 / 人工 / 房租」哪块超得最多，只砍最大的那个漏点；`
      + (Number(f.lossMonths) < 3
        ? `连亏 ${f.lossMonths} 个月，还可能是淡旺季，先记满 3 个月再决定要不要换菜单或定位。`
        : `已连亏 ${f.lossMonths} 个月，可以开始看菜单结构、品类或定位哪一环不合适，但一次只改一样。`),
    boundary: '连亏不足 3 个月可能是季节因素，别急着换品类。',
  },
  {
    key: 'cash', ruleId: 'V钱-6 / V断-3', level: 'now', needs: ['runwayMonths'],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: (f) => `账上现金照这个亏法还能撑 ${f.runwayMonths} 个月。`
      + `这段时间的第一件事是砍固定成本，不要做装修、扩店这类大动作；`
      + `把每月刚性支出（房租+人工+水电）压到能多撑一个月，比拉新更急。`,
    boundary: '当前不亏损的店不存在「撑几个月」的问题，这条不适用。',
  },
  {
    key: 'traffic', ruleId: 'V客-4 / V客-1', level: 'try', needs: [],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: () => `营业额同比在往下走。先核对渠道结构（堂食 / 外卖 / 团购）哪一块掉得最多，`
      + `再针对那一个渠道做调整；别在没分清之前全店打折。`,
    boundary: '账不满 13 个月、趋势来自主观判断时，这条只作参考，不当作确定结论。',
  },
  {
    key: 'rating', ruleId: 'V流-2', level: 'try', needs: [],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: () => `平台综合分偏低、或差评在变多。先把最近 3 个月的差评按「菜品 / 出餐慢 / 服务 / 卫生」归一下类，`
      + `24 小时内回复；同一类问题连着出现两次，就是后厨或排班的固定问题，不是运气。`,
    boundary: '',
  },
  {
    key: 'district', ruleId: 'V客-2', level: 'try', needs: [],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: () => `周边人流或商圈在变（修路围挡、拆迁、写字楼空置、新开同类店）。`
      + `先把受影响的那几个时段单独记一周营业额，确认是结构性流失还是短期波动，再谈续租或调整营业时间。`,
    boundary: '只是淡旺季波动时不适用，别把季节性当成商圈坏了。',
  },
  {
    key: 'lease', ruleId: 'V客-2', level: 'try', needs: [],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: () => `租约剩余时间偏短或续租涨幅偏高。提前把「续租后每月多出多少房租、需要多做多少营业额才能打平」算出来，`
      + `再决定谈租还是找替代铺面；不要等到最后一个月。`,
    boundary: '',
  },
  {
    key: 'debt', ruleId: 'V客²-3 / R5', level: 'try', needs: [],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: () => `为这家店借的钱偏多。把每月还款额和月均净亏分开列，`
      + `看清楚是「经营在亏」还是「还款压住了现金」；这两件事的动作完全不同。`,
    boundary: '只做负债与现金的测算提示，不提供储值卡或借贷合规方面的意见。',
  },
  {
    key: 'profit', ruleId: 'V钱-4', level: 'later', needs: [],
    when: (m) => m.hasData && m.score !== null && m.score < 80,
    text: () => `净利率偏低。先动成本、后动价格：把成本结构核准之后再回头看定价与菜品结构，`
      + `顺序反了容易把老客赶走。`,
    boundary: '',
  },
];

/** 分档（智库 V断-3 原文：<3月别大动作砍固定成本 / 3-6月可试1-2动作 / >6月别慌） */
function survivalTier(months) {
  if (months === null) return 'unknown';
  if (months < 3) return 'urgent';
  if (months < 6) return 'cautious';
  return 'steady';
}

const TIER_TEXT = {
  urgent: '账上的钱撑不到 3 个月：这一两周只做「砍固定成本」这类不花钱的动作，先别做装修、扩店、大改菜单。',
  cautious: '还能撑 3–6 个月：可以试 1–2 个动作，每做完一个看一次下月账有没有变化，别一次全改。',
  steady: '还能撑 6 个月以上：不用慌，按下面顺序一项一项来，改完一个月再看数。',
  unknown: '',
};

/** 分档下允许展示的 level + 条数上限（防"一次给 11 条动作"变成新的正确废话） */
const TIER_LIMIT = {
  urgent: { levels: ['now'], max: 2 },
  cautious: { levels: ['now', 'try'], max: 3 },
  steady: { levels: ['now', 'try', 'later'], max: 3 },
  unknown: { levels: ['now', 'try'], max: 2 },
};

/**
 * 装配处方（纯函数，零 IO）。
 * @param {object} d  { diagnosis, derived, input } —— input 含敏感原值，**只在服务端用，不回传**
 * @returns {{tier:string, tierText:string, actions:Array, disclaimer:string}}
 *   actions: [{ key, ruleId, label, text, boundary, level }]
 */
function buildActions(d) {
  const dg = (d && d.diagnosis) || {};
  const dv = (d && d.derived) || {};
  const input = (d && d.input) || {};
  const metrics = dg.metrics || [];

  // ---- 1. 只从「已算好的 facts」取数，本层不做任何新的经营判断 ----
  const revFen = num(input.revenueFen);
  const burnFen = num(input.avgMonthlyNetLossFen);
  const cashFen = num(input.cashOnHandFen);
  const grossPct = num(input.foodCostRatePct);
  const rentWarnPct = rentWarnOf(input.bizType, input.cityTier); // 引擎 RENT_WARN_HI × 城市系数，单源
  const facts = {
    rentPct: num(input.rentRatePct),
    rentWarnPct,
    laborPct: num(input.laborCostRatePct),
    grossPct: grossPct === null ? '' : (100 - grossPct).toFixed(1),
    burnYuan: burnFen === null ? '' : yuan(burnFen),
    bleedPct: (burnFen !== null && burnFen > 0 && revFen !== null && revFen > 0)
      ? ((burnFen / revFen) * 100).toFixed(1) : '',
    lossMonths: num(input.lossMonths) === null ? '若干' : String(num(input.lossMonths)),
    runwayMonths: (cashFen !== null && burnFen !== null && burnFen > 0)
      ? (cashFen / burnFen).toFixed(1) : '',
  };

  // 生存月数：优先用引擎 cash 项已算好的 note 同源算法，避免另起一套口径
  const tier = survivalTier(
    (cashFen !== null && burnFen !== null && burnFen > 0) ? cashFen / burnFen : null
  );
  const lim = TIER_LIMIT[tier] || TIER_LIMIT.unknown;

  // ---- 2. 按「丢分 × 权重」的既有顺序（anchors）取短板，只从规则表里挑 ----
  const ordered = dg.anchors && dg.anchors.length ? dg.anchors : metrics.filter((m) => m.hasData);
  const picked = [];
  for (const a of ordered) {
    const rule = RULES.find((r) => r.key === a.key);
    if (!rule) continue;
    if (lim.levels.indexOf(rule.level) < 0) continue;   // 分档过滤：急档不给「慢慢调」
    const m = metrics.find((x) => x.key === a.key) || a;
    if (!rule.when(m)) continue;
    // 🔴 带数校验：动作句需要的每个事实都必须**真的算出来了**（非空、非 undefined）。
    //   宁可少给一条，也不输出「undefined%」「NaN 元」这种一眼假。
    //   这是处方层最重要的一道 fail-closed —— 事实缺失时闭嘴，不许靠模板硬填。
    const needs = rule.needs || [];
    if (needs.some((k) => facts[k] === '' || facts[k] === null || facts[k] === undefined)) continue;
    let text;
    try { text = rule.text(facts); } catch (e) { continue; }
    if (!text || /undefined|NaN|Infinity/.test(text)) continue;
    picked.push({
      key: rule.key,
      ruleId: rule.ruleId,
      label: a.label || m.label || '',
      text,
      boundary: rule.boundary || '',
      level: rule.level,
      _order: picked.length,
    });
  }

  // 🔴 页面桩实测发现的「一眼假」：净利率项丢分最多排第一，但它的处方是「慢慢调」；
  //   分档说明却写「按下面顺序一项一项来」⇒ 老板第一眼看到的是最不急的那条。
  //   ⇒ 按处方紧急度 now > try > later 重排，同级内保持 anchors 的丢分顺序。
  const PRIORITY = { now: 0, try: 1, later: 2 };
  picked.sort((x, y) => (PRIORITY[x.level] - PRIORITY[y.level]) || (x._order - y._order));
  const actions = picked.slice(0, lim.max).map((a) => {
    const out = { key: a.key, ruleId: a.ruleId, label: a.label, text: a.text, boundary: a.boundary, level: a.level };
    return out;
  });

  // ---- 3. 数据不足时不给处方（不给"半本账"开药方）----
  if (dg.level === 'insufficient') {
    return {
      tier: 'insufficient',
      tierText: '',
      actions: [],
      reason: 'insufficient',
    };
  }

  return {
    tier,
    tierText: TIER_TEXT[tier] || '',
    actions,
    reason: actions.length ? '' : 'no_weak_metric',
  };
}

module.exports = { RULES, TIER_TEXT, TIER_LIMIT, survivalTier, buildActions, yuan };
