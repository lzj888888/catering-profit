// utils/dishImport.selftest.js —— P0-4 批量导入纯逻辑单源守卫（26 断言）
// 形状约束（R66）：顶层无 IIFE；process.exit 仅在末块；断言失败以 ✅/❌ 明细 + 末行 `==== ... N 通过 / M 失败 ====` 汇总。
const fs = require('fs');
const path = require('path');
const { isNoiseLine, detectColumns, diagnosePaste, looksLikeCode, COMBO_SIGN, parseDishLine, parseDishLines, matchCategory, buildDraftCard, draftStatusOf, prefillOf, hasThousandsSeparator, IMPORT_NO_AUTOSAVE } = require('./dishImport.js');

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

// ===== R696（真实报表实测暴露）：多数字不许猜 =====
// 美团「菜品销售统计」整表粘贴是老板最自然的操作，列是「菜名 分类 销量 销售额 [单价]」。
// 旧实现取**第一个**数字当售价 ⇒ 拿销量当售价 ⇒ 毛利全错且零提示。
ok('R696-① 多数字(120/3600/30) ⇒ 售价留空 + ambiguous',
  (() => { const r = parseDishLine('红烧肉\t热菜\t120\t3600\t30');
    return r.priceYuan === null && r.ambiguous === true && r.ambNums.length === 3; })());
ok('R696-② 两数字(20/600) 也不猜（可能是销量+销售额）',
  (() => { const r = parseDishLine('宫保鸡丁\t20\t600');
    return r.priceYuan === null && r.ambiguous === true; })());
ok('R696-③ 单数字仍正常取（设计目标三列不受影响）',
  (() => { const r = parseDishLine('红烧肉\t热菜\t30');
    return r.priceYuan === 30 && r.ambiguous === false; })());
ok('R696-④ 无数字（只有菜名+分类）不误判 ambiguous',
  (() => { const r = parseDishLine('红烧肉\t热菜');
    return r.priceYuan === null && r.ambiguous === false; })());

// ===== R698：真实报表样式样本（豆包按美团管家/客如云后台导出的真实列序复现）=====
// 来源：review/evidence/r698_realforms/pos_forms_doubao.txt
// ⚠️ 这是「按真实样式复现」，不是从抖音/头条抓下来的原单据；算术已由本守卫独立复算核对。
// 价值：手写三列样本测不出「整表粘贴」的障碍 —— 真实报表带表头行、合计行、3~4 个数字列。
const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'review', 'evidence',
  'r698_realforms', 'pos_forms_doubao.txt'), 'utf8');
const secA = SAMPLE.split('=== A')[1].split('=== B')[0]
  .split(/\r?\n/).filter(function (l) { return l.indexOf('\t') >= 0; });
const rowsA = parseDishLines(secA.join('\n'));

// 独立复算（不采信样本自带的 EXPECT 行）
let qty = 0, amt = 0;
secA.forEach(function (l) {
  const p = l.split('\t');
  if (/^\d+$/.test(String(p[2] || '').trim()) && !isNoiseLine(l)) { qty += Number(p[2]); amt += Number(p[3]); }
});
ok('R698-① 样本 A 算术自洽：销量 44 / 销售额 1166（先证明样本可信）',
  qty === 44 && amt === 1166, qty + '/' + amt);
ok('R698-② 整表粘贴 ⇒ 11 道菜（表头行与「合计」行都被拦掉）',
  rowsA.length === 11, '实际 ' + rowsA.length);
ok('R698-③ 不会多出一张叫「合计」的成本卡',
  rowsA.every(function (r) { return !isNoiseLine(r.name); }),
  rowsA.map(function (r) { return r.name; }).join('、'));
ok('R698-④ 真实多列格式下 R696 生效：每行都不猜售价',
  rowsA.every(function (r) { return r.ambiguous === true && r.priceYuan === null; }));
ok('R698-⑤ isNoiseLine 精确匹配：真菜名「合计拼盘」不得被误杀',
  !isNoiseLine('合计拼盘\t热菜\t68'));
ok('R698-⑥ 常见合计/表头别名都拦得住',
  isNoiseLine('小计\t10\t200') && isNoiseLine('总计 100 999')
  && isNoiseLine('菜品名称\t菜品分类\t销售数量\t销售额\t单价'));


// ===== R699：真实收银报表的列序（豆包联网检索到官方帮助文档，有来源 URL）=====
// 来源已固化：review/evidence/r698_realforms/doubao_websearch_6forms.txt
// 最关键的事实：**菜名不在第一列** —— 美团管家第 4 列、银豹第 2 列。
const MEITUAN = [
  '营业日期\t菜品大类\t菜品小类\t菜品名称\t销售数量\t原价金额\t菜品收入金额\t优惠金额',
  '2026-06-12\t热菜\t川菜\t水煮鱼\t12\t696.00\t626.40\t69.60',
  '2026-06-12\t饮品\t茶饮\t柠檬水\t25\t250.00\t225.00\t25.00',
  '合计\t\t\t\t37\t946.00\t851.40\t94.60',
].join('\n');
const mtRows = parseDishLines(MEITUAN);
ok('R699-① 美团管家列序：菜名取自第 4 列（不是日期）',
  mtRows.length === 2 && mtRows[0].name === '水煮鱼' && mtRows[1].name === '柠檬水',
  mtRows.map(function (r) { return r.name; }).join('、'));
// ⚠️ 判据改成**结构位置**而不是比值：比中文字面量会被 page-terms 的 P3-1 判红
//   （术语改名就静默失灵）。这里要证的本就是「菜名取第 4 列、分类取第 2 列」。
ok('R699-② 列定位正确：菜名列 idx=3、分类列 idx=1，且表头/合计行都被跳过',
  (function () {
    const c = detectColumns(MEITUAN.split(String.fromCharCode(10)));
    return c && c.nameIdx === 3 && c.catIdx === 1 && mtRows.length === 2 && !!mtRows[0].category;
  })());
ok('R699-③ 该报表没有「单价」列 ⇒ 售价留空，绝不拿「原价金额」当单价',
  mtRows.every(function (r) { return r.priceYuan === null; }),
  mtRows.map(function (r) { return String(r.priceYuan); }).join('/'));
const YINBAO = [
  '操作\t商品名称\t商品条码\t规格\t单位\t商品分类\t现有库存\t销售数量\t商品总售价\t实收金额',
  '正常\t美式咖啡\t6901\t大杯\t杯\t咖啡\t999\t30\t540.00\t480.00',
].join('\n');
ok('R699-④ 银豹列序：菜名取自第 2 列（「操作」不再被当菜名）',
  parseDishLines(YINBAO)[0].name === '美式咖啡');
ok('R699-⑤ 无表头的三列粘贴仍走老路径（回归：菜名+分类+售价）',
  (function () {
    const r = parseDishLines('鱼香肉丝,热炒荤菜,38');
    return r.length === 1 && r[0].name === '鱼香肉丝' && r[0].priceYuan === 38;
  })());
ok('R699-⑥ detectColumns 在无表头时返回 null（保证能回落，不是恒真）',
  detectColumns(['鱼香肉丝,热炒荤菜,38']) === null);

// ===== R702：整表粘贴体检（先问「该不该解析」，而不是「能解析出几行」）=====
// 真表实证（review/evidence/r700_realtables）：套餐明细整表粘贴，旧实现建出
// 「统计方式：…」「菜品编码」「D001」三张卡，页面还显示"有 3 行数据"，零报错。
// 统一导入器（subpkg/biz/takeaway）对同一张表是拒收的 —— 两条链路行为必须一致。
ok('R702-① 套餐明细整表 ⇒ combo_detail（拒收，不建垃圾卡）',
  diagnosePaste('统计方式：【套餐明细】；营业日期\n菜品编码\t套餐\t单品名称\t菜品类型\t单位\nD001\t川味套餐\t水煮鱼\t单品\t份').kind === 'combo_detail');

ok('R702-② 账单整表（首列是结算日期）⇒ no_name_col（首列不是菜名）',
  (function () {
    const t = ['2026-08-04\t541520899\t耙三样·耙牛肉\t2026-08-01\t外卖订单\t26.02',
      '2026-08-05\t541520899\t耙三样·耙牛肉\t2026-08-02\t外卖订单\t18.20',
      '2026-08-06\t541520899\t耙三样·耙牛肉\t2026-08-03\t外卖订单\t24.62'].join('\n');
    return diagnosePaste(t).kind === 'no_name_col';
  })());

ok('R702-③ 账单整表（首列是结算 id 数字）⇒ no_name_col',
  (function () {
    const t = ['157434321\t34081552\t耙三样_耙牛肉\t2026-08-03\t0.00',
      '157434322\t34081552\t耙三样_耙牛肉\t2026-08-04\t12.00',
      '157434323\t34081552\t耙三样_耙牛肉\t2026-08-05\t35.50'].join('\n');
    return diagnosePaste(t).kind === 'no_name_col';
  })());

ok('R702-④ 回归：正常三列粘贴仍是 ok（老路径一点不受影响）',
  diagnosePaste('鱼香肉丝,热炒荤菜,38\n凉拌黄瓜,凉拌,16').kind === 'ok');

ok('R702-⑤ 阈值保护：少于 3 行不判编码（避免误杀纯英文菜名）',
  diagnosePaste('Coke,Drinks,8').kind === 'ok' && diagnosePaste('Coke,Drinks,8\nSprite,Drinks,6').kind === 'ok');

ok('R702-⑥ 反恒真：含中文一票否决 —— 「3号套餐」不得被判成编码',
  looksLikeCode('3号套餐') === false && looksLikeCode('A区拼盘') === false);

ok('R702-⑦ 判据确有分辨力：真编码/日期必须判 true',
  looksLikeCode('D001') === true && looksLikeCode('20260910') === true
  && looksLikeCode('2026-09-10') === true && looksLikeCode('6901234567890') === true);

// 🔴 跨端同源：前端这套签名与云函数 detectDishShape 的判据必须一致。
//   云函数是独立部署单元，不能 require 本文件 ⇒ 两份人工维护。
//   这条断言就是防「改了一边忘了另一边」——那种漂移在页面上完全看不出来。
ok('R702-⑧ 前端 COMBO_SIGN 与云函数 detectDishShape 同源（防两份漂移）',
  (function () {
    const svc = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'importSalesBill', 'service.js'), 'utf8');
    const q = (w) => "has('" + w + "')";
    return svc.indexOf(q(COMBO_SIGN.set)) >= 0 && svc.indexOf(q(COMBO_SIGN.item)) >= 0;
  })());



console.log('==== 菜品批量导入逻辑自测结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail === 0 ? 0 : 1);
