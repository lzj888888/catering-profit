// cloudfunctions/calcMonthlyProfit/selftest.js —— 批次 1 自测：12 条验收锚点。
//
// 运行： node cloudfunctions/calcMonthlyProfit/selftest.js
// 直接测 Service 纯函数（不触云/DB），金额一律「分」整数。误差 ≤ 0.01 元锚点全对即过。
//
// 场景数据（元）→ 转 分：
//   S1 (2026-07, 库存关 / 摊销关): 收入 64,000；直接填消耗 22,000；费用 32,840
//   S2 (2026-08, 库存开 / 摊销开): 收入/费用同 S1，库存 期初5000/采购25000/期末7000(→真实消耗23000)
//      老板直接填总消耗仍 22,000；摊销 4,683.33
//   2-R: S2 基础上 期初 5000→3000（期初结转）→真实消耗 21,000

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

// ===== 12 条锚点（预期：元；允许误差 ≤ 0.01 元）=====
const CASES = [
  { id: 1,  scene: 'S1',  metric: '收入合计',        get: (r) => r.incomeTotalYuan,          exp: 64000,    tol: 0.01 },
  { id: 2,  scene: 'S1',  metric: '费用合计',        get: (r) => r.expenseTotalYuan,         exp: 32840,    tol: 0.01 },
  { id: 3,  scene: 'S1',  metric: '菜品毛利',        get: (r) => r.grossProfitYuan,          exp: 42000,    tol: 0.01 },
  { id: 4,  scene: 'S1',  metric: '菜品毛利率(%)',   get: (r) => r.grossMarginRatePctDisplay, exp: 65.63,   tol: 0.01 }, // 65.625 → 65.63 同口径
  { id: 5,  scene: 'S1',  metric: '🟢经营参考利润',  get: (r) => r.operationRefProfitYuan,    exp: 9160,     tol: 0.01 },
  { id: 6,  scene: 'S1',  metric: '🔵全要素真实利润',get: (r) => r.totalFactorRealProfitYuan, exp: 9160,     tol: 0.01 },
  { id: 7,  scene: 'S2',  metric: '本期真实消耗',    get: (r) => r.realConsumeFen / 100,      exp: 23000,    tol: 0.01 },
  { id: 8,  scene: 'S2',  metric: '🟢经营参考利润',  get: (r) => r.operationRefProfitYuan,    exp: 9160,     tol: 0.01 }, // 用 22,000 非 23,000（口径锁）
  { id: 9,  scene: 'S2',  metric: '🔵全要素真实利润',get: (r) => r.totalFactorRealProfitYuan, exp: 3476.67,  tol: 0.01 },
  { id: 10, scene: 'S2',  metric: '两利润差异',      get: (r) => r.profitDiffYuan,           exp: 5683.33,  tol: 0.01 },
  { id: 11, scene: '2-R', metric: '本期真实消耗',    get: (r) => r.realConsumeFen / 100,      exp: 21000,    tol: 0.01 },
  { id: 12, scene: '2-R', metric: '🔵全要素真实利润',get: (r) => r.totalFactorRealProfitYuan, exp: 5476.67,  tol: 0.01 },
];

function run() {
  const map = { S1: S1(), S2: S2(), '2-R': S2R() };
  let allPass = true;
  // 表头
  console.log('| # | 场景 | 指标 | 预期(元) | 实际(元) | 是否通过 |');
  console.log('|---|---|---|---|---|---|');
  for (const c of CASES) {
    const r = map[c.scene];
    let actual;
    try { actual = c.get(r); } catch (e) { actual = 'ERR'; }
    const numAct = Number(actual); // Service 的 *Yuan 为字符串展示值 → 统一转数值比较
    const pass = typeof c.exp === 'number' && Number.isFinite(numAct) && Math.abs(numAct - c.exp) <= c.tol;
    if (!pass) allPass = false;
    console.log(`| ${c.id} | ${c.scene} | ${c.metric} | ${c.exp} | ${Math.round(numAct * 100) / 100} | ${pass ? '✅ 通过' : '❌ 失败'} |`);
  }
  console.log('');
  // 口径锁专项：S2 经营参考必须 9,160（若 8,160 = 用了倒轧 23,000，违锁）
  const s2 = map['S2'];
  const lockOk = Number(s2.operationRefProfitYuan) === 9160;
  if (!lockOk) { allPass = false; }
  console.log(`口径锁专项：S2 经营参考利润 = ${s2.operationRefProfitYuan}（应 = 9,160；若为 8,160 说明误用倒轧 23,000）= ${lockOk ? '✅ 锁成立' : '❌ 破锁'}`);
  console.log(`差异自洽校验（经营−全要素=差异）：S1=${map['S1'].diffCheck} S2=${map['S2'].diffCheck} 2-R=${map['2-R'].diffCheck}`);

  // 附加：收入/费用明细汇总展示
  console.log('');
  console.log(`S1 系统汇总收入=${map['S1'].incomeTotalYuan}元 、费用=${map['S1'].expenseTotalYuan}元（均 Service 逐项累加，非前端传合计）`);
  console.log(`S2 真实消耗=${map['S2'].realConsumeFen / 100}元 、直接填消耗=${map['S2'].directConsumeFen / 100}元`);
  console.log(`S2 毛利率展示=${map['S2'].grossMarginRatePctDisplay}% （全精度 ${map['S2'].grossMarginRatePct}%）`);

  console.log('\n' + (allPass ? '✅ 12/12 验收锚点全数通过' : '❌ 存在未通过的锚点'));
  process.exit(allPass ? 0 : 1);
}

run();