#!/usr/bin/env node
// review/evidence/r219_m2_reverse/recalc_anchors.js
//
// M2「选址反推」增量规范 —— 锚点**独立复算**（铁律：锚点必须 require 生产引擎实跑，不手写等价公式）。
//
// 复算什么：
//   ① 旧锚点回归  —— M2.10 标准工况（正算）逐项复现，证明「本轮讨论的入参变换」没有改动既有口径
//                    （既有引擎 calcSandbox 一行未改，本脚本只做 require + 调用）。
//   ② 新锚点      —— 豆包 round218 算例（目标月利润 20000 / 客单 45 / 毛利率 60% / 座位 20 /
//                    月营业 30 天 / 目标租金率 12% / 月固定(不含房租) 28000）在**我方口径**下复现。
//       🔴 口径 = 「反推模式下 fixed_items 不含 rent，房租由 target_rent_rate 导出」
//          ⇒ 这是**一次纯入参变换**：把 target_rent_rate 当作一项「随营业额挂钩的费率」喂进 var_items，
//             再用**既有** calcSandbox 取 target_monthly_fen（= R）。
//          ⇒ 引擎零改动，恒等性由构造成立（正算路径逐字节未变）。
//   ③ 反例对照    —— 同组数据「不剔除 rent 且仍叠加租金率」⇒ **重复计租**，量化差额（证明规则不是摆设）。
//      反例段显式声明 TARGET 配置，**同一组数据跑两条路径**做对照（不拿现状值当反例）。
//
// 运行：node review/evidence/r219_m2_reverse/recalc_anchors.js
// 输出：stdout + review/evidence/r219_m2_reverse/recalc_anchors.txt

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');            // → 仓根
const SVC = path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js');

if (!fs.existsSync(SVC)) {
  console.error('❌ 找不到生产引擎：' + SVC);
  process.exit(2);
}
// 🔴 用**生产引擎**（不是副本、不是手写公式）
const E = require(SVC);
const { calcSandbox } = E;
if (typeof calcSandbox !== 'function') {
  console.error('❌ 生产引擎未导出 calcSandbox');
  process.exit(2);
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
const YUAN = 100;                                                  // 1 元 = 100 分
const yuan2fen = (y) => Math.round(y * YUAN);
// 保留小数带十进制容差（同仓内 round1 的浮点纪律；多一位用于反推派生量）
const r1 = (n) => Math.round(n * 10 + 1e-9) / 10;
const r2 = (n) => Math.round(n * 100 + 1e-9) / 100;

// ---------- 入参变换：反推口径 → 正算引擎可吃的形状 ----------
// 规则（v1.1 定案）：
//   fixedItems 剔除 key==='rent'（房租不重复计入固定成本）
//   varItems  追加 { key:'rentRate', pct: targetRentRate }（房租随营收挂钩）
//   其余入参原样透传
function toForwardInput(reverse) {
  const fixedItems = (reverse.fixedItems || []).filter((x) => x.key !== 'rent');
  const varItems = (reverse.varItems || []).concat(
    reverse.targetRentRate > 0 ? [{ key: 'rentRate', pct: reverse.targetRentRate }] : []
  );
  return {
    cityTier: reverse.cityTier,
    bizType: reverse.bizType,
    buildItems: reverse.buildItems || [],
    fixedItems,
    varItems,
    grossMarginPct: reverse.grossMarginPct,
    targetProfitFen: reverse.targetProfitFen,
    expectedRevenueFen: 0,
  };
}

// ---------- 反推派生量（在引擎给出的 R 上做，不再触碰任何成本口径） ----------
function deriveReverse(fwd, reverse) {
  const R = fwd.target_monthly_fen;                                 // 分；红警时 null
  const rate = reverse.targetRentRate;
  const price = reverse.revPriceFen;
  const seats = reverse.seats;
  const days = reverse.openDays;
  const pixEff = reverse.pixelEffFen || 0;
  if (R === null) {
    return {
      target_monthly_fen: null, target_daily_fen: null, rent_cap_fen: null,
      monthly_traffic: null, daily_traffic: null, turn_rate: null, area_cap_sqm: null,
      red_alert: fwd.red_alert,
    };
  }
  const monthlyTrafficRaw = R / price;                              // 中间高精度
  const dailyTrafficRaw = monthlyTrafficRaw / days;
  const turnRaw = monthlyTrafficRaw / (seats * days);
  const rentCapFen = Math.round(R * rate / 100);
  return {
    target_monthly_fen: R,
    target_daily_fen: Math.round(R / days),
    rent_cap_fen: rentCapFen,
    monthly_traffic: r2(monthlyTrafficRaw),
    daily_traffic: r2(dailyTrafficRaw),
    turn_rate: r2(turnRaw),
    area_cap_sqm: pixEff > 0 ? r1(rentCapFen / pixEff) : null,
    red_alert: fwd.red_alert,
  };
}

// ============================================================================
// ① 旧锚点回归：M2.10 标准工况（正算）—— 证明既有口径未漂
// ============================================================================
sec('① 旧锚点回归 · M2.10 标准工况（正餐 · 二三线）');
const A1 = calcSandbox({
  cityTier: 'tier23', bizType: 'dining',
  buildItems: [
    { key: 'decor', fen: yuan2fen(360000), years: 3 },
    { key: 'franchise', fen: yuan2fen(180000), years: 3 },
    { key: 'equip', fen: yuan2fen(120000), years: 5 },
  ],
  fixedItems: [
    { key: 'rent', fen: yuan2fen(12000) },
    { key: 'labor', fen: yuan2fen(7000) },
    { key: 'manage', fen: yuan2fen(2000) },
  ],
  varItems: [{ key: 'takeawayComm', pct: 15 }],
  grossMarginPct: 65,
  targetProfitFen: yuan2fen(15000),
  expectedRevenueFen: 0,
});
CHK('建店总投入（分）', A1.build_total_fen, yuan2fen(660000));
CHK('月摊销（分）', A1.build_amort_monthly_fen, yuan2fen(17000));
CHK('不含摊销的固定合计（分）', A1.fixed_ex_amort_fen, yuan2fen(21000));
CHK('含摊销固定合计（分）', A1.fixed_total_fen, yuan2fen(38000));
CHK('综合变动成本率（%）', A1.composite_var_rate_pct, 50);
CHK('保本月营收（分）', A1.break_even_monthly_fen, yuan2fen(76000));
CHK('保本日均（分）', A1.break_even_daily_fen, Math.round(yuan2fen(76000) / 30));
CHK('目标月营收（分）', A1.target_monthly_fen, yuan2fen(106000));
CHK('收回投入（月）', A1.payback_months, 44);
CHK('无红警', A1.red_alert, false);

// ============================================================================
// ② 新锚点：豆包 round218 算例（口径 Y，一次入参变换 + 既有引擎）
// ============================================================================
sec('② 新锚点 · 豆包算例（目标月利润 20000 / 客单 45 / 毛利率 60% / 座位 20 / 30 天 / 租金率 12%）');
const REV = {
  cityTier: 'tier23', bizType: 'dining',
  buildItems: [],
  // 🔴 反推口径：fixed_items **不含 rent**（房租由 target_rent_rate 导出）
  fixedItems: [{ key: 'labor', fen: yuan2fen(28000) }],
  varItems: [],
  grossMarginPct: 60,
  targetProfitFen: yuan2fen(20000),
  targetRentRate: 12,
  revPriceFen: yuan2fen(45),
  seats: 20,
  openDays: 30,
  pixelEffFen: yuan2fen(40),                                        // 假设市场租金 40 元/㎡·月（非核心方程）
};
const fwdRev = calcSandbox(toForwardInput(REV));
const dRev = deriveReverse(fwdRev, REV);
say(`  变换后入参 var_items = ${JSON.stringify(toForwardInput(REV).varItems)}`);
say(`  变换后 fixed_items  = ${JSON.stringify(toForwardInput(REV).fixedItems)}`);
CHK('目标月营收 R（分）= 100000 元', dRev.target_monthly_fen, yuan2fen(100000));
CHK('目标日均营收（分）= 3333 元（100000/30，取整到分）', dRev.target_daily_fen, Math.round(yuan2fen(100000) / 30));
CHK('房租上限（分）= 12000 元（R×12%）', dRev.rent_cap_fen, yuan2fen(12000));
CHK('月客流 = 2222.22（100000/45）', dRev.monthly_traffic, 2222.22);
CHK('日均客流 = 74.07（月客流/30）', dRev.daily_traffic, 74.07);
CHK('翻台 = 3.70（月客流/(20×30)）', dRev.turn_rate, 3.7);
CHK('面积上限 = 300 ㎡（12000/40）', dRev.area_cap_sqm, 300);
CHK('无红警', dRev.red_alert, false);
// 口径自洽：R 的算式等价于 (固定不含租 + 目标利润) / (1 − 食材成本率 − 平台率 − 租金率)
CHK('边际贡献率 = 0.48（1 − 40% 食材成本率 − 12% 租金率）', fwdRev.margin_rate_ratio, 0.48);

// ============================================================================
// ③ 反例对照：TARGET = 反推口径（fixed 不含 rent）；错误口径 = fixed 含 rent 且仍叠加租金率
//     ⇒ 重复计租：房租既进了固定成本，又被租金率导出了一遍
// ============================================================================
sec('③ 反例对照 · 重复计租的量化（同一组数据跑两条路径）');
const TARGET = REV;                                                  // 目标配置（正确口径）
const WRONG = Object.assign({}, REV, {                                // 错误口径：把 rent 也填进 fixed_items
  fixedItems: [
    { key: 'labor', fen: yuan2fen(28000) },
    { key: 'rent', fen: yuan2fen(12000) },                           // ← 用户按正算习惯也填了房租
  ],
});
const fwdRight = calcSandbox(toForwardInput(TARGET));
// 🔴 反例路径**不得**复用 toForwardInput —— 它自身就剔除 rent（= 变换层防线）。
//    反例要模拟的是「校验层不拦 + 变换层不剔除」**两道防线同时失效**：直接把含 rent 的 fixed
//    与叠加的租金率一起喂进引擎（本仓实证坑：拿"当前实现的正确行为"当反例 ⇒ 恒真/恒假）。
const fwdWrong = calcSandbox({
  cityTier: WRONG.cityTier, bizType: WRONG.bizType, buildItems: [],
  fixedItems: WRONG.fixedItems,                                   // ← 含 rent（未剔除）
  varItems: [{ key: 'rentRate', pct: WRONG.targetRentRate }],     // ← 仍叠加租金率
  grossMarginPct: WRONG.grossMarginPct,
  targetProfitFen: WRONG.targetProfitFen,
  expectedRevenueFen: 0,
});
const dRight = deriveReverse(fwdRight, TARGET);
const dWrong = deriveReverse(fwdWrong, WRONG);
say(`  正确口径（fixed 剔除 rent）  ⇒ 固定合计 ${fwdRight.fixed_total_fen} 分 · R = ${dRight.target_monthly_fen} 分`);
say(`  错误口径（fixed 含 rent）    ⇒ 固定合计 ${fwdWrong.fixed_total_fen} 分 · R = ${dWrong.target_monthly_fen} 分`);
CHK('错误口径的固定合计 = 40000 元（labor 28000 + rent 12000）', fwdWrong.fixed_total_fen, yuan2fen(40000));
CHK('两种口径结果**不同**（证明规则有鉴别力，不是恒真）',
  dRight.target_monthly_fen !== dWrong.target_monthly_fen, true);
CHK('错误口径 R 虚高 25000 元（= 房租 12000 元被多算一遍的杠杆放大：12000/0.48）',
  dWrong.target_monthly_fen - dRight.target_monthly_fen, yuan2fen(25000));

// ============================================================================
// ④ 边界：边际贡献率 ≤ 0 ⇒ 红警，不产出 R / 派生量（不编造）
// ============================================================================
sec('④ 边界 · 红警时反推不编造数字');
const RED = Object.assign({}, REV, { grossMarginPct: 30, targetRentRate: 60 });   // 40+60=100% ⇒ 边际贡献率 0
const fwdRed = calcSandbox(toForwardInput(RED));
const dRed = deriveReverse(fwdRed, RED);
CHK('红警触发', dRed.red_alert, true);
CHK('红警时 R = null（不编造）', dRed.target_monthly_fen, null);
CHK('红警时派生量全 null', [dRed.rent_cap_fen, dRed.monthly_traffic, dRed.turn_rate, dRed.area_cap_sqm], [null, null, null, null]);

// ============================================================================
const tail = `\n===== M2 反推锚点复算：${pass} 通过 / ${fails.length} 失败 =====`
  + (fails.length ? `\n失败清单：${fails.join(' · ')}` : '');
say(tail);
fs.writeFileSync(path.join(__dirname, 'recalc_anchors.txt'), lines.join('\n') + '\n', 'utf8');
process.exit(fails.length === 0 ? 0 : 1);
