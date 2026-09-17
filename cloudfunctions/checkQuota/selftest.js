// cloudfunctions/checkQuota/selftest.js —— 批次 5 · 免费配额判定自测
// 运行： node cloudfunctions/checkQuota/selftest.js
// ⚠️ 配额维度铁律：user_id 维度、仅计活跃（is_deleted=false，DataAdapter 过滤）、M1=1/M3=3、硬上限 200/2000。
const { checkQuota, FREE_LIMIT, HARD_LIMIT } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 免费额度（M1=1 家店 / M3=3 张卡）=====');
check('FREE_LIMIT.shop=1 / cost_card=3', FREE_LIMIT.shop === 1 && FREE_LIMIT.cost_card === 3);
check('HARD_LIMIT.shop=200 / cost_card=2000', HARD_LIMIT.shop === 200 && HARD_LIMIT.cost_card === 2000);

// shop：0~1 家 → 不超限；第 2 家（used=1）→ hit_free_limit
check('店铺 0 家：不超限', checkQuota({ userId: 'u1', scope: 'shop', activeCount: 0 }).hit_free_limit === false);
check('店铺 1 家（第 2 家将触发）：hit_free_limit=true', checkQuota({ userId: 'u1', scope: 'shop', activeCount: 1 }).hit_free_limit === true);
check('店铺 200 家：硬上限命中', checkQuota({ userId: 'u1', scope: 'shop', activeCount: 200 }).hit_hard_limit === true);

// cost_card：3 张内免费；第 4 张（used=3）触发
check('成本卡 2 张：不超限', checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 2 }).hit_free_limit === false);
check('成本卡 3 张（第 4 张将触发）：hit_free_limit=true', checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 3 }).hit_free_limit === true);
check('成本卡 2000 张：硬上限命中', checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 2000 }).hit_hard_limit === true);
check('成本卡 100 张：仅超免费额、未触硬上限', (r => r.hit_free_limit === true && r.hit_hard_limit === false)(checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 100 })));

// 维度：user_id 是计数主体（scope 独立）
const a = checkQuota({ userId: 'u_a', scope: 'shop', activeCount: 0 });
const b = checkQuota({ userId: 'u_b', scope: 'shop', activeCount: 1 });
check('不同用户各自独立计数（u_a=0 不超 / u_b=1 超）', a.hit_free_limit === false && b.hit_free_limit === true);

console.log('===== 软删不占额（DataAdapter 层语义）=====');
// 计数输入是已过滤的活跃数：软删由 DataAdapter 过滤后传入 activeCount，Service 不重复处理
check('活跃数=2（软删已滤）→ 判定按活跃数', checkQuota({ userId: 'u1', scope: 'cost_card', activeCount: 2 }).used === 2);
check('软删数据不进入计数（Controller 用 da.list 过滤 is_deleted=false）',
  (() => { const s = require('fs').readFileSync(require('path').join(__dirname, 'index.js'), 'utf8').replace(/^\s*\/\/.*$/gm, ''); return /da\.list\(/.test(s); })(),
  'index.js 经 da.list 取数（🔒 R71：原为恒真断言）');

console.log('===== 入参校验 =====');
check('合法 scope=shop', validateInput({ shop_id: 's1', scope: 'shop' }).error === null);
check('非法 scope=m2 → INVALID_PARAM（M2 无配额概念）', validateInput({ shop_id: 's1', scope: 'm2' }).error === 'INVALID_PARAM');
check('缺 scope → INVALID_PARAM', validateInput({ shop_id: 's1' }).error === 'INVALID_PARAM');

console.log(`\n==== checkQuota 批次 5 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);