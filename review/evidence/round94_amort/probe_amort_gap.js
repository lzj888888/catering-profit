// _probe_amort_gap.js —— round94 只读实证：残值/处置损失是否进入利润链路
// 不改任何业务代码；直接 require 三个云函数的**纯计算** service（无 wx-server-sdk 依赖）
const P = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/cloudfunctions/';
const am = require(P + 'calcAmortize/service.js');
const led = require(P + 'saveLedger/service.js');
const gas = require(P + 'getAmortSchedule/service.js');

console.log('=== 导出面 ===');
console.log('calcAmortize/service      :', Object.keys(am).join(', '));
console.log('saveLedger/service        :', Object.keys(led).join(', '));
console.log('getAmortSchedule/service  :', Object.keys(gas).join(', '));
console.log('');

// 场景：门面装修 12 万元 / 12 期 / 2026-01 起（自然到期 2026-12）/ 2026-06 提前报废
const A = {
  asset_id: 'a1', name: '门面装修',
  total_value: 12000000,          // 120,000.00 元（分）
  start_month: '2026-01', total_months: 12, terminate_month: '2026-06',
};
console.log('=== 场景 ===');
console.log('原值 120,000.00 元｜12 期｜2026-01 起｜2026-06 提前报废');
console.log('月摊 base = 12000000/12 =', Math.round(12000000 / 12), '分 = 10000.00 元');
console.log('已摊 6 期 = 60000.00 元；未摊余额（残值）应为 60000.00 元 = 6000000 分');
console.log('');

// ① 产出侧：calcAmortize 引擎（POC1 锚点）
const full = am.calcAmortize([A], '2026-06');
console.log('=== ① calcAmortize（产出侧） ===');
console.log('total_amount_fen =', full.total_amount_fen, '=', full.total_amount_fen / 100, '元');
console.log('details =', JSON.stringify(full.details));
const d0 = (full.details || [])[0] || {};
console.log('→ details[0].residual_loss =', d0.residual_loss, '分 =', (d0.residual_loss || 0) / 100, '元');

// 直调残值函数（若导出）
if (typeof am.calcResidualFen === 'function') {
  console.log('→ calcResidualFen(A) =', am.calcResidualFen(A), '分 =', am.calcResidualFen(A) / 100, '元');
} else {
  console.log('→ calcResidualFen 未导出（仅内部用）');
}
console.log('');

// ② 入账侧：saveLedger 实际落库用的引擎
console.log('=== ② saveLedger（入账侧·真实落库） ===');
console.log('amountForMonth(2026-06)        =', led.amountForMonth(A, '2026-06'), '分');
console.log('amortizeTotalForMonth(2026-06) =', led.amortizeTotalForMonth([A], '2026-06'), '分');
console.log('amortizeTotalForMonth(2026-07) =', led.amortizeTotalForMonth([A], '2026-07'), '分（终止次月=0，符合规则）');
console.log('');

// ③ 页面侧：getAmortSchedule 用的引擎
console.log('=== ③ getAmortSchedule（页面侧） ===');
const s = gas.amortizeForMonth([A], '2026-06');
console.log('amortizeForMonth(2026-06) =', JSON.stringify(s));
console.log('');

// ④ 利润：把 ② 的摊销额喂进利润引擎，检查是否有残值项
console.log('=== ④ 利润链路（saveLedger 内嵌 calcMonthlyProfit） ===');
const INCOME = 5000000;   // 50,000 元
const DIRECT = 1000000;   // 10,000 元
const amFen = led.amortizeTotalForMonth([A], '2026-06');
const pf = led.calcMonthlyProfit({
  incomeItems: [{ amountFen: INCOME }], expenseItems: [],
  directConsumeFen: DIRECT, amortizeFen: amFen,
  amortizeSwitchOn: true, inventorySwitchOn: false, inventory: {},
});
console.log('收入 50000｜直接消耗 10000｜摊销(实传) =', amFen / 100, '元');
console.log('返回字段 =', Object.keys(pf).join(', '));
console.log('全要素真实利润 =', pf.totalFactorRealProfitFen, '分 =', pf.totalFactorRealProfitFen / 100, '元');
console.log('→ 公式核验：50000 − 0 − 10000 − 10000 =', (5000000 - 0 - 1000000 - amFen) / 100, '元');
console.log('→ 若残值 60000 元按规范「一次性计入当期」，利润应为', (5000000 - 0 - 1000000 - amFen - 6000000) / 100, '元');
console.log('→ 差 = 60000.00 元（= 残值全额，未进利润）');
console.log('');

// ⑤ 摊销开关关闭时（口径「一次性计入当月」）资产原值是否有入账通道
console.log('=== ⑤ 摊销开关关闭（口径=一次性计入当月） ===');
const pfOff = led.calcMonthlyProfit({
  incomeItems: [{ amountFen: INCOME }], expenseItems: [],
  directConsumeFen: DIRECT, amortizeFen: led.amortizeTotalForMonth([A], '2026-06'),
  amortizeSwitchOn: false, inventorySwitchOn: false, inventory: {},
});
console.log('effectiveAmortizeFen =', pfOff.effectiveAmortizeFen, '分（开关关 ⇒ 强制 0）');
console.log('全要素真实利润 =', pfOff.totalFactorRealProfitFen / 100, '元');
console.log('→ 同月同一资产，12 万元在利润表里是否出现任何一笔？ amortize=0 且无其他入账字段');
console.log('→ 利润引擎入参字段只有：incomeItems/expenseItems/directConsumeFen/amortizeFen/inventory/pendingSettlementFen');
