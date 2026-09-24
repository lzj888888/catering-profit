// cloudfunctions/checkQuota/selftest.js —— 批次 5 / M3.22 批次 A1 · 免费配额判定自测
// 运行： node cloudfunctions/checkQuota/selftest.js
// ⚠️ M3.22 改造：额度**不再硬编码**（FREE_LIMIT/HARD_LIMIT 常量已删除，本文件不钉死任何额度值）。
//   改为**注入值驱动正负互证**：同一 activeCount 在不同 limits 下结论必须不同；
//   并补「缺 limits ⇒ 响亮失败 SYSTEM_ERROR」。
const { checkQuota } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 注入值驱动（正负互证：同一 activeCount 在不同 limits 下结论不同）=====');
// limits_A：cost_card 免费额 = 5；limits_B：cost_card 免费额 = 2
const LA = { shop: 1, cost_card: 5, hard_shop: 200, hard_card: 2000 };
const LB = { shop: 1, cost_card: 2, hard_shop: 200, hard_card: 2000 };

// activeCount = 3：在 LA（额度5）下未超限，在 LB（额度2）下已超限
const a3 = checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 3, limits: LA });
const b3 = checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 3, limits: LB });
check('activeCount=3 在 cost_card=5 下不超限', a3.hit_free_limit === false, `free=${a3.free_limit}`);
check('activeCount=3 在 cost_card=2 下超限（正负互证）', b3.hit_free_limit === true, `free=${b3.free_limit}`);
check('判定随注入值变化（同一 activeCount 两结论不同）', a3.hit_free_limit !== b3.hit_free_limit);

// activeCount = 5：在 LA 下恰好触发（第 6 张被拦），free_limit 出参 = 5
const a5 = checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 5, limits: LA });
check('activeCount=5 在 cost_card=5 下 hit_free_limit（第 6 张触发）', a5.hit_free_limit === true && a5.free_limit === 5, `free=${a5.free_limit}`);
check('activeCount=4 在 cost_card=5 下未超限（放行）', checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 4, limits: LA }).hit_free_limit === false);

// shop 维度：1 家免费额（M1 不变），注入值驱动
const s0 = checkQuota({ userId: 'u1', scope: 'shop', activeCount: 0, limits: LA });
const s1 = checkQuota({ userId: 'u1', scope: 'shop', activeCount: 1, limits: LA });
check('shop 0 家不超限 / 1 家超限（free_limit=1 注入）', s0.hit_free_limit === false && s1.hit_free_limit === true && s1.free_limit === 1);

console.log('===== 硬上限（注入值驱动）=====');
check('cost_card 达 hard_card=2000 命中硬上限', checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 2000, limits: LA }).hit_hard_limit === true);
check('shop 达 hard_shop=200 命中硬上限', checkQuota({ userId: 'u1', scope: 'shop', activeCount: 200, limits: LA }).hit_hard_limit === true);
check('cost_card 100 仅超免费额、未触硬上限', (r => r.hit_free_limit === true && r.hit_hard_limit === false)(checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 100, limits: LA })));

console.log('===== 缺配置 ⇒ 响亮失败（不静默放行）=====');
let threwMissing = false;
try { checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 3 }); } catch (e) { threwMissing = (e && e.code === 'SYSTEM_ERROR'); }
check('不传 limits ⇒ 抛 SYSTEM_ERROR', threwMissing);
let threwNull = false;
try { checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 3, limits: null }); } catch (e) { threwNull = (e && e.code === 'SYSTEM_ERROR'); }
check('limits=null ⇒ 抛 SYSTEM_ERROR', threwNull);
let threwPartial = false;
try { checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 3, limits: { shop: 1, cost_card: 5 } }); } catch (e) { threwPartial = (e && e.code === 'SYSTEM_ERROR'); }
check('limits 缺 hard_card ⇒ 抛 SYSTEM_ERROR（缺任一额度即响亮失败）', threwPartial);

console.log('===== 维度：不同用户各自独立（scope 独立）=====');
const ua = checkQuota({ userId: 'u_a', scope: 'shop', activeCount: 0, limits: LA });
const ub = checkQuota({ userId: 'u_b', scope: 'shop', activeCount: 1, limits: LA });
check('不同用户各自独立计数', ua.hit_free_limit === false && ub.hit_free_limit === true);

console.log('===== 软删不占额（DataAdapter 层语义）=====');
check('活跃数按 DataAdapter 过滤后传入（Service 不重复处理软删）', checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 2, limits: LA }).used === 2);

console.log('===== 入参校验 =====');
check('合法 scope=shop', validateInput({ shop_id: 's1', scope: 'shop' }).error === null);
check('非法 scope=m2 → INVALID_PARAM', validateInput({ shop_id: 's1', scope: 'm2' }).error === 'INVALID_PARAM');
check('缺 scope → INVALID_PARAM', validateInput({ shop_id: 's1' }).error === 'INVALID_PARAM');

console.log(`\n==== checkQuota 批次 5/A1 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);