#!/usr/bin/env node
/**
 * R50 · 单源派生守卫（admin 鉴权核心）
 *
 * 背景（与 L 组同源，2026-09-17 新登记）：
 *   `cloudfunctions/_adminCore/adminAuth.js` 是**单源**（文件头自称「单源，零 wx 依赖纯函数 +
 *   注入式中间件」），各 admin 云函数目录下各有一份同名副本（11 份）。但 L 组的
 *   `tools/sync_common.js` **只管 `cloudfunctions/common/`**，对 `_adminCore` 零覆盖 ——
 *   也就是说：改了单源忘了同步副本，或者手改了某一份副本，**现有 45 个套件全绿也发现不了**，
 *   上线后表现为「同一个鉴权逻辑在不同云函数里行为不一致」，且是静默的。
 *   这正是 L 组把 `common/` 收编进门禁之前的状态原样复刻了一遍。
 *
 * 本守卫只做一件事：**每份 `<func>/adminAuth.js` 必须与 `_adminCore/adminAuth.js` 逐字节一致**
 *   （归一 CRLF / 去 BOM 后比较；两份文件由同一源生成，差异只可能来自漂移）。
 *
 * 为什么不是「改成 require 单源」：云函数各自独立打包上传，跨目录 require 到包外会
 *   MODULE_NOT_FOUND（L 组实测结论）。派生副本是**必需**的，所以必须靠守卫守一致性。
 *
 * 用法：
 *   node tools/check_admincore.js          只读校验（exit 1 = 有漂移）
 *   node tools/check_admincore.js --fix    用单源覆盖所有副本（确定性、可 git 回退）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const SRC_DIR = '_adminCore';
const MODULE_FILE = 'adminAuth.js';
const SRC = path.join(CF, SRC_DIR, MODULE_FILE);

const FIX = process.argv.includes('--fix');

/** 归一：去 BOM + CRLF→LF（同 L 组：Windows 写盘与 Linux 文本模式会带来假差异） */
function norm(s) {
  return s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function md5ish(s) {
  // 不引 crypto，只为报错时给个短指纹
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

if (!fs.existsSync(SRC)) {
  console.error(`❌ 单源不存在：${path.relative(ROOT, SRC)}`);
  process.exit(1);
}
const srcNorm = norm(fs.readFileSync(SRC, 'utf8'));

const dirs = fs.readdirSync(CF, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== SRC_DIR)
  .map((d) => d.name)
  .sort();

const copies = [];
const missing = [];

for (const fn of dirs) {
  const dir = path.join(CF, fn);
  const file = path.join(dir, MODULE_FILE);
  const idx = path.join(dir, 'index.js');
  const usesIt = fs.existsSync(idx) && /require\(\s*['"]\.\/adminAuth['"]\s*\)/.test(fs.readFileSync(idx, 'utf8'));
  if (!fs.existsSync(file)) {
    if (usesIt) missing.push(fn);      // 引了却没有副本 → 云函数必然 MODULE_NOT_FOUND
    continue;
  }
  copies.push({ fn, file });
}

const drift = [];
for (const c of copies) {
  const got = norm(fs.readFileSync(c.file, 'utf8'));
  if (got !== srcNorm) {
    drift.push({
      fn: c.fn,
      rel: path.relative(ROOT, c.file),
      srcLines: srcNorm.split('\n').length,
      gotLines: got.split('\n').length,
      srcHash: md5ish(srcNorm),
      gotHash: md5ish(got),
    });
  }
}

if (FIX) {
  let fixed = 0;
  for (const d of drift) {
    fs.writeFileSync(d.rel ? path.join(ROOT, d.rel) : d.file, srcNorm, 'utf8');
    fixed++;
    console.log(`  🔧 已用单源覆盖 ${d.rel}`);
  }
  console.log(`\n—— 单源派生同步：修复 ${fixed} 份副本（单源 ${path.relative(ROOT, SRC)}）`);
  process.exit(0);
}

console.log(`—— 单源：${path.relative(ROOT, SRC)}（${srcNorm.split('\n').length} 行，指纹 ${md5ish(srcNorm)}）`);
console.log(`—— 待校验副本：${copies.length} 份；引用了该模块却缺副本的函数：${missing.length} 个`);

if (missing.length) {
  console.error(`\n❌ 以下云函数 require('./adminAuth') 但目录里没有该文件（云函数必然启动失败）：`);
  missing.forEach((fn) => console.error(`   - cloudfunctions/${fn}/index.js → 缺 ${MODULE_FILE}`));
}

if (drift.length) {
  console.error(`\n❌ 以下 ${drift.length} 份副本与单源不一致（漂移！改的是单源还是副本？）：`);
  for (const d of drift) {
    console.error(`   - ${d.rel}  副本 ${d.gotLines} 行/指纹 ${d.gotHash} ≠ 单源 ${d.srcLines} 行/指纹 ${d.srcHash}`);
  }
  console.error(`\n   修法（二选一，别手改副本）：`);
  console.error(`     · 单源是最新的  → node tools/check_admincore.js --fix`);
  console.error(`     · 副本是最新的  → 先把改动合并回 cloudfunctions/${SRC_DIR}/${MODULE_FILE}，再 --fix`);
}

if (drift.length || missing.length) {
  console.error(`\n===== R50 单源派生守卫：不通过（漂移 ${drift.length} / 缺副本 ${missing.length}）=====`);
  process.exit(1);
}

console.log(`✅ 单源派生校验通过：${copies.length} 份 ${MODULE_FILE} 副本均 ≡ cloudfunctions/${SRC_DIR}/${MODULE_FILE}`);
