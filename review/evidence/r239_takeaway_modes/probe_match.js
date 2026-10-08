// review/evidence/r239_takeaway_modes/probe_match.js
// 目的：用**生产算法**（cloudfunctions/getDishReview/service.js::buildDishReview）实跑，
//      证明复盘的成本前提是「菜品卡」而不是「原料库」，且名字对不上时**不报错但单列 unmatched**。
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const S = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js'));
const { normalizeDishName } = require(path.join(ROOT, 'cloudfunctions/common/dishKey.js'));
const toMonth = (t) => { const d = new Date(Number(t) || 0); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const deps = { normalizeDishName, toMonth };
const fen = (y) => Math.round(y * 100);

// 场景 A：账单里 3 个菜，其中 2 个有同名菜品卡、1 个没有
const sales = [
  { dish_key: '耙牛肉', qty: 12, amount: fen(984), platform: 'pos' },
  { dish_key: '番茄锅底', qty: 8, amount: fen(304), platform: 'pos' },
  { dish_key: '手打虾滑', qty: 5, amount: fen(190), platform: 'pos' },   // 无卡
];
const cards = [
  { card_code: 'c1', version: 1, name: '耙牛肉', total_cost: fen(41.2), created_at: 1759276800000 },
  { card_code: 'c2', version: 1, name: '番茄锅底', total_cost: fen(11.5), created_at: 1759276800000 },
];
const A = S.buildDishReview(sales, cards, deps);
console.log('===== 场景A：2 张卡 + 1 个无卡菜（名字都在原料库也没用）=====');
console.log('排名（已匹配，含成本/毛利/毛利率）：');
A.dine_in.forEach((x) => console.log('  ', x.name, '| 份数', x.qty, '| 营收', (x.amountFen / 100).toFixed(2),
  '| 成本', (x.totalCostFen / 100).toFixed(2), '| 毛利', (x.grossFen / 100).toFixed(2), '| 毛利率', x.marginPct + '%'));
console.log('未匹配（单列，不报错、不归零）：');
A.unmatched.forEach((x) => console.log('  ', x.name, '| 份数', x.qty, '| 营收', (x.amountFen / 100).toFixed(2)));
console.log('合计：份数', A.totals.qty, '营收', (A.totals.amountFen / 100).toFixed(2),
  '成本', (A.totals.costFen / 100).toFixed(2), '毛利', (A.totals.grossFen / 100).toFixed(2),
  '已匹配款数', A.totals.dishCount, '未匹配款数', A.totals.unmatchedCount);

// 场景 B：一张卡都没有
console.log('\n===== 场景B：菜品卡一张都没建 =====');
const B = S.buildDishReview(sales, [], deps);
console.log('已匹配条数 =', B.dine_in.length, '｜未匹配条数 =', B.unmatched.length,
  '｜成本合计 =', (B.totals.costFen / 100).toFixed(2), '｜毛利率能算吗 =', B.dine_in.length ? '能' : '不能（全在未匹配）');

// 场景 C：名字差一点（带括号/空格）也能对上吗 —— 归一化实测
console.log('\n===== 场景C：账单名带空格/异体，归一后能否对上卡 =====');
const sales2 = [{ dish_key: '  耙牛肉 ', qty: 3, amount: fen(246), platform: 'pos' }];
const C = S.buildDishReview(sales2, cards, deps);
console.log('「  耙牛肉 」(前后空格) ⇒ 匹配到', C.dine_in.length ? C.dine_in[0].name : '未匹配');

// 场景 D：卡里成本为 0（原料价没填）⇒ 毛利率虚高
console.log('\n===== 场景D：卡建了但卡内成本=0（原料价没填）=====');
const cards2 = [{ card_code: 'c1', version: 1, name: '耙牛肉', total_cost: 0, created_at: 1759276800000 }];
const D = S.buildDishReview([{ dish_key: '耙牛肉', qty: 12, amount: fen(984), platform: 'pos' }], cards2, deps);
console.log('  ', D.dine_in[0].name, '| 营收', (D.dine_in[0].amountFen / 100).toFixed(2),
  '| 成本', (D.dine_in[0].totalCostFen / 100).toFixed(2), '| 毛利率', D.dine_in[0].marginPct + '%  ← 看着很美，其实是没填价');
