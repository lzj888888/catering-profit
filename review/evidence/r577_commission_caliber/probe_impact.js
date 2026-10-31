// review/evidence/r577_commission_caliber/probe_impact.js
// 量化：M2 沙盘里「外卖抽成%」填错方向，保本点会偏多少（真调生产引擎 calcSandbox）
//
// 场景取自真实账单那家店的固定成本量级：房租 12000 / 人工 8000 / 毛利率 65%。
// 只改 varItems 里外卖抽成这一个 pct，其余不动 ⇒ 差额可归因到这一个参数。
const S = require('../../../cloudfunctions/calcSandbox/service.js');

const FEN = (y) => Math.round(y * 100);
const base = {
  cityTier: 't1',
  bizType: 'fast_food',
  buildItems: [],
  fixedItems: [
    { key: 'rent', fen: FEN(12000) },
    { key: 'labor', fen: FEN(8000) },
  ],
  grossMarginPct: 65,
  targetProfitFen: 0,
  expectedRevenueFen: 0,
};

const CASES = [
  ['① 佣金÷商品金额（我方 R573 曾建议的 2.47%）', 2.47],
  ['② 平台扣点÷商品金额·淘宝闪购实测', 11.46],
  ['③ 平台扣点÷商品金额·美团实测', 17.53],
  ['④ 文案写的 18~23% 取下沿', 18],
  ['⑤ 文案写的 18~23% 取上沿', 23],
  ['⑥ 平台扣点÷实收·淘宝闪购', 19.47],
];

const out = [];
for (const [label, pct] of CASES) {
  const r = S.calcSandbox(Object.assign({}, base, { varItems: [{ key: 'takeaway', pct }] }));
  out.push({ label, pct, beFen: r.break_even_monthly_fen, varRate: r.composite_var_rate_pct });
}

const ref = out[1]; // 以淘宝实测 11.46% 为基准
console.log('固定成本 20000 元 / 毛利率 65% / 只改「外卖抽成%」一个参数\n');
console.log('%-40s %6s %10s %10s' .replace(/%-40s/, '') || '');
for (const o of out) {
  const wan = (o.beFen / 1000000).toFixed(2);
  const diff = ((o.beFen / ref.beFen - 1) * 100).toFixed(1);
  console.log(
    o.label.padEnd(38) +
    ('抽成 ' + o.pct + '%').padStart(11) +
    ('保本 ' + wan + ' 万').padStart(14) +
    (' vs ② ' + (diff >= 0 ? '+' : '') + diff + '%').padStart(14));
}
console.log('\n结论读数：');
console.log('  · ②（11.46%）→ ①（2.47%）：保本被算低 ' +
  (((out[0].beFen / out[1].beFen) - 1) * 100).toFixed(1) + '% ⇒ 结论偏「能开」（危险方向）');
console.log('  · ②（11.46%）→ ⑤（23%）  ：保本被算高 ' +
  (((out[4].beFen / out[1].beFen) - 1) * 100).toFixed(1) + '% ⇒ 结论偏「不能开」（保守方向）');
