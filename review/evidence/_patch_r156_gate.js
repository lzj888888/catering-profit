// _patch_r156_gate.js —— R156 挂门禁「六处必改 + 一处 CASES」脚本化写入
//
// 🔴 两阶段纪律（技能 gate-suite-checklist §3.3）：先在内存里改完（每个锚点断言「命中数 == 1」），
//   全部通过才统一落盘；任一不符则**一个文件都不写**并响亮退出。
// 🔴 同文件多处改动必须**一次写回**（并行/多次 Edit 会互相覆盖 —— 本轮已踩两次）。
// 🔴 **行尾不能靠"整文件探测"**：本仓实测 `verify_all.js` 是**混合行尾**（CRLF 675 / LF 704），
//   锚点片段周围用 LF、文件别处用 CRLF ⇒ 单一 nl 常量必然打空。改为「每个锚点两种行尾都试」，
//   命中哪种就用哪种（并让插入内容与命中处行尾一致）。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/';
const RESTART = 'specs/dev-specs/★知识存储点_2026-09-10.md';

const EDITS = [
  // ===== verify_all.js（3 处）=====
  {
    file: 'verify_all.js', label: '① 头注套件数 110 → 111',
    from: '// 串联：110 个套件 = ',
    to: '// 串联：111 个套件 = ',
  },
  {
    file: 'verify_all.js', label: '② SUITES 末尾追加（必须末尾：R92/C3 对序号有硬依赖）',
    from: "  ['list-query-limit', 'tools/check_list_query_limit.js'],\n];",
    to: "  ['list-query-limit', 'tools/check_list_query_limit.js'],\n" +
        "  // R156（round156 李老师点单的四项优化之第 1 项）：列表排序（置顶 + 最近编辑在前）· 原料选择独立页 · 连续录入 —— 详见头注 R156 段。\n" +
        "  ['list-ux', 'tools/check_list_ux.js'],\n];",
  },
  {
    file: 'verify_all.js', label: '③ 头注补 R156 条目',
    from: '//         **云函数端默认 100 条、最多 1000 条**，必须显式 `.limit()` 才能超过 100。',
    to: '//         **云函数端默认 100 条、最多 1000 条**，必须显式 `.limit()` 才能超过 100。\n' +
        '//       + 列表排序/置顶 · 原料选择页 · 连续录入守卫（tools/check_list_ux.js，R156）—— 根因＝李老师点单的四项优化之第 1 项\n' +
        '//         （「两个列表加 orderBy（最近编辑在前）+ 常用置顶」）与第 2 项（「原料选择器 100 项只能滚」）：\n' +
        '//         四类**静默失效**路径此前零覆盖 —— ① 排序键不由云函数出参带出 ⇒ 前端排序键恒为 undefined、退化成自然序；\n' +
        '//         ② 连续录入不清 `id`/`card_code` ⇒ 第二道被当成「编辑第一道」、**第一道的内容被静默覆盖**（数据正确性）；\n' +
        '//         ③ 原料回退原生 picker ⇒ 搜索/分组全失效；④ WXML 内调方法 ⇒ 置顶标记恒 false。\n' +
        '//         判据 = L1 排序在位（含 applyFilter 真的调它）/ L2 三处出参带 updated_at 且 fail-soft 退回 created_at /\n' +
        '//         L3 置顶落**既有** shop 文档（零新建集合红线）/ L4 选择页四件套+搜索+分组 / L5 按 isEdit 分支+清主键 /\n' +
        '//         L6 模板不得调方法 + S1~S3 自失效护栏 + C1~C6 反恒真影子样本。',
  },
  // ===== 重启键（3 行 / 4 处）=====
  {
    file: RESTART, label: '④ §1.1 入口行套件数 110 → 111',
    from: '串 **110** 个套件 = ',
    to: '串 **111** 个套件 = ',
  },
  {
    file: RESTART, label: '⑤ §1.1 入口行追加 R156 守卫一句话说明',
    from: '全仓 260 个文件 375 处取数无一裸奔）**',
    to: '全仓 260 个文件 375 处取数无一裸奔）** + **R156 列表排序·置顶·原料选择·连续录入（李老师点单四项优化之第 1 项 + 「100 项只能滚」）→ 新增 `tools/check_list_ux.js`（32 断言：置顶 + 最近编辑在前（排序键必须由云函数出参带出）/ 置顶落**既有** shop 文档（零新建集合）/ 原料改独立选择页（搜索 + 分类分组）/ 连续录入必须清主键防「第二道覆盖第一道」/ WXML 表达式不得调方法）**',
  },
  {
    file: RESTART, label: '⑥ 断言数声明行追加 check_list_ux=32',
    from: '/ `check_list_query_limit`=16（**二十七者**均',
    to: '/ `check_list_query_limit`=16 / `check_list_ux`=32（**二十八者**均',
  },
  {
    file: RESTART, label: '⑦ 「套件数会漂」行：数字 110 → 111',
    from: '（现 **110**；2026-09-17 由 41 → 45',
    to: '（现 **111**；2026-09-17 由 41 → 45',
  },
  {
    file: RESTART, label: '⑧ 「套件数会漂」行：演进链尾部追加',
    from: '此前 109 套件零覆盖）**',
    to: '此前 109 套件零覆盖）** → **111（round156：新增 `tools/check_list_ux.js`，列表排序/置顶·原料选择页·连续录入守卫 —— 根因＝李老师点单「两个列表加 orderBy + 常用置顶」与「100 项只能滚」：四类**静默失效**路径此前零覆盖（排序键不由出参带出 / 连续录入不清主键致「第二道覆盖第一道」/ 选原料回退原生 picker / WXML 内调方法恒 false））**',
  },
  // ===== check_suite_assert_counts.js（1 处）=====
  {
    file: 'tools/check_suite_assert_counts.js', label: '⑨ CASES 追加 check_list_ux',
    from: "  { key: 'check_list_query_limit', rel: 'tools/check_list_query_limit.js' }, // 16 条（R154：L1~L5 + S1~S3 + C1~C7 反恒真含替身正负样本）",
    to: "  { key: 'check_list_query_limit', rel: 'tools/check_list_query_limit.js' }, // 16 条（R154：L1~L5 + S1~S3 + C1~C7 反恒真含替身正负样本）\n  { key: 'check_list_ux', rel: 'tools/check_list_ux.js' },               // 32 条（R156：L1~L6 + S1~S3 + C1~C6 反恒真影子样本）",
  },
];

// 同一个锚点，LF 与 CRLF 两种行尾都试；命中且唯一才取用（并让插入内容跟随命中处的行尾）
function pickVariant(src, from, to) {
  const cands = [[from, to]];
  if (from.indexOf('\r') < 0) {
    cands.push([from.replace(/\n/g, '\r\n'), to.replace(/\n/g, '\r\n')]);
  }
  for (const [f, t] of cands) {
    if (src.split(f).length - 1 === 1) return { from: f, to: t };
  }
  return null;
}

// ---------- 阶段 1：全校验（不改任何文件）----------
const cache = new Map();
const plan = [];
let bad = 0;

for (const e of EDITS) {
  if (!cache.has(e.file)) {
    const p = path.join(ROOT, e.file);
    if (!fs.existsSync(p)) { console.log('!! 文件不存在: ' + e.file); bad++; continue; }
    cache.set(e.file, fs.readFileSync(p, 'utf8'));
  }
  const picked = pickVariant(cache.get(e.file), e.from, e.to);
  if (!picked) { bad++; console.log('!! 锚点命中 0 次（LF/CRLF 都试过）: ' + e.label); continue; }
  plan.push({ file: e.file, label: e.label, from: picked.from, to: picked.to });
  console.log('OK  锚点唯一命中: ' + e.label);
}

if (bad) { console.log('\n>>> 校验未通过（' + bad + ' 处），一个文件都没写。'); process.exit(1); }

// ---------- 阶段 2：统一落盘（同文件累积替换）----------
const out = new Map(cache);
for (const p of plan) {
  const cur = out.get(p.file);
  out.set(p.file, cur.replace(p.from, p.to));
}
for (const [file] of plan.reduce((m, p) => m.set(p.file, 1), new Map())) {
  fs.writeFileSync(path.join(ROOT, file), out.get(file), 'utf8');
  console.log('写入 ' + file);
}
console.log('\n>>> 全部完成：' + plan.length + ' 处改动。');
