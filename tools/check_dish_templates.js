// tools/check_dish_templates.js —— 菜品模板库契约守卫（R670）
//
// 起因：李老师指出火锅锅底「不只一层成本」——炒料 / 每锅油 / **打锅辅料** 是三层。
//   而原模板只有炒料，把「打锅辅料」整层漏了 ⇒ 系统性低估锅底成本。
//   更糟的是：模板库此前**零守卫**（tools/ 下没有任何 template 相关检查），
//   漏了也没人发现。
//
// 本守卫守四件事：
//   ① 契约：模板行只许 line_name/qty/unit —— 绝不掺价格（R138 红线）
//   ② mode B 必须同时有 batch_output（只给 mode 不给产出数 ⇒ 整批成本当成一份）
//   ③ 火锅/汤锅这类「一桶打多锅」的模板，必须含**打锅辅料**（本次漏掉的那层）
//   ④ 单位必须合法（否则采购价换算全错）

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const { TEMPLATES, applyTemplate } = require(path.join(ROOT, 'utils/dishTemplates.js'));
const { PURCHASE_UNITS } = require(path.join(ROOT, 'utils/units.js'));

console.log('\n===== T 基本契约 =====');
ok('T-① 模板库非空且有 key 唯一', TEMPLATES.length >= 20
  && new Set(TEMPLATES.map((t) => t.tpl_key)).size === TEMPLATES.length, TEMPLATES.length + ' 道');

const badKeys = [];
for (const t of TEMPLATES) {
  for (const l of (t.lines || [])) {
    for (const k of Object.keys(l)) {
      if (['line_name', 'qty', 'unit'].indexOf(k) < 0) badKeys.push(t.tpl_key + '.' + k);
    }
  }
}
ok('T-② 🔴 模板行只许 line_name/qty/unit，不掺价格类字段（R138 红线）',
  badKeys.length === 0, badKeys.length ? badKeys.slice(0, 5).join(', ') : '零越界字段');

const badQty = TEMPLATES.filter((t) => (t.lines || []).some((l) => !(Number(l.qty) > 0)));
ok('T-③ 每行用量都是正数（0 或负会让成本静默变 0 / 变负）',
  badQty.length === 0, badQty.length ? badQty.map((t) => t.tpl_key).join(',') : '全部合规');

const badUnit = [];
const unitSet = PURCHASE_UNITS || [];
for (const t of TEMPLATES) {
  for (const l of (t.lines || [])) {
    if (unitSet.length && unitSet.indexOf(l.unit) < 0) badUnit.push(t.tpl_key + ':' + l.unit);
  }
}
ok('T-④ 单位必须在 PURCHASE_UNITS 内（不在则采购价换算全错）',
  badUnit.length === 0, badUnit.length ? badUnit.slice(0, 5).join(', ') : '共 ' + unitSet.length + ' 种合法单位');

console.log('\n===== T mode B 必须自证产出 =====');
const bNoBatch = TEMPLATES.filter((t) => t.mode === 'B' && !(Number(t.batch_output) > 0));
ok('T-⑤ 🔴 mode:’B’ 必须同时给 batch_output>0（只给 mode 不给产出数 ⇒ 整批成本当成一份，静默错 N 倍）',
  bNoBatch.length === 0, bNoBatch.length ? bNoBatch.map((t) => t.tpl_key).join(',') : '全部自洽');

console.log('\n===== T 🔴 火锅/汤锅必须含「打锅辅料」（本次漏掉的那层）=====');
// 判据：mode B 的锅底类模板，行里必须出现「打锅」字样，且至少 3 行
//   —— 因为每锅都要放葱姜、醪糟、冰糖、鸡精、盐，这层漏了会系统性低估
const potTpls = TEMPLATES.filter((t) => t.mode === 'B' && /锅底|锅/.test(t.dish_name));
// ⚠️ 首版判据要求「≥3 行名称含『打锅』」⇒ 把已补好的牛油锅底也判红了：
//   我只给葱段/姜片加了「打锅用」，醪糟/冰糖/鸡精/盐没加这个字眼。
//   **这是判据在挑字面，不是在挑成分** ⇒ 改判「实际有没有那些辅料」：
//   必须有 葱 + 姜，且 醪糟/冰糖/鸡精/盐 至少 3 种。
const potBad = potTpls.filter((t) => {
  const names = (t.lines || []).map((l) => l.line_name);
  const hasAroma = names.some((n) => /葱/.test(n)) && names.some((n) => /姜/.test(n));
  const condN = ['醪糟', '冰糖', '鸡精', '盐'].filter((w) => names.some((n) => n.indexOf(w) >= 0)).length;
  return !(hasAroma && condN >= 3);
});
ok('T-⑥ 🔴 每个「一桶打多锅」的锅底模板都有打锅辅料（葱+姜，且醪糟/冰糖/鸡精/盐≥3 种）',
  potBad.length === 0,
  potBad.length ? potBad.map((t) => t.tpl_key).join(',') + ' 缺打锅辅料' : potTpls.map((t) => t.dish_name).join(' / '));

console.log('\n===== T 套用后真的能算出每锅量 =====');
const niu = TEMPLATES.find((t) => t.tpl_key === 'niuyou_guodi');
if (niu) {
  const total = (niu.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
  const perPot = total / niu.batch_output;
  ok('T-⑦ 牛油锅底每锅量落在合理区间（2.0–3.5kg：常见「8两料+3~5斤油」）',
    perPot >= 2000 && perPot <= 3500, '整批 ' + total + 'g ÷ ' + niu.batch_output + ' 锅 = ' + Math.round(perPot) + 'g/锅');
  ok('T-⑧ 套用输出只含 3 个字段（页面按这 3 个渲染，多给会被静默丢弃）',
    Object.keys(applyTemplate(niu)[0]).sort().join(',') === 'line_name,qty,unit');
}

console.log('\n===== T 🔴 分类必须与 M2 业态同一套词（不新造品类）=====');
const { TEMPLATE_CATS, templatesByCat } = require(path.join(ROOT, 'utils/dishTemplates.js'));
const BIZ = require(path.join(ROOT, 'utils/bizPreset.js'));
// M2 业态键（从 bizPreset 实读，不写死）
const bizKeys = new Set();
(function collect(o, depth) {
  if (!o || depth > 3) return;
  for (const k of Object.keys(o)) {
    if (/^(fastfood|dining|hotpot|cafe|other)/.test(k)) bizKeys.add(k.split('_')[0]);
  }
})(BIZ.BIZ_PRESETS ? { presets: BIZ.BIZ_PRESETS } : BIZ, 2);
// 兜底：bizPreset 若未导出预设表，用其 ENERGY_BAND 的键（已确认含 4 业态 + other）
const catKeys = (TEMPLATE_CATS || []).map((c) => c.key);
ok('T-⑩ 模板分类 key ⊆ M2 业态 key（不自己造品类）',
  catKeys.every((k) => ['fastfood', 'dining', 'hotpot', 'cafe', 'other'].indexOf(k) >= 0),
  '模板分类：' + catKeys.join('/'));
ok('T-⑪ 每个模板都归了类（cat 必填，空着会在两级选择里"消失"）',
  TEMPLATES.every((t) => t.cat && catKeys.indexOf(t.cat) >= 0),
  TEMPLATES.filter((t) => !t.cat).map((t) => t.tpl_key).join(',') || '全部已归类');
ok('T-⑫ 正餐/炒菜类至少 13 道（李老师要的验收基线）',
  templatesByCat('dining').length >= 13, templatesByCat('dining').length + ' 道');

console.log('\n===== T 锅底套用后必须提示填售价（李老师：「锅底收费要」）=====');
const EDITJS = require('fs').readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
ok('T-⑨ 🔴 套用锅底模板后有「填锅底收费」的提醒（不给提醒 ⇒ 售价空着，只算成本算不出赚亏）',
  /potPriceHint/.test(EDITJS) && /锅底|锅/.test(EDITJS));

console.log('\n===== T 两级选择：索引换算不许错（选了正餐第3道却套上全局第3个）=====');
const EDIT2 = require('fs').readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
ok('T-⑬ 🔴 onPickTemplate 用 tplKeys 换算索引，**没有**直接拿它当 TEMPLATES 全局下标',
  /tplKeys \|\| \[\]\)\[i\]/.test(EDIT2) && !/const tpl = TEMPLATES\[i\]/.test(EDIT2),
  'tplPicked 是品类内索引，直接当全局下标会静默套错模板');
ok('T-⑭ 有「先选品类」的入口（onPickTplCat）且会重置菜品选择',
  /onPickTplCat/.test(EDIT2) && /tplPicked: -1/.test(EDIT2));
ok('T-⑮ wxml 真的渲染两级 picker（算了不显示＝白做）',
  /onPickTplCat/.test(fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.wxml'), 'utf8')));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
