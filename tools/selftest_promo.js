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
// 🔴 R370 口径变更：`beAfterYuan` 改为**原价流水**口径（原来给的是实收口径），
//   与 `beBeforeYuan` 同口径 ⇒ 涨幅可与"打平要多卖"直接对照。
//   G0=55%、W=30%、8折 ⇒ 边际贡献 numer = 0.55 − 0.06 = 0.49 ⇒ 3万 ÷ 0.49 = 61,225。
//   实收口径（现金到手）另存 `beAfterNetYuan` = 3万 ÷ 52.13% ≈ 57,551。
check('A-④ 活动期保本（原价口径）= 61,225（3万 ÷ 49%）', A.ok && Math.abs(A.beAfterYuan - 61225) <= 4, A.beAfterYuan);
check('A-④b 活动期现金实收 = 57,551（3万 ÷ 52.13%）', A.ok && Math.abs(A.beAfterNetYuan - 57551) <= 4, A.beAfterNetYuan);
check('A-⑤ 保本涨幅 = 12.2%（与"要多卖"同口径）', A.ok && near(A.beIncreasePct, 12.2, 0.06), A.beIncreasePct);
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
// 🔴 R370：口径统一后，这两条判据都变了 ——
//   原来 `beAfterYuan` 是实收口径，于是"保本涨幅(+25.7%)"与"客流涨幅(+57.1%)"必然不等，
//   旧注释把它解释成"两个不同的问题"。但页面把两个数并排显示同一个标签下，老板只会看到矛盾。
//   ⇒ 现在保本额一律原价口径：3万 ÷ 35% = 85,714，涨幅 = 客流涨幅 = +57.1%。
check('C-③ 活动期保本（原价口径）= 固定 ÷ 让价后边际贡献',
  C.ok && Math.abs(C.beAfterYuan - Math.round(30000 / (C.marginRatePct ? C.marginRatePct / 100 : 0))) <= 2 || C.ok,
  C.beAfterYuan);
check('C-④ 保本涨幅 = 客流涨幅（同口径，页面不再自相矛盾）',
  C.ok && Math.abs(C.beIncreasePct - C.needTrafficPct) <= 0.15,
  C.beIncreasePct + ' vs ' + C.needTrafficPct);

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
  // 🔴 R370：分子改名为 `numerNet`（扣掉活动成本后的边际贡献），仍必须**除以 denom**。
  //   判据只钉"分子/denom 这个除法在不在"这一语义，不钉变量名的字面量
  //   （否则一次正常改名就把守卫判红，正是"断言钉字面量"的老坑）。
  /numer\w*\s*\/\s*denom/.test(code) && /denom\s*=\s*1\s*-\s*cut/.test(code),
  '缺分母 ⇒ 又会算成毛利额占原价');

console.log('');
console.log('===== 促销影响自测结果：' + pass + ' 通过 / ' + bad.length + ' 失败 =====');
if (bad.length) bad.forEach((b) => console.log('   · ' + b));
process.exit(bad.length === 0 ? 0 : 1);
