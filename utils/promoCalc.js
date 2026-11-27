// utils/promoCalc.js —— 「这活动做完还赚不赚」纯手填测算（R757 新工具，2026-11-25）
//
// 🔴 定位：**不读任何店里数据**。老板手填 3 个数就出结论，新用户不用先建账、先建卡。
//   与 `utils/promoImpact.js` 的区别（两者不要合并，输出语义不同）：
//     · promoImpact：要**固定费用**（房租工资）⇒ 算「活动期保本营业额」。属 M2 沙盘，门槛高。
//     · 本模块：**不要固定费用** ⇒ 算「要保住原来那笔毛利，得多来多少客人」。属轻工具，门槛低。
//   ⇒ 这正解释了 `PROMO_ENABLED=false` 当初「牵扯面大」的真因：入口在沙盘里、要先填一堆参数。
//   两者共用的只有「活动后毛利率」这一条口径，selftest 里做**对拍**防漂移。
//
// 🔴 核心发现（2026-11-25，与国外成熟模型对拍后确认）：
//   **流水倍数 ≠ 客流倍数**，而且客流倍数才是真实压力。
//   例：毛利率 50%、日流水 8000、活动降到 20% 毛利率 ⇒
//     流水要 ×2.50（8000→20000），但**客流要 ×4.00**（客单 200 ⇒ 40 单/天 → 160 单/天）。
//   差在分母：折扣同时压低了客单价，流水里的增长有一部分是"每单少收钱"堆出来的。
//   国外公式（Breakeven Sales Uplift，primecosttools / billfeeds 等多家一致）：
//     客流增幅% = 折扣% ÷ (毛利率% − 折扣%)
//   本模块的 trafficUpliftPct 与之等价，selftest 用 65% 打 8 折 = +44% 对拍。
//
// 🔴 三个边界（fail-closed，绝不输出编出来的数）：
//   · 毛利率 ≤0 或 >100       ⇒ badMargin
//   · 等效折扣 ≤0 或 >1       ⇒ badDiscount
//   · 活动后毛利率 ≤ 0        ⇒ impossible（临界折扣 = 1 − 毛利率，低于它卖一件亏一件）

const PCT = 100;
// 取整用 toFixed 而非 Math.round(n*100)/100：本模块取整的是**比例**（毛利率/倍数），
// 不是金额，不存在「元→分」的十进制半步问题；也避免给金额精度守卫制造无意义的登记。
const round2 = (n) => Number(Number(n).toFixed(2));

/** 风险档：业界经验——需要客流增幅 >50% 基本做不到（多来源一致） */
function riskOf(upliftPct, newMarginPct) {
  if (!(newMarginPct > 0)) return 'impossible';
  const u = Number(upliftPct);
  if (!isFinite(u)) return 'impossible';
  if (u <= 30) return 'ok';
  if (u <= 50) return 'watch';
  return 'risky';
}

/**
 * 各种活动形式 → 等效折扣系数 d（1 = 不打折，0.8 = 八折）。
 * 全部是纯算术，输入即老板手填的活动规则。
 * @returns {{ok:boolean, d?:number, reason?:string, note?:string}}
 */
function discountOf(kind, p) {
  const q = p || {};
  const pos = (v) => (isFinite(Number(v)) && Number(v) > 0);

  switch (String(kind || '')) {
    // 全场/单品折扣：老板填「打几折」，如 8 折 ⇒ 0.8
    case 'off': {
      const d = Number(q.discount);
      if (!pos(d) || d > 1) return { ok: false, reason: 'badDiscount' };
      return { ok: true, d: d };
    }
    // 满 X 减 Y：按客单价折算。客单未达门槛 ⇒ 按门槛算并提示（做活动的目的就是把客单拉到门槛）
    case 'threshold': {
      const x = Number(q.threshold);
      const y = Number(q.cut);
      const a = Number(q.avgPrice);
      if (!pos(x) || !pos(y) || y >= x) return { ok: false, reason: 'badRule' };
      const avgOk = isFinite(a) && a > 0;
      const base = (avgOk && a > x) ? a : x;
      // 🔴 R763（R762 审计 P0）：客单价留空时不再沉默按门槛算 —— 标记 no_avg_price，
      //   由页面明确告知老板「这是按门槛估的保守折扣」，不能冒充真实折扣。
      const note = !avgOk ? 'no_avg_price' : (a < x ? 'below_threshold' : '');
      // 🔴 R764（豆包会审缺口）：单档 once / 每满 each（可封顶）。
      //   「满100减30」只减一次；「每满100减30」客单250要减60（封顶见 cap）。
      //   减额必须按**客单价**算，不能按门槛算——否则每满永远只显示一档力度。
      const each = String(q.mode || 'once') === 'each';
      const rawCut = each ? Math.floor(base / x) * y : y;
      const cap = Number(q.cap);
      const capOk = isFinite(cap) && cap > 0;
      const cutTotal = capOk ? Math.min(rawCut, cap) : rawCut;
      if (!(cutTotal > 0) || cutTotal >= base) return { ok: false, reason: 'badDiscount' };
      const d = (base - cutTotal) / base;
      if (!(d > 0) || d > 1) return { ok: false, reason: 'badDiscount' };
      return { ok: true, d: d, note: note,
        mode: each ? 'each' : 'once', cutTotal: round2(cutTotal),
        capped: capOk && rawCut > cap };
    }
    // 买 M 赠 K：等效 d = M / (M+K)
    case 'bogo': {
      const m = Number(q.buy);
      const k = Number(q.free);
      if (!pos(m) || !pos(k)) return { ok: false, reason: 'badRule' };
      return { ok: true, d: m / (m + k) };
    }
    // 第 N 件半价：均价折扣 = ((N−1) + 0.5) / N
    case 'nth': {
      const n = Number(q.n);
      if (!pos(n) || n < 2) return { ok: false, reason: 'badRule' };
      return { ok: true, d: ((n - 1) + 0.5) / n };
    }
    // 代金券 🔴 R761 口径纠偏：face = **实付多少钱**（花 80 买 100 面额就填 80）。
    //   旧口径把 face 当「减额」，导致「80代100」算成 (100−80)/100=2折 —— 与老板心智相反。
    //   新口径统一为 d = 实付/抵额：80代100 ⇒ 0.8；满100减30 ⇒ 实付70填进去 ⇒ 0.7。
    //   豆包 2026-11-26 独立评审推荐此口径（单券折扣是固有属性，不被使用张数改变）。
    case 'voucher': {
      const face = Number(q.face);           // 实付（购价）
      const x = Number(q.threshold);         // 抵额（面额）
      if (!pos(face) || !pos(x) || face > x) return { ok: false, reason: 'badRule' };
      return { ok: true, d: face / x };
    }
    // 同行免单：N 人里免 K 人 ⇒ d = (N−K)/N
    case 'share': {
      const n = Number(q.people);
      const k = Number(q.free);
      if (!pos(n) || !pos(k) || k >= n) return { ok: false, reason: 'badRule' };
      return { ok: true, d: (n - k) / n };
    }
    // 储值赠金：充 P 送 B ⇒ 实付占面值比 = P/(P+B)
    case 'stored': {
      const pr = Number(q.principal);
      const bo = Number(q.bonus);
      if (!pos(pr) || !(Number(bo) >= 0)) return { ok: false, reason: 'badRule' };
      return { ok: true, d: pr / (pr + bo) };
    }
    // 积分抵现 / 任意「应付 A、减免 V」
    case 'offset': {
      const a = Number(q.payable);
      const v = Number(q.offset);
      if (!pos(a) || !(Number(v) >= 0) || v >= a) return { ok: false, reason: 'badRule' };
      return { ok: true, d: (a - v) / a };
    }
    // 🔴 R764（豆包会审关键坑）：赠品。赠品标价 30、成本率 30% ⇒ 商家真实成本只有 9 元。
    //   d 这里是**顾客感知/宣传口径**（付 base 拿 base+标价 的东西）；算账必须用 costYuan/lossPer100。
    //   ⚠ 绝不能把标价 30 当让利塞进 promoCalc —— 会把损失高估 3 倍多，且客流倍数算错。
    case 'gift': {
      const base = Number(q.avgPrice);
      const value = Number(q.giftValue);
      const c = Number(q.giftCostPct);
      if (!pos(base) || !pos(value) || !(Number(c) >= 0) || c > 100) return { ok: false, reason: 'badRule' };
      const cost = round2(value * c / 100);
      return { ok: true, d: base / (base + value), note: 'gift_list_price',
        costYuan: cost, lossPer100: round2(cost / base * 100) };
    }
    // 时段/品类限定、阶梯拼团：老板直接填等效折扣
    case 'direct': {
      const d = Number(q.discount);
      if (!pos(d) || d > 1) return { ok: false, reason: 'badDiscount' };
      return { ok: true, d: d };
    }
    default:
      return { ok: false, reason: 'badKind' };
  }
}

const round4 = (n) => Number(Number(n).toFixed(4));

/**
 * 🔴 R759（李老师纠偏）：折扣换算**独立于毛利率**。
 *   原话：「买2送1相当于打几折，最终大部分都去到『是打了几折』这个问题」。
 *   老板 90% 的心智是「这个活动等于几折」，不该被「先填毛利率」卡住。
 *   本函数只做活动规则 → 折扣，不读、不需要毛利率；页面第一段用它。
 *   第二段「要多少才回到原来的利润」才用 promoCalc（要毛利率）。
 */
function promoConvert(kind, rule) {
  const q = rule || {};
  const r = discountOf(kind, q);
  if (!r.ok) return { ok: false, reason: r.reason };
  // 🔴 R761 代金券「限用几张」（豆包评审 A 口径）：限用张数**不改变单券折扣**，
  //   只输出「满多少可用最多几张」的提示数字，让老板知道要凑到多少消费。
  //   算法层只给数字（count / maxSpend），中文文案留给 terms 单源（本仓纪律）。
  let limitInfo = null;
  if (String(kind) === 'voucher') {
    const n = Number(q.limit);
    const x = Number(q.threshold);
    if (isFinite(n) && n >= 1 && isFinite(x) && x > 0) {
      limitInfo = { count: Math.floor(n), maxSpend: round2(Math.floor(n) * x) };
    }
  }
  // 🔴 R764：统一对比口径 = 每 100 元原价流水的商家成本损失（元）。
  //   满减/折扣 = 折扣率本身；赠品 = 赠品成本÷客单×100（不是标价！）。
  //   老板横向比「满减30 vs 送标价30」时，看这个数才不会被标价骗。
  const lossPer100 = (r.lossPer100 !== undefined) ? r.lossPer100 : round2((1 - r.d) * 100);
  return {
    ok: true,
    discount: r.d,
    formula: formulaOf(kind, q),
    note: r.note || '',
    limitInfo: limitInfo,
    lossPer100: lossPer100,
    giftCostYuan: r.costYuan,
    mode: r.mode || 'once',
    cutTotal: r.cutTotal,
    capped: !!r.capped,
  };
}

/** 推导式：把「几折」的中间算式摆出来（李老师：中间有什么数值是怎么体现的） */
function fmtNum(n) {
  const x = Number(n);
  if (!isFinite(x)) return '?';
  return Number.isInteger(x) ? String(x) : String(Number(x.toFixed(2)));
}
function formulaOf(kind, p) {
  const q = p || {};
  const n = fmtNum;
  switch (String(kind || '')) {
    // 🔴 R763：推导式的分母必须和折扣分母是同一个数（客单价 >门槛时用客单价）
    // 🔴 R764：每满/封顶时减额取实际减的总额（客单250每满100减30 ⇒ (250−60)÷250）
    case 'threshold': {
      const a = Number(q.avgPrice);
      const x = Number(q.threshold);
      const y = Number(q.cut);
      const base = (isFinite(a) && a > 0 && a > Number(x)) ? a : x;
      const each = String(q.mode || 'once') === 'each';
      const rawCut = each ? Math.floor(base / x) * y : y;
      const cap = Number(q.cap);
      const cut = (isFinite(cap) && cap > 0) ? Math.min(rawCut, cap) : rawCut;
      return '(' + n(base) + '−' + n(cut) + ')÷' + n(base);
    }
    case 'bogo': return n(q.buy) + '÷(' + n(q.buy) + '+' + n(q.free) + ')';
    case 'nth': return '(' + n(q.n) + '−1+0.5)÷' + n(q.n);
    case 'voucher': return n(q.face) + '÷' + n(q.threshold);
    case 'share': return '(' + n(q.people) + '−' + n(q.free) + ')÷' + n(q.people);
    case 'stored': return n(q.principal) + '÷(' + n(q.principal) + '+' + n(q.bonus) + ')';
    case 'offset': return '(' + n(q.payable) + '−' + n(q.offset) + ')÷' + n(q.payable);
    // R764：赠品折扣是宣传口径（付原价拿原价+赠品标价）
    case 'gift': return n(q.avgPrice) + '÷(' + n(q.avgPrice) + '+' + n(q.giftValue) + ')';
    default: return ''; // 直接填折扣 / 时段品类：无推导式，填的就是折扣
  }
}

/**
 * 主测算。
 * @param {object} p
 * @param {number} p.marginPct      现在毛利率（百分数，50 表示 50%）
 * @param {number} [p.revenueYuan]  现在日/月流水（元，选填；给了才输出「需要多少流水」）
 * @param {number} [p.avgPriceYuan] 客单价（元，选填；给了才输出「需要多少单/多少客人」）
 * @param {number} [p.discount]     等效折扣（0.8）—— 或改用 kind + 规则参数，由 discountOf 折算
 * @param {string} [p.kind]         活动形式
 * @param {object} [p.rule]         该形式的参数
 */
/**
 * 🔴 R764 赠品独立模型（不能复用 promoCalc 的折扣模型）。
 *   根因：赠品**不压低实收**，只增加成本。硬塞成等效折扣会让客流倍数算错：
 *     毛利50/日销8000/客单100、送标价30成本9 ⇒ 真实 g1=41%、流水×1.22、客流×1.22；
 *     若硬塞 d=50/41 进 promoCalc，客流会算成 ×1.44（假数）。
 *   统一对比口径：每百元原价流水的成本损失 lossPer100 = 赠品成本÷客单×100。
 */
function giftModel(q, r) {
  const g0 = Number(q.marginPct);
  const loss = Number(r.lossPer100);
  const g1 = round2(g0 - loss);
  const criticalLoss = round2(g0);
  if (!(g1 > 0)) {
    return { ok: false, reason: 'impossible', kind: 'gift', lossPer100: loss,
      giftCostYuan: r.costYuan, newMarginPct: g1, criticalLossPct: criticalLoss, note: r.note };
  }
  const mult = round4(g0 / g1);
  const uplift = round2((mult - 1) * 100);
  const out = {
    ok: true, kind: 'gift', reason: '',
    lossPer100: loss, giftCostYuan: r.costYuan,
    // 宣传口径折扣（只展示，不参与算账）
    discount: r.d, discountPct: round2((1 - r.d) * 100),
    newMarginPct: g1, newMarginPctExact: round4(g1), marginDropPp: round2(g0 - g1),
    // 赠品不降价 ⇒ 流水倍数 = 客流倍数（与满减「流水≠客流」刻意不同）
    revenueMultiple: mult, trafficMultiple: mult, trafficUpliftPct: uplift,
    criticalLossPct: criticalLoss, riskLevel: riskOf(uplift, g1), note: r.note,
  };
  const rev = Number(q.revenueYuan);
  if (isFinite(rev) && rev > 0) {
    out.revenueNeededYuan = round2(rev * mult);
    out.listRevenueNeededYuan = out.revenueNeededYuan; // 赠品实收 = 原价流水
  }
  const price = Number(q.avgPriceYuan);
  if (isFinite(price) && price > 0 && rev > 0) {
    out.ordersNow = Math.round(rev / price);
    out.ordersNeeded = Math.ceil(rev / price * mult);
  }
  return out;
}

function promoCalc(p) {
  const q = p || {};
  const g0 = Number(q.marginPct);
  if (!(g0 > 0) || g0 > 100) return { ok: false, reason: 'badMargin' };

  let d;
  let note = '';
  if (q.kind) {
    const r = discountOf(q.kind, q.rule || {});
    if (!r.ok) return { ok: false, reason: r.reason };
    // 🔴 R764：赠品走独立模型，绝不套折扣口径
    if (String(q.kind) === 'gift') return giftModel(q, r);
    d = r.d; note = r.note || '';
  } else {
    d = Number(q.discount);
    if (!(d > 0) || d > 1) return { ok: false, reason: 'badDiscount' };
  }

  // 🔴 R764：折扣率必须保留**精确值**参与计算，只在显示时取整。
  //   先 round2 到 33.33 再算毛利率，会让 6.67 折的保本线从 16000 漂成 15997.6（真踩到）。
  const discountPctExact = (1 - d) * 100;
  const discountPct = round2(discountPctExact);    // 折扣率百分数（ratio 类，非金额）
  // 活动后毛利率：GA = (G0 − 折扣率) / 折扣系数（与 promoImpact 同源口径，selftest 对拍）
  const g1 = (g0 - discountPctExact) / d;
  const newMarginPct = round2(g1);
  if (!(newMarginPct > 0)) {
    return {
      ok: false, reason: 'impossible', discount: d, discountPct: discountPct,
      newMarginPct: newMarginPct, criticalDiscount: round4(1 - g0 / PCT), note: note,
    };
  }

  // 流水倍数 = G0 / G1（保住原毛利额需要的营业额倍数）
  // 🔴 R764：必须用**未取整**的 g1 —— 用 round2 后的 28.57 会把 1.75 算成 1.7501、保本线多 1 元
  const revenueMultiple = round4(g0 / g1);
  // 客流/单量倍数 = G0 / (G0 − 折扣率%)  —— 与国外 Breakeven Sales Uplift 等价
  // 同一根因：分母也用精确折扣率，否则 6.67 折会算成 +199.94% 而真值是 +200%
  const denom = g0 - discountPctExact;
  const trafficMultiple = denom > 0 ? round4(g0 / denom) : null;
  const trafficUpliftPct = denom > 0 ? round2((g0 / denom - 1) * 100) : null;

  const out = {
    ok: true, reason: '',
    discount: d, discountPct: discountPct,
    // R764 统一对比口径：每百元原价流水的成本损失（满减/折扣 = 折扣率本身）
    lossPer100: discountPct,
    newMarginPct: newMarginPct,
    // 精确值（未取整）供第四段回带，避免 round2 让保本线差几块钱
    newMarginPctExact: round4(g1),
    marginDropPp: round2(g0 - newMarginPct),
    revenueMultiple: revenueMultiple,
    trafficMultiple: trafficMultiple,
    trafficUpliftPct: trafficUpliftPct,
    // 临界折扣：低于它活动后毛利率 ≤0 ⇒ 卖一件亏一件
    criticalDiscount: round4(1 - g0 / PCT),
    riskLevel: riskOf(trafficUpliftPct, newMarginPct),
    note: note,
  };

  const rev = Number(q.revenueYuan);
  if (isFinite(rev) && rev > 0) {
    out.revenueNeededYuan = round2(rev * (g0 / g1));
    // 🔴 R764：同时给「原价流水」口径 —— 保本实收 14000 ≠ 老板按原价算的 20000，
    //   不标清楚老板会对不上账（豆包会审 §二 指出的口径坑）。
    out.listRevenueNeededYuan = round2(out.revenueNeededYuan / d);
  }
  const price = Number(q.avgPriceYuan);
  if (isFinite(price) && price > 0 && trafficMultiple !== null) {
    out.ordersNeeded = Math.ceil(rev > 0 ? rev / price * trafficMultiple : 0);
    out.ordersNow = rev > 0 ? Math.round(rev / price) : null;
  }
  return out;
}

/**
 * 低价引流套餐：套餐降价后，靠「连带正价消费」能不能补回来。
 * 🔴 不设「转化率」参数（豆包 2026-11-25 指出）：转化率是过程指标，单店没统计能力，拍数误差极大。
 *   只让老板填一个「单客连带正价金额」，**默认 0 ⇒ 最坏底线**（引流客什么都不多点）。
 *   公式：总毛利 =（活动价 − 单位成本）× 单量 + 连带金额 × 正价毛利率 × 单量
 * @param {object} p
 * @param {number} p.listPrice    原价（元）
 * @param {number} p.cost         单位成本（元）
 * @param {number} p.promoPrice   活动价（元）
 * @param {number} [p.attachYuan] 单客连带正价金额（元，默认 0）
 * @param {number} [p.attachMarginPct] 正价菜毛利率（百分数，默认 60）
 * @param {number} [p.baselineOrders] 活动前该品单量（用于算「要多少单才等于原来」）
 */
function setMealCalc(p) {
  const q = p || {};
  const list = Number(q.listPrice);
  const cost = Number(q.cost);
  const promo = Number(q.promoPrice);
  if (!(list > 0) || !(cost >= 0) || !(promo > 0)) return { ok: false, reason: 'badInput' };
  if (cost >= promo) {
    return { ok: false, reason: 'negativeUnit', unitGrossYuan: round2(promo - cost),
      hint: '活动价比成本还低 ⇒ 卖一份亏一份，靠连带也补不回来时不要做' };
  }
  const attach = Number(q.attachYuan) >= 0 ? Number(q.attachYuan) : 0;
  const attachMargin = Number(q.attachMarginPct);
  const am = (isFinite(attachMargin) && attachMargin > 0 && attachMargin <= 100) ? attachMargin : 60;

  const unitGrossNormal = round2(list - cost);
  const unitGrossPromo = round2(promo - cost);
  const attachGross = round2(attach * am / PCT);
  const unitGrossTotal = round2(unitGrossPromo + attachGross);
  const ordersToEqual = unitGrossTotal > 0 ? round4(unitGrossNormal / unitGrossTotal) : null;
  const out = {
    ok: true,
    listPrice: list, promoPrice: promo, cost: cost,
    promoDiscount: round4(promo / list),
    unitGrossNormal: unitGrossNormal,
    unitGrossPromo: unitGrossPromo,
    attachGross: attachGross,
    unitGrossTotal: unitGrossTotal,
    attachAssumed: attach > 0,
    // 要等于原来一份的毛利，需要做多少份
    ordersToEqual: ordersToEqual,
    // 如果给了原单量 ⇒ 需要多少单才保住原来的总毛利
    ordersNeededTotal: (ordersToEqual !== null && Number(q.baselineOrders) > 0)
      ? Math.ceil(Number(q.baselineOrders) * ordersToEqual) : null,
    // 连带要不要填：连带为 0 时明确标注这是"最坏底线"
    note: attach > 0 ? '' : 'no_attach_worst_case',
  };
  return out;
}

/**
 * 🔴 R761（李老师原话）：低价引流套餐「直接填活动后毛利率反算」。
 *   原话：「正常 200 块毛利 100（50%），现在变成毛利率 20%，需要做多少流水才能覆盖到原来水平」。
 *   这是与 promoCalc **反方向**的入口：promoCalc 填折扣→算毛利率；本函数填目标毛利率→反推折扣。
 *   推导：G1 = (G0 − (1−d)·100)/d ⇒ d = (100−G0)/(100−G1)（G0/G1 都是百分数）。
 *   对拍：G0=50/G1=20 ⇒ d=0.625（6.25折）⇒ 流水×2.5、单量×4（与 promoCalc 正算回带一致）。
 *   fail-closed：G0/G1 必须 (0,100]；G1>=G0 表示活动没降毛利 ⇒ 不需要反算。
 * @param {object} p
 * @param {number} p.marginPct       现在毛利率（百分数）
 * @param {number} p.targetMarginPct 活动后目标毛利率（百分数，老板直接填）
 * @param {number} [p.revenueYuan]   现在流水（元，选填）
 * @param {number} [p.avgPriceYuan]  客单价（元，选填）
 */
function reverseFromMargin(p) {
  const q = p || {};
  const g0 = Number(q.marginPct);
  const g1 = Number(q.targetMarginPct);
  if (!(g0 > 0) || g0 > 100) return { ok: false, reason: 'badMargin' };
  if (!(g1 > 0) || g1 > 100) return { ok: false, reason: 'badTargetMargin' };
  if (g1 >= g0) return { ok: false, reason: 'noDrop', hint: '活动后毛利率没降，不需要反算' };

  const d = round4((100 - g0) / (100 - g1));
  // 复用 promoCalc 正算：保证反算结果与正算同一套口径（流水/单量/风险），不写第二套公式
  const r = promoCalc({ marginPct: g0, discount: d,
    revenueYuan: q.revenueYuan, avgPriceYuan: q.avgPriceYuan });
  if (!r.ok) return { ok: false, reason: r.reason, discount: d };
  return {
    ok: true, discount: d, discountPct: r.discountPct,
    criticalDiscount: r.criticalDiscount,
    revenueMultiple: r.revenueMultiple, trafficMultiple: r.trafficMultiple,
    trafficUpliftPct: r.trafficUpliftPct, riskLevel: r.riskLevel,
    revenueNeededYuan: r.revenueNeededYuan,
    ordersNeeded: r.ordersNeeded, ordersNow: r.ordersNow,
    newMarginPct: r.newMarginPct,
  };
}

/**
 * 🔴 R764 第四段「活动效果评估」：把「卖多少才不亏」升级成「预计赔/赚多少钱」。
 *   前两段答的是"要多少"（保本线），本函数答"实际多少"——差别就在**活动后预计流水**这个预测值。
 *   口径：老板填「活动后预计日**实收**流水」（满减是打折后的到账额；赠品等于原价流水）。
 *   原毛利 = 原日流水 × 天数 × G0%
 *   活动毛利 = 预计日实收 × 天数 × g1%
 *   🔴 R779 口径修正（三司会诊 + 独立复核）：净差 = 毛利差 − 一次性投入。
 *     改前还扣了「日均固定成本×天数」，但房租和固定人工**做不做活动都要付**，
 *     属两边都存在的沉没成本，在「活动相比不做多赚/赔多少」里必须抵消 —— 扣它等于扣两次。
 *     实测：原日流水8000/毛利60% → 8折后50%/7天预计11000/房租人工800每天/海报500：
 *       改前「赔1200」，改后「赚4400」，方向完全相反。
 * @param {object} p
 * @param {number} p.marginPct           活动前毛利率（百分数）
 * @param {number} p.newMarginPct        活动后毛利率（百分数，由 promoCalc/giftModel 给出）
 * @param {number} p.baselineRevenueYuan 活动前日实收流水（元）
 * @param {number} p.expectedRevenueYuan 活动后预计日实收流水（元）
 * @param {number} p.days                活动天数
 * @param {number} [p.oneTimeCostYuan]   一次性投入（宣传/物料，元，默认 0）
 */
function promoEffect(p) {
  const q = p || {};
  const g0 = Number(q.marginPct);
  // 优先用未取整的精确毛利率（promoCalc/giftModel 的 newMarginPctExact）
  const g1 = Number(q.newMarginPctExact !== undefined && q.newMarginPctExact !== null
    ? q.newMarginPctExact : q.newMarginPct);
  const base = Number(q.baselineRevenueYuan);
  const exp = Number(q.expectedRevenueYuan);
  const days = Number(q.days);
  const once = (q.oneTimeCostYuan === undefined || q.oneTimeCostYuan === '' || q.oneTimeCostYuan === null)
    ? 0 : Number(q.oneTimeCostYuan);
  if (!(g0 > 0) || g0 > 100) return { ok: false, reason: 'badMargin' };
  if (!(g1 > 0) || g1 > 100) return { ok: false, reason: 'badNewMargin' };
  if (!(base > 0) || !(exp >= 0) || !(days > 0)) return { ok: false, reason: 'badInput' };
  if (!(once >= 0)) return { ok: false, reason: 'badInput' };

  const originalGross = round2(base * days * g0 / PCT);
  const promoGross = round2(exp * days * g1 / PCT);
  const grossDiff = round2(promoGross - originalGross);
  // 🔴 R779：只扣一次性投入。固定成本两边都付 ⇒ 已互相抵消，不得再扣（见函数头注释）。
  const invest = round2(once);
  const netDiff = round2(grossDiff - invest);
  // 不含一次性投入的保本日实收：g0/g1 是保毛利额所需的流水倍数
  const breakEvenDailyYuan = round2(base * g0 / g1);
  return {
    ok: true, reason: '',
    days: days,
    originalGross: originalGross,
    promoGross: promoGross,
    grossDiff: grossDiff,
    invest: invest,
    netDiff: netDiff,
    profitable: netDiff > 0,
    // 折成日均，便于和老板"一天多赚多少"的心智对齐
    netPerDay: round2(netDiff / days),
    breakEvenDailyYuan: breakEvenDailyYuan,
    revenueMultiple: round4(g0 / g1),
  };
}

module.exports = {
  promoCalc, promoConvert, discountOf, formulaOf, setMealCalc,
  reverseFromMargin, promoEffect, riskOf, round2, round4, PCT,
};
