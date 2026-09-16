// cloudfunctions/getCardVersions/selftest.js —— 批次 4 · M3 成本卡版本历史（读）自测（R57 补齐）
// 运行： node cloudfunctions/getCardVersions/selftest.js
//
// 背景：此前无 selftest。本函数返回某 card_code 的**全部历史版本**（倒序）+ 每版明细快照。
//   ① 出参映射契约：cardToOut / lineToOut（snake_case；`calc_mode 2 → 'B'`；缺字段取默认）
//   ② 🔴 跨函数同口径：getCardVersions.cardToOut ≡ getCostCard.cardToOutput（逐字段）——两处注释都写
//      "与 getCostCard/service.js 同口径"，此处把它变成机器断言（防一侧改动另一侧漂移）
//   ③ 入参面：shop_id + card_code 均必填
//   ④ 静态形状守卫：版本倒序 / 明细按 sort_order 排序 / 只读不写

const fs = require('fs');
const path = require('path');
const { cardToOut, lineToOut } = require('./service');
const costCard = require('../getCostCard/service');
const { validateInput } = require('./validate');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const FULL_DOC = {
  card_code: 'C001', version: 3, name: '宫保鸡丁', category: '热菜', tags: '招牌',
  calc_mode: 2, batch_output: 2, loss_rate: 12, aux_cost: 150, price_list: 2438,
  total_cost: 975, material_total_fen: 825, gross_profit_fen: 1463, gross_margin_pct: 60.01,
  reverse_price_fen: 2438, created_at: 1758000000000, _id: 'row_x',
};

console.log('===== 1. cardToOut 映射契约 =====');
const o = cardToOut(FULL_DOC);
check('card_code / version / name 原样', o.card_code === 'C001' && o.version === 3 && o.name === '宫保鸡丁');
check('🔴 calc_mode 2 → "B"（BOM 两层模式）', o.calc_mode === 'B');
check('calc_mode 1 → "A"（单层）', cardToOut({ ...FULL_DOC, calc_mode: 1 }).calc_mode === 'A');
check('calc_mode 缺省 → "A"（默认单层）', cardToOut({ ...FULL_DOC, calc_mode: undefined }).calc_mode === 'A');
check('字段重命名：aux_cost → aux_fen', o.aux_fen === 150);
check('字段重命名：price_list → price_fen（售价 24.38 元 = 2438 分）', o.price_fen === 2438);
check('字段重命名：total_cost → total_cost_fen（宫保锚点 975 分）', o.total_cost_fen === 975);
check('金额一律整数分', [o.aux_fen, o.price_fen, o.total_cost_fen, o.material_total_fen, o.gross_profit_fen].every(Number.isInteger));
check('批次产出 batch_output 保留 null 语义（单份卡可为 null）', cardToOut({ ...FULL_DOC, batch_output: null }).batch_output === null);
check('batch_output 缺省 → null（不误判为 0）', cardToOut({ ...FULL_DOC, batch_output: undefined }).batch_output === null);
check('loss_rate 缺省 → 0', cardToOut({ ...FULL_DOC, loss_rate: undefined }).loss_rate === 0);
check('version 缺省 → 1（只 INSERT 模型下的首版）', cardToOut({ card_code: 'C' }).version === 1);
check('lines 初始为空数组（明细另行装配，防重复装配）', Array.isArray(o.lines) && o.lines.length === 0);
check('未知字段不外泄（出参键集固定）', !('_id' in o), `keys=${Object.keys(o).length}`);

console.log('===== 2. lineToOut 映射契约 =====');
const l = lineToOut({ material_id: 'm1', material_name: '鸡腿肉', quantity: 250, net_unit_cost: 4480, line_net_cost: 1120 });
check('material_id/name/quantity 原样', l.material_id === 'm1' && l.material_name === '鸡腿肉' && l.quantity === 250);
check('🔴 net_unit_cost 为**万分快照**（4480 = 4 位小数精度，非分）', l.net_unit_cost === 4480);
check('字段重命名：line_net_cost → line_net_cost_fen（单份 448 分锚点）', lineToOut({ material_id: 'm', line_net_cost: 448 }).line_net_cost_fen === 448);
check('缺字段 → 0（不产生 undefined）', lineToOut({}).quantity === 0 && lineToOut({}).net_unit_cost === 0 && lineToOut({}).line_net_cost_fen === 0);

console.log('===== 3. 🔴 跨函数同口径（getCardVersions ≡ getCostCard）=====');
const DOCS = [FULL_DOC, { ...FULL_DOC, calc_mode: 1, batch_output: undefined }, { card_code: 'C002' }, { ...FULL_DOC, tags: undefined, category: undefined }];
for (let i = 0; i < DOCS.length; i++) {
  const a = cardToOut(DOCS[i]);
  const b = costCard.cardToOutput(DOCS[i]);
  const diff = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  check(`[doc${i}] cardToOut ≡ getCostCard.cardToOutput（逐字段 ${Object.keys(b).length} 项）`, diff.length === 0, diff.length ? '不一致: ' + diff.join(',') : '');
}
const LINES = [{ material_id: 'm1', material_name: 'x', quantity: 250, net_unit_cost: 4480, line_net_cost: 1120 }, {}];
for (let i = 0; i < LINES.length; i++) {
  const a = lineToOut(LINES[i]);
  const b = costCard.lineToOutput(LINES[i]);
  const diff = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  check(`[line${i}] lineToOut ≡ getCostCard.lineToOutput（逐字段）`, diff.length === 0, diff.length ? '不一致: ' + diff.join(',') : '');
}

console.log('===== 4. 入参面 =====');
check('合法入参放行', validateInput({ shop_id: 's1', card_code: 'C001' }).error === null);
check('card_code 缺失 → 拒（本函数按 card_code 查历史）', validateInput({ shop_id: 's1' }).error === ERROR_CODES.INVALID_PARAM);
check('card_code 空串 → 拒', validateInput({ shop_id: 's1', card_code: '' }).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 缺失 → 拒', validateInput({ card_code: 'C001' }).error === ERROR_CODES.INVALID_PARAM);
check('event 为 null → 拒', validateInput(null).error === ERROR_CODES.INVALID_PARAM);
check('支持 { input: {...} } 包裹层', validateInput({ input: { shop_id: 's1', card_code: 'C9' } }).card_code === 'C9');
check('错误码 = INVALID_PARAM（全局标准码）', ERROR_CODES.INVALID_PARAM === 'INVALID_PARAM');

console.log('===== 5. 静态形状守卫 =====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const body = src.slice(src.indexOf('exports.main'));
const at = (s) => body.indexOf(s);
check('顺序：resolveAuth → assertShopOwner → validateInput', at('resolveAuth') < at('assertShopOwner') && at('assertShopOwner') < at('validateInput'));
check('按 shop_id + card_code 双条件查（防跨店串号）', /da\.list\('shop_cost_card',\s*\{\s*shop_id:\s*shopId,\s*card_code:\s*v\.card_code\s*\}\)/.test(body));
check('🔴 版本倒序（b.version − a.version）', /\(b\.version\s*\|\|\s*0\)\s*-\s*\(a\.version\s*\|\|\s*0\)/.test(body));
check('🔴 明细按 sort_order 升序（与录入顺序一致）', /\(a\.sort_order\s*\|\|\s*0\)\s*-\s*\(b\.sort_order\s*\|\|\s*0\)/.test(body));
check('明细按 cost_card_row_id 关联（每版各装配自己的明细）', /cost_card_row_id:\s*card\._id/.test(body));
check('🔴 只读：无 update/remove/set 调用（版本不可改写）', !/\.update\(|\.remove\(|\.set\(/.test(body));
check('出参带 card_code 回显（前端可校验）', /card_code:\s*v\.card_code/.test(body));

console.log(`\n==== getCardVersions 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
