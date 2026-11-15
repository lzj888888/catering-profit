// review/evidence/_r743_probeC1.js —— R743 审计体系探针：基线实跑（只读，不改任何现有文件）
// 用法：node review/evidence/_r743_probeC1.js
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const FILES = [
  'tools/check_amort_no_gate.js',
  'tools/check_amort_invariants.js',
  'tools/check_amort_switch_matrix.js',
  'tools/check_amort_display_caliber.js',
  'tools/check_archive_no_fake.js',
  'tools/check_amort_rollforward.js',
  'tools/check_amort_archive_lock.js',
  'tools/check_amortize_page_stub.js',
  'tools/check_archive_switch_snapshot.js',
  'tools/check_archive_grace.js',
];
let anyFail = 0;
for (const rel of FILES) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)],
    { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = (out.match(/✅/g) || []).length;
  const fail = (out.match(/❌/g) || []).length;
  const lines = out.split(/\r?\n/).filter((s) => /通过|失败|结果|合计|异常|PASS|FAIL/.test(s));
  if (r.status !== 0 || fail > 0) anyFail++;
  console.log(`\n=== ${rel} ===\n  exit=${r.status} signal=${r.signal || '-'} err=${r.error ? r.error.code : '-'} ✅=${pass} ❌=${fail}`);
  console.log('  ' + lines.slice(-3).join('\n  '));
}
console.log(`\n[TOTAL] ${FILES.length} 个套件，异常/失败 ${anyFail} 个`);
