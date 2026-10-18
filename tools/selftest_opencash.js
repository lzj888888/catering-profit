// tools/selftest_opencash.js —— R324 开店资金测算（utils/openCash.js）行为自测
//
// 为什么立这条：这套口径是**李老师当场纠正过的**（原设计「预算→能开多大」被否，
//   理由「1000 万也不该开 5000 平，店多大由业态决定」）。纠正过的口径最容易在后续改动里
//   悄悄漂回原样（比如有人觉得"顺手用预算反推面积更聪明"）。
//
// 判据全部是**行为**（真调函数验返回值），不扫字面量。
const fs = require('fs');
const path = require('path');
const O = require('../utils/openCash.js');

let pass = 0;
const bad = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { bad.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
const yuan = (y) => Math.round(y * 100);

console.log('===== A · 导出与常量 =====');
check('A-① 导出 estimateOpenCash / DECOR_UNIT_YUAN / DEPOSIT_PRESETS',
  typeof O.estimateOpenCash === 'function' && !!O.DECOR_UNIT_YUAN && Array.isArray(O.DEPOSIT_PRESETS));
check('A-② 装修区间 = 800~1000 元/㎡（李老师口供，不许被人改窄或改高）',
  O.DECOR_UNIT_YUAN.lo === 800 && O.DECOR_UNIT_YUAN.hi === 1000,
  O.DECOR_UNIT_YUAN.lo + '~' + O.DECOR_UNIT_YUAN.hi);
check('A-③ 押金预设恰为 押1付1 / 押1付3 / 押1付6 三种',
  O.DEPOSIT_PRESETS.map((x) => x.label).join(',') === '押1付1,押1付3,押1付6');
check('A-④ 周转金判定线 = 3 个月安全 / 1 个月偏紧',
  O.SAFE_RUNWAY_MONTHS === 3 && O.TIGHT_RUNWAY_MONTHS === 1);

console.log('===== B · 五项现金需求（只算现金流，不做损益）=====');
const base = { areaM2: 80, rentFen: yuan(8000), equipFen: yuan(80000), stockFen: yuan(20000), budgetFen: yuan(300000), fixedMonthlyFen: yuan(32000) };
const r = O.estimateOpenCash(base);
check('B-① 装修 = 面积 × 900 元/㎡（默认取区间中值）', r.decorFen === yuan(72000), String(r.decorFen / 100));
check('B-② 押金 = 月租 × 1（默认押 1）', r.depositFen === yuan(8000), String(r.depositFen / 100));
check('B-③ 预付租金 = 月租 × 3（默认付 3）', r.prepayFen === yuan(24000), String(r.prepayFen / 100));
check('B-④ 现金需求 = 装修+押金+预付+设备+货款（五项相加，无漏项）',
  r.cashNeedFen === yuan(72000 + 8000 + 24000 + 80000 + 20000), String(r.cashNeedFen / 100));
check('B-⑤ 剩余 = 预算 − 现金需求', r.remainFen === yuan(96000), String(r.remainFen / 100));
check('B-⑥ 可撑月数 = 剩余 ÷ 每月固定支出（1 位小数）', r.runwayMonths === 3, String(r.runwayMonths));
check('B-⑦ 撑满 3 个月 ⇒ safe', r.level === 'safe', r.level);

console.log('===== C · 判定线（short / tight / danger / safe）=====');
const short = O.estimateOpenCash({ areaM2: 80, rentFen: yuan(8000), equipFen: yuan(150000), stockFen: yuan(30000), budgetFen: yuan(200000), fixedMonthlyFen: yuan(32000) });
check('C-① 预算不足 ⇒ remainFen < 0 且 level=short', short.remainFen < 0 && short.level === 'short');
const tight = O.estimateOpenCash({ areaM2: 60, rentFen: yuan(5000), equipFen: yuan(50000), budgetFen: yuan(160000), fixedMonthlyFen: yuan(20000) });
check('C-② 剩余 1~3 个月 ⇒ tight', tight.level === 'tight' && tight.runwayMonths >= 1 && tight.runwayMonths < 3,
  tight.runwayMonths + ' 月');
const danger = O.estimateOpenCash({ areaM2: 60, rentFen: yuan(5000), equipFen: yuan(50000), budgetFen: yuan(135000), fixedMonthlyFen: yuan(30000) });
check('C-③ 剩余不足 1 个月 ⇒ danger', danger.level === 'danger' && danger.runwayMonths < 1,
  danger.runwayMonths + ' 月');

console.log('===== D · 押1付6 与自定义装修单价（不能被写死）=====');
const p6 = O.estimateOpenCash({ areaM2: 60, rentFen: yuan(5000), prepayMonths: 6, equipFen: yuan(50000) });
check('D-① 押1付6 ⇒ 预付 = 6 个月租金', p6.prepayFen === yuan(30000), String(p6.prepayFen / 100));
const cheap = O.estimateOpenCash({ areaM2: 100, rentFen: yuan(9000), decorUnitFen: yuan(800) });
check('D-② 装修单价可覆盖（800 元/㎡ ⇒ 100㎡ = 8 万）', cheap.decorFen === yuan(80000), String(cheap.decorFen / 100));
check('D-③ 反恒真：装修单价 800 vs 1000 结果必须不同',
  O.estimateOpenCash({ areaM2: 100, rentFen: yuan(9000), decorUnitFen: yuan(800) }).cashNeedFen
  !== O.estimateOpenCash({ areaM2: 100, rentFen: yuan(9000), decorUnitFen: yuan(1000) }).cashNeedFen);

console.log('===== E · 「不编数」护栏（设备/货款缺失必须标出来）=====');
const miss = O.estimateOpenCash({ areaM2: 50, rentFen: yuan(5000) });
check('E-① 没填设备 ⇒ equipMissing=true（绝不编行业设备价）', miss.equipMissing === true);
check('E-② 没填首批货款 ⇒ stockMissing=true', miss.stockMissing === true);
check('E-③ 缺失项按 0 计入现金需求（不虚增）',
  miss.cashNeedFen === miss.decorFen + miss.depositFen + miss.prepayFen);

console.log('===== F · 边界（不拿 0 当分母）=====');
check('F-① 无面积 ⇒ noArea', O.estimateOpenCash({ rentFen: yuan(5000) }).reason === 'noArea');
check('F-② 无租金 ⇒ noRent', O.estimateOpenCash({ areaM2: 80 }).reason === 'noRent');
const noBudget = O.estimateOpenCash({ areaM2: 50, rentFen: yuan(5000), equipFen: yuan(10000) });
check('F-③ 无预算 ⇒ remainFen=null / level=unknown（不判"够"）',
  noBudget.remainFen === null && noBudget.level === 'unknown');
const noFixed = O.estimateOpenCash({ areaM2: 50, rentFen: yuan(5000), budgetFen: yuan(300000) });
check('F-④ 无月固定支出 ⇒ 可撑月数=null（不拿 0 当分母）', noFixed.runwayMonths === null);

console.log('===== G · 反恒真（本套件对"口径漂移"有分辨力）=====');
const g1 = O.estimateOpenCash({ areaM2: 100, rentFen: yuan(10000), equipFen: yuan(50000) });
const g2 = O.estimateOpenCash({ areaM2: 200, rentFen: yuan(10000), equipFen: yuan(50000) });
check('G-① 面积翻倍 ⇒ 装修必须翻倍（判据抓得住"装修没乘面积"）', g2.decorFen === g1.decorFen * 2);
const g3 = O.estimateOpenCash({ areaM2: 100, rentFen: yuan(20000), equipFen: yuan(50000) });
check('G-② 租金翻倍 ⇒ 押金+预付必须翻倍（抓得住"押金没乘租金"）',
  g3.depositFen + g3.prepayFen === (g1.depositFen + g1.prepayFen) * 2);
const src = fs.readFileSync(path.join(__dirname, '../utils/openCash.js'), 'utf8');
check('G-③ 源码内**不得出现**「按预算反推面积」这类反向逻辑（李老师 2026-10-18 明确否掉）',
  !/budget[^\n]{0,40}area|area[^\n]{0,40}budget/i.test(src.replace(/\/\/[^\n]*/g, '')));

console.log('');
console.log('===== 开店资金测算自测结果：' + pass + ' 通过 / ' + bad.length + ' 失败 =====');
if (bad.length) bad.forEach((b) => console.log('   · ' + b));
process.exit(bad.length === 0 ? 0 : 1);
