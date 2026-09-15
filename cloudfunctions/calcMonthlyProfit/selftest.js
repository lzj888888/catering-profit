// cloudfunctions/calcMonthlyProfit/selftest.js —— 批次 1 自测：12 条验收锚点 + 2 项自洽断言。
//
// 运行： node cloudfunctions/calcMonthlyProfit/selftest.js
// 直接测 Service 纯函数（不触云/DB）。
//
// ⚠️ 判据纪律（R19 修严；沿用 N11 / core_02:5 既有口径，勿回退）：
//   · 金额类锚点 → 一律「整数分」严格相等（===），**禁止容差**。
//     理由（实测）：±0.01 元容差会把「差不差分」变成「浮点恰好落在容差哪一边」——
//     同一份「引擎末步 +1 分」的注入，#6/#12 被拦下，而 #9（S2 全要素 3476.67）
//     因 |3476.68-3476.67| = 0.0099999999997635 ≤ 0.01 被**放行**。
//     这与本项目已修过三次的「容差掩膜」同病（N9 引擎裸值被掩 / N11 test_poc2 ±0.01 / N17 掩盖 12.09），
//     会让「落库整数分、不接受测试侧取整」（★知识存储点 §1.1 节点②）**假通过**。
//   · 比率类（毛利率）→ 保留 ±0.01：它是比率不是金额，core_02:5 原口径即如此。
//   · diffCheck 自洽校验必须是**断言**（原为 console.log，三个 false 也不影响 exit code）。
//
// 场景数据（元）→ 分：
//   S1  (2026-07, 库存关 / 摊销关): 收入 64,000；直接填消耗 22,000；费用 32,840
//   S2  (2026-08, 库存开 / 摊销开): 收入/费用同 S1，库存 期初5000/采购25000/期末7000(→真实消耗23000)
//       老板直接填总消耗仍 22,000；摊销 4,683.33
//   2-R: S2 基础上 期初 5000→3000（期初结转）→ 真实消耗 21,000

const { calcMonthlyProfit } = require('./service');

const YUAN = 100; // 元→分

// 明细辅助：把若干元金额转成分数组
const itemsYuan = (arr) => arr.map((y) => ({ amountFen: Math.round(y * YUAN) }));

// ===== 场景构造 =====
const INCOME_ITEMS = itemsYuan([8000, 25000, 5000, 3000, 2000, 18000, 500, 1500, 1000]); // 堂食5 + 外卖3 + 其他1 = 64,000
const EXPENSE_ITEMS = itemsYuan([8000, 500, 200, 800, 600, 100, 100, 12000, 1500, 800, 500, 200, 3600, 1200, 1500, 300, 400, 240, 300]); // 运营+人工+营销+其他 = 32,840
// —— 注意上方费用逐项金额（元）：
//   运营10300=房租8000+物业500+水200+电800+燃气600+垃圾100+宽带100
//   人工15000=工资12000+社保1500+宿舍800+员工餐500+工装200
//   营销7240=佣金3600+配送1200+活动1500+配送补贴300+推广400+团购佣金240
//   其他300
const DIRECT_CONSUME_FEN = 22000 * YUAN;
const AMORTIZE_FEN = Math.round(4683.33 * YUAN); // 468333 分

function S1() {
  return calcMonthlyProfit({
    incomeItems: INCOME_ITEMS,
    expenseItems: EXPENSE_ITEMS,
    directConsumeFen: DIRECT_CONSUME_FEN,
    amortizeFen: AMORTIZE_FEN,
    amortizeSwitchOn: false,
    inventorySwitchOn: false,
    inventory: {},
  });
}

function S2() {
  return calcMonthlyProfit({
    incomeItems: INCOME_ITEMS,
    expenseItems: EXPENSE_ITEMS,
    directConsumeFen: DIRECT_CONSUME_FEN,
    amortizeFen: AMORTIZE_FEN,
    amortizeSwitchOn: true,
    inventorySwitchOn: true,
    inventory: { openingFen: 5000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN },
  });
}

function S2R() {
  return calcMonthlyProfit({
    incomeItems: INCOME_ITEMS,
    expenseItems: EXPENSE_ITEMS,
    directConsumeFen: DIRECT_CONSUME_FEN,
    amortizeFen: AMORTIZE_FEN,
    amortizeSwitchOn: true,
    inventorySwitchOn: true,
    inventory: { openingFen: 3000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN }, // 期初结转 3,000
  });
}

// ===== 12 条锚点 =====
// kind = 'fen'  → 金额：预期值是「整数分」，判据严格 ===（无容差）
// kind = 'rate' → 比率：保留 ±0.01
const CASES = [
  { id: 1,  scene: 'S1',  metric: '收入合计',          kind: 'fen',  get: (r) => r.incomeTotalFen,             exp: 6400000 },
  { id: 2,  scene: 'S1',  metric: '费用合计',          kind: 'fen',  get: (r) => r.expenseTotalFen,            exp: 3284000 },
  { id: 3,  scene: 'S1',  metric: '菜品毛利',          kind: 'fen',  get: (r) => r.grossProfitFen,             exp: 4200000 },
  { id: 4,  scene: 'S1',  metric: '菜品毛利率(%)',     kind: 'rate', get: (r) => r.grossMarginRatePctDisplay,  exp: 65.63,   tol: 0.01 }, // 65.625 → 65.63 同口径
  { id: 5,  scene: 'S1',  metric: '🟢经营参考利润',    kind: 'fen',  get: (r) => r.operationRefProfitFen,      exp: 916000 },
  { id: 6,  scene: 'S1',  metric: '🔵全要素真实利润',  kind: 'fen',  get: (r) => r.totalFactorRealProfitFen,   exp: 916000 },
  { id: 7,  scene: 'S2',  metric: '本期真实消耗',      kind: 'fen',  get: (r) => r.realConsumeFen,             exp: 2300000 },
  { id: 8,  scene: 'S2',  metric: '🟢经营参考利润',    kind: 'fen',  get: (r) => r.operationRefProfitFen,      exp: 916000 }, // 用 22,000 非 23,000（口径锁）
  { id: 9,  scene: 'S2',  metric: '🔵全要素真实利润',  kind: 'fen',  get: (r) => r.totalFactorRealProfitFen,   exp: 347667 },
  { id: 10, scene: 'S2',  metric: '两利润差异',        kind: 'fen',  get: (r) => r.profitDiffFen,              exp: 568333 },
  { id: 11, scene: '2-R', metric: '本期真实消耗',      kind: 'fen',  get: (r) => r.realConsumeFen,             exp: 2100000 },
  { id: 12, scene: '2-R', metric: '🔵全要素真实利润',  kind: 'fen',  get: (r) => r.totalFactorRealProfitFen,   exp: 547667 },
];

// 展示：金额类按「元」显示（仅用于阅读，不参与判据）
const disp = (v, kind) => (kind === 'fen' ? String(v / 100) : String(v));

function run() {
  const map = { S1: S1(), S2: S2(), '2-R': S2R() };
  let allPass = true;
  let failedCount = 0;

  console.log('判据：金额锚点 = 整数分严格相等（无容差）；比率锚点 = ±0.01');
  console.log('');
  console.log('| # | 场景 | 指标 | 预期 | 实际 | 是否通过 |');
  console.log('|---|---|---|---|---|---|');
  for (const c of CASES) {
    const r = map[c.scene];
    let actual;
    try { actual = c.get(r); } catch (e) { actual = 'ERR'; }
    const numAct = Number(actual);
    let pass;
    if (c.kind === 'fen') {
      // 整数分严格断言：必须既「是整数」又「严格相等」（差 1 分即红）
      pass = Number.isInteger(numAct) && numAct === c.exp;
    } else {
      pass = Number.isFinite(numAct) && Math.abs(numAct - c.exp) <= c.tol;
    }
    if (!pass) { allPass = false; failedCount++; }
    console.log(`| ${c.id} | ${c.scene} | ${c.metric} | ${disp(c.exp, c.kind)}${c.kind === 'fen' ? '元(分:' + c.exp + ')' : '%'} | ${disp(numAct, c.kind)} | ${pass ? '✅ 通过' : '❌ 失败'} |`);
  }

  console.log('');

  // ===== 专项断言 1：口径锁（S2 经营参考必须 916000 分 = 9,160 元；若为 816000 说明误用倒轧 23,000）=====
  const s2 = map['S2'];
  const lockOk = s2.operationRefProfitFen === 916000;
  if (!lockOk) { allPass = false; failedCount++; }
  console.log(`[断言A] 口径锁：S2 经营参考利润 = ${s2.operationRefProfitFen} 分（应 = 916000；若为 816000 说明误用倒轧 23,000）= ${lockOk ? '✅ 锁成立' : '❌ 破锁'}`);

  // ===== 专项断言 2：两口径自洽（经营参考 − 全要素真实 === 差异），三个场景都必须成立 =====
  const diffBad = [];
  for (const s of ['S1', 'S2', '2-R']) {
    const r = map[s];
    const ok = r.diffCheck === true &&
      r.operationRefProfitFen - r.totalFactorRealProfitFen === r.profitDiffFen;
    if (!ok) diffBad.push(s);
  }
  if (diffBad.length) { allPass = false; failedCount++; }
  console.log(`[断言B] 差异自洽（经营参考 − 全要素真实 === 差异）：${diffBad.length === 0
    ? '✅ S1/S2/2-R 三场景均成立' : '❌ 不一致场景=' + diffBad.join(',')}`);

  // 附加：收入/费用明细汇总展示
  console.log('');
  console.log(`S1 系统汇总收入=${map['S1'].incomeTotalYuan}元 、费用=${map['S1'].expenseTotalYuan}元（均 Service 逐项累加，非前端传合计）`);
  console.log(`S2 真实消耗=${map['S2'].realConsumeFen / 100}元 、直接填消耗=${map['S2'].directConsumeFen / 100}元`);
  console.log(`S2 毛利率展示=${map['S2'].grossMarginRatePctDisplay}% （全精度 ${map['S2'].grossMarginRatePct}%）`);

  console.log('\n' + (allPass
    ? '✅ 12/12 锚点 + 2 项自洽断言全数通过（判据：金额=整数分严格相等）'
    : `❌ 存在未通过项：${failedCount} 处`));
  process.exit(allPass ? 0 : 1);
}

run();
