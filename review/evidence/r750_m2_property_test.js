// r750_m2_property_test.js —— M2 引擎属性测试（fast-check 思路，自写不引依赖）
// 目的：上轮 59 个固定锚点只验"点"，本脚本用伪随机扫"整个输入空间"找反例。
// 5 条不变量：目标≥保本 / 毛利率单调 / 固定成本单调 / 日额×天数≈月额 / 红警fail-closed。
'use strict';
const { calcSandbox } = require('../../cloudfunctions/calcSandbox/service.js');

// 可复现伪随机（线性同余，固定种子 ⇒ 每次跑同一批，可复现）
let _s = 20261116;
function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

const INV = {
  target_gte_be: '目标营收 >= 保本营收（目标利润>0）',
  margin_monotonic: '毛利率↑ ⇒ 保本营收↓',
  fixed_monotonic: '固定成本↑ ⇒ 保本营收↑',
  daily_times_days: '保本日额×营业天数≈保本月额（误差≤天数）',
  red_failclosed: '红警时四核心结果为null',
};
const fail = {};
Object.keys(INV).forEach((k) => { fail[k] = []; });

function mk(over) {
  const rent = ri(300000, 3000000);      // 房租 3000~30000 元 → 分
  const labor = ri(200000, 2000000);
  const margin = ri(30, 75);             // 毛利率 30~75%
  return Object.assign({
    cityTier: 't2', bizType: 'noodle',
    buildItems: [{ fen: ri(5000000, 50000000), years: ri(1, 5) }],
    fixedItems: [
      { key: 'rent', fen: rent },
      { key: 'labor', fen: labor },
      { key: 'other', fen: ri(10000, 300000) },
    ],
    varItems: [{ key: 'platform', pct: ri(0, 8) }],
    grossMarginPct: margin,
    targetProfitFen: ri(0, 5000000),
    expectedRevenueFen: ri(1000000, 20000000),
    validDays: ri(20, 31),
  }, over || {});
}

function checkOne(c) {
  const r = calcSandbox(c);
  if (!r.red_alert) {
    // 1) 目标 >= 保本
    if (r.target_monthly_fen < r.break_even_monthly_fen) {
      fail.target_gte_be.push({ c, r, why: r.target_monthly_fen + ' < ' + r.break_even_monthly_fen });
    }
    // 4) 日额 × 天数 ≈ 月额
    const diff = Math.abs(r.break_even_daily_fen * r.valid_days - r.break_even_monthly_fen);
    if (diff > r.valid_days + 1) {
      fail.daily_times_days.push({ c, r, why: 'diff=' + diff + ' days=' + r.valid_days });
    }
  } else {
    // 5) 红警 fail-closed
    const bad = ['break_even_monthly_fen', 'break_even_daily_fen', 'target_monthly_fen', 'target_daily_fen']
      .filter((k) => r[k] !== null);
    if (bad.length) fail.red_failclosed.push({ c, r, why: bad.join(',') + ' 非null' });
  }
  return r;
}

const N = 3000;
for (let i = 0; i < N; i++) checkOne(mk());

// 2) 毛利率单调：同一组固定输入，毛利率 +10 个百分点，保本应严格下降
for (let i = 0; i < 1000; i++) {
  const base = mk({ targetProfitFen: 0, varItems: [] });
  const lo = calcSandbox(Object.assign({}, base, { grossMarginPct: 40 }));
  const hi = calcSandbox(Object.assign({}, base, { grossMarginPct: 50 }));
  if (!lo.red_alert && !hi.red_alert && !(hi.break_even_monthly_fen < lo.break_even_monthly_fen)) {
    fail.margin_monotonic.push({ base, lo: lo.break_even_monthly_fen, hi: hi.break_even_monthly_fen });
  }
}

// 3) 固定成本单调：固定项 +10万，保本应严格上升
for (let i = 0; i < 1000; i++) {
  const base = mk({ targetProfitFen: 0, varItems: [] });
  const plus = Object.assign({}, base, {
    fixedItems: base.fixedItems.concat([{ key: 'extra', fen: 10000000 }]),
  });
  const lo = calcSandbox(base);
  const hi = calcSandbox(plus);
  if (!lo.red_alert && !hi.red_alert && !(hi.break_even_monthly_fen > lo.break_even_monthly_fen)) {
    fail.fixed_monotonic.push({ base, lo: lo.break_even_monthly_fen, hi: hi.break_even_monthly_fen });
  }
}

console.log('=== M2 属性测试：' + N + ' 组随机 + 2000 组单调性 ===');
let total = 0;
Object.keys(INV).forEach((k) => {
  const n = fail[k].length;
  total += n;
  console.log((n ? '❌' : '✅') + ' ' + INV[k] + ' — 反例 ' + n);
  if (n) {
    console.log('   首例:', JSON.stringify(fail[k][0]).slice(0, 400));
  }
});
console.log(total === 0 ? '===== 全部不变量成立 =====' : '===== 发现 ' + total + ' 类反例 =====');
process.exit(total === 0 ? 0 : 1);
