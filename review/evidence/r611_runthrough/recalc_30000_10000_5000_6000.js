// review/evidence/r611_runthrough/recalc_30000_10000_5000_6000.js
// R611 真机第 4/5 条的**独立重算**：不采信「9000」「70.0%」这两个回报值，
// 直接用仓库里的**同一份源码**（calcMonthlyProfit/service.js + common/indicatorRef.js）跑一遍。
// 只 require 纯函数模块，不连库、不 mock 任何数值。
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const { calcMonthlyProfit } = require(path.join(ROOT, 'cloudfunctions/calcMonthlyProfit/service.js'));
const indicatorRef = require(path.join(ROOT, 'cloudfunctions/common/indicatorRef.js'));

const YUAN = 100; // 1 元 = 100 分
const Y = (yuan) => yuan * YUAN;

// 老板填的四个数（第 4 条原文）：收入 30000 / 食材 10000 / 房租 5000 / 人工 6000，其余留空
const incomeYuan = 30000;
const foodYuan = 10000;
const rentYuan = 5000;
const laborYuan = 6000;

// ① 利润：走真正的引擎（房租/人工属费用明细，食材走 directConsumeFen，库存与摊销均关）
const r = calcMonthlyProfit({
  incomeItems: [{ amountFen: Y(incomeYuan) }],
  expenseItems: [{ amountFen: Y(rentYuan) }, { amountFen: Y(laborYuan) }],
  directConsumeFen: Y(foodYuan),
  amortizeFen: 0,
  amortizeSwitchOn: false,
  lumpSumFen: 0,
  inventorySwitchOn: false,
  inventory: { openingFen: 0, purchaseFen: 0, closingFen: 0 },
  pendingSettlementFen: 0,
});

// ② 三项刚性：与 getLedger 完全同序 —— 先用引擎出的「毛利率展示值」喂 evaluateIndicators，
//    再把它的 rent/labor 占比喂 threeCostOf（getLedger/index.js:208-231 的口径）。
const byInd = { rent: Y(rentYuan), labor: Y(laborYuan) };
const indicators = indicatorRef.m1IndicatorsOf(indicatorRef.evaluateIndicators({
  bizKey: 'dining',
  cityKey: 't2',
  revenueFen: r.incomeTotalFen,
  fixedFen: indicatorRef.toFixedFen(byInd),
  grossMarginPct: r.incomeTotalFen > 0 ? r.grossMarginRatePctDisplay : null,
  platformPct: null,
}));
const indByKey = {};
indicators.forEach((x) => { indByKey[x.key] = x; });
const pctOfInd = (k) => (indByKey[k] ? indByKey[k].pct : null);

const results = [];
['fastfood', 'dining', 'hotpot', 'cafe', 'other'].forEach((biz) => {
  const t = indicatorRef.threeCostOf(biz, {
    grossMarginPct: pctOfInd('grossMargin'),
    rentPct: pctOfInd('rent'),
    laborPct: pctOfInd('labor'),
  });
  results.push({ biz, ...t });
});

const fen2y = (fen) => (fen / YUAN).toFixed(2);
const line = (k, v) => console.log('  ' + k.padEnd(26, ' ') + v);

console.log('=== 输入（元）===');
line('营业收入', incomeYuan);
line('食材耗材（directConsume）', foodYuan);
line('房租（费用明细）', rentYuan);
line('人工（费用明细）', laborYuan);
line('摊销 / 一次性投入 / 库存', '全关 0');

console.log('\n=== ① 利润（calcMonthlyProfit 真实引擎）===');
line('incomeTotalFen', r.incomeTotalFen + ' 分 = ' + fen2y(r.incomeTotalFen) + ' 元');
line('expenseTotalFen', r.expenseTotalFen + ' 分 = ' + fen2y(r.expenseTotalFen) + ' 元');
line('materialCostFen', r.materialCostFen + ' 分 = ' + fen2y(r.materialCostFen) + ' 元');
line('grossProfitFen', r.grossProfitFen + ' 分 = ' + fen2y(r.grossProfitFen) + ' 元');
line('grossMarginRatePctDisplay', r.grossMarginRatePctDisplay + ' %');
line('operationRefProfitFen', r.operationRefProfitFen + ' 分 = ' + fen2y(r.operationRefProfitFen) + ' 元');
line('totalFactorRealProfitFen', r.totalFactorRealProfitFen + ' 分 = ' + fen2y(r.totalFactorRealProfitFen) + ' 元');
line('diffCheck（公式自洽）', r.diffCheck);

console.log('\n=== ② 三项刚性（threeCostOf）===');
line('毛利率 pct（页面用）', pctOfInd('grossMargin'));
line('房租 pct', pctOfInd('rent'));
line('人工 pct', pctOfInd('labor'));
results.forEach((x) => {
  line('[' + x.biz + '] pct / level', x.pct + ' % / ' + x.level
    + '  (健康≤' + x.healthy + ' 警戒>' + x.warn + ' 危险≥' + x.danger + ')'
    + (x.missing.length ? '  缺:' + x.missing.join(',') : ''));
});

// ===== 判据（写死期望，机器判红绿）=====
const expectProfitYuan = incomeYuan - foodYuan - rentYuan - laborYuan;   // 9000
const expectThreeCostPct = Math.round(((foodYuan + rentYuan + laborYuan) / incomeYuan) * 1000) / 10; // 70.0
const gotProfitYuan = r.operationRefProfitFen / YUAN;
const gotThreeCostPct = results.find((x) => x.biz === 'dining').pct;

const okProfit = Math.abs(gotProfitYuan - expectProfitYuan) <= 1;       // 清单允许 1 元内
const okThreeCost = Math.abs(gotThreeCostPct - expectThreeCostPct) <= 0.1;
const okBothCaliberEqual = r.operationRefProfitFen === r.totalFactorRealProfitFen;
const okDiffCheck = r.diffCheck === true;

console.log('\n=== 判据 ===');
line('利润 = ' + expectProfitYuan + ' 元（容差1元）', (okProfit ? 'PASS' : 'FAIL') + '  实得 ' + gotProfitYuan + ' 元');
line('三项刚性 = ' + expectThreeCostPct + ' %（容差0.1）', (okThreeCost ? 'PASS' : 'FAIL') + '  实得 ' + gotThreeCostPct + ' %');
line('两口径恒等（摊销关）', okBothCaliberEqual ? 'PASS' : 'FAIL');
line('diffCheck 公式自洽', okDiffCheck ? 'PASS' : 'FAIL');

const allPass = okProfit && okThreeCost && okBothCaliberEqual && okDiffCheck;
console.log('\n' + (allPass ? 'ALL_PASS' : 'HAS_FAIL'));
process.exit(allPass ? 0 : 1);
