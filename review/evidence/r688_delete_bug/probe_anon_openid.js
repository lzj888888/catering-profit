// review/evidence/r688_delete_bug/probe_anon_openid.js
// 目的：验证「第二个用户注销必失败」是否成立。
// 不连真云（会污染数据），改为：从单源读取 (a) ANON_OPENID 常量 (b) user 表 openid 索引唯一性，
// 再模拟两次注销后的 openid 分布，断言是否出现重复值。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
let pass = 0, fail = 0;
const ok = (id, m) => { console.log('  ✅ ' + id + ' ' + m); pass++; };
const no = (id, m) => { console.log('  ❌ ' + id + ' ' + m); fail++; };

// A-① 取 ANON_OPENID 实际定义（源码字面量，不是注释）
const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions/deleteAccount/index.js'), 'utf8');
const m = src.match(/const ANON_OPENID\s*=\s*([^;]+);/);
if (!m) { no('A-①', '未找到 ANON_OPENID 定义'); process.exit(1); }
const expr = m[1].trim();
// 在隔离作用域里求值（表达式是 'anonymous_' + '0'.repeat(12) 这类纯字面量拼接）
// eslint-disable-next-line no-new-func
const anonValue = new Function('return (' + expr + ')')();
ok('A-①', 'ANON_OPENID = ' + JSON.stringify(anonValue) + '  （源码：' + expr + '）');

// A-② 它是常量还是每用户唯一？判据：表达式中不含任何 per-user 变量
const isPerUser = /user_?id|userId|openid|_id|Date|now|random|Math/.test(expr);
if (isPerUser) ok('A-②', '按用户唯一化（含变量）');
else no('A-②', '是**全局固定常量** —— 所有注销用户会写成同一个值');

// A-③ user 表 openid 索引是否唯一
const { INDEXES } = require(path.join(ROOT, 'cloudfunctions/initDb/collections.js'));
const idx = (INDEXES.user || []).find((i) => i.name === 'idx_openid');
if (!idx) no('A-③', 'idx_openid 未定义');
else if (idx.unique === true) ok('A-③', 'idx_openid unique=true（库层强制 openid 不重复）');
else no('A-③', 'idx_openid 非唯一，本 bug 不成立（需复核）');

// B-① 模拟两次注销：用户 A、B 各有一条 user 记录，注销后 openid 都写 anonValue
const users = [
  { user_id: 'u_aaa', openid: 'real_openid_A' },
  { user_id: 'u_bbb', openid: 'real_openid_B' },
];
const after = users.map((u) => ({ user_id: u.user_id, openid: anonValue }));
const vals = after.map((u) => u.openid);
const dup = vals.length !== new Set(vals).size;
if (dup) ok('B-①', '两个用户注销后 openid 值重复 ⇒ 第 2 次 update 必被唯一索引拒绝');
else no('B-①', '无重复，bug 不成立');

// B-② 变异自证：把 anonValue 换成按用户唯一，重复应消失（证明判据不是恒真）
const fixed = users.map((u) => ({ openid: anonValue + '_' + u.user_id }));
const fvals = fixed.map((u) => u.openid);
if (fvals.length === new Set(fvals).size) ok('B-②', '变异「加 user_id 后缀」后不再重复 ⇒ B-① 的判据有分辨力');
else no('B-②', '变异无效，B-① 可能恒真');

console.log('\n结论：' + (dup ? 'BUG 成立' : 'BUG 不成立') + '（pass=' + pass + ' fail=' + fail + '）');
process.exit(fail ? 1 : 0);
