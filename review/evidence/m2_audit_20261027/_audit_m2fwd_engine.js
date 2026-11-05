// _audit_m2fwd_engine.js —— 只读取证：用 index.js 的 buildPresetParam（真实页面代码）
// 装配入参 → 送云端 validate.js + service.js（真实引擎）→ 打出老板看得懂的数字。
const { makePage } = require('./_audit_m2fwd_harness.js');
const { calcSandbox } = require('./cloudfunctions/calcSandbox/service.js');
const { validateInput } = require('./cloudfunctions/calcSandbox/validate.js');

/** 复刻 index.js::onCalcPresetFwd 的 payload（见 index.js:1902-1914） */
function payloadOf(p) {
  const prm = p.buildPresetParam('forward');
  return {
    prm,
    payload: {
      shop_id: 's_test',
      city_tier: prm.city_tier, biz_type: prm.biz_type,
      build_items: prm.build_items, fixed_items: prm.fixed_items, var_items: prm.var_items,
      gross_margin_pct: prm.gross_margin_pct, target_profit_fen: prm.target_profit_fen,
      expected_revenue_fen: prm.expected_revenue_fen,
      rev_price_fen: prm.rev_price_fen, seats: prm.seats, open_days: prm.open_days,
      target_rent_rate: prm.target_rent_rate, pixel_eff_fen: prm.pixel_eff_fen,
      valid_days: prm.valid_days,
      client_request_id: 'sb_probe',
    },
  };
}

function run(overrides) {
  const p = makePage(overrides);
  const { prm, payload } = payloadOf(p);
  const v = validateInput(payload);
  if (v.error) return { err: v.msg, prm };
  const d = calcSandbox(v.clean);
  const yuan = (f) => (f == null ? null : Math.round(f / 100));
  return {
    prm,
    fixed_items: prm.fixed_items.map((x) => x.key + ':' + (x.fen / 100)),
    var_items: prm.var_items.map((x) => x.key + ':' + x.pct + '%'),
    build_total: yuan(d.build_total_fen),
    amort: yuan(d.build_amort_monthly_fen),
    fixed_ex_amort: yuan(d.fixed_ex_amort_fen),
    fixed_total: yuan(d.fixed_total_fen),
    composite_var_rate: d.composite_var_rate_pct,
    margin_rate: d.margin_rate_ratio,
    break_even_monthly: yuan(d.break_even_monthly_fen),
    break_even_daily: yuan(d.break_even_daily_fen),
    target_monthly: yuan(d.target_monthly_fen),
    payback_months: d.payback_months,
    red_alert: d.red_alert,
    indicators_at_target: (d.indicators_at_target || []).map((x) => x.key + '=' + x.pct + '%/' + x.level),
    _d: d,
  };
}

module.exports = { run, payloadOf, makePage };

if (require.main === module) {
  const cases = [
    ['A 全空（首屏默认，一个字没填）', {}],
    ['B 快餐60㎡/房租8000/2人/人均4500/毛利60%/投入15万',
      { presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, areaNum: '60', rentYuan: '8000',
        headcountNum: '2', laborTotalYuan: '9000', marginPct: 60, initialInvestYuan: '150000',
        expectYuan: '100000', targetYuan: '20000', avgPriceYuan: '20' }],
    ['C 同 B 但水电气全填（水200/电1500/气300）',
      { presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, areaNum: '60', rentYuan: '8000',
        headcountNum: '2', laborTotalYuan: '9000', marginPct: 60,
        waterYuan: '200', electricYuan: '1500', gasYuan: '300',
        expectYuan: '100000', targetYuan: '20000', avgPriceYuan: '20' }],
    ['D 同 B 但只填电（水/气留空）',
      { presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, areaNum: '60', rentYuan: '8000',
        headcountNum: '2', laborTotalYuan: '9000', marginPct: 60,
        electricYuan: '1500',
        expectYuan: '100000', targetYuan: '20000', avgPriceYuan: '20' }],
    ['E 同 C 但房租留空',
      { presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, areaNum: '60',
        headcountNum: '2', laborTotalYuan: '9000', marginPct: 60,
        waterYuan: '200', electricYuan: '1500', gasYuan: '300',
        expectYuan: '100000', targetYuan: '20000', avgPriceYuan: '20' }],
  ];
  for (const [name, ov] of cases) {
    const r = run(ov);
    console.log('\n===== ' + name);
    if (r.err) { console.log('  校验失败: ' + r.err); continue; }
    console.log('  fixed_items = ' + JSON.stringify(r.fixed_items));
    console.log('  var_items   = ' + JSON.stringify(r.var_items));
    console.log('  建店总投入=' + r.build_total + ' 月摊销=' + r.amort
      + ' 固定(不含摊)=' + r.fixed_ex_amort + ' 固定(含摊)=' + r.fixed_total);
    console.log('  综合变动率=' + r.composite_var_rate + '% 边际贡献率=' + (r.margin_rate * 100).toFixed(1) + '%');
    console.log('  保本月营收=' + r.break_even_monthly + ' 保本日均=' + r.break_even_daily
      + ' 目标月营收=' + r.target_monthly + ' 回本=' + r.payback_months);
    console.log('  指标@目标 = ' + JSON.stringify(r.indicators_at_target));
  }
}
