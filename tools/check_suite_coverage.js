#!/usr/bin/env node
// tools/check_suite_coverage.js —— SUITES 覆盖守卫（「判据存在 ≠ 判据被自动执行」的机械兜底）
//
// 为什么需要这一层（2026-09-20 round60）：
//   本仓已两次栽在同一个坑上，且两次都是**靠人肉扫描才发现的**：
//     ① round53：`tools/verify_docx.py` 是《改计数后必跑》的权威判据（docx 是二进制，A–L 与各 check_*.js
//        都扫不到），却**从未登记进 SUITES** ⇒ 「门禁 66/66 全绿」这句话并不包含 docx 校验。
//     ② round55：`TERMS.forbidden` 13 条禁用词全仓零守卫引用（已由 round56 的 check_terms_forbidden.js 补挂）。
//   两次的共同根因 = **新写的判据脚本忘了挂进 verify_all.js 的 SUITES，而没有任何东西会报警**。
//   与 R86「索引已建 ≠ 生效」同族：**判据存在 ≠ 判据被自动执行**。
//   ⇒ 只补挂那两个具体判据只是止血；本文件把「覆盖率」本身变成被机器校验的对象，
//     从此**第三次同类疏漏会在门禁里当场转红**，不再依赖某轮巡检恰好扫到。
//
// 设计要点：
//   1) 扫描面 A = 生产判据脚本（tools/ 与 specs/dev-specs/prototype/ 的 check_/verify_/selftest_/test_*、
//      云函数自带 selftest.js、common/__tests__/）。**每条都必须被 SUITES 引用**。
//   2) 引用判定 = 直接（出现在 SUITES 块）**或** 间接（被任一 SUITES 脚本的源码按其**相对路径**引用）。
//      之所以要"间接"：`tools/verify_docx.py` 是 .py，runner 只能跑 node ⇒ 由 `check_docx_derive.js`
//      薄包装调用；只算直接引用会把它误判为漏网。⚠️ 间接匹配**只用相对路径、不用 basename** ——
//      40 个云函数都叫 `selftest.js`，按 basename 匹配会互相"覆盖"，守卫当场失明。
//   3) 扫描面 B = `review/evidence/**` 里的判据类脚本。这些是**取证件、不是生产判据** ⇒ 走 EXEMPT 白名单，
//      但**白名单是枚举式**：面 B 里出现未登记的条目即判红（防止"把判据悄悄放进证据目录"绕开面 A）。
//      豁免条目带 by/date/reason；**双向防腐**：白名单里的僵尸条目（文件已不在面 B）同样判红。
//   4) **fail-closed**：git 列表拿不到 / SUITES 块解析不出 / 面 A 为空 ⇒ 一律判红，绝不静默跳过
//      （静默跳过 = 把缺口换个地方继续藏着，正是本守卫要对付的病）。
//   5) 前提守卫（见 §0.3⑦：排除项必须连它的前提一起守）：面 B 得以豁免的前提是「证据脚本不是生产判据」
//      ⇒ 用 S7 断言守这条前提：**面 B 的脚本一律不得被 SUITES 引用**，一旦被引用就说明它其实
//      是生产判据（该移出证据目录或改走面 A），而不是继续豁免。
//
// 运行：node tools/check_suite_coverage.js   （由 verify_all.js 的 [suite-coverage] 套件调用）

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = 'verify_all.js';

// 面 A：生产判据脚本（命名前缀 = 判据身份；放错目录/改错名字都会被这条抓出来）
const FACE_A_DIRS = [
  { dir: 'tools',                        re: /^(check_|verify_|selftest_|test_).*\.(js|py)$/ },
  { dir: 'specs/dev-specs/prototype',    re: /^(check_|verify_|test_).*\.(js|py)$/ },
  { dir: 'cloudfunctions/common/__tests__', re: /^.*\.js$/ },
];
const FACE_A_CF = /^cloudfunctions\/[^/]+\/selftest\.js$/;

// 面 B：证据目录里的判据类脚本（取证件，须逐条 EXEMPT）
const FACE_B = /^review\/evidence\/.+/;
const FACE_B_NAME = /(^|\/)(check_|verify_|selftest_|test_)[^/]*\.(js|py)$/;

// 豁免白名单（面 B）—— 取证脚本，非生产判据；改动须带 by/date/reason，且双向防腐
const EXEMPT = {
  'review/evidence/batch8c_verify_20260918/verify_8c_all.js':
    { by: 'round60', date: '2026-09-20', reason: 'batch8c 批次验收的一次性取证脚本，非生产判据' },
  'review/evidence/ui_fix_20260918/verify_ui_fix.js':
    { by: 'round60', date: '2026-09-20', reason: 'R91 UI 缺陷修复的一次性取证脚本，非生产判据' },
  'review/evidence/index_buildout_20260917/scripts/verify_fields.py':
    { by: 'round60', date: '2026-09-20', reason: '索引建库期字段核对的一次性取证脚本，非生产判据' },
  'review/evidence/index_buildout_20260917/scripts/verify_indexes2.py':
    { by: 'round60', date: '2026-09-20', reason: '索引建库期索引核对的一次性取证脚本，非生产判据' },
};

function gitTracked() {
  // 🔴 必须 `-c core.quotepath=false`：git 默认把 CJK 路径输出成八进制转义，
  //    面 A/面 B 一旦出现 CJK 文件名就会「解析不到 ⇒ 不在扫描面 ⇒ 静默零覆盖」
  //    （round61 由 check_suite_count_claims 的变异 M3 抓出同款病后回溯修到此处）。
  return execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}

// 只取 `const SUITES = [ ... ];` 这一段 —— 全文件扫会把 R59 的"收尾期望值"映射里的路径也算成引用，
// 从而让"只在收尾映射里出现、并未真正挂 SUITES"的脚本被误判为已覆盖 ⇒ 守卫当场失明。
function suitesBlock() {
  const src = fs.readFileSync(path.join(ROOT, RUNNER), 'utf8');
  const start = src.indexOf('const SUITES = [');
  if (start < 0) return null;
  const end = src.indexOf('\n];', start);
  if (end < 0) return null;
  return src.slice(start, end);
}

(function main() {
  const pass = [];
  const bad = [];
  // ⚠️ check() 必须当场打印 ✅/❌：verify_all.js 的 R66 审计要求「每个段标题下至少一个 ✅」。
  const check = (name, ok, detail) => {
    (ok ? pass : bad).push(name + (detail ? ' · ' + detail : ''));
    console.log((ok ? '✅ ' : '❌ ') + name + (detail ? ' · ' + detail : ''));
  };

  console.log('===== S1 前置：git 列表可用（fail-closed）=====');
  let files = [];
  try {
    files = gitTracked();
  } catch (e) {
    check('S1 能在仓库根执行 git ls-files', false, String(e.message || e));
    console.log('\n===== SUITES 覆盖守卫结果：0 通过 / 1 失败 =====');
    process.exit(1);
  }
  check('S1 能在仓库根执行 git ls-files', files.length > 0, '跟踪文件 ' + files.length + ' 个');

  console.log('\n===== S2 前置：SUITES 块可解析（fail-closed）=====');
  const block = suitesBlock();
  const suites = [];
  if (block) {
    const re = /'([A-Za-z0-9_./-]+\.(?:js|py))'/g;
    let m;
    while ((m = re.exec(block)) !== null) suites.push(m[1]);
  }
  check('S2 ' + RUNNER + ' 的 SUITES 块解析成功', !!block && suites.length > 0,
    block ? 'SUITES 条目 ' + suites.length + ' 个' : '未找到 const SUITES = [ ... ];');
  if (!block || !suites.length) {
    console.log('\n===== SUITES 覆盖守卫结果：' + pass.length + ' 通过 / ' + bad.length + ' 失败 =====');
    process.exit(1);
  }

  console.log('\n===== S3 前置：面 A 扫描结果非空（fail-closed）=====');
  const faceA = [];
  for (const f of files) {
    if (FACE_A_CF.test(f)) { faceA.push(f); continue; }
    for (const d of FACE_A_DIRS) {
      const prefix = d.dir + '/';
      if (f.startsWith(prefix)) {
        const base = f.slice(prefix.length);
        if (!base.includes('/') && d.re.test(base)) { faceA.push(f); break; }
      }
    }
  }
  faceA.sort();
  check('S3 面 A（生产判据脚本）非空', faceA.length > 0, '面 A 共 ' + faceA.length + ' 个');
  if (!faceA.length) {
    console.log('   ❌ 扫描面为空 ⇒ 扫描规则或目录结构已变，守卫失去意义（不许当通过）');
    console.log('\n===== SUITES 覆盖守卫结果：' + pass.length + ' 通过 / ' + bad.length + ' 失败 =====');
    process.exit(1);
  }

  console.log('\n===== S4 判据本体存在：SUITES 引用的文件不得缺失 =====');
  const missing = suites.filter((s) => !fs.existsSync(path.join(ROOT, s)));
  check('S4 SUITES 引用的 ' + suites.length + ' 个文件全部存在', missing.length === 0,
    missing.length ? '缺失：' + missing.join(', ') : '零缺失');

  console.log('\n===== S5 覆盖：面 A 每个判据都已挂进 SUITES =====');
  // 间接引用：读 SUITES 里存在的脚本源码，按**相对路径**找（不用 basename，见文件头设计要点 2）
  let indirectSrc = '';
  for (const s of suites) {
    const fp = path.join(ROOT, s);
    if (s.endsWith('.js') && fs.existsSync(fp)) {
      try { indirectSrc += fs.readFileSync(fp, 'utf8') + '\n'; } catch (_) { /* 读不了就不算间接 */ }
    }
  }
  const orphan = [];
  for (const f of faceA) {
    if (suites.includes(f)) continue;          // 直接引用
    if (indirectSrc.includes(f)) continue;     // 间接引用（被某 SUITES 脚本按其路径调用）
    orphan.push(f);
  }
  check('S5 面 A ' + faceA.length + ' 个判据零漏网', orphan.length === 0,
    orphan.length ? '未挂 SUITES：' + orphan.join(', ') : '全部已挂（含间接包装）');

  console.log('\n===== S6 证据目录：面 B 判据类脚本须逐条豁免 =====');
  const faceB = files.filter((f) => FACE_B.test(f) && FACE_B_NAME.test(path.basename(f)));
  const notExempt = faceB.filter((f) => !EXEMPT[f]);
  check('S6 面 B ' + faceB.length + ' 个取证脚本全部在豁免清单内', notExempt.length === 0,
    notExempt.length ? '未登记豁免：' + notExempt.join(', ') : '全部已登记');
  if (notExempt.length) {
    console.log('   ⚠️ 新增取证脚本请补 EXEMPT（带 by/date/reason）；若它其实是生产判据，应移出证据目录改走面 A。');
  }

  console.log('\n===== S7 双向防腐：豁免清单无僵尸条目 =====');
  const zombie = Object.keys(EXEMPT).filter((f) => !faceB.includes(f));
  check('S7 豁免清单 ' + Object.keys(EXEMPT).length + ' 条无僵尸', zombie.length === 0,
    zombie.length ? '已不在面 B：' + zombie.join(', ') : '条目 ≡ 面 B');

  console.log('\n===== S8 前提守卫：被豁免的证据脚本不得被 SUITES 引用 =====');
  // 面 B 之所以能豁免，前提是「它不是生产判据」。这条断言守住这个前提本身
  // （§0.3⑦：每写一条排除，同时写一条断言守住它成立的前提）。
  const invoked = faceB.filter((f) => suites.includes(f));
  check('S8 面 B 零个脚本被 SUITES 引用', invoked.length === 0,
    invoked.length ? '实为生产判据、不该豁免：' + invoked.join(', ') : '前提成立');

  const failN = bad.length;
  console.log('\n===== SUITES 覆盖守卫结果：' + pass.length + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) {
    bad.forEach((b) => console.log('   ❌ ' + b));
    console.log('\n修复指引：');
    console.log('  1) S5 红（有判据没挂 SUITES）：在 verify_all.js 的 SUITES 末尾追加一项，');
    console.log('     并同步头部注释「// 串联：N 个套件」（R59 守卫会校验 N ≡ SUITES.length）；');
    console.log('     .py 判据不能直接挂（runner 只跑 node），需写薄包装 .js 并在其中按相对路径调用它。');
    console.log('  2) S6 红：新取证脚本补 EXEMPT（by/date/reason）；S7 红：删除已失效的豁免条目。');
    console.log('  3) S8 红：该脚本已被当生产判据用 ⇒ 移出 review/evidence/ 并挂进 SUITES，不要继续豁免。');
  }
  process.exit(failN === 0 ? 0 : 1);
})();
