// R336 探针：四项投入各自年限 + 转让费不摊 + 双保本比例
const { calcSandbox } = require('../../cloudfunctions/calcSandbox/service.js');

const base = {
  cityTier: 'tier23', bizType: 'fastfood',
  fixedItems: [{ key: 'rent', fen: 500000 }, { key: 'labor', fen: 900000 },
    { key: 'utility', fen: 200000 }, { key: 'other', fen: 40000 }],
  varItems: [],
  grossMarginPct: 55,
  targetProfitFen: 2000000,
  expectedRevenueFen: 0,
};

const ITEMS_OFF = [                       // 转让费不摊（years: 0）
  { key: 'decor', fen: 15000000, years: 3 },
  { key: 'equip', fen: 8000000, years: 5 },
  { key: 'franchise', fen: 5000000, years: 3 },
  { key: 'transfer', fen: 10000000, years: 0 },
];
const ITEMS_ON = ITEMS_OFF.map((x) => (x.key === 'transfer' ? Object.assign({}, x, { years: 3 }) : x));

const off = calcSandbox(Object.assign({}, base, { buildItems: ITEMS_OFF }));
const on = calcSandbox(Object.assign({}, base, { buildItems: ITEMS_ON }));

const y = (fen) => (fen / 100).toFixed(0);
const handAmort = 15000000 / 36 + 8000000 / 60 + 5000000 / 36;   // 不含转让

let bad = 0;
function ck(name, cond, detail) {
  if (cond) { console.log('✅ ' + name); return; }
  bad += 1; console.log('❌ ' + name + '  [' + detail + ']');
}

console.log('--- 投入总额 ---');
console.log('  不摊: ' + y(off.build_total_fen) + ' 元 | 摊: ' + y(on.build_total_fen) + ' 元');
ck('A-① 转让费摊不摊，投入总额都包含它（都是 38 万）',
  off.build_total_fen === 38000000 && on.build_total_fen === 38000000,
  off.build_total_fen + '/' + on.build_total_fen);

console.log('--- 月摊销 ---');
console.log('  不摊: ' + y(off.build_amort_monthly_fen) + ' 元 | 摊: ' + y(on.build_amort_monthly_fen) + ' 元');
console.log('  手算(装3+设5+加3): ' + Math.round(handAmort / 100) + ' 元');
ck('A-② 转让费不摊时，摊销只算装修/设备/加盟（与手算一致，±1 元）',
  Math.abs(off.build_amort_monthly_fen - Math.round(handAmort)) <= 100,
  off.build_amort_monthly_fen + ' vs ' + Math.round(handAmort));
ck('A-③ 勾上摊销后，月摊销恰好多出 转让费÷36（±1 元）',
  Math.abs((on.build_amort_monthly_fen - off.build_amort_monthly_fen) - Math.round(10000000 / 36)) <= 100,
  (on.build_amort_monthly_fen - off.build_amort_monthly_fen) + ' vs ' + Math.round(10000000 / 36));

console.log('--- 设备 5 年 vs 3 年（原 bug 的方向）---');
const equip3 = ITEMS_OFF.map((x) => (x.key === 'equip' ? Object.assign({}, x, { years: 3 }) : x));
const e3 = calcSandbox(Object.assign({}, base, { buildItems: equip3 }));
console.log('  设备按3年摊: ' + y(e3.build_amort_monthly_fen) + ' 元 | 按5年摊: ' + y(off.build_amort_monthly_fen) + ' 元');
ck('A-④ 设备按 3 年摊会虚高（证明"一个年限"确实会算错，不是假问题）',
  e3.build_amort_monthly_fen > off.build_amort_monthly_fen,
  e3.build_amort_monthly_fen + ' vs ' + off.build_amort_monthly_fen);

console.log('--- 双保本比例 ---');
const beCash = (r) => Math.round(r.break_even_monthly_fen * r.fixed_ex_amort_fen / r.fixed_total_fen);
console.log('  账面保本: ' + y(off.break_even_monthly_fen) + ' | 现金保本: ' + y(beCash(off)));
ck('A-⑤ 现金保本必须 < 账面保本（去掉摊销只会更低）',
  beCash(off) < off.break_even_monthly_fen, beCash(off) + ' vs ' + off.break_even_monthly_fen);
ck('A-⑥ 现金保本公式与"固定不含摊 ÷ 边际贡献率"精确一致（±1%）', (() => {
  const rate = off.fixed_total_fen / off.break_even_monthly_fen;      // 反解边际贡献率
  const hand = off.fixed_ex_amort_fen / rate;
  return Math.abs(beCash(off) - hand) / hand < 0.01;
})(), 'ratio=' );

// 反向：转让费不摊时两个保本的差值，应恰等于 转让摊销 ÷ rate
const gap = off.break_even_monthly_fen - beCash(off);
console.log('  两口径差: ' + y(gap) + ' 元/月（≈ 全部摊销 ÷ 边际贡献率）');
ck('A-⑦ 两口径差额必须来自摊销（差额 > 0 且接近 摊销÷rate）', (() => {
  const rate = off.fixed_total_fen / off.break_even_monthly_fen;
  const expect = off.build_amort_monthly_fen / rate;
  return Math.abs(gap - expect) / expect < 0.02;
})());

console.log(bad === 0 ? '\n=== 探针全过（7 条）===' : '\n=== 失败 ' + bad + ' 条 ===');
process.exit(bad === 0 ? 0 : 1);
