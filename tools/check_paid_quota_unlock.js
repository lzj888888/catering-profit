// tools/check_paid_quota_unlock.js —— R215b 守卫：付费档必须解锁「账套/卡数不限」
//
// 为什么要有它（R215b 实测发现的缺口）：
//   规格 `01_架构总览:167`（免费 1 个 → 付费不限·硬上限 200）与 `04_核对清单:118`
//   （付费解锁 M1 账套不限 + M3 卡数不限）早已锁定，但四处配额判定**全只读
//   `feature_permissions.plan_free.limits`、从不读 `shop_entitlement.expire_at`**
//   ⇒ 付费用户付了钱仍被锁 1 家店 / 20 张卡。且既有 selftest **完全没有付费态用例**，
//   所以纯靠单测永远发现不了 ⇒ 必须有形态守卫兜住这条链路。
//
// 判据设计（避免假红）：
//   · 判「paid 参与免费额度判定」这一**行为**，不钉死变量名（`paid` / `isPaid` 都认）。
//   · 同时反向钉死「付费**不得**豁免硬上限」——否则修过头会变成无限建店。
//   · 配自失效护栏：扫描面非退化（文件在、关键函数定义在场、锚点行数命中）。
//
// 运行：node tools/check_paid_quota_unlock.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, extra) { pass++; console.log('✅ ' + name + (extra ? '  ' + extra : '')); }
function no(name, extra) { fail++; console.log('❌ ' + name + (extra ? '  ' + extra : '')); }

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}

// 🔴 判据口径（首跑踩到）：JSDoc 注释行会把 `hit_hard_limit:` 与 `is_paid` 写在**同一行**
//   （例：`* @returns {{ hit_free_limit:…, hit_hard_limit:…, is_paid:boolean }}`）
//   ⇒ 正则直接扫原文会把**注释**当成代码，两条断言双双失真（B-① 假红、A-① 可能假绿）。
//   ⇒ 必须先剥掉整行注释（`*` / `//` 开头）与行尾注释，只留代码再判。
function stripComments(src) {
  return String(src || '').split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

// ===== S：扫描面非退化（自失效护栏）=====
// 🔴 上限类/形态类守卫的通病：扫描面一旦扫空，"0 处违规"会恒绿 ⇒ 必须先证面还在。
const SERVICE_TARGETS = [
  'cloudfunctions/manageShop/service.js',
  'cloudfunctions/checkQuota/service.js',
  'cloudfunctions/saveCostCard/service.js',
];
const CTRL_TARGETS = [
  'cloudfunctions/manageShop/index.js',
  'cloudfunctions/getShopList/index.js',
  'cloudfunctions/checkQuota/index.js',
  'cloudfunctions/saveCostCard/index.js',
];
const FN_ANCHOR = {
  'cloudfunctions/manageShop/service.js': 'function decideCreate(',
  'cloudfunctions/checkQuota/service.js': 'function checkQuota(',
  'cloudfunctions/saveCostCard/service.js': 'function judgeCardQuota(',
};

let aliveFiles = 0;
for (const rel of SERVICE_TARGETS.concat(CTRL_TARGETS)) {
  const s = read(rel);
  if (s && s.length > 0) aliveFiles++;
}
if (aliveFiles === SERVICE_TARGETS.length + CTRL_TARGETS.length) {
  ok('S-① 扫描面 7 个文件全部在场', '(' + aliveFiles + '/' + (SERVICE_TARGETS.length + CTRL_TARGETS.length) + ')');
} else {
  no('S-① 扫描面退化：文件缺失', '(' + aliveFiles + '/' + (SERVICE_TARGETS.length + CTRL_TARGETS.length) + ')');
}

let anchorHit = 0;
for (const rel of Object.keys(FN_ANCHOR)) {
  const s = read(rel) || '';
  if (s.indexOf(FN_ANCHOR[rel]) >= 0) anchorHit++;
}
if (anchorHit === Object.keys(FN_ANCHOR).length) {
  ok('S-② 三个配额判定函数定义均在场', '(' + anchorHit + '/3)');
} else {
  no('S-② 配额判定函数定义缺失', '(' + anchorHit + '/3)');
}

// ===== A：免费额度判定必须被 paid 短路 =====
// 行为形态：`hit_free_limit: !<*paid*> &&`（付费期跳过免费额度）
const PAID_FREE_RE = /hit_free_limit:\s*!\s*[A-Za-z_]*[Pp]aid[A-Za-z_]*\s*&&/;
let aHit = 0;
for (const rel of SERVICE_TARGETS) {
  const s = stripComments(read(rel));
  if (PAID_FREE_RE.test(s)) aHit++;
}
if (aHit === SERVICE_TARGETS.length) {
  ok('A-① 三处 hit_free_limit 均由 paid 短路（付费跳过免费额度）', '(' + aHit + '/3)');
} else {
  no('A-① 存在未被 paid 短路的 hit_free_limit（付费档仍被锁）', '仅 ' + aHit + '/3');
}

// ===== B：硬上限不得被 paid 豁免（防止修过头 = 无限建店）=====
const HARD_RE = /hit_hard_limit:/;
const HARD_PAID_RE = /hit_hard_limit:[^\n]*[Pp]aid/;
let bOk = 0, bBad = [];
for (const rel of SERVICE_TARGETS) {
  const s = stripComments(read(rel));
  if (!HARD_RE.test(s)) { bBad.push(rel + ' 无 hit_hard_limit'); continue; }
  if (HARD_PAID_RE.test(s)) { bBad.push(rel + ' 硬上限被 paid 影响'); continue; }
  bOk++;
}
if (bBad.length === 0) {
  ok('B-① 三处 hit_hard_limit 均不含 paid（付费也不豁免硬上限）', '(' + bOk + '/3)');
} else {
  no('B-① 硬上限被付费豁免 ⇒ 可无限建店', bBad.join(' ; '));
}

// ===== C：Controller 必须真的把付费态注入进去 =====
// 形态：`common.isPaid(await common.entitlement.loadExpireAt(...))`
const INJECT_RE = /[A-Za-z_.]*isPaid\s*\(\s*await\s+[A-Za-z_.]*loadExpireAt\s*\(/;
const INJECT_NEED = {
  'cloudfunctions/manageShop/index.js': 'decideCreate',
  'cloudfunctions/getShopList/index.js': 'hitFreeLimit',
  'cloudfunctions/checkQuota/index.js': 'checkQuota',
  'cloudfunctions/saveCostCard/index.js': 'judgeCardQuota',
};
let cHit = 0, cBad = [];
for (const rel of Object.keys(INJECT_NEED)) {
  const s = stripComments(read(rel));
  const injected = INJECT_RE.test(s) || /isPaid\s*\(\s*await\s+common\.entitlement\.loadExpireAt/.test(s);
  const wired = s.indexOf(INJECT_NEED[rel]) >= 0;
  if (injected && wired) cHit++; else cBad.push(rel + (injected ? ' 未接线' : ' 未读 expire_at'));
}
if (cBad.length === 0) {
  ok('C-① 四个 Controller 均读 expire_at 并接线到配额判定', '(' + cHit + '/4)');
} else {
  no('C-① Controller 未注入付费态', cBad.join(' ; '));
}

// 防复制第二套判定：不得手写 `expire_at > Date.now()` / `expire_at > nowUtc()` 之类
const HAND_ROLL_RE = /expire_at\s*>\s*(Date\.now\(\)|nowUtc\(\)|now\b)/;
let handRoll = [];
for (const rel of SERVICE_TARGETS.concat(Object.keys(INJECT_NEED))) {
  const s = stripComments(read(rel));
  if (HAND_ROLL_RE.test(s)) handRoll.push(rel);
}
if (handRoll.length === 0) {
  ok('C-② 无手写 expire_at 比较（付费判定走单源 entitlement.js）');
} else {
  no('C-② 出现手写的 expire_at 比较（第二套判定）', handRoll.join(' ; '));
}

// ===== D：解析器正负样本（证明正则真在工作，不是恒绿）=====
const POS = '    hit_free_limit: !paid && used >= lim.free_limit,';
const NEG1 = '    hit_free_limit: used >= lim.free_limit,';
const NEG2 = '    hit_hard_limit: !paid && used >= lim.hard_limit,';
if (PAID_FREE_RE.test(POS) && !PAID_FREE_RE.test(NEG1)) {
  ok('D-① A 段正则正负样本均正确（付费版命中 / 旧版不命中）');
} else {
  no('D-① A 段正则失效（正样本未命中或负样本误命中）');
}
if (!HARD_PAID_RE.test('    hit_hard_limit: used >= hardLimit,') && HARD_PAID_RE.test(NEG2)) {
  ok('D-② B 段正则正负样本均正确（硬上限含 paid 即判红）');
} else {
  no('D-② B 段正则失效');
}

console.log('\n===== check_paid_quota_unlock 自测结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
