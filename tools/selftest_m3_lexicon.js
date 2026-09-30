// tools/selftest_m3_lexicon.js —— M3.20 标准原料词库 + 菜品模板自测（批次 B 收尾）
//
// 锚点（规范 §M3.20，全部 require 真实单源实算，不重写一份）：
//   L-a 规模与形状   L-b 必含 8 条   L-c 建议命中/别名/空结果
//   L-d 不自动替换   L-e 单位池     L-f 模板 20 道无价格键
//   L-g applyTemplate 返回行结构
//
// 运行：node tools/selftest_m3_lexicon.js

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// —— require 真实单源（不重写、不 copy）——
const { LEXICON, suggestByName, getByKey } = require('../utils/materialLexicon.js');
const { TEMPLATES, getTemplate, applyTemplate } = require('../utils/dishTemplates.js');
const { PURCHASE_UNITS } = require('../utils/units.js');

console.log('===== L-a · 规模与形状 =====');
check('L-a 规模 60 <= LEXICON.length <= 80', LEXICON.length >= 60 && LEXICON.length <= 80, `length=${LEXICON.length}`);
const KEY_SET = ['std_key', 'std_name', 'aliases', 'default_unit'];
const shapeBad = LEXICON.filter((it) => {
  const keys = Object.keys(it).sort();
  return keys.join(',') !== KEY_SET.slice().sort().join(',');
});
check('L-a 每条键集合恰好 = {std_key, std_name, aliases, default_unit}', shapeBad.length === 0,
  shapeBad.length ? `${shapeBad.length} 条键不符：${JSON.stringify(shapeBad[0])}` : `${LEXICON.length} 条均 4 键`);
const stdKeyDup = LEXICON.length - new Set(LEXICON.map((it) => it.std_key)).size;
check('L-a std_key 无重复', stdKeyDup === 0, `重复 ${stdKeyDup} 个`);
check('L-a aliases 均为数组', LEXICON.every((it) => Array.isArray(it.aliases)), '');

console.log('===== L-b · 必含 8 条 =====');
const MUST = ['鸡胸肉', '土豆', '干辣椒', '花椒', '生抽', '老抽', '菜籽油', '豆瓣酱'];
const missing = MUST.filter((n) => !LEXICON.some((it) => it.std_name === n));
check('L-b 必含 8 条（鸡胸肉/土豆/干辣椒/花椒/生抽/老抽/菜籽油/豆瓣酱）', missing.length === 0,
  missing.length ? `缺：${missing.join(', ')}` : '8/8 齐全');

console.log('===== L-c · 建议命中 / 别名 / 空结果 =====');
check("L-c suggestByName('生抽')[0].std_name === '生抽'",
  suggestByName('生抽')[0] && suggestByName('生抽')[0].std_name === '生抽',
  JSON.stringify(suggestByName('生抽').map((x) => x.std_name)));
check("L-c suggestByName('辣椒')[0].std_name === '干辣椒'（别名命中）",
  suggestByName('辣椒')[0] && suggestByName('辣椒')[0].std_name === '干辣椒',
  JSON.stringify(suggestByName('辣椒').map((x) => x.std_name)));
check("L-c suggestByName('不存在的东西xyz') → []", suggestByName('不存在的东西xyz').length === 0, `len=${suggestByName('不存在的东西xyz').length}`);
check("L-c getByKey('potato').std_name === '土豆'", getByKey('potato') && getByKey('potato').std_name === '土豆', '');
check('L-c 建议条数 ≤5', suggestByName('肉').length <= 5, `len=${suggestByName('肉').length}`);

console.log('===== L-d · 不自动替换 =====');
const probe = '辣椒';
const before = probe;
suggestByName(probe);
check('L-d 调 suggestByName 前后入参字符串不变', probe === before, `'${probe}'`);
const lexSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'materialLexicon.js'), 'utf8');
const exportsLine = (lexSrc.match(/module\.exports\s*=\s*\{[^}]+\}/) || [''])[0];
// ⚠️ round181g 变异回灌实测：原正则只认 `name:` 带冒号形式，
//   `module.exports = { LEXICON, suggestByName, getByKey, autoReplace }` 这种**简写**导出（无冒号）
//   会被漏判 ⇒ 判据改「带冒号 **或** 简写后跟 , / }」两种形态都算命中。
check('L-d 导出名无 auto/replace/apply/normalize 前缀',
  !/\b(auto|replace|apply|normalize)[A-Za-z0-9_]*\s*(?::|[,}])/.test(exportsLine), exportsLine.trim());
check('L-d 源码无 setData', !/setData/.test(lexSrc), '');

console.log('===== L-e · 单位池 =====');
const badUnit = LEXICON.filter((it) => PURCHASE_UNITS.indexOf(it.default_unit) < 0);
check(`L-e 全部 default_unit ∈ PURCHASE_UNITS（16 项）`, badUnit.length === 0,
  badUnit.length ? `非法：${badUnit.map((x) => x.default_unit).join(',')}` : `${LEXICON.length} 条均合法`);

console.log('===== L-f · 模板 20 道 =====');
check('L-f 模板 20 道', TEMPLATES.length === 20, `length=${TEMPLATES.length}`);
const PRICE_KEYS = ['price', 'unit_cost', 'cost', 'price_fen', 'unit_cost_fen', 'cost_fen'];
const deepHasPrice = (obj, path) => {
  if (Array.isArray(obj)) return obj.some((o, i) => deepHasPrice(o, `${path}[${i}]`));
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (PRICE_KEYS.some((p) => k.toLowerCase().indexOf(p) >= 0)) return `${path}.${k}`;
      const hit = deepHasPrice(obj[k], `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return false;
};
check('L-f 模板行结构完整（line_name/qty/unit）', TEMPLATES.every((t) =>
  t.tpl_key && t.dish_name && Array.isArray(t.lines) && t.lines.length > 0 &&
  t.lines.every((l) => l && l.line_name && l.qty != null && l.unit)),
  '');
const tplPriceHit = TEMPLATES.map((t) => deepHasPrice(t, t.tpl_key)).filter(Boolean);
check('L-f 全表无价格类键', tplPriceHit.length === 0, tplPriceHit.length ? `命中：${tplPriceHit.join(', ')}` : '0 处');
const tplBadUnit = TEMPLATES.flatMap((t) => t.lines.filter((l) => PURCHASE_UNITS.indexOf(l.unit) < 0));
check('L-f 全部 unit ∈ PURCHASE_UNITS', tplBadUnit.length === 0,
  tplBadUnit.length ? `非法：${tplBadUnit.map((l) => l.unit).join(',')}` : '20 道全部合法');

console.log('===== L-g · applyTemplate 返回行结构 =====');
const tpl0 = TEMPLATES[0];
const rows = applyTemplate(tpl0);
check('L-g applyTemplate 返回行数 === tpl.lines.length', rows.length === tpl0.lines.length, `${rows.length}`);
const rowBadKeys = rows.filter((r) => Object.keys(r).some((k) => PRICE_KEYS.some((p) => k.toLowerCase().indexOf(p) >= 0)));
check('L-g 返回行不含 price/unit_cost/cost 键', rowBadKeys.length === 0,
  rowBadKeys.length ? `非法键：${JSON.stringify(rowBadKeys[0])}` : '行只含 line_name/qty/unit');
check("L-g 返回行键集合 = {line_name, qty, unit}", rows.every((r) => Object.keys(r).sort().join(',') === 'line_name,qty,unit'), '');

console.log('\n' + '='.repeat(60));
console.log(`===== M3.20 词库/模板自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
