'use strict';
// review/evidence/r196_repro_r194a.js —— R194-A 真实引擎复现 + 修复验证
// 运行：node review/evidence/r196_repro_r194a.js   (EXIT 0 = 复现一致且修复有效)
//
// 纪律：先真引擎复现缺陷，再验证修法。本脚本 require 真实 service.js，仅"接线选择(堂食/全渠道 ranked)"
//       由本脚本镜像 index.js 的写法，其余全部走生产引擎。

const path = require('path');
const S = require(path.resolve(__dirname, '../../cloudfunctions/getDishReview/service.js'));

// —— 真实引擎依赖（与生产 index.js 同口径）——
const KNOWN = ['A', 'B'];
const DEPS = {
  normalizeDishName: (s) => String(s == null ? '' : s).trim(),
  toMonth: () => '2026-11',
  // 模拟"已全量挂卡"的店铺：dish_key 直接映射到 card_code（生产里是 shop_dish_mapping 查表）
  lookupCardCode: (dk) => (KNOWN.indexOf(String(dk)) >= 0 ? String(dk) : ''),
};
const CARDS = [
  { card_code: 'A', version: 1, name: '外卖菜A', price_list: 2000, total_cost: 800, created_at: '2026-11-01' },
  { card_code: 'B', version: 1, name: '外卖菜B', price_list: 3000, total_cost: 1500, created_at: '2026-11-01' },
];

// 镜像"修复后接线"：把各平台外卖 ranked 并入全渠道 ranked
function allChannelRankedOf(dine, take) {
  const arr = (dine.dine_in || []).slice();
  const bp = take.by_platform || {};
  for (const p of Object.keys(bp)) {
    const r = bp[p] && bp[p].ranked;
    if (Array.isArray(r)) arr.push(...r);
  }
  return arr;
}

function scenario(name, dineSales, takeSales) {
  const dine = S.buildDishReview(dineSales, CARDS, DEPS);
  const take = S.buildTakeawayReview(takeSales, CARDS, DEPS);
  const totals = S.mergeTotals(dine.totals, take.totals);
  // 当前接线（仅堂食 ranked）—— 即 index.js:180 现状
  const cur = S.calcWeightedMenuPct(dine.dine_in, CARDS, totals.qty);
  // 修复接线（全渠道 ranked）
  const fixed = S.calcWeightedMenuPct(allChannelRankedOf(dine, take), CARDS, totals.qty);
  console.log(`\n[${name}] totals.qty=${totals.qty}  当前(堂食ranked only)=${JSON.stringify(cur)}  修复(全渠道)=${JSON.stringify(fixed)}`);
  return { cur, fixed, totals };
}

let pass = 0; const bad = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('   ✅ ' + n); } else { bad.push(n); console.log('   ❌ ' + n + (x ? '  → ' + x : '')); } };

console.log('R194-A · 加权标量渠道口径错配（真实引擎复现 + 修复验证）');

// 场景1：纯外卖店（堂食 0 行）
const s1 = scenario('纯外卖店', [], [
  { dish_key: 'A', qty: 100, amount: 200000, platform: 'meituan' },
  { dish_key: 'B', qty: 100, amount: 300000, platform: 'meituan' },
]);
ok('S1·当前接线 纯外卖店恒 no_match（缺陷存在）', s1.cur.pct === null && s1.cur.reason === 'no_match', JSON.stringify(s1.cur));
ok('S1·修复接线 纯外卖店返回有效 pct（=54.00%）', s1.fixed.pct === 54 && s1.fixed.reason === '', JSON.stringify(s1.fixed));

// 场景2：混合店（堂食A 50 / 外卖B 50）
const s2 = scenario('混合店', [
  { dish_key: 'A', qty: 50, amount: 100000, platform: 'pos' },
], [
  { dish_key: 'B', qty: 50, amount: 150000, platform: 'meituan' },
]);
ok('S2·当前接线 混合店被 low_match 抑制（coverage=50%<90%）', s2.cur.pct === null && s2.cur.reason === 'low_match', JSON.stringify(s2.cur));
ok('S2·修复接线 混合店返回有效 pct（=54.00%）', s2.fixed.pct === 54 && s2.fixed.reason === '', JSON.stringify(s2.fixed));

// 场景3：对照基线（纯堂食，修复前后应一致）
const s3 = scenario('纯堂食(对照)', [
  { dish_key: 'A', qty: 100, amount: 200000, platform: 'pos' },
  { dish_key: 'B', qty: 100, amount: 300000, platform: 'pos' },
], []);
ok('S3·对照 纯堂食修复前后一致（=54.00%）', s3.cur.pct === 54 && s3.fixed.pct === 54, JSON.stringify({ cur: s3.cur.pct, fixed: s3.fixed.pct }));

console.log('\n================ 结果 ================');
console.log('通过 ' + pass + ' / 失败 ' + bad.length);
if (bad.length) { bad.forEach((b) => console.log('   ❌ ' + b)); process.exit(1); }
console.log('复现一致且修复有效 ✅');
process.exit(0);
