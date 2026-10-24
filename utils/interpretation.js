// utils/interpretation.js —— L0 决策语句（纯函数 · 不读时钟 · 不调模型 · 不引外部基准）
//
// 为什么要有这一层（`review/PLAN_2026-10-23_AI落地路标_v1.md` §一 / §五 P0-②）：
//   老板要的不是「和小程序聊天」，是「告诉我该动哪一下」。而「该动哪一下」是**确定性的** ——
//   同样的数字，任何模型都应该得出同一句结论。所以这一层不交给大模型：
//   模型只负责把它组织成人话，**判断本身在这里出**。
//
// 边界（改这个文件前先读）：
//   · 只消费**引擎已经算好的数字**（ledger 出参 / breakeven 出参 / anomalyRules 出参）。
//     本模块**不做任何金额计算**，也不把分换成元 —— 只做「取哪个字段、跟哪条线比、怎么排序」。
//   · 不读时钟：月份由调用方传入，否则同一个月在 12 月跑和 1 月复跑结论会不一致。
//   · 不引外部基准：所有参考线都写在 `THRESHOLDS` 里，并**明确标注「自定参考线，非行业标准」**。
//     引同业数据是另一件事（要真数据源），不能在这里偷偷塞一个"行业均值"。
//   · 返回**机器码 + 参数**，不返回中文文案 —— 文案由页面/导出层按 `code` 取术语文案，
//     这样术语改名不会让判断静默失效（同 `check_page_terms` 判据③ 的教训）。
'use strict';

// 判断口径版本：每条结论都带它 ⇒ 事后能指回「当时用的是哪套规则」
// （与 M2 的 bands_version、M3 的 ENGINE_VERSION、anomalyRules 的 RULES_VERSION 同一族）。
const RULES_VERSION = 'interp-1';

const LEVELS = { INFO: 'info', AMBER: 'amber', RED: 'red' };
const SEVERITY = { info: 0, amber: 1, red: 2 };

// 🔴 全部参考线集中在这里。**改任何一条都要同步 `tools/check_ai_pack.js` 的锚点。**
//   注意：这不是行业标准，是本产品的 L0 经验线（老板能看懂、且能自己验证的线）。
const THRESHOLDS = {
  // 安全边际低于这个百分点 ⇒ 提醒「离保本线很近」。10% 的含义：营收再掉一成就不赚钱了。
  safeMarginThinPct: 10,
  // 异常项最多带几条进判断（多了老板不看）。规则层另有 maxItems=20，那是「算多少」，这是「说多少」。
  maxAnomalyItems: 3,
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 生成当月的 L0 判断。
 *
 * @param {object} facts
 *   · hasLedger        {boolean} 本月是否建档（false ⇒ 只出 NO_LEDGER，别的判断一律不出）
 *   · profitFen        {number}  真钱利润（分，取 total_factor_real_profit_fen）
 *   · revenueFen       {number}  营业收入（分）
 *   · profitDiffFen    {number}  两口径差异（分）
 *   · breakeven        {object}  `utils/breakeven.js::breakeven()` 的原样出参
 *   · anomalies        {object}  `utils/anomalyRules.js::buildChecklist()` 的原样出参
 * @returns {{version:string, level:string, items:Array<{code:string,level:string,params:object}>}}
 */
function buildInterpretation(facts) {
  const f = facts || {};
  const items = [];

  function push(code, level, params) {
    items.push({ code: code, level: level, params: params || {} });
  }

  // ① 未建档：这是「正常态」，不是亏损。判据必须和结果页同源（`account_id`），不能用数值反推。
  if (f.hasLedger === false) {
    push('NO_LEDGER', LEVELS.INFO, {});
    return { version: RULES_VERSION, level: LEVELS.INFO, items: items };
  }

  const profitFen = num(f.profitFen);
  const revenueFen = num(f.revenueFen);
  const diffFen = num(f.profitDiffFen);
  const be = f.breakeven || {};
  const anom = f.anomalies || {};

  // ② 亏损：利润为负是唯一「不用解释也得先说」的事。
  if (profitFen != null && profitFen < 0) {
    push('LOSS', LEVELS.RED, { profitFen: profitFen });
  }

  // ③ 没到保本线：只在保本线真的算得出来（`ok`）时才判，算不出来不硬说。
  if (be.ok && revenueFen != null && num(be.breakevenFen) != null && revenueFen < num(be.breakevenFen)) {
    push('BELOW_BREAKEVEN', LEVELS.RED, {
      revenueFen: revenueFen,
      breakevenFen: num(be.breakevenFen),
      gapFen: num(be.breakevenFen) - revenueFen,
    });
  }

  // ④ 保本线算不出来：如实说原因（没营收 / 没固定成本），不拿 0 冒充。
  if (be.needRevenue) push('NO_REVENUE', LEVELS.INFO, {});
  else if (!be.ok && be.reason === 'noFixed') push('NO_FIXED_COST', LEVELS.INFO, {});

  // ⑤ 安全边际薄：只在引擎给得出时判（safeMarginPct 为 null ⇒ 不判）。
  if (num(be.safeMarginPct) != null && num(be.safeMarginPct) < THRESHOLDS.safeMarginThinPct) {
    push('THIN_SAFE_MARGIN', LEVELS.AMBER, {
      safeMarginPct: num(be.safeMarginPct),
      linePct: THRESHOLDS.safeMarginThinPct,
    });
  }

  // ⑥ 两口径差异：不是错误，是「这笔钱记在哪」的问题 ⇒ 必须解释，否则老板会以为算错了。
  if (diffFen != null && diffFen !== 0) {
    push('TWO_CALIBER_DIFF', LEVELS.INFO, { profitDiffFen: diffFen });
  }

  // ⑦ 异常项：规则层已经判好了方向与幅度，这里只负责「带几条、带哪些」（不重算）。
  const anomItems = Array.isArray(anom.items) ? anom.items : [];
  if (anom.basis && anom.basis.insufficient) {
    push('HISTORY_SHORT', LEVELS.INFO, {
      historyMonths: num(anom.basis.history_months) || 0,
      needMonths: (anom.basis.thresholds && num(anom.basis.thresholds.minHistoryMonths)) || null,
    });
  } else if (anomItems.length) {
    const top = anomItems.slice(0, THRESHOLDS.maxAnomalyItems).map(function (it) {
      return {
        key: it.key,
        rule: it.rule,
        direction: it.direction,
        amountFen: it.amount_fen,
        ratioPct: it.ratio_pct,
        ratioUnit: it.ratio_unit || 'pct',
        band: it.band,
        attention: it.attention,
      };
    });
    push('ANOMALY_ITEMS', LEVELS.AMBER, { count: anomItems.length, top: top });
  }

  // ⑧ 没有任何红/黄 ⇒ 明确说「本月没有要先看的东西」，而不是留一个空数组让人猜。
  const hasWarn = items.some(function (it) { return it.level === LEVELS.RED || it.level === LEVELS.AMBER; });
  if (!hasWarn) push('NO_SIGNAL', LEVELS.INFO, {});

  let level = LEVELS.INFO;
  items.forEach(function (it) {
    if ((SEVERITY[it.level] || 0) > (SEVERITY[level] || 0)) level = it.level;
  });

  return { version: RULES_VERSION, level: level, items: items };
}

module.exports = { RULES_VERSION, THRESHOLDS, buildInterpretation };
