// _audit_m2fwd_identity.js —— 只读取证（A 节核心）：
// 「前端装配 assembleItems」↔「云函数 calcSandbox」是否恒等：
//   判据：引擎回参 fixed_ex_amort_fen 必须 **逐分恒等于** assembleItems 产出的 fixedItems 分之和。
//   若不恒等 ⇒ 两条链路上有一处第二份实现 / 入参在传输中被改写。
const { makePage } = require('./_audit_m2fwd_harness.js');
const { calcSandbox } = require('./cloudfunctions/calcSandbox/service.js');
const { BIZ_PRESETS } = require('./utils/bizPreset.js');

const PRESETS = ['fastfood_noodle', 'dining_sichuan', 'hotpot_half_self', 'cafe_tea', 'other',
  'hotpot_barbecue', 'dining_xiang', 'cafe_other'];
const CITIES = [0, 1, 2];
const RENTS = ['', '3000', '8000', '30000'];
const LABORS = ['', '9000', '44000'];
const WEG = [
  {}, { waterYuan: '200', electricYuan: '1500', gasYuan: '300' },
  { electricYuan: '1500' }, { waterYuan: '200', electricYuan: '1500' },
];
const MANAGES = ['', '2000'];
const HCS = ['', '2', '8'];
const BUILDS = [
  [], [{ key: 'decor', fen: 1000000, years: 3 }],
  [{ key: 'decor', fen: 1000000, years: 3 }, { key: 'equip', fen: 500000, years: 5 },
    { key: 'transfer', fen: 3000000, years: 0 }],
];

let n = 0, bad = 0, worst = 0;
const samples = [];
for (const pk of PRESETS) for (const ci of CITIES) for (const rent of RENTS)
  for (const lb of LABORS) for (const weg of WEG) for (const mg of MANAGES)
    for (const hc of HCS) for (const bd of BUILDS) {
      // 抽样：全组合太大，按固定步长取 ~600 组
      n++;
      if (n % 37 !== 0) continue;
      const p = makePage(Object.assign({
        presetKey: pk, cityIdx: ci, bizIdx: 0, areaNum: '60', rentYuan: rent,
        laborTotalYuan: lb, manageYuan: mg, headcountNum: hc, laborUnitYuan: '4500',
        marginPct: 60, targetYuan: '20000', buildItems: bd,
      }, weg));
      const prm = p.buildPresetParam('forward');
      const d = calcSandbox({
        cityTier: prm.city_tier, bizType: prm.biz_type, buildItems: prm.build_items,
        fixedItems: prm.fixed_items, varItems: prm.var_items,
        grossMarginPct: prm.gross_margin_pct, targetProfitFen: prm.target_profit_fen,
        expectedRevenueFen: prm.expected_revenue_fen, validDays: prm.valid_days,
      });
      let sum = 0;
      for (const it of prm.fixed_items) sum += Number(it.fen) || 0;
      const diff = Math.abs(sum - d.fixed_ex_amort_fen);
      if (diff > worst) worst = diff;
      if (diff !== 0) {
        bad++;
        if (samples.length < 12) samples.push({ pk, ci, rent, lb, weg, mg, hc, bd, sum,
          eng: d.fixed_ex_amort_fen, diff });
      }
    }
console.log('=== A · assembleItems 装配产物 vs 引擎 fixed_ex_amort_fen 恒等性 ===');
console.log('   组合总数 ' + n + '，抽样实测 ' + Math.floor(n / 37) + ' 组');
console.log('   逐分不相等的组数 = ' + bad + '；最大偏差 = ' + worst + ' 分');
if (samples.length) samples.forEach((s) => console.log('   ★ ' + JSON.stringify(s)));

// 附加：amort 恒等性（引擎 build_amort_monthly vs 手算 Σ fen/(years*12)）
let amortBad = 0;
for (const bd of BUILDS) {
  if (!bd.length) continue;
  let manual = 0;
  for (const b of bd) if (b.years > 0) manual += b.fen / (b.years * 12);
  manual = Math.round(manual);
  const d = calcSandbox({ cityTier: 'tier23', bizType: 'fastfood', buildItems: bd,
    fixedItems: [{ key: 'rent', fen: 800000 }], varItems: [], grossMarginPct: 60,
    targetProfitFen: 0, expectedRevenueFen: 0, validDays: 30 });
  if (d.build_amort_monthly_fen !== manual) {
    amortBad++;
    console.log('   ★ 摊销不等：手算 ' + manual + ' vs 引擎 ' + d.build_amort_monthly_fen);
  }
}
console.log('   摊销逐分复算不符组数 = ' + amortBad + '（含 years:0 不摊但计入总额的情形）');

// 附加：var_items 恒等性（引擎 composite_var_rate = (100-毛利率) + Σvar.pct）
let varBad = 0;
for (const m of [40, 55, 60, 67, 80]) {
  const p = makePage({ presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, marginPct: m,
    rentYuan: '8000', laborTotalYuan: '9000', otherPctNum: '3' });
  p.onOtherPct({ detail: { value: '3' } });
  const prm = p.buildPresetParam('forward');
  const d = calcSandbox({ cityTier: prm.city_tier, bizType: prm.biz_type, buildItems: [],
    fixedItems: prm.fixed_items, varItems: prm.var_items, grossMarginPct: prm.gross_margin_pct,
    targetProfitFen: 0, expectedRevenueFen: 0, validDays: 30 });
  const manual = Math.round(((100 - m) + prm.var_items.reduce((a, b) => a + b.pct, 0)) * 10) / 10;
  if (Math.abs(manual - d.composite_var_rate_pct) > 1e-9) {
    varBad++;
    console.log('   ★ 变动费率不等 毛利率' + m + '：手算 ' + manual + ' vs 引擎 ' + d.composite_var_rate_pct);
  }
}
console.log('   综合变动率复算不符组数 = ' + varBad);
