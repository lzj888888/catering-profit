// R234 · M2 v1.4 落地后实跑探针 —— 一切数字必须来自生产引擎真实输出，禁止手算/心算推演。
// 用法：node review/evidence/r234_m2_v14/probe_engine.js
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/';
const S = require(ROOT + 'cloudfunctions/calcSandbox/service.js');
const V = require(ROOT + 'cloudfunctions/calcSandbox/validate.js');
const common = require(ROOT + 'cloudfunctions/calcSandbox/common.js');
const BP = require(ROOT + 'utils/bizPreset.js');
const { indicatorRef } = common;

const Y = (n) => Math.round(n * 100);          // 元 → 分
const show = (fen) => fen == null ? 'null' : (fen / 100).toFixed(2) + ' 元';

console.log('=== 0 枚举（来自单源，不猜） ===');
console.log('CITY_KEYS =', indicatorRef.CITY_KEYS.join(' | '));
console.log('BIZ_KEYS  =', indicatorRef.BIZ_KEYS.join(' | '));
console.log('ENGINE_VERSION =', S.ENGINE_VERSION);

function run(input) {
  const v = V.validateInput(input);
  if (v.error) return { __ERR__: v.msg };
  const c = v.clean;
  if (c.mode === 'reverse') return S.calcSandboxReverse(c);
  return S.calcSandbox(c);
}

// ---------- 场景：小面店（二线 / 快餐） ----------
const BASE = {
  shop_id: 'PROBE_SHOP_1',
  city_tier: 'tier23',   // ⚠️ 枚举来自单源实测：tier1 | tier23 | county（没有 tier2）
  biz_type: 'fastfood',
  build_items: [
    { key: 'franchise', fen: Y(30000), years: 3 },   // 加盟费 3 万 / 3 年
    { key: 'decor', fen: Y(80000), years: 3 },       // 装修 8 万 / 3 年
    { key: 'equip', fen: Y(50000), years: 5 },       // 设备 5 万 / 5 年
  ],
  fixed_items: [
    { key: 'rent', fen: Y(6000) },                   // 月租 6000
    { key: 'labor', fen: Y(12000) },                 // 人工 12000
    { key: 'utility', fen: Y(1500) },                // 水电燃气 1500
    { key: 'other', fen: Y(500) },                   // 杂费 500
  ],
  var_items: [{ key: 'takeawayComm', pct: 8 }],      // 外卖佣金 8%
  gross_margin_pct: 62,                              // 菜品毛利率 62%
  target_profit_fen: Y(10000),                       // 目标月利润 1 万
};

console.log('\n=== 1 正算（forward）· 小面店 ===');
const fwd = run(Object.assign({}, BASE, { mode: 'forward' }));
if (fwd.__ERR__) { console.log('❌ 被拒：', fwd.__ERR__); }
else {
  console.log('建店总投入      ', show(fwd.build_total_fen));
  console.log('月摊销          ', show(fwd.build_amort_monthly_fen));
  console.log('固定（除摊销）  ', show(fwd.fixed_ex_amort_fen));
  console.log('固定合计        ', show(fwd.fixed_total_fen));
  console.log('综合变动成本率  ', fwd.composite_var_rate_pct + '%');
  console.log('边际贡献率      ', fwd.margin_rate_ratio);
  console.log('红警            ', fwd.red_alert);
  console.log('保本月营业额    ', show(fwd.break_even_monthly_fen));
  console.log('保本日均        ', show(fwd.break_even_daily_fen));
  console.log('目标月营收      ', show(fwd.target_monthly_fen));
  console.log('目标日均        ', show(fwd.target_daily_fen));
  console.log('回本周期(月)    ', fwd.payback_months);
}

console.log('\n=== 2 bands_preview（v1.4 的 rentRateDefault 取值来源） ===');
const bp = fwd.bands_preview || indicatorRef.listBands('fastfood', 'tier2');
const rentRow = (bp || []).filter((x) => x.key === 'rent')[0];
console.log('rent 行 =', JSON.stringify(rentRow));
console.log('其余行 =', JSON.stringify((bp || []).map((x) => x.key + ':' + (x.lo != null ? x.lo + '~' + x.hi : '?'))));

console.log('\n=== 3 反推（reverse）· 同一家店，房租改由租金率导出 ===');
const rentHi = rentRow && rentRow.hi != null ? Number(rentRow.hi) : 0;
console.log('派生 target_rent_rate =', rentHi);
const fixedNoRent = BASE.fixed_items.filter((x) => x.key !== 'rent');
const rev = run(Object.assign({}, BASE, {
  mode: 'reverse',
  fixed_items: fixedNoRent,
  rev_price_fen: Y(25),        // 人均 25 元
  seats: 40,                   // 40 座（v1.4：由面积×密度估算，用户可改）
  open_days: 30,
  target_rent_rate: rentHi,
  pixel_eff_fen: 0,            // v1.4：坪效不再问用户 ⇒ 0 ⇒ 面积上限应为 null（不编造）
}));
if (rev.__ERR__) { console.log('❌ 被拒：', rev.__ERR__); }
else {
  console.log('目标月营收 R    ', show(rev.target_monthly_fen));
  console.log('目标日均        ', show(rev.target_daily_fen));
  console.log('房租上限        ', show(rev.rent_cap_fen));
  console.log('月客流          ', rev.monthly_traffic);
  console.log('日均客流        ', rev.daily_traffic);
  console.log('翻台率          ', rev.turn_rate);
  console.log('面积上限(㎡)    ', rev.area_cap_sqm);
  console.log('warn_keys       ', JSON.stringify(rev.warn_keys));
  console.log('red_alert       ', rev.red_alert);
}

console.log('\n=== 4 边界/失败模式（必须 fail-closed，不许静默出数） ===');
const cases = [
  ['4a rev_price_fen=0（L2 客单价没填）', Object.assign({}, BASE, { mode: 'reverse', fixed_items: fixedNoRent, rev_price_fen: 0, seats: 40, open_days: 30, target_rent_rate: rentHi })],
  ['4b seats=0（面积没填 ⇒ 估不出座位）', Object.assign({}, BASE, { mode: 'reverse', fixed_items: fixedNoRent, rev_price_fen: Y(25), seats: 0, open_days: 30, target_rent_rate: rentHi })],
  ['4c open_days=0', Object.assign({}, BASE, { mode: 'reverse', fixed_items: fixedNoRent, rev_price_fen: Y(25), seats: 40, open_days: 0, target_rent_rate: rentHi })],
  ['4d 反推仍带 rent（重复计租）', Object.assign({}, BASE, { mode: 'reverse', rev_price_fen: Y(25), seats: 40, open_days: 30, target_rent_rate: rentHi })],
  ['4e target_rent_rate=0（bands 还没回来）', Object.assign({}, BASE, { mode: 'reverse', fixed_items: fixedNoRent, rev_price_fen: Y(25), seats: 40, open_days: 30, target_rent_rate: 0 })],
  // ⚠️ 首版写 gross_margin_pct=20 期望红警 —— **期望写错了**：食材成本率 80 + 佣金 8 = 88% < 100%
  //    ⇒ 不红警、正常出数是**正确行为**。要真触发红警必须综合变动率 ≥ 100%
  //    ⇒ 毛利率 8（食材 92）+ 佣金 8 = 100%。改对期望，而不是改代码迎合（守卫红先怀疑自己）。
  ['4f 毛利率 8% + 佣金 8% ⇒ 综合变动率=100% ⇒ 红警', Object.assign({}, BASE, { mode: 'forward', gross_margin_pct: 8 })],
  ['4g 反推遇红警 ⇒ 全部派生量必须 null（不编造）', Object.assign({}, BASE, { mode: 'reverse', fixed_items: fixedNoRent, rev_price_fen: Y(25), seats: 40, open_days: 30, target_rent_rate: rentHi, gross_margin_pct: 8 })],
];
for (let i = 0; i < cases.length; i++) {
  const r = run(cases[i][1]);
  let tag;
  if (r.__ERR__) tag = '✅ 被拒：' + r.__ERR__;
  else if (r.red_alert) {
    const allNull = ['target_monthly_fen', 'rent_cap_fen', 'monthly_traffic', 'daily_traffic', 'turn_rate', 'area_cap_sqm']
      .every((k) => k in r ? r[k] === null : true);
    tag = '✅ 红警：R=' + r.target_monthly_fen + ' breakEven=' + r.break_even_monthly_fen
      + (allNull ? ' · 派生量全 null（不编造）' : ' 🔴 派生量未置 null！');
  } else tag = '⚠️ 未拒未红警，出数=' + (r.target_monthly_fen != null ? show(r.target_monthly_fen) : show(r.break_even_monthly_fen));
  console.log(cases[i][0], '⇒', tag);
}

console.log('\n=== 5 v1.4 座位估算（utils/bizPreset.js::estimateSeats） ===');
// ⚠️ 真实 presetKey 是 fastfood_noodle 这种（不是 bizKey）—— 探针必须用真实 key，否则恒空。
const realPresetKeys = BP.BIZ_PRESETS ? BP.BIZ_PRESETS.map((p) => p.presetKey) : [];
console.log('  全部 presetKey =', realPresetKeys.join(' | '));
realPresetKeys.concat(['__不存在的key__']).forEach((k) => {
  const s60 = BP.estimateSeats(k, 60), s100 = BP.estimateSeats(k, 100);
  console.log('  ' + k.padEnd(24), '60㎡ ⇒', (s60 === '' ? '(空·不编造)' : s60 + ' 座'),
    '; 100㎡ ⇒', (s100 === '' ? '(空·不编造)' : s100 + ' 座'),
    '; bizKey=', BP.bizKeyOfPreset(k));
});
console.log('  面积未填(0/空) ⇒', JSON.stringify(BP.estimateSeats('fastfood_noodle', 0)),
  JSON.stringify(BP.estimateSeats('fastfood_noodle', '')));

console.log('\n=== 6 正反一致性（同一家店，反推算出的房租上限 应 ≈ 正算里的房租） ===');
console.log('正算 rent 输入 =', show(Y(6000)));
console.log('反推 rent_cap  =', rev.__ERR__ ? 'N/A' : show(rev.rent_cap_fen));
if (!rev.__ERR__ && rev.rent_cap_fen != null) {
  const d = Math.abs(rev.rent_cap_fen - Y(6000)) / Y(6000) * 100;
  console.log('偏差 =', d.toFixed(1) + '%');
}
