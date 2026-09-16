#!/usr/bin/env node
/**
 * R44 · 小程序页面声明守卫
 *
 * 背景：pages/dish/ 曾作为 batch 0 占位页留在仓库，app.json 未声明它，
 * 但它的 8 条 i18n 词条（terms.js 的 dish 块）只被它自己消费 —— 删页面时若不同步删词条，
 * 就会留下无主词条，而 K11 只校验双副本 MD5、不管有没有消费者 ⇒ 静默污染。
 * 根因是：此前没有任何门禁校验「页面声明 ↔ 文件存在」是否一致。
 *
 * 本守卫双向校验：
 *   ① 声明了但文件缺失/不全 → 页面打不开（编译期或运行期才炸）
 *   ② 有文件但未被声明     → 孤儿页（进不了包体，或混进包体但不可达）
 *
 * 用法：node tools/check_pages.js      （已登记为 verify_all.js 的第 40 个套件）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 显式白名单：允许存在但不被 app.json 声明的页面（需写明理由，不要随意加） */
const ORPHAN_WHITELIST = [
  // 例：'pages/_shared/preview',  // 仅供开发者工具预览，不发布
];

/** 四件套中必须存在的（.json/.wxss 可选，.js/.wxml 缺一不可） */
const REQUIRED_EXT = ['.js', '.wxml'];

const problems = [];
const fail = (msg) => problems.push(msg);

// —— 读 app.json ——
const appJsonPath = path.join(ROOT, 'app.json');
if (!fs.existsSync(appJsonPath)) {
  console.error('❌ 找不到 app.json：' + appJsonPath);
  process.exit(1);
}
let app;
try {
  app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
} catch (e) {
  console.error('❌ app.json 解析失败：' + e.message);
  process.exit(1);
}

const declared = Array.isArray(app.pages) ? app.pages.slice() : [];
// tabBar 也会引用页面，一并纳入「已声明」
if (app.tabBar && Array.isArray(app.tabBar.list)) {
  for (const it of app.tabBar.list) {
    if (it && typeof it.pagePath === 'string' && !declared.includes(it.pagePath)) {
      declared.push(it.pagePath);
    }
  }
}

// —— ① 声明 → 文件 ——
const declaredSet = new Set();
for (const p of declared) {
  declaredSet.add(p);
  for (const ext of REQUIRED_EXT) {
    const fp = path.join(ROOT, p + ext);
    if (!fs.existsSync(fp)) {
      fail(`app.json 声明了 "${p}"，但缺少 ${p}${ext}`);
    }
  }
}

// —— ② 文件 → 声明 ——
const found = [];
function walkPages(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      walkPages(abs);
    } else if (name.endsWith('.js')) {
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      found.push(rel.slice(0, -3)); // 去掉 .js
    }
  }
}
walkPages(path.join(ROOT, 'pages'));

const orphans = found.filter(
  (p) => !declaredSet.has(p) && !ORPHAN_WHITELIST.includes(p)
);
for (const p of orphans.sort()) {
  fail(
    `pages/ 下存在 "${p}" 但 app.json 未声明 → 孤儿页` +
      `（若确需保留请加进 ORPHAN_WHITELIST 并写明理由；否则连同其专属 i18n 词条一并删除）`
  );
}

// —— 结论 ——
if (problems.length) {
  console.log('❌ 页面声明校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  process.exit(1);
}

console.log(
  '✅ 页面声明校验通过（app.json 声明 ' +
    declared.length +
    ' 页，pages/ 下实到 ' +
    found.length +
    ' 页；四件套必需项 .js/.wxml 齐全，无孤儿页）'
);
