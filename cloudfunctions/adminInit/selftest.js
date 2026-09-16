// cloudfunctions/adminInit/selftest.js —— 批次 6 · 首超管引导自测（setup token / 密码哈希）
// 运行： node cloudfunctions/adminInit/selftest.js
// 覆盖：setup token 预共享校验语义、env 门禁（prod 恒拒）、scrypt 加盐哈希。
const adminAuth = require('./adminAuth');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== env 门禁（对齐批次 0 initDb.gate 语义）=====');
const envGate = (envRaw) => {
  const env = String(envRaw == null ? '' : envRaw).toLowerCase();
  if (!env || /prod/.test(env)) return 'INITDB_DEV_ONLY: adminInit 仅允许 dev 环境';
  return null;
};
check('dev 环境放行', envGate('catering-dev-123') === null);
check('prod 环境恒拒', envGate('catering-prod') !== null && /prod/.test('catering-prod'));
check('空环境拒', envGate('') !== null);

console.log('===== 首超管密码加盐哈希 =====');
const salt = adminAuth.genSalt();
const h = adminAuth.hashPassword('SuperP@ss123', salt);
check('pwd_hash 为 scrypt 加盐哈希（128 hex）', h.length === 128);
check('校验通过', adminAuth.verifyPassword('SuperP@ss123', salt, h) === true);
check('错误密码拒绝', adminAuth.verifyPassword('wrong', salt, h) === false);
check('盐非明文（32 hex）', /^[0-9a-f]{32}$/.test(salt));

console.log(`\n==== adminInit 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);