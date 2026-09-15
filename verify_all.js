// verify_all.js —— 仓库根一键串联校验器
// 运行：node verify_all.js
// 串联：8 个套件 = 6 个 specs 套件（门禁 A–L + seed/poc1-4）+ 批次0 代码自测（batch0_selfcheck）+ 静态路径检查（tools/check_requires.js）。
// 用同一个 node（process.execPath）跑子进程，避免多解释器/环境问题。
// ⚠️ 不在 CI 之外假定任何 secrets；纯本地静态 + 单测。

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const NODE = process.execPath; // 当前执行的 node，子进程复用

// [展示名, 相对根的路径]
const SUITES = [
  ['门禁 A-L',            'specs/dev-specs/prototype/check_error_codes.js'],
  ['verify_seed_data',    'specs/dev-specs/prototype/verify_seed_data.js'],
  ['test_poc1',           'specs/dev-specs/prototype/test_poc1.js'],
  ['test_poc2',           'specs/dev-specs/prototype/test_poc2.js'],
  ['test_poc3',           'specs/dev-specs/prototype/test_poc3.js'],
  ['test_poc4',           'specs/dev-specs/prototype/test_poc4.js'],
  ['batch0 代码自测',     'cloudfunctions/common/__tests__/batch0_selfcheck.js'],
  ['静态路径检查',        'tools/check_requires.js'],
  // 后续批次的套件在此追加即可（如 test_poc5、batch1_selfcheck ...）
];

let failed = 0;
for (const [name, rel] of SUITES) {
  const fp = path.join(ROOT, rel);
  process.stdout.write(`\n===== [${name}] ${rel} =====\n`);
  try {
    const out = execFileSync(NODE, [fp], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(out);
    process.stdout.write(`  [${name}] ✅ PASS\n`);
  } catch (e) {
    failed++;
    const why = e.code ? e.code : ('exit=' + e.status);
    process.stdout.write(`  [${name}] ❌ FAIL (${why})\n`);
    if (!e.stdout && !e.stderr) {
      process.stdout.write(`      ↳ 子进程未产出输出：${String(e.message).split('\n')[0]}\n`);
    }
    if (e.stdout) process.stdout.write(e.stdout.toString());
    if (e.stderr) process.stderr.write(e.stderr.toString());
  }
}

process.stdout.write(`\n===== 总览：${SUITES.length - failed}/${SUITES.length} 套件通过 =====\n`);
process.exit(failed === 0 ? 0 : 1);
