// tools/check_category_filter.js —— 菜品分类候选脏值守卫（R666）
//
// 起因：李老师反馈「新建成本卡选分类时，出来的是『猪肉 多少多少』」。
// 查证结论：**代码里找不到它变成分类的路径**（预置表干净、写入点只存老板填的、导入默认空）
//   ⇒ 根因待定，本轮做的是**入口防御**。
//
// 所以本守卫要守的不是"根因修好了"，而是**两件更实际的事**：
//   ① 脏值**真的挡得住**（否则防御没意义）
//   ② 干净的分类**不许被误挡** —— 这条比 ① 更要紧：
//      把「大口吃肉」这种老板有意起的营销栏目名挡掉，等于替他改字，
//      R626 已经踩过一次（"我明明填了却变了"）。
//
// ⚠️ 判据是**真跑纯函数**，不是 grep 字符串 —— 分类规则这种东西，字符串在那里、行为可能完全不同。

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const { isDirtyCat } = require(path.join(ROOT, 'utils/categoryFilter.js'));
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const fs = require('fs');
const EDIT = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');

console.log('\n===== D 脏值挡得住（李老师报的那类）=====');
const DIRTY = ['猪肉 200g', '猪肉200克', '鸡蛋 3 个', '油 50 毫升', '盐 5g', '50', '3.5', ''];
DIRTY.forEach((v, i) => {
  ok('D-' + (i + 1) + ' 挡掉 ' + JSON.stringify(v), isDirtyCat(v) === true);
});

console.log('\n===== D 干净的分类不许被误挡（比 D-1 更要紧）=====');
// 用**真实预置表**跑 —— 预置表本身就是老板最常点的那些，一个都不许挡
const presets = TERMS.card.dishCats || [];
const blockedPresets = presets.filter((p) => isDirtyCat(p));
ok('D-⑨ 🔴 预置分类表全部通过（' + presets.length + ' 个：' + presets.join('/') + '）',
  blockedPresets.length === 0, blockedPresets.length ? '被误挡：' + blockedPresets.join(',') : '零误挡');
// R626 的教训：老板自己起的营销栏目名
const LEGIT = ['大口吃肉', '招牌菜', '本店特色', '营销栏目-大口吃肉', '锅底', '蘸料'];
const blockedLegit = LEGIT.filter((v) => isDirtyCat(v));
ok('D-⑩ 🔴 老板自起的栏目名不被误挡（R626 教训：替他改字＝"我明明填了却变了"）',
  blockedLegit.length === 0, blockedLegit.length ? '被误挡：' + blockedLegit.join(',') : LEGIT.join('/') + ' 全通过');

console.log('\n===== D 页面接线 =====');
ok('D-⑪ 页面调用纯函数，不自己再写一套判定（两处规则必然分叉）',
  /catFilter[.]isDirtyCat[(]/.test(EDIT) && !/staticIsDirtyCat/.test(EDIT));
// 判据用位置关系，不猜括号写法：push(cur) 必须在 hist.forEach 之前，且 catFilter 只出现在 hist 那一句上
const iPushCur = EDIT.indexOf('push(cur);');
const iHistFor = EDIT.indexOf('hist.forEach');
const iCatFilter = EDIT.indexOf('catFilter.isDirtyCat');
ok('D-⑫ 🔴 只过滤**历史**，不过滤**当前值** —— 已存的脏值要让老板看见能改，藏起来等于让他继续存错',
  iPushCur > 0 && iHistFor > iPushCur && iCatFilter > iHistFor,
  'push(cur)@' + iPushCur + ' → hist.forEach@' + iHistFor + ' → isDirtyCat@' + iCatFilter);
ok('D-⑬ 预置表仍在候选里（不能因为过滤把正道也堵了）',
  /categoryOptions \|\| TERMS[.]card[.]dishCats/.test(EDIT));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
