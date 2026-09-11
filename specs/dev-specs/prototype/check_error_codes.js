/**
 * 规范层一致性机械门禁 · check_error_codes.js
 *
 * 用途：把"新增了东西但没同步到另一侧"这类**靠人眼必漏**的问题变成 CI/本地一条命令就能挂的红线。
 * 运行：node prototype/check_error_codes.js   （退出码 0=全绿，1=有断裂）
 *
 * 覆盖三组断言：
 *   A. 错误码三向一致：core/09 §1 的 code 列 ↔ §3 的 i18n key 列 ↔ i18n/terms.js 的键集合
 *      —— 拦住「新增了 wire code 但 terms.js 没键」（前端每次查表 miss → 提示全被吞成"系统异常"）
 *        与「core/09:107 那类 wire code 当 i18n key 直接用」的写法回潮。
 *   B. wire code → i18n key 映射完整：CODE_TO_I18N 必须覆盖全部 wire code，且值必须真实存在。
 *   C. 云函数登记一致：core/16 引入的 admin 函数必须已登记进 core/10 §6 契约表
 *      —— 拦住「新文档引了函数但契约表没有」（函数名依赖"契约表唯一性"）。
 *
 * ⚠️ 新增错误码必须三处同步：core/09 §1 表 + core/09 §3 表 + i18n/terms.js（ERROR_MESSAGES 键 + CODE_TO_I18N 条目）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

/** 取一行表格中第 idx 个单元格里的首个 `反引号包裹内容` */
function backticked(row, idx) {
  const cells = row.split('|');
  if (cells.length <= idx) return null;
  const m = cells[idx].match(/`([^`]+)`/);
  return m ? m[1] : null;
}

/** 抽取两个标题之间的正文 */
function section(text, startHeading, endHeading) {
  const s = text.indexOf(startHeading);
  if (s < 0) return '';
  const rest = text.slice(s + startHeading.length);
  const e = endHeading ? rest.indexOf(endHeading) : -1;
  return e < 0 ? rest : rest.slice(0, e);
}

const fails = [];
const notes = [];

// ===================== A / B. 错误码三向一致 =====================
const ecText = read('core/09_统一错误码表.md');
const { ERROR_MESSAGES, CODE_TO_I18N, msgOf } = require(path.join(ROOT, 'i18n/terms.js'));

// §1：wire code 列 → i18n key 列
const sec1 = section(ecText, '## 1. 错误码全集', '## 2. 使用铁律');
const specWire = new Map(); // wire -> i18nKey
for (const line of sec1.split('\n')) {
  if (!line.trim().startsWith('|')) continue;
  const wire = backticked(line, 1);
  const key = backticked(line, 4);
  if (wire && key) specWire.set(wire, key);
}

// §3：i18n key 列
const sec3 = section(ecText, '## 3. 前端文案映射表', null);
const specI18n = new Set();
for (const line of sec3.split('\n')) {
  if (!line.trim().startsWith('|')) continue;
  const key = backticked(line, 1);
  if (key) specI18n.add(key);
}

const termsKeys = new Set(Object.keys(ERROR_MESSAGES));
const mapCodes = new Set(Object.keys(CODE_TO_I18N));

notes.push(`core/09 §1 wire code: ${specWire.size} 个`);
notes.push(`core/09 §3 i18n key : ${specI18n.size} 个`);
notes.push(`terms.js ERROR_MESSAGES 键: ${termsKeys.size} 个`);
notes.push(`terms.js CODE_TO_I18N 条目: ${mapCodes.size} 个`);

// A1. §1 的每个 wire code 都必须在 CODE_TO_I18N 里有映射
for (const wire of specWire.keys()) {
  if (!mapCodes.has(wire)) fails.push(`[B1] wire code \`${wire}\` 在 core/09 §1 存在，但 terms.js 的 CODE_TO_I18N 缺该条目`);
}
for (const wire of mapCodes) {
  if (!specWire.has(wire)) fails.push(`[B2] CODE_TO_I18N 里的 \`${wire}\` 不在 core/09 §1 表中（多出未登记的 wire code）`);
}

// A2. CODE_TO_I18N 的映射关系必须与 §1 声明完全一致
for (const [wire, expectKey] of specWire) {
  const actual = CODE_TO_I18N[wire];
  if (actual && actual !== expectKey) {
    fails.push(`[B3] \`${wire}\` 映射不一致：core/09 §1 写 \`${expectKey}\`，terms.js CODE_TO_I18N 写 \`${actual}\``);
  }
}

// A3. CODE_TO_I18N 的每个目标 i18n key 都必须在 ERROR_MESSAGES 里存在
for (const [wire, key] of Object.entries(CODE_TO_I18N)) {
  if (!termsKeys.has(key)) fails.push(`[B4] \`${wire}\` 映射到 \`${key}\`，但 terms.js ERROR_MESSAGES 没有该键`);
}

// A4. §3 表 ↔ ERROR_MESSAGES 键集合必须完全相等
for (const key of specI18n) {
  if (!termsKeys.has(key)) fails.push(`[A1] core/09 §3 有 \`${key}\`，但 terms.js ERROR_MESSAGES 缺该键`);
}
for (const key of termsKeys) {
  if (!specI18n.has(key)) fails.push(`[A2] terms.js ERROR_MESSAGES 有 \`${key}\`，但 core/09 §3 表缺该行`);
}

// A5. 所有 i18n key 都必须被至少一个 wire code 指到（防止留下孤儿文案）
const usedKeys = new Set(Object.values(CODE_TO_I18N));
for (const key of termsKeys) {
  if (!usedKeys.has(key)) fails.push(`[A3] i18n key \`${key}\` 没有任何 wire code 指向它（孤儿文案）`);
}

// A6. 兜底行为自检：未知码必须回落到「系统异常」，且已知码必须拿到非空/预期文案
if (msgOf('SYSTEM_ERROR') !== ERROR_MESSAGES['ERR.SYSTEM']) {
  fails.push('[A4] msgOf() 兜底异常：未知/系统码未正确回落 ERR.SYSTEM');
}
if (msgOf('FREE_LIMIT_EXCEEDED') !== ERROR_MESSAGES['ERR.FREE_LIMIT']) {
  fails.push('[A5] msgOf(FREE_LIMIT_EXCEEDED) 未命中「已达免费上限」—— wire code 与 i18n key 映射链路断裂');
}

// ===================== C. 云函数登记一致 =====================
const fnText = read('core/10_云函数清单与接口契约.md');
const sec6 = section(fnText, '## 6. 管理后台 H5', '## 7.');
const registered = new Set();
for (const line of sec6.split('\n')) {
  if (!line.trim().startsWith('|')) continue;
  const fn = backticked(line, 1);
  if (fn && /^admin[A-Za-z]+$/.test(fn)) registered.add(fn);
}

const implText = read('core/16_后台鉴权规范.md');
const bootstrapPlusToken = `${section(implText, '## 7. 首超管引导', '## 9.')}`;
const usedFns = new Set();
// 逐个取反引号内容，再取开头的 admin 标识符。
// ⚠️ 不能简单用 /`(admin[A-Za-z]+)`/ —— core/16 里写成 `adminRevokeToken(admin_id)`（带括号），
//    那样会漏掉它（假阴性）。这里允许后面跟 "(" 或直接结束；同时也排除 `admin_user` 这类集合名
//    （下划线后不是大写字母，故不匹配）。
for (const m of bootstrapPlusToken.matchAll(/`([^`]+)`/g)) {
  const hit = m[1].match(/^(admin[A-Z][A-Za-z]*)(?:\(|$)/);
  if (hit) usedFns.add(hit[1]);
}

notes.push(`core/10 §6 已登记 admin 函数: ${registered.size} 个`);
notes.push(`core/16 §7/§8 引用 admin 函数: ${usedFns.size} 个`);

for (const fn of usedFns) {
  if (!registered.has(fn)) {
    fails.push(`[C1] core/16 引入 \`${fn}\`，但 core/10 §6 契约表未登记（违反"函数名即契约"）`);
  }
}

// ===================== 输出 =====================
console.log('══════ 规范层一致性机械门禁 ══════');
notes.forEach((n) => console.log('  · ' + n));
console.log('');

if (fails.length === 0) {
  console.log('✅ 全部断言通过（错误码三向一致 / 映射完整 / 函数登记一致）');
  console.log('   → core/09 §1 ↔ §3 ↔ terms.js 三向闭合；core/16 引入的 admin 函数均已登记于 core/10');
  process.exit(0);
} else {
  console.log(`❌ 发现 ${fails.length} 处断裂：`);
  fails.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f}`));
  console.log('');
  console.log('修法提示：');
  console.log('  · A 类（缺 i18n 键）→ 在 core/09 §3 表补一行 + i18n/terms.js ERROR_MESSAGES 补同键');
  console.log('  · B 类（缺映射）   → 在 i18n/terms.js CODE_TO_I18N 补 wire → i18n 条目');
  console.log('  · C 类（未登记函数）→ 在 core/10 §6 契约表补一行函数名/入参/出参/鉴权');
  process.exit(1);
}
