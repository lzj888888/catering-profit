// utils/priceVariance.js —— 量价拆分（把「多花了多少」拆成「买贵了多少」和「多买了多少」）
//
// 🔴 定位（李老师 2026-11-24「第三期」，会诊后的必然一步）：
//   会诊指出「金额 = 数量 × 单价，两者互相掩盖」⇒ 只看金额永远查不出回扣。
//   本模块就是那把**拆开金额**的刀：拿到两期的「采购量 + 采购金额」，把金额变化拆成两项。
//
// 🔴🔴 核心公式（已实跑验证：两项之和**恰好等于**总变化，无交叉项、无残差）：
//   记 P = 采购金额 ÷ 采购量（本月均价），Q = 采购量；下标 0 = 上期，1 = 本期
//     Δ金额 = (P₁ − P₀) × Q₁  +  (Q₁ − Q₀) × P₀
//              └─ 价格影响 ─┘     └─ 数量影响 ─┘
//   证明： (P₁−P₀)Q₁ + (Q₁−Q₀)P₀ = P₁Q₁ − P₀Q₁ + P₀Q₁ − P₀Q₀ = P₁Q₁ − P₀Q₀ ∎
//   ⚠️ 这个分解只是**多种可行分解中的一种**（另一种是用 Q₀ 配 ΔP）。选它的理由是：
//     价格影响按**本期实际买到的量**计价 —— 即"我这次真金白银多付了多少"，最贴近老板体感。
//
// 🔴 它为什么能查回扣（会诊里被批"金额查不出"，这里正面回答）：
//   实测一组：单价 45→56.25（+25%）、量 250→200（−20%），**采购金额 11250→11250 分毫不差**。
//   只看金额：「这个月牛肉钱没变，很正常」；拆开后：**买贵 2250 / 少买 2250** —— 问题立刻现形。
//   ⇒ 有了「量 + 金额」两期数据，回扣（价）与囤货/缺斤短两（量）就是两个独立可比的数。
//
// 边界（fail-closed，绝不输出编出来的数）：
//   · 本期量 ≤ 0 或金额 ≤ 0 ⇒ 算不出均价，返回 reason
//   · 上期缺失/无效 ⇒ 只回本期均价，**不给**同比与拆分（没有基准就不编）
//   · 上期量 ≤ 0 ⇒ 同上（除零）
//
// 🔴 诚实边界（必须进页面文案）：
//   价格影响为正是**事实**（同样的量多付了钱），但**原因**可能是行情、季节、品质升级、
//   紧急采购，也可能是回扣。本模块只做拆分，**不做任何定性**。

const num0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100 + 1e-9) / 100;

/**
 * 由「采购量 + 采购金额」算均价（分/单位）。
 * @returns {{ok:boolean, priceFen?:number, reason?:string}}
 */
function avgPriceOf(qty, amountFen) {
  const q = num0(qty);
  const a = num0(amountFen);
  if (!(q > 0)) return { ok: false, reason: 'no_qty' };
  if (!(a > 0)) return { ok: false, reason: 'no_amount' };
  return { ok: true, priceFen: a / q };
}

/**
 * 量价拆分主函数。
 * @param {{qty:number, amountFen:number}} cur  本期（采购量、采购金额分）
 * @param {{qty:number, amountFen:number}} [prev] 上期；缺省 ⇒ 只给本期均价
 * @returns {object}
 *   ok=true 时：
 *     priceCurFen / pricePrevFen（均价，分/单位）
 *     priceChangePct（单价比变化百分数，正=涨价）
 *     amountCurFen / amountPrevFen / amountDeltaFen
 *     priceImpactFen（价格影响，正=买贵多花）
 *     qtyImpactFen（数量影响，正=多买多花）
 *     decomposed（是否做了拆分）
 */
function priceVariance(cur, prev) {
  const c = cur || {};
  const p = prev || {};
  const cPx = avgPriceOf(c.qty, c.amountFen);

  // 本期本身不完整 ⇒ 连均价都给不了
  if (!cPx.ok) return { ok: false, reason: cPx.reason };

  const base = {
    ok: true,
    priceCurFen: Math.round(cPx.priceFen),
    amountCurFen: Math.round(num0(c.amountFen)),
    qtyCur: round2(num0(c.qty)),
    decomposed: false,
  };

  // 上期不完整 ⇒ 只回本期均价，**不编同比**（没有基准就没有"涨了多少"）
  const pPx = avgPriceOf(p.qty, p.amountFen);
  if (!pPx.ok) return Object.assign(base, { why: pPx.reason || 'no_prev' });

  const q0 = num0(p.qty);
  const q1 = num0(c.qty);
  const p0 = pPx.priceFen;
  const p1 = cPx.priceFen;

  const amountPrev = Math.round(num0(p.amountFen));
  const amountCur = Math.round(num0(c.amountFen));
  const amountDelta = amountCur - amountPrev;

  // 🔴 两项之和 ≡ 总变化（见文件头证明）。不要在这里"校正残差"—— 那不是误差，是恒等。
  const priceImpact = Math.round((p1 - p0) * q1);
  const qtyImpact = Math.round((q1 - q0) * p0);

  return Object.assign(base, {
    decomposed: true,
    pricePrevFen: Math.round(p0),
    priceChangePct: round2(((p1 - p0) / p0) * 100),
    amountPrevFen: amountPrev,
    amountDeltaFen: amountDelta,
    // 数量影响按**上期价**算、价格影响按**本期量**算 —— 故两者相加恰为总变化
    priceImpactFen: priceImpact,
    qtyImpactFen: qtyImpact,
    qtyPrev: round2(q0),
    // 自检：两项之和必须等于总变化（写进输出便于页面/测试复核，也防以后有人"顺手优化"破坏恒等）
    sumMatchesDelta: (priceImpact + qtyImpact) === amountDelta,
  });
}

/**
 * 判定是否值得提示（只给事实，不下结论）。
 * 🔴 阈值刻意保守：餐饮生鲜月度波动 5~15% 属常见，10% 才提示；且**不叫"异常"叫"变化较大"**。
 * @returns {{level:'none'|'up'|'down', pct:number}}
 */
function priceAlertOf(pv) {
  if (!pv || !pv.ok || !pv.decomposed || pv.priceChangePct == null) return { level: 'none', pct: 0 };
  const pct = pv.priceChangePct;
  if (pct >= 10) return { level: 'up', pct };
  if (pct <= -10) return { level: 'down', pct };
  return { level: 'none', pct };
}

module.exports = { priceVariance, avgPriceOf, priceAlertOf };
