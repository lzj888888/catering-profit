'use strict';
// R195 交叉审计 · M2/M3 核心引擎真实复算取证
// 方法论：所有数字来自 require 真实生产文件（非手抄）；每个锚点用手算独立核对。
const ROOT = require('path').resolve(__dirname, '../..');
const cs = require(ROOT + '/cloudfunctions/calcSandbox/service.js');     // M2 引擎
const cb = require(ROOT + '/cloudfunctions/calcBom/service.js');         // M3 菜品成本引擎
const tk = require(ROOT + '/utils/takeawayDerive.js');                   // M3 外卖单
const gp = require(ROOT + '/utils/grouponDerive.js');                    // M3 团购
const be = require(ROOT + '/utils/breakeven.js');                        // M3 现金流体检地基
const mb = require(ROOT + '/utils/marginBand.js');                       // M3 毛利率色阶单源
const md = require(ROOT + '/utils/m3Decision.js');                       // M3 决策台
const oc = require(ROOT + '/utils/openCash.js');                         // M2 开店现金
const bp = require(ROOT + '/utils/bizPreset.js');                        // M2 业态装配

let pass = 0, fail = 0; const fails = [];
function expect(name, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { pass++; console.log('  ✅ ' + name); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + '\n     期望=' + e + '\n     实得=' + g); }
}
function approx(name, got, exp, tol) {
  const d = Math.abs(Number(got) - Number(exp));
  if (d <= (tol == null ? 1e-6 : tol)) { pass++; console.log('  ✅ ' + name + ' (' + got + ')'); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + ' 期望≈' + exp + ' 实得=' + got); }
}

console.log('\n========== M2 · calcSandbox 引擎（真实复算）==========');
// 干净样例：装修 15.6万/3年 + 设备 10.6万/5年 ⇒ 月摊销=61万fen（与注释锚点一致）
const m2 = cs.calcSandbox({
  cityTier: 'tier23', bizType: 'fastfood',
  buildItems: [{ key: 'decor', fen: 15600000, years: 3 }, { key: 'equip', fen: 10600000, years: 5 }],
  fixedItems: [{ key: 'rent', fen: 1000000 }, { key: 'labor', fen: 2500000 }],
  varItems: [], grossMarginPct: 60, targetProfitFen: 200000,
});
approx('M2 build_amort_monthly_fen=610000', m2.build_amort_monthly_fen, 610000);
approx('M2 build_total_fen=26200000', m2.build_total_fen, 26200000);
approx('M2 fixed_total_fen=4110000', m2.fixed_total_fen, 4110000);
approx('M2 composite_var_rate_pct=40.0', m2.composite_var_rate_pct, 40.0);
approx('M2 break_even_monthly_fen=6850000', m2.break_even_monthly_fen, 6850000);
approx('M2 break_even_daily_fen=228333', m2.break_even_daily_fen, 228333);
approx('M2 target_monthly_fen=7183333', m2.target_monthly_fen, 7183333);
approx('M2 payback_months=131.0', m2.payback_months, 131.0);
expect('M2 red_alert=false', m2.red_alert, false);

console.log('\n========== M2 · calcSandboxReverse 反推（真实复算）==========');
const rev = cs.calcSandboxReverse({
  cityTier: 'tier23', bizType: 'fastfood',
  buildItems: [{ key: 'decor', fen: 15600000, years: 3 }, { key: 'equip', fen: 10600000, years: 5 }],
  fixedItems: [{ key: 'rent', fen: 1000000 }, { key: 'labor', fen: 2500000 }],
  varItems: [], grossMarginPct: 60, targetProfitFen: 200000,
  rev_price_fen: 5000, seats: 10, open_days: 30, target_rent_rate: 10,
});
approx('M2 反推 target_monthly_fen=6620000', rev.target_monthly_fen, 6620000);
approx('M2 反推 rent_cap_fen=662000', rev.rent_cap_fen, 662000);
approx('M2 反推 monthly_traffic=1324', rev.monthly_traffic, 1324);
approx('M2 反推 daily_traffic=44.13', rev.daily_traffic, 44.13);
approx('M2 反推 turn_rate=4.41', rev.turn_rate, 4.41);

console.log('\n========== M2 · bizPreset.assembleItems 装配（真实复算）==========');
const preset = bp.findPreset('fastfood_noodle');
const asm = bp.assembleItems(preset, { rentYuan: 30000, laborTotalYuan: 25000, fixedYuan: { rent: 30000 } }, bp.CITY_COEF.tier23);
const fixedMap = {}; asm.fixedItems.forEach((x) => { fixedMap[x.key] = (fixedMap[x.key] || 0) + x.fen; });
const varMap = {}; asm.varItems.forEach((x) => { varMap[x.key] = (varMap[x.key] || 0) + x.pct; });
approx('M2 装配 rent=3000000', fixedMap.rent, 3000000);
approx('M2 装配 labor=2500000', fixedMap.labor, 2500000);
approx('M2 装配 utility(房租×26%)=780000', fixedMap.utility, 780000);
approx('M2 装配 manage(房租×52%)=1560000', fixedMap.manage, 1560000);
approx('M2 装配 var.other=2', varMap.other, 2);

console.log('\n========== M2 · openCash 开店现金（真实复算）==========');
const oc1 = oc.estimateOpenCash({ areaM2: 100, rentFen: 3000000, equipFen: 5000000, stockFen: 2000000, budgetFen: 50000000, fixedMonthlyFen: 4000000 });
approx('M2 openCash decorFen=9000000', oc1.decorFen, 9000000);
approx('M2 openCash cashNeedFen=28000000', oc1.cashNeedFen, 28000000);
approx('M2 openCash remainFen=22000000', oc1.remainFen, 22000000);
approx('M2 openCash runwayMonths=5.5', oc1.runwayMonths, 5.5);
expect('M2 openCash level=safe', oc1.level, 'safe');

console.log('\n========== M3 · calcBom 菜品成本（真实复算 · 宫保锚点 0.0333元）==========');
approx('M3 netUnitCostWan(1500,500,90)=333', cb.netUnitCostWan(1500, 500, 90), 333);
const bomA = cb.calcCostCard({ mode: 'A', lines: [{ quantity: 200, net_unit_cost: 333 }], auxFen: 0, lossPct: 0, priceFen: 1000, targetMarginPct: 60 });
approx('M3 A unit_cost_fen=666', bomA.unit_cost_fen, 666);
approx('M3 A gross_margin_pct=33.4', bomA.gross_margin_pct, 33.4);
approx('M3 A reverse_price_fen(60%)=1665', bomA.reverse_price_fen, 1665);
const bomB = cb.calcCostCard({ mode: 'B', lines: [{ quantity: 200, net_unit_cost: 333 }], auxFen: 0, lossPct: 0, batchOutput: 10, priceFen: 1000 });
approx('M3 B batch_total_fen=666', bomB.batch_total_fen, 666);
approx('M3 B 单份 finalUnitFen=67', bomB.unit_cost_fen, 67);

console.log('\n========== M3 · takeawayDerive 双口径恒等式（真实复算）==========');
const tk1 = tk.calcTakeawayOrder(
  { items: [{ card_id: 'a', qty: 1 }], packs: [], params: { commission_mode: 'rate', commission_rate: 20, commission_min_fen: 0, delivery_fee_fen: 3000, delivery_subsidy_fen: 0, promo_fen: 0, pack_fee_fen: 200, delivery_customer_fen: 500 } },
  (id) => ({ unit_cost_fen: 4000, price_fen: 10000, name: '菜' })
);
approx('M3 外卖 cash.profit_fen=1700', tk1.cash.profit_fen, 1700);
approx('M3 外卖 accrual.profit_fen=1700（双口径恒等）', tk1.accrual.profit_fen, 1700);
approx('M3 外卖 receipt_rate=53.27', tk1.cash.receipt_rate, 53.27);
expect('M3 外卖 accrual.available=true', tk1.accrual.available, true);

console.log('\n========== M3 · reverseListedPrice 反算回带（真实复算）==========');
const rp = tk.reverseListedPrice({ dish_cost_fen: 4000, pack_cost_fen: 0, target_profit_fen: 1700, subsidy_merchant_fen: 0, delivery_fee_fen: 3000, delivery_subsidy_fen: 0, promo_fen: 0, delivery_customer_fen: 500, pack_fee_fen: 200, commission_mode: 'rate', commission_rate: 20 });
approx('M3 反算挂牌价=10000（回带恒等）', rp, 10000);
// fixed 模式佣金不进分母：应直接加回固定佣金（分子=8700 + 固定佣金800 = 9500）
const rpF = tk.reverseListedPrice({ dish_cost_fen: 4000, pack_cost_fen: 0, target_profit_fen: 1700, subsidy_merchant_fen: 0, delivery_fee_fen: 3000, delivery_subsidy_fen: 0, promo_fen: 0, delivery_customer_fen: 0, pack_fee_fen: 0, commission_mode: 'fixed', commission_fixed_fen: 800, commission_rate: 0 });
approx('M3 fixed佣金模式 反算=8700+800=9500', rpF, 9500);

console.log('\n========== M3 · grouponDerive 团购（真实复算）==========');
const gr = gp.calcGrouponOrder({ priceFen: 8800, costFen: 4000, ratePct: 6, promoFen: 0, dineFen: 18800 });
approx('M3 团购 commissionFen=528（基数=实付价）', gr.commissionFen, 528);
approx('M3 团购 profitFen=4272', gr.profitFen, 4272);
approx('M3 团购 vsDineFen=10528', gr.vsDineFen, 10528);
approx('M3 团购 netRatePct=94.0', gr.netRatePct, 94.0);

console.log('\n========== M3 · breakeven 体检地基（真实复算）==========');
const bk = be.breakeven({ revenueFen: 1000000, fixedFen: 400000, variableFen: 350000 });
approx('M3 保本 breakevenFen=615385', bk.breakevenFen, 615385);
approx('M3 保本 lowFen=583942', bk.lowFen, 583942);
approx('M3 保本 highFen=650407', bk.highFen, 650407);
approx('M3 安全边际 safeMarginPct=38.5', bk.safeMarginPct, 38.5);

console.log('\n========== M3 · marginBand 色阶单源（真实复算）==========');
expect('M3 bandOf(65)=high', mb.bandOf(65), 'high');
expect('M3 bandOf(50)=mid', mb.bandOf(50), 'mid');
expect('M3 bandOf(35)=low', mb.bandOf(35), 'low');
expect('M3 bandOf(null)=none', mb.bandOf(null), 'none');
expect('M3 matchBand(mid,50)=true', mb.matchBand('mid', 50), true);
expect('M3 matchBand(mid,null)=false', mb.matchBand('mid', null), false);
expect('M3 matchBand(none,null)=true', mb.matchBand('none', null), true);

console.log('\n========== M3 · m3Decision 决策台（真实复算）==========');
// 12 道菜、覆盖率100%：free 档只给销量结构，full 档给四象限与动作
const rows = [];
const qtyList = [120, 90, 80, 70, 60, 50, 40, 30, 25, 20, 15, 10];
const marginList = [65, 62, 58, 55, 50, 45, 40, 35, 30, 25, 20, 10];
for (let i = 0; i < 12; i++) {
  const amt = qtyList[i] * 1000; const g = amt * marginList[i] / 100;
  rows.push({ name: '菜' + i, qty: qtyList[i], amountFen: amt, totalCostFen: amt - g, grossFen: g, marginPct: marginList[i] });
}
const decFree = md.buildDishDecision({ rows, unmatchedAmountFen: 0, tier: 'free' });
expect('M3 决策 free ok=true', decFree.ok, true);
expect('M3 决策 free 不给毛利率(quadrant.marginPct=null)', decFree.quadrant.every((q) => q.marginPct === null), true);
const decFull = md.buildDishDecision({ rows, unmatchedAmountFen: 0, tier: 'full' });
approx('M3 决策 full medianQty=45', decFull.medianQty, 45);
expect('M3 决策 full actions 前5', decFull.actions.length <= 5, true);
const combo = md.buildComboDecision([{ name: '套餐A', customerSaveFen: 1000, merchantLoseFen: 800, costSharePct: 10 }, { name: '套餐B', customerSaveFen: 500, merchantLoseFen: 0, costSharePct: 5 }]);
expect('M3 套餐A kind=raise（商家少赚>0）', combo[0].kind, 'raise');
expect('M3 套餐B kind=push（没少赚）', combo[1].kind, 'push');
const wf = md.buildTakeawayWaterfall(tk1.cash);
approx('M3 瀑布 占比+到手率≡100', (wf.receiptRatePct || 0) + wf.items.reduce((s, x) => s + (x.pct || 0), 0), 100);
const pr = md.projectCostRise([{ name: '菜', totalCostFen: 4000, grossFen: 3340 }], 10);
approx('M3 原料涨价10% deltaFen=-400', pr.rows[0].deltaFen, -400);

console.log('\n========== 接线核查（见下方 Grep 工具结果；脚本内仅做引擎复算）==========');
console.log('  · calcWeightedMenuPct / calcCostCard / assembleItems 的真实调用方由 Grep 工具单独核查（避免 shell 编码问题）。');
console.log('\n================ 结果 ================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exit(1); }
else console.log('全部锚点真实引擎复算通过 ✅');
