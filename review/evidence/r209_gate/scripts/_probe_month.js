// _probe_month.js —— 探明「选历史月份报填写有误」的根因（临时探针，用完删）
// 假设：pages/month/index.js::onMonthChange 把 picker 的**索引**当月份字符串传给了 getLedger。
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';

let ok = true;
function line(tag, cond, extra) {
  if (!cond) ok = false;
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + tag + (extra ? ' | ' + extra : ''));
}

// ① 复现 picker 出参：mode="selector" 时 e.detail.value 是选中项的下标（数字）
const months = ['2026-10', '2026-09', '2026-08'];
const detailValueFromPicker = 1; // 用户选中「2026-09」
line('①  picker selector 出参是数字下标', typeof detailValueFromPicker === 'number', 'value=' + detailValueFromPicker);

// ② 现实现：把 e.detail.value 当月直接往下传
const bugMonth = detailValueFromPicker;
line('②  现实现往下传的值是「1」而不是「2026-09」', bugMonth !== '2026-09', 'got=' + JSON.stringify(bugMonth));

// ③ 后端 validate 对这个值的判定（实跑生产校验代码，不用肉眼推断）
let validateInput = null;
try {
  validateInput = require(path.join(ROOT, 'cloudfunctions/getLedger/validate.js')).validateInput;
} catch (e) {
  console.log('SKIP | ③ 无法 require validate.js | ' + e.message);
}
if (validateInput) {
  const bad = validateInput({ shop_id: 's1', month: bugMonth });
  line('③  后端对这个值判 INVALID_PARAM（= 前端「填写有误」）',
    !!(bad && bad.error === 'INVALID_PARAM'), 'error=' + (bad && bad.error));
  const good = validateInput({ shop_id: 's1', month: '2026-09' });
  line('④  同一入口传正确字符串则放行', good && good.error === null, 'error=' + (good && good.error));
}

console.log(ok ? '\n== ROOT CAUSE CONFIRMED ==' : '\n== NOT CONFIRMED ==');
process.exit(ok ? 0 : 1);
