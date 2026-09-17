// tools/check_schema_sync.js —— 建库单源同步守卫（R74）
//
// 为什么需要（R73 的溢出发现）：
//   `cloudfunctions/initDb/collections.js` 是**建库单源**（25 集合 + 索引 + 种子），
//   而 `specs/dev-specs/prototype/init_db.js` 是**贴进云开发控制台手工建库的那份代码**
//   （A7 已定案：wx-server-sdk 无 createIndex ⇒ 索引只能人照着它/照着手册逐条建），
//   其文件头明写两者「**同步锁死**」—— 但**此前没有任何机器守卫**。
//   R73 给单源补了 `idx_audit_idem`（39 → 40），结果 **init_db.js 与三份文档全都漏跟**，
//   而门禁 A–L、verify_all 依旧全绿（A–L 的 G 组只核 init_db.js 的 SEED_PLANS 价格/天数）。
//   后果不是"少一条索引"这么轻：`audit_log` **只增不删**，幂等预检恰按 `idempotency_key` 查重
//   ⇒ 缺这条索引 = 每次幂等检查都**全表扫描、随时间线性恶化**（正是单源注释里写明的理由）。
//   ⇒ 与 R59「套件数」、R73「幂等覆盖率」同族：**同一事实写在多处 = 漂移源**，必须机器守。
//
// 判据（S1~S5，全部 fail-closed；解析不到即判红，不许静默放行）：
//   S1 集合清单一致    collections.js ↔ init_db.js 的 COLLECTIONS 集合相等
//   S2 索引清单一致    逐集合比 `名字|是否唯一|字段键序` 的多重集合（顺序无关）
//   S3 单源结构不变量  INDEXES 的键 ⊆ COLLECTIONS；索引名全局唯一（重复给 WARN，不阻断）
//   S4 文档声明计数    `新手上云操作手册.md` / `下一步工序清单.md` 里**每一处**写死的总数、
//                      unique 数、集合数 == 实测（写死多处 ⇒ 每处都要一致）
//   S5 工序清单对照表  「逐条对照表」每一行 `集合|索引名|字段↑↓|唯一` ≡ INDEXES（人照着它建索引）
//
// 运行：
//   node tools/check_schema_sync.js          # 校验（exit 0/1）
//   node tools/check_schema_sync.js --list   # 打印解析出的集合/索引清单（维护用，不做断言）

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SINGLE = path.join(ROOT, 'cloudfunctions/initDb/collections.js');
const MIRROR = path.join(ROOT, 'specs/dev-specs/prototype/init_db.js');
const MANUAL = path.join(ROOT, '新手上云操作手册.md');
const STEPS = path.join(ROOT, '下一步工序清单.md');

const LIST_ONLY = process.argv.includes('--list');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
function readOrDie(p) {
  if (!fs.existsSync(p)) {
    console.log(`❌ 缺少必需文件：${rel(p)}`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}

// ===================== 字面量提取（fail-closed）=====================
// 从源码里取出 `const X = [ ... ]` / `const X = { ... }` 的**字面量文本**，
// 再放进干净 vm 上下文里求值（纯数据，无 require / 无副作用）。
// ⚠️ 必须自己扫引号与注释：单源与镜像里都有 `//` 注释（R38/R72 的解释就写在索引条目中间），
//    粗暴按行/按 `];` 截断会把注释里的括号算进去 ⇒ 解析结果不可信（守卫自己成了假绿的来源）。
function extractLiteral(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return null;
  let j = at + decl.length;
  while (j < src.length && src[j] !== '[' && src[j] !== '{') j++;
  if (j >= src.length) return null;
  let depth = 0, quote = null, esc = false, lineC = false, blockC = false;
  for (let k = j; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (lineC) { if (c === '\n') lineC = false; continue; }
    if (blockC) { if (c === '*' && n === '/') { blockC = false; k++; } continue; }
    if (quote) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineC = true; k++; continue; }
    if (c === '/' && n === '*') { blockC = true; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') {
      depth--;
      if (depth === 0) return src.slice(j, k + 1);
      if (depth < 0) return null; // 不平衡 ⇒ 判"解析失败"，交调用方判红
    }
  }
  return null;
}

function pick(file, decl, label) {
  const src = readOrDie(file);
  const text = extractLiteral(src, decl);
  if (text == null) {
    console.log(`❌ [${label}] 解析不到 \`${decl}\` —— 文件结构已变，**判红**（fail-closed，不许静默放行）`);
    return null;
  }
  try {
    return vm.runInNewContext('(' + text + ')', Object.create(null), { timeout: 1000 });
  } catch (e) {
    console.log(`❌ [${label}] \`${decl}\` 字面量求值失败：${e && e.message}`);
    return null;
  }
}

// ===================== 归一化 =====================
const keysStr = (keys) => Object.keys(keys).map((k) => `${k}:${keys[k]}`).join(',');
const desc = (col, ix) => `${col}|${ix.name}|${keysStr(ix.keys)}|${ix.unique === true ? 'U' : '-'}`;
const descOf = (col, name, keysText, uniq) => `${col}|${name}|${keysText}|${uniq ? 'U' : '-'}`;
const bagOf = (idx) => {
  const out = [];
  for (const col of Object.keys(idx)) for (const ix of idx[col]) out.push(desc(col, ix));
  return out;
};
const countAll = (idx) => bagOf(idx).length;
const countUnique = (idx) => bagOf(idx).filter((d) => d.endsWith('|U')).length;
const setDiff = (a, b) => {
  const rest = [...b];
  const only = [];
  for (const x of a) {
    const i = rest.indexOf(x);
    if (i < 0) only.push(x); else rest.splice(i, 1);
  }
  return { only, rest };
};

let pass = 0, failN = 0;
const warns = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// ===================== 解析两侧 =====================
const single = {
  collections: pick(SINGLE, 'const COLLECTIONS =', '单源 collections.js'),
  indexes: pick(SINGLE, 'const INDEXES =', '单源 collections.js'),
};
const mirror = {
  collections: pick(MIRROR, 'const COLLECTIONS =', '镜像 init_db.js'),
  indexes: pick(MIRROR, 'const INDEXES =', '镜像 init_db.js'),
};
if (!single.collections || !single.indexes || !mirror.collections || !mirror.indexes) {
  console.log(`\n===== 建库单源同步守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  process.exit(1);
}

if (LIST_ONLY) {
  console.log(`集合 ${single.collections.length} 张 / 索引 ${countAll(single.indexes)} 条（unique ${countUnique(single.indexes)}）\n`);
  for (const col of Object.keys(single.indexes)) {
    for (const ix of single.indexes[col]) {
      console.log(`  ${col.padEnd(22)} ${ix.name.padEnd(24)} ${keysStr(ix.keys).padEnd(40)} ${ix.unique === true ? '【唯一】' : ''}`);
    }
  }
  process.exit(0);
}

// ===================== S1 集合清单一致 =====================
console.log('===== S1 集合清单一致（collections.js ↔ init_db.js）=====');
{
  const a = single.collections, b = mirror.collections;
  const d = setDiff(a, b);
  check('S1 集合数一致', a.length === b.length, `单源 ${a.length} / 镜像 ${b.length}`);
  check('S1 镜像无缺失集合', d.only.length === 0, d.only.length ? `镜像缺：${d.only.join(', ')}` : '无');
  check('S1 镜像无多余集合', d.rest.length === 0, d.rest.length ? `镜像多：${d.rest.join(', ')}` : '无');
  check('S1 顺序一致', a.join(',') === b.join(','), '（顺序不影响正确性，仅提示）');
}

// ===================== S2 索引清单一致 =====================
console.log('\n===== S2 索引清单一致（逐集合，顺序无关）=====');
{
  const A = single.indexes, B = mirror.indexes;
  const cols = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  for (const col of cols) {
    const da = (A[col] || []).map((ix) => desc(col, ix));
    const db = (B[col] || []).map((ix) => desc(col, ix));
    const d = setDiff(da, db);
    check(`S2 ${col}`, d.only.length === 0 && d.rest.length === 0,
      d.only.length || d.rest.length
        ? `镜像缺：${d.only.join(' / ') || '无'}；镜像多：${d.rest.join(' / ') || '无'}`
        : `${da.length} 条一致`);
  }
  check('S2 索引总数一致', countAll(A) === countAll(B), `单源 ${countAll(A)} / 镜像 ${countAll(B)}`);
}

// ===================== S3 单源结构不变量 =====================
console.log('\n===== S3 单源结构不变量（collections.js 自身）=====');
{
  const A = single.indexes;
  const badKeys = Object.keys(A).filter((c) => !single.collections.includes(c));
  check('S3 INDEXES 的键都是已声明的集合', badKeys.length === 0,
    badKeys.length ? `未声明：${badKeys.join(', ')}` : `覆盖 ${Object.keys(A).length} 张集合`);
  const names = bagOf(A).map((d) => d.split('|')[1]);
  const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dup.length) warns.push(`索引名重复（控制台按集合隔离故不阻断，但易混淆）：${dup.join(', ')}`);
  check('S3 每条索引都有 keys', bagOf(A).every((d) => d.split('|')[2].length > 0), '无空 keys');
  check('S3 unique 只取 true/未写', Object.values(A).flat().every((ix) => ix.unique === undefined || ix.unique === true), '');
}

// ===================== S4 文档声明计数 =====================
console.log('\n===== S4 文档声明计数 == 实测 =====');
const TOTAL = countAll(single.indexes), UNIQ = countUnique(single.indexes), NCOL = single.collections.length;
{
  const manual = readOrDie(MANUAL);
  const steps = readOrDie(STEPS);

  // 每一处写死的数字都必须与实测一致 ⇒ 全量匹配 + 逐条断言，防"改了第一处漏了第二处"。
  const scan = (label, src, re, expect, what) => {
    const hits = [...src.matchAll(re)].map((m) => Number(m[1]));
    check(`S4 ${label} 至少声明一次`, hits.length > 0, `命中 ${hits.length} 处`);
    const bad = hits.filter((n) => n !== expect);
    check(`S4 ${label} 声明值 == 实测${what}`, bad.length === 0,
      bad.length ? `不符：${bad.join(', ')}（应为 ${expect}）` : `${hits.join(' / ')}`);
  };

  scan('手册·索引总数', manual, /共\s*\*\*(\d+)\s*条索引\*\*/g, TOTAL, '索引总数');
  scan('手册·unique 数', manual, /其中\s*\*\*(\d+)\s*条是\s*unique/g, UNIQ, 'unique 数');
  scan('工序清单·标题条数', steps, /工序\s*5\.5\s*·\s*索引\s*(\d+)\s*条/g, TOTAL, '索引总数');
  scan('工序清单·正文条数', steps, /共\s*\*\*(\d+)\s*条索引\*\*/g, TOTAL, '索引总数');
  scan('工序清单·重复次数', steps, /逐条重复\s*(\d+)\s*次/g, TOTAL, '索引总数');
  scan('工序清单·表说明条数', steps, /（共\s*(\d+)\s*条[；;]/g, TOTAL, '索引总数');
  scan('工序清单·集合数', steps, /(\d+)\s*张集合共/g, NCOL, '集合数');
}

// ===================== S5 工序清单逐条对照表 ≡ 单源 =====================
console.log('\n===== S5 工序清单「逐条对照表」≡ 单源 =====');
{
  const steps = readOrDie(STEPS);
  // ⚠️ 必须先**框定表格范围**：本文件还有别的表（报错速查等）含 `| 1 |` 这类行，
  //    不框范围会把它们当成"格式异常的行"而误报。
  const lines = steps.split(/\r?\n/);
  const start = lines.findIndex((l) => /逐条对照表/.test(l));
  let tbl = [];
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\|/.test(l)) tbl.push(l);
      else if (tbl.length) break;
    }
  }
  check('S5 定位到「逐条对照表」', start >= 0 && tbl.length > 0,
    start < 0 ? '找不到「逐条对照表」标题 —— 判红（fail-closed）' : `${tbl.length} 行（含表头/分隔线）`);

  const rowRe = /^\|\s*(\d+)\s*\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|\s*(idx_[A-Za-z0-9_]+)\s*\|\s*(.+?)\s*\|\s*(【唯一】)?\s*\|\s*$/;
  const rows = [];
  const malformed = [];
  for (const ln of tbl) {
    if (/^\|\s*#\s*\|/.test(ln) || /^\|\s*[-:]+/.test(ln)) continue; // 表头 / 分隔线
    const m = rowRe.exec(ln);
    if (!m) { malformed.push(ln); continue; }
    const parsed = [];
    for (const f of m[4].split(',').map((s) => s.trim()).filter(Boolean)) {
      const fm = /^([A-Za-z_][A-Za-z0-9_]*)\s*([↑↓])$/.exec(f);
      if (!fm) { parsed.length = 0; break; }
      parsed.push(`${fm[1]}:${fm[2] === '↑' ? 1 : -1}`);
    }
    if (!parsed.length) { malformed.push(ln); continue; }
    rows.push({ n: Number(m[1]), d: descOf(m[2], m[3], parsed.join(','), !!m[5]) });
  }
  check('S5 无无法解析的表格行', malformed.length === 0,
    malformed.length ? `${malformed.length} 行格式异常（正则已变？）：${malformed[0].slice(0, 60)}…` : '0 行');
  check('S5 对照表行数 == 索引总数', rows.length === TOTAL, `表 ${rows.length} 行 / 单源 ${TOTAL} 条`);
  const nums = rows.map((r) => r.n);
  const seqOk = nums.every((n, i) => n === i + 1);
  check('S5 行号连续 1..N', seqOk, seqOk ? `1..${nums.length}` : `断号：${nums.join(',')}`);
  check('S5 表内索引名无重复', new Set(rows.map((r) => r.d.split('|')[1])).size === rows.length, '');

  const A = bagOf(single.indexes);
  const B = rows.map((r) => r.d);
  const d = setDiff(A, B);
  check('S5 每条单源索引都在表中', d.only.length === 0, d.only.length ? `表中缺：${d.only.join(' / ')}` : `${A.length} 条`);
  check('S5 表中无单源之外的索引', d.rest.length === 0, d.rest.length ? `表中多：${d.rest.join(' / ')}` : '无');
  // 逐行对照（表 → 单源），任一行不符即点名到行号
  const byDesc = new Set(A);
  const bad = rows.filter((r) => !byDesc.has(r.d));
  if (bad.length) {
    failN += bad.length;
    for (const r of bad) console.log(`❌ S5 第 ${r.n} 行与单源不符：${r.d}`);
  } else {
    pass++; console.log('✅ S5 逐行字段（集合／索引名／升序降序／唯一）全等单源');
  }
}

if (warns.length) for (const w of warns) console.log(`  ⚠️ WARN（不阻断）：${w}`);
console.log(`\n===== 建库单源同步守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
