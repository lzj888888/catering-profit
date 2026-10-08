'use strict';
// R237-followup 实测：豆包点名的「包间虚假乐观」到底真不真？
// 做法：固定其他入参、**只变 seats**（= 桌数 × 单桌座位数），看 turn_rate 与两套分档怎么变。
// ⚠️ 全部数字来自生产引擎实跑（require 纯函数），零手算。
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const svc = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js'));
const bp = require(path.join(ROOT, 'utils', 'bizPreset.js'));

const BASE = {
  mode: 'reverse', cityTier: 'tier23', bizType: 'dining', buildItems: [],
  grossMarginPct: 60, targetProfitFen: 2000000,
  rev_price_fen: 4500, target_rent_rate: 12, pixel_eff_fen: 4000,
  fixedItems: [{ key: 'labor', fen: 2800000 }], varItems: [], open_days: 30,
};

const CASES = [
  { label: '2 桌 x 8 人（豆包点名的"包间"场景）', tables: 2, spt: 8 },
  { label: '5 桌 x 4 人', tables: 5, spt: 4 },
  { label: '10 桌 x 4 人', tables: 10, spt: 4 },
  { label: '20 桌 x 4 人（锁定锚点）', tables: 20, spt: 4 },
  { label: '20 桌 x 5 人（每桌多坐 1 人）', tables: 20, spt: 5 },
  { label: '40 桌 x 4 人', tables: 40, spt: 4 },
];

console.log('== 固定入参：目标月利润 2 万 / 客单 45 / 毛利 60% / 30 天 / 租金率 12% / 固定(不含租) 28000 ==');
console.log('== 只变 seats，看 turn_rate 与两套分档 ==');
console.log('');
console.log('场景                                 seats   turn_rate   桌档   座档   页面（桌口径）会说什么');
for (const c of CASES) {
  const seats = c.tables * c.spt;
  const r = svc.calcSandboxReverse(Object.assign({}, BASE, { seats }));
  const lvT = bp.turnLevelOf('table', r.turn_rate);
  const lvS = bp.turnLevelOf('seat', r.turn_rate);
  const say = { easy: '正常做着就能到', ok: '客流得抓一抓才稳', hard: '新手维持起来吃力', '': '（不渲染）' }[lvT];
  console.log(
    c.label.padEnd(30, ' ') + '  ' +
    String(seats).padStart(4) + '   ' +
    String(r.turn_rate).padStart(7) + '   ' +
    (lvT || '-').padStart(4) + '   ' +
    (lvS || '-').padStart(4) + '   ' + say
  );
}

// 单变量对照：只动「单桌座位数」，桌数不变 ⇒ 证明结论对单桌座位数这个自定值有多敏感
console.log('');
console.log('== 敏感度：桌数固定 20，只动「单桌座位数」==');
for (const spt of [2, 3, 4, 5, 6]) {
  const r = svc.calcSandboxReverse(Object.assign({}, BASE, { seats: 20 * spt }));
  console.log(`  单桌 ${spt} 人 ⇒ seats=${20 * spt} ⇒ turn_rate=${r.turn_rate} ⇒ 桌档=${bp.turnLevelOf('table', r.turn_rate)}`);
}
