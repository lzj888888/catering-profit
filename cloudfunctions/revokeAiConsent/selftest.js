// cloudfunctions/revokeAiConsent/selftest.js —— AI 撤回（写）自测
// 运行： node cloudfunctions/revokeAiConsent/selftest.js
//
// 覆盖两头：
//   ① **行为面**（真跑纯函数）：三态判定（无授权 / 本次撤回 / 已撤回过）/ 撤回原因只收客户端语义；
//   ② **接线面**（剥注释后静态判定）：撤回**不刷新**已撤回的时间戳、按 `consent_id` 清派生数据、
//      清不干净必须显式 `clear_pending`、幂等早于首个写。
const fs = require('fs');
const path = require('path');
const { validateInput } = require('./validate');
const { CLIENT_REASONS, revokeState, normalizeReason, auditSnapshot } = require('./service');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 1. 三态判定（撤回是终态：已撤回不许刷新时间）=====');
check('无记录 → no_consent', revokeState(null) === 'no_consent');
check('revoked_at=0 → 本次撤回', revokeState({ revoked_at: 0 }) === 'revoked');
check('revoked_at>0 → 已撤回', revokeState({ revoked_at: 1700000000000 }) === 'already_revoked');
check('revoked_at 缺失（存量行）→ 按未撤回处理', revokeState({ consent_id: 'c' }) === 'revoked');
check('revoked_at 非数字 → 按未撤回处理（不把脏值当已撤）', revokeState({ revoked_at: 'x' }) === 'revoked');

console.log('\n===== 2. 撤回原因只收客户端语义 =====');
check('缺省 → user', normalizeReason(undefined).reason === 'user' && normalizeReason(undefined).error === null);
check('空串 → user', normalizeReason('').reason === 'user');
check('user 合法', normalizeReason('user').error === null);
check('🔴 expire 拒收（服务端语义）', normalizeReason('expire').error !== null, normalizeReason('expire').error);
check('🔴 admin 拒收（客户端不得伪造管理员撤回）', normalizeReason('admin').error !== null);
check('非字符串拒收', normalizeReason(1).error !== null);
check('客户端原因白名单只有 user', CLIENT_REASONS.length === 1 && CLIENT_REASONS[0] === 'user');

console.log('\n===== 3. 入参校验 =====');
const okBase = validateInput({ shop_id: 's1', client_request_id: 'c1' });
check('基线合法且 reason 归一 user', okBase.error === null && okBase.reason === 'user');
check('shop_id 缺失拒收', validateInput({}).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 空串拒收', validateInput({ shop_id: '' }).error === ERROR_CODES.INVALID_PARAM);
check('非法 reason 透传为 INVALID_PARAM', validateInput({ shop_id: 's1', reason: 'hack' }).error === ERROR_CODES.INVALID_PARAM);
check('client_request_id 非字符串拒收', validateInput({ shop_id: 's1', client_request_id: 5 }).error === ERROR_CODES.INVALID_PARAM);
check('不传 client_request_id 合法（幂等可缺省）', validateInput({ shop_id: 's1' }).input.client_request_id === '');

console.log('\n===== 4. 审计快照 =====');
const snap = auditSnapshot({ consent_id: 'con_1', user_id: 'u1', shop_id: 's1', scope: ['pricing'], revoked_at: 5 });
check('快照含 consent_id / scope / revoked_at', snap.consent_id === 'con_1' && snap.scope[0] === 'pricing' && snap.revoked_at === 5);
check('🔴 快照不含 user_id / shop_id', !('user_id' in snap) && !('shop_id' in snap));
check('无记录 → null', auditSnapshot(null) === null);

console.log('\n===== 5. 接线面（剥注释后静态判定）=====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
function stripComments(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const code = stripComments(src);
const at = (needle) => code.indexOf(needle);

check('真 require 校验模块', /const\s*\{\s*validateInput\s*\}\s*=\s*require\('\.\/validate'\)/.test(code));
check('鉴权顺序：resolveAuth → assertShopOwner → validateInput',
  at('resolveAuth(') >= 0 && at('resolveAuth(') < at('assertShopOwner(') && at('assertShopOwner(') < at('validateInput('));
const idemAt = at('findPriorResult(');
const firstWrite = Math.min(
  at(".update({") >= 0 ? at(".update({") : Number.MAX_SAFE_INTEGER,
  at(".remove(") >= 0 ? at(".remove(") : Number.MAX_SAFE_INTEGER
);
check('🔴 幂等预检早于首个业务写', idemAt >= 0 && idemAt < firstWrite, `idem@${idemAt} write@${firstWrite}`);
check('幂等键走单源 shopKey', /idempotency_key:\s*common\.idempotency\.shopKey\(/.test(code));
// ⚠️ 判据不能钉「.doc(x._id || ...)」这一种写法：本文件用的是 `const rid = row._id || row.id` 再 `.doc(rid)`
//   （与 saveShopSetting 同形态）。钉字面量会把正确实现判红 —— 这正是 R297 那条教训。
check('写库用权威主键 `_id`（或由 `_id` 派生的局部变量）',
  /const\s+rid\s*=\s*\w+\._id\s*\|\|\s*\w+\.id/.test(code) && /\.doc\(rid\)/.test(code));
check('判 `stats.updated`', /stats\s*&&\s*\w+\.stats\.updated/.test(code));
check('🔴 已撤回不刷新时间戳：update 被 `state === \'revoked\'` 守着',
  /if\s*\(state\s*===\s*'revoked'\)/.test(code) && at("if (state === 'revoked')") < at('.update({'));
check('🔴 派生数据按 `consent_id` 定位清除（不是按 shop_id —— 那会误删别条授权的结论）',
  /collection\(INSIGHT_COLL\)\.where\(\{\s*consent_id:\s*consentId\s*\}\)\.remove\(\)/.test(code)
  && !/collection\(INSIGHT_COLL\)\.where\(\{\s*shop_id/.test(code));
check('分层清理有轮数上限（防云函数 20s 超时）', /MAX_CLEAR_ROUNDS/.test(code));
check('🔴 清不干净显式降级：出参带 clear_pending', /clear_pending:\s*pending/.test(code));
check('清理异常不吞掉（catch 里置 pending）', /catch\s*\(e\)\s*\{[\s\S]{0,200}?pending\s*=\s*true/.test(code));
check('无 consent_id 时不按 shop_id 扩大删除面（置 pending 如实上报）',
  /if\s*\(!consentId\)\s*\{[\s\S]{0,160}?pending\s*=\s*true/.test(code));
check('审计写 before_data + after_data 双态', /before_data:/.test(code) && /after_data:/.test(code));
check('重放时 replayed 改写为 true', /replayed:\s*true/.test(code));

console.log(`\n==== revokeAiConsent 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
