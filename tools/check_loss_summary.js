// tools/check_loss_summary.js —— 月底「N 道菜 M 道在亏」守卫（R661 · M3 Phase 2b）
//
// 这条的难点不在"算出来"，在**什么时候不该出句**：
//   · N<3：两道菜里一道亏就下结论，老板会反问"就两道也算？" ⇒ 不如不说；
//   · 截断：拿到半份数据就给结论，比不说更糟；
//   · 0% 保本不是亏、未定价不是亏 —— 混淆了会让"都赚钱"的店被报"有 5 道在亏"。
// 所以本守卫**真跑纯函数**，不靠 grep 字符串（字符串在那里、判据可能是恒真的）。

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const L = require(path.join(ROOT, 'utils/lossSummary.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'utils/lossSummary.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/result.js'), 'utf8');
const XML = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/result.wxml'), 'utf8');

const mk = (m) => ({ marginPct: m });
const r = (arr, trunc) => L.buildLossSummary(arr, trunc);

console.log('\n===== L 口径：什么才算亏 =====');
ok('L-① 🔴 负毛利算亏', r([mk(10), mk(20), mk(-5)], false).m === 1);
ok('L-② 🔴 0%（保本）**不算**亏（保本店不该被报"在亏"）', r([mk(10), mk(0), mk(20)], false).m === 0);
ok('L-③ 🔴 未定价（null / undefined / 空串）**不算**亏', r([mk(null), mk(undefined), mk(''), mk(10)], false).m === 0);
// ⚠️ 首跑这条是红的 —— 但不是代码错了，是**判据被自己的注释命中**：
//   注释里写着「绝不自己写 `marginPct < 0`」，字面上正好含这个片段。
//   ⇒ 判据必须先剥注释再查，否则"越强调不许写、越会被判成写了"（假阳性，比漏判更耗人）。
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC_CODE = stripComments(SRC);
ok('L-④ 判据走 marginAlert 单源，代码里不自己写「负毛利」比较（已剥注释后判）',
  /isLossMaking/.test(SRC_CODE) && !/marginPct\s*<\s*0/.test(SRC_CODE));

console.log('\n===== L 边界：什么时候不该出句（真跑）=====');
ok('L-⑤ 🔴 N=2 不出句（样本太小会显得武断）', r([mk(10), mk(-5)], false).text === '');
ok('L-⑥ N=0 不出句', r([], false).text === '');
ok('L-⑦ 🔴 截断不出句（宁可不说，不拿半份数据给结论）',
  r([mk(10), mk(20), mk(-5)], true).text === '');
ok('L-⑧ 截断时 hasLoss 也必须为 false（否则页面会标红却无字）',
  r([mk(-1), mk(-1), mk(-1)], true).hasLoss === false);

console.log('\n===== L 出句：说人话且数字对 =====');
const c1 = r([mk(10), mk(20), mk(-5)], false);
ok('L-⑨ N=3 M=1 出句且数字正确', c1.text.indexOf('3 道菜') >= 0 && c1.text.indexOf('1 道在亏本卖') >= 0, c1.text);
ok('L-⑩ hasLoss 为真（页面据此标红）', c1.hasLoss === true);
const c2 = r([mk(10), mk(20), mk(30)], false);
ok('L-⑪ 🔴 M=0 换句（不能出「0 道在亏本卖」那种别扭话）',
  c2.text.indexOf('都赚钱') >= 0 && c2.text.indexOf('0 道') < 0, c2.text);
ok('L-⑫ M=0 时 hasLoss 为假（不许标红）', c2.hasLoss === false);
ok('L-⑬ 文案走 terms 单源，纯函数不硬编码句子',
  /TERMS[.]resultPage[.]lossSummary/.test(SRC));

console.log('\n===== L 页面接线 =====');
ok('L-⑭ 页面调用纯函数，不自己再算一遍（两处口径必然分叉）',
  /lossSum[.]buildLossSummary[(]/.test(PAGE) && !/marginPct\s*<\s*0/.test(PAGE));
ok('L-⑮ 🔴 懒加载：在结果页渲染完之后才取（不拖首屏）',
  /this[.]loadChecklist[(]d[)];[\s\S]{0,400}this[.]loadLossSummary[(][)]/.test(PAGE));
ok('L-⑯ 🔴 取不到就静默（锦上添花不许弹错）',
  /loadLossSummary[\s\S]{0,900}catch\s*[(]e[)]\s*{[\s\S]{0,200}lossSummaryText: ''/.test(PAGE));
ok('L-⑰ wxml 真的渲染（算了不显示＝白做）',
  /lossSummaryText/.test(XML) && /t[.]lossSummaryGo/.test(XML));
ok('L-⑱ 与 R443「去看哪道菜」并存但不同层次（先说几道 → 给入口去改）',
  /loss-summary/.test(XML) && /next-link/.test(XML));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
