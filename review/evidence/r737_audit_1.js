// R737 第一轮交叉审计：数字对账（横向）
// 目的：同一份台账 + 同一个月，四个独立打包的入口必须给出**同一个**摊销额与利润。
// 铁律：不采信注释、不采信上一轮自述；只信 require 进来的真实函数跑出来的数。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { ASSETS, MONTHS, BOOK, EXPECT_AMORT, EXPECT_EFFECTIVE } = require('./r737_fixture');

let pass = 0, fail = 0;
const rows = [];
function ck(id, ok, detail) {
  if (ok) { pass++; } else { fail++; console.log(`❌ ${id} ${detail || ''}`); }
  rows.push({ id, ok, detail });
}

// ===== 四个入口（都是云端独立打包的副本，各 require 各的）=====
const A = require(path.join(ROOT, 'cloudfunctions/calcMonthlyProfit/service.js'));   // 直连云函数
const B = require(path.join(ROOT, 'cloudfunctions/saveLedger/service.js'));          // 写库侧
const C = require(path.join(ROOT, 'cloudfunctions/getLedger/service.js'));           // 回读侧
const D = require(path.join(ROOT, 'cloudfunctions/getAmortSchedule/service.js'));    // 摊销管理页

function yen(fen) { return (fen / 100).toFixed(2); }

// ===== 场景矩阵：开关开 / 关 各跑一遍 =====
const SCEN = [
  { key: 'swOFF', amortizeSwitchOn: false },
  { key: 'swON', amortizeSwitchOn: true },
];

console.log('=== 台账侧应摊额（D 入口 getAmortSchedule）与手算比对 ===');
for (const m of MONTHS) {
  const r = D.amortizeForMonth(ASSETS.filter((a) => a.mode !== 'lump'), m);
  ck(`D-${m} 台账合计 = 手算 ${EXPECT_AMORT[m]}`,
    r.total_amount_fen === EXPECT_AMORT[m],
    `实得 ${r.total_amount_fen} / 应为 ${EXPECT_AMORT[m]}`);
}

console.log('\n=== 横向：三副本引擎 × 五个月 × 两档开关 ===');
const table = [];
for (const s of SCEN) {
  for (const m of MONTHS) {
    const bookAmort = EXPECT_AMORT[m];
    const inp = Object.assign({}, BOOK, {
      month: m,
      amortizeFen: bookAmort,
      amortizeSwitchOn: s.amortizeSwitchOn,
    });
    const ra = A.calcMonthlyProfit(inp);
    const rb = B.calcMonthlyProfit(inp);
    const rc = C.calcMonthlyProfit(inp);
    const exp = EXPECT_EFFECTIVE[m](s.amortizeSwitchOn);
    table.push({
      sw: s.key, month: m,
      A_eff: ra.effectiveAmortizeFen, B_eff: rb.effectiveAmortizeFen, C_eff: rc.effectiveAmortizeFen,
      expect: exp,
      A_profit: ra.totalFactorRealProfitFen, B_profit: rb.totalFactorRealProfitFen, C_profit: rc.totalFactorRealProfitFen,
      A_v2: ra.amortRuleV2, B_v2: rb.amortRuleV2, C_v2: rc.amortRuleV2,
    });
    ck(`X-${s.key}-${m} A(saveLedger 侧同源) 计入额 = ${exp}`,
      ra.effectiveAmortizeFen === exp, `实得 ${ra.effectiveAmortizeFen}`);
    ck(`X-${s.key}-${m} B(saveLedger) 计入额 = ${exp}`,
      rb.effectiveAmortizeFen === exp, `实得 ${rb.effectiveAmortizeFen}`);
    ck(`X-${s.key}-${m} C(getLedger) 计入额 = ${exp}`,
      rc.effectiveAmortizeFen === exp, `实得 ${rc.effectiveAmortizeFen}`);
    ck(`X-${s.key}-${m} 三副本计入额互等`,
      ra.effectiveAmortizeFen === rb.effectiveAmortizeFen && rb.effectiveAmortizeFen === rc.effectiveAmortizeFen,
      `A=${ra.effectiveAmortizeFen} B=${rb.effectiveAmortizeFen} C=${rc.effectiveAmortizeFen}`);
    ck(`X-${s.key}-${m} 三副本真实利润互等`,
      ra.totalFactorRealProfitFen === rb.totalFactorRealProfitFen
      && rb.totalFactorRealProfitFen === rc.totalFactorRealProfitFen,
      `A=${ra.totalFactorRealProfitFen} B=${rb.totalFactorRealProfitFen} C=${rc.totalFactorRealProfitFen}`);
  }
}

console.log('\n把手做的表打出来（元）：');
console.log('开关  月份      A计入      B计入      C计入     应为       A利润        v2');
for (const r of table) {
  console.log([
    r.sw.padEnd(5), r.month.padEnd(8),
    yen(r.A_eff).padStart(9), yen(r.B_eff).padStart(9), yen(r.C_eff).padStart(9),
    yen(r.expect).padStart(9), yen(r.A_profit).padStart(11),
    String(r.A_v2),
  ].join(' '));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
