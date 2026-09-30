// tools/selftest_grade_gate.js —— 批次 F 甲级门禁自测（纯校验，零依赖）
//
// 三门（v1.4 §5.2）：① 通道连通 ② Schema 校验 ③ 关键指标非空
// 每条断言：正常通过 + 每门各至少一个反例（fail-closed）。
//
// 运行：node tools/selftest_grade_gate.js

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const { checkGradeA, SALES_SCHEMA } = require('../utils/gradeGate.js');

const goodInput = {
  platform: 'taobao',
  shopId: 'shop_001',
  rows: [
    { bizDate: '2026-08-01', qty: 10, amountFen: 12345 },
    { bizDate: '2026-08-02', qty: 5, amountFen: 6789 },
  ],
  totals: { amountFen: 19134, qty: 15, rowCount: 2 },
};

console.log('===== 正常通过 =====');
const ok = checkGradeA(goodInput, SALES_SCHEMA);
check('正常输入 → pass=true', ok.pass === true, JSON.stringify(ok.failures));
check('正常输入 → level=A', ok.level === 'A', '');
check('正常输入 → failures 空', ok.failures.length === 0, '');

console.log('===== ① 通道连通反例 =====');
const emptyRows = checkGradeA({ platform: 'taobao', shopId: 's', rows: [], totals: { amountFen: 0, qty: 0, rowCount: 0 } }, SALES_SCHEMA);
check('① rows 空 → pass=false 且报 CHANNEL_EMPTY', emptyRows.pass === false && emptyRows.failures.some((f) => f.code === 'CHANNEL_EMPTY'),
  JSON.stringify(emptyRows.failures));
const noTotal = checkGradeA({ platform: 'taobao', shopId: 's', rows: goodInput.rows, totals: {} }, SALES_SCHEMA);
check('① totals 缺失 → CHANNEL_TOTAL_MISSING', noTotal.pass === false && noTotal.failures.some((f) => f.code === 'CHANNEL_TOTAL_MISSING'), '');

console.log('===== ② Schema 校验反例 =====');
const badPlatform = checkGradeA(Object.assign({}, goodInput, { platform: 'xxx' }), SALES_SCHEMA);
check('② platform 非法 → SCHEMA_PLATFORM', badPlatform.pass === false && badPlatform.failures.some((f) => f.code === 'SCHEMA_PLATFORM'), '');
const badDate = checkGradeA(Object.assign({}, goodInput, { rows: [{ bizDate: '2026/08/01', qty: 1, amountFen: 100 }] }), SALES_SCHEMA);
check('② bizDate 格式错 → SCHEMA_BIZDATE', badDate.pass === false && badDate.failures.some((f) => f.code === 'SCHEMA_BIZDATE'), '');
const badAmount = checkGradeA(Object.assign({}, goodInput, { rows: [{ bizDate: '2026-08-01', qty: 1, amountFen: 12.5 }] }), SALES_SCHEMA);
check('② amountFen 非整数 → SCHEMA_AMOUNT', badAmount.pass === false && badAmount.failures.some((f) => f.code === 'SCHEMA_AMOUNT'), '');
const badQty = checkGradeA(Object.assign({}, goodInput, { rows: [{ bizDate: '2026-08-01', qty: -1, amountFen: 100 }] }), SALES_SCHEMA);
check('② qty 为负 → SCHEMA_QTY', badQty.pass === false && badQty.failures.some((f) => f.code === 'SCHEMA_QTY'), '');

console.log('===== ③ 关键指标非空反例 =====');
const noShop = checkGradeA(Object.assign({}, goodInput, { shopId: '' }), SALES_SCHEMA);
check('③ shop_id 空 → REQUIRED_SHOP_ID', noShop.pass === false && noShop.failures.some((f) => f.code === 'REQUIRED_SHOP_ID'), '');
const emptyBizDate = checkGradeA(Object.assign({}, goodInput, { rows: [{ bizDate: '', qty: 1, amountFen: 100 }] }), SALES_SCHEMA);
check('③ biz_date 空 → REQUIRED_BIZDATE', emptyBizDate.pass === false && emptyBizDate.failures.some((f) => f.code === 'REQUIRED_BIZDATE'), '');

console.log('\n' + '='.repeat(60));
console.log(`===== 甲级门禁自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
