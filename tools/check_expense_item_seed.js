/**
 * check_expense_item_seed.js —— 费用项清单口径守卫（R121，round97）
 *
 * 背景（同族病第 25 例；与 R110 `check_income_channel_seed.js` 同族，但**费用侧此前零守卫**）：
 *   费用项清单散在**四处副本**，且互不相知：
 *     · 后端种子 `cloudfunctions/initDb/collections.js::SEED_EXPENSE_ITEMS`（权威：item_key / item_name / category / sort_order）
 *     · 原型副本 `specs/dev-specs/prototype/init_db.js::SEED_EXPENSE_ITEMS`
 *     · 前端渲染单源 `miniprogram/i18n/terms.js::ledger.expense`（只存**项名**，无 key）
 *     · 术语副本 `specs/dev-specs/i18n/terms.js`（已被 `selftest_batch8b` K11 守逐字一致 ⇒ 本守卫不重复守）
 *   另有**人读面**：规范 `ModuleA` §A.2 的「营销推广费下分项」表（项目名带括号注释）。
 *
 *   收入侧 2026-09（round78）已被 R110 守上，因为当时发现「前端 7 项 / 后端 5 项」已分叉；
 *   **费用侧当时零命中**（R110 的扫描面只解析 SEED_INCOME_ITEMS）。round97（2026-09-22）
 *   按规范 A.2 给营销段补 3 项时，才发现「费用侧没有任何守卫」—— 同一份清单的 4 处副本
 *   任一处被单独改动，都不会有任何套件转红 ⇒ 下次必然分叉（同族病复发路径）。
 *
 * 后果（为什么必须守）：
 *   新建账套时 `shop_expense_item` 由种子写入 ⇒ 若种子与前端 terms 分叉，
 *   账套里预设项名与页面渲染的全集**对不上**（同名不同 key / 异名同义），
 *   导出、对账、按名归并全部受影响；而 `markFixedRows`（只按名字打标）会静默认不出预设项。
 *
 * 判据：
 *   E1 前提 / fail-closed：三份源（云函数种子 / 原型副本 / 前端 terms）都可解析
 *   E2 云函数种子 ≡ 原型副本（逐项 key|name|category|sort，保序）
 *   E3 前端 terms.expense ≡ 云函数种子（逐 category、项名、保序）
 *   E4 规范 A.2 营销表（项名归一化去括号）≡ 代码 marketing 项名（集合双向）
 *   E5 下界护栏：总项数 ≥ 20、每个 category ≥ 2（防整体缩水 / 类被清空后仍判绿）
 *   E6 前提证明（非恒真）：两侧数量相等且非空，否则判红
 *
 * ⚠️ 已知坑的对应处理：
 *   · 坑⑭/⑯ 裸扫数字必误杀：本守卫**不扫任何裸数字**，只解析字面量与 markdown 表格行。
 *   · 坑⑮ 自指：本文件不写任何「唯一声明处」标记词。
 *   · R66 断言计数按 `✅` 字符出现次数 ⇒ 断言**消息文本里不出现这两个字符**。
 *   · 坑⑱ `git ls-files` 只扫 index：本守卫只按固定相对路径直读，不依赖索引。
 *
 * 运行：node tools/check_expense_item_seed.js   （由 verify_all.js 的 [expense-item-seed] 套件调用）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF_REL = 'cloudfunctions/initDb/collections.js';
const PROTO_REL = 'specs/dev-specs/prototype/init_db.js';
const TERMS_REL = 'miniprogram/i18n/terms.js';
const SPEC_REL = 'specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md';

// 下界护栏用的契约值（设计下界，不是派生值）
const MIN_TOTAL = 20;
const MIN_PER_CATEGORY = 2;

let pass = 0;
let fail = 0;
const ok = (id, msg) => { pass += 1; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail += 1; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

function readRel(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/** SEED_EXPENSE_ITEMS ⇒ [{key,name,category,sort}]（按出现顺序保序） */
function parseSeed(src) {
  const start = src.indexOf('const SEED_EXPENSE_ITEMS = [');
  if (start < 0) return null;
  const end = src.indexOf('\n];', start);
  const block = src.slice(start, end < 0 ? start + 6000 : end);
  const re = /\{\s*item_key:\s*'([^']+)',\s*item_name:\s*'([^']+)',\s*category:\s*'([^']+)',\s*sort_order:\s*(\d+)/g;
  const out = [];
  let m;
  while ((m = re.exec(block))) {
    out.push({ key: m[1].trim(), name: m[2].trim(), category: m[3].trim(), sort: Number(m[4]) });
  }
  return out.length ? out : null;
}

/** terms.js::ledger.expense ⇒ { category: [项名...] } */
function parseFrontExpense(src) {
  const start = src.indexOf('expense: [');
  if (start < 0) return null;
  const end = src.indexOf('subItem:', start);
  const block = src.slice(start, end < 0 ? start + 4000 : end);
  const out = {};
  const re = /category: '(\w+)',\s*label: '([^']*)',\s*items: \[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(block))) {
    out[m[1]] = m[3].split(',').map((s) => s.trim().replace(/^'|'$/g, '').trim()).filter(Boolean);
  }
  return Object.keys(out).length ? out : null;
}

/** 规范 §A.2 营销推广表 ⇒ [项名]（归一化：取「（」/「(」前；排除表头与汇总行） */
function parseSpecA2(md) {
  const start = md.indexOf('## A.2 费用结构');
  if (start < 0) return null;
  const end = md.indexOf('## A.3 ', start);
  const block = md.slice(start, end < 0 ? start + 3000 : end);
  const out = [];
  for (const line of block.split(/\r?\n/)) {
    const m = /^\|\s*([^|]+?)\s*\|/.exec(line);
    if (!m) continue;
    let name = m[1].replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (!name || name === '费用项' || /^-+$/.test(name)) continue;
    if (name.includes('汇总行')) continue;
    name = name.split('（')[0].split('(')[0].trim();
    if (name) out.push(name);
  }
  return out.length ? out : null;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const diff = (a, b) => a.filter((x) => !b.includes(x));

// ============ E1 前提 / fail-closed ============
section('E1 前提与 fail-closed（三份代码源必须都可解析）');

let cfSeed = null, protoSeed = null, frontExp = null, specA2 = null;
try { cfSeed = parseSeed(readRel(CF_REL)); } catch (_) { cfSeed = null; }
try { protoSeed = parseSeed(readRel(PROTO_REL)); } catch (_) { protoSeed = null; }
try { frontExp = parseFrontExpense(readRel(TERMS_REL)); } catch (_) { frontExp = null; }
try { specA2 = parseSpecA2(readRel(SPEC_REL)); } catch (_) { specA2 = null; }

if (cfSeed && cfSeed.length) ok('E1-①', `云函数种子解析成功（${cfSeed.length} 项）`);
else no('E1-①', 'collections.js::SEED_EXPENSE_ITEMS 解析失败（单源被改名或改写法即失守）');

if (protoSeed && protoSeed.length) ok('E1-②', `原型副本解析成功（${protoSeed.length} 项）`);
else no('E1-②', 'prototype/init_db.js::SEED_EXPENSE_ITEMS 解析失败（fail-closed）');

if (frontExp && frontExp.marketing && frontExp.marketing.length) {
  const total = Object.keys(frontExp).reduce((n, k) => n + frontExp[k].length, 0);
  ok('E1-③', `前端 terms.expense 解析成功（${Object.keys(frontExp).length} 类 / ${total} 项）`);
} else {
  no('E1-③', 'miniprogram/i18n/terms.js::ledger.expense 解析失败（fail-closed）');
}

if (specA2 && specA2.length) ok('E1-④', `规范 A.2 营销表解析成功（${specA2.length} 项）`);
else no('E1-④', '规范 ModuleA §A.2 营销推广表解析失败（章节被改名或表格结构变了）');

// ============ E2 云函数种子 ≡ 原型副本 ============
section('E2 同一份种子的两处副本必须逐项一致');

if (cfSeed && protoSeed) {
  const a = cfSeed.map((x) => `${x.key}|${x.name}|${x.category}|${x.sort}`);
  const b = protoSeed.map((x) => `${x.key}|${x.name}|${x.category}|${x.sort}`);
  const bad = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) bad.push(`[${i + 1}] 云函数「${a[i] || '缺'}」vs 原型「${b[i] || '缺'}」`);
  }
  if (bad.length === 0) ok('E2-①', `${a.length} 项逐项一致（key | 名 | 类 | sort）`);
  else no('E2-①', `副本漂移：${bad.slice(0, 4).join('；')}${bad.length > 4 ? ` 等 ${bad.length} 处` : ''}`);
} else {
  no('E2-①', '副本比对跳过（上游解析失败，fail-closed）');
}

// ============ E3 前端 terms ≡ 云函数种子 ============
section('E3 前端渲染清单 ≡ 后端种子（逐类、项名、保序）');

if (cfSeed && frontExp) {
  const cats = ['operation', 'labor', 'marketing', 'other'];
  const badParts = [];
  for (const c of cats) {
    const seedNames = cfSeed.filter((x) => x.category === c).sort((x, y) => x.sort - y.sort).map((x) => x.name);
    const frontNames = frontExp[c] || null;
    if (!frontNames) { badParts.push(`${c} 前端缺该类`); continue; }
    if (seedNames.length !== frontNames.length) {
      badParts.push(`${c} 数量 ${frontNames.length} vs ${seedNames.length}`);
      continue;
    }
    for (let i = 0; i < seedNames.length; i += 1) {
      if (seedNames[i] !== frontNames[i]) {
        badParts.push(`${c}[${i + 1}] 前端「${frontNames[i]}」vs 种子「${seedNames[i]}」`);
      }
    }
  }
  if (badParts.length === 0) ok('E3-①', `4 类共 ${cfSeed.length} 项逐项同名同序`);
  else no('E3-①', `前后端清单不一致：${badParts.slice(0, 5).join('；')}`);
} else {
  no('E3-①', '前后端比对跳过（上游解析失败，fail-closed）');
}

// ============ E4 规范 A.2 ≡ 代码 marketing ============
section('E4 规范 A.2 营销表 ≡ 代码 marketing 项（集合双向）');

if (cfSeed && specA2) {
  const codeNames = cfSeed.filter((x) => x.category === 'marketing').sort((x, y) => x.sort - y.sort).map((x) => x.name);
  if (sameSet(specA2, codeNames)) {
    ok('E4-①', `规范 A.2 与代码 marketing 集合相等（各 ${codeNames.length} 项）`);
  } else {
    no('E4-①', `集合不等：规范独有 [${diff(specA2, codeNames)}] / 代码独有 [${diff(codeNames, specA2)}]`);
  }
  if (specA2.length >= MIN_PER_CATEGORY) ok('E4-②', `规范侧项数 ${specA2.length} ≥ ${MIN_PER_CATEGORY}`);
  else no('E4-②', `规范侧项数 ${specA2.length} < ${MIN_PER_CATEGORY}（解析面可能打空）`);
} else {
  no('E4-①', '规范 ⇄ 代码比对跳过（上游解析失败，fail-closed）');
  no('E4-②', '规范侧项数无法判定（上游解析失败）');
}

// ============ E5 下界护栏 ============
section('E5 下界护栏（防整体缩水 / 类被清空后仍判绿）');

if (cfSeed) {
  if (cfSeed.length >= MIN_TOTAL) ok('E5-①', `种子总项数 ${cfSeed.length} ≥ 下界 ${MIN_TOTAL}`);
  else no('E5-①', `种子总项数 ${cfSeed.length} < 下界 ${MIN_TOTAL}（清单被整体删项）`);

  const thin = ['operation', 'labor', 'marketing', 'other'].filter(
    (c) => cfSeed.filter((x) => x.category === c).length < MIN_PER_CATEGORY,
  );
  if (thin.length === 0) ok('E5-②', `4 个 category 项数均 ≥ ${MIN_PER_CATEGORY}`);
  else no('E5-②', `category 项数不足：${thin.join(', ')}`);
} else {
  no('E5-①', '下界判定跳过（种子解析失败）');
  no('E5-②', '分类下界判定跳过（种子解析失败）');
}

// ============ E6 前提证明（非恒真） ============
section('E6 前提证明（两侧非空且数量相等，否则前面的比对是空转）');

if (cfSeed && frontExp) {
  const total = Object.keys(frontExp).reduce((n, k) => n + frontExp[k].length, 0);
  if (total > 0 && total === cfSeed.length) ok('E6-①', `前端 ${total} 项 ≡ 种子 ${cfSeed.length} 项（非空且相等）`);
  else no('E6-①', `前端 ${total} 项 vs 种子 ${cfSeed.length} 项 —— 数量不等则逐项比对无意义`);
} else {
  no('E6-①', '前提证明跳过（上游解析失败，fail-closed）');
}

console.log(`\n===== 费用项清单口径守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
