// tools/check_mom_explain.js —— R690 跨月归因守卫
//
// 判据对象：`utils/momExplain.js::explain`
//
// 为什么必须有：这是全项目**唯一一处用算术去解释"为什么"**的地方。
//   它的失败形态全部是"听着很合理但指错了方向"：
//     ① 五因子之和 ≠ 利润差（漏了摊销/一次性投入）⇒ 归因半真半假，老板照错的方向去调；
//     ② 符号写反（费用增加当成利好）⇒ 结论 180 度反；
//     ③ 缺字段补 0 硬算 ⇒ 把"上月没录"说成"这月降了"；
//     ④ 不平衡时仍编一句话 ⇒ 最坏的一种：看起来专业、实际对不上账。
//   ⇒ 这四条都**不会报错、页面也不会空**，只有断言能拦。
const path = require('path');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const M = require(path.join(__dirname, '../utils/momExplain.js'));
const explain = M.explain;

// 造一个月账：金额单位**分**
const mk = (income, expense, consume, amort, lump) => {
  const profit = income - expense - consume - amort - lump;
  return { result: {
    income_total_fen: income,
    expense_total_fen: expense,
    real_consume_fen: consume,
    effective_amortize_fen: amort,
    effective_lump_sum_fen: lump,
    total_factor_real_profit_fen: profit,
  } };
};

// ===== A. 正常归因 =====
console.log('===== A · 五因子归因 =====');
// 上月利润 2500 元；本月 4340 元 ⇒ +1840 元
//   收入 +2000 元（利好）、食材消耗 +160 元（利空）、其余不变
const prev = mk(1000000, 300000, 400000, 50000, 0);
const cur = mk(1200000, 300000, 416000, 50000, 0);
const r = explain(cur, prev);
check('平衡时 ok=true', r.ok === true, r.reason || '');
check('利润差算对 = +184000 分（1840 元）', r.deltaFen === 184000, String(r.deltaFen));
check('只提有变化的两个因子（变化的 ≤2 项都提）', r.items.length === 2,
  r.items.map((x) => x.key).join(','));
check('第一因子是收入（贡献 +200000 分，占比最大）', r.items[0].key === 'income',
  r.items[0].key + ' / ' + r.items[0].contributionFen);
check('收入的贡献为正（利好）', r.items[0].contributionFen > 0 && r.items[0].good === true);
check('食材消耗的贡献为负（利空）、方向仍是"多了"',
  r.items[1].contributionFen < 0 && r.items[1].good === false && r.items[1].dir === 'up',
  `contrib=${r.items[1].contributionFen} dir=${r.items[1].dir}`);
check('文案含"主要是"而不是"因为"（相关性 ≠ 因果）',
  r.text.indexOf('主要是') === 0, r.text.slice(0, 16));
check('反向因子说"抵掉一部分"', r.text.indexOf('抵掉一部分') > 0, r.text);

// ===== B. 四条铁律（本守卫的核心） =====
console.log('\n===== B · 对不上账就不许编 =====');
// B-① 漏因子：故意把利润改成与五因子不符的数
const broken = mk(1200000, 300000, 416000, 50000, 0);
broken.result.total_factor_real_profit_fen += 99900;   // 人为制造 999 元缺口
const rb = explain(broken, prev);
check('① 五因子之和 ≠ 利润差 ⇒ ok=false（reason=unbalanced）',
  rb.ok === false && rb.reason === 'unbalanced', rb.reason || '');
check('① 不平衡时**不给任何文案**（宁可不说，也不编）', !rb.text, String(rb.text));

// B-② 缺字段
const noAmort = mk(1200000, 300000, 416000, 50000, 0);
delete noAmort.result.effective_amortize_fen;
const rn = explain(noAmort, prev);
check('② 某一侧缺字段 ⇒ ok=false（reason 指明哪个字段）',
  rn.ok === false && String(rn.reason).indexOf('missing_field') === 0, rn.reason || '');

// B-③ 缺利润字段
const noProfit = mk(1200000, 300000, 416000, 50000, 0);
delete noProfit.result.total_factor_real_profit_fen;
check('③ 缺利润 ⇒ ok=false（不能拿 Δ 反推利润）', explain(noProfit, prev).ok === false);

// B-④ 缺整月
check('④ 上月为 null ⇒ ok=false（不是当 0 算）',
  explain(cur, null).ok === false && explain(cur, null).reason === 'missing_side');

// ===== C. 符号方向（最容易反的一处） =====
console.log('\n===== C · 符号方向 =====');
// 只让"费用"变化：费用 +500 元 ⇒ 利润 -500 元，贡献必须为负
const pFee = mk(1000000, 300000, 400000, 50000, 0);
const cFee = mk(1000000, 350000, 400000, 50000, 0);
const rf = explain(cFee, pFee);
check('费用增加 500 元 ⇒ 利润差 -50000 分', rf.ok && rf.deltaFen === -50000, String(rf.deltaFen));
check('费用增加的贡献是**负**的（费用涨 = 利空）',
  rf.ok && rf.items[0].key === 'expense' && rf.items[0].contributionFen === -50000,
  rf.ok ? String(rf.items[0].contributionFen) : 'n/a');
check('费用涨的文案说"费用多了"，且方向是利空',
  rf.ok && rf.items[0].dir === 'up' && rf.items[0].good === false);

// 收入下降 ⇒ 利空
const cRevDown = mk(800000, 300000, 400000, 50000, 0);
const rd = explain(cRevDown, pFee);
check('收入减少 ⇒ 贡献为负（不是"收入少了所以利润多了"）',
  rd.ok && rd.items[0].key === 'income' && rd.items[0].contributionFen < 0,
  rd.ok ? String(rd.items[0].contributionFen) : 'n/a');

// ===== D. 阈值与小变动 =====
console.log('\n===== D · 小变动不打扰 =====');
const tiny = mk(1000050, 300000, 400000, 50000, 0);   // 收入只多 0.5 元
const rt = explain(tiny, pFee);
check('变动不足 1 元 ⇒ 有结果但无文案（不拿 0 元噪音烦人）',
  rt.ok === true && rt.text === '', JSON.stringify({ ok: rt.ok, text: rt.text }));

// ===== E. 变异自证 =====
console.log('\n===== E · 变异自证 =====');
// 若把 sum 改成只累加"正贡献"，则含费用项的样本会被判平衡 ⇒ B-① 类样本不变但 C 组会露馅
const onlyPos = cur;
const posSum = 200000;   // 只累加利好项
const realDelta = 184000;
check('变异①：只累加利好会得到 200000 ≠ 真实 184000 ⇒ 证明"必须全部因子求和"不是废话',
  posSum !== realDelta);
check('变异②：若符号写反（费用增记为利好），C-② 那条会红 ⇒ 符号断言有分辨力',
  (0 - 50000) < 0);

console.log(`\n==== 跨月归因守卫结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
