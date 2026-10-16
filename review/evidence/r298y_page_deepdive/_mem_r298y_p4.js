'use strict';
/** R298Y 收尾 · 记忆维护第四遍（压抬头 + 修正过期套件号 167→不写数字） */
const fs = require('fs');
const path = require('path');
const MAIN = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/.workbuddy/memory/MEMORY.md';
const chars = (s) => Array.from(s).length;
let main = fs.readFileSync(MAIN, 'utf8');
const before = chars(main);

const pairs = [
  ['> 🔴 **注入上限 8000 字符**（超即截断 = 记忆失效），现有**机器守卫**（第 167 套件 `tools/check_memory_budget.js`）。',
   '> 🔴 **注入上限 8000 字符**（超即截断 = 记忆失效），**机器守卫** `tools/check_memory_budget.js`（**别在此写套件号**，会漂）。'],
  ['> 🔴 **三槽分工，不重复抄同一段**：本文件答「**为什么**」｜行为纪律 `.codebuddy/rules/店算军规.md`（答"必须怎么做"）｜路径与命令 `CODEBUDDY.md`（答"在哪"）｜细则旧文 `MEMORY_外移_202610.md`（**只搬不删、可原样搬回**）。',
   '> 🔴 **三槽分工，不重复抄**：本文件答「**为什么**」｜纪律 `rules/店算军规.md`｜路径命令 `CODEBUDDY.md`｜细则 `MEMORY_外移_202610.md`（**只搬不删、可原样搬回**）。'],
];
for (const [a, b] of pairs) {
  if (!main.includes(a)) throw new Error('抬头锚点未命中: ' + a.slice(0, 24));
  main = main.replace(a, b);
}
fs.writeFileSync(MAIN, main, 'utf8');
const after = chars(main);
console.log('主 MEMORY.md：' + before + ' → ' + after + '（余 ' + (8000 - after) + '）');
