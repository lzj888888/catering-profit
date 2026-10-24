// tools/check_m1_engine_parity.js —— R477 · M1 双利润引擎「三副本行为等价」守卫
//
// ===== 为什么立这条（R477，2026-10-25）=====
// M1 的双利润内核有**三份手写副本**（本仓不许跨云函数共享代码，只能扁平派生）：
//   · cloudfunctions/calcMonthlyProfit/service.js  （试算 / 前端实时算）
//   · cloudfunctions/saveLedger/service.js         （保存落库时算）
//   · cloudfunctions/getLedger/service.js          （回读重算，防篡改）
// 此前**只有 M3 有等价比对守卫**（tools/check_m3_engine_parity.js），M1 这一侧是空的 ——
// 而 R477 要改的正是 M1 的口径（库存模式且未填直接消耗 ⇒ 参考口径回落倒轧），
// 三份里漏改任何一份，症状是「同一份账，保存时的利润 ≠ 回读看到的利润」，
// **不报错、不异常、只是数字悄悄不一样**（与 R130 写库静默 0 行同族的**静默错**）。
//
// 🔴 所以本守卫是 R477 的**前置**，不是事后补的：先有它，才敢动口径。
//
// ===== 判据 =====
// A. 三份副本均可 require，且 calcMonthlyProfit 是函数（非退化：确认判据真跑起来了）。
// B. **确定性伪随机 3000 组**输入，三副本输出**逐字段一致**（16 个公共字段）。
//    输入刻意混入 0 / null / undefined / '' / 字符串数字 / NaN，覆盖归一化路径。
// C. **S1 / S2 / S2R 既有锚点回归**，且**在三份副本上同时成立**（任一副本漂了即红）。
// D. **反恒真**：对拍必须有分辨力 —— 输入敏感 + 变体实现（偏移 1 分）必须被判不等。
// E. **R477 口径专项**（这一段是本次改动的落点，先红后绿）：
//    ① 库存开 + **未填**直接消耗 ⇒ 参考口径必须改用倒轧（refMaterialSource='reverse'）
//    ② 库存开 + **显式填了**直接消耗 ⇒ 参考口径仍用填的值（口径锁，不许被 ① 带偏）
//    ③ 库存关             ⇒ 参考口径恒用填的值
//    ④ 差异恒等式仍成立：参考 − 真实 === 差异（三副本都成立）
// F. 断言数下界（防后人删断言）。

const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CF = path.join(REPO, 'cloudfunctions');

// 三份副本（第一份为对拍基准）
const COPIES = ['calcMonthlyProfit', 'saveLedger', 'getLedger'];

// 参与比对的公共字段（calcMonthlyProfit 版另有一批 *Yuan 展示字段，不参与比对 ——
// 判文本会假红，本守卫只判**行为**，与 M3 守卫同原则）
const KEYS = [
  'incomeTotalFen', 'expenseTotalFen', 'materialCostFen', 'directConsumeFen', 'realConsumeFen',
  'grossProfitFen', 'grossMarginRatePct', 'grossMarginRatePctDisplay',
  'amortizeFen', 'effectiveAmortizeFen', 'lumpSumFen', 'effectiveLumpSumFen',
  'operationRefProfitFen', 'totalFactorRealProfitFen', 'profitDiffFen', 'diffCheck',
  // R477 新增三键也必须三副本一致（否则前端拿到的"为什么不一样"解释会随调用路径变）
  'refMaterialFen', 'refMaterialSource', 'profitCaliberVersion',
];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('✅ ' + m); };
const no = (m) => { fail++; console.log('❌ ' + m); };
const check = (m, c) => (c ? ok(m) : no(m));

const sig = (o) => KEYS.map((k) => String(o && o[k])).join('|');

// ===================== A. 副本可加载 =====================
console.log('===== A. 副本可加载（非退化）=====');
const mods = {};
for (const c of COPIES) {
  const p = path.join(CF, c, 'service.js');
  let m = null, err = null;
  try { m = require(p); } catch (e) { err = (e && e.message) || String(e); }
  mods[c] = m;
  check('A 副本 ' + c + '/service.js 可 require 且 calcMonthlyProfit 是函数',
    !!m && typeof m.calcMonthlyProfit === 'function');
  if (err) console.log('    ↳ require 失败原因：' + err);
}

const BASE = mods.calcMonthlyProfit;
const allLoaded = COPIES.every((c) => mods[c] && typeof mods[c].calcMonthlyProfit === 'function');

// ===================== B. 3000 组随机对拍 =====================
console.log('');
console.log('===== B. 确定性伪随机 3000 组对拍 =====');

// LCG（确定性，禁 Math.random —— 否则同一份代码两次跑出不同结论，红了也复现不了）
let seed = 20261025;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const rndInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const itemsFen = (n, maxEach) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ amountFen: rndInt(0, maxEach) });
  return out;
};

// 直接消耗的「脏输入矩阵」：未填 / null / '' / 显式 0 / 正数 / 字符串数字
const DIRECT_CASES = [
  undefined, null, '', 0, 1, 0.5, '200', '0', NaN,
];

const N = 3000;
let mism = 0;
let firstMism = null;
if (allLoaded) {
  for (let i = 0; i < N; i++) {
    const dRaw = i < 200 ? pick(DIRECT_CASES) : rndInt(0, 3000000); // 前 200 组专打脏输入
    const input = {
      incomeItems: itemsFen(rndInt(0, 5), 1200000),
      expenseItems: itemsFen(rndInt(0, 8), 800000),
      directConsumeFen: dRaw,
      amortizeFen: pick([0, rndInt(0, 600000), '3333.4', NaN]),
      amortizeSwitchOn: rnd() > 0.5,
      inventorySwitchOn: rnd() > 0.5,
      inventory: {
        openingFen: rndInt(0, 900000),
        purchaseFen: rndInt(0, 2500000),
        closingFen: rndInt(0, 900000),
      },
      lumpSumFen: pick([0, rndInt(0, 400000)]),
    };
    const outs = COPIES.map((c) => {
      try { return mods[c].calcMonthlyProfit(input); } catch (e) { return { __err: String(e && e.message || e) }; }
    });
    const s0 = sig(outs[0]);
    for (let j = 1; j < outs.length; j++) {
      if (sig(outs[j]) !== s0) {
        mism++;
        if (!firstMism) {
          firstMism = '第 ' + i + ' 组：' + COPIES[0] + ' = ' + s0 + ' ／ ' + COPIES[j] + ' = ' + sig(outs[j]);
        }
        break;
      }
    }
  }
}
check('B-① ' + N + ' 组随机输入三副本输出逐字段一致（不一致 ' + mism + ' 组）', allLoaded && mism === 0);
if (firstMism) console.log('    ↳ 首个不一致：' + firstMism);
check('B-② 对拍真跑了（3000 组 × 2 次比对，非退化）', allLoaded && N === 3000);

// ===================== C. 既有锚点回归（三副本同时） =====================
console.log('');
console.log('===== C. S1 / S2 / S2R 锚点回归 =====');

const YUAN = 100;
const INCOME_ITEMS = [8000, 25000, 5000, 3000, 2000, 18000, 500, 1500, 1000].map((y) => ({ amountFen: y * YUAN }));
const EXPENSE_ITEMS = [8000, 500, 200, 800, 600, 100, 100, 12000, 1500, 800, 500, 200, 3600, 1200, 1500, 300, 400, 240, 300].map((y) => ({ amountFen: y * YUAN }));
const DIRECT_FEN = 22000 * YUAN;
const AMORTIZE_FEN = Math.round(4683.33 * YUAN);

const S1 = () => ({
  incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS,
  directConsumeFen: DIRECT_FEN, amortizeFen: AMORTIZE_FEN,
  amortizeSwitchOn: false, inventorySwitchOn: false, inventory: {},
});
const S2 = () => ({
  incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS,
  directConsumeFen: DIRECT_FEN, amortizeFen: AMORTIZE_FEN,
  amortizeSwitchOn: true, inventorySwitchOn: true,
  inventory: { openingFen: 5000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN },
});
const S2R = () => ({
  incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS,
  directConsumeFen: DIRECT_FEN, amortizeFen: AMORTIZE_FEN,
  amortizeSwitchOn: true, inventorySwitchOn: true,
  inventory: { openingFen: 3000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN },
});

if (allLoaded) {
  const bs = BASE.calcMonthlyProfit(S1());
  const b2 = BASE.calcMonthlyProfit(S2());
  const b2r = BASE.calcMonthlyProfit(S2R());
  check('C-① S1 收入合计 = 6,400,000 分（实测 ' + bs.incomeTotalFen + '）', bs.incomeTotalFen === 6400000);
  check('C-② S1 费用合计 = 3,284,000 分（实测 ' + bs.expenseTotalFen + '）', bs.expenseTotalFen === 3284000);
  check('C-③ S1 🟢经营参考利润 = 916,000（实测 ' + bs.operationRefProfitFen + '）', bs.operationRefProfitFen === 916000);
  check('C-④ S1 🔵全要素真实利润 = 916,000（库存关无倒轧，实测 ' + bs.totalFactorRealProfitFen + '）', bs.totalFactorRealProfitFen === 916000);
  check('C-⑤ S2 本期真实消耗 = 2,300,000（实测 ' + b2.realConsumeFen + '）', b2.realConsumeFen === 2300000);
  check('C-⑥ S2 🟢经营参考仍 = 916,000（🔴 口径锁：用填的 22,000 不是倒轧 23,000；实测 ' + b2.operationRefProfitFen + '）', b2.operationRefProfitFen === 916000);
  check('C-⑦ S2 🔵全要素真实利润 = 347,667（实测 ' + b2.totalFactorRealProfitFen + '）', b2.totalFactorRealProfitFen === 347667);
  check('C-⑧ S2 两利润差异 = 568,333（实测 ' + b2.profitDiffFen + '）', b2.profitDiffFen === 568333);
  check('C-⑨ S2-R 本期真实消耗 = 2,100,000（实测 ' + b2r.realConsumeFen + '）', b2r.realConsumeFen === 2100000);
  check('C-⑩ S2-R 🔵全要素真实利润 = 547,667（实测 ' + b2r.totalFactorRealProfitFen + '）', b2r.totalFactorRealProfitFen === 547667);
  check('C-⑪ 锚点回归在**三份副本上同时成立**（任一副本漂了即红）',
    COPIES.every((c) => {
      try {
        const a = mods[c].calcMonthlyProfit(S1());
        const b = mods[c].calcMonthlyProfit(S2());
        return a.operationRefProfitFen === 916000 && b.operationRefProfitFen === 916000
          && b.totalFactorRealProfitFen === 347667 && b.profitDiffFen === 568333;
      } catch (e) { return false; }
    }));
}

// ===================== D. 反恒真：对拍必须有分辨力 =====================
console.log('');
console.log('===== D. 反恒真（对拍必须能分辨差异）=====');

if (allLoaded) {
  // D-① 输入敏感：只改期初 1 分 ⇒ 输出必须不同
  const a1 = S2(), a2 = S2();
  a2.inventory.openingFen += 1;
  check('D-① 输入敏感：期初 +1 分时输出必须不同（对拍有分辨力）',
    sig(BASE.calcMonthlyProfit(a1)) !== sig(BASE.calcMonthlyProfit(a2)));

  // D-② 输入敏感：只改摊销开关 ⇒ 输出必须不同
  const b1 = S2(), b2 = S2();
  b2.amortizeSwitchOn = false;
  check('D-② 输入敏感：摊销开关 true→false 时输出必须不同',
    sig(BASE.calcMonthlyProfit(b1)) !== sig(BASE.calcMonthlyProfit(b2)));

  // D-③ 变体实现：构造「参考利润偏移 1 分」的假引擎，断言对拍判它不等
  const shifted = (p) => {
    const o = BASE.calcMonthlyProfit(p);
    return Object.assign({}, o, { operationRefProfitFen: o.operationRefProfitFen + 1 });
  };
  check('D-③ 变体实现（参考利润偏移 1 分）必须被对拍判为不等',
    sig(shifted(S2())) !== sig(BASE.calcMonthlyProfit(S2())));

  // D-④ 脏输入不产生 NaN（三副本一致）
  check('D-④ 脏输入（字符串/NaN/缺字段）时三副本均产生有限数',
    COPIES.every((c) => {
      const o = mods[c].calcMonthlyProfit({
        incomeItems: [{ amountFen: '100' }, { amountFen: NaN }],
        expenseItems: [{ amountFen: 50 }],
        directConsumeFen: 'abc', amortizeFen: NaN,
        amortizeSwitchOn: 1, inventorySwitchOn: 'x',
      });
      return Number.isFinite(o.operationRefProfitFen) && Number.isFinite(o.totalFactorRealProfitFen);
    }));
}

// ===================== E. R477 口径专项 =====================
// 背景（老板真机反馈，2026-10-24）：「口径差异为什么等于食材成本？」
//   根因：库存模式下「直接填的消耗」那栏**不显示、值为 0** ⇒ 经营参考利润
//         = 收入 − 费用 − 0 − 一次性投入，**完全没扣食材** ⇒ 虚高，且差异恒等于食材成本。
//   修法（R477）：库存开 **且未填** direct ⇒ 参考口径回落到倒轧值（那个栏不存在，就用拿得到的最好数据）。
//   🔴 判据实测修正（别按外审原话写）：外审要求分开「未填」与「显式填 0」，**本仓行不通** ——
//      库存页保存时前端写死 `direct_consume_fen: ... || 0`（subpkg/biz/month/inventory.js:240）
//      ⇒ 库存模式下**恒传 0**，那个 0 是**占位**不是意图（那栏 UI 根本不显示，老板无处声明）。
//      硬按"显式 0 要尊重"处理 = 把 bug 原样保留 ⇒ 判据定为 **库存开 且 填的消耗 ≤ 0 ⇒ 回落**。
//   🔴 口径锁仍在：库存开**且填了正数** ⇒ 参考口径**仍用填的值**（S2 锚点就是这个形态，不许被带偏）。
console.log('');
console.log('===== E. R477 口径专项（库存模式未填 ⇒ 参考回落倒轧）=====');

if (allLoaded) {
  // 库存开 + 未填 direct（undefined）
  const invOn = {
    incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS,
    directConsumeFen: undefined, amortizeFen: AMORTIZE_FEN,
    amortizeSwitchOn: true, inventorySwitchOn: true,
    inventory: { openingFen: 5000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN },
  };
  const rInv = BASE.calcMonthlyProfit(invOn);
  // 参考口径若用了倒轧 23,000 ⇒ 参考 = 64,000 − 32,840 − 23,000 = 8,160 元
  check('E-① 库存开 + **未填**直接消耗 ⇒ 参考利润改用倒轧 23,000（实测 ' + rInv.operationRefProfitFen + '，应 = 816000）',
    rInv.operationRefProfitFen === 816000);
  check('E-② 同上：差异只剩当月摊销（实测 ' + rInv.profitDiffFen + '，应 = 468333）',
    rInv.profitDiffFen === 468333);

  // 库存开 + 显式传 0（前端库存页保存就是这个形态）⇒ **也回落**（那个 0 是占位不是意图）
  const rZero = BASE.calcMonthlyProfit(Object.assign({}, invOn, { directConsumeFen: 0 }));
  check('E-③ 库存开 + **显式传 0**（前端库存页恒传）⇒ **同样回落**倒轧（实测 ' + rZero.operationRefProfitFen + '，应 = 816000）',
    rZero.operationRefProfitFen === 816000);

  // 库存开 + 只填了 1 分（正数）⇒ 口径锁：仍用填的值，不许回落
  const rOne = BASE.calcMonthlyProfit(Object.assign({}, invOn, { directConsumeFen: 1 }));
  check('E-③b 库存开 + 填了正数（哪怕 1 分）⇒ 口径锁成立不回落（实测 ' + rOne.operationRefProfitFen + '）',
    rOne.operationRefProfitFen === 6400000 - 3284000 - 1);

  // 库存开 + 填了值 ⇒ 口径锁：仍用填的值
  const rFilled = BASE.calcMonthlyProfit(Object.assign({}, invOn, { directConsumeFen: DIRECT_FEN }));
  check('E-④ 库存开 + **填了 22,000** ⇒ 口径锁成立，参考仍 = 916,000（实测 ' + rFilled.operationRefProfitFen + '）',
    rFilled.operationRefProfitFen === 916000);

  // 库存关 ⇒ 参考恒用填的值（未填即 0，无倒轧可用）
  const offInv = Object.assign({}, invOn, { inventorySwitchOn: false });
  const rOff = BASE.calcMonthlyProfit(offInv);
  check('E-⑤ 库存关 ⇒ 参考口径用填的值（未填记 0，实测 ' + rOff.operationRefProfitFen + '）',
    rOff.operationRefProfitFen === 6400000 - 3284000);

  // 差异恒等式：参考 − 真实 === 差异（三副本、四种形态全成立）
  const SHAPES = [invOn, Object.assign({}, invOn, { directConsumeFen: 0 }),
    Object.assign({}, invOn, { directConsumeFen: DIRECT_FEN }), offInv, S1(), S2(), S2R()];
  check('E-⑥ 差异恒等式（参考 − 真实 === 差异）在 7 种形态 × 三副本上全成立',
    COPIES.every((c) => SHAPES.every((s) => {
      const o = mods[c].calcMonthlyProfit(s);
      return o.operationRefProfitFen - o.totalFactorRealProfitFen === o.profitDiffFen;
    })));

  // 出参可追溯：参考口径用了哪个数、来源是什么（前端要据此解释，不许瞎猜）
  check('E-⑦ 出参带 refMaterialFen / refMaterialSource（前端解释差异的取数单源，三副本都有）',
    COPIES.every((c) => {
      const o = mods[c].calcMonthlyProfit(invOn);
      return o.refMaterialFen === 2300000 && o.refMaterialSource === 'reverse';
    }));
  check('E-⑧ 同上：库存开且填了值时 refMaterialSource = \'direct\'',
    COPIES.every((c) => {
      const o = mods[c].calcMonthlyProfit(Object.assign({}, invOn, { directConsumeFen: DIRECT_FEN }));
      return o.refMaterialSource === 'direct' && o.refMaterialFen === DIRECT_FEN;
    }));
  check('E-⑨ 出参带 profitCaliberVersion（旧快照无此键 ⇒ 前端按旧口径解释，不说谎）',
    COPIES.every((c) => !!mods[c].calcMonthlyProfit(invOn).profitCaliberVersion));
}

// ===================== F. 断言数下界 =====================
console.log('');
console.log('===== F. 覆盖度 =====');
const TOTAL = pass + fail;
check('F-① 断言数 ≥ 20（实测实测值的保守下沿）', TOTAL >= 20);

console.log('');
console.log('==== R477 M1 引擎三副本等价守卫：' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fail) {
  console.log('--- 违规要点 ---');
  console.log('  1) 若 B 段红：某份 service.js 的 calcMonthlyProfit 被单独改坏了 —— 三副本必须同步改。');
  console.log('  2) 若 C 段红：M1 既有锚点漂了 —— 最高级别事故，先回退再查。');
  console.log('  3) 若 E 段红：R477 口径改动没落全，或落到了其中一份副本上。');
  process.exit(1);
}
