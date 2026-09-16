// cloudfunctions/syncCostCard/selftest.js —— 批次 3 · POC2 同步至原料最新价（另存新版本）自测
// 运行： node cloudfunctions/syncCostCard/selftest.js
const { rebuildSnapshotLines, calcCostCard, cardParamFromDoc, netUnitCostWan } = require('./service');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 旧版宫保（v1）明细行（保存时快照：鸡胸肉 333）
const existingLines = [
  { material_id: 'ji', quantity: 200, material_name: '鸡胸肉' },
  { material_id: 'hua', quantity: 50, material_name: '花生米' },
  { material_id: 'gan', quantity: 10, material_name: '干辣椒' },
  { material_id: 'cong', quantity: 30, material_name: '葱姜蒜' },
  { material_id: 'you', quantity: 20, material_name: '调料油' },
];
// 原料当前价：鸡胸肉已涨到 20 元/斤（444），其余不变
const mats = new Map([
  ['ji',    { id: 'ji',    name: '鸡胸肉', net_unit_cost: netUnitCostWan(2000, 500, 90) }], // 444
  ['hua',   { id: 'hua',   name: '花生米', net_unit_cost: netUnitCostWan(1000, 500, 100) }],
  ['gan',   { id: 'gan',   name: '干辣椒', net_unit_cost: netUnitCostWan(2000, 500, 100) }],
  ['cong',  { id: 'cong',  name: '葱姜蒜', net_unit_cost: netUnitCostWan(500, 500, 100) }],
  ['you',   { id: 'you',   name: '调料油', net_unit_cost: netUnitCostWan(1000, 500, 100) }],
]);

const newLines = rebuildSnapshotLines(existingLines, mats);
check('重算快照：鸡胸肉取**当前**444（不是旧333）', newLines.find((l) => l.material_id === 'ji').net_unit_cost === 444);
const latestDoc = { calc_mode: 1, loss_rate: 5, aux_cost: 50, price_list: 2800, batch_output: null };
const p = cardParamFromDoc(latestDoc);
const res = calcCostCard({ mode: p.mode, lines: newLines, auxFen: p.auxFen, lossPct: p.lossPct, batchOutput: p.batchOutput, priceFen: p.priceFen });
check('🏆 同步后新版本总成本 = 12.08（1208分）', res.unit_cost_fen === 1208, `=${res.unit_cost_fen}分`);
check('新版本明细合计 = 10.98（1098分）', res.material_total_fen === 1098, `=${res.material_total_fen}分`);

// 版本递增语义：latestDoc 的 version 语义由 Controller 保证（只 INSERT，取 max+1）
check('cardParamFromDoc 正确解析模式 A', p.mode === 'A' && p.lossPct === 5 && p.auxFen === 50 && p.priceFen === 2800);

console.log(`\n==== syncCostCard 批次 3 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);