// tools/selftest_promo.js —— R330 促销影响测算（utils/promoImpact.js）行为自测
//
// 为什么立这条：这条公式**豆包第一版是错的**（漏了分母，把「毛利额占原价」当成毛利率，
//   49% vs 正确 52.13%），而且它自称"代入算例验证过"。链路通、步骤自洽，数字却是错的。
//   ⇒ 判据必须用**具体金额手算锚点**，不能只验"公式能跑"。
//
// 判据全部是**行为**（真调函数验返回值），不扫字面量。
const fs = require('fs');
const path = require('path');
const { promoImpact: P } = require('../utils/promoImpact.js');

let pass = 0;
const bad = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log('✅ ' + name); return; }
  bad.push(name + (detail ? '  [' + detail + ']' : ''));
}
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol == null ? 0.05 : tol);

// ===== A 手算锚点（原价营收 100 万口径，任何一项算错都会对不上）=====
// G0=55%（食材 45 万）· 活动 30% · 8 折 ⇒ 实收 94 万 · 毛利 49 万 ⇒ 52.13%
const A = P({ fixedYuan: 30000, marginPct: 55, discount: 0.8, weightPct: 30 });
check('A-① 活动期毛利率 = 52.1%（手算 49÷94）', A.ok && near(A.gaPct, 52.1, 0.06), A.gaPct);
check('A-② 掉 2.9 个点（55 − 52.13）', A.ok && near(A.dropPctPoints, 2.9, 0.06), A.dropPctPoints);
check('A-③ 活动前保本 = 54,545（3万 ÷ 55%）', A.ok && A.beBeforeYuan === 54545, A.beBeforeYuan);
check('A-④ 活动期保本 = 57,551（3万 ÷ 52.13%）', A.ok && Math.abs(A.beAfterYuan - 57551) <= 4, A.beAfterYuan);
check('A-⑤ 保本涨幅 = 5.5%', A.ok && near(A.beIncreasePct, 5.5, 0.06), A.beIncreasePct);
check('A-⑥ 打平需客流 +12.2%（0.55 ÷ 0.49 − 1）', A.ok && near(A.needTrafficPct, 12.2, 0.06), A.needTrafficPct);

// ===== B 退化：W=0（没人参加活动）⇒ 一切回到日常 =====
const B = P({ fixedYuan: 30000, marginPct: 55, discount: 0.8, weightPct: 0 });
check('B-① W=0 ⇒ 毛利率不变', B.ok && near(B.gaPct, 55, 0.001), B.gaPct);
check('B-② W=0 ⇒ 保本不变', B.ok && B.beBeforeYuan === B.beAfterYuan);
check('B-③ W=0 ⇒ 不需要多来客人', B.ok && B.needTrafficPct === 0, B.needTrafficPct);

// ===== C 退化：W=100%（全员打折）⇒ 必须与纯折扣模型一致 =====
// G0=55%、8 折 ⇒ 1 − 0.45/0.8 = 43.75%；客流 0.55/0.35 − 1 = +57.14%
const C = P({ fixedYuan: 30000, marginPct: 55, discount: 0.8, weightPct: 100 });
check('C-① W=100% ⇒ 毛利率 43.8%（1−0.45/0.8）', C.ok && near(C.gaPct, 43.8, 0.06), C.gaPct);
check('C-② W=100% ⇒ 打平客流 +57.1%', C.ok && near(C.needTrafficPct, 57.1, 0.06), C.needTrafficPct);
// ⚠️ 这里**不能**要求"保本涨幅 = 客流涨幅" —— 两者是不同的量：
//   保本涨幅回答「做到多少不亏」；客流涨幅回答「做到多少和以前一样赚」。
//   W=100%/8 折 时：保本 +25.7%（只看不亏），客流 +57.1%（要补回原来那份利润）。
//   这条只验「活动期保本确实是拿同一个 GA 算出来的」，防有人另写一套毛利率。
check('C-③ 活动期保本 = 固定费用 ÷ 活动期毛利率（同源，不另算一套）',
  C.ok && Math.abs(C.beAfterYuan - Math.round(30000 / C.gaRatio)) <= 2,
  C.beAfterYuan + ' vs ' + Math.round(30000 / C.gaRatio));
check('C-④ 保本涨幅 < 客流涨幅（不亏 ≦ 和以前一样赚）', C.ok && C.beIncreasePct < C.needTrafficPct,
  C.beIncreasePct + ' < ' + C.needTrafficPct);

// ===== D 单调性（抓"方向写反"这类静默错误）=====
const d9 = P({ fixedYuan: 30000, marginPct: 55, discount: 0.9, weightPct: 30 });
const d7 = P({ fixedYuan: 30000, marginPct: 55, discount: 0.7, weightPct: 30 });
check('D-① 折扣越狠 ⇒ 毛利率越低', d7.gaPct < d9.gaPct, d9.gaPct + ' / ' + d7.gaPct);
check('D-② 折扣越狠 ⇒ 要来的客人越多', d7.needTrafficPct > d9.needTrafficPct, d9.needTrafficPct + ' / ' + d7.needTrafficPct);
const w10 = P({ fixedYuan: 30000, marginPct: 55, discount: 0.8, weightPct: 10 });
const w80 = P({ fixedYuan: 30000, marginPct: 55, discount: 0.8, weightPct: 80 });
check('D-③ 参加的人越多 ⇒ 毛利率越低', w80.gaPct < w10.gaPct, w10.gaPct + ' / ' + w80.gaPct);

// ===== E 边界：一律 fail-closed，不输出编出来的数 =====
check('E-① 毛利率 0 ⇒ badMargin', P({ fixedYuan: 30000, marginPct: 0, discount: 0.8, weightPct: 30 }).reason === 'badMargin');
check('E-② 毛利率 >100 ⇒ badMargin', P({ fixedYuan: 30000, marginPct: 130, discount: 0.8, weightPct: 30 }).reason === 'badMargin');
check('E-③ 折扣 >1（涨价当折扣）⇒ badDiscount', P({ fixedYuan: 30000, marginPct: 55, discount: 1.2, weightPct: 30 }).reason === 'badDiscount');
check('E-④ 折扣 ≤0 ⇒ badDiscount', P({ fixedYuan: 30000, marginPct: 55, discount: 0, weightPct: 30 }).reason === 'badDiscount');
check('E-⑤ 占比 >100 ⇒ badWeight', P({ fixedYuan: 30000, marginPct: 55, discount: 0.8, weightPct: 130 }).reason === 'badWeight');
check('E-⑥ 没有固定费用 ⇒ noFixed', P({ fixedYuan: 0, marginPct: 55, discount: 0.8, weightPct: 30 }).reason === 'noFixed');
// 让价幅度 ≥ 毛利率：55% 毛利率、全员打 4 折（让 60%）⇒ 分子 ≤0
const E7 = P({ fixedYuan: 30000, marginPct: 55, discount: 0.4, weightPct: 100 });
check('E-⑦ 让价 ≥ 毛利率 ⇒ negativeMargin（不编保本点）', E7.ok === false && E7.reason === 'negativeMargin', E7.reason);
// 正好打平：55% 毛利率、全员打 4.5 折（让 55%）⇒ 分子 = 0
check('E-⑧ 让价正好等于毛利率 ⇒ 也算 negativeMargin', P({ fixedYuan: 30000, marginPct: 55, discount: 0.45, weightPct: 100 }).ok === false);

// ===== F 反恒真：错的公式必须算不出我们的锚点 =====
// 豆包原式（漏分母）：GA_wrong = G0 − W×(1−d) = 0.49 ⇒ 49.0%
const GA_WRONG = 0.55 - 0.3 * (1 - 0.8);
check('F-① 漏分母的错误公式算出 49.0%，与我们的 52.1% 明显不同 ⇒ 判据能分清对错',
  near(GA_WRONG * 100, 49.0, 0.05) && !near(A.gaPct, GA_WRONG * 100, 0.5),
  (GA_WRONG * 100) + ' vs ' + A.gaPct);

// ===== G 源码不得退回"漏分母"写法 =====
const src = fs.readFileSync(path.join(__dirname, '../utils/promoImpact.js'), 'utf8');
const code = src.replace(/\/\/[^\n]*/g, '');
check('G-① 计算里必须有除以 (1 − 让价比例) 的分母',
  /numer\s*\/\s*denom/.test(code) && /denom\s*=\s*1\s*-\s*cut/.test(code),
  '缺分母 ⇒ 又会算成毛利额占原价');

console.log('');
console.log('===== 促销影响自测结果：' + pass + ' 通过 / ' + bad.length + ' 失败 =====');
if (bad.length) bad.forEach((b) => console.log('   · ' + b));
process.exit(bad.length === 0 ? 0 : 1);
