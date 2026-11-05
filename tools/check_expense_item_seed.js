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
 *   E7 「项名当机器键」必须命中种子（R217，round217 新增）：
 *       recurringFixed / recurringVariable / expenseItemNotes 键 / missingWarnItems  ⊆ 种子项名；
 *       配影子样本自证判据有分辨力 + 运营类行内注覆盖下界（防新补的文案被整段删回去）。
 *   E8 「语义锚点」必须真单源（R298，R297 第七轮 A1 复核后新增）：
 *       `TERMS.semantic.<键>`（业务逻辑引用的锚点）必须 ① 已声明为非空字符串 ② ∈ 对应 category
 *       的预设项 ③ 在 terms 源里以 `SEMANTIC.<键>` 被引用（= 预设清单真的引用了它，非孤立副本）。
 *       配影子样本自证"引用计数"有分辨力。
 *
 * 为什么加 E8（根因，与本文件既有主题同族更深一层）：
 *   E7 守的是「**项名**被当机器键」；E8 守的是「**业务逻辑**拿项名当机器键」——
 *   `subpkg/biz/month/input.js` 的「费用侧手改上锁」与「补贴自动带出」原写作
 *   `r.subItem === '外卖活动补贴'`（中文字面量）⇒ 术语表一改名，两处**同时静默失灵**
 *   （上锁失效、用户手改被自动值覆盖；补贴带不过去 ⇒ 利润算错），零报错、门禁全绿。
 *   现改为 `TERMS.semantic.expenseMktSubsidy`，且 `items` 里同一锚点被引用 ⇒ **真单源**：
 *   改名只改一处、逻辑与清单不可能分叉。E8-③ 专门钉住"有没有被改回字面量副本"。
 *
 * 为什么加 E7（根因）：
 *   `recurringFixed/Variable`（首月铺哪些行）、`expenseItemNotes`（行上挂哪句说明）、
 *   `missingWarnItems`（保存前提示哪几项）**三者都以「费用项显示名」当机器键**
 *   —— 改一个 `item_name`，铺行会静默少一行、说明会静默不显示、提示会静默不弹，
 *   而门禁全绿（同族病：细项名当机器键 ⇒ 改名静默失效）。
 *   此前这三处**零守卫**（round216 探针实测：今天全部命中，属"今天对、明天可能静默错"）。
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
  // 🔴 修正：category 与 items 之间可能夹 `core: true`（新手模式标记，术语单源已用）；
  //   原正则要求 label 紧跟 items ⇒ 漏解析带 core 的 operation/labor 两类 ⇒ 误报"缺类"。
  //   真实数据（terms.expense 4 类 23 项）与种子逐项同序一致，是守卫解析器错、不是数据错。
  const re = /category: '(\w+)',\s*label: '([^']*)',\s*(?:core:\s*true,\s*)?items: \[([^\]]*)\]/g;
  // 🔴 R298：`items` 里可以直接引用**语义锚点常量**（`SEMANTIC.<键>`）—— 这是**真单源**：
  //   预设清单与业务逻辑引同一个值，改名只需改一处。此处把常量 token 解析回字面量，
  //   否则 E3 会把 `SEMANTIC.expenseMktSubsidy` 当成项名去和种子比 ⇒ 误报"清单不一致"。
  //   ⚠️ 解析不出（semantic 组被删/改名）时**原样保留 token** ⇒ E3 判红，fail-closed，不静默放行。
  let semanticMap = {};
  try { semanticMap = require(path.join(ROOT, TERMS_REL)).TERMS.semantic || {}; } catch (_) { semanticMap = {}; }
  const resolveAnchorTok = (tok) => {
    const mm = /^SEMANTIC\.([A-Za-z_$][\w$]*)$/.exec(tok);
    return mm && typeof semanticMap[mm[1]] === 'string' ? semanticMap[mm[1]] : tok;
  };
  let m;
  while ((m = re.exec(block))) {
    out[m[1]] = m[3].split(',').map((s) => s.trim().replace(/^'|'$/g, '').trim())
      .map(resolveAnchorTok).filter(Boolean);
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

// ============ E7 用的解析器与纯判据（纯函数 ⇒ 影子样本可直接证伪它）============

/** terms.js::ledger.<field> ⇒ [字符串]（单行数组字面量，如 recurringFixed / missingWarnItems） */
function parseStrList(src, field) {
  const re = new RegExp('\\b' + field + ':\\s*\\[([^\\]]*)\\]');
  const m = re.exec(src);
  if (!m) return null;
  const out = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '').trim()).filter(Boolean);
  return out.length ? out : null;
}

/** terms.js::ledger.expenseItemNotes ⇒ [键名]（只认行首引号形态；块内注释以 // 起头，天然不匹配） */
function parseNoteKeys(src) {
  const start = src.indexOf('expenseItemNotes: {');
  if (start < 0) return null;
  const end = src.indexOf('\n    },', start);
  const block = src.slice(start, end < 0 ? start + 3000 : end);
  const out = [];
  const re = /^\s*'([^']+)':/gm;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out.length ? out : null;
}

/** 「名单里哪些项不在全集里」 —— 抽成纯函数，好让影子样本能直接测它（判据自证，防恒真） */
const missingFrom = (list, universe) => (list || []).filter((n) => universe.indexOf(n) < 0);

// 运营类行内注覆盖下界（实测 7，取下沿 6 —— 防新补的文案被整段删回去而无人知）
const MIN_OPERATION_NOTES = 6;

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

// ============ E7 「费用项名当机器键」必须命中种子（R217） ============
section('E7 项名当机器键：铺行名单 / 行内注键 / 缺项提示名单 必须命中种子');

let termsSrc = null;
try { termsSrc = readRel(TERMS_REL); } catch (_) { termsSrc = null; }
const rFixed = termsSrc ? parseStrList(termsSrc, 'recurringFixed') : null;
const rVar = termsSrc ? parseStrList(termsSrc, 'recurringVariable') : null;
const nKeys = termsSrc ? parseNoteKeys(termsSrc) : null;
const mWarn = termsSrc ? parseStrList(termsSrc, 'missingWarnItems') : null;

if (rFixed && rVar && nKeys && mWarn) {
  ok('E7-①', `四处名单均解析成功（固定 ${rFixed.length} / 波动 ${rVar.length} / 行内注 ${nKeys.length} / 缺项提示 ${mWarn.length}）`);
} else {
  no('E7-①', '名单解析失败（terms 被改名或改写法即失守 ⇒ fail-closed）');
}

if (cfSeed && rFixed && rVar) {
  const names = cfSeed.map((x) => x.name);
  const badRec = missingFrom(rFixed.concat(rVar), names);
  if (badRec.length === 0) ok('E7-②', `常规科目预置名单 ${rFixed.length + rVar.length} 项全部命中种子`);
  else no('E7-②', `预置名单未命中种子（会静默少铺行）：${badRec.join('、')}`);
} else {
  no('E7-②', '预置名单比对跳过（上游解析失败，fail-closed）');
}

if (cfSeed && nKeys) {
  const names = cfSeed.map((x) => x.name);
  const badNote = missingFrom(nKeys, names);
  if (badNote.length === 0) ok('E7-③', `行内注 ${nKeys.length} 个键全部命中种子`);
  else no('E7-③', `行内注键未命中种子（文案永不显示）：${badNote.join('、')}`);
} else {
  no('E7-③', '行内注键比对跳过（上游解析失败，fail-closed）');
}

if (cfSeed && mWarn) {
  const names = cfSeed.map((x) => x.name);
  const badWarn = missingFrom(mWarn, names);
  if (badWarn.length === 0) ok('E7-④', `缺项提示名单 ${mWarn.length} 项全部命中种子`);
  else no('E7-④', `缺项提示名单未命中种子（保存前提示会静默失效）：${badWarn.join('、')}`);
} else {
  no('E7-④', '缺项提示名单比对跳过（上游解析失败，fail-closed）');
}

// 判据自证（影子样本）：证明 missingFrom 真有分辨力 —— 否则上面几条可以恒真（假绿）
if (cfSeed && cfSeed.length) {
  const universe = cfSeed.map((x) => x.name);
  const fakeHit = missingFrom(['__round217_假项名__'], universe).length;
  const realHit = missingFrom([universe[0]], universe).length;
  if (fakeHit === 1 && realHit === 0) ok('E7-⑤', '判据自证：假项名报 1 条、真项名报 0 条（missingFrom 有分辨力）');
  else no('E7-⑤', `判据自证失败（假项名报 ${fakeHit} / 真项名报 ${realHit}）⇒ 上面几条的命中结论不可信`);
} else {
  no('E7-⑤', '判据自证跳过（种子解析失败）');
}

// 运营类行内注覆盖下界：防 round217 新补的可见说明被整段删回去而无人知（非退化护栏）
if (cfSeed && nKeys) {
  const opNames = cfSeed.filter((x) => x.category === 'operation').map((x) => x.name);
  const covered = nKeys.filter((k) => opNames.indexOf(k) >= 0).length;
  if (covered >= MIN_OPERATION_NOTES) ok('E7-⑥', `运营类行内注覆盖 ${covered} 项 ≥ 下界 ${MIN_OPERATION_NOTES}（实测 7 的保守下沿）`);
  else no('E7-⑥', `运营类行内注仅 ${covered} 项 < 下界 ${MIN_OPERATION_NOTES}（新补的可见说明被删掉了）`);
} else {
  no('E7-⑥', '运营类行内注覆盖判定跳过（上游解析失败）');
}

// ============ E8 「语义锚点」必须真单源（R298） ============
section('E8 语义锚点：定义处 = 引用处（真单源，防被改回字面量副本）');

// 契约：每个锚点必须 ① 已声明且为非空字符串 ② ∈ 对应 category 的预设项 ③ 在 terms 源里被
// `SEMANTIC.<键>` 引用。③ 是"真单源"的证据 —— 若有人把 items 里的引用改回中文字面量，
// 锚点就成了**孤立副本**（改名会分叉），③ 立刻判红。
const ANCHOR_CONTRACT = [
  { key: 'expenseMktSubsidy', category: 'marketing' },
];
let semanticGrp = null;
try { semanticGrp = require(path.join(ROOT, TERMS_REL)).TERMS.semantic || null; } catch (_) { semanticGrp = null; }

if (semanticGrp && frontExp && termsSrc) {
  // 🔴 R298 变异回灌抓出的坑：E8-③ 若直接在 `termsSrc` 里数字符串，**说明注释里举的例子会被算成引用**
  //   —— 本轮实测：把 items 改回字面量后 E8-③ 仍判绿（注释里那句 `SEMANTIC.expenseMktSubsidy` 顶了数）。
  //   ⇒ 只在**代码**里计数（剥掉行首 `//` 注释与块注释）。本仓已多次踩「守卫被自己的说明注释绊红/绊绿」。
  const codeOnly = termsSrc
    .replace(/^[ \t]*\/\/[^\n]*/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const missA = [];
  const notInCat = [];
  const orphan = [];
  for (const a of ANCHOR_CONTRACT) {
    const v = semanticGrp[a.key];
    if (typeof v !== 'string' || !v) { missA.push(a.key); continue; }
    if ((frontExp[a.category] || []).indexOf(v) < 0) notInCat.push(`${a.key}="${v}" ∉ ${a.category}`);
    const refs = (codeOnly.match(new RegExp('SEMANTIC\\.' + a.key + '\\b', 'g')) || []).length;
    if (refs < 1) orphan.push(a.key);
  }
  if (missA.length) no('E8-①', `锚点未声明或非字符串（fail-closed）：${missA.join('、')}`);
  else ok('E8-①', `${ANCHOR_CONTRACT.length} 个契约锚点均已声明且为非空字符串`);
  if (notInCat.length) no('E8-②', `锚点值不在对应预设清单内（业务逻辑会静默失灵）：${notInCat.join('；')}`);
  else ok('E8-②', '锚点值均落在对应 category 的预设项内');
  if (orphan.length) no('E8-③', `锚点无人引用（= 已退回"两处字面量副本"，改名会分叉）：${orphan.join('、')}`);
  else ok('E8-③', '每个锚点都在 terms 源里以 SEMANTIC.<键> 被引用（真单源、非孤立副本）');
  // 判据自证（影子样本）：证明 E8-③ 的"引用计数"有分辨力，否则它可以恒真假绿
  const realRefs = (codeOnly.match(/SEMANTIC\.expenseMktSubsidy\b/g) || []).length;
  const fakeRefs = (codeOnly.match(/SEMANTIC\.__round298_不存在__\b/g) || []).length;
  if (realRefs >= 1 && fakeRefs === 0) ok('E8-④', `判据自证：真锚点引用 ${realRefs} 次、假锚点 0 次（计数有分辨力）`);
  else no('E8-④', `判据自证失败（真 ${realRefs} / 假 ${fakeRefs}）⇒ E8-③ 结论不可信`);
} else {
  no('E8-①', '锚点判定跳过（semantic 组 / terms / 预设清单解析失败，fail-closed）');
  no('E8-②', '锚点判定跳过（上游解析失败，fail-closed）');
  no('E8-③', '锚点判定跳过（上游解析失败，fail-closed）');
  no('E8-④', '判据自证跳过（上游解析失败）');
}

console.log(`\n===== 费用项清单口径守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
