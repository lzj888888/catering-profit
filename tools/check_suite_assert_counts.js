/**
 * check_suite_assert_counts.js —— 套件断言数口径守卫（R107，round73）
 *
 * 背景（同族病第 15 例，与 round69 第 13 例「验收自检通过数 48 vs 41」同型、且是它的**泛化**）：
 *   仓内多处 .md 把各套件的断言数写成**创建时**的值，而这些套件此后一直在加断言：
 *     · `tools/selftest_ui_fix.js`    文档 27  → 实跑 **31**
 *     · `tools/selftest_batch8b.js`   文档 48  → 实跑 **104**
 *     · `tools/selftest_batch8c.js`   文档 56  → 实跑 **57**
 *   （其余 `selftest_ad_gates` 24 / `check_ios_pay` 6 / `check_env_ready` 11 与文档一致 ⇒ 未漂移）
 *   round69 的 R105 只守住了 `verify_seed_data` **一个**脚本，其余套件仍是零守卫的人工面。
 *
 * 后果（为什么必须守，与第 13 例同）：断言数是**下界** —— 写成 27 而实跑 31 时，
 *   删掉 4 条断言文档仍说「27 条符合预期」 ⇒ 4 条断言静默丢失而门禁照旧判绿。
 *
 * 判据（四条腿）：
 *   ① 实算单源：**实跑**每个套件脚本并解析其 stdout 的 `N 通过 / M 失败`（不抄字面量，fail-closed，rc≠0 即红）。
 *   ② 唯一声明处：`★知识存储点` 内的语义标记 `套件断言数口径（唯一声明处）`，一行列出 `key`=N。
 *   ③ 声明 ≡ 实跑：逐个 key 比对（缺 key / 多 key / 值不符皆红）。
 *   ④ 前提守卫（证明本守卫不是恒真）：实跑集合非空且 ≥6 个；历史面确有旧值命中（排除面没打错）。
 *
 * ⚠️ 已知坑的对应处理：
 *   · 坑⑭/⑯ 裸扫数字必误杀：当前态引用面只作**弱面**打印 ⚠️ 明示、不判红；硬判据只认唯一声明处。
 *   · 坑⑱ `git ls-files` 只扫 index：扫描面一律**工作树递归**，不用 git。
 *   · 坑⑮ 标记词自指：声明行只允许 1 处（A7 单源不扩散），且扫描面排除 `tools/`（守卫自身）。
 *   · CJK 路径：重启键文件名以 `★知识存储点` 前缀在 `specs/dev-specs/` 下实找，不硬编码全名。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const DECL_MARK = '套件断言数口径（唯一声明处）';
const SPEC_DIR = path.join(ROOT, 'specs', 'dev-specs');

// 受守套件：全部来自 verify_all.js 的 SUITES，实跑即取真值
const CASES = [
  { key: 'selftest_ui_fix', rel: 'tools/selftest_ui_fix.js' },
  { key: 'selftest_ad_gates', rel: 'tools/selftest_ad_gates.js' },
  { key: 'selftest_batch8b', rel: 'tools/selftest_batch8b.js' },
  { key: 'selftest_batch8c', rel: 'tools/selftest_batch8c.js' },
  { key: 'check_ios_pay', rel: 'tools/check_ios_pay.js' },
  { key: 'check_env_ready', rel: 'tools/check_env_ready.js' },
  // R85 扩面（round85）：外卖段自测原不在受守集合内 ⇒ 本轮实测 60 条而文档写 43 条、零守卫；
  //   与 round73 立本守卫的根因同族（文档写低 = 下界保护失效）⇒ 纳入。
  { key: 'selftest_r85', rel: 'tools/selftest_r85.js' },
  // R115 扩面（round86）：主题色单源守卫同批纳入 —— 该守卫初版 A3-③ 即被变异 M3 判出**恒真断言**
  //   （声称「防 EXTS 被改小」而实现恒真）⇒ 断言数必须受守，否则「改小扫描面/删断言」静默通过。
  { key: 'check_theme_color', rel: 'tools/check_theme_color.js' },
  // 坑⑱ 元守卫（round87）：SUITES 覆盖守卫自身**不在受守集合内** ⇒ 它 round86 断言数 8→10 无人校验，
  //   而它恰恰是「防判据漏挂 SUITES」的元守卫（第 4 例）；删它一条断言就少守一类漏挂 ⇒ 纳入下界保护。
  { key: 'check_suite_coverage', rel: 'tools/check_suite_coverage.js' },
  // R119 扩面（round92）：金额框同行守卫同批纳入 —— 它守「金额框被同层元素挤窄」这个已复发三次的布局病，
  //   而 A3 的下界护栏与 A4 的正负样本正是它的「非恒真」证明；断言数不受守则改小下界同样无人知。
  { key: 'check_amount_input_row', rel: 'tools/check_amount_input_row.js' },
  // R120 扩面（round93）：粘贴形态用例表守卫同批纳入 —— 它的 A0 表宽护栏（用例条数/B 组 ≥4/C 组 ≥3）
  //   与 A6 前提证明正是「非恒真」的凭据；断言数不受守则「删掉 A0 一道护栏 + 从表里删 5 条用例」
  //   就等于把守卫悄悄改小，而门禁照旧判绿（与 round73 立本守卫的根因同族）。
  { key: 'check_takeaway_paste_cases', rel: 'tools/check_takeaway_paste_cases.js' },
  // R121 扩面（round97）：费用项清单守卫同批纳入 —— 它的 E5 下界护栏（总项数 ≥20 / 每类 ≥2）与
  //   E6 前提证明正是「非恒真」的凭据；断言数不受守则「删掉下界 + 删一处副本比对」同样静默通过。
  { key: 'check_expense_item_seed', rel: 'tools/check_expense_item_seed.js' },
  // R123 扩面（round100）：WXML 结构完整性守卫同批纳入 —— 它是**唯一有两个独立判据**的守卫
  //   （A 裸属性行 / B 标签配平），删掉其中任一条 ⇒ 实跑通过数 2→1，**仍 > 0**
  //   ⇒ A0-② 的「通过数为 0」下界抓不到，只有本守卫的 A2「声明 ≡ 实跑」能发现。
  //   （对照：R122 `check_js_syntax` 只有单一判据，删掉即 pass=0、A0-② 当场转红，故不必另立声明。）
  { key: 'check_wxml_structure', rel: 'tools/check_wxml_structure.js' },
  // R125 扩面（round109）：流程出口与折叠守卫同批纳入 —— 它的 S5 断言数下界（≥20）与 S2 四组
  //   正负样本互证正是「非恒真」的凭据；断言数不受守则「删掉两组正负样本」就等于把守卫悄悄改小
  //   （判据仍全绿而证明力归零），与 round73 立本守卫的根因同族。
  { key: 'check_flow_entry_and_fold', rel: 'tools/check_flow_entry_and_fold.js' },
  // R126 扩面（round110）：餐饮指标参考库口径守卫同批纳入 —— 它的 D-① 比较器 5 组正负样本互证、
  //   D-② 真实数据变异互证、D-③ 逐项比较对数下界、D-⑤ 断言数下界正是「非恒真」的凭据；
  //   而 A/B 两组是本库**核心权威值**的双向与三方比对 —— 断言数不受守则「删掉一个城市的系数比对
  //   或删掉一条红线三方腿」就等于把守卫悄悄改小（判据仍全绿而证明力归零），与 round73 同族。
  { key: 'check_indicator_ref', rel: 'tools/check_indicator_ref.js' },
];

const HIST = ['原写', '此前', '曾写', '旧值', '历史', 'round', '轮次', '演进'];
const NEAR = 120;

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

// ============ A0 实算单源：真跑每个套件 ============
section('A0 实算单源（逐个真跑套件脚本，不抄字面量）');
const actual = {};
let runErr = 0;
for (const c of CASES) {
  try {
    const out = execFileSync(NODE, [path.join(ROOT, c.rel)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = /(\d+)\s*通过\s*\/\s*(\d+)\s*失败/.exec(out);
    if (!m) { no('A0-' + c.key, `stdout 里解析不到「N 通过 / M 失败」(${c.rel})`); runErr++; continue; }
    actual[c.key] = Number(m[1]);
    console.log(`  · ${c.rel} → ${actual[c.key]} 通过`);
  } catch (e) {
    no('A0-' + c.key, `实跑失败 rc≠0（${c.rel}）`); runErr++;
  }
}
if (runErr === 0) ok('A0-①', `${CASES.length} 个套件全部实跑成功（rc=0）且解析到通过数`);
if (Object.values(actual).every((v) => v > 0)) ok('A0-②', '各套件通过数均 > 0（下界非空）');
else no('A0-②', '存在通过数为 0 的套件 ⇒ 实算不可信');

// ============ A1 唯一声明处 ============
section('A1 唯一声明处（重启键内的语义标记行）');
const restartAbs = findRestartDoc();
if (!restartAbs) { no('A1-①', '未找到 ★知识存储点_*.md（CJK 路径解析失败）'); }
const restartTxt = restartAbs ? readAbs(restartAbs) : '';
const declLines = restartTxt.split(/\r?\n/).filter((l) => l.includes(DECL_MARK));
if (restartAbs) {
  if (declLines.length === 1) ok('A1-①', `唯一声明处存在且仅 1 行（${path.basename(restartAbs)}）`);
  else no('A1-①', `声明行数为 ${declLines.length}（须恰为 1）`);
}

// 解析 `key`=N
const decl = {};
if (declLines.length === 1) {
  const re = /`?([A-Za-z0-9_]+)`?\s*=\s*(\d+)/g;
  let m;
  while ((m = re.exec(declLines[0])) !== null) decl[m[1]] = Number(m[2]);
}
section('A2 声明 ≡ 实跑（逐 key 比对）');
for (const c of CASES) {
  if (!(c.key in decl)) { no('A2-' + c.key, `声明行缺少 \`${c.key}\` 的断言数`); continue; }
  if (decl[c.key] === actual[c.key]) ok('A2-' + c.key, `声明 ${decl[c.key]} ≡ 实跑 ${actual[c.key]}`);
  else no('A2-' + c.key, `声明 ${decl[c.key]} ≠ 实跑 ${actual[c.key]}`);
}

// ============ A5 前提守卫（非恒真）============
section('A5 前提守卫（证明本守卫不是恒真）');
if (CASES.length >= 6) ok('A5-①', `受守套件 ${CASES.length} 个 ≥ 6（集合被改小即转红）`);
else no('A5-①', `受守套件仅 ${CASES.length} 个 < 6 ⇒ 覆盖面不足`);
const extra = Object.keys(decl).filter((k) => !CASES.some((c) => c.key === k));
if (extra.length === 0) ok('A5-②', '声明行无受守集合外的多余 key');
else no('A5-②', `声明行含未受守 key：${extra.join(', ')}`);

// A6 历史面非空（证明 HIST/排除面确实放过旧值，排除面写错会转红）
const allMd = restartAbs ? scanMd() : [];
let histHits = 0;
for (const abs of allMd) {
  if (abs === restartAbs) continue;          // 声明处自身不计
  if (!/review[\\/]/.test(abs)) continue;    // 历史陈述集中在 review/
  const t = readAbs(abs);
  for (const line of t.split(/\r?\n/)) {
    if (!/selftest_ui_fix|selftest_batch8b/.test(line)) continue;
    if (/27\s*(条|\s*\/\s*27)|48\s*条/.test(line)) { histHits++; break; }
  }
}
if (histHits >= 1) ok('A6-①', `历史面命中 ${histHits} 份旧值陈述（HIST 排除确实生效）`);
else no('A6-①', '历史面零命中 ⇒ 排除面可能打错，守卫前提失效');

// ============ A7 单源不扩散 ============
section('A7 单源不扩散');
const spread = allMd.filter((abs) => abs !== restartAbs && readAbs(abs).includes(DECL_MARK));
if (spread.length === 0) ok('A7-①', '仅重启键一处自称本口径单源');
else no('A7-①', `另有 ${spread.length} 处自称本口径单源：${spread.map((a) => path.relative(ROOT, a).replace(/\\/g, '/')).join(', ')}`);

// ============ W 弱面（只明示，不判红）============
section('W 弱面：specs 内当前态引用与实跑不符（明示，不判红）');
let weak = 0;
for (const abs of allMd) {
  if (!/specs[\\/]/.test(abs)) continue;
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const t = readAbs(abs);
  t.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(DECL_MARK)) return;
    if (HIST.some((w) => line.includes(w))) return;
    for (const c of CASES) {
      const kp = line.indexOf(c.key);
      if (kp < 0) continue;
      const m = /(\d+)\s*(?:条|通过|\s*\/\s*\d+\s*全绿)/.exec(line.slice(kp, kp + NEAR));
      if (!m) continue;
      // 「新增 N 条」是**增量**口径，不是全集 ⇒ 跳过（坑⑭ 同族：裸扫数字必误杀）
      if (/新增/.test(line.slice(Math.max(0, kp - 30), kp + m.index))) continue;
      const v = Number(m[1]);
      if (v !== actual[c.key]) {
        weak++;
        console.log(`  ⚠️ ${rel}:${i + 1} ${c.key} 写 ${v} / 实跑 ${actual[c.key]}`);
      }
    }
  });
}
if (weak === 0) console.log('  （无不符）');
console.log(`  · 弱面共 ${weak} 条（只明示，不判红 —— 可能是子集/另一口径）`);
ok('W-①', `弱面扫描完成：${weak} 条明示（弱面只提示、不判红）`);

console.log(`\n===== 套件断言数口径守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
