// cloudfunctions/getAmortSchedule/selftest.js —— 批次 4 · 摊销引擎自测（S3 末月尾差倒挤）
// 运行： node cloudfunctions/getAmortSchedule/selftest.js
const { amortizeForMonth, amountForMonth } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const YUAN = 100;
const decor = { asset_id: 'decor', name: '装修', total_value: 120000 * YUAN, start_month: '2026-01', total_months: 36, terminate_month: '' };
const freezer = { asset_id: 'fr', name: '冰柜', total_value: 6000 * YUAN, start_month: '2026-06', total_months: 60, terminate_month: '' };

check('装修 2026-01 当月即摊 3,333.33', amountForMonth(decor, '2026-01') === 333333);
check('装修 2028-12 末月尾差倒挤 = 3,333.45', amountForMonth(decor, '2028-12') === 333345, `=${amountForMonth(decor, '2028-12')}`);
check('装修 2029-01 区间外 = 0', amountForMonth(decor, '2029-01') === 0);
const sched = amortizeForMonth([decor, freezer], '2026-08');
check('2026-08 合计 = 装修3333.33 + 冰柜100 = 3,433.33', sched.total_amount_fen === 343333, `=${sched.total_amount_fen}`);
check('details 含 2 资产', sched.details.length === 2, `=${sched.details.length}`);
check('validateInput 合法月放行', validateInput({ shop_id: 's1', month: '2026-08' }).error === null);
check('validateInput 坏月拒', validateInput({ shop_id: 's1', month: '2026-13' }).error === 'INVALID_PARAM');

console.log(`\n==== getAmortSchedule 批次 4 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);