// _check_r156_refs.js —— 模板↔逻辑 悬空引用自检（R156）
// 起因：本轮把「原生 picker + onMaterialChange」换成「独立页 + goPickMaterial」，
//   最容易犯的错就是模板改了、函数没写（真机上表现为点了没反应，且**不报错**）。
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/';

const pairs = [
  ['pages/card/edit.wxml', 'pages/card/edit.js', ['goPickMaterial', 'backToList']],
  ['pages/card/index.wxml', 'pages/card/index.js', ['onPin']],
  ['pages/material/index.wxml', 'pages/material/index.js', ['onPin']],
  ['pages/material/edit.wxml', 'pages/material/edit.js', ['backToList']],
  ['pages/material/pick.wxml', 'pages/material/pick.js', ['onPick', 'onKeyword']],
];

let bad = 0;
for (const [w, j, ms] of pairs) {
  const ws = fs.readFileSync(ROOT + w, 'utf8');
  const js = fs.readFileSync(ROOT + j, 'utf8');
  for (const m of ms) {
    const inTpl = ws.indexOf(m) >= 0;
    // 定义形态：`name(` 或 `name:`
    const defined = new RegExp('(^|[^A-Za-z0-9_])' + m + '\\s*[(:]').test(js);
    if (inTpl && !defined) { bad++; console.log('BAD  ' + w + ' 用到 ' + m + '，但 ' + j + ' 里找不到定义'); }
    else if (inTpl) console.log('OK   ' + m + '   (' + w + ' -> ' + j + ')');
    else console.log('SKIP ' + m + '   (模板未用到)');
  }
}

// WXML 禁止方法调用：排序/筛选必须在 JS 里打好标记（`pinned`），不能写 xxx.indexOf(...)
const wxmls = ['pages/card/index.wxml', 'pages/material/index.wxml'];
for (const w of wxmls) {
  const s = fs.readFileSync(ROOT + w, 'utf8');
  const m = s.match(/\{\{[^}]*\.(indexOf|includes|split|trim|find|filter|map)\s*\(/);
  if (m) { bad++; console.log('BAD  ' + w + ' 在 WXML 表达式里调用了方法（不支持）: ' + m[0]); }
  else console.log('OK   ' + w + ' 无 WXML 方法调用');
}

console.log(bad ? ('>>> ' + bad + ' 处问题') : '>>> 模板↔逻辑 引用全部闭合');
process.exitCode = bad ? 1 : 0;
