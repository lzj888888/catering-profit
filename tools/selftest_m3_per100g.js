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

const { deriveSpec, findPreset, per100gFactor, uniformCoef, portionOf, sanitizeSpecs } = require('../cloudfunctions/common/specDerive.js');
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

// ===== B 组（R547 / 审计 M1）：份量换算 =====
// 为什么这组必须存在：A-d 组证明的是「系数全 1 ⇒ 与全份一致」，而那个"一致"正是**缺陷本身** ——
//   per100g 的售价是「元/100g」，成本却按整份算 ⇒ 毛利率被大幅低估。
//   B 组用**生产单源**（per100gFactor / uniformCoef / calcCostCard）复现真实链路，并给出可对照的一对数：
//   同一张卡、同一个每100g售价，换算后 82.35% vs 不换算 11.76%（审计原文的量级）。
console.log('===== B 组 · 份量换算（per100g 成本 = 整份 × 100 ÷ 克重）=====');
check('B-1 per100gFactor(500) = 0.2（100÷500）', Math.abs(per100gFactor(500) - 0.2) < 1e-12, `got ${per100gFactor(500)}`);
check('B-2 uniformCoef(0.2) 五项皆 0.2（均匀缩放）',
  ['main', 'aux', 'season', 'semi', 'pack'].every((k) => uniformCoef(0.2)[k] === 0.2), '');
// 生产链路：克重 500 ⇒ 100g 成本 ≈ 975 × 0.2 = 195（派生逐行 round，允许 ±1 分）
const dPer = deriveSpec(lines, auxFen, uniformCoef(per100gFactor(500)));
const rPer = calcCostCard({ mode: 'A', lines: dPer.lines, auxFen: dPer.auxFen, lossPct, priceFen: 1105, targetMarginPct: 60 });
check('B-3 克重500 ⇒ 100g 成本 ≈ 195 分（整份 975 × 20%，±1 分）',
  Math.abs(rPer.unit_cost_fen - 195) <= 1 && rPer.unit_cost_fen !== r1.unit_cost_fen, `got ${rPer.unit_cost_fen}`);
check('B-4 按 100g 售价 11.05 元 ⇒ 毛利率 ≈ 82.35%（真值）',
  Math.abs(rPer.gross_margin_pct - 82.35) < 0.02, `got ${rPer.gross_margin_pct}`);
// 反证：不换算（按整份成本）会算成 11.76% —— 与审计量级一致，证明本组断言有分辨力
const rNoConv = calcCostCard({ mode: 'A', lines, auxFen, lossPct, priceFen: 1105, targetMarginPct: 60 });
check('B-5 反证：不换算（整份成本 975）⇒ 毛利率 11.76%（正是本缺陷）',
  Math.abs(rNoConv.gross_margin_pct - 11.76) < 0.02, `got ${rNoConv.gross_margin_pct}`);
check('B-6 换算与不换算的差 = 70.59 个百分点（不是数值毛刺）',
  Math.abs((rPer.gross_margin_pct - rNoConv.gross_margin_pct) - 70.59) < 0.03,
  `got ${(rPer.gross_margin_pct - rNoConv.gross_margin_pct).toFixed(2)}`);
// 边界：克重 100 ⇒ 系数 1 ⇒ 与整份逐分相同（换算是"恒等"的超集，不是另一套算法）
check('B-7 克重=100 ⇒ 系数 1 ⇒ 成本 ≡ 975（边界不漂移）',
  per100gFactor(100) === 1 && calcCostCard({ mode: 'A', lines: deriveSpec(lines, auxFen, uniformCoef(1)).lines, auxFen, lossPct, priceFen }).unit_cost_fen === 975, '');
// fail-closed：克重缺失/非法 ⇒ 0（调用方据此**不给数**，绝不回落成"按整份算"）
check('B-8 克重缺失/非法 ⇒ factor=0（fail-closed，不回落整份）',
  portionOf(0) === 0 && portionOf('') === 0 && portionOf(-5) === 0 && portionOf('abc') === 0 && portionOf(null) === 0,
  `0→${per100gFactor(0)} 'abc'→${per100gFactor('abc')}`);
check('B-9 克重超上界 100000g ⇒ factor=0（防把 250 敲成 2500000）', per100gFactor(2500000) === 0, '');

console.log('===== C 组 · 克重随规格快照落库（sanitizeSpecs）=====');
const sp1 = sanitizeSpecs([{ spec_key: 'per100g', price_fen: 340, portion_g: 500 }]);
check('C-1 portion_g 500 被保留（算 100g 成本的唯一依据）', sp1.error === null && sp1.value[0].portion_g === 500,
  sp1.error || JSON.stringify(sp1.value[0]));
check('C-2 没填克重 ⇒ 存 0（不是 null/undefined，读侧一致）',
  sanitizeSpecs([{ spec_key: 'per100g', price_fen: 340 }]).value[0].portion_g === 0, '');
check('C-3 克重 ≤0 必须报错（不许静默按整份算）',
  !!sanitizeSpecs([{ spec_key: 'per100g', price_fen: 340, portion_g: 0 }]).error, '');
check('C-4 非 per100g 规格忽略 portion_g（存 0，不让它污染半份/小份）',
  sanitizeSpecs([{ spec_key: 'half', price_fen: 2000, portion_g: 500 }]).value[0].portion_g === 0, '');

console.log('\n' + '='.repeat(60));
console.log(`===== M3v1.2_B per100g 自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
