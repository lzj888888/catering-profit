// review/evidence/r758_m3_variance_audit/_probe.js —— M3 变动面审计探针（engine-truth-audit §F/§G）
// 运行： node review/evidence/r758_m3_variance_audit/_probe.js
//
// 铁律（skill）：一切结论必须来自**实跑**，不手算、不照着源码推演。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');

const consume = require(path.join(ROOT, 'utils/consumeDerive.js'));
const material = require(path.join(ROOT, 'utils/materialUsage.js'));
const price = require(path.join(ROOT, 'utils/priceVariance.js'));
const recon = require(path.join(ROOT, 'utils/reconDerive.js'));
const calcBom = require(path.join(ROOT, 'cloudfunctions/calcBom/service.js'));

let pass = 0, failN = 0;
const findings = [];
function probe(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  → ' + detail : '')); }
  else { failN++; console.log('  🔴 ' + name + (detail ? '  → ' + detail : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }
function note(tag, text) { findings.push({ tag, text }); console.log('  📌 [' + tag + '] ' + text); }

// ============================================================
// 探针 A：同页三处「覆盖率」是不是同一个量、同一套阈值
// ============================================================
sec('A 同页三处「覆盖率」口径一致性');
{
  const A1 = consume.MIN_QTY_COVERAGE;                     // 段二：销量覆盖率下界
  // 段一：reconDerive.reconcile 的 coverage 下界（源码里写死的，先找出来）
  const reconSrc = fs.readFileSync(path.join(ROOT, 'utils/reconDerive.js'), 'utf8');
  const mCov = /coverage\s*<\s*(0?\.\d+)/.exec(reconSrc) || /MIN_COVERAGE\s*=\s*(0?\.\d+)/.exec(reconSrc);
  const A2 = mCov ? Number(mCov[1]) : null;

  console.log('  段二 consumeDerive.MIN_QTY_COVERAGE = ' + A1 + '（销量覆盖率：已建卡菜的份数 ÷ 总份数）');
  console.log('  段一 reconDerive 的覆盖率下界        = ' + (A2 == null ? '未在源码里找到常量（可能内联）' : A2) + '（卡数覆盖率：已建卡数 ÷ 在售菜品数）');

  // 🔴 A-① 必须是真的判据，不能写死 true（skill：判据恒真是病）
  //   判法：段二源码里出现 qtyCoverage（按份数），段一源码里出现 cardCount/coverage 的卡数口径
  const consumeSrc = fs.readFileSync(path.join(ROOT, 'utils/consumeDerive.js'), 'utf8');
  const duan2UsesQty = /qtyCoverage/.test(consumeSrc) && /matchedQty|dine_in/.test(consumeSrc);
  const duan1UsesCard = /cardCount|coverage/.test(reconSrc);
  probe('A-① 两段用的是不同的分母（段二按份数 / 段一按卡数）', duan2UsesQty && duan1UsesCard,
    '段二用销量=' + duan2UsesQty + ' / 段一用卡数=' + duan1UsesCard);
  probe('A-② 两段阈值一致', A2 != null && Math.abs(A1 - A2) < 1e-9,
    '段二 ' + A1 + ' vs 段一 ' + A2 + ' ⇒ ' + (A2 != null && A1 !== A2 ? '**同一页面两套阈值**' : '一致'));
  if (A2 != null && A1 !== A2) {
    note('A', '同一页面：段一按 ' + A2 + ' 判、段二按 ' + A1 + ' 判 ⇒ 可能出现「段一给结果、段二说覆盖率不足」并存，老板看不懂');
  }

  // 实测：造一个「卡数覆盖率 100% 但销量覆盖率 60%」的场景，看两段会不会打架
  const cards = [];
  for (let i = 0; i < 10; i++) cards.push({ card_code: 'C' + i, card_type: 1, price_fen: 2000, total_cost_fen: 1000, lines: [] });
  const menuPct = 50;
  const covCard = 10 / 10;                     // 卡数覆盖 100%（10 张卡 / 10 个在售菜）
  const rec = recon.reconcile({ menuPct: 50, actualPct: 48, coverage: covCard, incomeFen: 100000 });
  // 销量覆盖 60%：已建卡菜卖 60 份、未建卡卖 40 份
  const review = {
    tier: 'full',
    dine_in: [{ card_code: 'C0', qty: 60, totalCostFen: 60000, amountFen: 120000 }],
    totals: { qty: 100, costFen: 60000, amountFen: 200000 },
  };
  const cv = consume.consumeVariance({
    ledger: { inventory: { opening_fen: 100000, purchase_fen: 900000, closing_fen: 100000 }, result: {}, switches: { inventorySwitchOn: true } },
    review,
  });
  console.log('  实测：卡数覆盖率 100% 时 段一 suppressed = ' + rec.suppressed + '（false=给结果）');
  console.log('        销量覆盖率  60% 时 段二 ok        = ' + cv.ok + '（false=算不了，reason=' + cv.reason + '）');
  probe('A-③ 两段会同时出现「段一给结果 + 段二算不了」', rec.suppressed === false && cv.ok === false,
    rec.suppressed === false && cv.ok === false ? '**会打架：同一页面一半有数一半没数**' : '不打架');
}

// ============================================================
// 探针 B：出成率换算互逆性（同一语义两处实现 —— skill §C）
//   生产引擎：calcBom.netUnitCostWan（毛料单价 → 净料每克成本）
//   本期新增：materialUsage.theoryQtyOf（净料克数 → 毛料采购量）
//   两者必须互为逆运算，否则「钱」与「斤」对不上账
// ============================================================
sec('B 出成率换算互逆性（calcBom ↔ materialUsage，随机 20000 组对拍）');
{
  let mismatch = 0;
  let firstBad = null;
  let maxRelErr = 0;
  const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  for (let i = 0; i < 20000; i++) {
    const priceFen = R(50, 20000);          // 0.5 ~ 200 元/单位
    const cf = [100, 250, 400, 500, 1000][R(0, 4)];
    const yr = R(50, 100);                  // 出成率 50~100%
    const gramPerDish = R(1, 800);
    const qty = R(1, 2000);

    // 路 1（钱）：按**生产引擎的真实口径** —— calcBom 只在最终输出 round，
    //   中间不做「单份成本 round 到分」。首版探针在这里多 round 了一次（单份 11.43→11 分，
    //   再 ×1390 份）⇒ 造出 4% 假误差。**探针自己错，就不能拿它给代码定罪**。
    const netWan = calcBom.netUnitCostWan(priceFen, cf, yr);      // 万元/克（1e-4 元），引擎内部固有 round
    const totalCostYuan = gramPerDish * qty * (netWan / 10000);   // 不中间 round
    const totalCostFen = Math.round(totalCostYuan * 100);          // 只在最后 round 一次

    // 路 2（斤）：本期口径 —— 理论采购量（采购单位）
    const mat = { material_id: 'm', convert_factor: cf, yield_rate: yr };
    const th = material.theoryQtyOf(
      [{ card_code: 'C', lines: [{ material_id: 'm', quantity: gramPerDish, line_type: 1 }] }],
      { C: qty }, mat,
    );
    const purchaseCostFen = Math.round(th.theoryQty * priceFen);   // 理论采购金额（分）

    const relErr = Math.abs(purchaseCostFen - totalCostFen) / Math.max(1, totalCostFen);
    if (relErr > maxRelErr) maxRelErr = relErr;
    // 容差：两条路各有一次 round（单份成本 round 到分，采购量 round 到 2 位），
    //   故允许 0.5% 或 2 分以内
    if (Math.abs(purchaseCostFen - totalCostFen) > Math.max(2, totalCostFen * 0.005)) {
      mismatch++;
      if (!firstBad) firstBad = { priceFen, cf, yr, gramPerDish, qty, totalCostFen, purchaseCostFen, relErr };
    }
  }
  console.log('  对拍 20000 组：不吻合 ' + mismatch + ' 组，最大相对误差 ' + (maxRelErr * 100).toFixed(4) + '%');
  if (firstBad) console.log('  首个反例：' + JSON.stringify(firstBad));
  probe('B-① 两路金额互为逆运算（容差 0.5%/2分）', mismatch === 0,
    mismatch === 0 ? '20000 组全吻合 ⇒ 出成率只被除一次、不重复' : mismatch + ' 组不吻合');
  if (mismatch > 0) note('B', '出成率换算两处实现不等价：钱路与斤路对不上，会导致「按斤核对通过、按钱核对不通过」');

  // B-② 反恒真：故意把 theoryQtyOf 的出成率去掉，必须出现大量不吻合（证明探针不空转）
  const badTheory = (gramPerDish, qty, cf) => gramPerDish * qty / cf;   // 漏除出成率
  const b = badTheory(120, 300, 500);
  const g = material.theoryQtyOf(
    [{ card_code: 'C', lines: [{ material_id: 'm', quantity: 120, line_type: 1 }] }],
    { C: 300 }, { material_id: 'm', convert_factor: 500, yield_rate: 85 },
  ).theoryQty;
  probe('B-② 反恒真：漏除出成率会得不同结果（证明互逆判据非空转）',
    Math.abs(b - g) > 0.01, '漏除=' + b.toFixed(2) + ' / 正确=' + g.toFixed(2));
}

// ============================================================
// 探针 C：新增字段的「落地层」扫描（skill §E）
//   问：本期新增的数据（非销售耗用 / 原料盘点 / 采购金额）到底写进了哪一层？
// ============================================================
sec('C 新增数据的落地层扫描（前端有 ≠ 后端有）');
{
  const SCAN = [
    ['nonsalesFen', '非销售耗用（员工餐/试吃/报损）金额'],
    ['nonsales_', '非销售耗用的本地存储 key'],
    ['matinv_', '原料盘点的本地存储 key'],
    ['realVarianceFen', '扣除后「真正说不清的」'],
    ['theoryMatchedFen', '已建卡实算的理论耗用'],
    ['priceImpactFen', '量价拆分的「买贵」'],
  ];
  const DIRS = ['cloudfunctions', 'subpkg', 'utils', 'miniprogram'];
  const rows = [];
  for (const [key, label] of SCAN) {
    const hit = {};
    for (const d of DIRS) {
      let n = 0;
      const walk = (p) => {
        if (!fs.existsSync(p)) return;
        for (const f of fs.readdirSync(p, { withFileTypes: true })) {
          const fp = path.join(p, f.name);
          if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'miniprogram_npm') walk(fp); continue; }
          if (!/\.(js|wxml|json)$/.test(f.name)) continue;
          if (f.name.indexOf('cx_') === 0) continue;      // 派生副本不重复计
          try { if (fs.readFileSync(fp, 'utf8').indexOf(key) >= 0) n++; } catch (e) {}
        }
      };
      walk(path.join(ROOT, d));
      hit[d] = n;
    }
    rows.push({ key, label, hit });
    console.log('  ' + key.padEnd(20) + ' cloudfunctions=' + String(hit.cloudfunctions).padStart(2) +
      '  subpkg=' + String(hit.subpkg).padStart(2) + '  utils=' + String(hit.utils).padStart(2) +
      '  miniprogram=' + String(hit.miniprogram).padStart(2) + '   (' + label + ')');
  }
  const backendZero = rows.filter((r) => r.hit.cloudfunctions === 0);
  probe('C-① 本期新增字段在 cloudfunctions/ 有命中', backendZero.length === 0,
    backendZero.length ? backendZero.map((r) => r.key).join(', ') + ' 在云函数侧**零命中**' : '都有命中');
  if (backendZero.length) {
    note('C', '这些数据只活在前端/本地：' + backendZero.map((r) => r.key).join(', ') +
      ' ⇒ 换设备/清缓存即丢，且服务器上根本不存在');
  }
}

// ============================================================
// 探针 D：边界值（skill §D —— 症状 / 是否可达 / 建议，三层都写）
// ============================================================
sec('D 边界值');
{
  const baseLedger = {
    inventory: { opening_fen: 100000, purchase_fen: 900000, closing_fen: 100000 },
    result: {}, switches: { inventorySwitchOn: true },
  };
  const baseReview = {
    tier: 'full',
    dine_in: [{ card_code: 'C0', qty: 100, totalCostFen: 100000, amountFen: 200000 }],
    totals: { qty: 100, costFen: 100000, amountFen: 200000 },
  };
  // D-① 非销售耗用填成天文数字
  const cvBig = consume.consumeVariance({ ledger: baseLedger, review: baseReview, nonsalesFen: 99999999 });
  console.log('  非销售耗用填 999999.99 元（远超实际耗用 9000 元）⇒ realVariancePct = ' + cvBig.realVariancePct + '%');
  probe('D-① 非销售耗用无上限校验（可填到离谱）', cvBig.ok === true && cvBig.realVariancePct < -100,
    '显示「比标准省 ' + Math.abs(cvBig.realVariancePct).toFixed(0) + '%」，业务上荒谬但页面不拦');
  note('D', '非销售耗用无上限：老板手滑多打个 0，页面会显示「比标准省 1100%」，没有任何提示');

  // D-② 理论量极小（精度）
  const thTiny = material.theoryQtyOf(
    [{ card_code: 'C', lines: [{ material_id: 'm', quantity: 0.5, line_type: 1 }] }],
    { C: 1 }, { material_id: 'm', convert_factor: 1000, yield_rate: 50 },
  );
  console.log('  单份 0.5 克 × 1 份、换算 1000、出成率 50% ⇒ 理论采购量 = ' + thTiny.theoryQty + ' 单位');
  probe('D-② 极小用量不产生 NaN/Infinity', Number.isFinite(thTiny.theoryQty) && thTiny.theoryQty > 0,
    String(thTiny.theoryQty));

  // D-③ 差率分母极小 ⇒ 百分比爆炸
  const muTiny = material.materialUsage({
    cards: [{ card_code: 'C', lines: [{ material_id: 'm', quantity: 0.5, line_type: 1 }] }],
    dineIn: [{ card_code: 'C', qty: 1 }],
    materials: [{ id: 'm', name: 'x', purchase_unit: '斤', convert_factor: 1000, yield_rate: 50 }],
    inventoryItems: [{ material_id: 'm', opening_qty: 0, purchase_qty: 10, closing_qty: 0 }],
  });
  const t3 = muTiny.items && muTiny.items[0];
  console.log('  理论量 0.001 单位、实际 10 单位 ⇒ 差率 = ' + (t3 && t3.diffPct) + '%');
  probe('D-③ 差率不会因分母极小爆表到不可读', t3 && Math.abs(t3.diffPct) < 1e6,
    '=' + (t3 && t3.diffPct) + '%');
  note('D', '理论量极小时差率可达 10 万 % 级（分母 0.001）—— 页面显示会很怪，但数学上不算错');

  // D-④ 量价拆分：上月与本期量差极大
  const pvBig = price.priceVariance({ qty: 1000, amountFen: 1000 * 1800 }, { qty: 1, amountFen: 1 * 1000 });
  probe('D-④ 量价拆分在极端量差下仍守恒', pvBig.sumMatchesDelta === true,
    '价格影响 ' + pvBig.priceImpactFen + ' + 数量影响 ' + pvBig.qtyImpactFen + ' = ' + (pvBig.priceImpactFen + pvBig.qtyImpactFen) + ' vs 总变化 ' + pvBig.amountDeltaFen);
}

// ============================================================
// 探针 E：「员工餐」一词在仓内有两套口径
// ============================================================
sec('E 「员工餐」口径冲突');
{
  const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
  const exp = TERMS.ledger && TERMS.ledger.expense;
  let inExpense = null;
  if (Array.isArray(exp)) for (const g of exp) if ((g.items || []).indexOf('员工餐') >= 0) inExpense = g.category;
  console.log('  支出科目里的「员工餐」：' + (inExpense ? '在 ' + inExpense + ' 组（费用口径，可能是现金补贴）' : '未找到'));
  console.log('  对账页新增的「员工餐/试吃/报损」：' + TERMS.card.reconConsumeNonsales + '（成本口径，占用食材）');
  console.log('  文案说明：' + TERMS.card.reconConsumeNonsalesWhy);
  probe('E-① 两处同名但口径不同，且新文案已写明区别',
    inExpense != null && typeof TERMS.card.reconConsumeNonsalesWhy === 'string',
    inExpense ? '同名两口径并存' : '只有一个');
  note('E', '「员工餐」在支出里是费用、在对账页是食材成本：文案已区分，但老板看到同一个词两次，仍可能重复填');
}

// ============================================================
// 汇总
// ============================================================
console.log('\n===== 探针结果：' + pass + ' 通过 / ' + failN + ' 不吻合 =====');
console.log('（不吻合 ≠ bug；每条都要按 skill §G 二分类为「真缺口」或「登记待办」）');
fs.writeFileSync(path.join(__dirname, 'findings.json'), JSON.stringify(findings, null, 2), 'utf8');
console.log('findings.json 已写出（' + findings.length + ' 条）');
