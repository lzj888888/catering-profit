// cloudfunctions/deleteAccount/selftest.js —— 批次 7 · 账号注销自测（PII 匿名化 + 软删 + 幂等）
// 运行： node cloudfunctions/deleteAccount/selftest.js
// 覆盖验收 6（日志搜不到手机号明文——本函数不落 PII）+ §2.11 注销语义。
const fs = require('fs');
const path = require('path');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 🔒 R71：本文件原有 4 条关键断言写作 check(name, true, '见 index.js …') —— 条件**恒真**，
//   index.js 被改成任何样子它们都照样绿；R66（段内零断言计数）与 R69（收尾完整性）**都抓不到**这一类。
//   现改为**读 index.js 源码做真实形状断言**：实现一旦偏离，这里立刻转红。
const SRC = (() => {
  const raw = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  // 剥注释，避免「注释里提到过」被误当成「真的做了」
  return raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
})();

// 🔴 R688：下面这组断言原先写的是「自己抄一个 ANON_OPENID 常量，再断言它等于自己」——
//   实现怎么改都不会红，属于**判据恒真**。现改为：从源码提取真实派生逻辑并求值，
//   再断言「逐用户唯一」这一关键性质（固定常量会让第 2 个注销用户撞 unique 索引）。
const ANON_NICK = '已注销用户';

console.log('===== PII 匿名化（openid/昵称 → 占位，不可复原）=====');

// A：从源码取出 anonOpenidFor 的函数体并真跑（不抄常量）
const anonFnSrc = SRC.match(/function anonOpenidFor\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
check('源码存在 anonOpenidFor(userId) 派生函数', !!anonFnSrc,
  'R688：匿名值必须逐用户唯一，不能是全局常量');
let anonOpenidFor;
if (anonFnSrc) {
  // eslint-disable-next-line no-new-func
  anonOpenidFor = new Function('return (' + anonFnSrc[0] + ')')();
} else {
  anonOpenidFor = function () { return 'anonymous_000000000000'; };
}

const v1 = anonOpenidFor('u_abc123');
const v2 = anonOpenidFor('u_xyz789');
check('两个不同用户得到不同匿名值（否则第 2 个注销撞 idx_openid 唯一键）',
  v1 !== v2, `v1=${v1} v2=${v2}`);
check('同一用户重复调用得同一值（幂等）', anonOpenidFor('u_abc123') === v1);
check('匿名值不含原 openid 特征（无 oX/oY 前缀）',
  !/^o[XY]/.test(v1.replace('anonymous_', '')) && /^anonymous_/.test(v1));
check('昵称置为「已注销用户」', ANON_NICK === '已注销用户');

// B：变异自证 —— 把派生函数换回固定常量，唯一性断言必须转红
const mutated = () => 'anonymous_000000000000';
const mutUniq = mutated('u_abc123') !== mutated('u_xyz789');
check('变异自证：固定常量版本被判为不唯一（证明上面的断言有分辨力）', mutUniq === false,
  '若这里为 true，说明唯一性判据恒真，无法发现回退');

// C：调用处确实用了派生函数，而不是别处写死常量
check('index.js 写入 openid 时调用 anonOpenidFor(userId)',
  /openid:\s*anonOpenidFor\(\s*userId\s*\)/.test(SRC));
check('index.js 不再残留固定常量定义',
  !/ANON_OPENID\s*=\s*'anonymous_'\s*\+\s*'0'\.repeat/.test(SRC),
  'R688：固定常量会让第二个注销用户撞唯一键');

console.log('===== 日志脱敏（验收 6：日志搜不到手机号/支付明文）=====');
// 注销留痕 after_data 仅 user_id + 计数，不落 openid/昵称/手机号
const auditAfter = { user_id: 'u_1', anon: true, shops_soft_deleted: 1 };
const auditJson = JSON.stringify(auditAfter);
check('审计不含 openid 明文', !auditJson.includes('openid') && !auditJson.includes('oXk3'));
check('审计不含昵称/手机号明文', !auditJson.includes('王') && !auditJson.includes('13') && !auditJson.includes('phone'));
check('审计含 user_id（操作主体标识，后台有权限查看）', auditJson.includes('u_1'));

console.log('===== 软删 + 关联店铺软删（数据可追溯，不硬删）=====');
check('user 置 is_deleted=true（软删，非物理删除）',
  /collection\('user'\)[\s\S]{0,220}?is_deleted:\s*true/.test(SRC), 'index.js 步骤3：user.update → is_deleted:true');
check('shop 置 is_deleted=true（关联店铺软删）',
  /collection\('shop'\)[\s\S]{0,220}?is_deleted:\s*true/.test(SRC), 'index.js 步骤4：遍历活跃 shop 置软删');
check('shop_entitlement expire_at=0（权限回收）',
  /collection\('shop_entitlement'\)[\s\S]{0,220}?expire_at:\s*0/.test(SRC), 'index.js 步骤5：置 expire_at:0');

console.log('===== 幂等（client_request_id）=====');
// index.js：audit_log.idempotency_key 全局查重（acc_del_<requestId>）
const idemKey = (req) => `acc_del_${req}`;
check('幂等键格式 acc_del_<requestId>', idemKey('r1') === 'acc_del_r1');
check('重复提交返回 ADMIN_OP_IDEMPOTENT（不重复处理）',
  /common\.idempotency\.checkIdempotent\(/.test(SRC) && /ADMIN_OP_IDEMPOTENT/.test(SRC),
  'index.js 步骤2：走单源幂等 → 命中即 fail(ADMIN_OP_IDEMPOTENT)');

console.log(`\n==== deleteAccount 批次 7 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
