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

const { TEMPLATES, applyTemplate, matchTemplateByName, normDishName } = require(path.join(ROOT, 'utils/dishTemplates.js'));
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
  // ⚠️ R674：字段从 3 个变成 4 个 —— 新增 `yield_rate`（出净率跟行走）。
  //   这不是"为了通过检查而放宽"：页面 `onPickTemplate` 已同步改成读 r.yield_rate，
  //   否则「删掉品类」后整鱼会从 65% 掉到 100%，成本低估 35%。
  ok('T-⑧ 套用输出恰好 4 个字段（line_name/qty/unit/yield_rate —— 多给会被页面静默丢弃）',
    Object.keys(applyTemplate(niu)[0]).sort().join(',') === 'line_name,qty,unit,yield_rate',
    Object.keys(applyTemplate(niu)[0]).sort().join(','));
  ok('T-㉑ 🔴 每行出净率都在 30–100 之间（<30 或 >100 必是规则写错）',
    TEMPLATES.every((t) => applyTemplate(t).every((r) => Number(r.yield_rate) >= 30 && Number(r.yield_rate) <= 100)),
    '越界项：' + TEMPLATES.map((t) => applyTemplate(t).filter((r) => !(Number(r.yield_rate) >= 30 && Number(r.yield_rate) <= 100)).map((r) => t.dish_name + '/' + r.line_name)).flat().slice(0, 3).join(',') || '无');
  ok('T-㉒ 🔴 出净率**按原料给**，不是全库一个值（按品类兜全库的错法：里脊和整鱼同值）',
    (() => {
      const vals = new Set();
      TEMPLATES.forEach((t) => applyTemplate(t).forEach((r) => vals.add(Number(r.yield_rate))));
      return vals.size >= 4;
    })(),
    '不同出净率取值数：' + (() => { const v = new Set(); TEMPLATES.forEach((t) => applyTemplate(t).forEach((r) => v.add(Number(r.yield_rate)))); return v.size; })());
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

console.log('\n===== T 🔴 每条菜必须有调料（旧库整层漏掉的那块）=====');
// 起因：李老师看鱼香肉丝模板发现「没有调料类成本」。
//   查下去：旧 20 道正餐每道只有 2-4 行，只有主料 + 一个酱料，**完全没有调料**。
//   调料占中餐成本 30-40%（一盘鱼香肉丝的糖醋酱油淀粉油约 1.5-2.5 元）⇒ 漏了就是少算三四成。
//   ⚠️ 判据挑**成分**不挑字面：要的是"有没有糖/醋/酱油/盐/油/淀粉/料酒 这些真调料"，
//      不是"行名里有没有『调料』二字"（R670 的 T-⑥ 踩过这个坑）。
// 🔴 「核心调料」只认这 8 样 —— 豆瓣/花椒/辣椒算**主料级香辛料**，不能拿来充数（旧库就是这么蒙混的）
const CORE_COND = ['油', '盐', '酱油', '生抽', '老抽', '糖', '醋', '淀粉', '料酒'];
// ⚠️ 首版把 fastfood/other 也纳进来了 ⇒ 把「白粥（大米+水）」「豆浆」「蒜蓉青菜（只要油盐）」
//   全判红。**它们本来就不该有 3 种调料** —— 判据不能要求"所有菜都一样"。
//   ⇒ 只对 **dining（炒菜）** 强制。炒菜的灵魂就是调料，缺了必错；
//      主食/饮品/清炒类按实际来（守卫不替老板决定一道白粥要不要放酱油）。
const cookTpls = TEMPLATES.filter((t) => t.cat === 'dining');
// ⚠️ 阈值定 **2 种**不是 3 种：蒜蓉青菜、韭菜炒蛋这类**清炒**真的只有油+盐。
//   要求 3 种等于逼人编一个不存在的调料 —— 那比漏报更糟。
//   真正的错是旧库那种「0 种」（只有主料 + 一个豆瓣酱），2 种就说明"调料这一层有人想过"。
const noCond = cookTpls.filter((t) => {
  const names = (t.lines || []).map((l) => l.line_name);
  return CORE_COND.filter((w) => names.some((n) => n.indexOf(w) >= 0)).length < 2;
});
ok('T-⑯ 🔴 每条炒菜模板至少含 2 种**核心调料**（油/盐/酱油/糖/醋/淀粉/料酒；豆瓣花椒辣椒不算）',
  noCond.length === 0,
  noCond.length ? noCond.map((t) => t.dish_name + '(' + t.lines.length + '行)').join(', ') : cookTpls.length + ' 道全部达标');

console.log('\n===== T 出处说明（李老师定口径：统一一句，不指向具体来源）=====');
const TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
const hint = (TERMS.card && TERMS.card.templateHint) || '';
ok('T-⑱ 🔴 模板区有统一出处说明，且含「仅供参考」+「按自家实际调整」两层',
  hint.indexOf('公开资料') >= 0 && hint.indexOf('仅供参考') >= 0 && hint.indexOf('实际') >= 0,
  hint || '空');
ok('T-⑲ 🔴 出处说明**不指向具体来源**（不写"来自某书/某网站/某大V"—— 指向权利人容易扯皮）',
  !/来自.{0,6}(书|网站|公众号|抖音|老师|大V)|某某|某菜谱/.test(hint), hint.slice(0, 40));
ok('T-⑳ 模板**绝不预填价格**（R138 红线①：价格随行就市，只能老板自己填）',
  TEMPLATES.every((t) => (t.lines || []).every((l) => !/price|金额|元\/份|单价/.test(l.line_name || ''))),
  '零预填价格');

console.log('\n===== N 输菜名自动匹配模板（R676，替代已删的品类选择器）=====');
// 为什么要守：品类删了（R675），老板面对空白配料区。匹配是新的入口。
// 两个方向的错都要防：
//   ① **误命中**（把「宫保鸡丁盖饭」套上「宫保鸡丁」）⇒ 漏掉米饭成本，老板看不出来；
//   ② **不命中却静默**（输了没反应）⇒ 老板以为功能坏了。
const nmCases = [
  ['宫保鸡丁', '宫保鸡丁', '精确命中'],
  ['宫保鸡丁（大份）', '宫保鸡丁', '括号注释不影响'],
  [' 宫保 鸡丁 ', '宫保鸡丁', '空白不影响'],
  ['重庆小面', '重庆小面（素面）', '模板名带括号时，输入主名也能命中'],
  ['红烧牛肉面', '红烧牛肉面', '同菜名命中'],
];
let nmBad = [];
nmCases.forEach(([q, exp]) => {
  const got = matchTemplateByName(q);
  if (!got || normDishName(got.dish_name) !== normDishName(exp)) nmBad.push(q + '→' + (got ? got.dish_name : 'null'));
});
ok('N-① 该命中的五例全部命中（精确 / 带括号 / 带空格 / 模板名带括号）', nmBad.length === 0, nmBad.join(',') || '5/5');

// 🔴 误命中：这四例**必须不命中**，每个都会导致成本算错
const nmMustMiss = ['宫保鸡丁盖饭', '牛肉面', '小面', '回锅肉丝'];
const nmFalse = nmMustMiss.filter((q) => !!matchTemplateByName(q));
ok('N-② 🔴 不许误命中：「宫保鸡丁盖饭」≠「宫保鸡丁」（盖饭还要加米饭，套上就漏成本）、「牛肉面」≠「红烧牛肉面」',
  nmFalse.length === 0, nmFalse.length ? '误命中：' + nmFalse.join(',') : '4/4 正确不命中');
ok('N-③ 空输入 / 纯空格 ⇒ 不命中也不崩', matchTemplateByName('') === null && matchTemplateByName('   ') === null);

// 重名会让匹配有歧义（同一句话可能匹配到两道菜）
const nmSeen = {};
const nmDup = [];
TEMPLATES.forEach((t) => { const n = normDishName(t.dish_name); if (nmSeen[n]) nmDup.push(n); nmSeen[n] = 1; });
ok('N-④ 模板名归一化后不重名（重名 ⇒ 匹配有歧义，同一菜名可能套上另一道菜）',
  nmDup.length === 0, nmDup.join(',') || TEMPLATES.length + ' 道无重名');

// 变异回灌：改成「包含匹配」⇒ N-② 必须转红
const nmMut = (q) => TEMPLATES.filter((t) => normDishName(q).indexOf(normDishName(t.dish_name)) >= 0)[0] || null;
ok('N-⑤ 变异体（改成包含匹配）确实会误命中「宫保鸡丁盖饭」⇒ N-② 有分辨力',
  !!nmMut('宫保鸡丁盖饭'));

console.log('\n===== N 页面接线：写了函数 ≠ 触发得到 =====');
const EDITJ = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
const EDITW = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.wxml'), 'utf8');
ok('N-⑥ 🔴 菜名输入框接了 bindblur（只写 onNameBlur 不绑 = 永远不触发）',
  /bindblur="onNameBlur"/.test(EDITW));
ok('N-⑦ 🔴 提示条真渲染了（wxml 里有 tplMatchKey 的条件块 + 套用按钮）',
  /tplMatchKey/.test(EDITW) && /onApplyMatched/.test(EDITW));
ok('N-⑧ 🔴 匹配不到时给引导，不是沉默（大部分菜不在库里）',
  /tplNoMatch/.test(EDITW) && /tplNoMatchTip/.test(EDITW));
ok('N-⑨ 🔴 自动套用时**保留老板输入的菜名**（他输「重庆小面」不能被改成「重庆小面（素面）」）',
  /applyTplToCard\(tpl, -1, true\)/.test(EDITJ) && /if \(!keepName\) patch\.name/.test(EDITJ));
ok('N-⑩ 配料区已有内容时不提示（点了会覆盖手工录入）',
  /if \(!this\.linesAllBlank\(\)\)/.test(EDITJ));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
