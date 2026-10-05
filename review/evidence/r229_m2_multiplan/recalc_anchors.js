#!/usr/bin/env node
// review/evidence/r229_m2_multiplan/recalc_anchors.js
//
// M2「多方案存储」增量规范 v1.2 —— 锚点**独立复算**。
// 🔴 铁律：锚点必须 `require` **生产引擎**实跑，绝不手写一份等价公式（重写 = 第二个真相源）。
//
// 复算什么 / 为什么：
//   ① 旧锚点回归（正算）—— M2.10 标准工况逐项复现 ⇒ 证明「本期只加存储层、引擎一行未改」。
//   ② 新锚点 A（正算往返）—— `param_json`(snake) → `clean` → `calcSandbox` ⇒ 与首次出参**逐字段相同**。
//      新锚点 B（反推往返）—— 同上，走 `calcSandboxReverse`。
//      ⇒ 证明设计基石成立：**全量 `param_json` 入库 ⇒ 无损重算**（快照只是缓存，重算才是权威）。
//   ③ 反例 1（命名口径）—— `param_json` 写成 camelCase（违反 core/10 §8「出入参一律 snake_case」）
//                          ⇒ 服务端按 snake 取名取不到 ⇒ 走默认值 ⇒ 重算结果 ≠ 首次。
//      反例 2（缺字段）  —— 反推 `param_json` 漏 `seats` / `pixel_eff_fen` ⇒ 翻台 / 面积上限不可得。
//      ⇒ 证明「命名口径」与「全量字段」两条规则**有鉴别力**（不是恒真断言）。
//   ④ 边界 —— 红警时反推不编造数字（全 null）。
//
// 运行：node review/evidence/r229_m2_multiplan/recalc_anchors.js
// 输出：stdout + review/evidence/r229_m2_multiplan/recalc_anchors.txt

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');                 // → 仓根
const SVC = path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js');
if (!fs.existsSync(SVC)) { console.error('❌ 找不到生产引擎：' + SVC); process.exit(2); }
const E = require(SVC);                                                 // 🔴 生产引擎（非副本）
const { calcSandbox, calcSandboxReverse } = E;
if (typeof calcSandbox !== 'function' || typeof calcSandboxReverse !== 'function') {
  console.error('❌ 生产引擎未导出 calcSandbox / calcSandboxReverse'); process.exit(2);
}

let pass = 0;
const fails = [];
const lines = [];
function say(s) { lines.push(s); console.log(s); }
function sec(t) { say('\n===== ' + t + ' ====='); }
function CHK(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; say(`  ✅ ${name}  = ${JSON.stringify(got)}`); }
  else { fails.push(name); say(`  ❌ ${name}  实得 ${JSON.stringify(got)} · 期望 ${JSON.stringify(want)}`); }
}
const YUAN = 100;
const y2f = (y) => Math.round(y * YUAN);

// ---------- 本次增量的**核心实现**：param_json(snake) → 引擎入参 clean ----------
// 🔴 这张映射表 = 规范 §4.3 的落地形态。**字段一个不能少**（反例 2 证明漏一个就不可重算）。
// ⚠️ `clean` 的形状以 `cloudfunctions/calcSandbox/validate.js:181-191` 为准（既有实现客观如此：
//     `cityTier`/`bizType`/`buildItems`… 为 camel，`rev_price_fen`/`open_days`… 为 snake）。
const PARAM_TO_CLEAN = [
  ['mode', 'mode'], ['city_tier', 'cityTier'], ['biz_type', 'bizType'],
  ['build_items', 'buildItems'], ['fixed_items', 'fixedItems'], ['var_items', 'varItems'],
  ['gross_margin_pct', 'grossMarginPct'], ['target_profit_fen', 'targetProfitFen'],
  ['expected_revenue_fen', 'expectedRevenueFen'], ['rev_price_fen', 'rev_price_fen'],
  ['seats', 'seats'], ['open_days', 'open_days'],
  ['target_rent_rate', 'target_rent_rate'], ['pixel_eff_fen', 'pixel_eff_fen'],
];
function paramToClean(p, drop) {
  const c = {};
  for (const [snake, clean] of PARAM_TO_CLEAN) {
    if (drop && drop.indexOf(snake) >= 0) continue;                     // 反例 2：模拟缺字段
    c[clean] = p[snake];
  }
  return c;
}
// camelCase 写法的 param_json（反例 1：违反命名口径）
function toCamelParam(p) {
  const camel = {};
  for (const [snake] of PARAM_TO_CLEAN) {
    camel[snake.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())] = p[snake];
  }
  return camel;
}

// ============================================================================
// ① 旧锚点回归：M2.10 标准工况（正算）—— 证明既有口径未漂
// ============================================================================
sec('① 旧锚点回归 · M2.10 标准工况（正餐 · 二三线）');
const CLEAN_FWD = {
  mode: 'forward', cityTier: 'tier23', bizType: 'dining',
  buildItems: [
    { key: 'decor', fen: y2f(360000), years: 3 },
    { key: 'franchise', fen: y2f(180000), years: 3 },
    { key: 'equip', fen: y2f(120000), years: 5 },
  ],
  fixedItems: [
    { key: 'rent', fen: y2f(12000) }, { key: 'labor', fen: y2f(7000) }, { key: 'manage', fen: y2f(2000) },
  ],
  varItems: [{ key: 'takeawayComm', pct: 15 }],
  grossMarginPct: 65, targetProfitFen: y2f(15000), expectedRevenueFen: 0,
};
const A1 = calcSandbox(CLEAN_FWD);
CHK('建店总投入（分）', A1.build_total_fen, y2f(660000));
CHK('月摊销（分）', A1.build_amort_monthly_fen, y2f(17000));
CHK('不含摊销的固定合计（分）', A1.fixed_ex_amort_fen, y2f(21000));
CHK('含摊销固定合计（分）', A1.fixed_total_fen, y2f(38000));
CHK('综合变动成本率（%）', A1.composite_var_rate_pct, 50);
CHK('保本月营收（分）', A1.break_even_monthly_fen, y2f(76000));
CHK('目标月营收（分）', A1.target_monthly_fen, y2f(106000));
CHK('收回投入（月）', A1.payback_months, 44);
CHK('无红警', A1.red_alert, false);

// ============================================================================
// ②-A 新锚点 · 正算往返：param_json(snake) → clean → calcSandbox ≡ 首次出参
// ============================================================================
sec('②-A 新锚点 · 正算 param_json 往返（全量字段 ⇒ 无损重算）');
const P_FWD = {
  mode: 'forward', city_tier: 'tier23', biz_type: 'dining',
  build_items: CLEAN_FWD.buildItems, fixed_items: CLEAN_FWD.fixedItems, var_items: CLEAN_FWD.varItems,
  gross_margin_pct: 65, target_profit_fen: y2f(15000), expected_revenue_fen: 0,
  rev_price_fen: 0, seats: 0, open_days: 30, target_rent_rate: 0, pixel_eff_fen: 0,
};
const A2 = calcSandbox(paramToClean(P_FWD));
CHK('往返后出参 === 首次出参（逐字段 JSON 全等）', A2, A1);

// ============================================================================
// ②-B 新锚点 · 反推往返：同上，走 calcSandboxReverse
// ============================================================================
sec('②-B 新锚点 · 反推 param_json 往返（目标月利润 20000 / 客单 45 / 毛利率 60 / 座位 20 / 30 天 / 租金率 12%）');
const CLEAN_REV = {
  mode: 'reverse', cityTier: 'tier23', bizType: 'dining',
  buildItems: [],
  fixedItems: [{ key: 'labor', fen: y2f(28000) }],                     // 🔴 反推口径：fixed_items 不含 rent
  varItems: [],
  grossMarginPct: 60, targetProfitFen: y2f(20000), expectedRevenueFen: 0,
  rev_price_fen: y2f(45), seats: 20, open_days: 30, target_rent_rate: 12, pixel_eff_fen: y2f(40),
};
const P_REV = {
  mode: 'reverse', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], fixed_items: CLEAN_REV.fixedItems, var_items: [],
  gross_margin_pct: 60, target_profit_fen: y2f(20000), expected_revenue_fen: 0,
  rev_price_fen: y2f(45), seats: 20, open_days: 30, target_rent_rate: 12, pixel_eff_fen: y2f(40),
};
const R1 = calcSandboxReverse(CLEAN_REV);                               // 首次（保存时）
const R2 = calcSandboxReverse(paramToClean(P_REV));                     // 往返（从库里读回后重算）
CHK('反推往返后 reverse 块 === 首次（逐字段 JSON 全等）', R2, R1);
// 绝对值锚点（防"两边一起错"）
CHK('目标月营收 R（分）= 100000 元', R1.target_monthly_fen, y2f(100000));
CHK('房租上限（分）= 12000 元', R1.rent_cap_fen, y2f(12000));
CHK('日均客流 = 74.07', R1.daily_traffic, 74.07);
CHK('翻台 = 3.70', R1.turn_rate, 3.7);
CHK('面积上限 = 300 ㎡', R1.area_cap_sqm, 300);

// ============================================================================
// ③ 反例对照（同一组数据跑两条路径）—— 证明两条规则有鉴别力
// ============================================================================
sec('③-1 反例 · param_json 写成 camelCase（违反 core/10 §8 命名口径）');
// 🔴 反例路径不复用正确映射：模拟"写入侧用了 camelCase、读取侧仍按 snake 取"的错配
const P_FWD_CAMEL = toCamelParam(P_FWD);
const A3 = calcSandbox(paramToClean(P_FWD_CAMEL));
say(`  正确 snake 写法 ⇒ 目标月营收 ${A2.target_monthly_fen} 分 · 综合变动率 ${A2.composite_var_rate_pct}%`);
say(`  错误 camel 写法 ⇒ 目标月营收 ${A3.target_monthly_fen} 分 · 综合变动率 ${A3.composite_var_rate_pct}%`);
CHK('两种写法结果**不同**（证明命名口径有鉴别力，不是恒真）', A2.target_monthly_fen !== A3.target_monthly_fen, true);
CHK('camel 写法下 gross_margin_pct 取不到 ⇒ 走默认 0 ⇒ 保本额异常',
  A3.composite_var_rate_pct !== A2.composite_var_rate_pct, true);

sec('③-2 反例 · 反推 param_json 漏 seats（翻台不可算）');
// 🔴 反例路径直接调**生产引擎**：漏字段 ⇒ clean.seats 为 undefined ⇒ num0 → 0
const R3 = calcSandboxReverse(paramToClean(P_REV, ['seats']));
say(`  全量字段 ⇒ 翻台 ${R1.turn_rate} · 面积上限 ${R1.area_cap_sqm}`);
say(`  漏 seats ⇒ 翻台 ${JSON.stringify(R3.turn_rate)} · 面积上限 ${JSON.stringify(R3.area_cap_sqm)}`);
CHK('漏 seats 后翻台与首次**不同**（证明「必须存全量」有鉴别力）',
  JSON.stringify(R3.turn_rate) !== JSON.stringify(R1.turn_rate), true);
CHK('漏 seats ⇒ 翻台非有限值（不编造，佐证字段必需）', Number.isFinite(R3.turn_rate), false);
const R4 = calcSandboxReverse(paramToClean(P_REV, ['pixel_eff_fen']));
CHK('漏 pixel_eff_fen ⇒ 面积上限为 null（不编造）', R4.area_cap_sqm, null);

// ============================================================================
// ④ 边界：红警 ⇒ 反推不编造
// ============================================================================
sec('④ 边界 · 红警时反推全 null（不编造数字）');
const CLEAN_RED = Object.assign({}, CLEAN_REV, { grossMarginPct: 30, target_rent_rate: 60 }); // 40%+60% = 100%
const R5 = calcSandboxReverse(CLEAN_RED);
CHK('红警触发', R5.red_alert, true);
CHK('R = null', R5.target_monthly_fen, null);
CHK('派生量全 null', [R5.rent_cap_fen, R5.monthly_traffic, R5.turn_rate, R5.area_cap_sqm], [null, null, null, null]);

// ============================================================================
const tail = `\n===== M2 多方案锚点复算：${pass} 通过 / ${fails.length} 失败 =====`
  + (fails.length ? `\n失败清单：${fails.join(' · ')}` : '');
say(tail);
fs.writeFileSync(path.join(__dirname, 'recalc_anchors.txt'), lines.join('\n') + '\n', 'utf8');
process.exit(fails.length === 0 ? 0 : 1);
