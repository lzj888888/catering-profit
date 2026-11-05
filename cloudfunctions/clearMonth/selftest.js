// cloudfunctions/clearMonth/selftest.js —— M1 清空某月 · 入参校验自测
// 运行： node cloudfunctions/clearMonth/selftest.js
const { validateInput } = require('./validate');
let pass = 0, failN = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); } else { failN++; console.log('❌ ' + name + '  (' + detail + ')'); } }

const ok1 = validateInput({ shop_id: 's1', month: '2026-09', confirm: true });
check('合法入参放行', ok1.error === null && ok1.month === '2026-09');
check('缺 confirm 拒（破坏性操作不接受默认）', validateInput({ shop_id: 's1', month: '2026-09' }).error === 'INVALID_PARAM');
check('confirm=false 拒', validateInput({ shop_id: 's1', month: '2026-09', confirm: false }).error === 'INVALID_PARAM');
check('month 坏格式拒', validateInput({ shop_id: 's1', month: '2026-9', confirm: true }).error === 'INVALID_PARAM');
check('month 越界拒', validateInput({ shop_id: 's1', month: '2026-13', confirm: true }).error === 'INVALID_PARAM');
check('缺 shop_id 拒', validateInput({ month: '2026-09', confirm: true }).error === 'INVALID_PARAM');

console.log(`\n==== clearMonth 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
