// cloudfunctions/saveMaterial/selftest.js —— 批次 3 · POC2 原料档案自测（净料单位成本 + 校验）
// 运行： node cloudfunctions/saveMaterial/selftest.js
const { netUnitCostWan } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 净料单位成本（万分）
check('鸡胸肉 15元/斤 出成率90% → 万分333',
  netUnitCostWan(1500, 500, 90) === 333, `=${netUnitCostWan(1500, 500, 90)}`);
check('鸡胸肉改 20元/斤 → 万分444（价变只会影响**新**快照）',
  netUnitCostWan(2000, 500, 90) === 444, `=${netUnitCostWan(2000, 500, 90)}`);
check('红油底料每份 4.48 元 → 万分44800（虚拟，换算系数=1，单位=份）语义',
  netUnitCostWan(448, 1, 100) === 44800, `=${netUnitCostWan(448, 1, 100)}`);

// 校验
const okMat = { shop_id: 's1', material: { name: '鸡胸肉', purchase_price_fen: 1500, convert_factor: 500, yield_rate: 90 } };
check('合法原料放行', validateInput(okMat).error === null);
check('purchase_price_fen 为字符串"1500" → INVALID_PARAM',
  validateInput({ shop_id: 's1', material: { name: 'x', purchase_price_fen: '1500', convert_factor: 500, yield_rate: 90 } }).error === 'INVALID_PARAM');
check('convert_factor=0 → INVALID_PARAM',
  validateInput({ shop_id: 's1', material: { name: 'x', purchase_price_fen: 100, convert_factor: 0, yield_rate: 90 } }).error === 'INVALID_PARAM');
check('yield_rate=101 → INVALID_PARAM',
  validateInput({ shop_id: 's1', material: { name: 'x', purchase_price_fen: 100, convert_factor: 1, yield_rate: 101 } }).error === 'INVALID_PARAM');
check('缺 shop_id → INVALID_PARAM', validateInput({ material: { name: 'x', purchase_price_fen: 100, convert_factor: 1, yield_rate: 90 } }).error === 'INVALID_PARAM');

console.log(`\n==== saveMaterial 批次 3 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);