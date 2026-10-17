// utils/breakeven.js —— R311 · 体检的**算法地基**（纯函数 · 零外部依赖 · 不动引擎）
//
// 设计依据（`review/PLAN_R311_体检主线重定_归因矫正.md`）：
//   李老师的洞察：占比类指标（房租/人工/水电占比）的**分母都是营业额** ⇒ 它们同时变差
//   **不是 N 个问题，是 1 个问题的 N 个投影**；而老板对营业额最无力 ⇒ 只报红＝没有行动出口。
//   ⇒ 本模块只做三件"能算准"的事：
//     ① 把费用拆成 固定/变动 ⇒ **保本营收区间** + 安全边际（"我还能扛多久"）
//     ② **归因拆分**：某项占比偏高，多少是"营收不够"（分母效应）、多少是"该项真贵了"（分子效应）
//     ③ **健康营收**：营收要提到多少，占比才全部回到行业区间（一个可追的目标）
//
// 🔴 五条铁律（本仓踩出来的）：
//   1) **报区间不报单点** —— 半变动系数本身是估的，默认值下保本营收误差约 ±10%（顶格 15%）
//   2) **敏感性用相对浮动**：`rate × (1±10%)`，**不是** `rate ± 10 个百分点`
//      （豆包第二轮定：单量越高变动占比越高，绝对浮动会失真）
//   3) **归属拿不准就算固定**（保守）⇒ 保本线偏高 ⇒ 宁可让老板以为更危险
//   4) **没有营收就不算**（`needRevenue`）—— 不许拿 0 当分母造出一堆 Infinity
//   5) **名字认不出 ⇒ 按固定**，且**如实回报**（`unknown[]`），不静默猜

// ===== 一、费用归属常量（**唯一单源**；改动只在这里改）=====
// variable = 该项内**随营收变动的比例（%）**。依据：R310Ω 与豆包两轮商议定稿。
const COST_MODEL = [
  { key: 'food',       names: ['食材成本', '食材', '原料'],        variable: 100, label: '食材成本' },
  { key: 'rent',       names: ['房租'],                            variable: 0,   label: '房租' },
  { key: 'property',   names: ['物业费', '物业'],                  variable: 0,   label: '物业费' },
  { key: 'water',      names: ['水费'],                            variable: 60,  label: '水费' },
  { key: 'electric',   names: ['电费'],                            variable: 65,  label: '电费' },
  { key: 'gas',        names: ['燃气费', '燃气'],                  variable: 75,  label: '燃气费' },
  { key: 'trash',      names: ['垃圾清运费', '垃圾清运'],          variable: 0,   label: '垃圾清运费' },
  { key: 'network',    names: ['宽带网费', '宽带'],                variable: 0,   label: '宽带网费' },
  { key: 'salary',     names: ['工资绩效', '工资', '人工'],        variable: 30,  label: '工资绩效' },
  { key: 'social',     names: ['社保'],                            variable: 0,   label: '社保' },
  { key: 'commission', names: ['外卖平台佣金', '平台佣金', '佣金'], variable: 100, label: '外卖佣金' },
  { key: 'delivery',   names: ['外卖配送服务费', '配送费'],        variable: 80,  label: '配送费' },
  { key: 'promo',      names: ['外卖配送补贴', '活动补贴', '补贴'], variable: 100, label: '活动补贴' },
  { key: 'manage',     names: ['管理费'],                          variable: 40,  label: '管理费' },
  { key: 'amort',      names: ['折旧摊销', '摊销'],                variable: 0,   label: '折旧摊销' },
];

// 🔴 实测教训（R311 首跑真实量级就暴露）：**"误差 ±10%" 是错的通说**。
//   同一份费用结构，边际贡献率 30% 时，变动率 ±10% 会让**保本营收差 ±38%**（10.8万~17.4万）；
//   贡献率越低，区间越宽。⇒ **区间必须按贡献率真算出来，不许对外报一个固定的 ±10%**。
//   对外只能说「按假设估算，区间见上」，并把区间本身显示出来（够了，不需要再报一个误差百分比）。

/** 敏感性：半变动部分的**相对**浮动幅度（±10%） */
const SENS_REL = 0.10;

/** 名字 → 归属项（认不出 ⇒ null，调用方按固定处理并回报） */
function inferByName(name) {
  const n = String(name === undefined || name === null ? '' : name).trim();
  if (!n) return null;
  for (const m of COST_MODEL) {
    for (const alias of m.names) {
      if (n === alias || n.indexOf(alias) >= 0) return m;
    }
  }
  return null;
}

/**
 * 把 M1 的费用行拆成固定/变动。
 * @param {Array<{name:string, amountFen:number}>} rows
 * @param {object} opts { deliverySelf:boolean }  // 自配/混合配 ⇒ 配送费按 固定20%/变动80%（默认）；平台专送 ⇒ 100% 变动
 * @returns {{ fixedFen, variableFen, totalFen, detail:[], unknown:string[] }}
 */
function splitFixedVariable(rows, opts) {
  const o = opts || {};
  const detail = [];
  const unknown = [];
  let fixedFen = 0;
  let variableFen = 0;

  // 🔴 R311 实测发现（必须补，否则保本线全错）：M1 的**食材成本不在 expenseItems 里**
  //   （见 calcMonthlyProfit/service.js:22-27：expenseItems 是"费用非食材成本"；
  //     食材另有 directConsumeFen，库存开关开时 = 期初 + 采购 − 期末 = materialCostFen）
  //   而食材是**最大的变动成本**（行业 55–70%）。漏了它 ⇒ 变动成本几乎为零 ⇒ 贡献率虚高
  //   ⇒ 保本线**大幅偏低** ⇒ 体检会说"你离亏还远"，这是最危险的方向。
  //   ⇒ 由调用方把 `materialCostFen` 传进来，固定按 **100% 变动** 计入。
  const material = Math.round(Number(o.materialCostFen) || 0);
  if (material > 0) {
    variableFen += material;
    detail.push({ key: 'food', label: '食材成本', variablePct: 100, amountFen: material, fixedFen: 0, variableFen: material, from: 'material' });
  }

  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r) continue;
    const amt = Math.round(Number(r.amountFen) || 0);
    if (!amt) continue;                       // 0 元行不参与（也不进 unknown，免得噪声）
    const m = inferByName(r.name);
    let vPct;
    if (!m) {
      // 认不出 ⇒ **按固定**（保守：固定多 ⇒ 保本线偏高 ⇒ 不会低估风险），并如实回报
      vPct = 0;
      unknown.push(String(r.name || ''));
    } else if (m.key === 'delivery') {
      // 🔴 配送费按模式二分（豆包第二轮纠错）：平台专送＝100% 变动；自配/混合＝80%
      vPct = o.deliverySelf ? 80 : 100;
    } else {
      vPct = m.variable;
    }
    const v = Math.round((amt * vPct) / 100);
    const f = amt - v;
    fixedFen += f;
    variableFen += v;
    detail.push({ key: m ? m.key : '', label: m ? m.label : String(r.name || ''), variablePct: vPct, amountFen: amt, fixedFen: f, variableFen: v });
  }
  return { fixedFen, variableFen, totalFen: fixedFen + variableFen, detail, unknown };
}

/**
 * 保本营收 + 敏感性区间 + 安全边际。
 * @param {object} p { revenueFen, fixedFen, variableFen }
 * @returns {{ needRevenue:boolean, ok:boolean, reason:string,
 *             contributionRate:number, breakevenFen:number,
 *             lowFen:number, highFen:number, safeMarginPct:number }}
 */
function breakeven(p) {
  const o = p || {};
  const R = Math.round(Number(o.revenueFen) || 0);
  const F = Math.round(Number(o.fixedFen) || 0);
  const V = Math.round(Number(o.variableFen) || 0);
  const base = { needRevenue: false, ok: false, reason: '', contributionRate: 0, breakevenFen: 0, lowFen: 0, highFen: 0, safeMarginPct: null };
  if (!(R > 0)) return Object.assign({}, base, { needRevenue: true, reason: 'noRevenue' });
  if (!(F > 0)) return Object.assign({}, base, { reason: 'noFixed' });      // 没有固定成本 ⇒ 不存在保本线（不编）
  const cr = 1 - V / R;                                                     // 边际贡献率
  if (!(cr > 0)) return Object.assign({}, base, { reason: 'noContribution' }); // 变动成本 ≥ 营收 ⇒ 卖越多亏越多
  const be = F / cr;
  // 🔴 敏感性用**相对**浮动（豆包定）：变动率 × (1±10%)
  const vLo = V * (1 - SENS_REL);
  const vHi = V * (1 + SENS_REL);
  const crLo = 1 - vHi / R;   // 变动更高 ⇒ 贡献更低 ⇒ 保本更高
  const crHi = 1 - vLo / R;
  const hi = crLo > 0 ? F / crLo : be;
  const lo = crHi > 0 ? F / crHi : be;
  const r2 = (x) => Math.round(x);
  return {
    needRevenue: false, ok: true, reason: '',
    contributionRate: Math.round(cr * 1000) / 1000,
    breakevenFen: r2(be),
    lowFen: r2(Math.min(lo, be)),
    highFen: r2(Math.max(hi, be)),
    safeMarginPct: Math.round(((R - be) * 1000) / R) / 10,   // 一位小数
  };
}

/**
 * 归因拆分：某项占比比目标高，多少是"营收不够"（分母效应）、多少是"该项真贵了"（分子效应）。
 * 数学上严格可加（不是豆包那条略松的式子）：
 *   率差(pp) = F/R − Ft/Rt
 *   分母效应 = F/R − F/Rt = F × (1/R − 1/Rt)
 *   分子效应 = F/Rt − Ft/Rt
 *   ⚠️ 这里用 Ft / Rt 表示"目标固定费用 / 目标营收"——**不要写成 F* 或 R\***：
 *   注释里出现 `*` + `/` 会**提前闭合块注释**，整段变成代码（本文件踩过，`node --check` 抓到的）。
 * @param {object} p { revenueFen, itemFen, targetRatePct, targetRevenueFen }
 *   targetRatePct   — 行业区间中点（如房租 12）
 *   targetRevenueFen— 「健康营收」（占比回区间所需营收）
 * @returns {{ ratePct, targetRatePct, diffPp, denomPp, numerPp, needTarget:boolean }}
 */
function attribution(p) {
  const o = p || {};
  const R = Number(o.revenueFen) || 0;
  const F = Number(o.itemFen) || 0;
  const tr = Number(o.targetRatePct);
  const R2 = Number(o.targetRevenueFen) || 0;
  if (!(R > 0) || !(R2 > 0) || !(tr > 0)) return { ratePct: null, targetRatePct: tr || null, diffPp: null, denomPp: null, numerPp: null, needTarget: true };
  const rate = (F * 100) / R;
  const denom = F * 100 * (1 / R - 1 / R2);      // pp
  const numer = ((F * 100) / R2) - tr;           // pp
  const round2 = (x) => Math.round(x * 10) / 10;
  return {
    ratePct: round2(rate),
    targetRatePct: tr,
    diffPp: round2(rate - tr),
    denomPp: round2(denom),
    numerPp: round2(numer),
    needTarget: false,
  };
}

/**
 * 健康营收：营收要提到多少，若干项占比才**全部**回到行业区间上界。
 * 对每项：F / R ≤ hi%  ⇒  R ≥ F / hi * 100。取各需求的最大值。
 * @param {Array<{name, amountFen, hiPct}>} rows  hiPct = 该指标行业区间**上界**（%）
 * @returns {number} 分；0 表示无法算（全部已达标或无有效项）
 */
function healthyRevenue(rows) {
  let need = 0;
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r) continue;
    const f = Number(r.amountFen) || 0;
    const hi = Number(r.hiPct) || 0;
    if (!(f > 0) || !(hi > 0)) continue;
    const req = (f * 100) / hi;
    if (req > need) need = req;
  }
  return Math.round(need);
}

/**
 * 🔴 结构性判定（R311 首跑发现的**新诊断分支**）：
 *   若「健康营收」**低于**「保本营收」⇒ 意思是：**即使把占比全部调回行业正常，你仍然亏**
 *   ⇒ 那问题不在费用、也不在营业额不够，而在**毛利结构/定价**（贡献率太低）。
 *   这时如果还劝他"降本/提营业额"，就是**开错药**。
 * @returns {'normal'|'structural'|'tooTight'}
 *   structural —— 健康营收 < 保本营收（占比正常也亏）
 *   tooTight   —— 健康营收 ≥ 保本营收但差距 < 5%（勉强）
 */
function diagnose(healthyFen, breakevenFen) {
  const h = Number(healthyFen) || 0;
  const b = Number(breakevenFen) || 0;
  if (!(h > 0) || !(b > 0)) return '';
  if (h < b) return 'structural';
  if ((h - b) / b < 0.05) return 'tooTight';
  return 'normal';
}

module.exports = {
  COST_MODEL, SENS_REL,
  inferByName, splitFixedVariable, breakeven, attribution, healthyRevenue, diagnose,
};
