// review/evidence/r298w_idem/mutate_idem.js
// 用法：node mutate_idem.js <1|2|3|4>   —— 对 common/idempotency.js 做单点变异（配套 mutation_proof_idem.sh）
//   ⚠️ 只改一处、替换未命中即 exit(2)（防"变异没生效却判成判据无效"）。
const fs = require('fs');
const path = require('path');
const P = path.resolve(__dirname, '..', '..', '..', 'cloudfunctions', 'common', 'idempotency.js');
const c = process.argv[2];
let s = fs.readFileSync(P, 'utf8');
let out = s;

if (c === '1') {
  // 键分隔符 `__` → `_`（键格式漂移）
  out = s.replace('`${shopId}__${clientRequestId}`', '`${shopId}_${clientRequestId}`');
} else if (c === '2') {
  // 键忽略 shopId（⇒ 跨店串台：别人提交过的 crid 让你被判重复）
  out = s.replace('`${shopId}__${clientRequestId}`', '`${clientRequestId}`');
} else if (c === '3') {
  // checkIdempotent 无条件判重复（不再查库）
  out = s.replace('  return !!(dup && dup.data && dup.data.length > 0);', '  return true;');
} else if (c === '4') {
  // findPriorResult 返回整行而非 after_data（空 after_data 也返回半个对象）
  out = s.replace('  return (row && row.after_data) ? row.after_data : null;', '  return row || null;');
} else {
  console.error('unknown case: ' + c);
  process.exit(3);
}

if (out === s) { console.error('MUT_NOT_APPLIED (case ' + c + ')'); process.exit(2); }
fs.writeFileSync(P, out);
console.log('mutated case ' + c);
