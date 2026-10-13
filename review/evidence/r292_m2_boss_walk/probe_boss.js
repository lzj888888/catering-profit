// R292 · M2「餐饮老板视角」实跑探针
// 目的：用真实老板场景跑通【装配 → 校验 → 引擎】全链路，输出可被餐饮常识判读的数字。
// 🔴 不编造结论：只打印引擎真实出参 + 常识区间对照，判读留给人。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');

const bp = require(path.join(ROOT, 'utils/bizPreset.js'));
const svc = require(path.join(ROOT, 'cloudfunctions/calcSandbox/service.js'));
const val = require(path.join(ROOT, 'cloudfunctions/calcSandbox/validate.js'));
const ref = require(path.join(ROOT, 'cloudfunctions/common/indicatorRef.js'));

const Y = (yuan) => Math.round(Number(yuan) * 100);

// ===== 老板场景库（真实门店量级，非编造）=====
const CASES = [
  {
    name: 'A · 县城小面馆（李老板）',
    desc: '60㎡ / 房租3000 / 2人 / 客单12 / 目标月利8000',
    presetKey: 'fastfood_noodle', cityKey: 'county',
    area: 60, headcount: 2, laborUnitYuan: 3200, rentYuan: 3000,
    marginPct: 55, targetYuan: 8000, expectYuan: 60000,
    avgPriceYuan: 12, openDays: 30, tables: 8,
  },
  {
    name: 'B · 二线火锅半自助（王老板）',
    desc: '120㎡ / 房租12000 / 8人 / 客单65 / 目标月利30000',
    presetKey: 'hotpot_half_self', cityKey: 'tier23',
    area: 120, headcount: 8, laborUnitYuan: 4000, rentYuan: 12000,
    marginPct: 53, targetYuan: 30000, expectYuan: 250000,
    avgPriceYuan: 65, openDays: 30, tables: 20,
  },
  {
    name: 'C · 一线快餐（张老板）',
    desc: '50㎡ / 房租15000 / 4人 / 客单20 / 目标月利20000',
    presetKey: 'fastfood_noodle', cityKey: 'tier1',
    area: 50, headcount: 4, laborUnitYuan: 6000, rentYuan: 15000,
    marginPct: 55, targetYuan: 20000, expectYuan: 180000,
    avgPriceYuan: 20, openDays: 30, tables: 8,
  },
  {
    name: 'D · 三线川菜正餐（陈老板）',
    desc: '200㎡ / 房租8000 / 6人 / 客单55 / 目标月利25000',
    presetKey: 'dining_sichuan', cityKey: 'tier23',
    area: 200, headcount: 6, laborUnitYuan: 4500, rentYuan: 8000,
    marginPct: 60, targetYuan: 25000, expectYuan: 200000,
    avgPriceYuan: 55, openDays: 30, tables: 18,
  },
  {
    name: 'E · 二线新式茶饮（小美）',
    desc: '30㎡ / 房租6000 / 2人 / 客单15 / 目标月利10000',
    presetKey: 'cafe_tea', cityKey: 'tier23',
    area: 30, headcount: 2, laborUnitYuan: 4200, rentYuan: 6000,
    marginPct: 67, targetYuan: 10000, expectYuan: 60000,
    avgPriceYuan: 15, openDays: 30, tables: 4,
  },
  {
    name: 'F · 二线烧烤（刘老板）',
    desc: '100㎡ / 房租10000 / 5人 / 客单60 / 目标月利25000',
    presetKey: 'hotpot_barbecue', cityKey: 'tier23',
    area: 100, headcount: 5, laborUnitYuan: 4200, rentYuan: 10000,
    marginPct: 59, targetYuan: 25000, expectYuan: 160000,
    avgPriceYuan: 60, openDays: 30, tables: 16,
  },
];

const fmt = (fen) => fen == null ? 'null' : '¥' + (fen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 });

function runForward(k) {
  const preset = bp.findPreset(k.presetKey);
  const coef = Object.assign({ rent: 1, labor: 1 }, bp.CITY_COEF[k.cityKey] || {});
  // 复刻 buildPresetParam('forward') 的输入装配
  const input = {
    area: k.area, headcount: k.headcount, laborUnitYuan: k.laborUnitYuan,
    rentYuan: k.rentYuan,
    fixedYuan: { rent: k.rentYuan },
    buildItems: [],
  };
  const asm = bp.assembleItems(preset, input, coef);
  const buildItems = bp.resolveBuild(preset, input);
  const seats = k.tables * bp.seatsPerTableOf(preset.bizKey);

  const wire = {
    shop_id: 'boss-probe', mode: 'forward',
    city_tier: k.cityKey, biz_type: preset.bizKey,
    build_items: buildItems.map((b) => ({ key: b.key, fen: b.fen, years: b.years })),
    fixed_items: asm.fixedItems,
    var_items: asm.varItems,
    gross_margin_pct: k.marginPct,
    target_profit_fen: Y(k.targetYuan),
    expected_revenue_fen: Y(k.expectYuan),
    valid_days: k.openDays,
  };
  const v = val.validateInput(wire);
  if (v.error) return { err: v.msg || v.error };
  const d = svc.calcSandbox(v.clean);
  return { preset, asm, buildItems, d, seats };
}

function runReverse(k) {
  const preset = bp.findPreset(k.presetKey);
  const coef = Object.assign({ rent: 1, labor: 1 }, bp.CITY_COEF[k.cityKey] || {});
  const input = {
    area: k.area, headcount: k.headcount, laborUnitYuan: k.laborUnitYuan,
    rentYuan: 0, fixedYuan: {}, buildItems: [],
  };
  const asm = bp.assembleItems(preset, input, coef);
  const fixedItems = asm.fixedItems.filter((x) => x.key !== 'rent');
  const buildItems = bp.resolveBuild(preset, input);
  const seats = k.tables * bp.seatsPerTableOf(preset.bizKey);
  // 反推租金率 = 该业态×城市 BANDS.rent 的健康上限（页面 rentRateDefault 口径）
  const band = ref.bandOf(preset.bizKey, 'rent', k.cityKey);
  const rentRate = band ? band.hi : 10;

  const wire = {
    shop_id: 'boss-probe', mode: 'reverse',
    city_tier: k.cityKey, biz_type: preset.bizKey,
    build_items: buildItems.map((b) => ({ key: b.key, fen: b.fen, years: b.years })),
    fixed_items: fixedItems,
    var_items: asm.varItems,
    gross_margin_pct: k.marginPct,
    target_profit_fen: Y(k.targetYuan),
    expected_revenue_fen: Y(k.expectYuan),
    rev_price_fen: Y(k.avgPriceYuan),
    seats,
    open_days: k.openDays,
    target_rent_rate: rentRate,
    pixel_eff_fen: 0,
  };
  const v = val.validateInput(wire);
  if (v.error) return { err: v.msg || v.error };
  const d = svc.calcSandboxReverse(v.clean);
  return { preset, asm, buildItems, d, seats, rentRate };
}

const out = [];
console.log('════════════════════════════════════════════════════════');
console.log(' R292 · M2 餐饮老板视角实跑（正向 已有铺面）');
console.log('════════════════════════════════════════════════════════');
for (const k of CASES) {
  const r = runForward(k);
  console.log('\n──── ' + k.name + ' ────');
  console.log('  ' + k.desc);
  if (r.err) { console.log('  ❌ 校验拒绝：' + r.err); out.push({ name: k.name, err: r.err }); continue; }
  const d = r.d;
  const fixedMap = {};
  r.asm.fixedItems.forEach((x) => { fixedMap[x.key] = x.fen; });
  console.log('  入参 fixed_items : ' + r.asm.fixedItems.map((x) => `${x.key}=${fmt(x.fen)}`).join(' | '));
  console.log('  入参 var_items   : ' + r.asm.varItems.map((x) => `${x.key} ${x.pct}%`).join(' | ') || '  (空)');
  console.log('  建店投入(总)     : ' + fmt(d.build_total_fen) + '   月摊销 ' + fmt(d.build_amort_monthly_fen));
  console.log('  固定成本合计/月  : ' + fmt(d.fixed_total_fen) + '  (不含摊销 ' + fmt(d.fixed_ex_amort_fen) + ')');
  console.log('  综合变动成本率   : ' + d.composite_var_rate_pct + '%   边际贡献率 ' + (d.margin_rate_ratio * 100).toFixed(2) + '%');
  console.log('  保本月营业额     : ' + fmt(d.break_even_monthly_fen) + '   日均 ' + fmt(d.break_even_daily_fen));
  console.log('  目标利润月营收   : ' + fmt(d.target_monthly_fen) + '   日均 ' + fmt(d.target_daily_fen));
  console.log('  回本周期(引擎)   : ' + (d.payback_months == null ? 'null' : d.payback_months + ' 月'));
  console.log('  ── 指标对照（分母=目标利润月营收）──');
  for (const i of d.indicators_at_target) {
    const rl = i.redlineHit ? '  ⚠️命中警戒线' : '';
    console.log(`     ${i.key.padEnd(12)} ${String(i.pct).padStart(6)}%  带[${i.lo},${i.hi}]  ${i.level}${rl}`);
  }
  out.push({ name: k.name, bizKey: r.preset.bizKey, cityKey: k.cityKey, fixedMap, d });
}

console.log('\n\n════════════════════════════════════════════════════════');
console.log(' R292 · M2 餐饮老板视角实跑（反向 寻找铺面）');
console.log('════════════════════════════════════════════════════════');
const outR = [];
for (const k of CASES) {
  const r = runReverse(k);
  console.log('\n──── ' + k.name + ' ────');
  if (r.err) { console.log('  ❌ 校验拒绝：' + r.err); outR.push({ name: k.name, err: r.err }); continue; }
  const d = r.d;
  console.log('  入参 fixed_items : ' + r.asm.fixedItems.filter((x) => x.key !== 'rent').map((x) => `${x.key}=${fmt(x.fen)}`).join(' | '));
  console.log('  var_items+租金率 : ' + r.asm.varItems.map((x) => `${x.key} ${x.pct}%`).join(' | ') + ' | rentRate ' + r.rentRate + '%');
  console.log('  座位数(桌' + k.tables + '×' + bp.seatsPerTableOf(r.preset.bizKey) + ')  : ' + r.seats);
  console.log('  目标月营收 R     : ' + fmt(d.target_monthly_fen) + '   日均 ' + fmt(d.target_daily_fen));
  console.log('  房租上限         : ' + fmt(d.rent_cap_fen));
  console.log('  月客流/日客流    : ' + d.monthly_traffic + ' / ' + d.daily_traffic);
  console.log('  周转率           : ' + d.turn_rate + '  (' + bp.turnModeOf(r.preset.bizKey) + ') 难度=' + bp.turnLevelOf(bp.turnModeOf(r.preset.bizKey), d.turn_rate));
  outR.push({ name: k.name, d, rentRate: r.rentRate, seats: r.seats });
}

require('fs').writeFileSync(
  path.join(__dirname, 'report.json'),
  JSON.stringify({ forward: out, reverse: outR }, null, 2), 'utf8');
console.log('\n\n[report.json 已写出]');
