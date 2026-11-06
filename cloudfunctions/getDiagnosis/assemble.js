// cloudfunctions/getDiagnosis/assemble.js —— 纯函数：账本 + 店铺 → 诊断引擎输入（**零 IO**）
//
// 为什么单独成文件：
//   ① 可被 selftest 直接 require 真跑（不懂云、不连库），把"连亏怎么数、月均净亏损怎么算"钉死；
//   ② index.js 只剩读库与鉴权，逻辑面一眼看完；
//   ③ 与 `validate.js` 同风格（本仓既有的纯函数层）。
//
// ============ 三条口径纪律 ============
// 🔴 1. **利润取落库值，不重算**。`shop_monthly_account.total_factor_real_profit_fen` 是 saveLedger
//    落库时算好的；这里若重算一遍，就会造出第二个利润口径（页面说 9000、诊断说 8,600 这种）。
//    ⚠️ 已知边界：归档月用落库快照、未归档月页面会用实时开关重算，两者在"保存后改过开关"时可能差一点。
//    诊断是**跨月趋势**用途，取落库值更稳（不会因为今天改一次开关，把过去 6 个月的连亏历史全改写）。
// 🔴 2. **缺月不猜**。某月没有利润字段 ⇒ 连亏链条在此**断开**，并把 `truncated` 标出来，
//    绝不当成"这个月不亏"继续往下数（那会把 5 个月连亏数成 2 个月）。
// 🔴 3. **不亏损时月均净亏损 = 0**，不是 null。null 会让引擎判"缺数据"，0 才是"不亏"这个事实。
//
// 参数：{ shop, accounts }
//   shop     —— shop 文档（读 biz_type / city_tier / diag_facts）
//   accounts —— shop_monthly_account 记录数组（可乱序、可含重复月）
// 返回：{ diagnosis, input, derived, basis }

const MAX_LOOKBACK = 12;   // 最多回看 12 个月（再久之前的经营状态对"现在该不该止损"参考价值很低）
const AVG_WINDOW = 3;      // 月均净亏损取近 3 个月（李老师：只填一个月体现不出来，要几个月平均）

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// snake_case → camelCase（引擎读 amountFen / subItems）。
// ⚠️ 与 `cloudfunctions/getLedger/index.js::normalizeToCamel` 同语义 —— 那是读账的通用适配层，
//   不是业务规则（业务规则在 indicatorRef）。此处复制一份是为了不改 getLedger 这条热路径。
function normalizeToCamel(rawItems) {
  return (rawItems || []).map((it) => {
    const amt = it.amount_fen !== undefined ? it.amount_fen : it.amountFen;
    const subRaw = it.sub_items || it.subItems || [];
    return {
      category: it.category || '',
      name: it.name || '',
      amountFen: amt != null ? amt : 0,
      subItems: subRaw.map((si) => ({
        subItem: si.sub_item !== undefined ? si.sub_item : (si.subItem || ''),
        amountFen: si.amount_fen !== undefined ? si.amount_fen : si.amountFen,
      })),
    };
  });
}

function assemble(args) {
  const a = args || {};
  const shop = a.shop || {};
  const accounts = a.accounts || [];

  const bizType = shop.biz_type || '';
  const cityTier = shop.city_tier || '';
  const df = (shop.diag_facts && typeof shop.diag_facts === 'object' && !Array.isArray(shop.diag_facts))
    ? shop.diag_facts : {};

  // ---------- 1. 月份去重 + 倒序（新在前） ----------
  const byMonth = new Map();
  for (const r of accounts) if (r && r.month && !byMonth.has(r.month)) byMonth.set(r.month, r);
  const months = Array.from(byMonth.values())
    .sort((x, y) => (x.month < y.month ? 1 : -1))
    .slice(0, MAX_LOOKBACK);
  const cur = months[0] || null;

  // ---------- 2. 连续亏损月数（从最近月往前数，遇非亏/缺数即停） ----------
  let lossMonths = null;
  let lossTruncated = false;
  let lossChecked = 0;
  if (months.length) {
    lossMonths = 0;
    for (const m of months) {
      const p = numOrNull(m.total_factor_real_profit_fen);
      if (p === null) { lossTruncated = true; break; }
      lossChecked++;
      if (p < 0) lossMonths++;
      else break;                       // 转正 ⇒ 链条到此为止（"从最近一次单月转正后算起"）
    }
  }

  // ---------- 2b. 营业额同比（R614 新增：替代"客流人次同比"） ----------
  // 为什么用营业额而不是客流：老板拿不到"人次"（收银系统只有单数/营业额），
  //   而营业额他一定有 —— 它本身就是"客流 × 客单价"，对"这家店在不在退"更直接。
  // 条件：库里存在「去年同月」那本账且营业额 > 0。不足 13 个月的店算不出来，
  //   交给补录页的主观三档兜底（引擎侧的 note 会写明"按你的判断"，不冒充精确值）。
  let revenueYoyPct = null;
  let revenueYoyBaseMonth = '';
  if (cur && cur.month) {
    const ym = /^(\d{4})-(\d{2})$/.exec(cur.month);
    if (ym) {
      const lastKey = (Number(ym[1]) - 1) + '-' + ym[2];
      const last = byMonth.get(lastKey);
      if (last) {
        const a = numOrNull(cur.income_total_fen);
        const b = numOrNull(last.income_total_fen);
        if (a !== null && b !== null && b > 0) {
          revenueYoyPct = ((a - b) / b) * 100;
          revenueYoyBaseMonth = lastKey;
        }
      }
    }
  }

  // ---------- 3. 月均净亏损（近 3 个有利润数的月份取平均；平均为正 ⇒ 0） ----------
  const withProfit = months
    .filter((m) => numOrNull(m.total_factor_real_profit_fen) !== null)
    .slice(0, AVG_WINDOW);
  let avgMonthlyNetLossFen = null;
  let avgWindow = 0;
  if (withProfit.length) {
    const sum = withProfit.reduce((s, m) => s + numOrNull(m.total_factor_real_profit_fen), 0);
    const avgProfit = sum / withProfit.length;
    avgMonthlyNetLossFen = avgProfit < 0 ? Math.round(-avgProfit) : 0;
    avgWindow = withProfit.length;
  }

  // ---------- 4. 当月占比（人工/房租）—— 用指标单源算，不自己求商 ----------
  const curRevenue = cur ? numOrNull(cur.income_total_fen) : null;
  const curProfit = cur ? numOrNull(cur.total_factor_real_profit_fen) : null;
  let laborPct = null; let rentPct = null; let rigidFen = null; let foodCostPct = null;

  if (cur) {
    const expenseItems = normalizeToCamel(cur.expense_items);
    const indicatorRef = require('./common').indicatorRef;   // 🔴 扁平副本（云端每函数独立包，'../common' 不存在）
    const byInd = indicatorRef.sumByTag(expenseItems);
    const indicators = indicatorRef.m1IndicatorsOf(indicatorRef.evaluateIndicators({
      bizKey: bizType,
      cityKey: cityTier,
      revenueFen: curRevenue,
      fixedFen: indicatorRef.toFixedFen(byInd),
      grossMarginPct: (curRevenue > 0 && cur.gross_margin_pct != null) ? cur.gross_margin_pct : null,
      platformPct: (byInd.mkt != null && curRevenue > 0) ? (byInd.mkt / curRevenue) * 100 : null,
    }));
    const pick = (k) => { const r = indicators.find((x) => x.key === k); return r ? r.pct : null; };
    laborPct = pick('labor');
    rentPct = pick('rent');
    // 月刚性支出仅作**展示参考**（R612 起不再参与现金流判据，判据用月均净亏损）
    const lab = byInd.labor != null ? byInd.labor : null;
    const rnt = byInd.rent != null ? byInd.rent : null;
    const util = byInd.energy != null ? byInd.energy : null;
    rigidFen = (lab != null && rnt != null && util != null) ? (lab + rnt + util) : null;
    // 对外禁用「食材成本率」⇒ 只在内部换算成毛利率再喂引擎
    foodCostPct = (cur.gross_margin_pct != null) ? (100 - cur.gross_margin_pct) : null;
  }

  // ---------- 5. 组装引擎输入 ----------
  const input = {
    bizType,
    cityTier,
    revenueFen: curRevenue,
    netProfitFen: curProfit,
    avgMonthlyNetLossFen,
    lossMonths,
    foodCostRatePct: foodCostPct,
    laborCostRatePct: laborPct,
    rentRatePct: rentPct,
    monthlyRigidFen: rigidFen,
    // 🔴 R614：原 `trafficThisMonth` / `trafficLastYear` 两个"人次数"输入**已移除**（老板填报不出来），
    //   改为营业额同比（自动算）+ 主观三档（兜底）。字段仍从库里读旧值是不必要的 ——
    //   历史 traffic_count 只是留档，不再参与任何判断。
    revenueYoyPct,
    revenueFeel: df.revenue_trend_feel || null,
    rating: numOrNull(df.rating),
    reviewTrend: df.review_trend || null,
    businessDistrict: df.business_district || null,
    leaseMonthsLeft: numOrNull(df.lease_months_left),
    renewIncreasePct: numOrNull(df.renew_increase_pct),
    debtLevel: df.debt_level || null,
    cashOnHandFen: numOrNull(df.cash_on_hand_fen),
    // 重大食安：只认 true / false；undefined/null ⇒ 引擎判「未判定」（不是"没问题"）
    foodSafetyEvent: (df.food_safety_event === true || df.food_safety_event === false) ? df.food_safety_event : null,
  };

  const { evaluateDiagnosis } = require('./common');
  const diagnosis = evaluateDiagnosis(input);

  return {
    diagnosis,
    input,
    derived: {
      month: cur ? cur.month : '',
      monthsUsed: months.length,
      lossMonths,
      lossTruncated,
      lossChecked,
      avgMonthlyNetLossFen,
      avgWindow,
      revenueYoyPct,
      revenueYoyBaseMonth,
      monthlyRigidFen: rigidFen,
      hasDiagFacts: Object.keys(df).length > 0,
    },
    // 给上层展示"这个数是按哪几个月算的"，便于老板核对
    basis: {
      months: months.slice(0, AVG_WINDOW).map((m) => ({
        month: m.month,
        profitFen: numOrNull(m.total_factor_real_profit_fen),
      })),
    },
  };
}

module.exports = { assemble, MAX_LOOKBACK, AVG_WINDOW, normalizeToCamel };
