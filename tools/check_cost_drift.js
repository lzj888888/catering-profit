// tools/check_cost_drift.js —— 【R309】成本变动提醒守卫
// 运行：node tools/check_cost_drift.js      （EXIT 0 = 全绿）
//
// 背景（李老师放权「你做主·简单省心·刚需」）：
//   食材涨价是餐饮老板**最痛的变量**，而成本卡的**版本模型里已经存着两版成本**
//   ⇒ 不用他多填一个字，就能主动说"这道菜成本涨了 8%"。
//
// 🔴 本守卫守的是「**不许编数**」（本仓头号危害）：
//   ① 没有上一版 ⇒ `null`，**不能是 0**（0 会被读成"上版成本是 0" ⇒ 涨幅虚报成 100%+）；
//   ② 上一版成本 ≤ 0 ⇒ **不显示**（除零 / 无意义）；
//   ③ 变化不足 1% ⇒ **不显示**（不打扰）；
//   ④ 取的是「version **小于**当前的最大者」，不是想当然的 `version - 1`（版本号会断号：1,2,5）。
//
// ⚠️ 本守卫是**源码级**（不执行）：云函数 `index.js` 依赖 wx-server-sdk，页面文件调用 `Page()`
//   都不能在 Node 里直接跑 ⇒ 用**锚定到具体代码块**的正则 + 反恒真样本，而不是全文 grep（防"别处也有同名"）。
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); }
}
function rd(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } }
function block(src, start, len) {
  const i = src.indexOf(start);
  return i < 0 ? '' : src.slice(i, i + (len || 900));
}

const cf = rd('cloudfunctions/getCostCard/index.js');
const page = rd('pages/card/index.js');
const wxml = rd('pages/card/index.wxml');
const cfBlock = block(cf, 'out.prev_total_cost_fen', 1) ? block(cf, 'let prevCost = null', 900) : '';
const helper = block(page, 'function costDriftText(c)', 900);

ok('⓪ 自失效护栏：三份源码非空 + 两个目标代码块都定位到（防读空文件/锚点漂移 ⇒ 恒真）',
  cf.length > 3000 && page.length > 10000 && wxml.length > 3000
  && cfBlock.length > 100 && helper.length > 200);

// ① 云函数：取「小于当前的最大 version」，且 null 兜底
ok('①-a 🔴 云函数取的是「version **小于**当前」的上一版（`ver >= 当前` 跳过），'
  + '不是死算 `version - 1` —— 版本号会断号（1,2,5）',
  /ver\s*>=\s*\(Number\(card\.version\)\s*\|\|\s*1\)\)\s*continue/.test(cfBlock));
ok('①-b 🔴 没有上一版 ⇒ `prev_total_cost_fen = null`（**不是 0**）—— 0 会被读成"上版成本是 0"，'
  + '涨幅就虚报成 100%+',
  /prevCost\s*&&\s*prevCost\.cost\s*!=\s*null\s*\?\s*prevCost\.cost\s*:\s*null/.test(cfBlock)
  && !/prev_total_cost_fen\s*=\s*0/.test(cfBlock));
ok('①-c 成本缺失也回 null（`v.total_cost != null` 判据在位）',
  /v\.total_cost\s*!=\s*null\s*\?\s*v\.total_cost\s*:\s*null/.test(cfBlock));

// ② 前端：三种"不显示"
ok('②-a 🔴 `prev_total_cost_fen` 为 null/undefined ⇒ 直接回空串（不是 0、不是 "涨100%"）',
  /pv\s*===\s*null\s*\|\|\s*pv\s*===\s*undefined/.test(helper));
ok('②-b 🔴 上一版成本 ≤0 ⇒ 回空串（不许除零）',
  /!\(p\s*>\s*0\)\s*\|\|\s*!\(n\s*>=\s*0\)/.test(helper));
ok('②-c 变化不足 1% ⇒ 回空串（`if (!d) return`；不打扰老板）',
  /if\s*\(!d\)\s*return\s*''/.test(helper));

// ③ 接线：真的挂在列表行上、真的渲染
ok('③-a 列表 map 里真的调用了 `costDriftText(c)`（不是死函数）',
  /driftText:\s*costDriftText\(c\)/.test(page));
ok('③-b 模板里真的渲染了 `item.driftText`（不是算了不用）',
  /wx:if="\{\{item\.driftText\}\}"/.test(wxml));

// ④ 反恒真
ok('④-a 反恒真：把「用 0 兜底」的样本喂给 ①-b 的判据 ⇒ 必须判不通过',
  !(/prevCost\s*&&\s*prevCost\.cost\s*!=\s*null\s*\?\s*prevCost\.cost\s*:\s*null/.test(
    'out.prev_total_cost_fen = 0;')
    && !/prev_total_cost_fen\s*=\s*0/.test('out.prev_total_cost_fen = 0;')));
ok('④-b 反恒真：把「死算 version-1」的样本喂给 ①-a 的判据 ⇒ 必须判不通过',
  !/ver\s*>=\s*\(Number\(card\.version\)\s*\|\|\s*1\)\)\s*continue/.test(
    'const prevDoc = byVersion.get(cc + "#" + (card.version - 1));'));

const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 成本变动提醒校验失败 ' + problems.length + ' 处：');
  problems.forEach((x) => console.log('   ' + x));
  console.log('❌ 成本变动校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 成本变动提醒校验通过（null 不冒充 0 · 不许除零 · <1% 不打扰 · 断号版本取前一版）');
console.log('✅ 成本变动校验：' + total + ' 通过 / 0 失败');
