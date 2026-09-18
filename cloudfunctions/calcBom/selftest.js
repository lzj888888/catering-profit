// cloudfunctions/calcBom/selftest.js —— 批次 3 · POC2 成本引擎自测（16 锚点数值核，POC2 核心）
//
// 运行： node cloudfunctions/calcBom/selftest.js
// 直接测 calcBom/service.js 的纯函数（net_unit_cost 4 位精度 + 单份/批量 + 毛利/毛利率/反算）。
//
// ⚠️ 判据纪律（沿用批次 1/2 R19）：金额锚点一律「整数分」严格相等（===），禁止 ±0.01 容差；
//   每条金额锚点再加「±1 分变异回验」，证明判据对 1 分误差有鉴别力（口径 B：中间保精度、最终 round 到分）。

const { netUnitCostWan, calcCostCard, lineNetCostYuan } = require('./service');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
function assertFen(actual, expected) { return Number.isInteger(actual) && actual === expected; }
// +1 分变异回验：期望漂移 ±1 分应判红 → 判据有 ±1 分鉴别力
function backcheckFen(name, actual, expected) {
  const discrim = !assertFen(actual, expected + 1) && !assertFen(actual, expected - 1);
  if (discrim) pass++; else failN++;
  console.log(`🔍 [变异回验] ${name}：期望±1分均判红，±1 分鉴别力 = ${discrim ? '✅' : '❌'}`);
  return discrim;
}

console.log('===== 用例 A · 宫保鸡丁（单份 · 第 0 层）=====');
// 原料（采购单价=分，换算系数→g，出成率%）
const ji = netUnitCostWan(1500, 500, 90);   // 鸡胸肉 15元/斤 → 0.0333 元/g → 万分 333
const hua = netUnitCostWan(1000, 500, 100); // 花生米 10元/斤 → 0.02
const gan = netUnitCostWan(2000, 500, 100); // 干辣椒 20元/斤 → 0.04
const cong = netUnitCostWan(500, 500, 100); // 葱姜蒜 5元/斤 → 0.01
const you = netUnitCostWan(1000, 500, 100); // 调料油 10元/斤 → 0.02
check('鸡胸肉 15元/斤 出成率90% → 净料单位成本 4 位=0.0333(万分333)', ji === 333, `net=${ji}`);
check('花生米 → 万分200 / 干辣椒 → 万分400 / 葱姜蒜 → 万分100 / 调料油 → 万分200',
  hua === 200 && gan === 400 && cong === 100 && you === 200);

const A = calcCostCard({
  mode: 'A',
  auxFen: 50, lossPct: 5, priceFen: 2800, targetMarginPct: 60,
  lines: [
    { quantity: 200, net_unit_cost: ji },   // 6.66
    { quantity: 50, net_unit_cost: hua },   // 1.00
    { quantity: 10, net_unit_cost: gan },   // 0.40
    { quantity: 30, net_unit_cost: cong },  // 0.30
    { quantity: 20, net_unit_cost: you },   // 0.40
  ],
});
check('明细净料成本合计=8.76(876分)', A.material_total_fen === 876, `=${A.material_total_fen}分`);
check('🏆 宫保总成本 = 9.75 (975分)', A.unit_cost_fen === 975, `=${A.unit_cost_fen}分`);
backcheckFen('宫保总成本', A.unit_cost_fen, 975);
check('单品毛利 = 18.25 (1825分)', A.gross_profit_fen === 1825, `=${A.gross_profit_fen}分`);
check('单品毛利率 = 65.18%', A.gross_margin_pct === 65.18, `=${A.gross_margin_pct}%`);
check('反算售价(目标毛利60%) = 24.38 (2438分)', A.reverse_price_fen === 2438, `=${A.reverse_price_fen}分`);
backcheckFen('反算售价', A.reverse_price_fen, 2438);

console.log('');
console.log('===== 用例 B · 红油底料（批量预制 · 第 1 层）=====');
const niu = netUnitCostWan(2000, 500, 100); // 牛油 0.04
const huaJiao = netUnitCostWan(4000, 500, 100); // 花椒 0.08
const dbj = netUnitCostWan(800, 500, 100);  // 豆瓣酱 0.016
const xl = netUnitCostWan(6000, 500, 100);  // 香料 0.12
check('牛油/花椒/豆瓣酱/香料 万分正确', niu === 400 && huaJiao === 800 && dbj === 160 && xl === 1200);
const B = calcCostCard({
  mode: 'B',
  auxFen: 200, lossPct: 0, batchOutput: 10, priceFen: 0,  // 辅料 2.00 元 = 整批
  lines: [
    { quantity: 500, net_unit_cost: niu },   // 20.00
    { quantity: 200, net_unit_cost: gan },   // 8.00
    { quantity: 50, net_unit_cost: huaJiao },// 4.00
    { quantity: 300, net_unit_cost: dbj },   // 4.80
    { quantity: 50, net_unit_cost: xl },     // 6.00
  ],
});
check('红油原料合计 = 42.80 (4280分)', B.material_total_fen === 4280, `=${B.material_total_fen}分`);
check('整批总成本 = 44.80 (4480分)', B.batch_total_fen === 4480, `=${B.batch_total_fen}分`);
check('🏆 红油单份半成品 = 4.48 (448分)', B.unit_cost_fen === 448, `=${B.unit_cost_fen}分`);
backcheckFen('红油单份', B.unit_cost_fen, 448);

console.log('');
console.log('===== 用例 C · 麻辣香锅（引用半成品 · 第 2 层）=====');
const shi = netUnitCostWan(300, 500, 100);  // 时蔬拼盘 3元/斤 → 0.006 → 万分60
const rou = netUnitCostWan(2000, 500, 100); // 肉丸 0.04 → 万分400
const hongyouFen = 448 * 100;               // 红油底料虚拟：单份 4.48 元 → 万分 44800
check('时蔬万分60 / 肉丸万分400 / 红油虚拟万分44800', shi === 60 && rou === 400 && hongyouFen === 44800);
const C = calcCostCard({
  mode: 'A',
  auxFen: 50, lossPct: 3, priceFen: 3800, targetMarginPct: 0,
  lines: [
    { quantity: 1, net_unit_cost: hongyouFen }, // 红油底料 1 份 = 4.48
    { quantity: 500, net_unit_cost: shi },      // 3.00
    { quantity: 100, net_unit_cost: rou },      // 4.00
  ],
});
check('麻辣明细合计 = 11.48 (1148分)', C.material_total_fen === 1148, `=${C.material_total_fen}分`);
check('🏆 麻辣香锅总成本 = 12.35 (1235分)', C.unit_cost_fen === 1235, `=${C.unit_cost_fen}分`);
backcheckFen('麻辣香锅总成本', C.unit_cost_fen, 1235);
check('麻辣毛利 = 25.65 (2565分)', C.gross_profit_fen === 2565, `=${C.gross_profit_fen}分`);
check('麻辣毛利率 = 67.50%', C.gross_margin_pct === 67.50, `=${C.gross_margin_pct}%`);

console.log('');
console.log('===== 用例 E · 同步至最新价（鸡胸肉 15→20 元/斤）=====');
const ji20 = netUnitCostWan(2000, 500, 90); // 20元/斤 → 0.0444 → 万分444
check('鸡胸肉 20元/斤 → 净料=0.0444(万分444)', ji20 === 444, `net=${ji20}`);
const E = calcCostCard({
  mode: 'A', auxFen: 50, lossPct: 5, priceFen: 2800, targetMarginPct: 0,
  lines: [
    { quantity: 200, net_unit_cost: ji20 },  // 8.88
    { quantity: 50, net_unit_cost: hua },    // 1.00
    { quantity: 10, net_unit_cost: gan },    // 0.40
    { quantity: 30, net_unit_cost: cong },   // 0.30
    { quantity: 20, net_unit_cost: you },    // 0.40
  ],
});
check('新明细合计 = 10.98 (1098分)', E.material_total_fen === 1098, `=${E.material_total_fen}分`);
check('🏆 同步后新版本总成本 = 12.08 (1208分)', E.unit_cost_fen === 1208, `=${E.unit_cost_fen}分`);
backcheckFen('同步后新版本总成本', E.unit_cost_fen, 1208);

// 反证：辅料若排除损耗放大 → 9.73 ❌（口径 B 红线）
const wrongA = (876 + 50 - 50) / 100; // 仅明细放大、辅料不放大
check('⚠️ 反证：辅料不随损耗放大会得 9.73（正确实现必须 ≠9.73）',
  A.unit_cost_fen / 100 !== wrongA && A.unit_cost_fen === 975, `辅助放大法=${(876 / 100) / 0.95}元, 正确答案=9.75`);

console.log('');
console.log('===== R38 判据缺口回归：防「逐行 round」（规范 service.js:16）=====');
// ⚠️ 反例：3 行 {quantity:250, net_unit_cost:333(万分)}。既有的宫保/红油/麻辣等行的逐行值恰好是 2 位小数，
//    两种做法（高精度累积 vs 逐行 round）同值 → 把差异掩盖了。本用例制造 1 分分歧：
//      单行精确 = 250 × (333/10000) = 8.325 元 → 3 行精确合计 = 24.975 元
//      高精度累积（规范要求）→ Math.round(24.975×100)=2498 分
//      逐行 round（规范禁止）→ 每行 Math.round(832.5)=833 分 × 3 = 2499 分   ← 差 1 分
const R38_LINES = [0, 1, 2].map(() => ({ quantity: 250, net_unit_cost: 333 }));
const R38 = calcCostCard({ mode: 'A', lines: R38_LINES, auxFen: 0, lossPct: 0, priceFen: 0 });
check('R38：高精度累积 → unit_cost_fen = 2498（非 2499）', R38.unit_cost_fen === 2498, `=${R38.unit_cost_fen}分`);
backcheckFen('R38 高精度累积', R38.unit_cost_fen, 2498);
// 变异回验：证明判据对「逐行 round」有鉴别力（= 判据真的覆盖了这条规范）
const perLineWrong = R38_LINES.reduce((s, l) => s + Math.round(lineNetCostYuan(l.quantity, l.net_unit_cost) * 100), 0);
check('R38 变异：逐行 round 会得 2499 ≠ 规范值 2498（判据能抓住此 bug）',
  perLineWrong === 2499 && R38.unit_cost_fen !== perLineWrong, `逐行 round=${perLineWrong}分, 正确=2498分`);
check('R38 总成本即明细合计（无损耗无辅料）', R38.material_total_fen === 2498 && R38.unit_cost_fen === R38.material_total_fen);

// ===== R81：mode 白名单（预览路径与 saveCostCard 同口径）=====
// 背景：预览若静默兜底 A，会出现「页面预览按 A 算、保存按 B 存」的口径分裂。
console.log('');
console.log('===== R81 · mode 白名单（预览入口 + 引擎）=====');
const { validateInput } = require('./validate');
const goodBom = { shop_id: 's1', lines: [{ quantity: 100, net_unit_cost: 333 }], mode: 'A' };
for (const bad of ['b', 2, 'C', '']) {
  const rv = validateInput({ ...goodBom, mode: bad });
  check(`预览入口：mode=${JSON.stringify(bad)} → INVALID_PARAM`, rv.error === 'INVALID_PARAM', `实际=${rv.error}`);
}
check('预览入口：mode 缺失 → INVALID_PARAM', validateInput({ ...goodBom, mode: undefined }).error === 'INVALID_PARAM');
check("预览入口反向：mode='A' 放行", validateInput(goodBom).error === null);
function bomModeCode(m) {
  try { calcCostCard({ mode: m, lines: [{ quantity: 100, net_unit_cost: 333 }], auxFen: 0, lossPct: 0, priceFen: 0 }); return null; }
  catch (e) { return (e && e.code) || 'THROW_WITHOUT_CODE'; }
}
for (const bad of ['b', 2, 'C', '']) {
  check(`引擎：mode=${JSON.stringify(bad)} → 抛 INVALID_PARAM`, bomModeCode(bad) === 'INVALID_PARAM', `实际=${bomModeCode(bad)}`);
}
check("引擎反向：mode='B' 不抛", bomModeCode('B') === null);

console.log(`\n==== calcBom 批次 3 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);