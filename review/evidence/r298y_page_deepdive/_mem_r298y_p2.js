'use strict';
/** R298Y 收尾 · 记忆维护第二遍（再外移一条 + 压缩三行，目标 <7000） */
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/.workbuddy/memory';
const MAIN = path.join(DIR, 'MEMORY.md');
const ARCH = path.join(DIR, 'MEMORY_外移_202610.md');
const chars = (s) => Array.from(s).length;

let main = fs.readFileSync(MAIN, 'utf8');
const before = chars(main);
const L = main.split('\n');

// --- 1. 再外移 L37 ---
const a37 = '摊销金额有 3 份手写引擎（R453·#453 深挖）';
const i37 = L.findIndex((l) => l.includes(a37));
if (i37 < 0) throw new Error('L37 锚点未命中');
const t37 = L[i37];

let arch = fs.readFileSync(ARCH, 'utf8');
arch += '\n- 〔原 L37〕' + t37.replace(/^-\s*/, '') + '\n';
fs.writeFileSync(ARCH, arch, 'utf8');

const c37 = '- 🔴🔴 **摊销金额有 3 份手写引擎（R453）**：`calcAmortize`/`getAmortSchedule`/`saveLedger` 各手写同一句尾差倒挤 `total_value - base*(N-1)`，而判据只守了 ① ⇒ 任一份漂移 = **页面 ≠ 账本 ≠ 利润表**且门禁照绿。**已补行为面对拍**（`selftest_batch8c` 59→70）⇒ 改任一份必跑它；当前三份**全等**（防漂移缺口、非错账）。细则 ⇒ 外移件 〔原 L37〕。';
if (!main.includes(t37)) throw new Error('L37 已变');
main = main.replace(t37, c37);

// --- 2. 压缩三行 ---
const trims = [
  ['- 🔴 **模拟器/真机取证两坑（R294）**', '- 🔴 **模拟器/真机取证两坑（R294）**：判「算完了」须 `await p.onCalcPresetFwd()`/`onGenerate()`（`loading===false` 读的是**上一次旧结果**）；探针裸调 `wx.cloud.callFunction` **必须自带 `shop_id`** ⇒ 否则恒 `INVALID_PARAM`。细则 ⇒ 外移件 〔原 L30〕。'],
  ['- 🔴🔴 **同族病第八例 + 元发现（R298·#443 M1）**', '- 🔴🔴 **同族病第八例 + 元发现（R298·#443 M1）**：月度页三态判据写 `{{r}}`，而 `getLedger` 对无账本月**返回「默认空账」**⇒ `r` 成功路径**恒真** ⇒ 未建档月挂**红带「亏损」**。🔴 **正确判据 = `account_id` 非空**（**没有"默认账户"这回事**，先例 `pages/index/index.js:98`）。⇒ **元发现：守卫只守「分支在不在」，不守「分支到不到」**。细则 ⇒ 外移件 〔原 L33〕。'],
  ['- 🔴 **M3 成本引擎三副本已有硬守卫', '- 🔴 **M3 成本引擎三副本已有硬守卫 ⇒ 不必重做**（R453）：`check_m3_engine_parity.js` = 真行为对拍 3000 组 + S3 锚点 + 反恒真 D 段（**本仓守卫质量标杆**）。⇒ **M3 下一刀 = 幂等「同一语义 5 份实现」**（未见守卫）。细则 ⇒ 外移件 〔原 L36〕。'],
];
for (const [prefix, full] of trims) {
  const idx = L.findIndex((l) => l.startsWith(prefix));
  const cur = main.split('\n').find((l) => l.startsWith(prefix));
  if (!cur) throw new Error('压缩锚点未命中: ' + prefix);
  main = main.replace(cur, full);
}

fs.writeFileSync(MAIN, main, 'utf8');
const after = chars(main);
console.log('主 MEMORY.md：' + before + ' → ' + after + '（余 ' + (8000 - after) + '）');
console.log('外移件：' + chars(fs.readFileSync(ARCH, 'utf8')) + ' 码点');
