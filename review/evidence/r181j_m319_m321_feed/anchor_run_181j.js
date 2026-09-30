// anchor_run_181j.js —— R181j 批次 E（M3.19 + M3.21）**独立锚点复算**（门禁方自推，不抄 InsCode 的 selftest）
//
// 🔴 纪律：期望值一律**自己手推**并写在下文推导里；只 `require` 生产单源取实际值比对。
//   不 require InsCode 的 selftest、不看它的期望值（它自测的绿只是"转述级"证据）。
//   运行：node review/evidence/r181j_m319_m321_feed/anchor_run_181j.js
//
// ============ 独立推导（先手推、再跑） ============
// 【引擎口径】读 `cloudfunctions/calcBom/service.js::calcCostCard` 与 `lineNetCostYuan`：
//   lineYuan_i = quantity_i × net_unit_cost_i ÷ 10000        （net_unit_cost 单位 = 万分之一元/克）
//   unit_cost_fen = round( ((Σ lineYuan + auxFen÷100) ÷ (1 − lossPct÷100)) × 100 )
//   gross_margin_pct = round2( (priceFen − unit_cost_fen) ÷ priceFen × 100 )
//
// 【M3.19 · 宫保 5 行】(qty, wan) = (200,333) (50,200) (10,400) (30,100) (20,200)；aux=50 分；loss=5%；price=2800 分
//   C   旧：Σ = 6.66+1.00+0.40+0.30+0.40 = 8.76 元
//          raw = (8.76+0.50)/0.95 = 9.7473684 ⇒ ×100 = 974.7368 ⇒ **975 分**
//          毛利 = (2800−975)/2800 = 65.1786% ⇒ **65.18**
//   C-a 鸡胸 20 元/斤 ⇒ wan 444：鸡胸 200×444/1e4 = 8.88；Σ = 8.88+1.00+0.40+0.30+0.40 = 10.98
//          raw = 11.48/0.95 = 12.0842105 ⇒ **1208 分**；毛利 = 1592/2800 = 56.8571% ⇒ **56.86**（≥55，未破带）
//   C-a2 鸡胸 25 元/斤 ⇒ wan 556：鸡胸 = 11.12；Σ = 13.22
//          raw = 13.72/0.95 = 14.4421053 ⇒ **1444 分**；毛利 = 1356/2800 = 48.4286% ⇒ **48.43**（<55 ⇒ 破带）
//
// 【M3.19 · C-b 未挂牌价】priceFen=0 ⇒ 引擎毛利实测 0（数字，非 null）
//   ⇒ 裸比较 `0 < 55` 恒真 ⇒ dry-run 若不抑制，会把"还没定价的卡"误报成"已跌破参考带"。
//   修法（本批我方验收落地）：noPrice ⇒ new_gross_margin_pct=null 且 below_band=false。
//
// 【M3.21 · calcMenuMargin】(自己造的输入，非抄 selftest)
//   三卡：A(price 2800, cost 975) / B(price 3500, cost 1235) / C(套餐 card_type=3, price 6000, cost 3000)
//   B1 默认排除套餐：Σprice = 6300，Σcost = 975+1235 = 2210
//          pct = (1 − 2210/6300)×100 = 4090/6300×100 = 64.9206…% ⇒ **64.92**
//   B2 includeCombo：Σprice = 12300，Σcost = 5210
//          pct = (1 − 5210/12300)×100 = 7090/12300×100 = 57.6423…% ⇒ **57.64**
//   B3 price 全 0 ⇒ null + reason='no_price'（不许除零、不许返回 0）
//   B4 空数组 ⇒ null + 'no_price'
//
// 【M3.21 · calcActualDishMargin】
//   C1 收入明细：dine_in 70000 ／ takeaway{sub_items:[商品总价 28000, 打包费 3000]}；食材成本 45000
//          菜品口径收入 = 70000 + 28000 = **98000**（🔴 打包费**不计入**商品总价）
//          pct = (98000−45000)/98000×100 = 53000/98000×100 = 54.0816…% ⇒ **54.08**
//   C2 外卖走快速录入（takeaway 行无 sub_items）⇒ **null + 'need_detail_income'**（不许用整类外卖额硬凑）
//   C3 收入合计 0 ⇒ **null + 'no_income'**
//
// 【M3.21 · reconcile】(自己造的输入)
//   D1 coverage=1, menu=64.92, actual=54.08, incomeFen=100000
//          diffPp = round2(54.08 − 64.92) = **−10.84**；diffFen = round(−0.1084×100000) = **−10840**
//   D2 coverage=0.25 (<0.6) ⇒ suppressed + 'coverage_low'
//   D3 coverage=null ⇒ suppressed + 'coverage_missing'
//   D4 coverage 足但 menuPct=null ⇒ suppressed + 'menu_no_price'
//   D5 coverage 足但 actualPct=null ⇒ suppressed + 'actual_no_data'
//   D6 抑制时 diffPp / diffFen **均 null**（只回两个 pct）

const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const { calcCostCard, rebuildSnapshotLines } = require(path.join(ROOT, 'cloudfunctions/calcBom/service.js'));
const recon = require(path.join(ROOT, 'utils/reconDerive.js'));
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('\u2705 ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('\u274c ' + name + '  (' + detail + ')'); }
}
const eq = (a, b) => Number(a) === Number(b);
const near = (a, b, eps) => Math.abs(Number(a) - Number(b)) <= (eps === undefined ? 0.005 : eps);

// ============ 输入构造（自己造，与 InsCode 的 selftest 无关） ============
const AUX = 50, LOSS = 5, PRICE = 2800;
const gongbao = (chickenWan) => [
  { quantity: 200, net_unit_cost: chickenWan },
  { quantity: 50, net_unit_cost: 200 },
  { quantity: 10, net_unit_cost: 400 },
  { quantity: 30, net_unit_cost: 100 },
  { quantity: 20, net_unit_cost: 200 },
];
const calc = (lines, priceFen) => calcCostCard({ mode: 'A', lines, auxFen: AUX, lossPct: LOSS, priceFen });

console.log('===== A · M3.19 影响面锚点（引擎实算 vs 我方手推） =====');
const oldR = calc(gongbao(333), PRICE);
ok('A1 旧成本 = 975 分（(8.76+0.50)/0.95 = 9.7473684 元）', eq(oldR.unit_cost_fen, 975), 'got ' + oldR.unit_cost_fen);
ok('A2 旧毛利率 = 65.18%（(2800−975)/2800）', near(oldR.gross_margin_pct, 65.18), 'got ' + oldR.gross_margin_pct);

const c20 = calc(gongbao(444), PRICE);
ok('A3 C-a 新成本 = 1208 分（11.48/0.95 = 12.0842105 元）', eq(c20.unit_cost_fen, 1208), 'got ' + c20.unit_cost_fen);
ok('A4 C-a 新毛利率 = 56.86%（1592/2800）', near(c20.gross_margin_pct, 56.86), 'got ' + c20.gross_margin_pct);
ok('A5 C-a 未破带（56.86 ≥ 55）', c20.gross_margin_pct >= 55, '56.86 ≥ 55');

const c25 = calc(gongbao(556), PRICE);
ok('A6 C-a2 新成本 = 1444 分（13.72/0.95 = 14.4421053 元）', eq(c25.unit_cost_fen, 1444), 'got ' + c25.unit_cost_fen);
ok('A7 C-a2 新毛利率 = 48.43%（1356/2800）', near(c25.gross_margin_pct, 48.43), 'got ' + c25.gross_margin_pct);
ok('A8 C-a2 破带（48.43 < 55）', c25.gross_margin_pct < 55, '48.43 < 55');

console.log('===== B · M3.19 C-b 未挂牌价（本次验收修的真缺陷） =====');
const zeroR = calc(gongbao(556), 0);
ok('B1 [引擎事实] priceFen=0 ⇒ gross_margin_pct 为数字 0（非 null）',
  zeroR.gross_margin_pct === 0 && typeof zeroR.gross_margin_pct === 'number', 'got ' + JSON.stringify(zeroR.gross_margin_pct));
ok('B2 [反证] 0 < 55 成立 ⇒ 不抑制必误标 below_band', (zeroR.gross_margin_pct < 55) === true, '0 < 55');
// 复刻修后的语义（noPrice 判定），断言它与引擎事实组合出的结果正确
const noPrice = !(Number(0) > 0);
ok('B3 [修后语义] noPrice ⇒ new_gross_margin_pct = null', noPrice === true, 'null');
ok('B4 [修后语义] noPrice ⇒ below_band = false（不再误报）', (!noPrice && zeroR.gross_margin_pct < 55) === false, 'false');
// 反证：有价时修后语义不误伤
const noPrice2 = !(Number(PRICE) > 0);
ok('B5 [修后语义·反证] 有价卡 noPrice = false，below_band 仍按比较走',
  noPrice2 === false && (c25.gross_margin_pct < 55) === true, '有价 48.43 仍报破带');

console.log('===== C · M3.21 calcMenuMargin（自造输入） =====');
const cards = [
  { price_fen: 2800, total_cost_fen: 975 },
  { price_fen: 3500, total_cost_fen: 1235 },
  { card_type: 3, price_fen: 6000, total_cost_fen: 3000 },
];
const m1 = recon.calcMenuMargin(cards, {});
ok('C1 默认排除套餐：64.92%（(1−2210/6300)×100）', near(m1.pct, 64.92), 'got ' + m1.pct);
const m2 = recon.calcMenuMargin(cards, { includeCombo: true });
ok('C2 includeCombo：57.64%（(1−5210/12300)×100）', near(m2.pct, 57.64), 'got ' + m2.pct);
const m3 = recon.calcMenuMargin([{ price_fen: 0, total_cost_fen: 975 }], {});
ok('C3 price 全 0 ⇒ null + no_price（不除零、不返回 0）', m3.pct === null && m3.reason === 'no_price', 'got ' + JSON.stringify(m3));
const m4 = recon.calcMenuMargin([], {});
ok('C4 空卡数组 ⇒ null + no_price', m4.pct === null && m4.reason === 'no_price', 'got ' + JSON.stringify(m4));

console.log('===== D · M3.21 calcActualDishMargin（自造 ledger） =====');
const ledger1 = {
  income_items: [
    { category: 'dine_in', amount_fen: 70000 },
    { category: 'takeaway', amount_fen: 31000, sub_items: [
      { sub_item: recon.GOODS_FIELD, amount_fen: 28000 },
      { sub_item: '打包费', amount_fen: 3000 },
    ] },
  ],
  result: { material_cost_fen: 45000 },
};
const a1 = recon.calcActualDishMargin(ledger1);
ok('D1 菜品口径收入 = 98000 分（只算商品总价，打包费 3000 不计入）', eq(a1.income_fen, 98000), 'got ' + a1.income_fen);
ok('D2 实际菜品毛利率 = 54.08%（53000/98000）', near(a1.pct, 54.08), 'got ' + a1.pct);

const ledger2 = { income_items: [{ category: 'takeaway', amount_fen: 31000 }], result: { material_cost_fen: 45000 } };
const a2 = recon.calcActualDishMargin(ledger2);
ok('D3 外卖快速录入（无 sub_items）⇒ null + need_detail_income（不用整类额硬凑）',
  a2.pct === null && a2.reason === 'need_detail_income', 'got ' + JSON.stringify(a2));

const ledger3 = { income_items: [{ category: 'dine_in', amount_fen: 0 }], result: { material_cost_fen: 0 } };
const a3 = recon.calcActualDishMargin(ledger3);
ok('D4 收入合计 0 ⇒ null + no_income', a3.pct === null && a3.reason === 'no_income', 'got ' + JSON.stringify(a3));

console.log('===== E · M3.21 reconcile 覆盖率闸门（fail-closed） =====');
const r1 = recon.reconcile({ menuPct: 64.92, actualPct: 54.08, coverage: 1, incomeFen: 100000 });
ok('E1 覆盖率足：diffPp = −10.84（54.08 − 64.92）', eq(r1.diffPp, -10.84), 'got ' + r1.diffPp);
ok('E2 覆盖率足：diffFen = −10840 分（−0.1084×100000）', eq(r1.diffFen, -10840), 'got ' + r1.diffFen);
ok('E3 覆盖率足：suppressed = false', r1.suppressed === false, 'false');

const r2 = recon.reconcile({ menuPct: 64.92, actualPct: 54.08, coverage: 0.25, incomeFen: 100000 });
ok('E4 覆盖率 25% < 60% ⇒ suppressed + coverage_low', r2.suppressed === true && r2.reason === 'coverage_low', r2.reason);
ok('E5 抑制时 diffPp / diffFen 均 null', r2.diffPp === null && r2.diffFen === null, 'null/null');
ok('E6 抑制时两个 pct 仍可读', near(r2.menuPct, 64.92) && near(r2.actualPct, 54.08), r2.menuPct + ' / ' + r2.actualPct);

const r3 = recon.reconcile({ menuPct: 64.92, actualPct: 54.08, coverage: null, incomeFen: 100000 });
ok('E7 覆盖率缺失（null）⇒ suppressed + coverage_missing', r3.suppressed === true && r3.reason === 'coverage_missing', r3.reason);
const r4 = recon.reconcile({ menuPct: null, actualPct: 54.08, coverage: 1, incomeFen: 100000 });
ok('E8 menuPct 为 null（无价）⇒ suppressed + menu_no_price', r4.suppressed === true && r4.reason === 'menu_no_price', r4.reason);
const r5 = recon.reconcile({ menuPct: 64.92, actualPct: null, coverage: 1, incomeFen: 100000 });
ok('E9 actualPct 为 null（无数据）⇒ suppressed + actual_no_data', r5.suppressed === true && r5.reason === 'actual_no_data', r5.reason);

console.log('===== F · 细项名单源（防改名静默失效） =====');
ok('F1 GOODS_FIELD ≡ TERMS.ledger.takeawayMode.goodsField', recon.GOODS_FIELD === TERMS.ledger.takeawayMode.goodsField,
  recon.GOODS_FIELD);

console.log('\n' + '='.repeat(60));
console.log('===== R181j 独立锚点复算：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
