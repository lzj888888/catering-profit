'use strict';
/** R302 记忆维护：外移两条到 MEMORY_外移_202610.md（只搬不删、可原样搬回） */
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/.workbuddy/memory';
const MAIN = path.join(DIR, 'MEMORY.md');
const ARCH = path.join(DIR, 'MEMORY_外移_202610.md');
const chars = (s) => Array.from(s).length;

const ANCHORS = [
  '摊销金额有 3 份手写引擎',
  '同族病第八例 + 元发现',
];
const COMP = {
  '摊销金额有 3 份手写引擎': '- 🔴🔴 **摊销金额有 3 份手写引擎（R453）** ⇒ 改任一份必跑 `selftest_batch8c`（已补行为面对拍 59→70）；当前三份全等。细则 ⇒ 外移件 〔原 L37〕。',
  '同族病第八例 + 元发现': '- 🔴🔴 **同族病第八例 + 元发现（R298·#443 M1）**：月度页三态判据写 `{{r}}` 而 `getLedger` 对无账本月**返回默认空账** ⇒ 恒真 ⇒ 未建档月挂红带「亏损」。正确判据 = **`account_id` 非空**。⇒ **元发现：守卫只守「分支在不在」，不守「分支到不到」**。细则 ⇒ 外移件 〔原 L33〕。',
};

let main = fs.readFileSync(MAIN, 'utf8');
const before = chars(main);
let arch = fs.readFileSync(ARCH, 'utf8');
if (!arch.endsWith('\n')) arch += '\n';
arch += '\n---\n\n## 〔R302 · 2026-10-17〕注入层治理五次外移（**只搬不删、可原样搬回**）\n\n';

for (const a of ANCHORS) {
  const line = main.split('\n').find((l) => l.includes(a));
  if (!line) throw new Error('锚点未命中: ' + a);
  arch += '- 〔原锚点「' + a + '」〕' + line.replace(/^-\s*/, '') + '\n\n';
  main = main.replace(line, COMP[a]);
}
fs.writeFileSync(ARCH, arch, 'utf8');
fs.writeFileSync(MAIN, main, 'utf8');
console.log('主 MEMORY.md：' + before + ' → ' + chars(main) + '（余 ' + (8000 - chars(main)) + '）');
console.log('外移件：' + chars(fs.readFileSync(ARCH, 'utf8')) + ' 码点（蒸馏阈值 60000）');
