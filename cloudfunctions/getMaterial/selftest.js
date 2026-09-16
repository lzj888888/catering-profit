// cloudfunctions/getMaterial/selftest.js —— 批次 3 · POC2 原料档案出参映射自测
// 运行： node cloudfunctions/getMaterial/selftest.js
const { docToOutput, netUnitCostWan } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 普通原料：net_unit_cost=万分333 → unit_cost_fen=round(333/100)=3（0.03 元）
const doc = { id: 'mat_1', name: '鸡胸肉', purchase_price: 1500, convert_factor: 500, yield_rate: 90, net_unit_cost: 333, is_virtual: false };
const out = docToOutput(doc);
check('出参 id / name / is_virtual 正确', out.id === 'mat_1' && out.name === '鸡胸肉' && out.is_virtual === false);
check('出参净料单位成本=333（万分，未丢失精度）', out.net_unit_cost === 333, `=${out.net_unit_cost}`);
check('出参 unit_cost_fen=3（333万分→3分）', out.unit_cost_fen === 3, `=${out.unit_cost_fen}`);
// 虚拟半成品：每份成本 4.48 元 = 44800 万分 → unit_cost_fen=448（4.48 元）
const vdoc = { id: 'vm_1', name: '红油底料', purchase_unit: '份', is_virtual: true, net_unit_cost: 44800 };
const vout = docToOutput(vdoc);
check('虚拟半成品(份) unit_cost_fen=448', vout.unit_cost_fen === 448 && vout.is_virtual === true, `=${vout.unit_cost_fen}`);
check('netUnitCostWan 聚能一致性(鸡胸 444)', netUnitCostWan(2000, 500, 90) === 444);
check('validateInput 合法', validateInput({ shop_id: 's1' }).error === null);
check('validateInput is_virtual 非布尔拒', validateInput({ shop_id: 's1', is_virtual: 'yes' }).error === 'INVALID_PARAM');

console.log(`\n==== getMaterial 批次 3 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);