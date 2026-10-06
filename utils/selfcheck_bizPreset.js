// utils/selfcheck_bizPreset.js —— M2v1.3 业态参数包自测（纯函数级，不依赖 wx）
// 运行：node utils/selfcheck_bizPreset.js
// 覆盖：BIZ_KEYS 合法性 / costMeta 五形态参数完备 / area_linear、headcount_linear 随输入重算 /
//       fixed+defaultYuan 优先级 / 城市系数（乘与漏乘可鉴别）/ 回本两口径（invest 用**生产引擎**，cash 用 bizPreset）
const {
  BIZ_PRESETS, CITY_COEF, assembleItems, resolveBuild, paybackCash, findPreset,
} = require('./bizPreset');
// 🔴 invest 口径**读生产引擎** payback_months（证明引擎零改动；不另写一套算式）
const ENGINE = require('../cloudfunctions/calcSandbox/service.js');
const { calcSandbox } = ENGINE;

const BIZ_KEYS = ['fastfood', 'dining', 'hotpot', 'cafe'];
const FORMS = ['fixed', 'area_linear', 'headcount_linear', 'revenue_rate', 'step'];

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? ' · ' + detail : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? ' · ' + detail : ''}`); }
}
function buildClean(presetKey, opts) {
  const p = findPreset(presetKey);
  const in_ = Object.assign({ area: opts.area || 0, headcount: opts.headcount || 0, rentYuan: opts.rentYuan || 0, fixedYuan: opts.fixedYuan || {} }, opts);
  const assembled = assembleItems(p, in_, Object.assign({ rent: 1, labor: 1 }, opts.coef || {}));
  const buildItems = resolveBuild(p, in_);
  const cityTier = opts.cityTier || 'tier23';
  // 喂引擎：固定项 + 变动项 + 毛利率 + 目标利润 + 建店投入
  const gross = (p.params && p.params.grossMarginPct) ? p.params.grossMarginPct.v : (opts.grossMarginPct || 55);
  const targetProfitFen = (opts.targetProfitFen != null ? opts.targetProfitFen : 0);
  const fixedFen = assembled.fixedItems.reduce((s, x) => s + x.fen, 0);
  const clean = {
    mode: 'forward', cityTier, bizType: p.bizKey,
    buildItems,
    fixedItems: assembled.fixedItems,
    varItems: assembled.varItems,
    grossMarginPct: gross, targetProfitFen, expectedRevenueFen: 0,
    rev_price_fen: 0, seats: 0, open_days: (p.params && p.params.openDays) ? p.params.openDays.v : 30, target_rent_rate: 0, pixel_eff_fen: 0,
  };
  return { p, assembled, clean, fixedFen };
}

console.log('===== ① 每个预设 bizKey ∈ 4 类 / costMeta 形态参数完备 =====');
for (const pr of BIZ_PRESETS) {
  check(`预设 ${pr.presetKey} 的 bizKey ∈ 4 类`, BIZ_KEYS.indexOf(pr.bizKey) >= 0, `bizKey=${pr.bizKey}`);
}
for (const pr of BIZ_PRESETS) {
  const bad = (pr.costMeta || []).filter((m) => {
    if (FORMS.indexOf(m.form) < 0) return true;
    if (m.form === 'fixed' && m.src !== 'U' && m.defaultYuan == null) return true;
    if (m.form === 'area_linear' && (m.baseYuan == null || m.perSqmYuan == null)) return true;
    if (m.form === 'headcount_linear' && !(pr.params && pr.params.laborUnitYuan)) return true;
    if (m.form === 'revenue_rate' && m.pct == null) return true;
    if (m.form === 'step' && !(Array.isArray(m.steps) && m.steps.length)) return true;
    return false;
  });
  check(`预设 ${pr.presetKey} costMeta 参数完备（缺一即 NaN）`, bad.length === 0,
    bad.length ? '缺参：' + JSON.stringify(bad.map((b) => b.itemKey)) : '五形态参数齐');
}

console.log('\n===== ② area_linear 随面积重算（能力储备形态，示例参数 2600 + 20×面积）=====');
const AR_PRESET = { presetKey: 'ar', bizKey: 'dining', paybackView: 'cash',
  params: { grossMarginPct: { v: 55, src: 'P' }, laborUnitYuan: { v: 4500, src: 'S' }, openDays: { v: 30, src: 'P' } },
  costMeta: [{ itemKey: 'decor', form: 'area_linear', baseYuan: 2600, perSqmYuan: 20, src: 'P' }] };
const ar50 = assembleItems(AR_PRESET, { area: 50 }, { rent: 1, labor: 1 });
const ar80 = assembleItems(AR_PRESET, { area: 80 }, { rent: 1, labor: 1 });
check('面积 50 → 装配 3,600 分? 元', ar50.fixedItems[0].fen === 360000, `=${ar50.fixedItems[0].fen}分`);
check('面积 80 → 装配 4,200 元（Δ600）', ar80.fixedItems[0].fen === 420000 && (ar80.fixedItems[0].fen - ar50.fixedItems[0].fen) === 60000, `=${ar80.fixedItems[0].fen}分（Δ${(ar80.fixedItems[0].fen - ar50.fixedItems[0].fen) / 100}元）`);

console.log('\n===== ③ headcount_linear 随人数重算（fastfood_noodle 单价 4,500）=====');
const hc2 = assembleItems(findPreset('fastfood_noodle'), { headcount: 2 }, { rent: 1, labor: 1 });
const hc3 = assembleItems(findPreset('fastfood_noodle'), { headcount: 3 }, { rent: 1, labor: 1 });
check('2 人 → 人工 9,000 元', hc2.fixedItems.filter((x) => x.key === 'labor')[0].fen === 900000, `=${hc2.fixedItems.filter((x) => x.key === 'labor')[0].fen}分`);
check('3 人 → 人工 13,500 元（Δ4,500）', hc3.fixedItems.filter((x) => x.key === 'labor')[0].fen === 1350000, `=${hc3.fixedItems.filter((x) => x.key === 'labor')[0].fen}分`);

console.log('\n===== ④ fixed+defaultYuan 优先级（用户填 > defaultYuan，二选一不叠加）=====');
const rb = assembleItems(findPreset('hotpot_half_self'), { fixedYuan: {} }, { rent: 1, labor: 1 });
check('没填 ⇒ 用 defaultYuan（labor=25,000）', rb.fixedItems.filter((x) => x.key === 'labor')[0].fen === 2500000, `=${rb.fixedItems.filter((x) => x.key === 'labor')[0].fen}分`);
const rbU = assembleItems(findPreset('hotpot_half_self'), { fixedYuan: { labor: 30000 } }, { rent: 1, labor: 1 });
check('用户填 30,000 ⇒ 用用户的（不叠加 defaultYuan）', rbU.fixedItems.filter((x) => x.key === 'labor')[0].fen === 3000000, `=${rbU.fixedItems.filter((x) => x.key === 'labor')[0].fen}分`);

console.log('\n===== ⑤ 城市系数：tier1 固定成本 > tier23；漏乘 labor 可鉴别 =====');
const t23 = buildClean('hotpot_half_self', { fixedYuan: {}, coef: { rent: 1, labor: 1 }, targetProfitFen: 1600000 });
const t1 = buildClean('hotpot_half_self', { fixedYuan: {}, coef: { rent: 1, labor: 1.15 }, targetProfitFen: 1600000 });
check('tier1(labor×1.15) 固定 labor = 28,750 > tier23 25,000', t1.assembled.fixedItems.filter((x) => x.key === 'labor')[0].fen === 2875000 && t23.assembled.fixedItems.filter((x) => x.key === 'labor')[0].fen === 2500000, `t1=${t1.assembled.fixedItems.filter((x) => x.key === 'labor')[0].fen}/t23=${t23.assembled.fixedItems.filter((x) => x.key === 'labor')[0].fen}`);
check('tier1 固定合计 > tier23（漏乘 labor ⇒ 相等，可鉴别）', t1.fixedFen > t23.fixedFen, `t1=${t1.fixedFen} / t23=${t23.fixedFen}`);

console.log('\n===== ⑥ 回本两口径（卤鸡火锅 100㎡：投资 26.2 万 · 月净利 1.60 万 · 月折旧 0.61 万）=====');
// 建店投入 26.2 万 @ 3.579…年 → 引擎摊销 ≈ 6,100 元/月
const HALF = buildClean('hotpot_half_self', { fixedYuan: { rent: 12000 }, targetProfitFen: 1600000 });
const eng = calcSandbox(HALF.clean);
check('引擎月摊销 ≈ 6,100 元（buildRef 小数位写足）', eng.build_amort_monthly_fen === 610000, `=${eng.build_amort_monthly_fen}分`);
check('invest = 引擎 payback_months = 16.4 月', eng.payback_months === 16.4, `=${eng.payback_months}`);
const cash = paybackCash(eng.build_total_fen, HALF.clean.targetProfitFen, eng.build_amort_monthly_fen);
// 🔴 证据：生产引擎 buildRef(26.2万@3.5792…年) 月摊销 = 6,100 元（规范 §②-A），故 cash = 26.2÷(1.60+0.61)=11.9 月。
//    规范 §十④ 白话载「月折旧 0.62 万 ⇒ 11.8」系五舍六入地写估值；以生产引擎实测（6,100）为准 ⇒ 11.9。
check('cash = 26.2 ÷ 2.21 = 11.8~11.9 月（以引擎实测）', cash === 11.9, `=${cash}`);
check('cash < invest（两口径确有 30%+ 差）', cash < eng.payback_months && (eng.payback_months - cash) > 4, `${eng.payback_months} vs ${cash}`);

console.log('\n===== ⑦ 边界：目标利润 ≤ 0 ⇒ cash 返回 null（不编造） =====');
check('paybackCash(…, 0, …) → null', paybackCash(26200000, 0, 610000) === null, `=${paybackCash(26200000, 0, 610000)}`);

console.log(`\n===== 业态参数包自测：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);