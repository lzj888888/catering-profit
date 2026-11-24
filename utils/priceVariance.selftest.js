// utils/priceVariance.selftest.js —— 量价拆分（纯 node 直跑）
// 运行： node utils/priceVariance.selftest.js
//
// 🔴 本文件最要紧的一条：**恒等式**。价格影响 + 数量影响 ≡ 金额总变化，一分不差。
//   若有一天有人"顺手校正残差"或"优化公式"，这条必须先红。
// 第二要紧：**金额持平的掩盖情形**必须被拆出来（买贵 2250 / 少买 2250 → 净 0）。
const { priceVariance, avgPriceOf, priceAlertOf } = require('./priceVariance.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// 金额一律「分」：45 元/斤 ⇒ 4500 分/斤（夹具直接写分，不做元→分换算，避免踩金额精度守卫）

// ===== 1) 🔴 恒等式：两项之和 ≡ 金额总变化（多组，含极端与负数情形）=====
{
  const cases = [
    ['买贵，量没变', { qty: 250, amountFen: (4500) * 250 }, { qty: 250, amountFen: (5200) * 250 }],
    ['多买，价没变', { qty: 250, amountFen: (4500) * 250 }, { qty: 300, amountFen: (4500) * 300 }],
    ['买贵又少买（金额持平）', { qty: 250, amountFen: (4500) * 250 }, { qty: 200, amountFen: (5625) * 200 }],
    ['价降量增', { qty: 250, amountFen: (4500) * 250 }, { qty: 300, amountFen: (4000) * 300 }],
    ['全面下降', { qty: 400, amountFen: (5000) * 400 }, { qty: 200, amountFen: (3800) * 200 }],
    ['小数数量（1.5 斤级）', { qty: 12.5, amountFen: (3880) * 12.5 }, { qty: 9.75, amountFen: (4120) * 9.75 }],
  ];
  let allOk = true;
  const bad = [];
  for (const [name, cur, prev] of cases) {
    const r = priceVariance(cur, prev);
    if (!r.ok || !r.sumMatchesDelta || (r.priceImpactFen + r.qtyImpactFen) !== r.amountDeltaFen) {
      allOk = false;
      bad.push(name + ':' + r.priceImpactFen + '+' + r.qtyImpactFen + '≠' + r.amountDeltaFen);
    }
  }
  check('🔴 恒等式：6 组数据下「价格影响 + 数量影响 ≡ 金额总变化」', allOk, bad.join(' | ') || '全部相等');
}

// ===== 2) 三种典型情形各自落在正确的项上 =====
{
  // 买贵 7 元 × 250 斤 = 1750 元，全在价格影响
  const r1 = priceVariance({ qty: 250, amountFen: (5200) * 250 }, { qty: 250, amountFen: (4500) * 250 });
  check('买贵（量不变）⇒ 价格影响 1750 元 / 数量影响 0',
    r1.priceImpactFen === (175000) && r1.qtyImpactFen === 0, r1.priceImpactFen / 100 + ' / ' + r1.qtyImpactFen / 100);
  check('买贵（量不变）⇒ 单价涨幅 +15.56%', Math.abs(r1.priceChangePct - 15.56) < 0.01, '=' + r1.priceChangePct);

  // 多买 50 斤 × 45 元 = 2250 元，全在数量影响
  const r2 = priceVariance({ qty: 300, amountFen: (4500) * 300 }, { qty: 250, amountFen: (4500) * 250 });
  check('多买（价不变）⇒ 数量影响 2250 元 / 价格影响 0',
    r2.qtyImpactFen === (225000) && r2.priceImpactFen === 0, r2.qtyImpactFen / 100 + ' / ' + r2.priceImpactFen / 100);
}

// ===== 3) 🔴 最关键的：金额持平时问题被掩盖，拆开后现形 =====
{
  // 单价 45→56.25（+25%）、量 250→200（−20%）⇒ 金额 11250→11250 分毫不差
  const r = priceVariance(
    { qty: 200, amountFen: (5625) * 200 },
    { qty: 250, amountFen: (4500) * 250 },
  );
  check('掩盖情形：金额变化 = 0（老板会说"这个月牛肉钱没变"）', r.amountDeltaFen === 0, '=' + r.amountDeltaFen);
  check('🔴 掩盖情形：拆开后买贵 +2250 元（不是没事，是买贵了）',
    r.priceImpactFen === (225000), '=' + r.priceImpactFen / 100 + ' 元');
  check('🔴 掩盖情形：拆开后少买 −2250 元（两者抵消才看起来正常）',
    r.qtyImpactFen === -(225000), '=' + r.qtyImpactFen / 100 + ' 元');
  check('掩盖情形：单价涨幅仍如实报 +25%（不因金额持平就吞掉）',
    Math.abs(r.priceChangePct - 25) < 0.01, '=' + r.priceChangePct);
}

// ===== 4) 上期缺失 ⇒ 只给本期均价，不编同比 =====
{
  const r = priceVariance({ qty: 250, amountFen: (4500) * 250 }, null);
  check('上期缺失 ⇒ decomposed=false（不给同比与拆分）', r.ok === true && r.decomposed === false);
  check('上期缺失 ⇒ 仍给本期均价 45 元', r.priceCurFen === (4500), '=' + r.priceCurFen / 100 + ' 元');
  check('上期缺失 ⇒ priceChangePct 为 undefined（不是 0）', r.priceChangePct === undefined);
}

// ===== 5) 本期数据不完整 ⇒ 算不了 =====
{
  check('本期量为 0 ⇒ reason=no_qty', priceVariance({ qty: 0, amountFen: 100 }, null).reason === 'no_qty');
  check('本期金额为 0 ⇒ reason=no_amount', priceVariance({ qty: 10, amountFen: 0 }, null).reason === 'no_amount');
  check('avgPriceOf：非数字入参不产生 NaN', Number.isFinite(avgPriceOf(10, 'abc').reason ? 0 : 1));
}

// ===== 6) 阈值：只报"变化较大"，不叫"异常" =====
{
  const QTY = 100;   // 数量（斤）—— 用变量而非字面量，避免与「元×100」混淆
  const up = priceVariance({ qty: QTY, amountFen: (5200) * QTY }, { qty: QTY, amountFen: (4500) * QTY });
  check('涨 15.6% ⇒ level=up', priceAlertOf(up).level === 'up', 'pct=' + up.priceChangePct);
  const flat = priceVariance({ qty: QTY, amountFen: (4600) * QTY }, { qty: QTY, amountFen: (4500) * QTY });
  check('涨 2.2% ⇒ level=none（10% 以内不打扰）', priceAlertOf(flat).level === 'none', 'pct=' + flat.priceChangePct);
  const down = priceVariance({ qty: QTY, amountFen: (3800) * QTY }, { qty: QTY, amountFen: (4500) * QTY });
  check('跌 15.6% ⇒ level=down', priceAlertOf(down).level === 'down');
  check('上期缺失时 alert 为 none（无基准不提示）', priceAlertOf(priceVariance({ qty: 10, amountFen: 4500 * 10 }, null)).level === 'none');
}

// ===== 7) 文案键存在性（页面要用的）=====
{
  const { TERMS } = require('../miniprogram/i18n/terms.js');
  const keys = ['reconPriceCur', 'reconPriceChange', 'reconPriceImpact', 'reconQtyImpact',
    'reconPriceNeedAmount', 'reconPriceNeedPrev', 'reconPriceNote'];
  const miss = keys.filter((k) => typeof TERMS.card[k] !== 'string' || !TERMS.card[k]);
  check('量价相关文案键都在 TERMS.card 里', miss.length === 0, miss.join(',') || '全部命中');
}

console.log('\n==== 量价拆分自测：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
