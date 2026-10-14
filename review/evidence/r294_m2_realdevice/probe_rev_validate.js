// R294 · 复现「首页反推被拒」：把页面上真实的入参喂给生产 validate，看它到底拒哪一项
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const val = require(path.join(ROOT, 'cloudfunctions/calcSandbox/validate.js'));

const wire = {
  shop_id: 'r294-probe',
  mode: 'reverse',
  city_tier: 'tier23',
  biz_type: 'other',
  build_items: [],
  fixed_items: [
    { key: 'labor', fen: 640000 },
    { key: 'utility', fen: 350000 },
    { key: 'manage', fen: 750000 },
  ],
  var_items: [{ key: 'other', pct: 2 }],
  gross_margin_pct: 65,
  target_profit_fen: 800000,
  expected_revenue_fen: 0,
  valid_days: 30,
  rev_price_fen: 1200,
  seats: 32,
  open_days: 30,
  target_rent_rate: 15,
  pixel_eff_fen: 0,
};

const r = val.validateInput(wire);
console.log('=== 与页面完全一致的入参 ===');
console.log('error =', r.error, '| msg =', r.msg || r.error);
if (!r.error) {
  const svc = require(path.join(ROOT, 'cloudfunctions/calcSandbox/service.js'));
  const d = svc.calcSandboxReverse(r.clean);
  console.log('反推成功：rent_cap_fen =', d.rent_cap_fen, '| target_monthly_fen =', d.target_monthly_fen);
} else {
  // 逐项二分：把可疑字段改成「明显合法」的值，看拒在哪
  const tries = [
    ['expected_revenue_fen 给正值', { expected_revenue_fen: 6000000 }],
    ['gross_margin_pct 改 55', { gross_margin_pct: 55 }],
    ['去掉 valid_days', { valid_days: undefined }],
    ['target_rent_rate 改 10', { target_rent_rate: 10 }],
  ];
  for (const [label, patch] of tries) {
    const w = Object.assign({}, wire);
    Object.keys(patch).forEach((k) => { if (patch[k] === undefined) delete w[k]; else w[k] = patch[k]; });
    const rr = val.validateInput(w);
    console.log('  试：' + label + ' ⇒ ' + (rr.error ? '仍拒：' + rr.msg : '通过'));
  }
}
