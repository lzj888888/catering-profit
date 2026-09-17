#!/usr/bin/env node
/**
 * tools/check_stale_claims.js —— 【R85】已证伪短语守卫（"断言的时效性"机器化）
 *
 * 为什么需要它（同一模式第三次出现了，该复用了）：
 *   R60 能力边界过期 / R77 引用不可解析 / R82「只能手工建」留在 8 处活文档 / R84 重启键 :92 漏网
 *   —— 四次都是同一病：**否定式断言的时效性没人守**，且四次都靠人 grep。
 *
 * 关键设计（复审 round36 §五，我完全采纳）：
 *   不要让写作者"记得避开关键词"（靠记性 = 一定会漏），而是**把上下文编码进文本**：
 *     · 已证伪的短语写下来时，同行必须带豁免标记（「已证伪」/「旧口径」/「引述」/「曾」…）；
 *     · 政策类（不是能力限制）带政策标记（「政策」/「prod 集合」/「INITDB_DEV_ONLY」）；
 *     · 守卫只做一件事：命中已证伪短语 ⇒ 必须有标记；没有 ⇒ 判红并打印那一行。
 *   ⇒ 这样"引述"天然放行、不用改写措辞，也不必指望 grep 理解上下文。
 *
 * 为什么必须独立成守卫而不放进 S4（反驳意见已吸收）：
 *   S4 是「抽数字比对」、verify_docx 是「docx 计数」，都覆盖不了**任意文件里的任意一句自然语言**。
 *   而 R84 的漏网形态恰恰是"同一概念换了说法"（「索引改控制台手工建」不含"只能"二字）
 *   ⇒ 唯一能覆盖"概念本身"的判据，是**先按概念建短语表再逐行判读上下文**。
 *
 * fail-closed 三条：
 *   1. 扫描面为空（< MIN_FILES 个文件）⇒ 判红（路径写错 = 什么都没扫 = 最危险的"绿"）；
 *   2. 剥 BOM + CRLF→LF 归一后再匹配（R79 同款：不归一，别人拉取后第一次跑就假红）；
 *   3. 短语条目腐烂 ⇒ **WARN 并点名**（某短语 0 命中 = 它已从活文档消失 ⇒ 该条目该剔除了，
 *      但"彻底清除"是好事而不是错误，所以不判红 —— 与 verify_fields 的 WHITELIST_HIT 同思路）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---------------- 扫描面 ----------------
const EXTS = ['.md', '.txt', '.js', '.json'];
// review/ 是历史流水（REVIEW_* 按协议不可改）；这三个是机械产物/依赖
const SKIP_DIR = new Set(['.git', 'node_modules', 'miniprogram_npm', 'review']);
// ⚠️ 必须跳过**本守卫自己**：PHRASES 表里的正则字面量必然命中自己的定义行（自指污染）。
//    不跳过的后果比"少扫一个文件"坏得多 —— 它会诱导后来者把短语写歪去躲开自匹配，
//    那样守卫覆盖的概念就被悄悄改小了。宁可少扫，也不可让判据扭曲自己 Scha 的表达。
const SELF = 'tools/check_stale_claims.js';
const MIN_FILES = 20;   // fail-closed 下限：扫不到这么多文件说明扫描面写错了

// ---------------- 已证伪短语表 ----------------
// 每条目 = 「曾经在案、但已被推翻的说法」。命中 ⇒ 必须同行带豁免标记，否则判红。
const PHRASES = [
  {
    id: '手工建',
    re: /手工(建|创建|补建|建立|建全)/,
    why: 'A7 只说了 SDK 无 createIndex；「索引只能靠人一条条填」已于 2026-09-17 证伪 '
       + '（官方 HTTP API POST /tcb/updateindex 可脚本化，见 tools/apply_indexes.js）',
  },
  {
    id: '必须手工',
    re: /必须手工|只能手工/,
    why: '同上：请改写能力边界的真实范围（SDK 无方法 ≠ 平台无接口）',
  },
  {
    id: '不支持代码建索引',
    re: /不支持代码建索引|不能用代码建索引/,
    why: 'SDK 层确无 createIndex，但 HTTP API 层可以脚本化 —— 这句话容易被读成"无法自动化"',
  },
];

// ---------------- 豁免标记 ----------------
// 命中行只要含任一个 ⇒ 视为"带上下文的引用/留痕"，放行并打印（不静默吞掉）。
const MARKS_QUOTE = ['已证伪', '旧口径', '旧版', '曾写', '曾经', '引述',
  '留痕', '曾', '当时', '历史', '一度', '已闭环'];

// 政策类：不是能力限制，是刻意的风险决策（如 prod 不部署 initDb）⇒ 放行。
// ⚠️ 判据要按**语义**给，不能只按"prod"这种通用词 —— R84 的教训就是"模式太窄会漏真命中"，
//    反向同样成立：**模式太宽会把真断言放过去**。⇒ 这里列的是"这句话完整在说政策"的组合。
const MARKS_POLICY = [
  'INITDB_DEV_ONLY',        // 门禁 reason 串
  'prod 集合', 'prod 的 25', 'prod 25 张集合', '生产环境 25 张集合',  // "prod 集合在哪建"
  '禁止部署', '绝不部署',     // "initDb 不部署到 prod"这条政策本身
  '这是政策', '政策非能力',
];

// ---------------- 工具 ----------------
const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
const normNL = (s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

let pass = 0;
let failN = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`✅ ${name}${detail ? ` · ${detail}` : ''}`); }
  else { failN += 1; console.log(`❌ ${name}${detail ? ` · ${detail}` : ''}`); }
};

/** 遍历返回 {file, lines}[] */
function scan() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(p);
        continue;
      }
      if (!EXTS.some((x) => e.name.endsWith(x))) continue;
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel === SELF) continue;                    // 跳过自身（见 SELF 处理由）
      let raw;
      try { raw = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
      out.push({ file: path.relative(ROOT, p).split(path.sep).join('/'), lines: normNL(stripBom(raw)).split('\n') });
    }
  })(ROOT);
  return out;
}

console.log('===== 已证伪短语守卫 R85（概念级：已证伪说法必须带上下文标记）=====');

const files = scan();

// ---- S1 扫描面非空（fail-closed） ----
check('S1 扫描面非空（读不到文件 = 判红，不许假装绿）', files.length >= MIN_FILES,
  `${files.length} 个文件（下限 ${MIN_FILES}）`);

// ---- S2~S4：逐短语扫描 ----
const unmarked = [];   // 裸断言（必须为零）
const markedQ = [];    // 带引述标记（放行 + 打印）
const markedP = [];    // 政策类（放行 + 打印）
const emptyPhrases = [];

for (const ph of PHRASES) {
  let hits = 0;
  for (const f of files) {
    f.lines.forEach((line, i) => {
      if (!ph.re.test(line)) return;
      hits += 1;
      if (MARKS_POLICY.some((m) => line.includes(m))) {
        markedP.push(`${f.file}:${i + 1}  [政策]  ${line.trim().slice(0, 96)}`);
      } else if (MARKS_QUOTE.some((m) => line.includes(m))) {
        markedQ.push(`${f.file}:${i + 1}  [引述/留痕]  ${line.trim().slice(0, 96)}`);
      } else {
        unmarked.push(`${f.file}:${i + 1}\n      ${line.trim().slice(0, 150)}\n      ↳ 为什么红：${ph.why}`);
      }
    });
  }
  if (hits === 0) emptyPhrases.push(ph.id);
}

check('S2 活文档内无「裸的已证伪断言」', unmarked.length === 0,
  unmarked.length === 0 ? `0 处（共 ${markedQ.length + markedP.length} 处命中均带上下文标记）`
    : `**${unmarked.length} 处未带标记**：\n      ${unmarked.join('\n      ')}`);

// ---- S3 放行项必须显式点名（静默 = 下一个人不知道自己这份"绿"被放宽过）----
if (markedQ.length) {
  console.log(`\nℹ️ 以下 ${markedQ.length} 处为**带标记的引用/留痕**（放行，但必须看得见）：`);
  markedQ.forEach((s) => console.log(`   ${s}`));
}
if (markedP.length) {
  console.log(`\nℹ️ 以下 ${markedP.length} 处为**政策类**（非能力限制，放行）：`);
  markedP.forEach((s) => console.log(`   ${s}`));
}

// ---- S4 短语表不腐（0 命中 = 该说法已从活文档消失 ⇒ 条目该剔除）----
if (emptyPhrases.length) {
  console.log(`\n⚠️ S4 短语表可能已腐：${emptyPhrases.join(' / ')} 在活文档内 **0 命中** `
    + `⇒ 要么该说法已被彻底清除（好事，请从 PHRASES 里剔除该条目），要么正则写错了（坏事，请修正）。`
    + `\n   （不判红：0 命中本身不是错误，但必须看得见。）`);
} else {
  pass += 1;
  console.log(`\n✅ S4 短语表未腐 · ${PHRASES.length} 个条目均有命中`);
}

console.log(`\n===== 已证伪短语守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
