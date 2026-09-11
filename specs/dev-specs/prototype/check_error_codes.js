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

// 扫描面扩展：不再只取 core/16 §7~§9，而是遍历 specs/dev-specs 下**全部 .md**
// （原范围会漏掉在别的文件/新章节里引入的 admin 函数 —— 复审指出的盲区）。
const EXCLUDE_FN = new Set([
  'adminAuth',   // 中间件，不是云函数
  'adminId',     // ctx 字段
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const allMd = walk(ROOT)
  .filter((p) => p.endsWith('.md'))
  .filter((p) => !path.basename(p).startsWith('OBSOLETE_'));

const usedFns = new Map(); // fn -> 首次出现的文件
for (const f of allMd) {
  const txt = read(path.relative(ROOT, f).replace(/\\/g, '/'));
  for (const m of txt.matchAll(/`([^`]+)`/g)) {
    // ⚠️ 不能简单用 /`(admin[A-Za-z]+)`/ —— 写成 `adminRevokeToken(admin_id)`（带括号）会漏掉（假阴性）。
    //    这里允许后面跟 "(" 或直接结束；下划线开头（admin_user 等集合名）自然不匹配。
    const hit = m[1].match(/^(admin[A-Z][A-Za-z]*)(?:\(|$)/);
    if (!hit) continue;
    const fn = hit[1];
    if (EXCLUDE_FN.has(fn)) continue;
    if (!usedFns.has(fn)) usedFns.set(fn, path.relative(ROOT, f).replace(/\\/g, '/'));
  }
}

notes.push(`core/10 §6 已登记 admin 函数   : ${registered.size} 个`);
notes.push(`全树引用 admin 函数（已排除中间件/字段）: ${usedFns.size} 个`);
notes.push(`配额口径 / 表格结构 扫描文件数: ${allMd.length} 个`);

// 注：C1 / D1 / E1 的断言统一放在 D、E 两组计算完成之后（见下），避免 TDZ。

// ===================== D. 配额口径一致性（防 v1.1 旧值复发）=====================
// 背景：M3「8 张」、M2「3 套」都是 v1.1 过期值，此前各复发过一次且都靠人眼才发现。
// 这里把 v1.4 权威口径写成可机械断言的常量：命中禁用模式即 fail。
const FORBIDDEN_QUOTA = [
  { re: /M2\s*[=＝]\s*3/, tip: 'M2 应是「不限套」，不是 3' },
  { re: /M2[^。；\n]{0,12}3\s*套/, tip: 'M2 无套数限制' },
  { re: /M2[^。；\n]{0,12}3\s*方案/, tip: 'M2 方案不限套' },
  { re: /M3[^。；\n]{0,14}8\s*张/, tip: 'M3 应为 3 张，8 张是 v1.1 过期值' },
  { re: /单张导出免费/, tip: '导出（含单张 PDF）全部仅付费解锁' },
  // 价格旧值：P0-1 的原始缺陷就是价格，且改价概率高于改配额，顺手加保险
  { re: /2990|7990|29900/, tip: '套餐价 v1.4 = 2590 / 6900 / 19900（分）；2990 / 7990 / 29900 是旧值' },
  { re: /(?<!\d)(29\.9|79\.9)\s*元/, tip: '套餐价 v1.4 = 25.9 / 69 / 199 元（(?<!\\d) 防误伤「19.9 元/月」云开发套餐）' },
];
// 合法豁免：**只放沿革 / 作废类标记**。
// ⚠️ 绝不可把「不限套」这类"当前正确值"放进来 —— 那是被检查对象本身，放进豁免等于该行免检；
//    且本项目「配额维度」常写成 M1 / M3 / M2 三项混排一行（如 core/13:59），
//    整行豁免会让同行的 M3=8 张 之类旧值一起逃检（2026-09-12 复审指出的真实漏洞 G1）。
const QUOTA_SKIP_MARKERS = [
  '作废', '已回退', '沿革', '历史', '曾误', '原规划', '原"免费', '原“免费', '无 3 套限制',
];
// 按子句切分：豁免标记只保护**它所在的子句**，不再保护整行
const CLAUSE_SPLIT = /[。；;，,]/;

const quotaHits = [];
for (const f of allMd) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const lines = read(rel).split('\n');
  lines.forEach((line, i) => {
    const clauses = line.split(CLAUSE_SPLIT);
    for (const { re, tip } of FORBIDDEN_QUOTA) {
      const hit = clauses.find(
        (c) => re.test(c) && !QUOTA_SKIP_MARKERS.some((m) => c.includes(m))
      );
      if (hit) {
        quotaHits.push({
          rel, line: i + 1, tip,
          text: line.trim().slice(0, 110),
          clause: hit.trim().slice(0, 70),
        });
      }
    }
  });
}

// ===================== E. 表格结构完整性（堵"引用块把表行挤出表格"的盲区）=====================
// 背景：core/09 §1.4 曾因 blockquote 插在表格中间，导致 AMORT_TERMINATED 行被挤出表格、
//       Markdown 下不再渲染为表行；而"按行首 | 抓表行"的解析方式照收不误，门禁全绿。
// 做法：识别孤儿表行 —— 以 | 开头、但其上一行不是表行/表头、且下一行不是分隔行的行。
function orphanTableRows(text, label) {
  const lines = text.split('\n');
  const orphans = [];
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|')) {
      // 任何非表行都要复位（含不带空行的散文行）—— CommonMark 下段落行同样会中断表格，
      // 表行必须连续排列。原写法只在空行 / 引用块 / 标题处复位，会漏掉散文行中断的情形（G2）。
      inTable = false;
      continue;
    }
    if (inTable) continue;
    // 不在表内却出现 | 行：只有"下一行是分隔行"才算表头，否则就是孤儿行
    const next = (lines[i + 1] || '').trim();
    if (/^\|[\s:|-]+\|$/.test(next)) {
      inTable = true;
      continue;
    }
    orphans.push(`${label}:${i + 1}  ${t.slice(0, 90)}`);
  }
  return orphans;
}

const structureHits = [];
for (const f of allMd) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  structureHits.push(...orphanTableRows(read(rel), rel));
}

// ---- C1 / D1 / E1 断言（必须在上面三组计算之后执行）----
for (const [fn, src] of usedFns) {
  if (!registered.has(fn)) {
    fails.push(`[C1] \`${fn}\`（首见于 ${src}）未登记进 core/10 §6 契约表（违反"函数名即契约"）`);
  }
}

for (const h of quotaHits) {
  fails.push(`[D1] 配额/价格旧值残留 ${h.rel}:${h.line} —— ${h.tip}\n        命中子句: ${h.clause}\n        整行原文: ${h.text}`);
}

for (const s of structureHits) {
  fails.push(`[E1] 表格结构损坏（孤儿表行）${s}\n        该行不在任何完整表格内 —— 常见成因：①引用块（>）插在表格中间把表行挤出；②表行之间夹了不带空行的散文行（CommonMark 下同样中断表格）。表行必须连续排列。`);
}

// ===================== 输出 =====================
console.log('══════ 规范层一致性机械门禁 ══════');
notes.forEach((n) => console.log('  · ' + n));
console.log('');

if (fails.length === 0) {
  console.log('✅ 全部断言通过');
  console.log('   A/B 错误码三向一致 + 映射完整 : core/09 §1 ↔ §3 ↔ terms.js 已闭合');
  console.log('   C   云函数登记一致           : 全树引用的 admin 函数均已登记于 core/10 §6');
  console.log('   D   配额口径一致             : 无 M2=3 / M3=8 张 / 单张导出免费 等 v1.1 旧值残留');
  console.log('   E   表格结构完整             : 无被引用块挤出表格的孤儿表行');
  process.exit(0);
} else {
  console.log(`❌ 发现 ${fails.length} 处断裂：`);
  fails.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f}`));
  console.log('');
  console.log('修法提示：');
  console.log('  · A 类（缺 i18n 键） → 在 core/09 §3 表补一行 + i18n/terms.js ERROR_MESSAGES 补同键');
  console.log('  · B 类（缺映射）     → 在 i18n/terms.js CODE_TO_I18N 补 wire → i18n 条目');
  console.log('  · C 类（未登记函数） → 在 core/10 §6 契约表补一行函数名/入参/出参/鉴权');
  console.log('  · D 类（配额旧值）   → 改回 v1.4 口径：M1=1 账套 / M3=3 张 / M2 不限套；导出全禁');
  console.log('                         （若确属沿革记录，在同行加「作废 / 已回退 / 原规划」等豁免标记）');
  console.log('  · E 类（表格结构）   → 把被引用块挤出的表行移回表内（紧邻表头，勿用 > 分隔）');
  process.exit(1);
}
