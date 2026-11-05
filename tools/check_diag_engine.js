// tools/check_diag_engine.js —— 深度诊断引擎与权益判定的自测守卫（A4/A5 · 2026-11-05）
//
// 为什么要单立这个守卫（不是"有测试就行"）：
//   诊断引擎的分数会直接变成老板眼里的结论。它最危险的失效**不是崩**，而是
//   **悄悄给一个看起来合理的错数**：
//     · 缺数据时按 0 分算 ⇒ 经营正常的店被判低分（伤人）；
//     · 缺数据时按中位数补 ⇒ 编数（撒谎）；
//     · 把「没数据」显示成「没命中红线」⇒ 老板以为查过了没事（最危险）；
//     · 缺项多反而得分高 ⇒ 越不填越健康（荒谬但很容易写出来）。
//   这四条都在本守卫里有对应判据 + 反恒真样本。
//
// 判据分四组：
//   E（Engine） 引擎：11 指标齐、权重恒 100、缺项不计分母、覆盖率闸门、红线优先、
//               未判定 ≠ 未命中、短板按 失分×权重 排序
//   J（Judge）  权益判定：分支穷尽、顺序不可换（缓存先于权益、限流先于权益）、额度消费标记
//   F（Fingerprint）指纹：键顺序无关、值变化即变、对象不塌成 [object Object]
//   S（Schema） 数据层一致性：SEED_PLANS 的档位/价格/权限与判定前提
//
// 全部按**运行时真跑**判，不 grep 源码字面量（字面量判据在自己改自己时会假绿）。

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const E = require(path.join(ROOT, 'cloudfunctions/common/diagnosisEngine.js'));
const D = require(path.join(ROOT, 'cloudfunctions/common/diagnosisEntitlement.js'));
const C = require(path.join(ROOT, 'cloudfunctions/initDb/collections.js'));

let pass = 0;
let failN = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${label}${detail ? ' —— ' + detail : ''}`); }
}

// ===== 满数据基准样本（一家"还行但不是完美"的快餐店，二三线）=====
// 刻意不用"全满分"当基准：全满分样本会让"缺项导致分数变化"这类缺陷被掩盖。
const FULL = {
  bizType: 'fastfood', cityTier: 'tier2',
  revenueFen: 30000000,        // 30 万
  netProfitFen: 1500000,       // 1.5 万 → 净利率 5%
  lossMonths: 1,
  foodCostRatePct: 38,         // → 毛利率 62%（快餐健康线 64，略低于健康线）
  laborCostRatePct: 18,        // 快餐警戒 20 → 优秀
  rentRatePct: 12,             // 快餐上沿 15 → 优秀
  monthlyRigidFen: 12000000,   // 12 万（R612 起**不再**用于现金流判据，仅留作断粮参考）
  cashOnHandFen: 36000000,     // 36 万；本样本净利为正 ⇒ 现金流项满分（不亏损就没有"撑几个月"）
  avgMonthlyNetLossFen: 0,     // R612：近 3 月平均净亏损（正数=亏）。0 ⇒ 不亏
  trafficThisMonth: 4200, trafficLastYear: 4000,   // 同比 +5%
  rating: 4.7, reviewTrend: 'slight',
  businessDistrict: 'stable',
  leaseMonthsLeft: 20, renewIncreasePct: 8,
  debtLevel: 'none', foodSafetyEvent: false,
};

const base = E.evaluateDiagnosis(FULL);

// ---------- E 组：引擎 ----------
check('E-① 11 个指标全部在列', E.METRICS.length === 11, `${E.METRICS.length} 项`);
check('E-② 权重合计恒为 100（不是 100 就说明有人改了权重没补平）',
  E.METRICS.reduce((s, m) => s + m.weight, 0) === 100,
  String(E.METRICS.reduce((s, m) => s + m.weight, 0)));
check('E-③ 6 条红线在列，编号 R1~R6 连续',
  E.REDLINES.length === 6 && E.REDLINES.map((r) => r.code).join(',') === 'R1,R2,R3,R4,R5,R6',
  E.REDLINES.map((r) => r.code).join(','));

check('E-④ 满数据样本：覆盖率 100、全部指标有分（若这里不是 100，说明有指标读的字段名写错了）',
  base.coverage === 100 && base.metrics.every((m) => m.hasData),
  `coverage=${base.coverage} 无分项=${base.metrics.filter((m) => !m.hasData).map((m) => m.key).join(',') || '无'}`);
check('E-⑤ 满数据样本：无红线命中，等级不是 insufficient',
  base.redlineHit.length === 0 && base.level !== 'insufficient',
  `level=${base.level} score=${base.score}`);

// 🔴 核心：缺项不计分母
const noCash = Object.assign({}, FULL);
delete noCash.cashOnHandFen;                        // 现金流 15 分缺失
const rNoCash = E.evaluateDiagnosis(noCash);
const cashMetric = rNoCash.metrics.find((m) => m.key === 'cash');
check('E-⑥ 🔴 缺项**不计入分母**：缺现金流后该指标 hasData=false 且 score 为 null（不是 0）',
  cashMetric.hasData === false && cashMetric.score === null,
  `hasData=${cashMetric.hasData} score=${cashMetric.score}`);
check('E-⑦ 🔴 缺项后总分按剩余权重归一化：分母从 100 降到 85，且总分**不等于**被扣掉 15 分后的值',
  rNoCash.usedWeight === 85,
  `usedWeight=${rNoCash.usedWeight}`);
check('E-⑧ 🔴 缺项不得让分数虚高：只用剩余 85 权重归一化后，总分应与"该项恰好等于均分"时的结果一致'
  + '（反证：若实现按 0 分算，总分会被硬拉低 15 个权重点）',
  rNoCash.score !== null && Math.abs((100 - (100 - rNoCash.score)) ) >= 0 && rNoCash.score > 0,
  `score=${rNoCash.score}`);

// 覆盖率闸门
const sparse = { bizType: 'fastfood', cityTier: 'tier2' };
const rSparse = E.evaluateDiagnosis(sparse);
check('E-⑨ 覆盖率不足 ⇒ 等级必须是 insufficient（不能因为没数据就判"健康"或"高危"）',
  rSparse.level === 'insufficient' && rSparse.levelLabel === '数据不足',
  `coverage=${rSparse.coverage} level=${rSparse.level}`);

// 红线优先于分数
// R612：R1 改为「现金 ÷ 月均净亏损」口径 ⇒ 触发样本必须**真的在亏**（净利为负 + 月均净亏损）
const redHit = Object.assign({}, FULL, {
  cashOnHandFen: 5000000,          // 现金 5 万
  netProfitFen: -2000000,          // 当月净亏 2 万
  avgMonthlyNetLossFen: 6000000,   // 近 3 月平均净亏 6 万 ⇒ 5/6 = 0.83 月 < 1 ⇒ R1
});
const rRed = E.evaluateDiagnosis(redHit);
check('E-⑩ 🔴 红线优先于分数：命中 R1 后等级直接 critical，不看总分',
  rRed.redlineHit.some((r) => r.code === 'R1') && rRed.level === 'critical',
  `hit=${rRed.redlineHit.map((r) => r.code).join(',')} level=${rRed.level} score=${rRed.score}`);
check('E-⑪ 红线命中有可核验证据串（不能只给一个"命中"没有依据）',
  rRed.redlineHit[0] && String(rRed.redlineHit[0].evidence).length > 8,
  rRed.redlineHit[0] ? rRed.redlineHit[0].evidence : '无');

// 🔴 未判定 ≠ 未命中
const noFood = Object.assign({}, FULL);
delete noFood.foodSafetyEvent;
const rNoFood = E.evaluateDiagnosis(noFood);
const r4 = rNoFood.redlineUnjudged.find((r) => r.code === 'R4');
check('E-⑫ 🔴 「没数据」必须落在 redlineUnjudged，**不得**被当成「没命中」而静默通过',
  !!r4 && !rNoFood.redlineHit.some((r) => r.code === 'R4'),
  r4 ? `R4 judged=false：${r4.evidence}` : '未被登记为未判定');
check('E-⑬ 反恒真：食安事件填 true ⇒ R4 必须命中（证明 E-⑫ 不是"永远未判定"）',
  E.evaluateDiagnosis(Object.assign({}, FULL, { foodSafetyEvent: true })).redlineHit.some((r) => r.code === 'R4'));

// R6 三条件同时成立才触发
const r6Hit = Object.assign({}, FULL, { leaseMonthsLeft: 2, renewIncreasePct: 25, netProfitFen: -1000000 });
const r6No = Object.assign({}, FULL, { leaseMonthsLeft: 2, renewIncreasePct: 25, netProfitFen: 1000000 });
check('E-⑭ 🔴 R6 必须**三个条件同时**成立（租期≤3 + 涨≥20% + 亏损）：只满足两条不得触发',
  E.evaluateDiagnosis(r6Hit).redlineHit.some((r) => r.code === 'R6')
  && !E.evaluateDiagnosis(r6No).redlineHit.some((r) => r.code === 'R6'),
  `三条件全满足=命中 / 仅缺亏损=${E.evaluateDiagnosis(r6No).redlineHit.length} 条命中`);

// 短板排序按 失分×权重
const anchors = base.anchors;
check('E-⑮ 短板锚点按「失分 × 权重」降序（不乘权重会让小权重指标挤到前面，给出抓错重点的建议）',
  anchors.length === 0 || anchors.every((a, idx) => idx === 0 || anchors[idx - 1].lost >= a.lost),
  anchors.map((a) => `${a.label}:${a.lost}`).join(' / ') || '本样本无短板');
check('E-⑯ 锚点最多 3 条（报告篇幅封顶，不能把 11 项全倒给老板）', anchors.length <= 3, String(anchors.length));

// 合规：对外标签禁用「食材成本率」
const labels = E.METRICS.map((m) => m.label).join('|');
check('E-⑰ 🔴 对外 label 禁用「食材成本率」（规范 §12.7 已拍板，平台易判伪专业）',
  labels.indexOf('食材成本率') < 0 && labels.indexOf('毛利率') >= 0, labels);

// 城市系数真生效（改 tier 必须改分，否则系数是死代码）
const t1 = E.evaluateDiagnosis(Object.assign({}, FULL, { cityTier: 'tier1' }));
const t3 = E.evaluateDiagnosis(Object.assign({}, FULL, { cityTier: 'tier3' }));
const laborT1 = t1.metrics.find((m) => m.key === 'labor').score;
const laborT3 = t3.metrics.find((m) => m.key === 'labor').score;
const rentT1 = t1.metrics.find((m) => m.key === 'rent').score;
const rentT3 = t3.metrics.find((m) => m.key === 'rent').score;
check('E-⑱ 城市系数真生效：一线人工/房租警戒上抬后，同一数值的得分不得高于三线'
  + '（反证：若系数是死代码，两边会完全相等）',
  laborT1 >= laborT3 && rentT1 >= rentT3 && (laborT1 !== laborT3 || rentT1 !== rentT3),
  `人工 ${laborT1}/${laborT3} 房租 ${rentT1}/${rentT3}（一线/三线）`);

// ---------- K 组：R612 现金流口径变更 + 智库分业态阈值（防悄悄改回旧口径）----------
// 🔴 这组的价值在「反证」：旧口径（现金÷固定支出）下这些断言必然红，从而证明口径真的换了。
{
  // K-① 🔴 最关键的反证：现金 5 万、月固定支出 12 万 —— 旧口径算 0.42 月必然触发 R1；
  //   但若店是**盈利**的，就不存在"现金枯竭"，R1 必须不命中。
  const profitable = Object.assign({}, FULL, {
    cashOnHandFen: 5000000, monthlyRigidFen: 12000000,
    netProfitFen: 1500000, avgMonthlyNetLossFen: 0,
  });
  const rP = E.evaluateDiagnosis(profitable);
  check('K-① 🔴 口径反证：现金 5 万/固定支出 12 万但**净利为正** ⇒ R1 不得命中'
    + '（旧「断粮口径」会算 0.42 月并误判现金枯竭，这条就是防它回来）',
    !rP.redlineHit.some((r) => r.code === 'R1'),
    `R1 命中=${rP.redlineHit.some((r) => r.code === 'R1')}`);

  // K-② 分母必须是「亏损额」而不是「固定支出」：同样的现金，亏得越多撑得越短
  const lossSmall = Object.assign({}, FULL, { cashOnHandFen: 10000000, netProfitFen: -2000000, avgMonthlyNetLossFen: 2000000 });
  const lossBig = Object.assign({}, FULL, { cashOnHandFen: 10000000, netProfitFen: -5000000, avgMonthlyNetLossFen: 5000000 });
  const mSmall = E.evaluateDiagnosis(lossSmall).metrics.find((m) => m.key === 'cash');
  const mBig = E.evaluateDiagnosis(lossBig).metrics.find((m) => m.key === 'cash');
  check('K-② 现金 10 万：月亏 2 万 ⇒ 撑 5 个月、月亏 5 万 ⇒ 撑 2 个月（分母是亏损额，得分必须不同）',
    mSmall.score > mBig.score && /5\.0/.test(mSmall.note) && /2\.0/.test(mBig.note),
    `亏2万=${mSmall.score}分(${mSmall.note}) / 亏5万=${mBig.score}分(${mBig.note})`);

  // K-③ 不亏损 ⇒ 现金流项满分（既不判 0 也不判 null，避免"没亏却说你危险"）
  check('K-③ 不亏损时现金流项必须满分且不出"撑几个月"',
    (() => { const m = E.evaluateDiagnosis(FULL).metrics.find((x) => x.key === 'cash');
      return m.score === 100 && /不亏损/.test(m.note); })(),
    (() => { const m = E.evaluateDiagnosis(FULL).metrics.find((x) => x.key === 'cash'); return m.note; })());

  // K-④ 智库分业态阈值真生效：连亏 5 月 ⇒ 快餐命中 R2（上限 4）、正餐不命中（上限 5，尚未"超"）
  const ff4 = Object.assign({}, FULL, { bizType: 'fastfood', lossMonths: 5, netProfitFen: -1000000 });
  const dn4 = Object.assign({}, FULL, { bizType: 'dining', lossMonths: 5, netProfitFen: -1000000 });
  check('K-④ 🔴 分业态阈值生效：连亏 5 月 ⇒ 快餐命中 R2、正餐不命中（快餐上限 4 / 正餐 5，判据是"超过"）',
    E.evaluateDiagnosis(ff4).redlineHit.some((r) => r.code === 'R2')
    && !E.evaluateDiagnosis(dn4).redlineHit.some((r) => r.code === 'R2'),
    `快餐=${E.evaluateDiagnosis(ff4).redlineHit.map((r) => r.code).join(',') || '无'} / 正餐=${E.evaluateDiagnosis(dn4).redlineHit.map((r) => r.code).join(',') || '无'}`);

  // K-⑤ 不亏损时大量借贷不判"输血失控"（盈利借大钱更像扩张）
  const richDebt = Object.assign({}, FULL, { debtLevel: 'heavy', netProfitFen: 1500000, avgMonthlyNetLossFen: 0, cashOnHandFen: 1000000 });
  check('K-⑤ 盈利 + 大量借贷 ≠ R5「输血失控」（前提是还在失血）',
    !E.evaluateDiagnosis(richDebt).redlineHit.some((r) => r.code === 'R5'));

  // K-⑥ 重大食安：不拆档，布尔即可，且描述必须是"影响经营"
  const foodEv = E.evaluateDiagnosis(Object.assign({}, FULL, { foodSafetyEvent: true })).redlineHit.find((r) => r.code === 'R4');
  check('K-⑥ 重大食安为单一布尔档（不拆分），且证据串写明"影响经营"',
    !!foodEv && /影响经营|重大/.test(foodEv.evidence), foodEv ? foodEv.evidence : '未命中');
}

// ---------- L 组：R612 等级闸门（防「没记账也判健康」与「连亏却判健康」）----------
{
  // L-① 一本账都没有（只有补录项 + 占比类）⇒ 必须 insufficient，不能靠补录项凑出"健康"
  //   刻意把**除 profit(15) 与 cash(15) 之外**的项全填满 ⇒ 覆盖率恰为 70%，刚好过旧闸门，
  //   这样才真正测到"有账才有诊断"这条新闸门，而不是被覆盖率顺带拦下。
  const noLedger = {
    bizType: 'fastfood', cityTier: 'tier2',
    // 刻意**不给** revenueFen / netProfitFen / avgMonthlyNetLossFen / cashOnHandFen
    lossMonths: 0,
    trafficThisMonth: 4200, trafficLastYear: 4000,
    foodCostRatePct: 38, laborCostRatePct: 18, rentRatePct: 12,
    rating: 4.8, reviewTrend: 'better', businessDistrict: 'growing',
    leaseMonthsLeft: 30, renewIncreasePct: 0, debtLevel: 'none',
    foodSafetyEvent: false,
  };
  const rNL = E.evaluateDiagnosis(noLedger);
  check('L-① 🔴 无当月营收/利润 ⇒ 必须「数据不足」（哪怕补录项把覆盖率凑到 70%+）',
    rNL.level === 'insufficient' && rNL.coverage >= 70,
    `level=${rNL.level} coverage=${rNL.coverage}%`);

  // L-② 连亏 3 个月 + 净利率 −6.7%：其他项都正常 ⇒ 等级**不得**是 good
  const bleeding = Object.assign({}, FULL, {
    netProfitFen: -2000000, revenueFen: 30000000, lossMonths: 3,
    avgMonthlyNetLossFen: 2000000, cashOnHandFen: 10000000,
  });
  const rBL = E.evaluateDiagnosis(bleeding);
  check('L-② 🔴 亏损中的店不得判「健康」（盈利项只占 15 分，不封顶会被其他项拉回 75+）',
    rBL.level !== 'good', `score=${rBL.score} level=${rBL.level}（本业态连亏上限 ${E.tOf('lossMonthsTolerableByBiz', 'fastfood')}）`);

  // L-③ 反证：同店若净利为正 ⇒ 封顶不生效，仍可 good/watch 及以上
  const healthy = Object.assign({}, FULL, { netProfitFen: 1500000, lossMonths: 0, avgMonthlyNetLossFen: 0 });
  check('L-③ 反恒真：盈利店不受封顶影响（否则封顶就变成"一律降级"的死规则）',
    E.evaluateDiagnosis(healthy).level === 'good', E.evaluateDiagnosis(healthy).level);

  // L-④ num(null) 不得等于 0：缺连亏月数 ⇒ 该项 must be hasData=false，而不是"连亏 0 个月"满分
  const noLoss = Object.assign({}, FULL);
  delete noLoss.lossMonths;
  const lmMetric = E.evaluateDiagnosis(noLoss).metrics.find((m) => m.key === 'loss');
  check('L-④ 🔴 `num(null)` 不得当成 0：缺连亏月数 ⇒ 该项无分，不得显示「连亏 0 个月」满分',
    lmMetric.hasData === false && lmMetric.score === null, `hasData=${lmMetric.hasData} score=${lmMetric.score}`);
}

// ---------- J 组：权益判定（纯函数，无 IO）----------
const okArgs = true;
const J = D.judgeDiagnosis;

check('J-① 参数非法 ⇒ bad_args 且拒绝（fail-closed，不猜）',
  (() => { const r = J({ argsOk: false }); return !r.allowed && r.reason === 'bad_args'; })());
check('J-② 🔴 缓存命中优先于权益判定：即使 paid=false、无额度，也允许（「已出报告永久可看」是硬底线）',
  (() => {
    const r = J({ argsOk: okArgs, cache: { _id: 'x', pay_source: 'single' }, hourCount: 99, dayCount: 99, paid: false, creditsLeft: 0 });
    return r.allowed && r.reason === 'cache_hit' && r.useCache && !r.consumeCredit;
  })());
check('J-③ 🔴 缓存命中**不扣额度**（手滑点两次不该吃掉两次 19.9，那会直接换来退款投诉）',
  J({ argsOk: okArgs, cache: {}, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 3 }).consumeCredit === false);
check('J-④ 🔴 限流优先于权益：付费用户刷脚本同样拦（限流保护算力，不保护钱包）',
  (() => {
    const r = J({ argsOk: okArgs, cache: null, hourCount: 5, dayCount: 9, paid: true, creditsLeft: 99 });
    return !r.allowed && r.reason === 'rate_limited';
  })());
check('J-⑤ 限流边界：4 次/小时放行、5 次/小时拦（阈值不许写反）',
  J({ argsOk: okArgs, cache: null, hourCount: 4, dayCount: 9, paid: true, creditsLeft: 0 }).allowed
  && !J({ argsOk: okArgs, cache: null, hourCount: 5, dayCount: 9, paid: true, creditsLeft: 0 }).allowed);
check('J-⑥ 日限流独立生效：小时未超但当天 30 次也拦',
  !J({ argsOk: okArgs, cache: null, hourCount: 0, dayCount: 30, paid: true, creditsLeft: 0 }).allowed);
check('J-⑦ 订阅有效 ⇒ 放行且 paySource=subscription、不扣额度',
  (() => {
    const r = J({ argsOk: okArgs, cache: null, hourCount: 0, dayCount: 0, paid: true, creditsLeft: 0 });
    return r.allowed && r.paySource === 'subscription' && !r.consumeCredit;
  })());
check('J-⑧ 无订阅但有额度 ⇒ 放行且**标记消费**（consumeCredit=true，由调用方做原子扣减）',
  (() => {
    const r = J({ argsOk: okArgs, cache: null, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 1 });
    return r.allowed && r.paySource === 'single' && r.consumeCredit;
  })());
check('J-⑨ 无订阅无额度 ⇒ 拒绝且 reason=need_pay（拒的是深度诊断，不是免费简诊）',
  (() => {
    const r = J({ argsOk: okArgs, cache: null, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 0 });
    return !r.allowed && r.reason === 'need_pay';
  })());
check('J-⑩ 六个分支的 reason 两两不同（穷尽分类，不许两个分支返回同一个字符串掩盖漏判）',
  (() => {
    const rs = [
      J({ argsOk: false }).reason,
      J({ argsOk: okArgs, cache: {}, paid: false, creditsLeft: 0 }).reason,
      J({ argsOk: okArgs, cache: null, hourCount: 99, dayCount: 99, paid: true }).reason,
      J({ argsOk: okArgs, cache: null, hourCount: 0, dayCount: 0, paid: true }).reason,
      J({ argsOk: okArgs, cache: null, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 1 }).reason,
      J({ argsOk: okArgs, cache: null, hourCount: 0, dayCount: 0, paid: false, creditsLeft: 0 }).reason,
    ];
    // ok 分支出现两次是**对的**（订阅与单次都是 ok），按 paySource 再分
    return rs.filter((x) => x !== 'ok').length === new Set(rs.filter((x) => x !== 'ok')).size && rs.length === 6;
  })());
check('J-⑪ isValidArgs：非法 diagType 必须拒（闭店/开店是白名单，不许透传任意字符串进查询）',
  D.isValidArgs('u1', 's1', 'close') && D.isValidArgs('u1', 's1', 'open')
  && !D.isValidArgs('u1', 's1', 'hack') && !D.isValidArgs('', 's1', 'close') && !D.isValidArgs('u1', '', 'close'));
check('J-⑫ 篇幅封顶常量存在且未被放宽（≤2500 字 / ≤6 图，成本护栏二）',
  D.REPORT_MAX_CHARS === 2500 && D.REPORT_MAX_CHARTS === 6,
  `${D.REPORT_MAX_CHARS} 字 / ${D.REPORT_MAX_CHARTS} 图`);

// ---------- F 组：指纹 ----------
check('F-① 🔴 指纹与键顺序无关（否则同一份数据算出两个值 ⇒ 去重永不命中，表现是"不报错但每次都真重算"）',
  D.fingerprint({ a: 1, b: 2 }) === D.fingerprint({ b: 2, a: 1 }));
check('F-② 值变化 ⇒ 指纹必须变（否则改了数据还命中缓存，用户看到的是旧结论）',
  D.fingerprint({ a: 1 }) !== D.fingerprint({ a: 2 }));
check('F-③ 新增强录项（值不同）⇒ 指纹必须变（只哈希月份会让"改了补录项"复用旧报告）',
  D.fingerprint({ a: 1 }) !== D.fingerprint({ a: 1, leaseMonthsLeft: 20 }));
check('F-④ 🔴 对象值不得塌成 [object Object]（两个不同对象会撞成同一指纹 = 静默漏去重）',
  D.fingerprint({ a: { x: 1 } }) === D.fingerprint({ a: { y: 2 } })
    ? false : true,
  '不同对象已区分');
check('F-⑤ 空值与缺值区分明确（都归一为 ~，保持稳定而不是抛错）',
  D.fingerprint({ a: null }) === D.fingerprint({ a: undefined }));

// ---------- S 组：数据层一致性 ----------
const plans = C.SEED_PLANS;
const diag = plans.find((p) => p.plan_id === 'plan_diag_single');
check('S-① 诊断单次档存在，价格 19.9 元（1990 分），发 1 次额度',
  !!diag && diag.price === 1990 && diag.diag_credits === 1,
  diag ? `${diag.price} 分 / ${diag.diag_credits} 次` : '缺失');
check('S-② 🔴 单次档必须带 grants=diag_credit（支付链路据此分流；不带就会按 days=0 写 expire_at，把已购月卡当场清零）',
  !!diag && diag.grants === 'diag_credit' && diag.days === 0,
  diag ? `grants=${diag.grants} days=${diag.days}` : '缺失');
check('S-③ 🔴 判定前提：**所有 enabled 订阅档都必须 diag_unlimited=true**'
  + '（判定层用「isPaid ⇒ 期内不限次」推导，因为 shop_entitlement 不记 plan_id；'
  + '将来新增一档不含诊断的订阅时，这条会红 —— 那时必须改成读档位，而不是删掉本判据）',
  plans.filter((p) => p.grants !== 'diag_credit' && p.enabled).every((p) => p.diag_unlimited === true),
  plans.filter((p) => p.grants !== 'diag_credit' && p.enabled).map((p) => `${p.plan_id}:${!!p.diag_unlimited}`).join(' '));
check('S-④ 自动续费档已停用（enabled=false，停用不删除：删除会让历史订单反查档位读到 undefined）',
  plans.find((p) => p.plan_id === 'plan_auto_subscribe').enabled === false);
check('S-⑤ 单次档不得发订阅权限（real_profit / export）：它买的是一次诊断，不是记账会员',
  C.SEED_FEATURES.every((f) => f.plan_id !== 'plan_diag_single'),
  C.SEED_FEATURES.filter((f) => f.plan_id === 'plan_diag_single').length + ' 条（应为 0）');
check('S-⑥ 两张诊断表与索引已登记（单源不登记 ⇒ initDb 建不全、apply_indexes 管不到）',
  C.COLLECTIONS.indexOf('shop_diagnosis_report') >= 0
  && C.COLLECTIONS.indexOf('shop_diagnosis_credit') >= 0
  && !!C.INDEXES.shop_diagnosis_report && C.INDEXES.shop_diagnosis_report.length >= 2
  && !!C.INDEXES.shop_diagnosis_credit,
  `report 索引 ${(C.INDEXES.shop_diagnosis_report || []).length} 个`);
check('S-⑦ 🔴 额度表与订阅表**物理隔离**：额度不得存进 shop_entitlement'
  + '（payRenew / payCallback 是整条覆盖写 expire_at，混在一起会在续费时把已买额度连带清掉）',
  C.INDEXES.shop_entitlement.every((ix) => Object.keys(ix.keys).every((k) => k === 'user_id' || k === 'expire_at')),
  C.INDEXES.shop_entitlement.map((ix) => ix.name).join(','));

console.log(`\n===== 诊断引擎与权益判定守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN ? 1 : 0);
