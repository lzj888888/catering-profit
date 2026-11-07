const D = require('C:/Users/lzj/WorkBuddy/Claw/catering-profit/utils/m3Decision.js');
const Y = (n) => Math.round(n * 100);
const yuan = (f) => (f == null ? '-' : (f / 100).toFixed(2));

const rows = [
  { name: '招牌牛肉面', qty: 300, amountFen: Y(6000), totalCostFen: Y(2100), grossFen: Y(3900) },
  { name: '酸辣粉', qty: 280, amountFen: Y(4200), totalCostFen: Y(1960), grossFen: Y(2240) },
  { name: '小面', qty: 260, amountFen: Y(3120), totalCostFen: Y(1560), grossFen: Y(1560) },
  { name: '炸酱面', qty: 240, amountFen: Y(4320), totalCostFen: Y(3600), grossFen: Y(720) },
  { name: '肥肠面', qty: 220, amountFen: Y(4840), totalCostFen: Y(4180), grossFen: Y(660) },
  { name: '豌杂面', qty: 200, amountFen: Y(3600), totalCostFen: Y(3200), grossFen: Y(400) },
  { name: '现磨豆浆', qty: 40, amountFen: Y(400), totalCostFen: Y(120), grossFen: Y(280) },
  { name: '卤蛋', qty: 35, amountFen: Y(175), totalCostFen: Y(70), grossFen: Y(105) },
  { name: '凉拌黄瓜', qty: 30, amountFen: Y(360), totalCostFen: Y(120), grossFen: Y(240) },
  { name: '豪华套餐', qty: 20, amountFen: Y(1600), totalCostFen: Y(1900), grossFen: Y(-300) },
  { name: '双人套餐', qty: 15, amountFen: Y(1050), totalCostFen: Y(1250), grossFen: Y(-200) },
  { name: '儿童餐', qty: 10, amountFen: Y(600), totalCostFen: Y(700), grossFen: Y(-100) },
];

const full = D.buildDishDecision({ rows, unmatchedAmountFen: Y(2000), tier: 'full' });
console.log('== Q1 付费档 ==');
console.log('ok=' + full.ok + ' coverage=' + full.coveragePct + ' dishCount=' + full.dishCount);
console.log('medianQty=' + full.medianQty + ' medianMarginPct=' + full.medianMarginPct);
full.actions.forEach(function (a, i) {
  console.log('  ' + (i + 1) + '. [' + a.kind + '] ' + a.name + ' qty=' + a.qty
    + ' margin=' + a.marginPct + '%' + ' gain=' + yuan(a.gainFen)
    + ' loss=' + yuan(a.lossFen) + ' share=' + a.sharePct);
});
const cells = {};
full.quadrant.forEach(function (q) { cells[q.cell] = (cells[q.cell] || 0) + 1; });
console.log('四格计数=' + JSON.stringify(cells));

console.log('\n== 免费档 ==');
const free = D.buildDishDecision({ rows: rows, unmatchedAmountFen: Y(2000), tier: 'free' });
console.log('ok=' + free.ok + ' actions=' + free.actions.length
  + ' kinds=' + Array.from(new Set(free.actions.map(function (a) { return a.kind; }))).join(','));
console.log('是否含毛利字段=' + free.actions.some(function (a) { return a.gainFen != null || a.grossFen != null; }));

console.log('\n== 数据不足 ==');
const few = D.buildDishDecision({ rows: rows.slice(0, 9), unmatchedAmountFen: Y(100), tier: 'full' });
console.log('9 道 ⇒ insufficient=' + few.insufficient + ' reason=' + few.reason);
const low = D.buildDishDecision({ rows: rows, unmatchedAmountFen: Y(15000), tier: 'full' });
console.log('覆盖 ' + low.coveragePct + '% ⇒ insufficient=' + low.insufficient + ' reason=' + low.reason);

console.log('\n== Q2 套餐 ==');
D.buildComboDecision([
  { name: 'A 套餐', merchantLoseFen: Y(6), customerSaveFen: Y(12), costSharePct: 55 },
  { name: 'B 套餐', merchantLoseFen: Y(-3), customerSaveFen: Y(8), costSharePct: 48 },
]).forEach(function (c) {
  console.log('  ' + c.name + ' 少赚=' + yuan(c.merchantLoseFen) + ' kind=' + c.kind);
});

console.log('\n== Q3 外卖瀑布 ==');
const wf = D.buildTakeawayWaterfall({
  payment_fen: Y(100), commission_fen: Y(6), delivery_fee_fen: Y(5), delivery_subsidy_fen: Y(2),
  subsidy_merchant_fen: Y(8), promo_fen: Y(3), receipt_fen: Y(76), profit_fen: Y(13),
});
console.log('到手率=' + wf.receiptRatePct + ' 各项=' + wf.items.map(function (i) { return i.key + ':' + i.pct + '%'; }).join(' '));
const sumPct = wf.items.reduce(function (s, i) { return s + i.pct; }, 0);
console.log('占比和=' + sumPct + ' + 到手率=' + Math.round((sumPct + wf.receiptRatePct) * 10) / 10);
console.log('还能被多拿=' + wf.breakEvenDropPct + ' 个百分点');

console.log('\n== S 涨价 10% ==');
const pr = D.projectCostRise(rows, 10);
console.log('合计成本增加=' + yuan(pr.totalDeltaFen) + ' 元；前3道='
  + pr.rows.slice(0, 3).map(function (r) { return r.name + ':' + yuan(r.costDeltaFen); }).join(' '));
