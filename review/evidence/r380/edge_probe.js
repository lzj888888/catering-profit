// review/evidence/r380/edge_probe.js —— 极端值巡检（引擎层，纯函数，无模拟器）
// 目的：0 / 空 / 极大 / 边界百分比 / 反向毛利 这些输入下，引擎会不会吐出 NaN、Infinity、
//   undefined、"¥0.00 假数"，或悄悄给出看似正常但方向错的结论。
// 用法： node review/evidence/r380/edge_probe.js
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const { calcSandbox, calcSandboxReverse } = require(path.join(ROOT, 'cloudfunctions/calcSandbox/service.js'));
const bom = require(path.join(ROOT, 'cloudfunctions/calcBom/service.js'));

function scan(v, p, out, depth) {
  if (depth > 6 || v == null) return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push([p, 'NONFINITE', String(v)]);
    else if (Object.is(v, -0)) out.push([p, 'NEGZERO', '-0']);
    return;
  }
  if (typeof v === 'string') {
    if (/NaN|Infinity|undefined/.test(v)) out.push([p, 'BADSTR', v]);
    return;
  }
  if (Array.isArray(v)) { v.slice(0, 40).forEach((x, i) => scan(x, p + '[' + i + ']', out, depth + 1)); return; }
  if (typeof v === 'object') Object.keys(v).forEach((k) => scan(v[k], p + '.' + k, out, depth + 1));
}

const M2BASE = {
  cityTier: 't1', bizType: 'fastfood',
  buildItems: [{ key: 'decor', fen: 12000000, years: 5 }],
  fixedItems: [{ key: 'rent', fen: 1200000 }, { key: 'labor', fen: 2000000 }],
  varItems: [],
  grossMarginPct: 60, targetProfitFen: 1000000, expectedRevenueFen: 4000000,
};

const M2 = [
  ['全零（毛利 0、无固定、无建店）', { cityTier: 't0', bizType: 'other', buildItems: [], fixedItems: [], varItems: [], grossMarginPct: 0, targetProfitFen: 0, expectedRevenueFen: 0 }],
  ['毛利 100%', Object.assign({}, M2BASE, { grossMarginPct: 100 })],
  ['毛利 0%', Object.assign({}, M2BASE, { grossMarginPct: 0 })],
  ['毛利 1%', Object.assign({}, M2BASE, { grossMarginPct: 1 })],
  ['毛利 99.99%', Object.assign({}, M2BASE, { grossMarginPct: 99.99 })],
  ['租金 0', Object.assign({}, M2BASE, { fixedItems: [{ key: 'rent', fen: 0 }, { key: 'labor', fen: 2000000 }] })],
  ['租金 1 亿', Object.assign({}, M2BASE, { fixedItems: [{ key: 'rent', fen: 10000000000 }, { key: 'labor', fen: 2000000 }] })],
  ['目标利润为负', Object.assign({}, M2BASE, { targetProfitFen: -1000000 })],
  ['实际营收为负', Object.assign({}, M2BASE, { expectedRevenueFen: -4000000 })],
  ['建店年限 0（不摊销）', Object.assign({}, M2BASE, { buildItems: [{ key: 'decor', fen: 12000000, years: 0 }] })],
  ['建店年限 100', Object.assign({}, M2BASE, { buildItems: [{ key: 'decor', fen: 12000000, years: 100 }] })],
];

const M3 = (lines, extra) => Object.assign({ mode: 'A', lines, lossPct: 0, auxFen: 0, priceFen: 3800, batchOutput: 0 }, extra || {});
const M3C = [
  ['空明细', M3([])],
  ['数量 0', M3([{ quantity: 0, net_unit_cost: 14500 }])],
  ['数量 极大 1e9', M3([{ quantity: 1e9, net_unit_cost: 14500 }])],
  ['净料成本 0', M3([{ quantity: 100, net_unit_cost: 0 }])],
  ['售价 0', M3([{ quantity: 100, net_unit_cost: 14500 }], { priceFen: 0 })],
  ['售价 < 成本', M3([{ quantity: 100, net_unit_cost: 14500 }], { priceFen: 100 })],
  ['损耗 100%', M3([{ quantity: 100, net_unit_cost: 14500 }], { lossPct: 100 })],
  ['批量产出 0（mode B）', M3([{ quantity: 100, net_unit_cost: 14500 }], { mode: 'B', batchOutput: 0 })],
  ['非法 mode', M3([{ quantity: 100, net_unit_cost: 14500 }], { mode: 'b' })],
];

let rows = [];
for (const [name, input] of M2) {
  let out, err = null;
  try { out = calcSandbox(input); } catch (e) { err = (e && (e.msg || e.message)) || String(e); }
  const bad = [];
  if (out) scan(out, 'm2', bad, 0);
  rows.push({ layer: 'M2', name, err, bad: bad.length, sample: bad.slice(0, 2),
    key: out ? { be: out.break_even_monthly, alert: out.red_alert, profit: out.operation_ref_profit } : null });
}
for (const [name, input] of M3C) {
  let out, err = null;
  try { out = bom.calcCostCard(input); } catch (e) { err = (e && (e.msg || e.message)) || String(e); }
  const bad = [];
  if (out) scan(out, 'm3', bad, 0);
  rows.push({ layer: 'M3', name, err, bad: bad.length, sample: bad.slice(0, 2),
    key: out ? { unitCost: out.unit_cost_fen, margin: out.gross_margin_pct, rev: out.reverse_price_fen } : null });
}

console.log('layer 场景                                err  非有限 明细 → 关键出参');
for (const r of rows) {
  console.log(
    r.layer.padEnd(5),
    r.name.padEnd(30),
    (r.err ? 'ERR' : '  - ').padEnd(4),
    String(r.bad).padEnd(4),
    JSON.stringify(r.key)
  );
  if (r.sample && r.sample.length) console.log('      ↳', JSON.stringify(r.sample));
}
const hard = rows.filter((r) => r.bad > 0);
console.log('\n非有限值总数：' + hard.length + ' 行');
process.exit(0);
