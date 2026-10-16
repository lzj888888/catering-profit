'use strict';
/** R299 记忆维护：外移三条到 MEMORY_外移_202610.md（只搬不删、可原样搬回） */
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/.workbuddy/memory';
const MAIN = path.join(DIR, 'MEMORY.md');
const ARCH = path.join(DIR, 'MEMORY_外移_202610.md');
const chars = (s) => Array.from(s).length;

const ANCHORS = [
  'R68 顶层块切分要求行尾',
  '`SWITCH_KEYS` ≠ 全仓键词表',
  '模拟器/真机取证两坑（R294）',
];
const COMP = {
  'R68 顶层块切分要求行尾': '- 🔴 **R68 顶层块切分（R298X 踩到）**：`check_selftest_shape.js` 对**多行链式调用**判「无法定界」并 fail-closed ⇒ **只能写成单行**。细则 ⇒ 外移件 〔原 L40〕。',
  '`SWITCH_KEYS` ≠ 全仓键词表': '- 🔴 **`SWITCH_KEYS` ≠ 全仓键词表（R298X 元认知）**：它只是"`saveShopSetting` 会写的键"。判跨函数同源须 **repo-wide 词表 + 命名约定扫描腿**。细则 ⇒ 外移件 〔原 L41〕。',
  '模拟器/真机取证两坑（R294）': '- 🔴 **模拟器/真机取证两坑（R294）**：判「算完了」须 `await p.onCalcPresetFwd()`/`onGenerate()`（`loading===false` 读的是**上一次旧结果**）；探针裸调 `wx.cloud.callFunction` **必须自带 `shop_id`** ⇒ 否则恒 `INVALID_PARAM`。细则 ⇒ 外移件 〔原 L30〕。',
};

let main = fs.readFileSync(MAIN, 'utf8');
const before = chars(main);
let arch = fs.readFileSync(ARCH, 'utf8');
if (!arch.endsWith('\n')) arch += '\n';
arch += '\n---\n\n## 〔R299 · 2026-10-16〕注入层治理四次外移（**只搬不删、可原样搬回**）\n\n';

for (const a of ANCHORS) {
  const line = main.split('\n').find((l) => l.includes(a));
  if (!line) throw new Error('锚点未命中: ' + a);
  arch += '- 〔原 ' + a.slice(0, 24) + '…〕' + line.replace(/^-\s*/, '') + '\n\n';
  main = main.replace(line, COMP[a]);
}
fs.writeFileSync(ARCH, arch, 'utf8');
fs.writeFileSync(MAIN, main, 'utf8');
console.log('主 MEMORY.md：' + before + ' → ' + chars(main) + '（余 ' + (8000 - chars(main)) + '）');
console.log('外移件：' + chars(fs.readFileSync(ARCH, 'utf8')) + ' 码点（蒸馏阈值 60000）');
