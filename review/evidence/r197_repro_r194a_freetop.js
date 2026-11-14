'use strict';
// review/evidence/r197_repro_r194a_freetop.js —— R194-A 同根：免费档销量榜/已建卡数全渠道
// 运行：node review/evidence/r197_repro_r194a_freetop.js   (EXIT 0 = 全过)
// 真实引擎：require 真实 service.js，验证 buildFreeTop 全渠道合并、纯堂食逐行等价、跨渠道同菜去重。

const path = require('path');
const S = require(path.resolve(__dirname, '../../cloudfunctions/getDishReview/service.js'));

const KNOWN = ['A', 'B'];
const DEPS = {
  normalizeDishName: (s) => String(s == null ? '' : s).trim(),
  toMonth: () => '2026-11',
  lookupCardCode: (dk) => (KNOWN.indexOf(String(dk)) >= 0 ? String(dk) : ''),
};
const CARDS = [
  { card_code: 'A', version: 1, name: '菜A', price_list: 2000, total_cost: 800, created_at: '2026-11-01' },
  { card_code: 'B', version: 1, name: '菜B', price_list: 3000, total_cost: 1500, created_at: '2026-11-01' },
];
const dine = (sales) => S.buildDishReview(sales, CARDS, DEPS);
const take = (sales) => S.buildTakeawayReview(sales, CARDS, DEPS);

let pass = 0; const bad = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('   ✅ ' + n); } else { bad.push(n); console.log('   ❌ ' + n + (x ? '  → ' + x : '')); } };

console.log('R194-A 同根 · 免费档销量榜/已建卡数全渠道（真实引擎）');

// 纯外卖店
const t1 = take([
  { dish_key: 'A', qty: 100, amount: 200000, platform: 'meituan' },
  { dish_key: 'B', qty: 60, amount: 180000, platform: 'meituan' },
]);
const f1 = S.buildFreeTop([], t1, 10);
ok('S1 纯外卖店：销量榜非空且含 2 道菜（旧实现为空）', f1.top.length === 2 && f1.totalDistinct === 2, JSON.stringify(f1));

// 混合店：堂食 A 50 + 外卖 B 40
const d2 = dine([{ dish_key: 'A', qty: 50, amount: 100000, platform: 'pos' }]);
const t2 = take([{ dish_key: 'B', qty: 40, amount: 120000, platform: 'meituan' }]);
const f2 = S.buildFreeTop(d2.dine_in, t2, 10);
const keys2 = f2.top.map((x) => x.dish_key).sort();
ok('S2 混合店：销量榜同时含堂食 A 与外卖 B（totalDistinct=2）', f2.totalDistinct === 2 && keys2.join(',') === 'A,B', JSON.stringify({ keys2, total: f2.totalDistinct }));

// 纯堂食：与旧实现（ranked.slice().sort + slice(0,10)）逐行等价
const d3 = dine([
  { dish_key: 'A', qty: 50, amount: 100000, platform: 'pos' },
  { dish_key: 'B', qty: 80, amount: 240000, platform: 'pos' },
]);
const emptyTake = { by_platform: {}, totals: { qty: 0, amountFen: 0 } };
const f3 = S.buildFreeTop(d3.dine_in, emptyTake, 10);
const oldByQty = d3.dine_in.slice().sort((a, b) => (b.qty - a.qty) || (b.amountFen - a.amountFen) || String(a.name).localeCompare(String(b.name))).slice(0, 10);
const sameRows = f3.top.length === oldByQty.length && f3.top.every((x, i) => x.dish_key === oldByQty[i].dish_key && x.qty === oldByQty[i].qty);
ok('S3 纯堂食：与旧实现逐行等价（不改既有行为）', sameRows && f3.totalDistinct === d3.dine_in.length, JSON.stringify({ top: f3.top.map((x) => x.dish_key + ':' + x.qty), total: f3.totalDistinct }));

// 跨渠道同菜（同一 dish_key 同时出现在堂食与外卖）⇒ 合并成一行、qty 相加、不重复
const d4 = dine([{ dish_key: 'A', qty: 50, amount: 100000, platform: 'pos' }]);
const t4 = take([{ dish_key: 'A', qty: 30, amount: 60000, platform: 'meituan' }]);
const f4 = S.buildFreeTop(d4.dine_in, t4, 10);
ok('S4 跨渠道同菜去重：同一 dish_key ⇒ 1 行、qty 相加=80（不重复出两行）',
  f4.top.length === 1 && f4.top[0].dish_key === 'A' && f4.top[0].qty === 80 && f4.totalDistinct === 1, JSON.stringify(f4));

console.log('\n================ 结果 ================');
console.log('通过 ' + pass + ' / 失败 ' + bad.length);
if (bad.length) { bad.forEach((b) => console.log('   ❌ ' + b)); process.exit(1); }
console.log('全渠道合并正确、纯堂食等价、跨渠道去重 ✅');
process.exit(0);
