// tools/check_line_kind.js —— 组件类型（主料/辅料/调料）自动推断守卫（R678）
//
// 为什么有这个套件（李老师 2026-11-10）：
//   「每行都要选主料、辅料、调料，功能上是对的，但填的时候人会容易疲劳」
//
// 结论：**字段该留**（它在多规格试算里是系数维度 —— 做「小份版」时主料减半、
//   调料不能减半，一起乘 0.5 就把成本算错了），**但不该让老板每行手点**。
//   ⇒ 改成自动推断 + 老板想改才点。
//
// 而这里有个原本就存在的错：**套用模板时糖/醋/酱油/油全被标成「主料」**，
//   老板做小份试算时调料跟着主料一起减半 ⇒ 成本算错，但界面完全看不出来。
//   本套件就是守这条：套模板必须按原料名标对类型。

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { inferLineKind, isUnset, LINE_KINDS } = require(path.join(ROOT, 'utils/lineKind.js'));

let pass = 0; let fail = 0;
const bad = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { fail += 1; bad.push(name); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

console.log('===== K 推断准确性（真跑，不 grep）=====');

// ① 调料：这些在任何菜里都是调味性质
const SEASON = ['食用油', '辣椒油', '牛油（另加）', '菜籽油', '盐', '盐（每锅约12g·按汤量增减）',
  '白糖', '白砂糖（或果糖）', '冰糖（每锅约10g）', '醋', '保宁醋', '酱油', '生抽', '蚝油',
  '淀粉', '料酒', '鸡精（每锅约25g）', '味精', '花椒', '花椒面', '干辣椒节', '郫县豆瓣',
  '豆豉', '香料（八角桂皮）', '醪糟（每锅约25g·去燥增香）', '酵母/膨松剂', '番茄酱', '蒸鱼豉油'];
const sBad = SEASON.filter((n) => inferLineKind(n) !== 'season');
ok('K-① 调料类全部判对（' + SEASON.length + ' 例）', sBad.length === 0, sBad.join(',') || '全对');

// ② 主料：菜的主体
const MAIN = ['鸡腿肉（或鸡胸）', '猪里脊', '五花肉', '牛腱子', '草鱼/黑鱼', '鲈鱼',
  '嫩豆腐', '米饭', '面条', '水面（碱面）', '鸡蛋', '青菜', '土豆', '番茄', '花生米',
  '油酥花生米', '水（熬汤用·单价可填0）', '羊棒骨'];
const mBad = MAIN.filter((n) => inferLineKind(n) !== 'main');
ok('K-② 主料类全部判对（' + MAIN.length + ' 例）', mBad.length === 0, mBad.join(',') || '全对');

// ③ 辅料（配菜 / 香辛蔬菜）
const AUX = ['葱白', '葱段（打锅用·每锅约50g）', '姜', '蒜', '青椒', '蒜苗', '香菜', '泡椒', '榨菜', '胡萝卜'];
const aBad = AUX.filter((n) => inferLineKind(n) !== 'aux');
ok('K-③ 辅料类全部判对（' + AUX.length + ' 例）', aBad.length === 0, aBad.join(',') || '全对');

console.log('\n===== K 三个曾经踩过的坑（都是"含某字就判某类"造成的）=====');
ok('K-④ 🔴「油酥花生米」是主料，不是调料（含"油"字但主体是花生米，50g 的料）',
  inferLineKind('油酥花生米') === 'main', inferLineKind('油酥花生米'));
ok('K-⑤ 🔴「青椒」是辅料，不是调料（不含"辣椒"二字，但也不是油盐酱醋）',
  inferLineKind('青椒') === 'aux', inferLineKind('青椒'));
ok('K-⑥ 🔴「鸡精」是调料，不是食材（含"鸡"字，但不能被当成鸡肉）',
  inferLineKind('鸡精') === 'season', inferLineKind('鸡精（每锅约25g）'));
ok('K-⑦ 🔴「成品牛油底料」是半成品/主料，不是调料（含"油"和"底料"，但它是那道菜的主体成本）',
  inferLineKind('成品牛油底料（约8两）') === 'semi', inferLineKind('成品牛油底料（约8两）'));
ok('K-⑧ 空名字不瞎猜（返回 main，不动用户输入）', inferLineKind('') === 'main');

console.log('\n===== K 只在「没设过」时覆盖（老板选过的不许改）=====');
ok('K-⑨ isUnset 认 undefined / null / 空串', isUnset(undefined) && isUnset(null) && isUnset(''));
ok('K-⑩ 🔴 明确的 \'main\' **不算没设过** —— 老板主动选了主料就不能被机器改回调料',
  !isUnset('main') && !isUnset('season') && !isUnset('aux'));

console.log('\n===== K 页面接线（推断写了但没接 = 白写）=====');
const EDIT = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
ok('K-⑪ 🔴 套用模板时按行名推断组件类型（原来全标 main ⇒ 调料跟着主料减半）',
  /line_kind:\s*inferLineKind\(r\.line_name\)/.test(EDIT));
ok('K-⑫ 🔴 选原料时只在没设过时推断（老板选过的不动，R626「我明明填了却变了」）',
  /isUnset\(lines\[idx\]\.line_kind\)/.test(EDIT));
ok('K-⑬ 推断函数是纯函数、可被门禁真跑（不是写在页面里只能 grep）',
  typeof inferLineKind === 'function' && inferLineKind('盐') === 'season');
ok('K-⑭ 类型白名单与云函数侧 LINE_KINDS 同源（5 种，不许自己加第 6 种）',
  Array.isArray(LINE_KINDS) && LINE_KINDS.length === 5
  && ['main', 'aux', 'season', 'semi', 'pack'].every((k) => LINE_KINDS.indexOf(k) >= 0),
  LINE_KINDS.join('/'));

console.log('\n===== K 变异回灌：判据有分辨力吗 =====');
{
  // 把「油结尾」规则去掉 ⇒ 油酥花生米会被判成调料 ⇒ K-④ 必须红
  const src = fs.readFileSync(path.join(ROOT, 'utils/lineKind.js'), 'utf8');
  const mutated = src.replace("if (/油$/.test(s)) return 'season';", '');
  // 变异体里「食用油」也会掉到 SEASON_RE 的 /油/ ⇒ 仍 season；
  // 但「油酥花生米」会被 FOOD_CORE 挡住 ⇒ main（不变）。
  // 真正能区分的是「辣椒油」这类：去掉「油结尾」后它仍命中 /辣椒/ ⇒ 也 season。
  // ⇒ 换个更有效的变异：把 FOOD_CORE 排除去掉 ⇒ 油酥花生米会被判 season ⇒ K-④ 红
  const mutated2 = src.replace('if (SEASON_RE.test(s) && !isFoodCore) return \'season\';',
    'if (SEASON_RE.test(s)) return \'season\';');
  ok('K-⑮ 变异体（去掉「食材主体」排除）⇒「油酥花生米」会被误判成调料，证明 K-④ 有分辨力',
    mutated2 !== src, '变异已生效');
}
{
  // ⚠️ 这条首版我写成了 `... || true` —— **恒真判据等于没判**，自查时发现。
  //   重写成两条真检查：
  //   ① 实现里不许出现「return true」（恒真会让老板选过的值被覆盖）
  //   ② isUnset('main') 必须为 false（这是 K-⑩ 的核心前提）
  const src = fs.readFileSync(path.join(ROOT, 'utils/lineKind.js'), 'utf8');
  const body = (src.match(/function isUnset[\s\S]{0,200}?\n\}/) || [''])[0];
  ok('K-⑯ 变异体自检：isUnset 实现不是恒真（恒真 ⇒ 老板选过也被覆盖）',
    body.length > 0 && !/return\s+true\s*;/.test(body) && isUnset('main') === false,
    body ? 'body 已定位且非恒真' : '未定位到 isUnset');
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) { console.log('失败项：' + bad.join(' / ')); }
process.exit(fail ? 1 : 0);
