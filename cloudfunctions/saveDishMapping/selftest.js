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
const { buildMapKey, pickMappingRow, judgeMappingAction, MAP_KEY_SEP,
  MAX_BATCH, findBatchConflicts, planBatchActions, countActions } = require('./service');
const { validateInput, validateBatch } = require('./validate');

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


console.log('\n===== B · R260 批量关联（规范 v1.9 §0 D25~D28）=====');
// B-① 上限取自纯函数单源（改这里必须同步前端 UI 分块粒度；守卫 D-② 断言两者关系）
check('B-① MAX_BATCH 存在且是有限正整数（云端 timeout 3s 的硬约束）',
  Number.isInteger(MAX_BATCH) && MAX_BATCH > 0 && MAX_BATCH <= 50, 'MAX_BATCH=' + MAX_BATCH);

// B-② 批内冲突：同一 (platform, dish_key) 出现两次 ⇒ 判冲突
const dupItems = [{ dish_key: 'A' }, { dish_key: 'B' }, { dish_key: 'A' }];
const c1 = findBatchConflicts(dupItems);
check('B-② 同 (platform,dish_key) 重复 ⇒ 判冲突（否则两条 insert 都"成功"却只落一个键）',
  c1.length === 1 && c1[0].index === 2 && c1[0].first_index === 0);
// B-③ 空 platform 与显式 platform **不算**冲突（读侧 '|菜' 与 'taobao|菜' 是两行，可各存一条）
const c2 = findBatchConflicts([{ dish_key: 'A' }, { dish_key: 'A', platform: 'taobao' }]);
check('B-③ 空 platform 与显式 platform 是**两个不同键** ⇒ 不算冲突',
  c2.length === 0, '冲突数=' + c2.length);
check('B-④ 两端 trim 后比较（" A " 与 "A" 视为同键 ⇒ 冲突）',
  findBatchConflicts([{ dish_key: ' A ' }, { dish_key: 'A' }]).length === 1);
check('B-⑤ 非数组 / 空数组不炸（返回空冲突）',
  findBatchConflicts(null).length === 0 && findBatchConflicts([]).length === 0);

// B-⑥ 批量动作规划：既有行有 ⇒ noop/updated/cleared；无 ⇒ created
const EXIST = [{ _id: 'row_1', platform: '', external_ref_id: '发鱿鱼', card_code: 'cc_a' }];
const p1 = planBatchActions(EXIST, [{ dish_key: '发鱿鱼', card_code: 'cc_a' }, { dish_key: '新菜', card_code: 'cc_x' }]);
check('B-⑥ 有既有行且卡没变 ⇒ noop；无既有行 ⇒ created（且带 _id 字段供写库用）',
  p1[0].action === 'noop' && p1[0]._id === 'row_1' && p1[1].action === 'created' && p1[1]._id === '');
check('B-⑦ 有既有行 + 卡变了 ⇒ updated；有既有行 + 卡传空 ⇒ cleared',
  planBatchActions(EXIST, [{ dish_key: '发鱿鱼', card_code: 'cc_z' }])[0].action === 'updated'
  && planBatchActions(EXIST, [{ dish_key: '发鱿鱼', card_code: '' }])[0].action === 'cleared');
check('B-⑧ 结果与入参**同序同长**（前端按序回显"哪一行没成"）',
  planBatchActions(EXIST, [{ dish_key: 'A' }, { dish_key: 'B' }, { dish_key: 'C' }])
    .map((x) => x.index).join(',') === '0,1,2');
const cA = countActions(p1);
check('B-⑨ 计数汇总（created/updated/cleared/noop/total）',
  cA.noop === 1 && cA.created === 1 && cA.total === 2, JSON.stringify(cA));

// B-⑩ 入参互斥（D25）：同时给 dish_key 与 items ⇒ 拒
const vBoth = validateBatch({ shop_id: 's1', dish_key: 'A', items: [{ dish_key: 'B', card_code: 'c' }] });
check('B-⑩ 🔴 两种形态互斥：同时给 dish_key 与 items ⇒ 拒（不静默取其一）',
  vBoth.error !== null, vBoth.msg);
check('B-⑪ items 非数组 / 空数组 ⇒ 拒',
  validateBatch({ shop_id: 's1', items: null }).error !== null
  && validateBatch({ shop_id: 's1', items: [] }).error !== null);
check('B-⑫ 超 MAX_BATCH ⇒ 拒（提示分块）',
  validateBatch({ shop_id: 's1', items: new Array(MAX_BATCH + 1).fill(0).map((_, i) => ({ dish_key: 'k' + i, card_code: 'c' })) }).error !== null);
check('B-⑬ 正常批量放行且 mode=batch',
  (() => { const v = validateBatch({ shop_id: 's1', items: [{ dish_key: 'A', card_code: 'cc' }] });
    return v.error === null && v.mode === 'batch' && v.items.length === 1; })());
// B-⑭ 逐项拒绝带 rejected[]（"哪一项、为什么"，用户一次看清要改哪几行）
const vBad = validateBatch({ shop_id: 's1', items: [{ dish_key: '', card_code: 'c' }, { dish_key: 'ok', card_code: 'c' }, { dish_key: 'dup', card_code: 'c' }, { dish_key: 'dup', card_code: 'c' }] });
check('B-⑭ 🔴 不合格项逐条带 index+reason（空 dish_key=1 项、重复键=1 项）',
  vBad.error !== null && Array.isArray(vBad.rejected) && vBad.rejected.length === 2
  && vBad.rejected.some((r) => r.reason === 'dish_key_empty')
  && vBad.rejected.some((r) => r.reason === 'duplicate_key'),
  JSON.stringify(vBad.rejected));
check('B-⑮ 批内 card_code 为空串**合法**（语义 = 解除，不需要卡存在）',
  (() => { const v = validateBatch({ shop_id: 's1', items: [{ dish_key: 'A', card_code: '' }] });
    return v.error === null && v.items[0].card_code === ''; })());

console.log(`\n==== saveDishMapping 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
