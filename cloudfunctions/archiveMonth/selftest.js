// cloudfunctions/archiveMonth/selftest.js —— 批次 4 · M1 结账归档入参校验自测
// 运行： node cloudfunctions/archiveMonth/selftest.js
const { validateInput } = require('./validate');
let pass = 0, failN = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); } else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); } }

const ok = validateInput({ shop_id: 's1', month: '2026-09' });
check('合法入参放行（archive 缺省 true）', ok.error === null && ok.month === '2026-09' && ok.archive === true);
check('archive=false → 取消归档', validateInput({ shop_id: 's1', month: '2026-09', archive: false }).archive === false);
check('month 坏格式拒', validateInput({ shop_id: 's1', month: '2026-9' }).error === 'INVALID_PARAM');
check('month 越界拒', validateInput({ shop_id: 's1', month: '2026-13' }).error === 'INVALID_PARAM');
check('缺 shop_id 拒', validateInput({ month: '2026-09' }).error === 'INVALID_PARAM');

console.log(`\n==== archiveMonth 批次 4 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);