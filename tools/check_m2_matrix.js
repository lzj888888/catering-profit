#!/usr/bin/env node
/**
 * M2 矩阵/对比改造守卫（R 批次 · 2026-10-11）
 *
 * 背景：M2 G1 场景矩阵（calcSandbox 新增 matrix action）+ G4 免费导出（exportData m2_matrix scope）
 *   是本次改造的核心新增面。两者都不能靠"肉眼"守住（引擎 service.js 不准改、付费墙红线不准绕过），
 *   故用静态契约检查把"该有的分支都在"钉死：
 *   ① calcSandbox 必须有 matrix action，且确实循环调 calcSandbox（引擎零改、批量复用）；
 *   ② exportData 必须有 m2_matrix scope，且对免费导出**显式跳过**付费墙判定（isM2FreeExport）；
 *   ③ matrix 术语块在两份 terms 副本里都存在且关键键齐全（单源双副本一致）。
 *
 * 纯静态（fs + 正则），不 require 任何云 SDK，可在普通 node 下被 verify_all 串联运行。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
const fail = (m) => problems.push(m);

const read = (p) => {
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp)) { fail('缺少文件：' + p); return ''; }
  return fs.readFileSync(fp, 'utf8');
};

// ===== 1. calcSandbox matrix action =====
const calcIdx = read('cloudfunctions/calcSandbox/index.js');
if (!/event\.action\s*===\s*['"]matrix['"]/.test(calcIdx)) fail('calcSandbox 缺少 matrix action 分支');
// 🔴 R297 第二轮：原判据硬钉字面量 `arr.map((c) => calcSandbox`（实现细节）。
//   修「矩阵分支零校验 ⇒ 越界值静默产数」必须在调用引擎**之前**插逐行校验，
//   回调签名必然从 `(c)` 变成 `(c, i)` ⇒ 字面量判据把"修这个 bug"直接判红。
//   ⇒ 改为**判语义**（仍是批量 map 复用引擎，不多不少），并**加严一条**：必须逐行过 validateClean。
const mx = calcIdx.slice(calcIdx.indexOf("action === 'matrix'"));
const mxBody = mx.slice(0, mx.indexOf('const shopId') > 0 ? mx.indexOf('const shopId') : mx.length);
if (!/arr\.map\(/.test(mxBody)) fail('matrix 未用 arr.map 批量调用（引擎零改、批量复用）');
if (!/calcSandbox\(/.test(mxBody)) fail('matrix 分支未调用 calcSandbox（引擎零改、批量复用）');
if (!/validateClean\(/.test(mxBody)) {
  fail('matrix 分支未做逐行入参校验（R297：零校验 ⇒ 毛利率 150 / 负房租静默产数，方向是保本偏低）');
}

// ===== 2. exportData m2_matrix 免费分支 =====
const exp = read('cloudfunctions/exportData/index.js');
if (!/scope\s*===\s*'m2_matrix'/.test(exp)) fail('exportData 缺少 m2_matrix scope');
if (!/isM2FreeExport/.test(exp)) fail('exportData 缺少 M2 免费导出豁免标记 isM2FreeExport');
if (!/if\s*\(\s*!isM2FreeExport\s*\)\s*\{[\s\S]*hasFeature/.test(exp)) {
  fail('exportData 未对 m2_matrix 显式跳过付费墙判定（hasFeature 必须包在 if(!isM2FreeExport) 内）');
}

// ===== 3. 术语双副本一致 =====
const t1 = read('miniprogram/i18n/terms.js');
const t2 = read('specs/dev-specs/i18n/terms.js');
const needKeys = ['matrix:', 'exportXlsx', 'colBreakMonthly', 'cmpTitle', 'cmpDoCompare', 'toCompare'];
for (const k of needKeys) {
  if (!t1.includes(k)) fail('miniprogram/i18n/terms.js 缺「' + k + '」');
  if (!t2.includes(k)) fail('specs/dev-specs/i18n/terms.js 缺「' + k + '」');
}

if (problems.length) {
  console.log('❌ M2 矩阵/对比改造守卫失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  process.exit(1);
}
console.log('✅ M2 矩阵/对比改造守卫通过（matrix action 批量复用引擎 + m2_matrix 免费导出豁免 + 术语双副本一致）');
console.log('M2 矩阵/对比改造守卫结果：1 通过 / 0 失败');
