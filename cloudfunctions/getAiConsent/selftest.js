// cloudfunctions/getAiConsent/selftest.js —— AI 授权（读侧）自测
// 运行： node cloudfunctions/getAiConsent/selftest.js
//
// 覆盖两头：
//   ① **行为面**（真跑纯函数）：状态四态穷尽 / 撤回优先于过期 / `expire_at=0` 不是过期 /
//      边界（到点那一毫秒仍可用）/ 条款版本不一致时**能力必须为空** / 出参键集合精确（不外泄 user_id）；
//   ② **接线面**（剥注释后静态判定）：真 require 纯函数并真调用 / 真鉴权 + 真归属校验 /
//      **读函数零写库**（没有 insert/update/remove）/ 不写审计 / 无记录也走 `ok`（不把正常态报成错）。
//
// 🔴 静态判据一律先剥注释：本仓踩过"注释里写着函数名 ⇒ 删掉实现判据照绿"（R299 ③型）。
const fs = require('fs');
const path = require('path');
const { validateInput } = require('./validate');
const { POLICY_VERSION, STATES, judgeState, effectiveScopes, buildState } = require('./service');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 固定"现在"，让过期判据可复现（不读系统时间）
const NOW = 1790000000000;
const DAY = 24 * 60 * 60 * 1000;
const rec = (over) => Object.assign({
  consent_id: 'con_1', user_id: 'u1', shop_id: 's1', scope: ['diagnose', 'pricing'],
  policy_version: POLICY_VERSION, granted_at: NOW - 10 * DAY, expire_at: 0, revoked_at: 0, revoke_reason: '',
}, over || {});

console.log('===== 1. 状态四态穷尽 =====');
check('无记录 ⇒ none', judgeState(null, NOW).state === 'none');
check('无记录 ⇒ has_record=false', judgeState(null, NOW).has_record === false);
check('正常记录 ⇒ active', judgeState(rec(), NOW).state === 'active');
check('revoked_at>0 ⇒ revoked', judgeState(rec({ revoked_at: NOW - DAY }), NOW).state === 'revoked');
check('过期 ⇒ expired', judgeState(rec({ expire_at: NOW - DAY }), NOW).state === 'expired');
check('🔴 四态都落在 STATES 枚举内（没有第五种、也不许 undefined）',
  [judgeState(null, NOW), judgeState(rec(), NOW), judgeState(rec({ expire_at: NOW - DAY }), NOW),
    judgeState(rec({ revoked_at: NOW - DAY }), NOW)].every((x) => STATES.indexOf(x.state) >= 0));

console.log('\n===== 2. 边界与优先级（判错会把"他自己撤的"说成"到期了"）=====');
check('🔴 撤回 + 过期同时成立 ⇒ revoked（不是 expired）',
  judgeState(rec({ revoked_at: NOW - 2 * DAY, expire_at: NOW - DAY }), NOW).state === 'revoked');
check('🔴 expire_at=0 ⇒ 不自动过期（不能当"已过期"）',
  judgeState(rec({ expire_at: 0 }), NOW).state === 'active');
check('🔴 恰好到点（now === expire_at）仍可用（严格大于才过期）',
  judgeState(rec({ expire_at: NOW }), NOW).state === 'active');
check('到点后 1ms ⇒ expired', judgeState(rec({ expire_at: NOW - 1 }), NOW).state === 'expired');
check('revoked_at=0 且 expire_at 有未来值 ⇒ active',
  judgeState(rec({ revoked_at: 0, expire_at: NOW + DAY }), NOW).state === 'active');

console.log('\n===== 3. 实际可用能力（功能开关用，不是回显用）=====');
check('active + 条款一致 ⇒ effective_scope = 记录 scope',
  JSON.stringify(effectiveScopes(rec(), 'active', POLICY_VERSION)) === '["diagnose","pricing"]');
check('🔴 过期 ⇒ effective_scope 为空（记录 scope 还在，但不能用）',
  effectiveScopes(rec(), 'expired', POLICY_VERSION).length === 0);
check('🔴 撤回 ⇒ effective_scope 为空', effectiveScopes(rec(), 'revoked', POLICY_VERSION).length === 0);
check('无记录 ⇒ effective_scope 为空', effectiveScopes(null, 'none', POLICY_VERSION).length === 0);
check('🔴 条款升级（记录 v1 / 当前 v2）⇒ effective_scope 为空（写侧要求重同意，读侧不能说还能用）',
  effectiveScopes(rec(), 'active', 'ai-consent-v2').length === 0);
check('🔴 脏数据 scope 非数组 ⇒ 空数组（不因"应该不会为空"就放行）',
  effectiveScopes(rec({ scope: 'diagnose' }), 'active', POLICY_VERSION).length === 0);
check('返回值是副本（改它不污染原记录）', (function () {
  const d = rec();
  const out = effectiveScopes(d, 'active', POLICY_VERSION);
  out.push('expand');
  return d.scope.length === 2;
})());

console.log('\n===== 4. 出参形状（键集合精确 = 不多回一个敏感字段）=====');
const b = buildState(rec(), 's1', NOW);
const keys = Object.keys(b).sort().join(',');
const expectKeys = ['consent_id', 'effective_scope', 'expire_at', 'granted_at', 'has_record', 'need_regrant',
  'policy_stale', 'policy_version', 'policy_version_now', 'revoke_reason', 'revoked_at', 'scope', 'shop_id', 'state'].sort().join(',');
check('🔴 出参键集合与预期**全等**（新增字段必须同步本断言）', keys === expectKeys, keys);
check('🔴 出参不含 user_id（少一个敏感字段就少一个外泄面）', !('user_id' in b));
check('active ⇒ need_regrant=false', b.need_regrant === false);
check('active ⇒ policy_stale=false', b.policy_stale === false);
const stale = buildState(rec({ policy_version: 'ai-consent-v0' }), 's1', NOW);
check('🔴 条款过期（v0）⇒ policy_stale=true 且 need_regrant=true 且 effective 为空',
  stale.policy_stale === true && stale.need_regrant === true && stale.effective_scope.length === 0);
const noneB = buildState(null, 's1', NOW);
check('无记录 ⇒ need_regrant=true（首次必须弹授权页）', noneB.need_regrant === true);
check('无记录 ⇒ 时间字段是 0 不是 undefined（前端不用写三个空值分支）',
  noneB.granted_at === 0 && noneB.expire_at === 0 && noneB.revoked_at === 0 && noneB.consent_id === '');
check('revoked ⇒ need_regrant=true 且 revoke_reason 原样带回',
  buildState(rec({ revoked_at: NOW - DAY, revoke_reason: 'user' }), 's1', NOW).revoke_reason === 'user');
check('🔴 scope 与 effective_scope 是两个字段、语义不同（回显 vs 功能开关）',
  'scope' in b && 'effective_scope' in b && b.scope !== b.effective_scope);

console.log('\n===== 5. 入参校验 =====');
check('合法 shop_id 通过', validateInput({ shop_id: 's1' }).error === null);
check('缺 shop_id 拒收', validateInput({}).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 空串拒收', validateInput({ shop_id: '' }).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 非字符串拒收', validateInput({ shop_id: 1 }).error === ERROR_CODES.INVALID_PARAM);
check('🔴 不做 trim（与写侧逐字一致；否则写入带空格后读不到自己刚写的记录）',
  validateInput({ shop_id: ' s1 ' }).shop_id === ' s1 ');

console.log('\n===== 6. 接线面（剥注释后静态判定）=====');

/** 剥注释：等长空格替换，保留换行（不剥 ⇒ 注释能喂饱判据，R299 ③型）。 */
function stripComments(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
/** 取函数**定义体**（`name(` 前字符非 `.`，且 `{` 早于 `;`）。找不到 ⇒ ''。 */
function defBodyOf(src, name) {
  const s = String(src || '');
  let i = 0;
  while (i < s.length) {
    const k = s.indexOf(name + '(', i);
    if (k < 0) return '';
    const prev = k > 0 ? s.charAt(k - 1) : '';
    if (prev !== '.') {
      const open = s.indexOf('{', k);
      const semi = s.indexOf(';', k);
      if (open > k && (semi < 0 || open < semi)) {
        let depth = 0;
        for (let j = open; j < s.length; j++) {
          if (s.charAt(j) === '{') depth++;
          else if (s.charAt(j) === '}') { depth--; if (depth === 0) return s.slice(open, j + 1); }
        }
      }
    }
    i = k + name.length;
  }
  return '';
}

const idxSrc = stripComments(fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8'));
const mainBody = defBodyOf(idxSrc, 'exports.main') || idxSrc;

check('真 require service.js（不是注释里提到）', /require\(\s*'\.\/service'\s*\)/.test(idxSrc));
check('🔴 真调用 buildState（锚在 main 函数体内）', mainBody.indexOf('buildState(') >= 0);
check('真 require validate.js 并真调用', /require\(\s*'\.\/validate'\s*\)/.test(idxSrc) && mainBody.indexOf('validateInput(') >= 0);
check('真鉴权：resolveAuth + 取返回值判 error',
  /=\s*await\s+resolveAuth\(/.test(mainBody) && /auth\.error/.test(mainBody));
check('🔴 真归属校验：`= await assertShopOwner(`（不是探针式裸调）',
  /=\s*await\s+assertShopOwner\(/.test(mainBody));
check('无记录也走 ok（"没授权"是正常态，不是错误）',
  /return\s+ok\(\s*buildState\(/.test(mainBody) && !/row\s*\?\s*ok|if\s*\(!\s*row\s*\)\s*return\s+fail/.test(mainBody));

console.log('\n===== 7. 读函数必须零写（这是本轮最容易越界的地方）=====');
const WRITE_CALLS = ['da.insert(', 'da.update(', 'da.remove(', '.add({', '.update({ data:', '.remove(', '.set({'];
const hit = WRITE_CALLS.filter((w) => idxSrc.indexOf(w) >= 0);
check('🔴 index.js 不含任何写库调用', hit.length === 0, hit.join(' | ') || 'zero');
check('🔴 不写审计（页面每次打开都调本函数，写审计会把 audit_log 冲成噪声）', idxSrc.indexOf('writeAudit(') < 0);
check('🔴 不声明 client_request_id（否则会被幂等守卫当作写函数）', idxSrc.indexOf('client_request_id') < 0);
check('不声明幂等键（读操作没有"重放"语义）', idxSrc.indexOf('idempotency') < 0);
check('只读单集合 shop_ai_consent（不顺手扫 shop_ai_insight）',
  idxSrc.indexOf("'shop_ai_consent'") >= 0 && idxSrc.indexOf('shop_ai_insight') < 0);

console.log(`\n==== getAiConsent 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
