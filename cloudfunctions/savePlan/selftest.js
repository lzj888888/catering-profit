// cloudfunctions/savePlan/selftest.js —— M2v1.2 多方案存储自测（复现开发规范 v1.2 §十 五组锚点）
// 运行：node cloudfunctions/savePlan/selftest.js
//
// 🔴 用**生产引擎**（本目录内联副本 ≡ cloudfunctions/calcSandbox/service.js 逐字节）实跑，
//    不手写等价公式（重写 = 第二个真相源）。目的与 review/evidence/r229_m2_multiplan 一致：
//    证明「存全量 param_json(snake) ⇒ 无损重算」这条设计基石成立，且命名口径/全量字段有鉴别力。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const E = require('./service');                       // 🔴 内联副本（须与生产引擎逐字节一致）
const { calcSandbox, calcSandboxReverse, ENGINE_VERSION } = E;
const { paramToClean } = require('./paramMap');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? ' · ' + detail : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? ' · ' + detail : ''}`); }
}
const YUAN = 100;
const y2f = (y) => Math.round(y * YUAN);

// ---------- 引擎入参（clean，混合命名 —— 既有实现客观如此）----------
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
const CLEAN_REV = {
  mode: 'reverse', cityTier: 'tier23', bizType: 'dining',
  buildItems: [],
  fixedItems: [{ key: 'labor', fen: y2f(28000) }],     // 🔴 反推口径：fixed_items 不含 rent
  varItems: [],
  grossMarginPct: 60, targetProfitFen: y2f(20000), expectedRevenueFen: 0,
  rev_price_fen: y2f(45), seats: 20, open_days: 30, target_rent_rate: 12, pixel_eff_fen: y2f(40),
};

// ---------- 存库形态 param_json（snake · 14 字段）----------
const P_FWD = {
  mode: 'forward', city_tier: 'tier23', biz_type: 'dining',
  build_items: CLEAN_FWD.buildItems, fixed_items: CLEAN_FWD.fixedItems, var_items: CLEAN_FWD.varItems,
  gross_margin_pct: 65, target_profit_fen: y2f(15000), expected_revenue_fen: 0,
  rev_price_fen: 0, seats: 0, open_days: 30, target_rent_rate: 0, pixel_eff_fen: 0,
};
const P_REV = {
  mode: 'reverse', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], fixed_items: CLEAN_REV.fixedItems, var_items: [],
  gross_margin_pct: 60, target_profit_fen: y2f(20000), expected_revenue_fen: 0,
  rev_price_fen: y2f(45), seats: 20, open_days: 30, target_rent_rate: 12, pixel_eff_fen: y2f(40),
};

console.log('===== ① 旧锚点回归（正算 · M2.10 标准工况，证明引擎未漂）=====');
const A1 = calcSandbox(CLEAN_FWD);
check('建店总投入 = 660000 元', A1.build_total_fen === y2f(660000), `=${A1.build_total_fen}分`);
check('月摊销 = 17000 元', A1.build_amort_monthly_fen === y2f(17000), `=${A1.build_amort_monthly_fen}分`);
check('不含摊销固定合计 = 21000 元', A1.fixed_ex_amort_fen === y2f(21000), `=${A1.fixed_ex_amort_fen}分`);
check('含摊销固定合计 = 38000 元', A1.fixed_total_fen === y2f(38000), `=${A1.fixed_total_fen}分`);
check('综合变动成本率 = 50%', A1.composite_var_rate_pct === 50, `=${A1.composite_var_rate_pct}%`);
check('保本月营收 = 76000 元', A1.break_even_monthly_fen === y2f(76000), `=${A1.break_even_monthly_fen}分`);
check('目标月营收 = 106000 元', A1.target_monthly_fen === y2f(106000), `=${A1.target_monthly_fen}分`);
check('回本周期 = 44 个月', A1.payback_months === 44, `=${A1.payback_months}`);
check('无红警', A1.red_alert === false, `=${A1.red_alert}`);

console.log('\n===== ②-A 正算 param_json 往返（snake → clean → calcSandbox ≡ 首次）=====');
const A2 = calcSandbox(paramToClean(P_FWD));
check('往返后出参 === 首次出参（逐字段 JSON 全等）', JSON.stringify(A2) === JSON.stringify(A1), '');

console.log('\n===== ②-B 反推 param_json 往返（目标月利润 20000 / 客单 45 / 毛利率 60 / 座位 20 / 30 天 / 租金率 12%）=====');
const R1 = calcSandboxReverse(CLEAN_REV);
const R2 = calcSandboxReverse(paramToClean(P_REV));
check('反推往返后 reverse 块 === 首次（逐字段 JSON 全等）', JSON.stringify(R2) === JSON.stringify(R1), '');
check('目标月营收 R = 100000 元', R1.target_monthly_fen === y2f(100000), `=${R1.target_monthly_fen}分`);
check('房租上限 = 12000 元', R1.rent_cap_fen === y2f(12000), `=${R1.rent_cap_fen}分`);
check('日均客流 = 74.07', R1.daily_traffic === 74.07, `=${R1.daily_traffic}`);
check('翻台 = 3.70', R1.turn_rate === 3.7, `=${R1.turn_rate}`);
check('面积上限 = 300 ㎡', R1.area_cap_sqm === 300, `=${R1.area_cap_sqm}`);

console.log('\n===== ③-1 反例 · param_json 写成 camelCase ⇒ 目标月营收崩成 null（命名口径有鉴别力）=====');
const toCamel = (p) => {
  const camel = {};
  for (const k of Object.keys(p)) camel[k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())] = p[k];
  return camel;
};
const A3 = calcSandbox(paramToClean(toCamel(P_FWD)));
check('camel 写法下目标月营收为 null（不是 10600000）', A3.target_monthly_fen === null, `=${A3.target_monthly_fen}`);
check('camel 写法 ≠ 正确 snake 写法（证明有鉴别力，不是恒真）',
  A3.target_monthly_fen !== A2.target_monthly_fen || A3.composite_var_rate_pct !== A2.composite_var_rate_pct,
  `snake=${A2.target_monthly_fen} / camel=${A3.target_monthly_fen}`);

console.log('\n===== ③-2 反例 · 反推漏字段 ⇒ 派生量 null（证明必须存全量 14 字段）=====');
const R3 = calcSandboxReverse(paramToClean(P_REV, ['seats']));
// 🔴 对齐权威锚点 review/evidence/r229_m2_multiplan/recalc_anchors.js（24/24）：
//    seats 漏掉 → num0 → 0 → 分母变 0 → 翻台非有限值（Infinity），**不编造**。
check('漏 seats ⇒ 翻台非有限值（分母 0，不编造）', !Number.isFinite(R3.turn_rate), `=${String(R3.turn_rate)}`);
const R4 = calcSandboxReverse(paramToClean(P_REV, ['pixel_eff_fen']));
check('漏 pixel_eff_fen ⇒ 面积上限为 null（坪效 ≤0 不编造）', R4.area_cap_sqm === null, `=${JSON.stringify(R4.area_cap_sqm)}`);

console.log('\n===== ④ 边界 · 边际贡献率 ≤ 0（红警）⇒ R 与全部派生量 null（不编造）=====');
const red = Object.assign({}, CLEAN_REV, { grossMarginPct: 30, target_rent_rate: 60 }); // 40%+60% = 100%
const R5 = calcSandboxReverse(red);
check('红警触发', R5.red_alert === true, `=${R5.red_alert}`);
check('R = null', R5.target_monthly_fen === null, `=${JSON.stringify(R5.target_monthly_fen)}`);
check('派生量全 null', JSON.stringify([R5.rent_cap_fen, R5.monthly_traffic, R5.daily_traffic, R5.turn_rate, R5.area_cap_sqm])
  === JSON.stringify([null, null, null, null, null]), '');

console.log('\n===== ⑤ 副本保真（savePlan/service.js ≡ calcSandbox/service.js md5 相等 + ENGINE_VERSION 同值）=====');
const md5 = (p) => { try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch (e) { return null; } };
const saveCopy = path.join(__dirname, 'service.js');
const prodCopy = path.join(__dirname, '..', 'calcSandbox', 'service.js');
const hSave = md5(saveCopy);
const hProd = md5(prodCopy);
check('两文件可读且 md5 相等', !!hSave && hSave === hProd, hSave ? hSave : '读不到');
const E2 = require(prodCopy);
check('ENGINE_VERSION 两处同值', !!E2.ENGINE_VERSION && E2.ENGINE_VERSION === ENGINE_VERSION,
  `savePlan=${ENGINE_VERSION} / calcSandbox=${E2.ENGINE_VERSION}`);

console.log(`\n===== savePlan 自测：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);