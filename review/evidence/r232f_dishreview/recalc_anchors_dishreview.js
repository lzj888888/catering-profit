// review/evidence/r232f_dishreview/recalc_anchors_dishreview.js
// R232f · getDishReview 算法层独立复算锚点（直接 require 生产 service.js，不复制逻辑）
//
// 期望值来源：§2.4 口径**手推**（推导过程写在本文件注释里），**不从被测模块读回来**。
// 依赖注入：normalizeDishName / toMonth 从生产单源取（与 index.js 完全同一份）。
'use strict';
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { buildDishReview } = require(path.join(REPO, 'cloudfunctions/getDishReview/service.js'));
const { normalizeDishName } = require(path.join(REPO, 'cloudfunctions/common/dishKey.js'));
const { toMonth } = require(path.join(REPO, 'cloudfunctions/common/utilTime.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ============ 场景 1：基本口径（推导线）============
// 卡：红烧肉 v1 total_cost=800分 / v2 total_cost=900分（应取 v2）
//     米饭   v1 total_cost=100分
// 销量：红烧肉 3 份 × 2000分 = 6000分
//       米饭   2 份 × 500分  = 1000分
// 推导线：
//   红烧肉 成本 = round(3 × 900) = 2700；毛利 = 6000 − 2700 = 3300；
//     毛利率 = round(3300/6000 × 10000)/100 = 55.00
//   米饭   成本 = round(2 × 100) = 200；毛利 = 1000 − 200 = 800；
//     毛利率 = round(800/1000 × 10000)/100 = 80.00
//   排名：红烧肉(3300) 先于 米饭(800)
//   totals：qty=5 · amountFen=7000 · costFen=2900 · grossFen=4100 · dishCount=2 · unmatchedCount=0
const cards1 = [
  { card_code: 'C001', version: 1, name: '红烧肉', total_cost: 800, created_at: 1789430400000 },
  { card_code: 'C001', version: 2, name: '红烧肉', total_cost: 900, created_at: 1789862400000 },
  { card_code: 'C002', version: 1, name: '米饭',   total_cost: 100, created_at: 1789430400000 },
];
const sales1 = [
  { dish_key: '红烧肉', qty: 3, amount: 6000 },
  { dish_key: '米饭',   qty: 2, amount: 1000 },
];
const r1 = buildDishReview(sales1, cards1, { normalizeDishName, toMonth });
check('S1 最新版本生效（取 v2 成本 900 而非 v1 的 800）',
  r1.dine_in.find((x) => x.dish_key === '红烧肉').totalCostFen === 2700,
  'totalCostFen=' + r1.dine_in.find((x) => x.dish_key === '红烧肉').totalCostFen);
check('S1 毛利 = 营收 − 成本（6000−2700=3300）',
  r1.dine_in.find((x) => x.dish_key === '红烧肉').grossFen === 3300);
check('S1 毛利率 = round(毛利/营收×10000)/100（55）',
  r1.dine_in.find((x) => x.dish_key === '红烧肉').marginPct === 55);
check('S1 排名按毛利降序（红烧肉 3300 > 米饭 800）',
  r1.dine_in[0].dish_key === '红烧肉' && r1.dine_in[1].dish_key === '米饭');
check('S1 totals 六项全对',
  r1.totals.qty === 5 && r1.totals.amountFen === 7000 && r1.totals.costFen === 2900
  && r1.totals.grossFen === 4100 && r1.totals.dishCount === 2 && r1.totals.unmatchedCount === 0,
  JSON.stringify(r1.totals));

// ============ 场景 2：未匹配不归零（红线 17）============
// 「土豆丝」无同名成本卡 ⇒ 必须落 unmatched，**不得**混入 ranked，也**不得**静默丢弃
// totals.qty 须**含**未匹配（合计口径 = 全部销量）
const cards2 = [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1789862400000 }];
const sales2 = [
  { dish_key: '红烧肉', qty: 1, amount: 2000 },
  { dish_key: '土豆丝', qty: 4, amount: 3200 },   // 未匹配
];
const r2 = buildDishReview(sales2, cards2, { normalizeDishName, toMonth });
check('S2 未匹配单列且不混入明细',
  r2.unmatched.length === 1 && r2.unmatched[0].dish_key === '土豆丝' && r2.dine_in.length === 1,
  'unmatched=' + r2.unmatched.length + ' ranked=' + r2.dine_in.length);
check('S2 未匹配**不带** totalCostFen/grossFen（无成本可算）',
  r2.unmatched[0].totalCostFen === undefined && r2.unmatched[0].grossFen === undefined);
check('S2 totals.qty 含未匹配（1+4=5）',
  r2.totals.qty === 5, 'qty=' + r2.totals.qty);
check('S2 totals.costFen/grossFen 只算已匹配（900 / 1100）',
  r2.totals.costFen === 900 && r2.totals.grossFen === 1100,
  'cost=' + r2.totals.costFen + ' gross=' + r2.totals.grossFen);
check('S2 unmatchedCount = 1',
  r2.totals.unmatchedCount === 1);

// ============ 场景 3：同名多行聚合（同 dish_key 累加）============
// 同一天的多次下单应聚合成一行：qty 累加、amount 累加
// 推导线：红烧肉 2+3=5 份 · 1000+1500=2500分；成本 = round(5×900)=4500；毛利 = 2500−4500 = −2000（亏）
const cards3 = [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1789862400000 }];
const sales3 = [
  { dish_key: '红烧肉', qty: 2, amount: 1000 },
  { dish_key: '红烧肉', qty: 3, amount: 1500 },
];
const r3 = buildDishReview(sales3, cards3, { normalizeDishName, toMonth });
check('S3 同 dish_key 聚合为一行', r3.dine_in.length === 1);
check('S3 聚合后 qty=5 / amountFen=2500',
  r3.dine_in[0].qty === 5 && r3.dine_in[0].amountFen === 2500);
check('S3 负毛利可表达（2500−4500=−2000）',
  r3.dine_in[0].grossFen === -2000, 'grossFen=' + r3.dine_in[0].grossFen);
check('S3 负毛利率 = round(−2000/2500×10000)/100 = −80',
  r3.dine_in[0].marginPct === -80, 'marginPct=' + r3.dine_in[0].marginPct);

// ============ 场景 4：边界（营收 0 ⇒ 毛利率记 0，不产生 NaN）============
const cards4 = [{ card_code: 'C001', version: 1, name: '赠品', total_cost: 100, created_at: 1789862400000 }];
const sales4 = [{ dish_key: '赠品', qty: 2, amount: 0 }];
const r4 = buildDishReview(sales4, cards4, { normalizeDishName, toMonth });
check('S4 营收 0 ⇒ marginPct = 0（非 NaN/Infinity）',
  r4.dine_in[0].marginPct === 0 && Number.isFinite(r4.dine_in[0].marginPct),
  'marginPct=' + r4.dine_in[0].marginPct);
check('S4 营收 0 但成本照算（毛利 = −200）', r4.dine_in[0].grossFen === -200);

// ============ 场景 5：空 dish_key 跳过（不计入、不报错）============
const cards5 = [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1789862400000 }];
const sales5 = [
  { dish_key: '', qty: 9, amount: 9000 },
  { dish_key: '   ', qty: 9, amount: 9000 },
  { dish_key: '红烧肉', qty: 1, amount: 2000 },
];
const r5 = buildDishReview(sales5, cards5, { normalizeDishName, toMonth });
check('S5 空/空白 dish_key 被跳过（qty 不含它们）',
  r5.totals.qty === 1, 'qty=' + r5.totals.qty);
check('S5 空 dish_key 不进未匹配', r5.unmatched.length === 0);

// ============ 场景 6：snapshot_month 走 UTC 单源（C-10 回归）============
// created_at = 1790789400000 (= 2026-09-30T17:30:00Z) ⇒ UTC 是 9 月 ⇒ snapshot_month 必须 '2026-09'
// （本地时区 UTC+8 会得到 10-01 ⇒ 本地实现会误判为 '2026-10'）
// 🔴 契约：created_at = Unix 毫秒 BIGINT（utilTime.nowUtc 产出），**不是** ISO 字符串。
const cards6 = [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1790789400000 }];
const sales6 = [{ dish_key: '红烧肉', qty: 1, amount: 2000 }];
const r6 = buildDishReview(sales6, cards6, { normalizeDishName, toMonth });
check('S6 snapshot_month 走 UTC（1790789400000 ⇒ 2026-09）',
  r6.dine_in[0].snapshot_month === '2026-09', 'snapshot_month=' + r6.dine_in[0].snapshot_month);

// ============ 场景 7：反恒真（证明上面判据不是空跑）============
const r7 = buildDishReview([], [], { normalizeDishName, toMonth });
check('S7 空输入 ⇒ 三个字段都在（dine_in/unmatched/totals）',
  Array.isArray(r7.dine_in) && Array.isArray(r7.unmatched) && typeof r7.totals === 'object');
check('S7 空输入 ⇒ totals 六项全 0',
  r7.totals.qty === 0 && r7.totals.amountFen === 0 && r7.totals.costFen === 0
  && r7.totals.grossFen === 0 && r7.totals.dishCount === 0 && r7.totals.unmatchedCount === 0);
check('S7 反证：S1 若取 v1 成本(800) 则 totalCostFen 会是 2400 ≠ 2700（证明版本判据有鉴别力）',
  Math.round(3 * 800) === 2400 && r1.dine_in.find((x) => x.dish_key === '红烧肉').totalCostFen !== 2400);

console.log('\n===== 独立复算：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
