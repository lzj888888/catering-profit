// utils/dishImport.selftest.js —— P0-4 批量导入纯逻辑单源守卫（26 断言）
// 形状约束（R66）：顶层无 IIFE；process.exit 仅在末块；断言失败以 ✅/❌ 明细 + 末行 `==== ... N 通过 / M 失败 ====` 汇总。
const { parseDishLine, parseDishLines, matchCategory, buildDraftCard, draftStatusOf, prefillOf, hasThousandsSeparator, IMPORT_NO_AUTOSAVE } = require('./dishImport.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { console.log('  ✅ ' + name); pass++; }
  else { console.log('  ❌ ' + name); fail++; }
}

// 1) parseDishLine：三列逗号分隔
(() => {
  const r = parseDishLine('鱼香肉丝,热炒荤菜,38');
  ok('三列逗号分隔解析', r && r.name === '鱼香肉丝' && r.category === '热炒荤菜' && r.priceYuan === 38);
})();
// 2) parseDishLine：制表符 + 售价缺省
(() => {
  const r = parseDishLine('凉拌黄瓜\t凉拌');
  ok('制表符分隔·售价缺省为 null', r && r.name === '凉拌黄瓜' && r.category === '凉拌' && r.priceYuan == null);
})();
// 3) parseDishLine：空行/无菜名 → null
ok('空行 → null', parseDishLine('   ') === null);
ok('无菜名片段 → null', parseDishLine(',,') === null);
// 4) parseDishLines：多行跳过空行
(() => {
  const arr = parseDishLines('宫保鸡丁,热炒荤菜,32\n\n凉拌黄瓜,凉拌\n可乐,饮品,8');
  ok('整段解析 3 行（跳过空行）', arr.length === 3 && arr[0].name === '宫保鸡丁' && arr[2].priceYuan === 8);
})();
// 5) matchCategory：别名命中
ok('「小炒」命中 hot_meat', matchCategory('小炒黄牛肉') === 'hot_meat');
ok('「凉菜」命中 cold', matchCategory('凉菜拼盘') === 'cold');
ok('「盖饭」命中 ricebowl', matchCategory('咖喱鸡盖饭') === 'ricebowl');
ok('无匹配 → null', matchCategory('神秘料理') === null);
// 6) buildDraftCard：套模板 → 含调料油火 + 示例主料，isPreset=true，is_draft=true
(() => {
  const c = buildDraftCard({ name: '宫保鸡丁', category: '热炒荤菜', priceYuan: 32 }, 'hot_meat');
  const hasCond = c.lines.some((l) => l.material_name === '调料(含油盐酱醋)' && l.isPreset === true);
  const hasSample = c.lines.some((l) => l.material_name === '猪肉' && l.isPreset === true);
  ok('草稿卡含调料估行', hasCond);
  ok('草稿卡含示例主料估行', hasSample);
  ok('草稿卡标记 is_draft', c.is_draft === true && c.priceYuan === 32);
})();
// 7) buildDraftCard：分类无法匹配 → 无预填行（交老板手选）
(() => {
  const c = buildDraftCard({ name: '神秘料理', category: '神秘', priceYuan: 20 }, null);
  ok('无模板匹配 → 无预填行', c.lines.length === 0 && c._catKey === null);
})();
// 8) draftStatusOf：三色
(() => {
  // 红：无主材
  ok('无主材 → red', draftStatusOf({ priceYuan: 30, lines: [] }) === 'red');
  // 红：无售价
  ok('无售价 → red', draftStatusOf({ priceYuan: 0, lines: [{ material_name: '猪肉', qty: '150', line_kind: 'main' }] }) === 'red');
  // 橙：有主材有售价但仍是估行
  const orange = buildDraftCard({ name: '宫保鸡丁', category: '热炒荤菜', priceYuan: 32 }, 'hot_meat');
  ok('含估行 → orange', draftStatusOf(orange) === 'orange');
  // 绿：无估行且主材已填价
  const green = { priceYuan: 32, lines: [{ material_name: '猪肉', qty: '150', unit_price_yuan: '20', line_kind: 'main' }, { material_name: '调料(含油盐酱醋)', qty: '1', unit_price_yuan: '0.5', line_kind: 'main' }] };
  ok('已核对 → green', draftStatusOf(green) === 'green');
})();

// 🔴 R566：草稿 → 编辑页预填映射（唯一映射点）。这里守的是「导入页看到的 = 编辑页拿到的」。
//   特别守两条**会导致假账**的：① 示例主料不许被预填出价；② 单位字段必须齐（缺 unit ⇒ picker 落回「克」）。
(() => {
  const c = buildDraftCard({ name: '宫保鸡丁', category: '热炒荤菜', priceYuan: 32 }, 'hot_meat');
  const p = prefillOf(c);
  ok('预填：菜名/售价/分类/损耗 四键齐全', p.name === '宫保鸡丁' && p.priceYuan === '32' && p.category === '热炒荤菜' && p.lossRate === '2');
  ok('预填：catKey 透传（编辑页据它回显品类 picker）', p.catKey === 'hot_meat');
  ok('预填：每行都有 qty_unit 与 price_unit（缺则 picker 落回「克」）', p.lines.every((l) => l.qty_unit && l.price_unit));
  ok('预填：示例主料价仍为空（不许替老板编价）', p.lines.filter((l) => l.material_name !== '调料(含油盐酱醋)').every((l) => l.unit_price_yuan === ''));
  ok('预填：调料行保留默认估价值', p.lines.some((l) => l.material_name === '调料(含油盐酱醋)' && l.unit_price_yuan === '0.50'));
  ok('预填：无模板草稿 → 空行且不崩', (() => { const q = prefillOf(buildDraftCard({ name: '神秘料理', priceYuan: 20 }, null)); return q.lines.length === 0 && q.name === '神秘料理'; })());
  ok('不自动落库的理由有文案（提示不能为空）', typeof IMPORT_NO_AUTOSAVE === 'string' && IMPORT_NO_AUTOSAVE.length > 10);
})();

// 🔴 R566：千分位陷阱（Excel 复制菜单的真实形态）。
//   改前：`1,280` 按逗号切开 ⇒ 售价静默变成 **1 元** ⇒ 整张卡毛利全错且零报错。
//   现在：有制表符就只按制表符切 ⇒ 价格留在格内（解析不出 ⇒ 红），并由 hasThousandsSeparator 提示去掉逗号。
ok('制表符优先：1,280 不被切成 1 元（宁可红，不静默错价）',
  (() => { const r = parseDishLine('龙虾\t海鲜\t1,280'); return r && r.priceYuan === null; })());
ok('千分位检出：1,280 命中 / 1,2,3 三列不误判',
  hasThousandsSeparator('龙虾\t海鲜\t1,280') === true && hasThousandsSeparator('1,2,3') === false);

console.log('==== 菜品批量导入逻辑自测结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail === 0 ? 0 : 1);
