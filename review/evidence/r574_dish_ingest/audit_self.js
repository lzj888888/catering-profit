// -*- 用 verify_all.js 里的 R66/R69 判据原文，自检本套件的 stdout 是否合规 -*-
// 起因：首行标题写成 `===== x =====` 段标题形态 ⇒ R66 报「段标题下零断言」。
// 做法：直接取 verify_all.js 的判据源码片段 eval，避免抄第二份判据（抄了就会漂移）。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const NODE = process.execPath;
const REL = 'tools/check_dish_ingest_contract.js';

const src = fs.readFileSync(path.join(ROOT, 'verify_all.js'), 'utf8');
const at = src.indexOf('const SECTION_HEAD');
const end = src.indexOf('let failed = 0;');
if (at < 0 || end < 0) { console.log('❌ 取不到判据片段'); process.exit(1); }
eval(src.slice(at, end));

const out = execFileSync(NODE, [path.join(ROOT, REL)], { cwd: ROOT, encoding: 'utf8' });
const a = auditAssertions(out, REL);
console.log('段数 =', a.sections);
console.log('✅ 总数 =', a.total);
console.log('零断言段 =', JSON.stringify(a.zero));
console.log('R69 收尾 =', a.tail);
const pass = a.zero.length === 0 && a.tail && a.total > 0;
console.log(pass ? '\n✅ R66/R69 自检通过' : '\n❌ 仍不合规');
process.exit(pass ? 0 : 1);
