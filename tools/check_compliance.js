#!/usr/bin/env node
/**
 * R42 · 合规守卫（iOS 自动订阅展示约束）
 *
 * 背景：SEED_PLANS 里有 `plan_auto_subscribe`（19.9 元/月，type='auto_subscribe'，enabled=true），
 * 按微信运营规范 iOS 端不得展示自动订阅。但当前 iOS 过滤**零实现**（仅存在于 payCreateOrder 的注释里），
 * 全靠 `utils/paywall.js` 硬编码 `plan_basic_month` 兜着 —— 一旦有人做套餐选择 UI 并引用该套餐，
 * iOS 用户就能看到并购买，属静默合规回归。
 *
 * 约定（见 core/10 契约 payCreateOrder 条目）：
 *   - 后端**有意不拦截**（客户端 platform 不可信），这是展示层约束；
 *   - 谁新增/改动套餐展示层，谁负责同步实现 iOS 过滤。
 *
 * 本守卫不禁止引用，只强制「引用时必须显式确认已处理」：
 *   在命中行加  /* compliance-ok: <理由> *​/  即可豁免（理由必填，便于回溯谁担责）。
 *
 * 用法：node tools/check_compliance.js    （已登记为 verify_all.js 的第 41 个套件）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 前端可见层：只有这些目录的引用才算「展示层」 */
const SCAN_DIRS = ['pages', 'utils'];
const SCAN_FILES = ['app.js', 'app.json', 'app.wxss'];

/** 敏感标记：命中即需在同/上行显式豁免 */
const SENSITIVE = ['auto_subscribe'];
/** 豁免标记（必须带理由） */
const EXEMPT_RE = /compliance-ok\s*:\s*\S+/;

const problems = [];
const scanned = [];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.(js|json|wxml|wxss)$/.test(name)) out.push(abs);
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
for (const f of SCAN_FILES) {
  const abs = path.join(ROOT, f);
  if (fs.existsSync(abs)) files.push(abs);
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

for (const f of files) {
  const rf = rel(f);
  scanned.push(rf);
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!SENSITIVE.some((s) => line.includes(s))) return;
    // 命中行本身、或紧邻上一行带豁免标记 → 放行
    const prev = i > 0 ? lines[i - 1] : '';
    if (EXEMPT_RE.test(line) || EXEMPT_RE.test(prev)) return;
    problems.push(
      `${rf}:${i + 1}  引用了 "${SENSITIVE.find((s) => line.includes(s))}"\n` +
        `      → iOS 端不得展示自动订阅（R42）。若已实现 iOS 过滤，请在本行或上一行加：\n` +
        `        /* compliance-ok: <理由，例如 iOS 端已过滤 auto_subscribe 套餐项> */\n` +
        `      原文：${line.trim().slice(0, 120)}`
    );
  });
}

if (problems.length) {
  console.log('❌ 合规校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  process.exit(1);
}

console.log(
  '✅ 合规校验通过（扫描 ' +
    scanned.length +
    ' 个前端文件；未发现未加豁免的 auto_subscribe 引用）'
);
