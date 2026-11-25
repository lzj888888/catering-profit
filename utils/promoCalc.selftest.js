// utils/promoCalc.selftest.js —— 活动测算纯函数自测
// 运行： node utils/promoCalc.selftest.js
//
// 🔴 本文件的三条纪律：
//  ① **与国外成熟模型对拍**：客流增幅用业界公式「折扣% ÷ (毛利率% − 折扣%)」验，
//     不是自己算完自己看顺眼（65% 打 8 折必须得 +44%，多家工具一致）。
//  ② **与 promoImpact 对拍活动后毛利率**：两个模块同源口径，任何一处漂移都要红。
//  ③ **变异回灌**：把公式故意改错，判据必须转红 —— 证明断言有分辨力。

const fs = require('fs');
const path = require('path');
const { promoCalc, promoConvert, discountOf, formulaOf, setMealCalc, riskOf } = require('./promoCalc.js');
const Promo = require('./promoImpact.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ===================================================================
sec('A 活动形式 → 等效折扣');
{
  const t = (kind, rule, expect, label) => {
    const r = discountOf(kind, rule);
    check(label + ' ⇒ d=' + expect, r.ok && Math.abs(r.d - expect) < 1e-6, r.ok ? String(r.d) : r.reason);
  };
  t('off', { discount: 0.8 }, 0.8, '打8折');
  t('threshold', { threshold: 100, cut: 30, avgPrice: 100 }, 0.7, '满100减30（客单100）');
  t('threshold', { threshold: 100, cut: 30, avgPrice: 150 }, 0.8, '满100减30（客单150）');
  t('bogo', { buy: 2, free: 1 }, 0.6667, '买2赠1');
  t('bogo', { buy: 1, free: 1 }, 0.5, '买1赠1（=5折）');
  t('nth', { n: 2 }, 0.75, '第2件半价');
  t('voucher', { face: 30, threshold: 100 }, 0.7, '100元券减30');
  t('share', { people: 4, free: 1 }, 0.75, '4人同行1人免单');
  t('stored', { principal: 1000, bonus: 200 }, 0.8333, '充1000送200');
  t('offset', { payable: 100, offset: 20 }, 0.8, '积分抵20元');
  t('direct', { discount: 0.85 }, 0.85, '时段限定直接给0.85');
}
{
  // 客单低于门槛：不能说"算不了"，要按门槛算并标记（做活动的目的就是把客单拉到门槛）
  const r = discountOf('threshold', { threshold: 100, cut: 30, avgPrice: 80 });
  check('A-② 客单低于门槛 ⇒ 按门槛算 + note=below_threshold（不报错、不静默）',
    r.ok && r.note === 'below_threshold' && Math.abs(r.d - 0.7) < 1e-6, JSON.stringify(r));
  // 反例：规则本身非法必须拒
  check('A-③ 减免 ≥ 门槛 ⇒ badRule（不可能的活动）',
    discountOf('threshold', { threshold: 100, cut: 100 }).reason === 'badRule');
  check('A-④ 免单人数 ≥ 同行人数 ⇒ badRule',
    discountOf('share', { people: 4, free: 4 }).reason === 'badRule');
  check('A-⑤ 折扣 >1 ⇒ badDiscount（不能比原价贵）',
    discountOf('off', { discount: 1.2 }).reason === 'badDiscount');
}

// ===================================================================
sec('B 与国外成熟模型对拍（关键：不能自己算自己）');
{
  // 业界公式：客流增幅% = 折扣% ÷ (毛利率% − 折扣%)
  // 公开数据（primecosttools / billfeeds 多家一致）：65% 毛利率
  const cases = [
    [10, 18], [15, 30], [20, 44], [25, 63], [50, 333],
  ];
  for (const [offPct, expectUplift] of cases) {
    const r = promoCalc({ marginPct: 65, discount: 1 - offPct / 100 });
    const got = r.ok ? r.trafficUpliftPct : NaN;
    check('B-① 65%毛利 打' + offPct + '% ⇒ 客流 +' + expectUplift + '%（业界基准）',
      Math.abs(got - expectUplift) <= 1, '实际 +' + got + '%');
  }
  // 另一家给的例子：€8 成本、€25 售价、25% 折扣 ⇒ 需要 +58%
  // 另一家算例：成本 €8、售价 €25 ⇒ 毛利率 68%（直接写数，避免自测里做百分比换算）
  const r2 = promoCalc({ marginPct: 68, discount: 0.75 });
  check('B-② 交叉验算：68%毛利打25% ⇒ +58%（另一家工具的算例）',
    Math.abs(r2.trafficUpliftPct - 58) <= 1, '实际 +' + r2.trafficUpliftPct + '%');
}

// ===================================================================
sec('C 与 promoImpact 对拍（同源口径，防两处漂移）');
{
  const margins = [35, 45, 50, 60, 65];
  const discounts = [0.95, 0.9, 0.8, 0.75, 0.7];
  let allSame = true;
  const diffs = [];
  for (const m of margins) {
    for (const d of discounts) {
      const mine = promoCalc({ marginPct: m, discount: d });
      // promoImpact 要求 fixed>0；用一个不影响毛利率的固定费用
      const theirs = Promo.promoImpact({ fixedYuan: 10000, marginPct: m, discount: d, weightPct: 100, costRatePct: 0 });
      if (!mine.ok || !theirs.ok) continue;
      // ⚠️ 容差 0.06 而不是 0：两者**口径相同、精度不同** ——
      //   promoImpact 的 gaPct 是 `ROUND(x, 1)`（1 位小数），本模块保留 2 位。
      //   差 0.05 属舍入，不是漂移；真漂移（如忘了除折扣系数）会差几个点，照样红。
      const diff = Math.abs(mine.newMarginPct - theirs.gaPct);
      if (diff > 0.06) { allSame = false; diffs.push(m + '%/' + d + ': ' + mine.newMarginPct + ' vs ' + theirs.gaPct); }
    }
  }
  check('C-① 活动后毛利率与 promoImpact 完全一致（25 组）', allSame, diffs.slice(0, 3).join(' / ') || '全部一致');
}

// ===================================================================
sec('D 流水倍数 vs 客流倍数（本模块最核心的区分）');
{
  const r = promoCalc({ marginPct: 50, discount: 0.625, revenueYuan: 8000, avgPriceYuan: 200 });
  check('D-① 50%打6.25折 ⇒ 活动后毛利率 20%', Math.abs(r.newMarginPct - 20) < 0.01, String(r.newMarginPct));
  check('D-② 流水要 ×2.5（8000 → 20000）',
    Math.abs(r.revenueMultiple - 2.5) < 0.01 && Math.abs(r.revenueNeededYuan - 20000) < 1,
    '×' + r.revenueMultiple + ' → ' + r.revenueNeededYuan + '元');
  check('D-③ 🔴 客流要 ×4（40单 → 160单）—— 比流水倍数大得多，这才是真实压力',
    Math.abs(r.trafficMultiple - 4) < 0.01 && Math.abs(r.trafficUpliftPct - 300) < 1,
    '×' + r.trafficMultiple + ' (+' + r.trafficUpliftPct + '%)，需 ' + r.ordersNeeded + ' 单');
  check('D-④ 风险档 = risky（客流要+300%，业界红线是+50%）', r.riskLevel === 'risky', r.riskLevel);
}

// ===================================================================
sec('E 边界（fail-closed，绝不编数）');
{
  check('E-① 毛利率 0 ⇒ badMargin', promoCalc({ marginPct: 0, discount: 0.8 }).reason === 'badMargin');
  check('E-② 毛利率 120 ⇒ badMargin', promoCalc({ marginPct: 120, discount: 0.8 }).reason === 'badMargin');
  check('E-③ 折扣 1.2 ⇒ badDiscount', promoCalc({ marginPct: 50, discount: 1.2 }).reason === 'badDiscount');
  // 临界：50% 毛利率打 5 折 ⇒ 活动后毛利率正好 0 ⇒ impossible（不给出误导性的 0）
  const crit = promoCalc({ marginPct: 50, discount: 0.5 });
  check('E-④ 打5折（50%毛利）⇒ impossible + 报出临界折扣 0.5',
    crit.ok === false && crit.reason === 'impossible' && Math.abs(crit.criticalDiscount - 0.5) < 1e-6,
    JSON.stringify(crit));
  const below = promoCalc({ marginPct: 50, discount: 0.4 });
  check('E-⑤ 打4折（低于临界）⇒ impossible', below.reason === 'impossible');
  const safe = promoCalc({ marginPct: 50, discount: 0.55 });
  check('E-⑥ 打5.5折（略高于临界）⇒ 仍可算，但风险最高档',
    safe.ok && safe.riskLevel === 'risky', '毛利率' + safe.newMarginPct + '%');
}

// ===================================================================
sec('F 低价引流套餐');
{
  const r = setMealCalc({ listPrice: 200, cost: 100, promoPrice: 125 });
  check('F-① 200元套餐成本100 → 125元：单价毛利 25（不是负）', r.ok && r.unitGrossPromo === 25, String(r.unitGrossPromo));
  check('F-② 不填连带 ⇒ 要 4 份才等于原来 1 份，且标注 no_attach_worst_case',
    Math.abs(r.ordersToEqual - 4) < 0.01 && r.note === 'no_attach_worst_case', '×' + r.ordersToEqual);
  // 填了连带：连带 30 元、正价毛利率 60% ⇒ 每份多 18 元毛利
  const r2 = setMealCalc({ listPrice: 200, cost: 100, promoPrice: 125, attachYuan: 30, attachMarginPct: 60 });
  check('F-③ 连带 30 元（毛60%）⇒ 每份总毛利 43，所需份数降到 2.33',
    r2.attachGross === 18 && r2.unitGrossTotal === 43 && Math.abs(r2.ordersToEqual - 2.3256) < 0.01,
    JSON.stringify({ attach: r2.attachGross, total: r2.unitGrossTotal, k: r2.ordersToEqual }));
  check('F-④ 活动价低于成本 ⇒ negativeUnit（明确说卖一份亏一份）',
    setMealCalc({ listPrice: 200, cost: 100, promoPrice: 90 }).reason === 'negativeUnit');
  check('F-⑤ 缺参数 ⇒ badInput', setMealCalc({}).reason === 'badInput');
}

// ===================================================================
sec('G 风险档判定');
{
  check('G-① 客流 +20% ⇒ ok', riskOf(20, 40) === 'ok');
  check('G-② 客流 +40% ⇒ watch', riskOf(40, 40) === 'watch');
  check('G-③ 客流 +60% ⇒ risky（超业界 50% 红线）', riskOf(60, 40) === 'risky');
  check('G-④ 毛利率 ≤0 ⇒ impossible（优先于客流）', riskOf(10, 0) === 'impossible');
}

// ===================================================================
sec('H 变异回灌（证明断言有分辨力，不是空转）');
{
  // 变异 1：把客流倍数的分母写成 g0（忘了减折扣率）⇒ 恒等于 1 ⇒ 对拍必然红
  const fake1 = (g0, discPct) => g0 / g0;
  // 业界基准：65% 毛利打 20% ⇒ 客流要 ×1.44；错误实现（分母写成 g0）恒给 ×1.00
  check('H-① 变异「客流倍数分母写错」⇒ 与业界基准偏离（判据能分辨）',
    Math.abs(fake1(65, 20) - 1.44) > 0.1, '假实现给 ×' + fake1(65, 20).toFixed(2) + '，基准 ×1.44');
  // 变异 2：把活动后毛利率写成 g0 − 折扣率（忘了除折扣系数）
  const fake2 = (g0, discPct) => g0 - discPct;
  check('H-② 变异「忘了除折扣系数」⇒ 与实际值不同（判据能分辨）',
    Math.abs(fake2(50, 20) - 37.5) > 1, '假实现给 ' + fake2(50, 20) + '，正确 37.5');
  // 变异 3：临界折扣写成 1（不判亏）
  const realCrit = 1 - 50 / 100;
  check('H-③ 变异「临界折扣恒为 1」⇒ 与实际 0.5 不同（判据能分辨）',
    Math.abs(1 - realCrit) > 0.1);
}

// ===================================================================
sec('I 溯源（李老师原话的两个算例必须能复现）');
{
  const r = promoCalc({ marginPct: 50, discount: 0.625, revenueYuan: 8000 });
  check('I-① 「毛利50%、日流水8000、降到20%毛利」⇒ 流水 ×2.5（即多做 150%）',
    Math.abs(r.revenueMultiple - 2.5) < 0.01, '×' + r.revenueMultiple);
  const m = setMealCalc({ listPrice: 200, cost: 100, promoPrice: 125 });
  check('I-② 「200元套餐毛利100降到20%毛利」⇒ 售价 125、要 4 倍单量',
    Math.abs(m.promoPrice - 125) < 0.01 && Math.abs(m.ordersToEqual - 4) < 0.01);
}

// ===================================================================
sec('I-R759 折扣换算独立入口（不依赖毛利率）');
{
  // 核心纠偏：老板问「买2送1几折」时，不该被「先填毛利率」卡住。
  const r = promoConvert('bogo', { buy: 2, free: 1 });
  check('I-① promoConvert 不需毛利率也能出折扣', r.ok && Math.abs(r.discount - 0.6667) < 1e-6,
    r.ok ? String(r.discount) : r.reason);
  check('I-② 买2送1 推导式 = 2÷(2+1)', formulaOf('bogo', { buy: 2, free: 1 }) === '2÷(2+1)',
    formulaOf('bogo', { buy: 2, free: 1 }));
  check('I-③ 满100减30 推导式 = (100−30)÷100',
    formulaOf('threshold', { threshold: 100, cut: 30 }) === '(100−30)÷100',
    formulaOf('threshold', { threshold: 100, cut: 30 }));
  check('I-④ 代金券 80代100 推导式 = (100−80)÷100',
    formulaOf('voucher', { face: 80, threshold: 100 }) === '(100−80)÷100',
    formulaOf('voucher', { face: 80, threshold: 100 }));
  // 对拍：promoConvert.discount 必须等于 discountOf.d（同一个折扣，不许两套口径）
  for (const [k, r0] of [['off', { discount: 0.8 }], ['bogo', { buy: 3, free: 1 }],
    ['voucher', { face: 50, threshold: 200 }], ['stored', { principal: 500, bonus: 100 }]]) {
    const cv = promoConvert(k, r0);
    const raw = discountOf(k, r0);
    check('I-对拍 折扣口径一致 ' + k, cv.ok && raw.ok && cv.discount === raw.d,
      cv.ok ? String(cv.discount) : cv.reason);
  }
  // 反恒真：坏规则必须判红，不能给出假折扣
  const bad = promoConvert('bogo', { buy: 0, free: 1 });
  check('I-⑤ 🔴 反恒真：买0送1 必须判红', bad.ok === false && bad.reason === 'badRule', bad.reason);
  // 直接打折无推导式（填的就是折扣）
  check('I-⑥ 直接打折无推导式（不编中间数）', formulaOf('off', { discount: 0.8 }) === '');
}

// ===================================================================
sec('J 页面接线（subpkg/tools/promo）');
{
  const PAGE = path.join(__dirname, '..', 'subpkg/tools/promo/index.js');
  const WXML = path.join(__dirname, '..', 'subpkg/tools/promo/index.wxml');
  const pj = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
  const pw = fs.existsSync(WXML) ? fs.readFileSync(WXML, 'utf8') : '';
  check('J-① 页面文件存在（js + wxml）', !!pj && !!pw);
  // 🔴 核心卖点：零数据依赖。页面一旦 require api.js，没建店的老板就用不了，拉新入口作废。
  check('J-② 🔴 页面不 require api.js（零数据依赖，新用户没建店也能用）',
    pj.indexOf('utils/api.js') < 0, pj.indexOf('utils/api.js') < 0 ? '未依赖' : '已依赖（拉新卖点失效）');
  check('J-③ 页面复用 promoCalc 引擎（不自己写一套公式）',
    /require\([^)]*promoCalc\.js/.test(pj));
  check('J-④ 输入即重算：有 bindinput 且没有「计算」按钮（李老师要求自动变化）',
    /bindinput=/.test(pw) && pj.indexOf('onInput') >= 0);
  // 🔴 R759 纠偏核心：折扣换算独立于毛利率 —— 页面必须 require promoConvert，
  //   且换算区的显示**不能**被毛利率为空的 return 拦住。
  check('J-⑤ 🔴 页面用 promoConvert 做独立折扣换算（不被毛利率卡住）',
    /promoConvert/.test(pj) && /convert/.test(pw));
  check('J-⑥ 推导式接在页面上（中间数值看得见）', pw.indexOf('conv.formula') >= 0);
  // 毛利率为空 ⇒ 回本区 null（不显示 0）；但换算区不受影响 —— 两段分离
  check('J-⑦ 毛利率为空 ⇒ back=null（回本区不显示假数）',
    /back: null/.test(pj) && /promoBackEmpty/.test(pw));
  check('J-⑧ 活动后毛利率 / 流水 / 单数三段回本结果都在',
    pw.indexOf('back.newMarginPct') >= 0 && pw.indexOf('back.revenueNeededYuan') >= 0 && pw.indexOf('back.ordersNeeded') >= 0);
}

console.log('\n==== 活动测算自测：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
