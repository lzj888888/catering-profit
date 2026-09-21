/**
 * check_waimai_spec_sync.js —— 外卖段规范 ⇄ 代码单源 一致性守卫（R114，round84）
 *
 * 背景（**预防同族病第 21 例** —— 截至 round82 该族已 20 例，清单见 ★知识存储点 §1.1 与 PITFALLS.md §4；
 * 本例是**主动预防**，不是事后救火）：
 *   2026-09-22（round84）把李老师拍板的外卖页设计稿落成规范
 *   `specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md` 的 **§A.11**。
 *   §A.11 里有两处**明文声称"严格取自代码单源"**：
 *     · A.11.2 的 4 个平台名与顺序 ← 声明取自 `miniprogram/i18n/terms.js::ledger.income`
 *       的 `category: 'takeaway'` 块 items；
 *     · A.11.3 的 6 个营销项 key / 顺序 / 显示名 ← 声明取自
 *       `cloudfunctions/initDb/collections.js::SEED_EXPENSE_ITEMS` 的 `category: 'marketing'` 项。
 *   ⇒ 这等于**新增两处"文档抄代码"的派生面**。本仓同族病史（截至 round82 已 20 例）反复证明：
 *     派生面**没有守卫就会漂**，且漂了无人知晓（陈述面 ≠ 实然）。
 *
 *   为什么现成守卫盖不住：
 *     · `tools/check_income_channel_seed.js`（R110）守的是**三份代码副本之间的字典**，
 *       且其扫描面把外卖明确列为**弱面**（前端 4 平台 vs 后端 3 构成项 = 不同粒度，只打印不判红）；
 *       **它完全不看规范文档里抄了什么**。
 *     · 其余 check_* 无一条读 `ModuleA` 正文。
 *   ⇒ 一旦有人改了 `terms.js` 的平台名或 `collections.js` 的 sort_order，规范 A.11 会
 *     **静默停留在旧值**，而门禁照旧全绿。本守卫就是补这个洞。
 *
 * 判据（4 组，9 条）：
 *   W3 前提 / fail-closed：规范 A.11.2 / A.11.3 两段可定位、两个代码单源可解析、
 *                       且**规范侧**数量等于契约值（平台 4 / 营销 6）
 *   W1 规范 A.11.2 平台名 + 顺序 ≡ terms.js 外卖 items（逐项、有序）
 *   W2 规范 A.11.3 item_key + 显示名 + 顺序 ≡ collections.js marketing 项（逐项、有序）
 *   W4 自失效护栏：两侧解析结果非空且数量相等（防正则写歪后"两边都空"而假绿）
 *
 * ⚠️ 已知坑的对应处理：
 *   · 坑⑭/⑯ 裸扫数字必误杀：本守卫**不扫任何裸数字**，只解析 markdown 表格行与代码字面量。
 *   · 坑⑮ 自指：本文件不出现任何"唯一声明处"标记词（R110 的 DECL 词一字不写），
 *     也不写 R85 短语表里的已证伪说法。
 *   · R66 断言计数按 `✅` 字符出现次数 ⇒ 断言**消息文本里不出现 ✅ / ❌ 字面**。
 *   · 坑⑱ `git ls-files` 只扫 index：本守卫只按固定相对路径直读，不依赖索引。
 *
 * 运行：node tools/check_waimai_spec_sync.js   （由 verify_all.js 的 [waimai-spec-sync] 套件调用）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPEC_REL = 'specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md';
const TERMS_REL = 'miniprogram/i18n/terms.js';
const CF_REL = 'cloudfunctions/initDb/collections.js';

// 契约值：规范 A.11 明文规定的数量（设计决定，不是派生值）。
// 改设计时须同时改 规范正文 + 本常量 + SUITES 描述 —— 这是**有意**的人工面。
const WANT_PLATFORMS = 4;
const WANT_MARKETING = 6;

let pass = 0;
let fail = 0;
const ok = (id, msg) => { pass += 1; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail += 1; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

function readRel(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 取两个锚点之间的正文；任一锚点缺失返回 null */
function sliceBetween(src, from, to) {
  const i = src.indexOf(from);
  if (i < 0) return null;
  const j = src.indexOf(to, i + from.length);
  if (j < 0) return null;
  return src.slice(i, j);
}

/** 规范 A.11.2：表格行 `| 1 | 美团外卖 | 该平台账单三项之和 |` ⇒ ['美团外卖', ...]（保序） */
function parseSpecPlatforms(md) {
  const block = sliceBetween(md, '### A.11.2 ', '### A.11.3 ');
  if (!block) return null;
  const out = [];
  const re = /^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/gm;
  let m;
  while ((m = re.exec(block))) {
    const name = m[1].replace(/\*\*/g, '').trim();
    if (name && name !== '序号') out.push(name);
  }
  return out.length ? out : null;
}

/**
 * 规范 A.11.3：表格行
 *   `| 10 | \`exp_mkt_takeaway_com\` | 外卖平台佣金 | 手填 / 粘贴 | 账单「技术服务费」列求和 |`
 * ⇒ [{ key, name }]（保序）
 */
function parseSpecMarketing(md) {
  const block = sliceBetween(md, '### A.11.3 ', '### A.11.4 ');
  if (!block) return null;
  const out = [];
  const re = /^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/gm;
  let m;
  while ((m = re.exec(block))) {
    out.push({ key: m[1].trim(), name: m[2].replace(/\*\*/g, '').trim() });
  }
  return out.length ? out : null;
}

/** terms.js::ledger.income 的 takeaway 块 items（复用 R110 的解析口径，保持两守卫同源） */
function parseTermsTakeaway(src) {
  const start = src.indexOf('income: [');
  if (start < 0) return null;
  const end = src.indexOf('expense: [', start);
  const block = src.slice(start, end < 0 ? start + 4000 : end);
  const re = /category: 'takeaway',\s*label: '([^']*)'[\s\S]{0,400}?items: \[([^\]]*)\]/g;
  const m = re.exec(block);
  if (!m) return null;
  const items = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '').trim()).filter(Boolean);
  return items.length ? items : null;
}

/** collections.js::SEED_EXPENSE_ITEMS 的 marketing 项，按 sort_order 升序 ⇒ [{key,name}] */
function parseSeedMarketing(src) {
  const start = src.indexOf('const SEED_EXPENSE_ITEMS = [');
  if (start < 0) return null;
  const end = src.indexOf('\n];', start);
  const block = src.slice(start, end < 0 ? start + 6000 : end);
  const re = /\{\s*item_key:\s*'([^']+)',\s*item_name:\s*'([^']+)',\s*category:\s*'([^']+)',\s*sort_order:\s*(\d+)/g;
  const out = [];
  let m;
  while ((m = re.exec(block))) {
    if (m[3] === 'marketing') out.push({ key: m[1].trim(), name: m[2].trim(), sort: Number(m[4]) });
  }
  if (!out.length) return null;
  out.sort((a, b) => a.sort - b.sort);
  return out;
}

// ============ W3 前提 / fail-closed ============
section('W3 前提与 fail-closed（三份源必须都可解析）');

let specMd = null, termsSrc = null, cfSrc = null;
try { specMd = readRel(SPEC_REL); } catch (_) { specMd = null; }
try { termsSrc = readRel(TERMS_REL); } catch (_) { termsSrc = null; }
try { cfSrc = readRel(CF_REL); } catch (_) { cfSrc = null; }

const specPlats = specMd ? parseSpecPlatforms(specMd) : null;
const specMk = specMd ? parseSpecMarketing(specMd) : null;

if (specMd && specPlats && specMk) {
  ok('W3-①', `规范 ModuleA 的 A.11.2 / A.11.3 两段均定位成功`);
} else {
  no('W3-①', `规范 A.11.2 / A.11.3 段定位失败 —— 章节被改名/删除，或表格结构变了（守卫必须跟着改，不许静默放过）`);
}

const termsTakeaway = termsSrc ? parseTermsTakeaway(termsSrc) : null;
if (termsTakeaway) {
  ok('W3-②', `terms.js 外卖 items 解析成功（${termsTakeaway.length} 项）`);
} else {
  no('W3-②', `terms.js::ledger.income 的 takeaway 块解析失败（单源被改名或改写法）`);
}

const seedMk = cfSrc ? parseSeedMarketing(cfSrc) : null;
if (seedMk) {
  ok('W3-③', `collections.js 营销项解析成功（${seedMk.length} 项）`);
} else {
  no('W3-③', `collections.js::SEED_EXPENSE_ITEMS 的 marketing 项解析失败（单源被改名或改写法）`);
}

if (specPlats && specPlats.length === WANT_PLATFORMS) {
  ok('W3-④', `规范侧平台数 = 契约值 ${WANT_PLATFORMS}`);
} else {
  no('W3-④', `规范侧平台数 = ${specPlats ? specPlats.length : '解析失败'}，契约值为 ${WANT_PLATFORMS}`);
}

if (specMk && specMk.length === WANT_MARKETING) {
  ok('W3-⑤', `规范侧营销项数 = 契约值 ${WANT_MARKETING}`);
} else {
  no('W3-⑤', `规范侧营销项数 = ${specMk ? specMk.length : '解析失败'}，契约值为 ${WANT_MARKETING}`);
}

// ============ W4 自失效护栏（证明前面两组不是恒真） ============
section('W4 自失效护栏（两侧都解析出内容才有比对意义）');

if (specPlats && termsTakeaway && specPlats.length === termsTakeaway.length) {
  ok('W4-①', `平台侧两侧数量相等（规范 ${specPlats.length} / 代码 ${termsTakeaway.length}）`);
} else {
  no('W4-①', `平台侧数量不等或解析失败：规范 ${specPlats ? specPlats.length : 'x'} / 代码 ${termsTakeaway ? termsTakeaway.length : 'x'}`);
}

if (specMk && seedMk && specMk.length === seedMk.length) {
  ok('W4-②', `营销侧两侧数量相等（规范 ${specMk.length} / 代码 ${seedMk.length}）`);
} else {
  no('W4-②', `营销侧数量不等或解析失败：规范 ${specMk ? specMk.length : 'x'} / 代码 ${seedMk ? seedMk.length : 'x'}`);
}

// ============ W1 平台名 + 顺序 ============
section('W1 规范 A.11.2 平台名与顺序 ≡ terms.js（逐项、有序）');

if (specPlats && termsTakeaway) {
  const bad = [];
  const n = Math.max(specPlats.length, termsTakeaway.length);
  for (let i = 0; i < n; i += 1) {
    if (specPlats[i] !== termsTakeaway[i]) {
      bad.push(`[${i + 1}] 规范「${specPlats[i] || '缺'}」vs 代码「${termsTakeaway[i] || '缺'}」`);
    }
  }
  if (bad.length === 0) ok('W1-①', `4 个平台名与顺序逐项一致（${specPlats.join(' / ')}）`);
  else no('W1-①', `平台名或顺序漂移：${bad.join('；')}`);
} else {
  no('W1-①', `无法比对（规范或代码单源解析失败，见 W3）`);
}

// ============ W2 item_key + 显示名 + 顺序 ============
section('W2 规范 A.11.3 营销项 ≡ collections.js marketing（逐项、有序）');

if (specMk && seedMk) {
  const badKey = [], badName = [];
  const n = Math.max(specMk.length, seedMk.length);
  for (let i = 0; i < n; i += 1) {
    const s = specMk[i] || {}, c = seedMk[i] || {};
    if (s.key !== c.key) badKey.push(`[${i + 1}] 规范「${s.key || '缺'}」vs 代码「${c.key || '缺'}」`);
    if (s.name !== c.name) badName.push(`[${i + 1}] 规范「${s.name || '缺'}」vs 代码「${c.name || '缺'}」`);
  }
  if (badKey.length === 0) ok('W2-①', `6 个 item_key 与顺序逐项一致`);
  else no('W2-①', `item_key 或顺序漂移：${badKey.join('；')}`);

  if (badName.length === 0) ok('W2-②', `6 个显示名逐项一致`);
  else no('W2-②', `显示名漂移（以代码 item_name 为准）：${badName.join('；')}`);
} else {
  no('W2-①', `无法比对 item_key（规范或代码单源解析失败，见 W3）`);
  no('W2-②', `无法比对显示名（规范或代码单源解析失败，见 W3）`);
}

console.log(`\n===== 外卖段规范口径守卫结果：${pass} 通过 / ${fail} 失败 =====\n`);
process.exit(fail === 0 ? 0 : 1);
