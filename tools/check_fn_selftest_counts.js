/**
 * check_fn_selftest_counts.js —— 云函数 selftest 通过数口径守卫（R108，round74）
 *
 * 背景（同族病第 16 例，是 round73 第 15 例「套件断言数」向**云函数层**的推广）：
 *   round69 的 R105 只守了 `verify_seed_data` 一个脚本，round73 的 R107 只守了 `tools/` 下 6 个套件，
 *   而 SUITES 里占多数的**云函数 selftest（42 个）一个都没守**。本轮实跑抓到真漂移：
 *     · POC2 七函数合计：文档 83 项 → 实跑 **108** 项
 *       （`saveCostCard` 15 → **29**、`calcBom` 29 → **40**；旧明细见
 *        `review/REVIEW_2026-09-15_round16-verify.md:92`「29+12+8+7+15+8+4 = 83 项」）
 *     · 漂移面在**重启键**（`★知识存储点` 的 POC2 交付行与其 §6 叙述段，两处都写 83）
 *
 * 后果（与第 13/15 例同）：通过数是**下界** —— 文档写 83 时，断言从 108 掉回 83
 *   文档仍说「合计 83 项符合预期」⇒ **25 条断言静默丢失而门禁照旧判绿**
 *   （selftest 自身只报 pass/fail，掉多少条没人知道）。
 *
 * 判据（四条腿）：
 *   ① 实算单源：**真跑**每个云函数 selftest 并解析 stdout 的 `N 通过 / M 失败`（不抄字面量，fail-closed）。
 *   ② 唯一声明处：重启键内的语义标记行，值 ≡ 实跑求和。
 *   ③ 当前态单函数陈述（`` `fn` N/N `` 形态）≡ 实跑 pass（命中数 ≥3 作 fail-closed 前提）。
 *   ④ 三道前提守卫：受守函数 ≥7 / 声明值 >0 / 历史面（review/）确有旧值命中 ⇒ 排除面没打错。
 *
 * ⚠️ 已知坑的对应处理：
 *   · 坑⑭/⑯ 裸扫数字必误杀：硬判据只认「唯一声明处」与 `` `fn` N/N `` 两种**带形态**的陈述；
 *     其余（「合计 N 项」叙述、未挂牌的裸数字）一律落**弱面**只 ⚠️ 明示、不判红。
 *   · 坑⑱ `git ls-files` 只扫 index：扫描面一律**工作树递归**，不用 git。
 *   · 坑⑮ 标记词自指：声明标记只允许 1 处（C5 单源不扩散），扫描面排除 `tools/`（守卫自身）。
 *   · CJK 路径：重启键按 `★知识存储点` 前缀在 `specs/dev-specs/` 下实找，不硬编码全名。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const DECL_MARK = 'POC2 selftest 合集口径（唯一声明处）';
const SPEC_DIR = path.join(ROOT, 'specs', 'dev-specs');

// 受守集合：POC2 七函数（文档对它们有明确的合计与逐函数陈述）
const CASES = [
  { fn: 'calcBom', rel: 'cloudfunctions/calcBom/selftest.js' },
  { fn: 'detectCycle', rel: 'cloudfunctions/detectCycle/selftest.js' },
  { fn: 'getCostCard', rel: 'cloudfunctions/getCostCard/selftest.js' },
  { fn: 'getMaterial', rel: 'cloudfunctions/getMaterial/selftest.js' },
  { fn: 'saveCostCard', rel: 'cloudfunctions/saveCostCard/selftest.js' },
  { fn: 'saveMaterial', rel: 'cloudfunctions/saveMaterial/selftest.js' },
  { fn: 'syncCostCard', rel: 'cloudfunctions/syncCostCard/selftest.js' },
];

const HIST = ['原写', '此前', '曾写', '旧值', '历史', 'round', '轮次', '演进'];

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');
const readAbs = (abs) => fs.readFileSync(abs, 'utf8');

/** 工作树递归扫 .md（坑⑱：不用 git ls-files） */
function scanMd() {
  const out = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'tools', 'cloudfunctions', 'miniprogram'].includes(e.name)) continue;
        walk(abs);
      } else if (e.name.endsWith('.md')) out.push(abs);
    }
  };
  walk(ROOT);
  return out;
}

/** 找重启键（CJK 文件名，按前缀实找） */
function findRestartDoc() {
  let ents = [];
  try { ents = fs.readdirSync(SPEC_DIR); } catch (e) { return null; }
  const hit = ents.filter((n) => n.startsWith('★知识存储点'));
  return hit.length ? path.join(SPEC_DIR, hit[0]) : null;
}

// ============ C0 实算单源：真跑七函数 selftest ============
section('C0 实算单源（逐个真跑云函数 selftest，不抄字面量）');
const actual = {};
let runErr = 0;
for (const c of CASES) {
  try {
    const out = execFileSync(NODE, [path.join(ROOT, c.rel)], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const m = /(\d+)\s*通过\s*\/\s*(\d+)\s*失败/.exec(out);
    if (!m) { no('C0-' + c.fn, `stdout 里解析不到「N 通过 / M 失败」(${c.rel})`); runErr++; continue; }
    actual[c.fn] = Number(m[1]);
    console.log(`  · ${c.rel} → ${actual[c.fn]} 通过`);
  } catch (e) {
    no('C0-' + c.fn, `实跑失败 rc≠0（${c.rel}）`); runErr++;
  }
}
if (runErr === 0) ok('C0-①', `${CASES.length} 个云函数 selftest 全部实跑成功（rc=0）且解析到通过数`);
const sumActual = Object.values(actual).reduce((a, b) => a + b, 0);
if (Object.values(actual).every((v) => v > 0)) ok('C0-②', '各函数通过数均 > 0（下界非空）');
else no('C0-②', '存在通过数为 0 的函数 ⇒ 实算不可信');
console.log(`  · 七函数合计（实跑）= ${sumActual} 项`);

// ============ C1 唯一声明处 ============
section('C1 唯一声明处（重启键内的语义标记行）');
const restartAbs = findRestartDoc();
if (!restartAbs) no('C1-①', '未找到 ★知识存储点_*.md（CJK 路径解析失败）');
const restartTxt = restartAbs ? readAbs(restartAbs) : '';
const declLines = restartTxt.split(/\r?\n/).filter((l) => l.includes(DECL_MARK));
if (restartAbs) {
  if (declLines.length === 1) ok('C1-①', `唯一声明处存在且仅 1 行（${path.basename(restartAbs)}）`);
  else no('C1-①', `声明行数为 ${declLines.length}（须恰为 1）`);
}
let declSum = null;
if (declLines.length === 1) {
  const m = /合计\s*\**(\d+)\**\s*项/.exec(declLines[0]);
  if (m) { declSum = Number(m[1]); console.log(`  · 声明合计 = ${declSum} 项`); }
  else no('C1-②', '声明行内解析不到「合计 N 项」（fail-closed）');
}

// ============ C2 声明 ≡ 实跑求和 ============
section('C2 声明 ≡ 实跑求和');
if (declSum === null) no('C2-①', '无可用声明值 ⇒ 无法比对（fail-closed）');
else if (declSum === sumActual) ok('C2-①', `声明 ${declSum} ≡ 实跑求和 ${sumActual}`);
else no('C2-①', `声明 ${declSum} ≠ 实跑求和 ${sumActual}`);

// ============ C3 当前态单函数陈述（`fn` N/N 形态）============
section('C3 当前态单函数陈述 ≡ 实跑');
const allMd = restartAbs ? scanMd() : [];
let hitCur = 0;
for (const abs of allMd) {
  if (!/specs[\\/]/.test(abs)) continue;                 // 只认 specs 下的当前态陈述
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const t = readAbs(abs);
  t.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(DECL_MARK)) return;
    if (HIST.some((w) => line.includes(w))) return;
    for (const c of CASES) {
      const re = new RegExp('`' + c.fn + '`\\s*(\\d+)\\s*/\\s*(\\d+)');
      const m = re.exec(line);
      if (!m) continue;
      hitCur++;
      const v = Number(m[1]);
      if (v === actual[c.fn]) ok(`C3-${c.fn}`, `${rel}:${i + 1} 写 ${v}/${m[2]} ≡ 实跑 ${actual[c.fn]}`);
      else no(`C3-${c.fn}`, `${rel}:${i + 1} 写 ${v}/${m[2]} ≠ 实跑 ${actual[c.fn]}`);
    }
  });
}

// ============ C4 前提守卫（证明本守卫不是恒真）============
section('C4 前提守卫（证明本守卫不是恒真）');
if (CASES.length >= 7) ok('C4-①', `受守函数 ${CASES.length} 个 ≥ 7（集合被改小即转红）`);
else no('C4-①', `受守函数仅 ${CASES.length} 个 < 7 ⇒ 覆盖面不足`);
if (declSum !== null && declSum > 0) ok('C4-②', `声明合计 ${declSum} > 0（声明解析非退化）`);
else no('C4-②', '声明合计解析失败或为 0 ⇒ fail-closed');
if (hitCur >= 3) ok('C4-③', `当前态单函数陈述命中 ${hitCur} 条 ≥ 3（扫描面非空）`);
else no('C4-③', `当前态单函数陈述仅命中 ${hitCur} 条 < 3 ⇒ 扫描面可能打错`);
// 历史面：review/ 下确有旧值（83 项）陈述 ⇒ 证明「排除 review/」这条排除面确实有内容
let histHits = 0;
for (const abs of allMd) {
  if (!/review[\\/]/.test(abs)) continue;
  if (/83\s*项/.test(readAbs(abs))) histHits++;
}
if (histHits >= 1) ok('C4-④', `历史面命中 ${histHits} 份旧值（83 项）陈述（排除面确实生效）`);
else no('C4-④', '历史面零命中 ⇒ 排除面可能打错，守卫前提失效');

// ============ C5 单源不扩散 ============
section('C5 单源不扩散');
const spread = allMd.filter((abs) => abs !== restartAbs && readAbs(abs).includes(DECL_MARK));
if (spread.length === 0) ok('C5-①', '仅重启键一处自称本口径单源');
else no('C5-①', `另有 ${spread.length} 处自称本口径单源：${spread.map((a) => path.relative(ROOT, a).replace(/\\/g, '/')).join(', ')}`);

// ============ W 弱面（只明示，不判红）============
section('W 弱面：specs 内当前态聚合/裸数字与实跑不符（明示，不判红）');
let weak = 0;
for (const abs of allMd) {
  if (!/specs[\\/]/.test(abs)) continue;
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const t = readAbs(abs);
  t.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(DECL_MARK)) return;
    if (HIST.some((w) => line.includes(w))) return;
    const m = /合计\s*\**(\d+)\**\s*项/.exec(line);
    if (!m) return;
    const v = Number(m[1]);
    if (v !== sumActual) { weak++; console.log(`  ⚠️ ${rel}:${i + 1} 合计写 ${v} / 实跑求和 ${sumActual}`); }
  });
}
if (weak === 0) console.log('  （无不符）');
console.log(`  · 弱面共 ${weak} 条（只明示，不判红 —— 可能是子集/另一口径）`);
ok('W-①', `弱面扫描完成：${weak} 条明示（弱面只提示、不判红）`);

console.log(`\n===== 云函数 selftest 通过数口径守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
