// cloudfunctions/saveDishMapping/selftest.js —— R255 菜名映射写侧自测
// 运行： node cloudfunctions/saveDishMapping/selftest.js
//
// 范式（R57 立约）：纯函数层（service.js / validate.js）行为断言。
//   `index.js` 含 require('wx-server-sdk') ⇒ 纯 node 加载不了 ⇒ 由 tools/check_dish_mapping_write.js
//   做「源码形状断言」（鉴权 / 付费墙 / 限流 / 幂等 / 卡存在性的**位置与返回形态**）。
//
// 🔴 本文件的头号使命 = 钉死「写侧键 ≡ 读侧键」。
//    读侧 `getDishReview/index.js` 构造 mapIndex.set(platform + '|' + external_ref_id, card_code)，
//    查询走 mapIndex.get(p + '|' + k) || mapIndex.get('|' + k) || ''。
//    写侧只要有一侧错位（归一了 / 没 trim / 分隔符改了），用户挂了映射页面照旧 unmatched，
//    而且**不报错** ⇒ 是「死输入」，比报错更坏。K 组即为此存在。
const { buildMapKey, pickMappingRow, judgeMappingAction, MAP_KEY_SEP } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const DEMO = '★发鱿鱼【招牌】';   // 平台导入菜名：带装饰符 + 全角括号，天然证伪「归一了没有」

console.log('===== K · 键口径（写侧键 ≡ 读侧键）=====');
check('K-① 分隔符就是单个竖线（与读侧 mapIndex 同形）', MAP_KEY_SEP === '|', JSON.stringify(MAP_KEY_SEP));
check('K-② 键 = platform + 分隔符 + dish_key', buildMapKey('taobao', DEMO) === 'taobao|' + DEMO,
  buildMapKey('taobao', DEMO));
check('K-③ platform 空 ⇒ 键以分隔符开头（读侧有 get(|+k) 兜底）', buildMapKey('', DEMO) === '|' + DEMO,
  buildMapKey('', DEMO));
check('K-④ 两端都 trim（读侧 trim 了，写侧不 trim ⇒ 前后空格失配）',
  buildMapKey('  taobao  ', '  ' + DEMO + '  ') === 'taobao|' + DEMO,
  buildMapKey('  taobao  ', '  ' + DEMO + '  '));
check('K-⑤ 原始 dish_key 不归一（★ / 【】 必须原样留存）',
  buildMapKey('taobao', DEMO).indexOf('★') > 0 && buildMapKey('taobao', DEMO).indexOf('【招牌】') > 0,
  buildMapKey('taobao', DEMO));
// 行为面：把写侧落的行使劲按读侧那段代码查一遍（改读侧分隔符不会让这条转红 ⇒ 由
// tools/check_dish_mapping_write.js 的 A-②/A-③ 源码同源比对补位，两条路线互补）
{
  const mapIndex = new Map([[buildMapKey('', DEMO), 'cc_demo']]);
  const hit = mapIndex.get('taobao' + MAP_KEY_SEP + DEMO) || mapIndex.get(MAP_KEY_SEP + DEMO) || '';
  check('K-⑥ 行为面：写侧落「空 platform」的行，读侧按 taobao 查也能命中', hit === 'cc_demo', `hit=${hit}`);
}

console.log('\n===== P · pickMappingRow（挑既有行）=====');
const ROWS = [
  { _id: 'm1', platform: 'taobao', external_ref_id: DEMO, card_code: 'cc_a', is_deleted: false },
  { _id: 'm2', platform: 'jd_order', external_ref_id: DEMO, card_code: 'cc_b', is_deleted: false },
  { _id: 'm3', platform: 'taobao', external_ref_id: '  ' + DEMO + '  ', card_code: 'cc_c', is_deleted: true },
  { _id: 'm4', platform: 'taobao', external_ref_id: '别的一道菜', card_code: 'cc_d', is_deleted: false },
];
check('P-① 同平台命中（taobao + ★发鱿鱼 ⇒ m1）',
  pickMappingRow(ROWS, 'taobao', DEMO) && pickMappingRow(ROWS, 'taobao', DEMO)._id === 'm1');
check('P-② 平台不同不误命中（jd_order ⇒ m2 不是 m1）',
  pickMappingRow(ROWS, 'jd_order', DEMO)._id === 'm2');
check('P-③ 软删行被跳过（trim 后同键的 m3 不得命中）',
  pickMappingRow(ROWS, 'taobao', DEMO)._id !== 'm3');
check('P-④ 另一道菜不命中（无平台+菜名双命中 ⇒ null）', pickMappingRow(ROWS, '', DEMO) === null);
check('P-⑤ 空输入 ⇒ null（非恒真有值）', pickMappingRow([], 'taobao', DEMO) === null
  && pickMappingRow(null, 'taobao', DEMO) === null);

console.log('\n===== J · judgeMappingAction（五态动作）=====');
check('J-① 无既有行 + 给了卡 ⇒ created', judgeMappingAction(null, 'cc_x') === 'created');
check('J-② 有既有行 + 卡变了 ⇒ updated', judgeMappingAction({ card_code: 'cc_a' }, 'cc_x') === 'updated');
check('J-③ 有既有行 + 卡没变 ⇒ noop（不写库）', judgeMappingAction({ card_code: 'cc_a' }, 'cc_a') === 'noop');
check('J-④ 有既有行 + 卡传空 ⇒ cleared（解除，软删可逆）',
  judgeMappingAction({ card_code: 'cc_a' }, '') === 'cleared');
check('J-⑤ 无既有行 + 卡传空 ⇒ noop（解除一个本来就没有的映射）', judgeMappingAction(null, '') === 'noop');

console.log('\n===== V · validateInput（入参面）=====');
check('V-① 正常入参放行', validateInput({ shop_id: 's1', dish_key: DEMO, card_code: 'cc_x' }).error === null);
check('V-② 缺 shop_id 拒绝', validateInput({ dish_key: DEMO }).error !== null);
check('V-③ dish_key 全空格拒绝（空串 ≠ 合法）', validateInput({ shop_id: 's1', dish_key: '   ' }).error !== null);
check('V-④ card_code 空串**合法**（语义 = 解除映射）',
  validateInput({ shop_id: 's1', dish_key: DEMO, card_code: '' }).error === null
  && validateInput({ shop_id: 's1', dish_key: DEMO, card_code: '' }).card_code === '');
check('V-⑤ platform 未给 ⇒ 空串（跨平台生效）',
  validateInput({ shop_id: 's1', dish_key: DEMO }).platform === '');
check('V-⑥ 超长 dish_key 拒绝（上限不是摆设）',
  validateInput({ shop_id: 's1', dish_key: 'x'.repeat(201) }).error !== null);

console.log(`\n==== saveDishMapping R255 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
