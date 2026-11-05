// cloudfunctions/getCostCard/selftest.js —— 批次 3 · POC2 成本卡查询出参映射自测
// 运行： node cloudfunctions/getCostCard/selftest.js
const { cardToOutput, lineToOutput, groupLinesByCard } = require('./service');
const { validateInput } = require('./validate');
const { resolveEffectiveCards, resolveEffectiveCard, assessCardTrust } = require('./resolve');

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

// ===== G 组（R547 / 审计 M6）：批量分组 ≡ 逐卡查询 =====
// 判据是**行为对拍**：同一份明细行，用「逐卡 where 查」算出的每卡 lines 与 groupLinesByCard
// 内存分组的结果逐卡全等（含条数与顺序）。改前 Controller 是逐卡查，改后一次取全 ⇒ 必须证明等价。
console.log('===== G 组 · 明细行批量分组对拍（M6）=====');
const allRows = [
  { _id: 'l1', cost_card_row_id: 'row_a', material_name: '鸡胸肉', quantity: 200, net_unit_cost: 333 },
  { _id: 'l2', cost_card_row_id: 'row_b', material_name: '花生', quantity: 50, net_unit_cost: 120 },
  { _id: 'l3', cost_card_row_id: 'row_a', material_name: '黄瓜', quantity: 30, net_unit_cost: 80 },
  { _id: 'l4', cost_card_row_id: 'row_c', material_name: '辣椒', quantity: 10, net_unit_cost: 200 },
  { _id: 'l5', cost_card_row_id: 'row_a', material_name: '葱', quantity: 15, net_unit_cost: 60 },
];
const grouped = groupLinesByCard(allRows);
// 逐卡 where 查（原实现语义：按 cost_card_row_id 过滤，保持库顺序）
const oneCard = (rid) => allRows.filter((x) => x.cost_card_row_id === rid).map(lineToOutput);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('G-1 卡 row_a 分组 ≡ 逐卡查（3 行，含顺序）', same(grouped.get('row_a'), oneCard('row_a')),
  `got ${(grouped.get('row_a') || []).length} 行`);
check('G-2 卡 row_b 分组 ≡ 逐卡查（1 行）', same(grouped.get('row_b'), oneCard('row_b')),
  `got ${(grouped.get('row_b') || []).length} 行`);
check('G-3 卡 row_c 分组 ≡ 逐卡查（1 行）', same(grouped.get('row_c'), oneCard('row_c')),
  `got ${(grouped.get('row_c') || []).length} 行`);
check('G-4 不跨卡串行（row_a 里没有 row_b 的花生）',
  (grouped.get('row_a') || []).every((l) => l.material_name !== '花生'), '');
check('G-5 无行卡的取值为 undefined（Controller 用 `|| []` 兜底 ⇒ 空数组，不是 null）',
  grouped.get('row_missing') === undefined, String(grouped.get('row_missing')));
// 孤儿行（缺 cost_card_row_id）必须丢弃 —— 否则会掉进 undefined 桶，被某张卡误读
const gOrphan = groupLinesByCard([{ _id: 'x', material_name: '孤儿' }].concat(allRows));
check('G-6 缺 cost_card_row_id 的行被丢弃（不会聚成一个"无主"桶）', gOrphan.size === 3, `size=${gOrphan.size}`);
check('G-7 空输入 ⇒ 空 Map（空店不炸）', groupLinesByCard([]).size === 0 && groupLinesByCard(null).size === 0, '');

// ===== H 组（P0-0 护栏 · 2026-10-29）：resolveEffectiveCards / assessCardTrust =====
console.log('===== H 组 · 解析生效卡单一入口（连锁后期零返工前提）=====');
const docs = [
  { _id: 'r1', card_code: 'A', version: 1, name: '宫保鸡丁 v1' },
  { _id: 'r2', card_code: 'A', version: 3, name: '宫保鸡丁 v3' }, // 同 code 取最大版本
  { _id: 'r3', card_code: 'B', version: 2, name: '鱼香肉丝' },
  { _id: 'r4', card_code: 'A', version: 2, name: '宫保鸡丁 v2' }, // 被 v3 盖过
  { card_code: '', version: 1, name: '缺 code 应丢弃' },            // 缺 code 丢弃
];
const byCode = resolveEffectiveCards(docs, 'shop_x');
check('H-1 按 card_code 取最新版本（A=v3）', byCode.get('A') && byCode.get('A').version === 3, `A=${byCode.get('A') && byCode.get('A').version}`);
check('H-2 同 code 旧版本被覆盖（A 不含 v1/v2）', byCode.get('A')._id === 'r2');
check('H-3 不同 code 互不影响（B=v2 仍在）', byCode.get('B') && byCode.get('B').card_code === 'B');
check('H-4 缺 card_code 的行被丢弃', byCode.size === 2, `size=${byCode.size}`);
check('H-5 空输入 ⇒ 空 Map（不炸）', resolveEffectiveCards([]).size === 0 && resolveEffectiveCards(null).size === 0);
check('H-6 详情模式取单卡', resolveEffectiveCard(docs, 'shop_x', 'B')._id === 'r3');
check('H-7 详情模式取不存在的卡 ⇒ null', resolveEffectiveCard(docs, 'shop_x', 'Z') === null);

console.log('===== H2 组 · fail-closed 可信度评估（禁止凑数算毛利）=====');
const goodLines = [{ quantity: 200, net_unit_cost: 333 }];
const emptyLines = [];
const badLines = [{ quantity: 0, net_unit_cost: 0 }]; // 用量/成本全 0 ⇒ 不可信
check('H2-1 有有效行 ⇒ 可信', assessCardTrust({ card_code: 'A' }, goodLines).trustworthy === true);
check('H2-2 无任何明细行 ⇒ 不可信 + 缺「明细行」', (() => { const r = assessCardTrust({ card_code: 'A' }, emptyLines); return !r.trustworthy && r.missing.includes('明细行'); })());
check('H2-3 全 0 行 ⇒ 不可信 + 缺「有效用量/成本」', (() => { const r = assessCardTrust({ card_code: 'A' }, badLines); return !r.trustworthy && r.missing.includes('有效用量/成本'); })());

console.log(`\n==== getCostCard 全自测结果：${pass} 通过 / ${failN} 失败 ====`);