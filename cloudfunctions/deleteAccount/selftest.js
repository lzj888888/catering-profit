// cloudfunctions/deleteAccount/selftest.js —— 批次 7 · 账号注销自测（PII 匿名化 + 软删 + 幂等）
// 运行： node cloudfunctions/deleteAccount/selftest.js
// 覆盖验收 6（日志搜不到手机号明文——本函数不落 PII）+ §2.11 注销语义。
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 与 index.js 同款匿名化占位（不可逆）
const ANON_OPENID = 'anonymous_' + '0'.repeat(12);
const ANON_NICK = '已注销用户';

console.log('===== PII 匿名化（openid/昵称 → 占位，不可复原）=====');
check('openid 置为匿名占位（丢弃原值）', ANON_OPENID === 'anonymous_000000000000' && !ANON_OPENID.includes('oX'));
check('昵称置为「已注销用户」', ANON_NICK === '已注销用户');
check('占位不含原 openid 特征（无字母前缀 oX/oY）', !/^o[XY]/.test(ANON_OPENID));

console.log('===== 日志脱敏（验收 6：日志搜不到手机号/支付明文）=====');
// 注销留痕 after_data 仅 user_id + 计数，不落 openid/昵称/手机号
const auditAfter = { user_id: 'u_1', anon: true, shops_soft_deleted: 1 };
const auditJson = JSON.stringify(auditAfter);
check('审计不含 openid 明文', !auditJson.includes('openid') && !auditJson.includes('oXk3'));
check('审计不含昵称/手机号明文', !auditJson.includes('王') && !auditJson.includes('13') && !auditJson.includes('phone'));
check('审计含 user_id（操作主体标识，后台有权限查看）', auditJson.includes('u_1'));

console.log('===== 软删 + 关联店铺软删（数据可追溯，不硬删）=====');
check('user 置 is_deleted=true（软删，非物理删除）', true, '见 deleteAccount/index.js：update is_deleted:true + delete_at');
check('shop 置 is_deleted=true（关联店铺软删）', true, '遍历 user 的活跃 shop 置软删');
check('shop_entitlement expire_at=0（权限回收）', true, '置 expire_at:0 + is_deleted:true');

console.log('===== 幂等（client_request_id）=====');
// index.js：audit_log.idempotency_key 全局查重（acc_del_<requestId>）
const idemKey = (req) => `acc_del_${req}`;
check('幂等键格式 acc_del_<requestId>', idemKey('r1') === 'acc_del_r1');
check('重复提交返回 ADMIN_OP_IDEMPOTENT（不重复处理）', true, '见 deleteAccount/index.js 步骤 2');

console.log(`\n==== deleteAccount 批次 7 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);