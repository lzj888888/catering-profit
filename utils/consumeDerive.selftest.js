// utils/consumeDerive.selftest.js —— 耗用核查核心守卫（纯 node 直跑）
// 运行： node utils/consumeDerive.selftest.js
//
// 🔴 本文件不只测「算得对」，还测三件更要命的事：
//   ① **恒等式**：「耗用偏差」与「采购偏差」必须是同一个数（否则两个问法给出两个答案，老板会疯）
//   ② **四种「算不了」必须真的拦住**，且**不能把缺失当 0**（那是本仓最贵的错误类型）
//   ③ **反恒真**：故意构造"看起来正常其实是错"的样本，证明这些判据不是空转
const { consumeVariance, qtyCoverageOf, missingOf, REASONS, MIN_QTY_COVERAGE } = require('./consumeDerive.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ---------- 夹具：严格照抄云函数真实出参结构 ----------
// getDishReview(full)：{ tier, dine_in[{dish_key,qty,totalCostFen,...}], totals{qty,amountFen,costFen,...}, unmatched }
function mkReview(opts) {
  const o = opts || {};
  const ranked = o.ranked || [];
  const unmatchedQty = o.unmatchedQty || 0;
  const totals = {
    qty: ranked.reduce((s, x) => s + x.qty, 0) + unmatchedQty,
    amountFen: 0,
    costFen: ranked.reduce((s, x) => s + x.totalCostFen, 0),
    grossFen: 0,
    dishCount: ranked.length,
    unmatchedCount: unmatchedQty > 0 ? 1 : 0,
  };
  return o.tier === 'free'
    // 🔴 free 档真实返回：totals **没有** costFen（getDishReview/index.js 免费分支只回 qty/amountFen/dishCount/unmatchedCount）
    ? { tier: 'free', free_top: [], totals: { qty: totals.qty, amountFen: 0, dishCount: ranked.length, unmatchedCount: totals.unmatchedCount } }
    : { tier: 'full', dine_in: ranked, totals, unmatched: [] };
}
// getLedger：{ inventory{opening_fen,purchase_fen,closing_fen}, result{real_consume_fen,...}, switches{inventorySwitchOn} }
function mkLedger(opening, purchase, closing, extra) {
  const e = extra || {};
  const actual = opening + purchase - closing;
  return {
    inventory: { opening_fen: opening, purchase_fen: purchase, closing_fen: closing },
    result: { real_consume_fen: (e.engineActual !== undefined ? e.engineActual : actual) },
    switches: { inventorySwitchOn: (e.switchOn !== undefined ? e.switchOn : true) },
    opening_auto: false,
  };
}

// 三张卡：销量 200/150/80 份，单份成本 1400/1000/1900 分 ⇒ 理论耗用 5,820 元 = 582000 分
const RANKED = [
  { dish_key: 'd1', qty: 200, totalCostFen: 200 * 1400 },
  { dish_key: 'd2', qty: 150, totalCostFen: 150 * 1000 },
  { dish_key: 'd3', qty: 80, totalCostFen: 80 * 1900 },
];
const THEORY_FEN = 582000;   // 5820 元

// ===== 1) 正常场景全链路 =====
// 期初 1.2万(1200000) + 采购 2万(2000000) − 期末 1.5万(1500000) = 实际 1.7万(1700000)
{
  const r = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: mkReview({ ranked: RANKED }) });
  check('正常：ok', r.ok === true);
  check('正常：理论耗用 = 5820 元', r.theoreticalFen === THEORY_FEN, '=' + r.theoreticalFen);
  check('正常：实际耗用 = 17000 元', r.actualFen === 1700000, '=' + r.actualFen);
  check('正常：偏差 = 11180 元', r.varianceFen === 1118000, '=' + r.varianceFen);
  check('正常：偏差率 = 192.1%', r.variancePct === 192.1, '=' + r.variancePct);
  check('正常：应有采购 = 8820 元', r.shouldPurchaseFen === 882000, '=' + r.shouldPurchaseFen);
  check('正常：销量覆盖率 = 100%', r.qtyCoverage === 1);
  check('正常：交叉印证一致', r.crossCheckOk === true);
}

// ===== 2) 🔴 恒等式：两个问法必须同一个答案（多组数据）=====
{
  const cases = [
    [1200000, 2000000, 1500000],
    [0, 3000000, 0],             // 期初期末都是 0
    [5000000, 1000000, 4000000], // 期末 > 期初（采购少）
    [300000, 900000, 1000000],   // 期末 > 期初+采购 ⇒ 实际耗用为负（数据异常但仍须自洽）
  ];
  let allEq = true;
  const details = [];
  for (const [o, p, c] of cases) {
    const r = consumeVariance({ ledger: mkLedger(o, p, c), review: mkReview({ ranked: RANKED }) });
    if (!r.ok || r.purchaseVarianceFen !== r.varianceFen) { allEq = false; details.push(`${o}/${p}/${c}:${r.varianceFen}≠${r.purchaseVarianceFen}`); }
  }
  check('代数恒等：4 组数据下「耗用偏差」≡「以实际期末为基准的采购偏差」（≠ 买多买少的判据）', allEq, details.join(',') || '全部相等');
}

// ===== 3) 🔴 反恒真：把 costFen 删掉必须判 unpaid，绝不能当 0 =====
{
  const freeReview = mkReview({ ranked: RANKED, tier: 'free' });
  check('反恒真：free 档 totals 确实没有 costFen', typeof freeReview.totals.costFen === 'undefined');
  const r = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: freeReview });
  check('免费层 ⇒ reason=unpaid（不是算出巨大偏差）', r.ok === false && r.reason === REASONS.UNPAID, r.reason);

  // 更狠：full 档但 costFen 被抹掉（契约漂移）也必须拦住
  const broken = mkReview({ ranked: RANKED });
  delete broken.totals.costFen;
  const r2 = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: broken });
  check('反恒真：full 但缺 costFen ⇒ 仍判 unpaid', r2.ok === false && r2.reason === REASONS.UNPAID, r2.reason);
}

// ===== 4) 没销量 ⇒ no_sales =====
{
  const r = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: mkReview({ ranked: [] }) });
  check('没销量 ⇒ no_sales', r.ok === false && r.reason === REASONS.NO_SALES, r.reason);
  const r2 = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: null });
  check('review 为 null ⇒ 也判 no_sales（不崩）', r2.ok === false && r2.reason === REASONS.NO_SALES, r2.reason);
}

// ===== 5) 库存没填 ⇒ no_inventory（两种成因都拦）=====
{
  const r = consumeVariance({ ledger: mkLedger(0, 0, 0), review: mkReview({ ranked: RANKED }) });
  check('三栏全 0 ⇒ no_inventory（不当作"这月没用料"）', r.ok === false && r.reason === REASONS.NO_INVENTORY, r.reason);
  const r2 = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000, { switchOn: false }), review: mkReview({ ranked: RANKED }) });
  check('库存开关关 ⇒ no_inventory', r2.ok === false && r2.reason === REASONS.NO_INVENTORY, r2.reason);
}

// ===== 6) 覆盖率闸门（含边界与反恒真）=====
{
  // 已建卡 430 份、未匹配 500 份 ⇒ 覆盖率 430/930 = 46.2% < 90% ⇒ 抑制
  const low = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: mkReview({ ranked: RANKED, unmatchedQty: 500 }) });
  check('覆盖率 46.2% ⇒ coverage_low', low.ok === false && low.reason === REASONS.COVERAGE_LOW, low.reason);
  check('coverage_low 时仍回报真实覆盖率供页面解释', low.qtyCoverage === 0.46, '=' + low.qtyCoverage);

  // 🔴 反恒真（本轮最贵的修正）：覆盖率 71% 但「真实偏差 = 0」的样本必须被拦住，
  //   而不是显示一个虚高的偏差。实测未拦住时 71% 覆盖率会显示 +93.7% ⇒ 老板会去冤枉厨师。
  //   构造：已建卡 710 份成本 7100 元；总销量 1000 份；账上实际耗用正好 = 7100/0.71 = 10000 元（真实偏差 0）
  const PART = [{ dish_key: 'd1', qty: 710, totalCostFen: 710000  /* 7100 元 */ }];
  const part = consumeVariance({
    ledger: mkLedger(0, 1000000, 0),   // 实际耗用 = 10000 元 = 理论外推值 ⇒ 真实偏差 0
    review: mkReview({ ranked: PART, unmatchedQty: 290 }),
  });
  check('反恒真：覆盖率 71% + 真实偏差 0 ⇒ 必须拦住（不能显示虚高偏差）',
    part.ok === false && part.reason === REASONS.COVERAGE_LOW, part.ok ? ('给出了偏差 ' + part.variancePct + '%') : part.reason);

  // 恰好 90%：已建卡 900 份、未匹配 100 份 ⇒ 0.9，必须**放行**（下界取 ≥，不是 >）
  const NINE_HUNDRED = [{ dish_key: 'd9', qty: 900, totalCostFen: 900 * 1000 }];
  const edge = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: mkReview({ ranked: NINE_HUNDRED, unmatchedQty: 100 }) });
  check('覆盖率恰好 90% ⇒ 放行（下界是 ≥ 不是 >）', edge.ok === true, edge.reason || 'ok');
  check('覆盖率恰好 90% 时 qtyCoverage = 0.9', edge.qtyCoverage === 0.9, '=' + edge.qtyCoverage);
  check('MIN_QTY_COVERAGE 常量与判据同源（0.9，实测从 0.6 上调）', MIN_QTY_COVERAGE === 0.9);
}

// ===== 6b) 按覆盖率外推：理论耗用必须放大到全量，且标明是估算 =====
{
  // 覆盖率 90%：实算 9000 元 ⇒ 外推全量 = 9000/0.9 = 10000 元
  const NINE_HUNDRED = [{ dish_key: 'd9', qty: 900, totalCostFen: 900000  /* 9000 元 */ }];
  const r = consumeVariance({ ledger: mkLedger(0, 1000000, 0), review: mkReview({ ranked: NINE_HUNDRED, unmatchedQty: 100 }) });
  check('外推：实算 9000 元 / 覆盖 90% ⇒ 理论耗用 10000 元', r.ok === true && r.theoreticalFen === 1000000, '=' + r.theoreticalFen);
  check('外推：theoryMatchedFen 保留实算值 9000 元（不被外推污染）', r.theoryMatchedFen === 900000, '=' + r.theoryMatchedFen);
  check('外推：extrapolated=true（页面须标明"含未建卡按比例估算"）', r.extrapolated === true);
  check('外推：真实偏差 0 时外推后偏差率应 ≈ 0', Math.abs(r.variancePct) < 0.01, '=' + r.variancePct);

  // 全覆盖时不得外推（extrapolated=false），且两个口径相等 —— 反恒真：防"永远打估算标"
  const full = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: mkReview({ ranked: RANKED }) });
  check('全覆盖 ⇒ extrapolated=false（不滥用"估算"标注）', full.extrapolated === false);
  check('全覆盖 ⇒ theoreticalFen === theoryMatchedFen', full.theoreticalFen === full.theoryMatchedFen);
}

// ===== 7) 理论耗用为 0 ⇒ zero_theory（不许除零）=====
{
  const zeroCost = [{ dish_key: 'd1', qty: 100, totalCostFen: 0 }];
  const r = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000), review: mkReview({ ranked: zeroCost }) });
  check('理论耗用 0 ⇒ zero_theory', r.ok === false && r.reason === REASONS.ZERO_THEORY, r.reason);
  check('zero_theory 仍回实际耗用（页面可解释"账上用了 1.7 万"）', r.actualFen === 1700000, '=' + r.actualFen);
}

// ===== 8) 交叉印证：引擎值与三栏直算不一致 ⇒ 提示但不出错数 =====
{
  const r = consumeVariance({ ledger: mkLedger(1200000, 2000000, 1500000, { engineActual: 1600000 }), review: mkReview({ ranked: RANKED }) });
  check('交叉印证不一致 ⇒ crossCheckOk=false', r.crossCheckOk === false);
  check('但本模块仍以「三栏直算」为准（17000 元）', r.actualFen === 1700000, '=' + r.actualFen);
}

// ===== 9) 少用（负偏差）也能算 =====
{
  // 实际只用 5000 元 < 理论 5820 元 ⇒ 偏差 −820 元（省了）
  const r = consumeVariance({ ledger: mkLedger(1000000, 300000, 800000), review: mkReview({ ranked: RANKED }) });
  check('少用时偏差为负', r.ok === true && r.varianceFen === 500000 - THEORY_FEN, '=' + r.varianceFen);
  check('少用时偏差率为负', r.ok === true && r.variancePct < 0, '=' + r.variancePct);
}

// ===== 10) 覆盖率函数本身 =====
{
  const qc = qtyCoverageOf(mkReview({ ranked: RANKED, unmatchedQty: 100 }));
  check('qtyCoverageOf：430/(430+100) = 0.81（比率，非百分数）', qc.coverage === 0.81, '=' + qc.coverage);
  check('qtyCoverageOf：matchedQty/totalQty 各自正确', qc.matchedQty === 430 && qc.totalQty === 530);
  const qc0 = qtyCoverageOf({ totals: { qty: 0 } });
  check('qtyCoverageOf：总销量 0 ⇒ coverage null（不返回 0 冒充"全覆盖率差"）', qc0.coverage === null);
}

// ===== 11) 「算不了」必须给出正确去向 =====
{
  const m1 = missingOf(REASONS.NO_SALES);
  const m2 = missingOf(REASONS.NO_INVENTORY);
  const m3 = missingOf(REASONS.UNPAID);
  check('缺销量 ⇒ 引导去排行榜页', m1.labelKey === 'reconConsumeNeedSales' && m1.url === '/pages/m3/dishreview/index');
  check('缺库存 ⇒ 引导去库存页', m2.labelKey === 'reconConsumeNeedInventory' && m2.url === '/subpkg/biz/month/inventory');
  check('免费层 ⇒ 只给文案不给跳转（升级是付费墙的事）', m3.labelKey === 'reconConsumeNeedUpgrade' && m3.url === '');
  check('未知 reason 有兜底键（不返回 undefined）', typeof missingOf('whatever').labelKey === 'string');
}

// ===== 12) 🔴 键名必须真实存在于 TERMS.card（防静默空白：本仓「wxml 用了但没登记」踩过多次）=====
{
  const { TERMS } = require('../miniprogram/i18n/terms.js');
  const reasons = [REASONS.NO_SALES, REASONS.NO_INVENTORY, REASONS.UNPAID, REASONS.COVERAGE_LOW, REASONS.ZERO_THEORY, 'unknown'];
  const missing = [];
  for (const r of reasons) {
    const k = missingOf(r).labelKey;
    if (!TERMS.card || typeof TERMS.card[k] !== 'string' || !TERMS.card[k]) missing.push(r + '→' + k);
  }
  check('missingOf 的每个 labelKey 都在 TERMS.card 里真实存在', missing.length === 0, missing.join(',') || '全部命中');

  // 反向：页面段二 wxml 用到的 17 个键也必须在场（漏一个就是一处静默空白）
  const pageKeys = [
    'reconConsumeTitle', 'reconConsumeWhatFor', 'reconConsumeTheoryLabel', 'reconConsumeActualLabel',
    'reconConsumeVarianceLabel', 'reconConsumeShouldPurchase', 'reconConsumeActualPurchaseLabel',
    'reconConsumeCoverageNote', 'reconConsumeNoJudge', 'reconConsumeCrossWarn', 'reconConsumeGoFix',
    'reconConsumeTheoryEst',
    // 第一期（非销售耗用）五个
    'reconConsumeNonsales', 'reconConsumeNonsalesPh', 'reconConsumeNonsalesWhy',
    'reconConsumeReal', 'reconConsumeRealNote',
  ];
  const missPage = pageKeys.filter((k) => typeof TERMS.card[k] !== 'string' || !TERMS.card[k]);
  check('页面段二 17 个文案键全部存在', missPage.length === 0, missPage.join(',') || '全部命中');

  // 反向：不得与 TERMS.calcMethod 的 consumeXxx 组撞名（跨组撞名不报错但极易张冠李戴）
  check('段二键名统一 reconConsume 前缀（不与 calcMethod.consumeXxx 混）',
    pageKeys.every((k) => k.indexOf('reconConsume') === 0));
}

// ===== 9b) 🔴 扣除非销售耗用（员工餐/试吃/报损）—— 三司会诊的最高优先级缺口 =====
//   不扣 = 把正常经营损耗算成"差额"，等于系统在说老板被偷了。
{
  const base = { ledger: mkLedger(1200000, 2000000, 1500000), review: mkReview({ ranked: RANKED }) };
  // 基线：不填非销售耗用 ⇒ 与老行为完全一致（向后兼容，防改动破坏既有页面）
  const r0 = consumeVariance(base);
  check('非销售耗用缺省 ⇒ realVarianceFen ≡ varianceFen（向后兼容）',
    r0.nonsalesFen === 0 && r0.realVarianceFen === r0.varianceFen, '=' + r0.realVarianceFen);
  check('非销售耗用缺省 ⇒ realVariancePct ≡ variancePct', r0.realVariancePct === r0.variancePct);

  // 报 800 元员工餐/试吃/报损 ⇒ 真正说不清的 = 11180 − 800 = 10380 元
  const r1 = consumeVariance(Object.assign({}, base, { nonsalesFen: 80000 }));
  check('扣 800 元 ⇒ 说不清的 = 10380 元', r1.realVarianceFen === 1038000, '=' + r1.realVarianceFen);
  check('扣 800 元 ⇒ 原差额 varianceFen 不被篡改（两个数都要显示给老板）', r1.varianceFen === 1118000, '=' + r1.varianceFen);
  check('扣 800 元 ⇒ 比率同步下降', r1.realVariancePct < r1.variancePct, r1.realVariancePct + '% < ' + r1.variancePct + '%');

  // 🔴 反恒真：非销售耗用报得比差额还大 ⇒ 必须如实出负数（"比标准还省"），不许强行归零
  const r2 = consumeVariance(Object.assign({}, base, { nonsalesFen: 2000000 }));
  check('非销售 > 差额 ⇒ 如实出负数，不归零',
    r2.realVarianceFen === -882000 && r2.realVariancePct < 0, '=' + r2.realVarianceFen);

  // 🔴 G2（2026-11-25 M3 变动面审计）：非销售耗用**超过实际用掉的料**时要有标记。
  //   实测过：实际耗用 9000 元时填 999999.99，页面显示「比标准省 99200%」而无人提示。
  //   注意标记的语义是「请核对」，**不是**拒绝计算 —— 数照给，老板自己判断。
  check('G2 非销售 > 实际耗用 ⇒ nonsalesTooBig=true（页面提示核对，但不出数吗？不，仍出数）',
    r2.nonsalesTooBig === true && r2.ok === true, 'tooBig=' + r2.nonsalesTooBig + ' ok=' + r2.ok);
  check('G2 非销售不超实际耗用 ⇒ nonsalesTooBig=false（不打扰）', r0.nonsalesTooBig === false);
  // 边界：恰好等于实际耗用 ⇒ 不算超（用 >= 会误伤"正好全吃掉"的极端真实情况）
  const rEdge = consumeVariance(Object.assign({}, base, { nonsalesFen: 1700000 }));
  check('G2 边界：非销售 == 实际耗用 ⇒ 不算超（用 > 不用 >=）',
    rEdge.nonsalesTooBig === false, '=' + rEdge.nonsalesTooBig);

  // 非法入参（负数）⇒ 按 0 处理，不把"少报"变成"多扣"
  const r3 = consumeVariance(Object.assign({}, base, { nonsalesFen: -500 }));
  check('非销售耗用为负 ⇒ 归零（不反向放大差额）', r3.nonsalesFen === 0 && r3.realVarianceFen === 1118000);

  // 非数字/NaN ⇒ 按 0，不产生 NaN 传染到页面
  const r4 = consumeVariance(Object.assign({}, base, { nonsalesFen: 'abc' }));
  check('非销售耗用非数字 ⇒ 按 0（不产生 NaN）', r4.nonsalesFen === 0 && Number.isFinite(r4.realVarianceFen));
}

// ===== 13) 🔴 页面接线断言（纯函数测不到的那类 bug，用源码级断言钉住）=====
//   背景：本轮实际写出来的 bug —— 切月份时只调了 calc() 没重读该月的非销售耗用，
//   结果输入框显示上月数、计算却用 0，两个数打架。纯函数 selftest 抓不到这类问题。
{
  const fs = require('fs');
  const path = require('path');
  const reconJs = fs.readFileSync(path.join(__dirname, '..', 'subpkg/tools/recon/index.js'), 'utf8');
  const reconWxml = fs.readFileSync(path.join(__dirname, '..', 'subpkg/tools/recon/index.wxml'), 'utf8');

  const mMonth = /onMonthChange\(e\)\s*\{[\s\S]{0,600}?\n  \}/.exec(reconJs);
  check('接线：切换月份时重读该月非销售耗用（防"显示上月数/计算用0"）',
    !!mMonth && /loadNonsales\(/.test(mMonth[0]), mMonth ? '已含' : '未找到 onMonthChange');

  check('接线：计算时把 nonsalesFen 传给 consumeVariance',
    /consumeVariance\(\{[^}]*nonsalesFen/.test(reconJs));

  check('接线：输入框绑定 onNonsales 且该 handler 存在',
    /bindinput="onNonsales"/.test(reconWxml) && /onNonsales\(e\)\s*\{/.test(reconJs));

  check('接线：非销售耗用按店按月隔离（走 ss.shopKey，不是裸 key）',
    /loadNonsales\(month\)[\s\S]{0,300}ss\.shopKey\('nonsales_'/.test(reconJs));

  // 反恒真：把上面任一条改成"裸存"或"不传参"，对应断言必须变红（此处直接验判据本身可失效）
  check('反恒真：「不传 nonsalesFen」的写法必须被判红',
    !/consumeVariance\(\{\s*ledger:\s*ledger\s*\}\)/.test(reconJs));
}

console.log('\n==== 耗用核查核心自测：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
