// r751_recon_coverage_probe.js —— 对账覆盖率上界缺口：可复现探针
// 用途：证明 11-12 发现 A（coverage>1 未抑制、停售菜稀释菜单毛利）至今仍可复现。
// 只审计不改代码。运行：node review/evidence/r751_recon_coverage_probe.js
'use strict';
const { calcMenuMargin, reconcile } = require('../../utils/reconDerive.js');

function scenario(saleN, oldN, actualPct) {
  const cards = [];
  for (let i = 0; i < saleN; i++) cards.push({ price_fen: 10000, total_cost_fen: 4000 });   // 在售 60%
  for (let i = 0; i < oldN; i++) cards.push({ price_fen: 10000, total_cost_fen: 8000 });     // 停售老卡 20%
  const menu = calcMenuMargin(cards);
  const coverage = cards.length / saleN;   // 对账页 index.js:127 的真实算法
  const rec = reconcile({ menuPct: menu.pct, actualPct, coverage, incomeFen: 9000000 });
  return { saleN, oldN, coverage: +coverage.toFixed(2), menuPct: menu.pct, actualPct,
           suppressed: rec.suppressed, diffPp: rec.diffPp, diffFen: rec.diffFen, reason: rec.reason };
}

console.log('=== 对账覆盖率上界探针（真实 reconDerive 引擎）===\n');
const cases = [
  scenario(30, 70, 60),   // 11-12 原始证据
  scenario(20, 80, 58),
  scenario(50, 50, 62),
  scenario(30, 0, 60),    // 对照：无停售老卡
  scenario(30, 15, 60),   // 对照：coverage=1.5 仍 >1
];
cases.forEach((c) => {
  const flag = (!c.suppressed && c.coverage > 1) ? '❌ 放行(应抑制)' : '✅';
  console.log(flag, JSON.stringify(c));
});
const leaked = cases.filter((c) => !c.suppressed && c.coverage > 1).length;
console.log('\n覆盖率>1 却放行：' + leaked + '/' + cases.length + ' 组');
console.log(leaked > 0 ? '===== 缺口确认存在 =====' : '===== 未复现 =====');
