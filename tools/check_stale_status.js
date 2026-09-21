/**
 * check_stale_status.js —— 「小节标题 ↔ 小节正文」状态陈述矛盾守卫（R109，round76）
 *
 * 背景（同族病第 17 例 —— 前 16 例见 `★知识存储点 §1.1` 与 `PITFALLS.md §4`）：
 *   本仓最贵的病 = 「人工陈述面 ≠ 实然，且零守卫」。前 16 例几乎全是**数字**漂移
 *   （套件数 / 云函数清单 / 占位符处数 / 断言数 / 云函数 selftest 通过数 …）。
 *   本例是**时态**漂移：事项闭环后只改了正文，**标题与页脚仍写着「待修」**。
 *
 * 实例（2026-09-21 实扫，唯一命中，已修）：
 *   `specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md`
 *     · 标题   `### 6. 下一批待修（写码侧 · 快马）：… R81，已挂 4 轮，本轮正式排进"下一批"`
 *     · 同节正文 `… **2026-09-19 round39 已修复（挂 4 轮后闭环）**` + 27 行落地明细
 *     · 页脚两段带日期的警告仍写 §5「未决策、未处置」、§6/§7「均为待修」（三者均已于 09-19 闭环）
 *   ⇒ **一个"决策与待办总览"文档，正文说闭环、标题说待修，而 A–L 无任何一组能测到。**
 *
 * 为什么必须守（实害）：这类矛盾**不报错、不崩、门禁全绿**，读者（含复审方与未来的我）
 *   只会读标题与页脚 ⇒ 要么重复劳动，要么把已修的当未修，**反向污染结论**。
 *
 * 判据（四条腿）：
 *   ① 扫描面 = **活文档面** `specs/**.md`（工作树递归；坑⑱：一律不用 `git ls-files`，只扫 index）。
 *      `review/**` 是**历史档案**，**不进硬判据** —— 其 `~~划删~~ ⇒ 已闭环` 是**正确留痕写法**，
 *      且"待办清单里部分条目已闭环"在档案里属正常形态。仅在 W 段作**弱面明示**。
 *   ② 形态：`^#{2,4}\s` 小节标题含 STALE 词 **且标题不带闭环标记**，而该小节**正文**含闭环标记 ⇒ 命中。
 *      · 只扫 2~4 级标题 —— `#` 一级是**文档主标题**（如"…决策与待办总览"），含 STALE 词属正常，
 *        纳入会立刻误报本文件自身（该文件主标题就写着"待办总览"）。
 *      · 「未完」**刻意不进 STALE 表** —— `★知识存储点 §8「⏳ 未完事项清单」` 正是"标题说未完、
 *        正文一片 ✅ 已完成"的**合法**形态（它是清单不是状态），纳入会误报。
 *   ③ 划删段剥离：先剥掉 `~~…~~` 再找闭环标记 —— "作废但留痕"（如 `~~R81 仍挂~~ ⇒ 已闭环`）
 *      里若闭环词落在划删段内则不计；落在段外（= 明确的当前态陈述）仍计。
 *   ④ 前提守卫：活文档面非空（S1）+ N1/N2/N3 正负样本互证（防恒绿 + 防恒红）。
 *
 * ⚠️ 已知边界（不假装能守）：
 *   · 只守"标题 vs 同节正文"。**页脚 / 引用块 / 别处的过期时态**（本例另有一处）守不到 ——
 *     那种"带日期的历史警告"属 `check_stale_claims.js`（R85 短语表）的领域，靠加短语而非结构判定。
 *   · 语义级判断做不了：若正文用"已完成""搞定了"等**不在 OPEN 词表**的说法，则漏检。
 *     词表宁可窄（漏检 > 误报），误报会让人开始绕守卫。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPEC_ROOT = path.join(ROOT, 'specs');
const REVIEW_ROOT = path.join(ROOT, 'review');

// ② 状态词表（窄表，见头部注释的两条刻意排除：一级标题、「未完」）
const STALE_RE = /待修|待办|未落|排队|未处置|未闭环/;
// ② 闭环标记词表
const OPEN_RE = /已闭环|已修复|已收口|已全部修复|已处置|已落地|闭环判据/;

// S1 活文档面下界（2026-09-21 实到 30 个 .md / 603 个 2~4 级标题）
const MIN_MD = 20;
const MIN_HEADS = 300;

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

/** ③ 划删段剥离 */
const stripStrike = (s) => String(s).replace(/~~[^~]*~~/g, '');

/** 判据本体（纯函数：文本 → 命中数组）。真实扫描与 N1/N2/N3 样本共用同一实现，防"样本用另一套逻辑" */
function scanText(text) {
  const L = String(text).split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < L.length; i++) {
    const head = L[i];
    if (!/^#{2,4}\s/.test(head)) continue;   // ② 只认 2~4 级
    if (!STALE_RE.test(head)) continue;
    if (OPEN_RE.test(head)) continue;        // 标题自带闭环标记 ⇒ 自洽，放过
    const lvl = head.match(/^#+/)[0].length;
    const body = [];
    for (let j = i + 1; j < L.length; j++) {
      const m = L[j].match(/^(#+)\s/);
      if (m && m[1].length <= lvl) break;    // 同节结束
      body.push(stripStrike(L[j]));
    }
    const m2 = body.join('\n').match(OPEN_RE);
    if (m2) hits.push({ line: i + 1, head: head.trim(), mark: m2[0] });
  }
  return hits;
}

/** 工作树递归收 .md + 统计 2~4 级标题（坑⑱：不用 git） */
function collect(root) {
  const files = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'tools'].includes(e.name)) continue;
        walk(abs);
      } else if (e.name.endsWith('.md')) files.push(abs);
    }
  };
  walk(root);
  let heads = 0, stray = 0;
  for (const abs of files) {
    let t = '';
    try { t = fs.readFileSync(abs, 'utf8'); } catch (e) { stray++; continue; }
    heads += (t.match(/^#{2,4}\s/gm) || []).length;
  }
  return { files, heads, stray };
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

// ============ S1 前提守卫：扫描面非空 ============
section('S1 前提守卫（扫描面非空 —— 防"目录写错 ⇒ 恒绿"）');
const live = collect(SPEC_ROOT);
if (live.files.length >= MIN_MD) ok('S1-①', `活文档面 ${live.files.length} 个 .md ≥ ${MIN_MD}`);
else no('S1-①', `活文档面仅 ${live.files.length} 个 .md < ${MIN_MD} ⇒ 扫描面可疑（路径写错？）`);
if (live.heads >= MIN_HEADS) ok('S1-②', `受检小节标题 ${live.heads} 个 ≥ ${MIN_HEADS}`);
else no('S1-②', `受检小节标题仅 ${live.heads} 个 < ${MIN_HEADS} ⇒ 判据覆盖面不足`);
if (live.stray === 0) ok('S1-③', '活文档面全部可读（无读取失败）');
else no('S1-③', `${live.stray} 个文件读取失败 ⇒ 扫描面不完整`);

// ============ A1 硬判据：活文档面 0 条矛盾 ============
section('A1 硬判据：小节标题说 STALE / 同节正文说已闭环（活文档面）');
let liveHits = 0;
for (const abs of live.files) {
  let t = '';
  try { t = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
  for (const h of scanText(t)) {
    liveHits++;
    console.log(`  ❌ ${rel(abs)}:${h.line}`);
    console.log(`       标题: ${h.head.slice(0, 110)}`);
    console.log(`       正文首个闭环标记: "${h.mark}"`);
  }
}
if (liveHits === 0) ok('A1-①', `活文档面 0 条标题/正文状态矛盾（${live.files.length} 个 .md 全扫）`);
else no('A1-①', `活文档面 ${liveHits} 条矛盾 ⇒ 闭环后未同步标题/页脚（改标题或补闭环标记）`);

// ============ A2 正负样本互证（防恒绿 + 防恒红）============
section('A2 正负样本互证（判据在同一实现上必须能红、也必须能绿）');
const N1 = '## 6. 下一批待修：某事项\n- 2026-09-19 已修复（落地明细见下）\n';
const n1 = scanText(N1);
if (n1.length === 1) ok('N1-①', '正样本（标题说待修 + 正文说已修复）⇒ 命中 1 条（守卫有信号，非恒绿）');
else no('N1-①', `正样本命中 ${n1.length} 条（应恰为 1）⇒ 判据失效`);

const N2a = '## 5. 待办（本件未闭合）\n- ~~R81 仍挂~~\n- 另一条仍未落\n';
const N2b = '## 5. 待办（本件未闭合）\n- ~~R81 仍挂 ⇒ 已闭环~~\n- 另一条仍未落\n';
const N2c = '### 6.（✅ 已闭环 2026-09-19）下一批待修：某事项\n- 2026-09-19 已修复\n';
const n2a = scanText(N2a).length, n2b = scanText(N2b).length, n2c = scanText(N2c).length;
if (n2a === 0) ok('N2-①', '负样本 a（真·待办，正文无闭环）⇒ 0 命中（不误杀）');
else no('N2-①', `负样本 a 命中 ${n2a} 条（应 0）⇒ 会误杀正常待办清单`);
if (n2b === 0) ok('N2-②', '负样本 b（闭环词落在 ~~划删段~~ 内）⇒ 0 命中（划删豁免生效）');
else no('N2-②', `负样本 b 命中 ${n2b} 条（应 0）⇒ 划删豁免失效`);
if (n2c === 0) ok('N2-③', '负样本 c（标题自带闭环标记）⇒ 0 命中（自洽放过）');
else no('N2-③', `负样本 c 命中 ${n2c} 条（应 0）⇒ 标题闭环标记未被承认`);

const N3 = '# 某文档 · 决策与待办总览\n正文把某事项标记为已闭环。\n';
const n3 = scanText(N3).length;
if (n3 === 0) ok('N3-①', '负样本 d（一级文档主标题含"待办"）⇒ 0 命中（一级不参与，防误报本文件自身）');
else no('N3-①', `负样本 d 命中 ${n3} 条（应 0）⇒ 一级标题误入判据`);

// ============ A3 自失效护栏 S2：规则曾被完整触发 ============
section('A3 自失效护栏（证明本守卫的判据真被跑到过）');
if (typeof scanText === 'function' && Array.isArray(n1)) ok('S2-①', '判据为纯函数 scanText(text)，真实扫描与样本共用同一实现');
else no('S2-①', '判据实现异常 ⇒ 样本结论不可信');
if (n1.length === 1 && n2a === 0 && n2b === 0 && n2c === 0 && n3 === 0) {
  ok('S2-②', '5 组样本全部如期（1 红 / 4 绿）⇒ 规则被完整触发，非空转');
} else {
  no('S2-②', `样本未全如期（n1=${n1.length} n2a=${n2a} n2b=${n2b} n2c=${n2c} n3=${n3}）⇒ 守卫本身可疑`);
}

// ============ W 弱面：历史档案（review/）里的同族分布，只明示不判红 ============
section('W 弱面：review/ 历史档案里的同型分布（只明示，不判红）');
let weak = 0;
let rev = { files: [] };
try { rev = collect(REVIEW_ROOT); } catch (e) { /* review/ 可能不存在 */ }
for (const abs of rev.files) {
  let t = '';
  try { t = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
  for (const h of scanText(t)) {
    weak++;
    console.log(`  ⚠️ ${rel(abs)}:${h.line} 「${h.head.slice(0, 70)}」/ 正文 "${h.mark}"`);
  }
}
if (weak === 0) console.log('  （无）');
console.log(`  · 弱面共 ${weak} 条 / 扫 ${rev.files.length} 个档案文件 —— 档案里的"待办清单部分已闭环"属正常形态，只提示不判红`);
ok('W-①', `弱面扫描完成：${weak} 条明示（弱面只提示、不判红）`);

console.log(`\n===== 状态陈述矛盾守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
