// tools/selftest_m3_groupon.js —— M3.37 到店团购每单测算自测
//
// 锚点（require 真实单源实算，不重写一份公式）：
//   G-a 佣金基数 = 顾客实付价（不是原价）    G-b 费率缺省为 0（R128，不替老板编数）
//   G-c 实收/利润/到手率/毛利率（含除零与亏损边界）
//   G-d 推广费扣减                           G-e vsDine 符号语义（<0 多赚 / >0 少赚 / 无挂牌价恒 0）
//   G-f 隔离（输出键白名单，不含 M1 月度字段）
//
// 口径出处：R190（2026-10-02）—— 佣金基数恒为顾客实付价；团购无配送费/打包费/包材（到店核销）。
// 运行：node tools/selftest_m3_groupon.js

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const { calcGrouponOrder } = require('../utils/grouponDerive.js');

console.log('===== G-a · 佣金基数（顾客实付价，不是原价）=====');
const aDeal = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: 6 });
check('G-a 实付价 8800、佣金率 6% ⇒ 佣金 528 分', aDeal.commissionFen === 528, `got ${aDeal.commissionFen}`);
check('G-a 佣金基数不是原价（原价 18800×6%=1128，绝不能拿到这个数）',
  aDeal.commissionFen !== 1128, `got ${aDeal.commissionFen}`);
const aOrigin = calcGrouponOrder({ priceFen: 18800, costFen: 6000, ratePct: 6 });
check('G-a 同一函数喂原价才得 1128 —— 证明"基数=实付价"由页面传入保证，不靠函数猜',
  aOrigin.commissionFen === 1128, `got ${aOrigin.commissionFen}`);
const aRound = calcGrouponOrder({ priceFen: 3333, costFen: 0, ratePct: 6 });
check('G-a 佣金取整到分（3333×6%=199.98 ⇒ 200）', aRound.commissionFen === 200, `got ${aRound.commissionFen}`);

console.log('===== G-b · 费率没有默认值（R128）=====');
const bNone = calcGrouponOrder({ priceFen: 8800, costFen: 6000 });
check('G-b 不填费率 ⇒ 佣金 0（绝不替老板编一个 6%）', bNone.commissionFen === 0, `got ${bNone.commissionFen}`);
const bNull = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: null });
check('G-b 费率 null ⇒ 佣金 0', bNull.commissionFen === 0, `got ${bNull.commissionFen}`);
const bJunk = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: 'abc' });
check('G-b 费率非数字 ⇒ 佣金 0 且到手不出现 NaN', bJunk.commissionFen === 0 && bJunk.netFen === 8800,
  `commission=${bJunk.commissionFen} net=${bJunk.netFen}`);

console.log('===== G-c · 实收 / 利润 / 到手率 / 毛利率 =====');
const cMain = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: 6 });
check('G-c 到手 8272（8800 − 佣金 528 − 推广 0）', cMain.netFen === 8272, `got ${cMain.netFen}`);
check('G-c 利润 2272（8272 − 成本 6000）', cMain.profitFen === 2272, `got ${cMain.profitFen}`);
check('G-c 到手率 94%（分母 = 团购价 8800）', cMain.netRatePct === 94, `got ${cMain.netRatePct}`);
check('G-c 毛利率 27.47%（分母 = 到手额 8272，不是团购价）', cMain.profitRatePct === 27.47, `got ${cMain.profitRatePct}`);
const cZero = calcGrouponOrder({ priceFen: 0, costFen: 1000 });
check('G-c 团购价为 0 ⇒ 两个率都取 0 且不抛（除零保护）',
  cZero.netRatePct === 0 && cZero.profitRatePct === 0, `net=${cZero.netRatePct} profit=${cZero.profitRatePct}`);
const cLoss = calcGrouponOrder({ priceFen: 8800, costFen: 8000, ratePct: 20 });
check('G-c 亏本单如实出负数（佣金 1760 ⇒ 利润 −960、毛利率 −13.64%）',
  cLoss.profitFen === -960 && cLoss.profitRatePct === -13.64,
  `profit=${cLoss.profitFen} rate=${cLoss.profitRatePct}`);

console.log('===== G-d · 推广费扣减 =====');
const dPromo = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: 6, promoFen: 500 });
check('G-d 推广费 500 ⇒ 到手 7772、利润 1772',
  dPromo.netFen === 7772 && dPromo.profitFen === 1772, `net=${dPromo.netFen} profit=${dPromo.profitFen}`);
check('G-d 推广费与佣金互不替代（到手差额恰等于推广费 500）',
  dPromo.netFen === cMain.netFen - 500, `${cMain.netFen} → ${dPromo.netFen}`);

console.log('===== G-e · 与堂食对比的符号语义（<0 多赚 / >0 少赚）=====');
const eMore = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: 6, dineFen: 8000 });
check('G-e 堂食毛利 2000 < 团购利润 2272 ⇒ vsDineFen = −272',
  eMore.vsDineFen === -272 && eMore.dineProfitFen === 2000,
  `vsDine=${eMore.vsDineFen} dineProfit=${eMore.dineProfitFen}`);
check('G-e 🔴 负值语义是「团购多赚」（页面谓词必须取 < 0 才渲染"多赚"）',
  eMore.vsDineFen < 0 && eMore.hasDine === true, `vsDine=${eMore.vsDineFen}`);
const eLess = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: 6, dineFen: 10000 });
check('G-e 堂食毛利 4000 > 团购利润 2272 ⇒ vsDineFen = 1728（正 = 团购少赚）',
  eLess.vsDineFen === 1728, `got ${eLess.vsDineFen}`);
const eFlat = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: 6, dineFen: 8272 });
check('G-e 两侧打平（挂牌 8272 = 到手额）⇒ vsDineFen 恰 0 但 hasDine 仍为 true',
  eFlat.vsDineFen === 0 && eFlat.hasDine === true, `vsDine=${eFlat.vsDineFen} hasDine=${eFlat.hasDine}`);
const eNoDine = calcGrouponOrder({ priceFen: 8800, costFen: 6000, ratePct: 6 });
check('G-e 没给挂牌价 ⇒ hasDine=false 且 vsDine/dineProfit 恒 0（不猜一个数）',
  eNoDine.hasDine === false && eNoDine.vsDineFen === 0 && eNoDine.dineProfitFen === 0,
  `hasDine=${eNoDine.hasDine}`);

console.log('===== G-f · 隔离（输出不含 M1 月度字段 + 键集白名单）=====');
const ALLOWED_KEYS = ['commissionFen', 'costFen', 'dineProfitFen', 'hasDine', 'netFen', 'netRatePct',
  'priceFen', 'profitFen', 'profitRatePct', 'promoFen', 'vsDineFen'];
const gotKeys = Object.keys(cMain).slice().sort();
check('G-f 输出键集恰为 11 个白名单键（新增字段须先过红线审查）',
  gotKeys.join(',') === ALLOWED_KEYS.join(','), `got ${gotKeys.length} 个：${gotKeys.join('/')}`);
const M1_HINTS = ['month', 'ledger', 'monthly', 'profit_month', 'reconcile'];
const deepScan = (obj, path) => {
  if (Array.isArray(obj)) return obj.some((o, i) => deepScan(o, `${path}[${i}]`));
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (M1_HINTS.some((h) => k.toLowerCase().indexOf(h) >= 0)) return `${path}.${k}`;
      const hit = deepScan(obj[k], `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return false;
};
const hit = deepScan(cMain, 'out');
check('G-f 深层扫描不含任何 M1 月度字段（month/ledger/monthly...）',
  hit === false, hit ? `命中 ${hit}` : '仅 *Fen / *RatePct / hasDine');
const fNoArg = calcGrouponOrder();
const fNull = calcGrouponOrder(null);
check('G-f 无参 / null 入参 ⇒ 全 0 且不抛（fail-safe，不炸页面）',
  fNoArg.priceFen === 0 && fNull.profitFen === 0 && fNoArg.hasDine === false,
  `noArg=${fNoArg.priceFen} null=${fNull.profitFen}`);

console.log('\n' + '='.repeat(60));
console.log(`===== M3.37 团购每单测算自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
