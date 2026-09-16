// cloudfunctions/getCostCard/selftest.js —— 批次 3 · POC2 成本卡查询出参映射自测
// 运行： node cloudfunctions/getCostCard/selftest.js
const { cardToOutput, lineToOutput } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 成本卡版本行 → 出参
const card = { _id: 'row_v1', card_code: 'cc_xyz', version: 1, name: '宫保鸡丁', calc_mode: 1, loss_rate: 5, aux_cost: 50, price_list: 2800, total_cost: 975, material_total_fen: 876, gross_profit_fen: 1825, gross_margin_pct: 65.18, reverse_price_fen: 2438 };
const out = cardToOutput(card);
check('出参 card_code/version/total_cost_fen 正确', out.card_code === 'cc_xyz' && out.version === 1 && out.total_cost_fen === 975);
check('出参 calc_mode → A（合同形态）', out.calc_mode === 'A');
check('出参附带 lines 数组（默认空，由 Controller 装配）', Array.isArray(out.lines) && out.lines.length === 0);
check('calc_mode=2 映射为 B', cardToOutput({ ...card, calc_mode: 2 }).calc_mode === 'B');

// 明细行含净料单位成本快照
const line = { material_id: 'ji', material_name: '鸡胸肉', quantity: 200, net_unit_cost: 333, line_net_cost: 666 };
const lout = lineToOutput(line);
check('明细行出参含 net_unit_cost=333 快照', lout.net_unit_cost === 333, `=${lout.net_unit_cost}`);
check('明细行出参 line_net_cost_fen=666', lout.line_net_cost_fen === 666, `=${lout.line_net_cost_fen}`);
check('validateInput 无 card_code 放行（列表模式）', validateInput({ shop_id: 's1' }).error === null);
check('validateInput 带 card_code 放行（详情模式）', validateInput({ shop_id: 's1', card_code: 'cc_xyz' }).card_code === 'cc_xyz');

console.log(`\n==== getCostCard 批次 3 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);