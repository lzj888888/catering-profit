// cloudfunctions/grantAiConsent/selftest.js —— AI 授权（写）自测
// 运行： node cloudfunctions/grantAiConsent/selftest.js
//
// 覆盖两头：
//   ① **行为面**（真跑纯函数）：scope 的能力粒度语义 / 未知能力拒收 / 去重与稳定顺序 /
//      有效期三态（缺省 0 / 已过期拒绝 / 超上限拒绝）；
//   ② **接线面**（剥注释后静态判定）：幂等早于首个写、写库用权威 `_id`、`stats.updated` 必判、
//      「已有记录就覆盖、不新建」这个一店一份的前提没有被人改回"每次 insert"。
//
// 🔴 静态判据一律先剥注释：本仓踩过"注释里写着函数名 ⇒ 删掉实现判据照绿"（R299 ③型）。
const fs = require('fs');
const path = require('path');
const { validateInput } = require('./validate');
const { SCOPES, POLICY_VERSION, normalizeScopes, checkExpire, auditSnapshot } = require('./service');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 固定"现在"，让有效期判据可复现（不读系统时间）
const NOW = 1790000000000;
const base = { shop_id: 's1', scope: ['diagnose'], policy_version: POLICY_VERSION, client_request_id: 'c1' };

console.log('===== 1. scope 是能力粒度，不是布尔（设计稿 §0 前提）=====');
check('测试基线合法', validateInput(Object.assign({}, base), NOW).error === null);
check('scope=list 合法且保留', JSON.stringify(validateInput(Object.assign({}, base, { scope: ['diagnose', 'pricing'] }), NOW).scope) === '["diagnose","pricing"]');
const boolScope = validateInput(Object.assign({}, base, { scope: true }), NOW);
check('🔴 scope=true（布尔）必须拒收', boolScope.error === ERROR_CODES.INVALID_PARAM && /数组/.test(boolScope.msg), boolScope.msg);
check('scope 缺省（undefined）同样拒收', validateInput(Object.assign({}, base, { scope: undefined }), NOW).error === ERROR_CODES.INVALID_PARAM);
check('scope=[] 拒收（空授权不该落"已授权"记录）', validateInput(Object.assign({}, base, { scope: [] }), NOW).error === ERROR_CODES.INVALID_PARAM);
const unknown = validateInput(Object.assign({}, base, { scope: ['diagnose', 'sell_all'] }), NOW);
check('🔴 未知能力拒收（不静默丢弃）', unknown.error === ERROR_CODES.INVALID_PARAM && /未知能力/.test(unknown.msg), unknown.msg);
check('scope 含非字符串拒收', validateInput(Object.assign({}, base, { scope: ['diagnose', 1] }), NOW).error === ERROR_CODES.INVALID_PARAM);

console.log('\n===== 2. 去重与稳定顺序 =====');
const dup = validateInput(Object.assign({}, base, { scope: ['pricing', 'diagnose', 'pricing'] }), NOW);
check('重复项去重', JSON.stringify(dup.scope) === '["diagnose","pricing"]', JSON.stringify(dup.scope));
const revOrder = validateInput(Object.assign({}, base, { scope: ['expand', 'diagnose'] }), NOW);
check('顺序按声明序归一（勾选顺序不同 ≠ 两种授权）', JSON.stringify(revOrder.scope) === '["diagnose","expand"]', JSON.stringify(revOrder.scope));
check('空白项被 trim', JSON.stringify(validateInput(Object.assign({}, base, { scope: [' diagnose '] }), NOW).scope) === '["diagnose"]');

console.log('\n===== 3. 条款版本（旧同意不得覆盖新条款）=====');
check('policy_version 缺省拒收', validateInput(Object.assign({}, base, { policy_version: undefined }), NOW).error === ERROR_CODES.INVALID_PARAM);
const pvBad = validateInput(Object.assign({}, base, { policy_version: 'ai-consent-v0' }), NOW);
check('🔴 版本不匹配拒收且提示当前版本', pvBad.error === ERROR_CODES.INVALID_PARAM && pvBad.msg.indexOf(POLICY_VERSION) >= 0, pvBad.msg);

console.log('\n===== 4. 有效期三态 =====');
check('缺省 → 0（不自动过期）', validateInput(Object.assign({}, base), NOW).expire_at === 0);
check('显式 0 → 0', validateInput(Object.assign({}, base, { expire_at: 0 }), NOW).expire_at === 0);
check('未来时间保留', validateInput(Object.assign({}, base, { expire_at: NOW + 86400000 }), NOW).expire_at === NOW + 86400000);
const past = checkExpire(NOW - 1, NOW);
check('🔴 已过期时间拒收（不许落"出生即过期"的授权）', past.error !== null, past.error);
check('超 10 年上限拒收', checkExpire(NOW + 11 * 365 * 86400000, NOW).error !== null);
check('非整数拒收', checkExpire(1.5, NOW).error !== null);
check('负数拒收', checkExpire(-1, NOW).error !== null);
check('字符串拒收', checkExpire('123', NOW).error !== null);

console.log('\n===== 5. 审计快照不夹带无关字段 =====');
const snap = auditSnapshot({ consent_id: 'con_1', user_id: 'u1', shop_id: 's1', scope: ['diagnose'], policy_version: POLICY_VERSION, granted_at: 1, expire_at: 0, revoked_at: 0, revoke_reason: '', secret_note: 'x' });
check('快照含授权面字段', snap.consent_id === 'con_1' && snap.scope.length === 1 && snap.policy_version === POLICY_VERSION);
check('🔴 快照不含 user_id / shop_id / 其它字段（审计表只增不删，不复制无关信息）',
  !('user_id' in snap) && !('shop_id' in snap) && !('secret_note' in snap));
check('无记录 → null', auditSnapshot(null) === null);
const snapDoc = { consent_id: 'c', scope: ['diagnose'] };
const snapCopy = auditSnapshot(snapDoc);
snapCopy.scope.push('pricing');
check('scope 是副本（改快照不污染原记录）', snapDoc.scope.length === 1);

console.log('\n===== 6. 接线面（剥注释后静态判定）=====');
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
const idemAt = at("findPriorResult(");
const firstWrite = Math.min(
  at("da.insert(") >= 0 ? at("da.insert(") : Number.MAX_SAFE_INTEGER,
  at(".update({ data:") >= 0 ? at(".update({ data:") : Number.MAX_SAFE_INTEGER
);
check('🔴 幂等预检早于首个业务写（写完再查等于没查）', idemAt >= 0 && firstWrite !== Number.MAX_SAFE_INTEGER && idemAt < firstWrite,
  `idem@${idemAt} write@${firstWrite}`);
check('幂等键走单源 shopKey（不自己拼串）', /idempotency_key:\s*common\.idempotency\.shopKey\(/.test(code));
check('写库用权威主键 `_id`（round116：业务键未必等于 _id）', /\.doc\((\w+)\._id\s*\|\|/.test(code));
check('🔴 判 `stats.updated`（云开发 update 失败不抛异常）', /stats\s*&&\s*\w+\.stats\.updated/.test(code));
check('🔴 一店一份：有记录走 update、无记录才 insert',
  /if\s*\(row\)\s*\{/.test(code) && (code.match(/da\.insert\(COLL/g) || []).length === 1);
check('并发唯一键冲突被识别（isDuplicateKeyError）并转覆盖', /isDuplicateKeyError\(/.test(code));
check('重新授权把 revoked_at 归 0（撤过还能再开）', /revoked_at:\s*0/.test(code));
check('重放时把 replayed 改写成 true（否则会把重放当新授权数）', /replayed:\s*true/.test(code));
check('审计写 after_data + before_data 双态（铁律 8）', /before_data:/.test(code) && /after_data:/.test(code));
check('出参不夹带 user_id', !/user_id:\s*userId,\s*\n\s*consent_id/.test(code.split('const result =')[1] || ''));

console.log(`\n==== grantAiConsent 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
