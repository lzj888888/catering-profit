'use strict';
/**
 * R298Y 收尾 · 记忆维护一步脚本（只搬不删 + 新增两条裁决态）
 * 走脚本文件而非内联 -c：内容含反引号/中文标点。
 */
const fs = require('fs');
const path = require('path');

const DIR = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/.workbuddy/memory';
const MAIN = path.join(DIR, 'MEMORY.md');
const ARCH = path.join(DIR, 'MEMORY_外移_202610.md');

const chars = (s) => Array.from(s).length;

let main = fs.readFileSync(MAIN, 'utf8');
const before = chars(main);

// ===== 1. 取三条待外移原文（按内容锚点定位，不按行号，防漂移）=====
const L = main.split('\n');
const anchors = {
  L30: '模拟器/真机取证两坑（R294，白跑 5 次连接的代价）',
  L33: '同族病第八例 + 元发现（R298·#443 M1 审计）',
  L36: 'M3 成本引擎三副本已有「硬守卫」⇒ 不必重做',
};
const picked = {};
for (const [k, a] of Object.entries(anchors)) {
  const idx = L.findIndex((l) => l.includes(a));
  if (idx < 0) throw new Error('锚点未命中: ' + k + ' :: ' + a);
  picked[k] = { idx, text: L[idx] };
}

// ===== 2. 追加到外移件（〔原 L##〕前缀，只搬不删）=====
let arch = fs.readFileSync(ARCH, 'utf8');
const block = [
  '',
  '---',
  '',
  '## 〔R298Y · 2026-10-16〕注入层治理三次外移（**只搬不删、可原样搬回**）',
  '',
  '> 触发：主文件 7607/8000（距上限仅 393）⇒ 下轮新增前先外移。三条均为**有独立 NOTE / 证据件**的细则，',
  '> 搬出后主文件留**压缩一行**（保留可执行的核心判据 + 指针）。',
  '',
  '- 〔原 L30〕' + picked.L30.text.replace(/^-\s*/, ''),
  '',
  '- 〔原 L33〕' + picked.L33.text.replace(/^-\s*/, ''),
  '',
  '- 〔原 L36〕' + picked.L36.text.replace(/^-\s*/, ''),
  '',
  '',
].join('\n');
if (!arch.endsWith('\n')) arch += '\n';
arch += block;
fs.writeFileSync(ARCH, arch, 'utf8');

// ===== 3. 主文件：三条原位替换为压缩一行 =====
const COMP = {
  L30: '- 🔴 **模拟器/真机取证两坑（R294）**：① 判「这次算完了」须 `await p.onCalcPresetFwd()`/`onGenerate()`，`loading===false` 会读到**上一次旧结果**；② 探针里裸 `wx.cloud.callFunction` **必须自带 `shop_id`**（页面走 `utils/api.js::call` 才注入）⇒ 否则恒 `INVALID_PARAM`，会误判成"部署落后"。细则 ⇒ 外移件 〔原 L30〕。',
  L33: '- 🔴🔴 **同族病第八例 + 元发现（R298·#443 M1）**：月度页三态判据写 `{{r}}`，而 `getLedger` 对无账本月**返回「默认空账」**⇒ `r` 成功路径**恒真**⇒ 空态只在 catch 可达 ⇒ 未建档月挂**红带「亏损」**。🔴 **正确判据 = `account_id` 非空**（同源先例 `pages/index/index.js:98`，**没有"默认账户"这回事**）。⇒ **元发现：守卫只守「分支在不在」，不守「分支到不到」**。细则 + 证据 ⇒ 外移件 〔原 L33〕。',
  L36: '- 🔴 **M3 成本引擎三副本已有硬守卫 ⇒ 不必重做**（R453）：`tools/check_m3_engine_parity.js` = 真行为对拍 3000 组 + S3 锚点 + 反恒真 D 段，是**本仓守卫质量标杆**。⇒ **M3 下一刀 = 幂等「同一语义 5 份实现」**（未见守卫）。细则 ⇒ 外移件 〔原 L36〕。',
};
for (const [k, v] of Object.entries(COMP)) {
  if (!main.includes(picked[k].text)) throw new Error('替换目标已变: ' + k);
  main = main.replace(picked[k].text, v);
}

// ===== 4. 新增两条裁决态（R298Y），插在 L33 压缩行之后 =====
const NEW = [
  '- 🔴🔴 **「写读取方 ≠ 修好」（R298Y 实证）**：R297-⑥ 在 `pages/card/version.js::doRestore` 写了 `v.card_type`/`v.specs` 的**读取**与注释，但 `load()` 的 list 映射**从未产出**这两键 ⇒ **恒 `undefined`** ⇒ 该修复**整轮空转、行为仍是它描述的 bug**；旧守卫 `grep` 词出现 ⇒ **被注释喂成恒真**。⇒ **判据必须守「读取方引用的每个 `v.X` 在映射侧被赋值」**（引用集 ⊆ 赋值集），只 grep 词出现不算。守 `tools/check_m3_card_roundtrip.js` ①②。',
  '- 🔴🔴 **「读到了 ≠ 送出去了」（R298Y 实证）**：保留 `if (l.X)` 判据、只删**提交字面量（提交键）**时，**引用集合不变** ⇒ 只守引用集合的判据**全绿漏过**。⇒ 必须**独立**守「函数体内对象字面量实际产出的键」这一面（`emittedKeys`）。反证：变异 M8（保留判据、只删提交键）若没有这条独立腿即漏。守 `tools/check_m3_card_roundtrip.js` ③-i/③-m。',
];
const marker = COMP.L33;
if (!main.includes(marker)) throw new Error('插入锚点丢失');
main = main.replace(marker, marker + '\n' + NEW.join('\n'));

fs.writeFileSync(MAIN, main, 'utf8');

const after = chars(main);
console.log('主 MEMORY.md：' + before + ' → ' + after + ' 字符（上限 8000，余 ' + (8000 - after) + '）');
console.log('外移件：' + chars(fs.readFileSync(ARCH, 'utf8')) + ' 字符（蒸馏阈值 60000）');
