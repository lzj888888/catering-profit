// cloudfunctions/manageShop/selftest.js —— R194 · 店铺管理（新建 / 重命名 / 删除）自测
// 运行：node cloudfunctions/manageShop/selftest.js
//
// 验收范式（R57 立约）：**纯函数层行为断言**（validate / service，可直接 require）
//   + **index.js 源码形状断言**（index 含 `require('wx-server-sdk')`，纯 node 加载不了）。
// 🔴 额度值一律**注入驱动**，本文件不钉死任何数字（同 checkQuota/selftest.js 手法）。
const fs = require('fs');
const path = require('path');
const S = require('./service');
const { validateInput, OPS, NAME_MAX } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const LIM = { shop: 1, hard_shop: 200 };
const LIM3 = { shop: 3, hard_shop: 200 };

console.log('===== 入参校验（validate，纯函数）=====');
check('合法 create 通过', validateInput({ op: 'create', name: '小面馆' }).error === null);
check('create 缺 name → INVALID_PARAM', validateInput({ op: 'create' }).error === 'INVALID_PARAM');
check('非法 op → INVALID_PARAM', validateInput({ op: 'drop', name: 'x' }).error === 'INVALID_PARAM');
check('rename 缺 target_shop_id → INVALID_PARAM', validateInput({ op: 'rename', name: 'x' }).error === 'INVALID_PARAM');
check('name 超长（' + (NAME_MAX + 1) + ' 字）→ INVALID_PARAM', validateInput({ op: 'create', name: 'x'.repeat(NAME_MAX + 1) }).error === 'INVALID_PARAM');
check('name 逐步退到上限内即通过（边界成对）', validateInput({ op: 'create', name: 'x'.repeat(NAME_MAX) }).error === null);
check('delete 不需要 name 也通过', validateInput({ op: 'delete', target_shop_id: 's1' }).error === null);
check('name 首尾空格被 trim（不写进库）', validateInput({ op: 'create', name: '  小面馆  ' }).name === '小面馆');
check('全空格 name 视为空 → INVALID_PARAM', validateInput({ op: 'create', name: '   ' }).error === 'INVALID_PARAM');
check('缺 client_request_id ⇒ 空串（不炸）', validateInput({ op: 'create', name: 'x' }).input.client_request_id === '');
check('OPS 恰好三个（create/rename/delete 不多不少）', OPS.length === 3 && OPS.join(',') === 'create,rename,delete');

console.log('\n===== 新建额度判定（decideCreate，注入值驱动）=====');
const c0 = S.decideCreate({ used: 0, limits: LIM });
const c1 = S.decideCreate({ used: 1, limits: LIM });
check('used=0 / free_limit=1 ⇒ 放行', c0.hit_free_limit === false, 'free=' + c0.free_limit);
check('used=1 / free_limit=1 ⇒ 拦（第 2 家触发付费墙）', c1.hit_free_limit === true, 'free=' + c1.free_limit);
const c1b = S.decideCreate({ used: 1, limits: LIM3 });
check('同一 used=1 在 free_limit=3 下放行（正负互证：结论随注入值变）', c1b.hit_free_limit === false && c1.hit_free_limit === true);
check('达 hard_shop ⇒ hit_hard_limit', S.decideCreate({ used: 200, limits: LIM }).hit_hard_limit === true);
check('未达 hard_shop 时不误报硬上限', S.decideCreate({ used: 199, limits: LIM }).hit_hard_limit === false);
let threwNoLimits = false;
try { S.decideCreate({ used: 0 }); } catch (e) { threwNoLimits = (e && e.code === 'SYSTEM_ERROR'); }
check('缺 limits ⇒ 抛 SYSTEM_ERROR（响亮失败，不静默放行）', threwNoLimits);
let threwNoShopKey = false;
try { S.decideCreate({ used: 0, limits: { hard_shop: 200 } }); } catch (e) { threwNoShopKey = (e && e.code === 'SYSTEM_ERROR'); }
check('limits 缺 shop 键 ⇒ 抛 SYSTEM_ERROR', threwNoShopKey);

console.log('\n===== 删除边界（decideDelete）：只要还有活跃店就允许删，删光 = 释放额度 =====');
const d2 = S.decideDelete({ activeCount: 2 });
const d1 = S.decideDelete({ activeCount: 1 });
const d3 = S.decideDelete({ activeCount: 3 });
check('2 家 ⇒ 允许删且剩 1 家', d2.allowed === true && d2.remaining === 1);
// 🔴 R208 更正：旧断言写「1 家 ⇒ 不允许删」，与 `TERMS.exp.deleteConfirm` 承诺的「删除后不再占用额度」
//   直接矛盾，且把免费档（限额 1 家）永久锁死 ⇒ 改判：**允许删，删完剩 0 家 = 额度已释放**。
check('1 家 ⇒ 允许删且剩 0 家（R208：免费额度随之释放，可再建）', d1.allowed === true && d1.remaining === 0, 'remaining=' + d1.remaining);
check('3 家 ⇒ 允许删且剩 2 家', d3.allowed === true && d3.remaining === 2);
check('0 家（异常态）⇒ 不允许删（fail-closed，避免幽灵删除）', S.decideDelete({ activeCount: 0 }).allowed === false);

console.log('\n===== 构造：确定性 _id 与文档形状 =====');
const idA1 = S.buildCreateShopId('u_1', 'crid_abc');
const idA2 = S.buildCreateShopId('u_1', 'crid_abc');
const idB = S.buildCreateShopId('u_1', 'crid_xyz');
check('同 (user, crid) ⇒ 同 _id（幂等由构造保证的基石）', idA1 === idA2 && idA1.length > 0, idA1);
check('不同 crid ⇒ 不同 _id', idA1 !== idB);
check('不同 user ⇒ 不同 _id', S.buildCreateShopId('u_2', 'crid_abc') !== idA1);
check('无 crid ⇒ 空串（调用方退化为 genId，不做幂等约束）', S.buildCreateShopId('u_1', '') === '');
const doc = S.buildShopDoc({ _id: idA1, userId: 'u_1', name: '小面馆', now: 111 });
check('文档 _id ≡ id ≡ shop_id（三键同值，防「业务主键≠_id」重演）', doc._id === idA1 && doc.id === idA1 && doc.shop_id === idA1);
check('文档 is_deleted=false（新建即可见）', doc.is_deleted === false);
check('文档带 created_at/updated_at', doc.created_at === 111 && doc.updated_at === 111);
const patch = S.buildRenamePatch({ name: '新名', now: 222 });
check('重命名补丁只含 name + updated_at（不顺手清备注/业态）', Object.keys(patch).sort().join(',') === 'name,updated_at');
check('重命名补丁值正确', patch.name === '新名' && patch.updated_at === 222);

console.log('\n===== index.js 源码形状（含 wx-server-sdk，只能静态断言）=====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
check('目标店字段用 target_shop_id（api.js 会注入当前店 shop_id，不能拿它当目标）', /target_shop_id/.test(src) && !/v\.shop_id/.test(src));
check('rename/delete 都先做归属校验（assertShopOwner）', (src.match(/assertShopOwner\s*\(/g) || []).length === 1 && /owner\.error/.test(src));
check('归属校验失败即返回（判据用 .error，与 auth.js 返回形状一致）', /if\s*\(owner\.error\)\s*return\s+fail\(/.test(src));
check('删除走软删 da.softDelete（绝不物理删除）', /da\.softDelete\(\s*'shop'/.test(src));
check('无物理删除调用（collection.remove 零命中）', !/collection\('shop'\)[\s\S]{0,40}\.remove\(/.test(src));
check('写库主键优先用 _id（owner.data._id）', /owner\.data\s*&&\s*\(owner\.data\._id/.test(src));
check('写库 0 行必 fail-loud（stats.updated 判据 ≥ 2 处：rename + delete）', (src.match(/stats\.updated/g) || []).length >= 2);
check('创建额度计数走 countActive（软删不占额）', /da\.countActive\('shop'/.test(src));
check('三个 op 都留痕（writeAudit ≥ 3 处）', (src.match(/writeAudit\(db,/g) || []).length >= 3);
check('幂等：rename/delete 走 findPriorResult + shopKey', /findPriorResult\(db,\s*target,\s*crid\)/.test(src) && /shopKey\(target,\s*crid\)/.test(src));
check('create 幂等：撞 _id 即回读（isDuplicateKeyError）', /isDuplicateKeyError\(e\)/.test(src));
check('额度真相源读 feature_permissions 而非硬编码数字', /collection\('feature_permissions'\)/.test(src) && !/shop:\s*1\b/.test(src));
check('三个 op 的错误码语义在场（FREE_LIMIT_EXCEEDED / HARD_CAP_EXCEEDED / INVALID_PARAM）',
  /FREE_LIMIT_EXCEEDED/.test(src) && /HARD_CAP_EXCEEDED/.test(src) && /INVALID_PARAM/.test(src));
check('鉴权是本函数第一条业务动作（resolveAuth 在 validateInput 之前）',
  src.indexOf('resolveAuth(') > -1 && src.indexOf('resolveAuth(') < src.indexOf('validateInput('));

// ⚠️ 按**调用形态**计数（`await assertShopOwner(`）—— 裸 `assertShopOwner` 会被本文件的注释命中
const dup = (src.match(/await\s+assertShopOwner\s*\(/g) || []).length;
check('源码里归属校验只写一次（rename/delete 共用一段，不是两段各写一遍）', dup === 1, dup + ' 处调用');

console.log('\n==== manageShop R194 自测结果：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
