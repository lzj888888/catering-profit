// utils/momExplain.js —— 跨月归因：解释「这个月为什么比上个月多赚/少赚」
//
// 为什么需要它（M3 全景评估 §二·第二层第 1 条）：
//   老板最常问的一句话是「我这个月比上个月好在哪」，而现在的实现只给一句
//   「比上月多赚 840 元」—— 给的是**结果**，不是**原因**。
//   老板拿到这个数只会再问一句「为什么」，然后我们答不上来。
//
// 🔴 口径铁律（这是本模块存在的全部意义）：
//   真钱利润 = 营业收入 − 费用 − 食材消耗 − 摊销 − 一次性投入
//   （`cloudfunctions/calcMonthlyProfit/service.js:118`）
//   ⇒ 这 **5 个因子**的变动贡献之和，必须**严格等于**两个月真钱利润之差。
//   对不上就说明还有因子没被覆盖（或某个月口径不同）⇒ **返回 ok:false，不给归因**。
//   宁可只说「差了多少」，也不许编一个听着合理、其实对不上账的原因 ——
//   老板按错误归因去调经营，比不知道更糟。
//
// 不做的事（明确划界）：
//   · 不下沉到「哪个科目」：逐科目对比会碰到「上月少录一项」这种数据问题，
//     一归因就会得出「费用降了」的假象。汇总层对得上账，才敢说。
//   · 不做建议（「你该降房租」）：那是诊断引擎的职责，本模块只解释发生了什么。
//   · 不猜缺失：任何一侧缺字段就判不平衡，不补 0 硬算。

const FIELDS = [
  // sign = +1 ⇒ 该因子变大对利润是**好事**（收入）；-1 ⇒ 是**坏事**（各项成本费用）
  { key: 'income', label: '营业收入', sign: 1, field: 'income_total_fen' },
  { key: 'expense', label: '各项费用', sign: -1, field: 'expense_total_fen' },
  { key: 'consume', label: '食材消耗', sign: -1, field: 'real_consume_fen' },
  { key: 'amort', label: '摊销', sign: -1, field: 'effective_amortize_fen' },
  { key: 'lump', label: '一次性投入', sign: -1, field: 'effective_lump_sum_fen' },
];

// 分 → 元（整数元，归因是"量级"叙述，不需要小数；守卫会断言这里不做四舍五入污染）
function yuan(fen) {
  return Math.round(Math.abs(Number(fen) || 0) / 100);
}

function pickResult(d) {
  if (!d) return null;
  // getLedger 的出参在 `data.result` 里（R510 踩过：读顶层恒 undefined）
  return (d.result && typeof d.result === 'object') ? d.result : d;
}

/**
 * @param {object} cur  本月 getLedger 出参（含 result）
 * @param {object} prev 上月 getLedger 出参（含 result）
 * @param {object} [opts] { minAbsFen } 低于此额度的因子不提（默认 100 分 = 1 元）
 * @returns {{ok:boolean, reason?:string, deltaFen?:number, items?:Array, text?:string}}
 */
function explain(cur, prev, opts) {
  const o = opts || {};
  const minAbsFen = o.minAbsFen == null ? 100 : o.minAbsFen;

  const cr = pickResult(cur);
  const pr = pickResult(prev);
  if (!cr || !pr) return { ok: false, reason: 'missing_side' };

  // ⓪ 口径一致性（R690 自查补的洞，**这条比下面的不平衡校验更隐蔽**）
  //
  //   `real_consume_fen`（食材消耗）有两种算法，取决于当月有没有**真的盘点**：
  //     · 盘点了   ⇒ 倒轧值（期初 + 采购 − 期末）
  //     · 没盘点   ⇒ 老板填的采购入库金额
  //   （见 calcMonthlyProfit/service.js 头注 R484 段与 getLedger 的 stock_take_done）
  //
  //   两个月盘点状态不同 ⇒ 这两个数**业务上不可比**（一个含库存变动、一个不含）。
  //   ⚠️ 危险在于：这种不可比**不会**被下面那条「五因子之和 ≡ 利润差」拦住 ——
  //      利润本身就是按各自口径算的，所以数学上依然严丝合缝、平衡校验照样通过。
  //      ⇒ 若不在这里拦，就会得出「食材消耗少了 3000 元」这种**看起来有据、其实是换算法**的结论。
  //      老板据此以为"我控成本有成效"，比不知道更糟。
  //
  //   字段缺失按 false 处理（老月份可能没有 stock_take_done）：两个月都缺 ⇒ 视为同口径，可归因。
  const curTake = (cur && cur.stock_take_done === true);
  const prevTake = (prev && prev.stock_take_done === true);
  if (curTake !== prevTake) {
    return { ok: false, reason: 'caliber_mismatch', curTake: curTake, prevTake: prevTake };
  }

  // ① 五个因子逐一取差额，任何一侧缺字段 ⇒ 不给归因（不补 0 硬算）
  const items = [];
  let sum = 0;
  for (const f of FIELDS) {
    const c = cr[f.field];
    const p = pr[f.field];
    if (c == null || p == null) return { ok: false, reason: 'missing_field:' + f.field };
    if (!Number.isFinite(Number(c)) || !Number.isFinite(Number(p))) {
      return { ok: false, reason: 'bad_number:' + f.field };
    }
    const delta = Number(c) - Number(p);
    const contribution = delta * f.sign;   // 对利润的贡献（正=利好）
    sum += contribution;
    items.push({
      key: f.key,
      label: f.label,
      deltaFen: delta,
      contributionFen: contribution,
      // dir: 该因子本身是"多了"还是"少了"（与贡献正负**不是一回事**，别混）
      dir: delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat'),
      good: contribution > 0,
    });
  }

  // ② 硬校验：Σ贡献 ≡ Δ利润（容差 1 分，防浮点尾差）
  const curProfit = Number(cr.total_factor_real_profit_fen);
  const prevProfit = Number(pr.total_factor_real_profit_fen);
  if (!Number.isFinite(curProfit) || !Number.isFinite(prevProfit)) {
    return { ok: false, reason: 'missing_profit' };
  }
  const profitDelta = curProfit - prevProfit;
  if (Math.abs(sum - profitDelta) > 1) {
    // 说明还有因子没覆盖，或某个月口径不同 ⇒ 不编
    return { ok: false, reason: 'unbalanced', sum: sum, profitDelta: profitDelta };
  }

  // ③ 取贡献绝对值最大的两项（都不超过 minAbsFen 就只给金额，不给原因）
  const ranked = items.slice()
    .filter((x) => Math.abs(x.contributionFen) >= minAbsFen)
    .sort((a, b) => Math.abs(b.contributionFen) - Math.abs(a.contributionFen));
  const top = ranked.slice(0, 2);

  if (!top.length) {
    return { ok: true, deltaFen: profitDelta, items: [], text: '' };
  }

  // ④ 拼一句人话：「主要是营业收入多了 2,000 元；食材消耗多了 1,160 元抵掉一部分」
  const clauses = top.map((x, i) => {
    const money = yuan(x.contributionFen) ? yuan(x.contributionFen) : yuan(x.deltaFen);
    const word = x.dir === 'up' ? '多了' : '少了';
    const s = x.label + word + money + '元';
    if (i === 0) return s;
    // 第二项：同向说"另外…也…"，反向说"…抵掉一部分"
    return (x.good === top[0].good ? '另外' + s + '也起了作用' : s + '抵掉一部分');
  });

  return {
    ok: true,
    deltaFen: profitDelta,
    items: top,
    // 「主要是」而不是「因为」：归因是相关性叙述，不等于因果，避免过度承诺
    text: '主要是' + clauses[0] + (clauses[1] ? '；' + clauses[1] : ''),
  };
}

module.exports = { explain, FIELDS };
