/**
 * check_income_channel_seed.js —— 收入渠道字典口径守卫（R110，round78）
 *
 * 背景（同族病第 16 例）：
 *   收入渠道（堂食 / 外卖 / 其他）的**字典**散在三处，且**已经分叉**：
 *     · 前端单源 `miniprogram/i18n/terms.js::ledger.income` 堂食 **7 项**
 *       （现金收款、微信扫码收款、支付宝收款、银行卡/POS刷卡、储值卡消费、个人/单位挂账消费、团购/代金券核销）
 *     · 后端种子 `cloudfunctions/initDb/collections.js::SEED_INCOME_ITEMS` 堂食 **5 项**
 *       （现金、微信支付宝、储值消费、团购券核销、企业挂账消费）
 *     · 原型副本 `specs/dev-specs/prototype/init_db.js` 与后端种子当前**逐项一致**
 *   而 `tools/` 对「SEED_INCOME_ITEMS|渠道字典|堂食渠道」的口径守卫**零命中**：
 *   既有的 `tools/selftest_batch8b.js` 只守**前端**堂食 7 项与「清单只认 terms.js」（G1/G10），
 *   `check_schema_sync.js`（R74）只守集合与索引，**都不看种子字典的渠道名**。
 *
 * 后果（为什么必须守）：
 *   新建账套时 `shop_income_item` 由种子写入 ⇒ 账套里预设渠道名与前端渲染的全集**对不上**
 *   （例如后端写「企业挂账消费」、前端是「个人/单位挂账消费」），导出/对账/后续按名归并时
 *   同名不同 key、异名同义。**前端 G10 只保证渲染层补齐全集，掩盖不了字典本身的分叉。**
 *
 * ⚠️ 本守卫**不代李老师裁定**哪一份是全集（前端 7 项 / 后端 5 项），只做两件事：
 *   ① **硬判**：原型副本 ≡ 云函数副本（同一份种子的两处副本，必须逐项一致）；
 *             其他业务收入 前端 ≡ 后端（这类别本就一致，不许漂）。
 *   ② **冻结 + 防扩散**：堂食的现存分歧登记在 `core/13` 唯一声明处（DEFERRED，带 by/date/reason），
 *      差异集合 ≡ 在册集合**双向**比对 —— 单方面改名/加项/删项 ⇒ 红；在册条目变僵尸 ⇒ 也红。
 *      ⇒ 谁要动任一侧，必须**同步更新登记**（写明理由），不能悄悄改。
 *
 * ⚠️ 已踩过的坑在本守卫里的对应处理：
 *   · 坑⑭/⑯ 裸扫数字必误杀：**本守卫不扫任何裸数字**，只做集合比对与标记解析。
 *   · 坑⑮ 自指：标记词只写在 core/13 唯一声明处；扫描面排除 `review/`（NOTE 不写标记词）。
 *   · 坑⑱ `git ls-files` 只扫 index：扫描面 = index ∪ 工作树递归（并加非恒真前提）。
 *   · 坑⑪ CJK 八进制转义：`git -c core.quotepath=false ls-files`，出现 `\NNN` 即红。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TERMS_REL = 'miniprogram/i18n/terms.js';
const CF_REL = 'cloudfunctions/initDb/collections.js';
const PROTO_REL = 'specs/dev-specs/prototype/init_db.js';
const DECL_REL = 'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md';
const DECL_MARK = '收入渠道字典口径（唯一声明处）';
const FRONT_MARK = '前端独有';
const BACK_MARK = '后端独有';
const DECISION_MARK = '决策：';

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

function readRel(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/** 扫描面 = index(git, quotepath=false) ∪ 工作树递归；返回 .md 相对路径数组 */
function scanFiles() {
  const set = new Set();
  let out = '';
  try {
    out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'],
      { cwd: ROOT, encoding: 'utf8' });
  } catch (_) { /* 非 git 环境：退化为纯工作树扫描 */ }
  for (const l of out.split('\n')) {
    const f = l.trim();
    if (f.endsWith('.md')) set.add(f.replace(/\\/g, '/'));
  }
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); }
      else if (e.name.endsWith('.md')) set.add(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  };
  for (const r of ['specs', 'docs']) walk(path.join(ROOT, r));
  return [...set].filter((f) => !f.startsWith('node_modules/'));
}

/** 前端 terms.js::ledger.income —— 取 { category: [itemName...] } */
function parseFront(src) {
  const start = src.indexOf('income: [');
  if (start < 0) return null;
  const end = src.indexOf('expense: [', start);
  const block = src.slice(start, end < 0 ? start + 4000 : end);
  const out = {};
  // ⚠️ 外卖块在 label 与 items 之间夹了注释行 ⇒ 必须允许跨行内容（否则漏解析，弱面会假报 0 平台）
  const re = /category: '(\w+)',\s*label: '([^']*)'[\s\S]{0,400}?items: \[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(block))) {
    out[m[1]] = m[3].split(',').map((s) => s.trim().replace(/^'|'$/g, '').trim()).filter(Boolean);
  }
  return Object.keys(out).length ? out : null;
}

/** 后端/原型 SEED_INCOME_ITEMS —— 取 { category: [{key,name}...] } */
function parseSeed(src) {
  const start = src.indexOf('const SEED_INCOME_ITEMS = [');
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.indexOf('\n];');
  const block = rest.slice(0, end < 0 ? 4000 : end);
  const out = {};
  const re = /item_key: '([^']+)',\s*item_name: '([^']+?)',\s*category: '([^']+)'/g;
  let m;
  while ((m = re.exec(block))) {
    (out[m[3]] = out[m[3]] || []).push({ key: m[1], name: m[2].trim() });
  }
  return Object.keys(out).length ? out : null;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const diff = (a, b) => a.filter((x) => !b.includes(x));

// ============ C1 扫描面 fail-closed ============
section('C1 扫描面 fail-closed（三处字典源必须都解析得到）');
let front = null, cf = null, proto = null;
try { front = parseFront(readRel(TERMS_REL)); } catch (e) { front = null; }
try { cf = parseSeed(readRel(CF_REL)); } catch (e) { cf = null; }
try { proto = parseSeed(readRel(PROTO_REL)); } catch (e) { proto = null; }

if (front && front.dine_in && front.dine_in.length && front.other && front.other.length) {
  ok('C1-①', `前端 terms 解析成功 —— 堂食 ${front.dine_in.length} 项 / 其他 ${front.other.length} 项`);
} else {
  no('C1-①', '前端 terms.js::ledger.income 解析失败（fail-closed）：单源被改名或改写法即失守');
}
if (cf && cf.dine_in && cf.dine_in.length) {
  ok('C1-②', `云函数种子解析成功 —— 堂食 ${cf.dine_in.length} 项 / 其他 ${(cf.other || []).length} 项`);
} else {
  no('C1-②', 'cloudfunctions/initDb/collections.js::SEED_INCOME_ITEMS 解析失败（fail-closed）');
}
if (proto && proto.dine_in && proto.dine_in.length) {
  ok('C1-③', `原型副本解析成功 —— 堂食 ${proto.dine_in.length} 项`);
} else {
  no('C1-③', 'prototype/init_db.js::SEED_INCOME_ITEMS 解析失败（fail-closed）');
}
if (!/(^|\n)\s*\]/.test('x')) { /* 占位：保持结构清晰 */ }

// ============ C2 原型副本 ≡ 云函数副本（硬判） ============
section('C2 同一份种子的两处副本必须逐项一致');
if (cf && proto) {
  const cfDine = cf.dine_in.map((x) => x.key + '|' + x.name);
  const prDine = (proto.dine_in || []).map((x) => x.key + '|' + x.name);
  if (sameSet(cfDine, prDine)) {
    ok('C2-①', `堂食副本逐项一致（${cfDine.length} 项）`);
  } else {
    no('C2-①', `堂食副本漂移：云函数独有 [${diff(cfDine, prDine)}] / 原型独有 [${diff(prDine, cfDine)}]`);
  }
  const cfOther = (cf.other || []).map((x) => x.key + '|' + x.name);
  const prOther = (proto.other || []).map((x) => x.key + '|' + x.name);
  if (sameSet(cfOther, prOther)) ok('C2-②', `其他业务收入副本逐项一致（${cfOther.length} 项）`);
  else no('C2-②', `其他业务收入副本漂移：云函数独有 [${diff(cfOther, prOther)}] / 原型独有 [${diff(prOther, cfOther)}]`);
} else {
  no('C2-①', '副本比对跳过（上游解析失败，fail-closed）');
  no('C2-②', '副本比对跳过（上游解析失败，fail-closed）');
}

// ============ C3 其他业务收入 前端 ≡ 后端（硬判，该类别本就一致） ============
section('C3 其他业务收入：前端 ≡ 后端种子');
if (front && cf) {
  const f = front.other || [], b = (cf.other || []).map((x) => x.name);
  if (sameSet(f, b)) ok('C3-①', `其他业务收入一致（${f.length} 项：${f.join('、')}）`);
  else no('C3-①', `其他业务收入分叉：前端独有 [${diff(f, b)}] / 后端独有 [${diff(b, f)}]`);
} else {
  no('C3-①', '其他业务收入比对跳过（上游解析失败，fail-closed）');
}

// ============ C4 堂食分歧冻结：差异集合 ≡ 在册集合（双向） ============
section('C4 堂食分歧冻结（现存分歧已登记，单方面改动即红）');
let declRaw = '';
try { declRaw = readRel(DECL_REL); } catch (e) { declRaw = ''; }
let regFront = [], regBack = [], decisionLine = '';
if (declRaw.includes(DECL_MARK)) {
  const lines = declRaw.split(/\r?\n/);
  const iF = lines.findIndex((l) => l.includes(FRONT_MARK) && l.includes('：'));
  const iB = lines.findIndex((l) => l.includes(BACK_MARK) && l.includes('：'));
  const iD = lines.findIndex((l) => l.includes(DECISION_MARK));
  if (iF >= 0) regFront = lines[iF].split('：').slice(1).join('：').split('、').map((s) => s.trim()).filter(Boolean);
  if (iB >= 0) regBack = lines[iB].split('：').slice(1).join('：').split('、').map((s) => s.trim()).filter(Boolean);
  if (iD >= 0) decisionLine = lines[iD];
}

if (front && cf) {
  const f = front.dine_in, b = cf.dine_in.map((x) => x.name);
  const fOnly = diff(f, b), bOnly = diff(b, f);
  if (sameSet(fOnly, regFront)) {
    ok('C4-①', `前端独有 ${fOnly.length} 项 ≡ 在册（${fOnly.join('、')}）`);
  } else {
    no('C4-①', `前端独有集合与在册不符：实际 [${fOnly}] / 在册 [${regFront}] —— 动了前端或登记未同步`);
  }
  if (sameSet(bOnly, regBack)) {
    ok('C4-②', `后端独有 ${bOnly.length} 项 ≡ 在册（${bOnly.join('、')}）`);
  } else {
    no('C4-②', `后端独有集合与在册不符：实际 [${bOnly}] / 在册 [${regBack}] —— 动了后端或登记未同步`);
  }
  // 双向防腐：在册条目必须是真实存在的分歧（僵尸条目也红）
  const zombieF = diff(regFront, fOnly), zombieB = diff(regBack, bOnly);
  if (zombieF.length === 0 && zombieB.length === 0) ok('C4-③', '在册条目无僵尸（登记 ≡ 实存，双向防腐）');
  else no('C4-③', `在册僵尸条目：前端 [${zombieF}] / 后端 [${zombieB}]`);
} else {
  no('C4-①', '分歧比对跳过（上游解析失败，fail-closed）');
  no('C4-②', '分歧比对跳过（上游解析失败，fail-closed）');
  no('C4-③', '分歧比对跳过（上游解析失败，fail-closed）');
}

// ============ C5 在册格式（DEFERRED 必须带 by / date / reason） ============
section('C5 在册格式：DEFERRED 须带处置标记与日期与理由');
if (decisionLine.includes('DEFERRED')) ok('C5-①', '在册处置标记为 DEFERRED（未裁定，不许悄悄拉齐）');
else no('C5-①', `未找到 DEFERRED 决策行（实际：${decisionLine.slice(0, 60)}）`);
if (/\d{4}-\d{2}-\d{2}/.test(decisionLine)) ok('C5-②', '在册决策行带日期');
else no('C5-②', '在册决策行缺日期（无法判断登记时效）');
if (/reason|理由/.test(decisionLine)) ok('C5-③', '在册决策行带理由');
else no('C5-③', '在册决策行缺理由');

// ============ C6 声明存在（fail-closed） ============
section('C6 唯一声明处存在性（fail-closed）');
if (declRaw.includes(DECL_MARK)) ok('C6-①', `core/13 存在${DECL_MARK}`);
else no('C6-①', `core/13 缺少「${DECL_MARK}」声明行 —— 分歧无人登记即无人负责`);

// ============ C7 前提守卫（证明解析与登记面都没打空） ============
section('C7 前提守卫（登记面非空，证明解析真的生效）');
if (regFront.length >= 1 && regBack.length >= 1) {
  ok('C7-①', `在册集合非空（前端 ${regFront.length} / 后端 ${regBack.length}）—— 登记解析生效`);
} else {
  no('C7-①', `在册集合为空（前端 ${regFront.length} / 后端 ${regBack.length}）—— 要么声明格式变了，要么分歧已消失却未更新登记`);
}
const mdFiles = scanFiles();
if (mdFiles.length >= 30) ok('C7-②', `扫描面 ${mdFiles.length} 个 .md（index ∪ 工作树）`);
else no('C7-②', `扫描面仅 ${mdFiles.length} 个 .md —— 扫描面写错（坑⑱）`);
if (mdFiles.some((f) => /\\\d{3}/.test(f))) no('C7-③', '扫描面出现 CJK 八进制转义路径（坑⑪）');
else ok('C7-③', '扫描面无八进制转义（quotepath=false 生效）');

// ============ C8 单源不扩散 ============
section('C8 口径单源不扩散');
const spread = mdFiles.filter((rel) => {
  if (rel === DECL_REL) return false;
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(DECL_MARK); } catch (_) { return false; }
});
if (spread.length === 0) ok('C8-①', '仅 core/13 一处自称本口径单源');
else no('C8-①', `另有 ${spread.length} 处自称本口径单源：${spread.join(', ')}`);

// ============ 弱面：只明示，不判红 ============
section('W 弱面（外卖粒度不同，只明示不判红）');
const fTw = (front && front.takeaway) || [];
const bTw = (cf && cf.takeaway) || [];
console.log(`  ⚠️ 前端外卖 ${fTw.length} 项（按平台：${fTw.join('、')}） vs 后端外卖 ${bTw.length} 项（每平台三栏：${bTw.map((x) => x.name).join('、')}）`);
console.log('     —— 两者是**不同粒度**（平台名 vs 金额构成项），不构成字典分叉，故不判红。');
ok('W-①', `弱面已打印（前端 ${fTw.length} 平台 / 后端 ${bTw.length} 构成项），维持只明示不判红`);

console.log(`\n===== 收入渠道字典口径守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
