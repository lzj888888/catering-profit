// tools/selftest_m3_impact.js —— M3.19 原料变动与影响面自测（批次 E）
//
// 锚点（规范 v1.1 §M3.19，require 真实引擎实算，不重写、不写死期望值自证）：
//   C-a  鸡胸肉 15→20 元/斤 ⇒ 宫保 975→1208 分，毛利率 65.18%→56.86%（未破 55%）
//   C-a2 鸡胸肉 15→25 元/斤 ⇒ 宫保 1444 分，毛利率 48.43% ⇒ 跌破 55%（below_band === true）
//   C-b  未挂牌价（priceFen=0）⇒ 毛利率不可算：引擎返 0、裸比较必误标 ⇒ dry-run 必须 `noPrice` 抑制
//        （与同批 utils/reconDerive.js 的 no_price 口径对齐；R181j 门禁方验收补）
//   dry_run 零写库（静态扫 syncCostCard/index.js 的 dry_run 分支，断言无 insert/update/remove/add）
//
// 运行：node tools/selftest_m3_impact.js

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// —— require 生产引擎（同一份 rebuildSnapshotLines / calcCostCard，只调用不修改）——
const { rebuildSnapshotLines, calcCostCard } = require('../cloudfunctions/syncCostCard/service.js');

// 宫保鸡丁明细行（净料单位成本为「万分」快照；鸡胸肉 15 元/斤 ⇒ 333 万分）
function gongbaoLines() {
  return [
    { material_id: 'mat_chicken', material_name: '鸡胸肉', quantity: 200, net_unit_cost: 333, input_type: 1, brand_spec: '', purchase_unit: '斤', purchase_price: 1500, convert_factor: 500, yield_rate: 90 },
    { material_id: 'mat_peanut', material_name: '花生米', quantity: 50, net_unit_cost: 200, input_type: 1, brand_spec: '', purchase_unit: '斤', purchase_price: 1000, convert_factor: 500, yield_rate: 100 },
    { material_id: 'mat_chili', material_name: '干辣椒', quantity: 10, net_unit_cost: 400, input_type: 1, brand_spec: '', purchase_unit: '斤', purchase_price: 2000, convert_factor: 500, yield_rate: 100 },
    { material_id: 'mat_aroma', material_name: '葱姜蒜', quantity: 30, net_unit_cost: 100, input_type: 1, brand_spec: '', purchase_unit: '斤', purchase_price: 500, convert_factor: 500, yield_rate: 100 },
    { material_id: 'mat_oil', material_name: '调料油', quantity: 20, net_unit_cost: 200, input_type: 1, brand_spec: '', purchase_unit: '斤', purchase_price: 1000, convert_factor: 500, yield_rate: 100 },
  ];
}

// 原料当前净料成本（mat_chicken 按传入的万分值；其余不变）
function matsByChicken(chickenWan) {
  return new Map([
    ['mat_chicken', { net_unit_cost: chickenWan, name: '鸡胸肉' }],
    ['mat_peanut', { net_unit_cost: 200, name: '花生米' }],
    ['mat_chili', { net_unit_cost: 400, name: '干辣椒' }],
    ['mat_aroma', { net_unit_cost: 100, name: '葱姜蒜' }],
    ['mat_oil', { net_unit_cost: 200, name: '调料油' }],
  ]);
}

const AUX = 50, LOSS = 5, PRICE = 2800;

// 旧成本（鸡胸肉 333 万分 = 15 元/斤）
const oldResult = calcCostCard({ mode: 'A', lines: gongbaoLines(), auxFen: AUX, lossPct: LOSS, priceFen: PRICE });
check('C 旧成本 = 975 分（鸡胸肉 15 元/斤）', oldResult.unit_cost_fen === 975, `got ${oldResult.unit_cost_fen}`);
check('C 旧毛利率 = 65.18%（(2800−975)/2800）', Math.abs(oldResult.gross_margin_pct - 65.18) < 0.005, `got ${oldResult.gross_margin_pct}`);

console.log('===== C-a · 鸡胸肉 15 → 20 元/斤 =====');
const c20Mats = matsByChicken(444);   // 20 元/斤 ⇒ 444 万分
const c20Lines = rebuildSnapshotLines(gongbaoLines(), c20Mats);
const c20 = calcCostCard({ mode: 'A', lines: c20Lines, auxFen: AUX, lossPct: LOSS, priceFen: PRICE });
check('C-a 新成本 = 1208 分（15→20）', c20.unit_cost_fen === 1208, `got ${c20.unit_cost_fen}`);
check('C-a 新毛利率 = 56.86%（(2800−1208)/2800）', Math.abs(c20.gross_margin_pct - 56.86) < 0.005, `got ${c20.gross_margin_pct}`);
check('C-a 未跌破 55% 下限（56.86 ≥ 55）', c20.gross_margin_pct >= 55, '');
check('C-a 掉 8.32pp（65.18 − 56.86）', Math.abs((oldResult.gross_margin_pct - c20.gross_margin_pct) - 8.32) < 0.01, `got ${(oldResult.gross_margin_pct - c20.gross_margin_pct).toFixed(2)}`);

console.log('===== C-a2 · 鸡胸肉 15 → 25 元/斤 =====');
const c25Mats = matsByChicken(556);   // 25 元/斤 ⇒ 556 万分
const c25Lines = rebuildSnapshotLines(gongbaoLines(), c25Mats);
const c25 = calcCostCard({ mode: 'A', lines: c25Lines, auxFen: AUX, lossPct: LOSS, priceFen: PRICE });
check('C-a2 新成本 = 1444 分（15→25）', c25.unit_cost_fen === 1444, `got ${c25.unit_cost_fen}`);
check('C-a2 新毛利率 = 48.43%（(2800−1444)/2800）', Math.abs(c25.gross_margin_pct - 48.43) < 0.005, `got ${c25.gross_margin_pct}`);
const bandFloor = 55;   // 正餐 dining.grossMargin 下限（indicatorRef.BANDS.dining.grossMargin[0]）
check('C-a2 跌破 55% ⇒ below_band === true', c25.gross_margin_pct < bandFloor, `48.43 < ${bandFloor}`);

console.log('===== dry_run 零写库（静态扫 syncCostCard/index.js）=====');
const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'syncCostCard', 'index.js'), 'utf8');
// 提取 dry_run 分支（从 `if (v.dry_run) {` 到配平的花括号）
const start = idxSrc.indexOf('if (v.dry_run) {');
check('dry_run 分支存在', start >= 0, '');
let branch = '';
if (start >= 0) {
  const b0 = idxSrc.indexOf('{', start);
  let depth = 0, end = -1;
  for (let k = b0; k < idxSrc.length; k++) {
    if (idxSrc[k] === '{') depth++;
    else if (idxSrc[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  branch = idxSrc.slice(start, end + 1);
  const writes = [];
  if (/da\.insert\(/.test(branch)) writes.push('da.insert');
  if (/\.doc\([^)]*\)\.update\(/.test(branch)) writes.push('doc.update');
  if (/\.doc\([^)]*\)\.remove\(/.test(branch)) writes.push('doc.remove');
  if (/collection\([^)]*\)\.add\(/.test(branch)) writes.push('collection.add');
  // ⚠️ Map 的 .set（materialsById.set / latestByCode.set）不是写库，必须排除 —— 只认上述 DB 写方法。
  check('dry_run 分支零写库（无 da.insert / doc.update / doc.remove / collection.add）', writes.length === 0,
    writes.length ? `命中写方法：${writes.join(', ')}` : '分支只含 da.get / da.list / da.listAll 读操作 + 内存 Map.set');
  // 反向：分支里确实有读操作（防「分支被删空」假绿）
  check('dry_run 分支确有读操作（da.listAll 兜底取全卡）', /da\.listAll\(/.test(branch), '');
}

console.log('===== C-b · 未挂牌价（priceFen=0）⇒ 毛利率不可算、below_band 必须抑制 =====');
// 【引擎事实】priceFen=0 时 calcCostCard 返回 gross_margin_pct = 0（数字，不是 null）——
//   实测 B-a 段同理。⇒「不可算」的判定只能在上层（dry-run 分支）做，引擎不管这件事。
const zeroPrice = calcCostCard({ mode: 'A', lines: gongbaoLines(), auxFen: AUX, lossPct: LOSS, priceFen: 0 });
check('C-b[引擎事实] priceFen=0 ⇒ gross_margin_pct 为数字 0（非 null）',
  zeroPrice.gross_margin_pct === 0 && typeof zeroPrice.gross_margin_pct === 'number',
  `got ${JSON.stringify(zeroPrice.gross_margin_pct)}`);
// 【反证】既然它是 0，裸比较 `newResult.gross_margin_pct < bandFloor` 恒为 true
//   ⇒ 会把「还没定价的卡」误标成「已跌破参考带下限」。
//   ⚠️ priceFen=0 合法（saveCostCard/validate.js:116 只要求非负）⇒ 该状态真实可达。
check('C-b[反证] 0 < 55 成立 ⇒ 裸比较必然误标 below_band', (zeroPrice.gross_margin_pct < bandFloor) === true,
  '0 < 55 ⇒ 若不抑制，未定价卡会被报成"跌破"');
// 【dry-run 抑制】静态锁住修法（防止被人改回裸比较）
check('C-b[dry-run] 分支含 noPrice 判定（未挂牌价 ⇒ 不可算）', /noPrice\s*=/.test(branch), '');
check('C-b[dry-run] below_band 形如 `!noPrice && …`（不许裸比较）',
  /below_band:\s*!noPrice\s*&&/.test(branch), '');
check('C-b[dry-run] new_gross_margin_pct 形如 `noPrice ? null : …`（与 reconDerive 的 no_price 同口径）',
  /new_gross_margin_pct:\s*noPrice\s*\?\s*null\s*:/.test(branch), '');

console.log('\n' + '='.repeat(60));
console.log(`===== M3.19 影响面自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
