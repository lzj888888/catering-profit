// review/evidence/r221_m2v11_accept/m2v11_anchor_run.js
// R221 · M2v1.1 反推分支 —— 锚点**独立复算**（第 4 步）
//
// 铁律：不采信 InsCode 自述；期望值**我方自推**（下面头注写推导），
//       require **生产** service.calcSandboxReverse / validate.validateInput，不复制逻辑。
//
// ── 组 A（豆包算例 · 30 天）推导 ──────────────────────────────
//   毛利率 60% ⇒ 食材成本率 40%；目标租金率 12% ⇒ 综合变动成本率 = 40 + 12 = 52%
//   边际贡献率 = 1 − 0.52 = 0.48
//   固定（不含房租）= 28,000 元 = 2,800,000 分；目标月利润 = 20,000 元 = 2,000,000 分
//   R = (2,800,000 + 2,000,000) / 0.48 = 10,000,000 分 = 100,000 元  ⇒ 日均 = R/30 = 333,333.33 → 333,333
//   房租上限 = R × 12% = 1,200,000 分 = 12,000 元
//   月客流 = R / 客单(4500) = 2222.2222 → round2 = 2222.22
//   日均客流 = 2222.2222 / 30 = 74.0741 → round2 = 74.07
//   翻台 = 2222.2222 / (座位 20 × 30) = 3.7037 → round2 = 3.7
//   面积上限 = 房租上限 / 坪效(4000) = 1,200,000 / 4,000 = 300 ㎡
//
// ── 组 B（open_days = 26 · 专打「÷ open_days 而非 ÷ 30」）推导 ──
//   固定（不含房租）= 26,000 元 = 2,600,000 分；其余同上
//   R = (2,600,000 + 2,000,000) / 0.48 = 9,583,333.33 → 9,583,333 分
//   日均 = 9,583,333 / **26** = 368,589.73 → 368,590 分   ← 若被写成 ÷30 会得 319,444，差 49,146
//   月客流 = 9,583,333 / 4500 = 2129.6296 → 2129.63
//   日均客流 = 2129.6296 / 26 = 81.9088 → 81.91
//   翻台 = 2129.6296 / (20 × 26) = 4.0954 → 4.1
//   房租上限 = 9,583,333 × 12% = 1,149,999.96 → 1,150,000 分
//   面积上限 = 1,150,000 / 4000 = 287.5 ㎡（round1）
//
// ── 组 C（红警）推导 ────────────────────────────────────────
//   毛利率 30% ⇒ 食材成本率 70%；租金率 60% ⇒ 综合 130% ≥ 100% ⇒ 边际 ≤ 0 ⇒ 全 null、不编造
//
// ── 组 D（反证：若不剔除 rent ⇒ 重复计租、R 虚高）────────────
//   故意把 rent 留在 fixed_items 里、又追加 rentRate，**绕过 validate**直接喂生产 calcSandbox，
//   证明「剔除」这一步真实改变结果（否则守卫是空跑）。
'use strict';
const path = require('path');
const svc = require(path.join(__dirname, '..', '..', '..', 'cloudfunctions', 'calcSandbox', 'service.js'));
const val = require(path.join(__dirname, '..', '..', '..', 'cloudfunctions', 'calcSandbox', 'validate.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('❌ ' + name + (extra ? '  ' + extra : '')); }
}
const J = (v) => JSON.stringify(v);

const baseRev = {
  mode: 'reverse', cityTier: 'tier23', bizType: 'dining', buildItems: [],
  grossMarginPct: 60, targetProfitFen: 2000000,
  seats: 20, target_rent_rate: 12, pixel_eff_fen: 4000,
};

console.log('\n===== 组 A · 豆包算例（30 天 · 客单 4500 分 · 固定 2,800,000 分）=====');
const A = Object.assign({}, baseRev, {
  fixedItems: [{ key: 'labor', fen: 2800000 }], varItems: [],
  rev_price_fen: 4500, open_days: 30,
});
const rA = svc.calcSandboxReverse(A);
check('A1 R = 10,000,000 分', rA.target_monthly_fen === 10000000, '=' + rA.target_monthly_fen);
check('A2 目标日均 = 333,333 分', rA.target_daily_fen === 333333, '=' + rA.target_daily_fen);
check('A3 房租上限 = 1,200,000 分', rA.rent_cap_fen === 1200000, '=' + rA.rent_cap_fen);
check('A4 月客流 = 2222.22', rA.monthly_traffic === 2222.22, '=' + rA.monthly_traffic);
check('A5 日均客流 = 74.07', rA.daily_traffic === 74.07, '=' + rA.daily_traffic);
check('A6 翻台 = 3.7', rA.turn_rate === 3.7, '=' + rA.turn_rate);
check('A7 面积上限 = 300 ㎡', rA.area_cap_sqm === 300, '=' + rA.area_cap_sqm);
check('A8 red_alert = false', rA.red_alert === false);
check('A9 warn_keys 空（翻台 3.7 ≤ 8）', Array.isArray(rA.warn_keys) && rA.warn_keys.length === 0, J(rA.warn_keys));

console.log('\n===== 组 B · open_days = 26（打「÷ open_days」而非「÷ 30」）=====');
const B = Object.assign({}, baseRev, {
  fixedItems: [{ key: 'labor', fen: 2600000 }], varItems: [],
  rev_price_fen: 4500, open_days: 26,
});
const rB = svc.calcSandboxReverse(B);
check('B1 R = 9,583,333 分', rB.target_monthly_fen === 9583333, '=' + rB.target_monthly_fen);
check('B2 目标日均 = 368,590 分（÷26，不是 ÷30 的 319,444）', rB.target_daily_fen === 368590, '=' + rB.target_daily_fen);
check('B3 月客流 = 2129.63', rB.monthly_traffic === 2129.63, '=' + rB.monthly_traffic);
check('B4 日均客流 = 81.91（÷26）', rB.daily_traffic === 81.91, '=' + rB.daily_traffic);
check('B5 翻台 = 4.1（÷(20×26)）', rB.turn_rate === 4.1, '=' + rB.turn_rate);
check('B6 房租上限 = 1,150,000 分', rB.rent_cap_fen === 1150000, '=' + rB.rent_cap_fen);
check('B7 面积上限 = 287.5 ㎡', rB.area_cap_sqm === 287.5, '=' + rB.area_cap_sqm);
check('B8 若误用 ÷30 会得 319,444 ≠ 实际值（差异真实存在）', rB.target_daily_fen !== Math.round(9583333 / 30));

console.log('\n===== 组 C · 红警（毛利率 30% + 租金率 60% ⇒ 边际 ≤ 0）=====');
const C = Object.assign({}, baseRev, {
  fixedItems: [{ key: 'labor', fen: 2800000 }], varItems: [],
  rev_price_fen: 4500, open_days: 30, grossMarginPct: 30, target_rent_rate: 60,
});
const rC = svc.calcSandboxReverse(C);
check('C1 red_alert = true', rC.red_alert === true);
check('C2 R 与全部派生量为 null（不编造）',
  rC.target_monthly_fen === null && rC.target_daily_fen === null && rC.rent_cap_fen === null
  && rC.monthly_traffic === null && rC.daily_traffic === null && rC.turn_rate === null
  && rC.area_cap_sqm === null,
  J([rC.target_monthly_fen, rC.daily_traffic, rC.turn_rate, rC.area_cap_sqm]));

console.log('\n===== 组 D · 反证：不剔除 rent ⇒ 重复计租、R 虚高 =====');
// 错误变换：fixed 保留 rent(12,000 元) + var 追加 rentRate 12%
const wrongClean = Object.assign({}, A, {
  fixedItems: [{ key: 'labor', fen: 2800000 }, { key: 'rent', fen: 1200000 }],
  varItems: [{ key: 'rentRate', pct: 12 }],
});
const wrongFwd = svc.calcSandbox(wrongClean);
check('D1 错误变换（含 rent）⇒ R 虚高 25,000 分（100,000 → 125,000 元）',
  wrongFwd.target_monthly_fen === 12500000,
  '正确 10,000,000 vs 错误 ' + wrongFwd.target_monthly_fen);
check('D2 差异真实存在（证明「剔除 rent」这一步改变结果，守卫非空跑）',
  wrongFwd.target_monthly_fen !== rA.target_monthly_fen);

console.log('\n===== 组 E · 校验层拦（validate 反推 + fixed 含 rent ⇒ 拒）=====');
const eOk = val.validateInput({
  shop_id: 's', mode: 'reverse', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], var_items: [], gross_margin_pct: 60, target_profit_fen: 2000000,
  fixed_items: [{ key: 'rent', fen: 1200000 }, { key: 'labor', fen: 2800000 }],
  rev_price_fen: 4500, seats: 20, open_days: 30, target_rent_rate: 12,
});
check('E1 反推 + fixed 含 rent ⇒ error 非空', !!eOk.error, eOk.error ? eOk.error : 'error=null');
const eClean = val.validateInput({
  shop_id: 's', mode: 'reverse', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], var_items: [], gross_margin_pct: 60, target_profit_fen: 2000000,
  fixed_items: [{ key: 'labor', fen: 2800000 }],
  rev_price_fen: 4500, seats: 20, open_days: 30, target_rent_rate: 12, pixel_eff_fen: 4000,
});
check('E2 反推 + fixed 无 rent ⇒ clean.mode = reverse 且字段齐备',
  !eClean.error && eClean.clean.mode === 'reverse' && eClean.clean.target_rent_rate === 12,
  eClean.error ? eClean.error : J({ mode: eClean.clean.mode, rate: eClean.clean.target_rent_rate }));
// E3 正向缺省 mode ⇒ forward（向后兼容）
const eFwd = val.validateInput({
  shop_id: 's', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], fixed_items: [{ key: 'rent', fen: 1200000 }], var_items: [],
  gross_margin_pct: 65, target_profit_fen: 0,
});
check('E3 缺省 mode ⇒ forward（正算仍接受 rent）',
  !eFwd.error && eFwd.clean.mode === 'forward', eFwd.error ? eFwd.error : String(eFwd.clean.mode));

console.log('\n==== M2v1.1 反推锚点复算：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail === 0 ? 0 : 1);
