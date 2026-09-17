#!/usr/bin/env node
// tools/gen_index_checklist.js —— 「索引补齐核对单」生成器
//
// 两种模式：
//   ① 默认（渲染）：写出 `<仓库根>/索引补齐核对单.md`，供人工在控制台手工建索引时对着勾。
//   ② `--check`（守卫 · 2026-09-17 复审裁定「方案②」，已挂进 verify_all 作第 57 个套件）：
//      **整份重算一遍再逐字比对**，漂移即红。
//      为什么用"整份重算"而不是"抽几个数字比对"（S4 那种写法）：核对单是**整份派生件**，
//      抽数字只覆盖 §6 那几处，覆盖不了逐行正文（§3 那 40 行才是人真正照着操作的部分）。
//      ⇒ 唯一能覆盖"整份"的判据 = 重算一遍比对（与 check_admincore R50 / K11/K12/K13 同构）。
//      ⚠️ 三条硬要求（复审方点名）：
//        (a) 先剥 BOM + CRLF→LF 归一（**R79**）—— 不归一，入库后第一次拉取就假红（本地全绿）；
//        (b) fail-closed：单源或核对单读不到 ⇒ **判红**，并打印实际查找路径（照 dump 的处理）；
//        (c) 回灌三件套：改单源不重跑⇒红 / 重跑⇒绿 / **只改行尾或末尾加空行⇒必须保持绿**
//            （第三条缺席 = 等于没验 —— 它防的正是 (a) 那条病）。
//
// 为什么需要它：A7 已定案 —— 真 `wx-server-sdk` 里 `createIndex` **不存在**
//   （`typeof === "undefined"`，2026-09-14 云端实测）⇒ `initDb` 里的索引**永远建不上**（这半句真）。
//   ⚠️ 但「**只能靠人在控制台一条条填**」这半句**已被证伪**（2026-09-17，见下 §0 三建法）：
//      SDK 无方法 ≠ 平台无接口 —— 官方 HTTP API `POST /tcb/updateindex` 可脚本化。
//      ⇒ 本单的用途随之改变：它不是"必须手工"的理由，而是**任何建法下的防抄错清单**。
//      （R82：活文档里「只能人肉填」的旧措辞曾长期指导人工动作，李老师按它手填完 40 条
//        —— 与 R60 能力边界过期、R77 引用不可解析同族：**否定式断言的时效性没人守**。）
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
//   node tools/gen_index_checklist.js [输出路径.md]   # 渲染模式：写出核对单
//   node tools/gen_index_checklist.js --check          # 守卫模式：只比对、**不写文件**
//   默认输出 / 比对：`<仓库根>/索引补齐核对单.md`

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 单源（字面量 require：静态检查可解析）
const { COLLECTIONS, INDEXES } = require('../cloudfunctions/initDb/collections.js');

const ARGS = process.argv.slice(2);
const CHECK = ARGS.includes('--check');
const outArg = ARGS.find((a) => !a.startsWith('--'));
const outPath = outArg ? path.resolve(outArg) : path.join(ROOT, '索引补齐核对单.md');

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

// ---------- §6 实测数：从**证据文件**派生（绝不手填、也绝不写死） ----------
// 立场：核对单的"实测数"若让人工手填，重跑生成器就丢；若在模板里写死，又成了 R75 说的
//   "第三份副本"。⇒ 唯一做法是从证据派生：
//   `review/evidence/<日期>_index_buildout/04_逐条结果.json`（形如 [[集合, 索引名, 状态]]）。
//   证据缺失 ⇒ 退回空白模板（保持本单原有的"手边勾选"语义，不假装已建完）。
//   ⚠️ 证据条数 ≠ 单源条数 ⇒ 说明**证据过期**（单源加了索引但没重建）⇒ 醒目警告，绝不照抄旧数。
const EVID_REL = 'review/evidence/index_buildout_20260917';
const AUDIT_CNT = (INDEXES.audit_log || []).length;
const EVID_ABS = path.join(ROOT, EVID_REL, '04_逐条结果.json');
let evid = null;
try {
  const arr = JSON.parse(fs.readFileSync(EVID_ABS, 'utf8'));
  if (Array.isArray(arr) && arr.length && arr.every((r) => Array.isArray(r) && r.length === 3)) {
    const uSet = new Set(uniques);
    const d = new Date(fs.statSync(EVID_ABS).mtimeMs);
    const p2 = (x) => String(x).padStart(2, '0');
    evid = {
      rows: arr.length,
      built: arr.filter((r) => r[2] === 'OK' || r[2] === 'EXISTS').length,
      ok: arr.filter((r) => r[2] === 'OK').length,
      exists: arr.filter((r) => r[2] === 'EXISTS').length,
      audit: arr.filter((r) => r[0] === 'audit_log').length,
      uniq: arr.filter((r) => uSet.has(`${r[0]}.${r[1]}`)).length,
      date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    };
  }
} catch (e) { evid = null; }

const TICK = (a, b) => (a === b ? '✅' : '❌');
let sec6;
let statusLine;
if (!evid) {
  statusLine = `> **线上状态：无实测证据**（\`${EVID_REL}/\` 未找到）⇒ 本单按"待手工建"使用。`;
  sec6 = `## 6 · 建完收尾（把实测数写在这里，别写"应该"）

- 已建条数：\`____\` / ${total}
- \`audit_log\` 的索引条数：\`____\` / ${AUDIT_CNT}（**含 \`idx_audit_idem\` 才算数**）
- 唯一索引条数：\`____\` / ${uniques.length}
- 核对人：\`____\`　日期：\`____\``;
} else if (evid.rows !== total) {
  statusLine = `> 🔴 **线上状态：证据已过期，勿照抄** —— 证据记 ${evid.rows} 条、单源现为 ${total} 条。`;
  sec6 = `## 6 · 🔴 证据已过期，本节数字一律不可信

- 证据 \`${EVID_REL}/\` 记录 **${evid.rows} 条**，而单源现为 **${total} 条**
  ⇒ 有人在建库之后改动了索引清单。
- **请按 §3 重新建/核对，并重跑建库脚本更新证据**；在此之前不要引用任何"已建 N 条"的说法。
- （本节刻意**不打印**具体条数句子 —— 免得过期数字被人当结论抄走。）`;
} else {
  statusLine = `> **线上状态：已建满**（**${evid.built} / ${total}** 条 · 唯一 ${evid.uniq} / ${uniques.length}，实测于 ${evid.date}）
> 证据目录 \`${EVID_REL}/\`（本行由证据派生，非人工填写）。`;
  sec6 = `## 6 · 建完收尾（**实测数**，由证据派生 —— 不是"应该"）

- 已建条数：**${evid.built}** / ${total}　${TICK(evid.built, total)}（本次新建 ${evid.ok} · 此前已存在 ${evid.exists}）
- \`audit_log\` 的索引条数：**${evid.audit}** / ${AUDIT_CNT}（**含 \`idx_audit_idem\` 才算数**）　${TICK(evid.audit, AUDIT_CNT)}
- 唯一索引条数：**${evid.uniq}** / ${uniques.length}　${TICK(evid.uniq, uniques.length)}
- 核对人：WorkBuddy（键鼠 GUI 自动驾驶 + **独立**复核脚本）　日期：${evid.date}
- 证据目录：\`${EVID_REL}/\`（建库日志 / 名称核对 / 组成核对 / 逐条 JSON / 关键截图）

> 数字来源（**本生成器内不写死任何计数**）：逐条结果 \`${EVID_REL}/04_逐条结果.json\`
> （\`OK\`＝本次脚本新建、\`EXISTS\`＝建前已存在；唯一数按**单源 unique 清单**交叉计数）。`;
}

const md = `# 索引补齐核对单（三种建法通用 · 防抄错清单）

> ⚠️ **本文件由 \`tools/gen_index_checklist.js\` 从单源 \`cloudfunctions/initDb/collections.js\` 生成，请勿手工编辑。**
> 索引改了 → 重跑 \`node tools/gen_index_checklist.js\` 重新生成本单即可（这样它永远不会与单源漂移）。
> 生成时间：${localStamp()}（**本机本地时间**）

${statusLine}

## 0 · 为什么需要这份单子（以及索引的三种建法）

真 \`wx-server-sdk\` 里 **没有** \`createIndex\`（\`typeof === "undefined"\`，A7 定案 · 2026-09-14 云端实测），
所以 \`initDb\` 里那段建索引的代码**永远建不上** —— **这一半是真的**。

但「**除了控制台就没有别的建法**」**这一半已被证伪**（2026-09-17）：**SDK 没有方法 ≠ 平台没有接口**。

| 建法 | 前置条件 | 说明 |
| --- | --- | --- |
| **① 脚本化（首选）** \`tools/apply_indexes.js\` | 有 **AppSecret** | 走官方 HTTP API \`POST /tcb/updateindex\`；**幂等、可回读**；默认 dry-run，\`--apply\` 才真写 |
| **② GUI 键鼠自动驾驶** | 无密钥，需开着微信开发者工具 | 2026-09-17 实证 **40/40**；脚本见 \`review/evidence/index_buildout_20260917/scripts/\` |
| **③ 控制台逐条手填** | 无密钥、无脚本 | **本单就是给这条路用的** —— 照 §3 逐条勾，防抄错 |

> ⚠️ 旧版核对单 §0 **曾断言「索引只能靠人一条条填」** —— 那是 A7 当时的口径，且曾**直接指导人工动作**
> （李老师按它手建完 40 条）。结论更新后**活文档没跟**（R82）⇒ 现已改正。**能走 ① 就别走 ③**。

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
${sec6}

---

### 附：与仓库其他文件的关系（防"同一事实写多遍"）

- **唯一真相源**：\`cloudfunctions/initDb/collections.js\`（本单是它的派生渲染）；
- 仓内既有副本链（已由守卫 \`tools/check_schema_sync.js\` 机械守住）：镜像 \`specs/dev-specs/prototype/init_db.js\`、
  手册 §5.2b、工序清单 §5.5 正文 + **逐条对照表**、重启键 \`★知识存储点_2026-09-10.md\`；
- ⇒ **本单不替代上述任何一份**，它只是"手工操作时的勾选视图"（唯一增量：☐ 勾选位 + 操作要点 + 风险置顶）。
`;

// ===================== --check：派生件 ≡ 重算结果 =====================
// 归一链（顺序不能反）：剥 BOM（串首）→ CRLF→LF → 掩时间戳。
// ⚠️ 时间戳**必须**掩：单子第 3 行 `> 生成时间：…` 精确到分钟，每次重跑都变 ⇒
//    不掩的话「改一行再重跑」永远假红。⇒ 掩掉，并**在输出里点名这一行被豁免**
//    （R76：豁免必须显式 + 断言仍须命中，不许靠"正则恰好扫不到"）。
// ⚠️ 为什么先归一再掩：掩用的是 `^…$` 多行锚点，串里若还有 `\r`，`.*$` 会把 `\r`
//    一起吃掉 ⇒ 两边"看起来相等"其实是假相等。
const stripBom = (s) => s.replace(/^\uFEFF/, '');
const normNL = (s) => s.replace(/\r\n/g, '\n');
const STAMP_RE = /^> 生成时间：.*$/m;
// ⚠️ 替换文本**不能**仍以 `> 生成时间：` 开头 —— 否则它自己又匹配 STAMP_RE，
//    C7 的"原行已不存在"判据恒假（首跑实测就红了，C7 抓到了这个自匹配 bug）。
const maskStamp = (s) => s.replace(STAMP_RE, '> 生成时间（已掩蔽）：<每次重跑都变>');
// 末尾空白一并归一（复审方 round33 点名）：编辑器 / git 常在文件末尾留一个空行，
//   那是无害差异 ⇒ 判红就成了"假红"，而**假红的守卫会被使用者学会忽略**（等于把守卫关掉）。
//   ⚠️ 只 trim **末尾**，正文里任何一处不同仍然逐字判红 ⇒ 不削弱 C3 的覆盖力。
const canon = (s) => maskStamp(normNL(stripBom(s))).replace(/\s+$/, '');

function runCheck(expectedMd) {
  let pass = 0, failN = 0;
  const warns = [];
  const check = (name, ok, detail) => {
    if (ok) { pass++; console.log(`✅ ${name}${detail ? ' · ' + detail : ''}`); }
    else { failN++; console.log(`❌ ${name}${detail ? ' · ' + detail : ''}`); }
  };

  console.log('===== 核对单派生守卫（方案② · 整份重算逐字比对）=====');

  // C1 / C2 —— fail-closed：读不到即判红，并打印**实际查找路径**（照 _idx_dump 的处理）
  const singlePath = path.join(ROOT, 'cloudfunctions/initDb/collections.js');
  let singleOk = false;
  try { singleOk = fs.readFileSync(singlePath, 'utf8').trim().length > 0; } catch (e) { singleOk = false; }
  check('C1 单源可读（fail-closed）', singleOk,
    singleOk ? `集合 ${COLLECTIONS.length} / 索引 ${total}` : `**读不到或为空**：${singlePath}`);

  console.log(`   查找单源：${singlePath}`);
  console.log(`   查找核对单：${outPath}`);
  let disk = null, diskErr = '';
  try { disk = fs.readFileSync(outPath, 'utf8'); } catch (e) { diskErr = (e && e.message) || ''; }
  check('C2 核对单可读（fail-closed）', disk != null,
    disk != null ? `${disk.length} 字符` : `**读不到**：${outPath}（${diskErr}）`);
  if (disk == null) {
    console.log(`\n===== 核对单派生守卫结果：${pass} 通过 / ${failN} 失败 =====`);
    process.exit(1);
  }

  // C3 核心：整份归一后逐字全等（唯一能覆盖 §3 那 40 行正文的判据）
  const a = canon(expectedMd), b = canon(disk);
  check('C3 整份 ≡ 重算结果（剥 BOM + CRLF 归一 + 掩时间戳）', a === b,
    a === b ? `${a.length} 字符` : '差异如下');
  if (a !== b) {
    const la = a.split('\n'), lb = b.split('\n');
    let shown = 0;
    for (let i = 0; i < Math.max(la.length, lb.length) && shown < 3; i++) {
      if (la[i] !== lb[i]) {
        shown++;
        console.log(`      · 第 ${i + 1} 行`);
        console.log(`        磁盘: ${JSON.stringify((lb[i] || '<无此行>').slice(0, 110))}`);
        console.log(`        重算: ${JSON.stringify((la[i] || '<无此行>').slice(0, 110))}`);
      }
    }
    console.log('      ⇒ 修复：重跑 `node tools/gen_index_checklist.js`（**不要**手改核对单）');
  }

  // C4 行尾/BOM 差异：只告警、不判红 —— 它正是 R79 要防的场景。
  //    （git autocrlf 把 LF 落成 CRLF ⇒ 裸比必然不等，但语义完全相同；
  //     不归一就会"本地全绿、入库后第一次拉取假红"。）
  //    ⚠️ 归因必须准：裸比不等**绝大多数时候只是时间戳变了**（每次重跑都这样，属设计内、不该告警）。
  //    只有「剥 BOM + 归一 CRLF 后相等、但裸比不等」才真的是行尾/BOM 差异 ⇒ 才值得 WARN。
  //    （首版把这两种混为一谈，把一次普通重跑误报成"R79 场景"，属于会误导人的假警报。）
  const nlA = normNL(stripBom(expectedMd)), nlB = normNL(stripBom(disk));
  const trimA = nlA.replace(/\s+$/, ''), trimB = nlB.replace(/\s+$/, '');
  const hasCRLF = /\r\n/.test(expectedMd) || /\r\n/.test(disk);
  const hasBOM = expectedMd.charCodeAt(0) === 0xFEFF || disk.charCodeAt(0) === 0xFEFF;
  // ⚠️ 判据用 **trim 后**相等、而不是 `nlA === nlB`：回灌 M4 是「CRLF **且** 末尾多空行」两个无害
  //    差异叠加，要求 nlA===nlB 就只会报末尾空行、**漏报 CRLF**（R79 本体场景恰好被自己吃掉）。
  //    ⇒ 行尾/BOM 优先判定，纯末尾空白降级到 else 分支。
  if (trimA === trimB && (hasCRLF || hasBOM)) {
    warns.push('剥 BOM + 归一 CRLF 后两边相等，但裸字节不等 ⇒ **仅差 BOM / 行尾**'
      + `（CRLF=${hasCRLF} / BOM=${hasBOM}；git autocrlf 的典型结果，正是 R79 要防的病）。`
      + '语义一致，本守卫按绿处理；想彻底消掉就重跑一次生成器。');
  } else if (trimA === trimB && nlA !== nlB) {
    // 末尾空白差异：同样只告警 —— 但**必须点名**，不许静默吞掉
    //   （静默 = 下一个人不知道自己这份"绿"是被放宽过的）。
    warns.push('仅**末尾空白**不同（编辑器 / git 常见）⇒ 按无害处理、判绿；重跑一次生成器即消掉。');
  }

  // C5 不许有人手改：残留手填占位 ⇒ §6 被人工改过（手改会被重跑冲掉）
  const hasBlank = /`____`/.test(disk);
  check('C5 磁盘件无手填残留（§6 全由证据派生）', !hasBlank,
    hasBlank ? '发现 `____` 占位 ⇒ 有人手改过 §6' : '无 `____` 占位');

  // C6 派生声明不许被删（删了 ⇒ 下一个人就会把它当手填件）
  const hasDecl = /请勿手工编辑/.test(disk);
  check('C6 磁盘件仍带「勿手工编辑」声明', hasDecl,
    hasDecl ? '声明在位' : '声明被删 ⇒ 会被误当成手填件');

  // C7 掩蔽正则不许腐：必须**真的**把时间戳行换掉，而不是"恰好没匹配上"
  const cd = canon(disk);
  const stampLine = (cd.split('\n').find((l) => /^> 生成时间/.test(l)) || '<找不到>').slice(0, 60);
  // ⚠️ '已掩蔽' 这个标记串改掩蔽文本时必须同步改这里（首版就栽在两处不一致上，C7 当场红了）
  const maskedWorked = cd.includes('已掩蔽') && !STAMP_RE.test(cd);
  check('C7 时间戳掩蔽确实生效（正则不腐）', maskedWorked,
    maskedWorked ? `已掩 → ${stampLine}` : `**未生效**（现为 ${stampLine}）⇒ 每次重跑都会假红`);

  for (const w of warns) console.log(`  ⚠️ WARN（不阻断）：${w}`);
  console.log(`\n===== 核对单派生守卫结果：${pass} 通过 / ${failN} 失败 =====`);
  process.exit(failN === 0 ? 0 : 1);
}

if (CHECK) {
  runCheck(md);
} else {
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`✅ 已生成核对单：${outPath}`);
  console.log(`   集合 ${COLLECTIONS.length} 张 · 索引 ${total} 条 · 其中唯一 ${uniques.length} 条 · 无索引集合 ${noIdxCount} 张`);
  console.log(`   （全部为派生值：本脚本内不写死任何计数）`);
}
