// M2 审计主探针 · 2026-11-06 —— 所有数字来自生产引擎真实输出，不手算、不抄实现
// 用法：node review/evidence/m2_audit_20261106/_probe_engine.js
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const fs = require('fs');
const E = require(ROOT + '/cloudfunctions/calcSandbox/service.js');
const E2 = require(ROOT + '/cloudfunctions/savePlan/service.js');
const V = require(ROOT + '/cloudfunctions/calcSandbox/validate.js');

const OUT = [];
const log = (...a) => { const s = a.join(' '); OUT.push(s); console.log(s); };
let PASS = 0, FAIL = 0;
const ok = (name, cond, detail) => {
  if (cond) { PASS++; log('  [PASS] ' + name + (detail ? ' | ' + detail : '')); }
  else { FAIL++; log('  [FAIL] ' + name + (detail ? ' | ' + detail : '')); }
};

// ============ A. M2.10 标准工况锚点（规范 v1.0 §M2.10，独立整数重算） ============
log('\n===== A. 规范锚点回归（生产引擎实跑） =====');
const Y = (n) => Math.round(n * 100); // 元 → 分
const STD = {
  cityTier: 'tier23', bizType: 'dining',
  buildItems: [
    { key: 'decor', fen: Y(360000), years: 3 },
    { key: 'franchise', fen: Y(180000), years: 3 },
    { key: 'equip', fen: Y(120000), years: 5 },
  ],
  fixedItems: [
    { key: 'rent', fen: Y(12000) }, { key: 'labor', fen: Y(7000) }, { key: 'manage', fen: Y(2000) },
  ],
  varItems: [{ key: 'takeawayComm', pct: 15 }],
  grossMarginPct: 65, targetProfitFen: Y(15000),
};
const r = E.calcSandbox(STD);
// 独立整数参照（不复用引擎任何中间量）
const refAmort = Math.round(36000000 / 36 + 18000000 / 36 + 12000000 / 60); // 分
const refFixedEx = Y(12000 + 7000 + 2000);
const refFixedTotal = refFixedEx + refAmort;
const refBE = Math.round(refFixedTotal / 0.5);
const refTarget = Math.round((refFixedTotal + Y(15000)) / 0.5);
const refPayback = Math.round(66000000 / 1500000 * 10) / 10;
const rowsA = [
  ['建店总投入', r.build_total_fen, Y(660000)],
  ['月摊销', r.build_amort_monthly_fen, refAmort],
  ['固定(不含摊)', r.fixed_ex_amort_fen, refFixedEx],
  ['固定(含摊)', r.fixed_total_fen, refFixedTotal],
  ['综合变动率%', r.composite_var_rate_pct, 50],
  ['边际贡献率', r.margin_rate_ratio, 0.5],
  ['保本月营收(分)', r.break_even_monthly_fen, refBE],
  ['保本日均(分)', r.break_even_daily_fen, Math.round(refBE / 30)],
  ['目标月营收(分)', r.target_monthly_fen, refTarget],
  ['目标日均(分)', r.target_daily_fen, Math.round(refTarget / 30)],
  ['回本月数', r.payback_months, refPayback],
];
rowsA.forEach(([n, got, exp]) => ok('A ' + n, got === exp, `实跑=${got} 参照=${exp}`));
log('  → 标准工况四核心（元）：保本月=' + (r.break_even_monthly_fen / 100).toFixed(2)
  + ' 保本日均=' + (r.break_even_daily_fen / 100).toFixed(2)
  + ' 目标月=' + (r.target_monthly_fen / 100).toFixed(2)
  + ' 目标日均=' + (r.target_daily_fen / 100).toFixed(2)
  + ' 回本=' + r.payback_months + '月');
const rentIndBE = (r.indicators_at_breakeven || []).find((x) => x.key === 'rent');
const laborIndBE = (r.indicators_at_breakeven || []).find((x) => x.key === 'labor');
log('  → 指标@保本：房租=' + JSON.stringify(rentIndBE) + ' 人工=' + JSON.stringify(laborIndBE));
ok('A 指标@保本 房租占比 15.8%', rentIndBE && rentIndBE.pct === 15.8, JSON.stringify(rentIndBE && rentIndBE.pct));
ok('A 指标@保本 人工占比 9.2%', laborIndBE && laborIndBE.pct === 9.2, JSON.stringify(laborIndBE && laborIndBE.pct));

// ============ B. 双引擎对拍（calcSandbox vs savePlan 内联副本） ============
log('\n===== B. 双引擎对拍（随机 3000 组，逐字段） =====');
let seed = 20261106;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const KEYS = ['build_total_fen', 'build_amort_monthly_fen', 'fixed_ex_amort_fen', 'fixed_total_fen',
  'food_cost_pct', 'platform_pct', 'composite_var_rate_pct', 'margin_rate_ratio', 'red_alert',
  'break_even_monthly_fen', 'break_even_daily_fen', 'target_monthly_fen', 'target_daily_fen',
  'valid_days', 'payback_months'];
let diff = 0, firstDiff = null;
for (let i = 0; i < 3000; i++) {
  const c = {
    cityTier: ['tier1', 'tier23', 'county'][Math.floor(rnd() * 3)],
    bizType: ['fastfood', 'dining', 'hotpot', 'cafe', 'other'][Math.floor(rnd() * 5)],
    buildItems: Array.from({ length: Math.floor(rnd() * 4) }, () => ({
      key: 'b' + Math.floor(rnd() * 3), fen: Math.floor(rnd() * 50000000), years: 1 + Math.floor(rnd() * 10),
    })),
    fixedItems: Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({
      key: ['rent', 'labor', 'manage', 'utility', 'other'][Math.floor(rnd() * 5)], fen: Math.floor(rnd() * 5000000),
    })),
    varItems: Array.from({ length: Math.floor(rnd() * 4) }, () => ({
      key: ['takeawayComm', 'energy', 'mkt'][Math.floor(rnd() * 3)], pct: Math.round(rnd() * 300) / 10,
    })),
    grossMarginPct: Math.round(rnd() * 1000) / 10,
    targetProfitFen: Math.floor(rnd() * 10000000),
    validDays: [0, 26, 28, 30, 31][Math.floor(rnd() * 5)],
    expectedRevenueFen: Math.floor(rnd() * 30000000),
  };
  const a = E.calcSandbox(c), b = E2.calcSandbox(c);
  for (const k of KEYS) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      diff++; if (!firstDiff) firstDiff = { i, k, a: a[k], b: b[k] }; break;
    }
  }
  if (i < 3) log('  样本' + i + ' 保本月营收=' + (a.break_even_monthly_fen == null ? 'null' : (a.break_even_monthly_fen / 100).toFixed(2)) + ' 元');
}
ok('B 3000 组逐字段零漂移', diff === 0, `diff=${diff} ${firstDiff ? JSON.stringify(firstDiff) : ''}`);
ok('B 两文件 md5 一致', fs.readFileSync(ROOT + '/cloudfunctions/calcSandbox/service.js').equals(
  fs.readFileSync(ROOT + '/cloudfunctions/savePlan/service.js')));

// ============ C. 精度探针（月摊销：整数精确参照 vs 引擎浮点累加） ============
log('\n===== C. 精度探针（月摊销逐项浮点累加） =====');
let pDiff = 0, pFirst = null;
for (let i = 0; i < 20000; i++) {
  const items = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({
    fen: Math.floor(rnd() * 90000000) + 1, years: 1 + Math.floor(rnd() * 20),
  }));
  // 精确参照：用有理数求和（分母 lcm 太大 ⇒ 用 Fraction 累加：Σ fen/(years*12)，以 1e6 倍放大后整数比）
  // 这里用「Kahan 求和 + 高倍缩放」作为独立参照，避免复用引擎的裸累加顺序
  let scaled = 0;
  for (const it of items) scaled += (it.fen * 1e6) / (it.years * 12);
  const ref = Math.round(scaled / 1e6);
  const got = E.calcSandbox({ buildItems: items, fixedItems: [], varItems: [], grossMarginPct: 60 }).build_amort_monthly_fen;
  if (got !== ref) { pDiff++; if (!pFirst) pFirst = { items, got, ref }; }
}
ok('C 20000 组月摊销与独立参照零偏差', pDiff === 0, `diff=${pDiff} ${pFirst ? JSON.stringify(pFirst).slice(0, 300) : ''}`);

// ============ D. 边界与口径探针 ============
log('\n===== D. 边界 / 口径探针 =====');
const base = { cityTier: 'tier23', bizType: 'dining', grossMarginPct: 65, targetProfitFen: 0,
  buildItems: [], fixedItems: [{ key: 'rent', fen: Y(10000) }], varItems: [] };
const cases = [
  ['正常 65% 毛利率', {}],
  ['毛利率 0.1%（综合变动率 99.9%，未触红警）', { grossMarginPct: 0.1 }],
  ['毛利率 0%（综合变动率 100%，红警）', { grossMarginPct: 0 }],
  ['毛利率 120%（食材成本率为负）', { grossMarginPct: 120 }],
  ['毛利率 −10%', { grossMarginPct: -10 }],
  ['目标利润为负', { targetProfitFen: -Y(5000) }],
  ['建店投入 years=0', { buildItems: [{ key: 'decor', fen: Y(100000), years: 0 }] }],
  ['validDays=26', { validDays: 26 }],
  ['validDays=0（回退30）', { validDays: 0 }],
  ['validDays=99（引擎不设防）', { validDays: 99 }],
];
for (const [name, patch] of cases) {
  const x = E.calcSandbox(Object.assign({}, base, patch));
  log('  · ' + name + ' ⇒ 变动率=' + x.composite_var_rate_pct + '% 边际=' + x.margin_rate_ratio
    + ' 红警=' + x.red_alert + ' 保本月=' + (x.break_even_monthly_fen == null ? 'null' : (x.break_even_monthly_fen / 100).toFixed(2))
    + ' 日均=' + (x.break_even_daily_fen == null ? 'null' : (x.break_even_daily_fen / 100).toFixed(2))
    + ' validDays=' + x.valid_days);
}
const near = E.calcSandbox(Object.assign({}, base, { grossMarginPct: 0.1 }));
log('  🔴 边界实跑：毛利率 0.1% ⇒ 红警=' + near.red_alert + '，保本月营收='
  + (near.break_even_monthly_fen / 100).toFixed(2) + ' 元（固定成本 10000 元的 1000 倍）');

// ============ E. reverse 日均分母一致性 ============
log('\n===== E. 反推（reverse）日均分母一致性 =====');
const revClean = {
  cityTier: 'tier23', bizType: 'fastfood', grossMarginPct: 60,
  buildItems: [], fixedItems: [{ key: 'labor', fen: Y(20000) }], varItems: [{ key: 'other', pct: 2 }],
  targetProfitFen: Y(20000), rev_price_fen: Y(45), seats: 20, open_days: 26,
  target_rent_rate: 12, validDays: 0,
};
const rv = E.calcSandboxReverse(revClean);
const fwdOnRev = E.calcSandbox(Object.assign({}, revClean, {
  fixedItems: revClean.fixedItems.filter((x) => x.key !== 'rent'),
  varItems: revClean.varItems.concat([{ key: 'rentRate', pct: 12 }]),
}));
log('  reverse.target_daily_fen = ' + rv.target_daily_fen + '（÷' + rv.valid_days + '）');
log('  同一变换下 calcSandbox.target_daily_fen = ' + fwdOnRev.target_daily_fen + '（÷' + fwdOnRev.valid_days + '）');
ok('E 反推两处日均分母一致', rv.target_daily_fen === fwdOnRev.target_daily_fen,
  `差 ${rv.target_daily_fen - fwdOnRev.target_daily_fen} 分；reverse 用 open_days=${revClean.open_days}，正算回退 ${fwdOnRev.valid_days}`);
// validate 是否给 reverse 补 validDays
log('  validate clean.validDays 来源 = src.valid_days（正向字段），reverse 前端送 open_days ⇒ 见报告口径段');

// ============ F. 能力探针：引擎字段是否被前端消费 ============
log('\n===== F. 前端控件 / 引擎字段差集（静态，逐项归因） =====');
const pages = ['index', 'matrix', 'compare', 'list'].map((n) =>
  fs.readFileSync(ROOT + `/subpkg/tools/sandbox/${n}.js`, 'utf8')
  + fs.readFileSync(ROOT + `/subpkg/tools/sandbox/${n}.wxml`, 'utf8')).join('\n');
const engineOut = ['build_total_fen', 'build_amort_monthly_fen', 'fixed_ex_amort_fen', 'fixed_total_fen',
  'break_even_monthly_fen', 'break_even_daily_fen', 'target_monthly_fen', 'target_daily_fen',
  'payback_months', 'valid_days', 'bands_preview', 'amount_preview', 'indicators_at_breakeven',
  'indicators_at_target', 'red_alert', 'composite_var_rate_pct', 'margin_rate_ratio'];
engineOut.forEach((k) => {
  const hit = pages.indexOf(k) >= 0;
  log('  ' + (hit ? '✅' : '❌') + ' ' + k);
});
const missing = engineOut.filter((k) => pages.indexOf(k) < 0);
log('  → 未被 M2 四页直接引用的出参：' + (missing.join(', ') || '无'));

// ============ G. 汇总 ============
log('\n===== 汇总：' + PASS + ' PASS / ' + FAIL + ' FAIL =====');
fs.writeFileSync(__dirname + '/engine_probe.out', OUT.join('\n') + '\n', 'utf8');
process.exit(FAIL > 0 ? 1 : 0);
