// tools/selftest_m3_per100g.js —— M3v1.2_B（D21/M3.31）「每100g」恒等规格自测（纯 node）
//
// require 生产单源（specDerive + calcBom 引擎），不复制逻辑、不写死期望值自证。
// 锚点（复用 v1.1 A-d 恒等锚点）：
//   全 1 系数 deriveSpec + calcCostCard ⇒ unit_cost_fen=975、material_total_fen=876（与全份一致）
// 反例：coef.main=0.5 ⇒ 结果 ≠ 975（派生确实生效）
// findPreset 键名严格：'per100g' 命中；'per100G' / 'per_100g' 不命中（不做模糊匹配）
//
// 运行：node tools/selftest_m3_per100g.js

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const { deriveSpec, findPreset } = require('../cloudfunctions/common/specDerive.js');
const { calcCostCard } = require('../cloudfunctions/calcBom/service.js');

// 宫保鸡丁明细行（净料单位成本 = 万分快照）
const lines = [
  { quantity: 200, net_unit_cost: 333, line_kind: 'main' },
  { quantity: 50, net_unit_cost: 200, line_kind: 'aux' },
  { quantity: 10, net_unit_cost: 400, line_kind: 'season' },
  { quantity: 30, net_unit_cost: 100, line_kind: 'semi' },
  { quantity: 20, net_unit_cost: 200, line_kind: 'pack' },
];
const auxFen = 50, lossPct = 5, priceFen = 2800;

console.log('===== A-d 恒等锚点（per100g 全 1 系数 = 全份）=====');
const per100g = findPreset('per100g');
check('findPreset(per100g) 非空', per100g !== null, per100g ? JSON.stringify(per100g.coef) : 'null');
const d1 = deriveSpec(lines, auxFen, per100g.coef);
const r1 = calcCostCard({ mode: 'A', lines: d1.lines, auxFen: d1.auxFen, lossPct, priceFen });
check('A-d 全1系数 unit_cost_fen = 975', r1.unit_cost_fen === 975, `got ${r1.unit_cost_fen}`);
check('A-d 全1系数 material_total_fen = 876', r1.material_total_fen === 876, `got ${r1.material_total_fen}`);

console.log('===== 反例（缩放系数派生确实生效）=====');
const scaledCoef = { main: 0.5, aux: 1, season: 1, semi: 1, pack: 1 };
const d2 = deriveSpec(lines, auxFen, scaledCoef);
const r2 = calcCostCard({ mode: 'A', lines: d2.lines, auxFen: d2.auxFen, lossPct, priceFen });
check('反例 coef.main=0.5 ⇒ unit_cost_fen ≠ 975（派生生效）', r2.unit_cost_fen !== 975, `got ${r2.unit_cost_fen}`);

console.log('===== findPreset 键名严格（不做模糊匹配）=====');
check("findPreset('per100g') 命中", findPreset('per100g') !== null, '');
check("findPreset('per100G') 返回 null", findPreset('per100G') === null, `got ${JSON.stringify(findPreset('per100G'))}`);
check("findPreset('per_100g') 返回 null", findPreset('per_100g') === null, `got ${JSON.stringify(findPreset('per_100g'))}`);

console.log('\n' + '='.repeat(60));
console.log(`===== M3v1.2_B per100g 自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
