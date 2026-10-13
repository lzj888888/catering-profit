#!/usr/bin/env node
/**
 * 注入层记忆预算守卫（R284 · 2026-10-13）
 *
 * 背景（同族病：判据存在 ≠ 被自动执行）：
 *   「主 MEMORY.md 超 8000 字符就会被截断 = 记忆失效」这条红线**只写在文件自己的抬头里**，
 *   靠"我每轮自律"来守 ⇒ 2026-10-13 实测主文件已 9208 字符（字节 16.4K）仍无人报警，
 *   与 round53「verify_docx.py 未挂 SUITES」、R92「索引已建≠生效」同族：
 *   **没有机器断言的红线 = 没有红线**（截断是静默的，人不会发现"记忆少了一截"）。
 *
 * 本守卫把三件事钉死：
 *   ① 预算：主 MEMORY.md ≤ 8000 字符 / 用户级 MEMORY.md ≤ 4000 字符（按码点计，等价 wc -m）；
 *   ② 不外移就别删：主文件必须保留外移指针，且指针指向的外移件**必须在磁盘上**（防断链静默丢内容）；
 *   ③ 自失效护栏：两个 MEMORY 文件都找不到 ⇒ **判红**（否则换机/路径变更后本守卫恒绿假绿）。
 *
 * 纯静态（fs + 码点计数），不 require 任何云 SDK，可在普通 node 下被 verify_all 串联运行。
 * 路径可用环境变量 MEMORY_MD_PATH / USER_MEMORY_MD_PATH 覆盖。
 */
'use strict';

const fs = require('fs');

const MAIN = process.env.MEMORY_MD_PATH ||
  'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/.workbuddy/memory/MEMORY.md';
const USER = process.env.USER_MEMORY_MD_PATH ||
  'C:/Users/lzj/.workbuddy/user-203439a8-8fbc-48b0-911c-eaeaf7754950-personal/MEMORY.md';
const MAIN_LIMIT = 8000;
const USER_LIMIT = 4000;
const ARCHIVE_LIMIT = 60000; // 外移件超此规模 ⇒ 该做月度蒸馏了

const problems = [];
const warns = [];
const fail = (m) => problems.push(m);

// 按 Unicode 码点计数（等价 wc -m；emoji 不会被算成 2）
const chars = (s) => Array.from(s).length;
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const readUtf8 = (p) => fs.readFileSync(p, 'utf8');

let checked = 0;

// ===== 1. 主 MEMORY.md 预算（硬上限 8000）=====
if (exists(MAIN)) {
  checked++;
  const txt = readUtf8(MAIN);
  const n = chars(txt);
  if (n > MAIN_LIMIT) {
    fail(`主 MEMORY.md ${n} 字符 > ${MAIN_LIMIT} 上限（超即截断 = 记忆失效）⇒ 必须做外移整理：${MAIN}`);
  } else if (n > MAIN_LIMIT - 1000) {
    warns.push(`主 MEMORY.md ${n} 字符，距 ${MAIN_LIMIT} 上限只剩 ${MAIN_LIMIT - n} ⇒ 下轮新增前先外移`);
  }

  // ===== 2. 外移指针 + 外移件必须存在（防「删了内容却没搬」或「只留指针、件丢了」）=====
  const refs = txt.match(/MEMORY_外移[^\s`）)]*\.md/g) || [];
  if (refs.length === 0) {
    fail('主 MEMORY.md 未出现任何「MEMORY_外移*.md」指针 ⇒ 一旦瘦身就会变成"只删不搬"（内容永久丢失）');
  } else {
    const uniq = Array.from(new Set(refs));
    const dir = MAIN.replace(/[^/\\]+$/, '');
    for (const r of uniq) {
      const fp = r.includes('/') || r.includes('\\') ? r : dir + r;
      if (!exists(fp)) fail(`外移指针指向的文件在磁盘上不存在（断链 = 内容已丢）：${fp}`);
      else {
        const an = chars(readUtf8(fp));
        if (an > ARCHIVE_LIMIT) {
          fail(`外移件 ${an} 字符 > ${ARCHIVE_LIMIT} ⇒ 该做月度蒸馏（30 天前日志归 MEMORY.md 后删除）：${fp}`);
        }
      }
    }
  }
} else {
  fail(`主 MEMORY.md 找不到（路径可用 MEMORY_MD_PATH 覆盖）：${MAIN}`);
}

// ===== 3. 用户级 MEMORY.md 预算（硬上限 4000）=====
if (exists(USER)) {
  checked++;
  const n = chars(readUtf8(USER));
  if (n > USER_LIMIT) {
    fail(`用户级 MEMORY.md ${n} 字符 > ${USER_LIMIT} 上限（超即截断 = 记忆失效）：${USER}`);
  }
} else {
  warns.push(`用户级 MEMORY.md 未找到（跳过，非判红）：${USER}`);
}

// ===== 4. 自失效护栏：两个文件都没探到 ⇒ 判红（不许"扫空恒绿"）=====
if (checked === 0) {
  fail(`两个 MEMORY.md 都没探到 ⇒ 本守卫形同虚设（扫空恒绿），请检查路径或用 MEMORY_MD_PATH 覆盖`);
}

if (warns.length) warns.forEach((m) => console.log('⚠️ [memory-budget] ' + m));

if (problems.length) {
  console.log('❌ 注入层记忆预算守卫失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  process.exit(1);
}
console.log(`✅ 注入层记忆预算守卫通过（主≤${MAIN_LIMIT} + 用户级≤${USER_LIMIT} + 外移件断链检查 + 扫空判红护栏，已探 ${checked} 个文件）`);
console.log('注入层记忆预算守卫结果：1 通过 / 0 失败');
