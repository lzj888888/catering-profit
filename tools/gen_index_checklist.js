#!/usr/bin/env node
// tools/gen_index_checklist.js —— 「索引补齐核对单」生成器
//
// ⚠️ 本文件**不是守卫**：不进 SUITES、不产生断言、不参与任何验收判据。
//    它只是一个**派生渲染器**，供人工在云开发控制台手工建索引时手边对着勾。
//    （两者区别很重要：守卫要变异回灌才叫验过；渲染器只要"数字全部来自单源"即可。
//     请不要把它挂进 verify_all —— 它没有"该红时红"的语义。）
//
// 为什么需要它：A7 已定案 —— 真 `wx-server-sdk` 里 `createIndex` **不存在**
//   （`typeof === "undefined"`，2026-09-14 云端实测），索引**只能在控制台手工建**。
//   而线上进度长期停在 1/40 这种"已建 1 条、剩 39 条逐条对"的中间态 ——
//   这是最容易抄错一行的场景，也正是 R74/R75 反复在消灭的病：
//   **同一事实的手抄副本**。
//
// 设计立场（R74/R75 纪律的直接应用）：
//   核对单**不是第二份真相**，而是**派生件** —— 集合清单、索引名、字段、排序方向、
//   唯一性、总数、unique 数，全部由本脚本从**单源** `cloudfunctions/initDb/collections.js`
//   读出；文件头写明「本文件由生成器产出，勿手工编辑」。
//   ⇒ 索引若变，重跑本脚本即可，**永远不存在"核对单抄错了"这种漂移**。
//   ⇒ 本脚本**自身不写死任何计数**（不写 25 / 不写 40 / 不写 10）：一律 `length` 得来。
//      （若哪天有人在这里写死一个数字，它就变成了 R75 说的"第三份副本"。）
//
// 用法：
//   node tools/gen_index_checklist.js [输出路径.md]
//   默认输出 `<仓库根>/索引补齐核对单.md`

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 单源（字面量 require：静态检查可解析）
const { COLLECTIONS, INDEXES } = require('../cloudfunctions/initDb/collections.js');

const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, '索引补齐核对单.md');

// ---------- fail-closed：单源自身不自洽就拒绝产出（宁可不出图，也不出错的图） ----------
const bad = [];
for (const c of Object.keys(INDEXES)) {
  if (!COLLECTIONS.includes(c)) bad.push(`索引定义里的集合 \`${c}\` 不在 COLLECTIONS 清单里`);
}
for (const [c, list] of Object.entries(INDEXES)) {
  for (const ix of list) {
    const entries = Object.entries(ix.keys || {});
    if (entries.length === 0) bad.push(`${c}.${ix.name} 没有任何字段`);
    for (const [k, dir] of entries) {
      if (dir !== 1 && dir !== -1) bad.push(`${c}.${ix.name} 的字段 ${k} 排序方向是 ${JSON.stringify(dir)}（只认 1 / -1）`);
    }
  }
}
// 重名索引会让控制台报错，先在本地拦下（同一集合内重名才致命，跨集合重名无害但提示）
const dupNames = [];
for (const [c, list] of Object.entries(INDEXES)) {
  const seen = new Set();
  for (const ix of list) {
    if (seen.has(ix.name)) dupNames.push(`${c}.${ix.name}`);
    seen.add(ix.name);
  }
}
if (bad.length || dupNames.length) {
  console.error('❌ 单源自检未通过，拒绝生成核对单（fail-closed）：');
  for (const b of bad) console.error('   - ' + b);
  for (const d of dupNames) console.error('   - 同集合内索引重名：' + d);
  process.exit(1);
}

// ---------- 渲染 ----------
// ⚠️ 时间戳必须用**本地时间**：`toISOString()` 是 UTC，本机 UTC+8 ⇒ 直接用它写进单子会
//   **差 8 小时**（首版实测把 17:52 打成 09:52）。本仓对时间戳口径敏感（时间=Unix 毫秒约定），
//   单子上给人看的时间更不该是另一个时区的。⇒ 手写补零，不依赖 locale。
const localStamp = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const arw = (dir) => (dir === -1 ? '↓ 降序' : '↑ 升序');
const rows = [];
let n = 0;
const uniques = [];
for (const c of COLLECTIONS) {
  const list = INDEXES[c] || [];
  for (const ix of list) {
    n += 1;
    const fields = Object.entries(ix.keys).map(([k, d]) => `${k} ${arw(d)}`).join(' , ');
    const uniq = ix.unique === true;
    if (uniq) uniques.push(`${c}.${ix.name}`);
    rows.push(`| □ | ${n} | \`${c}\` | \`${ix.name}\` | ${fields} | ${uniq ? '**是**' : '否'} |`);
  }
}
const noIdx = COLLECTIONS.filter((c) => !(INDEXES[c] || []).length);
const total = n;            // 派生，不写死
const noIdxCount = noIdx.length;

const md = `# 索引补齐核对单（云开发控制台 · 手工建）

> ⚠️ **本文件由 \`tools/gen_index_checklist.js\` 从单源 \`cloudfunctions/initDb/collections.js\` 生成，请勿手工编辑。**
> 索引改了 → 重跑 \`node tools/gen_index_checklist.js\` 重新生成本单即可（这样它永远不会与单源漂移）。
> 生成时间：${localStamp()}（**本机本地时间**）

## 0 · 为什么必须手工建

真 \`wx-server-sdk\` 里 **没有** \`createIndex\`（\`typeof === "undefined"\`，A7 定案 · 2026-09-14 云端实测），
所以 \`initDb\` 那套索引**永远建不上**，**只能**在云开发控制台逐条手建。

## 1 · 【优先】先建这一条（唯一有性能后果的）

**\`audit_log\` → \`idx_audit_idem\`（字段 \`idempotency_key\` ↑ 升序，非唯一）**

- 幂等预检（\`common/idempotency.js::checkIdempotent\`）按 \`idempotency_key\` 查重；
- 而 \`audit_log\` 是**只增不删**的审计表 ⇒ **缺这条索引，每次幂等检查都是全表扫描**，并随数据量**线性恶化**；
- 其余索引缺了只是慢一点，这条缺了会**越用越慢**。⇒ 先建它，再建其余。

## 2 · 操作要点（控制台）

1. 云开发控制台 → **数据库** → 选中**集合** → **索引管理** → **新建索引**；
2. **复合索引**要把字段**逐行添加**，顺序按本单「字段」列**从左到右**（顺序不同 = 另一个索引）；
3. 方向照抄：本单写 \`↑ 升序\` 就是升序，写 \`↓ 降序\` 就是降序（源数据里的 \`1\` / \`-1\`）；
4. 「唯一」开关：**只在本单「唯一」列写"是"时打开**（共 **${uniques.length}** 条，清单见 §4）；
5. 索引名**照抄**（对不上不影响功能，但会让本单与线上无法逐条核对）；
6. 一条建完在左列勾一下 □→✓，**不要凭记忆**。

## 3 · 逐条勾选（共 **${total}** 条 · 集合 **${COLLECTIONS.length}** 张）

| ✓ | # | 集合 | 索引名 | 字段（按此顺序添加） | 唯一 |
|---|---|---|---|---|---|
${rows.join('\n')}

## 4 · 唯一索引清单（**${uniques.length}** 条，只有这些要打开"唯一"）

${uniques.map((u, i) => `${i + 1}. \`${u}\``).join('\n')}

${noIdxCount ? `## 5 · 无任何索引的集合（**${noIdxCount}** 张）\n\n${noIdx.map((c) => `- \`${c}\``).join('\n')}\n` : `## 5 · 无任何索引的集合\n\n（无 —— 每张集合都至少一条索引）\n`}
## 6 · 建完收尾（把实测数写在这里，别写"应该"）

- 已建条数：\`____\` / ${total}
- \`audit_log\` 的索引条数：\`____\` / ${(INDEXES.audit_log || []).length}（**含 \`idx_audit_idem\` 才算数**）
- 唯一索引条数：\`____\` / ${uniques.length}
- 核对人：\`____\`　日期：\`____\`

---

### 附：与仓库其他文件的关系（防"同一事实写多遍"）

- **唯一真相源**：\`cloudfunctions/initDb/collections.js\`（本单是它的派生渲染）；
- 仓内既有副本链（已由守卫 \`tools/check_schema_sync.js\` 机械守住）：镜像 \`specs/dev-specs/prototype/init_db.js\`、
  手册 §5.2b、工序清单 §5.5 正文 + **逐条对照表**、重启键 \`★知识存储点_2026-09-10.md\`；
- ⇒ **本单不替代上述任何一份**，它只是"手工操作时的勾选视图"（唯一增量：☐ 勾选位 + 操作要点 + 风险置顶）。
`;

fs.writeFileSync(outPath, md, 'utf8');
console.log(`✅ 已生成核对单：${outPath}`);
console.log(`   集合 ${COLLECTIONS.length} 张 · 索引 ${total} 条 · 其中唯一 ${uniques.length} 条 · 无索引集合 ${noIdxCount} 张`);
console.log(`   （全部为派生值：本脚本内不写死任何计数）`);
