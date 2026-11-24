// utils/materialUsage.selftest.js —— 原料级用量核对（纯 node 直跑）
// 运行： node utils/materialUsage.selftest.js
//
// 🔴 本文件最要紧的一条：**出成率必须除**。
//   成本卡 quantity 是净料克数，老板买的是毛料 ⇒ 理论采购量 = 净料克数 ÷ 出成率 ÷ 换算系数。
//   少除这一步，理论值偏小 ⇒ 显示「买多了」⇒ 冤枉采购。所以专门做了反恒真样本。
const { materialUsage, theoryQtyOf, missingKeyOf } = require('./materialUsage.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ---------- 夹具（严格照抄云函数真实出参结构）----------
// getCostCard.list：{ card_code, lines:[{ material_id, quantity(克), line_type }] }
const CARDS = [
  { card_code: 'C001', lines: [
    { material_id: 'mat_beef', quantity: 200, line_type: 1 },   // 红烧牛肉：每份 200g 牛肉净料
    { material_id: 'mat_oil', quantity: 30, line_type: 1 },
  ] },
  { card_code: 'C002', lines: [
    { material_id: 'mat_beef', quantity: 150, line_type: 1 },   // 牛肉面：每份 150g
    { material_id: 'mat_noodle', quantity: 120, line_type: 1 },
  ] },
  // 套餐卡：子卡行（line_type=2）不该被重复计入原料
  { card_code: 'C900', card_type: 3, lines: [
    { material_id: 'mat_beef', quantity: 999, line_type: 2, sub_card_ref: 'C001' },
  ] },
];
// getDishReview.dine_in：{ card_code, qty }
const DINE_IN = [
  { card_code: 'C001', qty: 100 },
  { card_code: 'C002', qty: 50 },
  { card_code: 'C900', qty: 10 },     // 卖 10 份套餐
  { card_code: 'C_UNKNOWN', qty: 30 }, // 没建卡的菜（应被忽略，不影响原料理论量）
];
const MATERIALS = [
  { material_id: 'mat_beef', name: '牛肉', purchase_unit: '斤', convert_factor: 500, yield_rate: 90 },
  { material_id: 'mat_oil', name: '食用油', purchase_unit: '斤', convert_factor: 500, yield_rate: 100 },
  { material_id: 'mat_noodle', name: '面条', purchase_unit: '斤', convert_factor: 500, yield_rate: 100 },
  { material_id: 'mat_rice', name: '大米', purchase_unit: '斤', convert_factor: 500, yield_rate: 100 }, // 不在任何卡里
];

// ===== 1) theoryQtyOf：出成率换算（本模块最核心的一条）=====
{
  const beef = MATERIALS[0];
  const qtyMap = { C001: 100, C002: 50, C900: 10 };
  const th = theoryQtyOf(CARDS, qtyMap, beef);
  // 净料 = 100×200 + 50×150 = 27,500 克（套餐子卡行不计）
  check('理论净料克数 = 27,500 克（100×200 + 50×150，套餐子卡行不重复计）', th.netGram === 27500, '=' + th.netGram);
  // 理论采购 = 27500 ÷ 0.9 ÷ 500 = 61.111… 斤
  check('🔴 理论采购量 = 61.11 斤（÷出成率 0.9 ÷换算 500）',
    Math.abs(th.theoryQty - 61.1111) < 0.01, '=' + th.theoryQty.toFixed(4));

  // 反恒真：不除出成率会得 55 斤（偏小 10%）—— 那会让老板以为买多了
  const noYield = 27500 / 1 / 500;
  check('反恒真：漏除出成率会得 55 斤（比正确值小 10%）⇒ 显示"买多了"，故必须除',
    Math.abs(noYield - 55) < 0.001 && th.theoryQty > noYield,
    '错误值 55 / 正确值 ' + th.theoryQty.toFixed(2));
}

// ===== 2) 出成率缺失/非法 ⇒ 按 100%（与 calcBom/netUnitCostWan 同源）=====
{
  const m = { material_id: 'mat_beef', convert_factor: 500, yield_rate: 0 };
  const th = theoryQtyOf(CARDS, { C001: 100 }, m);
  check('出成率填 0 ⇒ 按 100% 计（口径与 calcBom 一致，不产生 Infinity）',
    th.yieldRate === 100 && Number.isFinite(th.theoryQty), 'yr=' + th.yieldRate);
  const m2 = { material_id: 'mat_beef', convert_factor: 0, yield_rate: 90 };
  const th2 = theoryQtyOf(CARDS, { C001: 100 }, m2);
  check('换算系数填 0 ⇒ 按 1 计（不除零）', th2.convertFactor === 1 && Number.isFinite(th2.theoryQty));
}

// ===== 3) materialUsage 全链路 =====
{
  const inv = [
    // 牛肉：期初 10 + 采购 70 − 期末 15 = 65 斤；理论 61.11 斤 ⇒ 多 3.89 斤（+6.36%）
    { material_id: 'mat_beef', opening_qty: 10, purchase_qty: 70, closing_qty: 15 },
    // 食用油：理论 = 100×30/1/500 = 6 斤；实际 5+8−2=11 斤 ⇒ 多 5 斤（+83.3%）
    { material_id: 'mat_oil', opening_qty: 5, purchase_qty: 8, closing_qty: 2 },
    // 大米：不在任何成本卡里 ⇒ 无理论值，只显示实际
    { material_id: 'mat_rice', opening_qty: 100, purchase_qty: 200, closing_qty: 120 },
    // 全空行 ⇒ 应被跳过，不产生一行 0
    { material_id: 'mat_noodle', opening_qty: 0, purchase_qty: 0, closing_qty: 0 },
  ];
  const r = materialUsage({ cards: CARDS, dineIn: DINE_IN, materials: MATERIALS, inventoryItems: inv });
  check('全链路：ok=true', r.ok === true, r.reason || 'ok');
  check('全链路：出 3 行（全空的 noddle 被跳过）', r.items.length === 3, '=' + r.items.length);
  check('全链路：可比 2 个（大米没理论值）', r.comparableCount === 2, '=' + r.comparableCount);

  const beef = r.items.find((x) => x.material_id === 'mat_beef');
  check('牛肉：理论 61.11 斤', beef && Math.abs(beef.theoryQty - 61.11) < 0.02, beef && '=' + beef.theoryQty);
  check('牛肉：实际 65 斤', beef && beef.actualQty === 65, beef && '=' + beef.actualQty);
  check('牛肉：差 +3.89 斤', beef && Math.abs(beef.diffQty - 3.89) < 0.02, beef && '=' + beef.diffQty);
  check('牛肉：差率 +6.36%', beef && Math.abs(beef.diffPct - 6.36) < 0.05, beef && '=' + beef.diffPct);

  const oil = r.items.find((x) => x.material_id === 'mat_oil');
  check('食用油：差率 +83.33%（理论 6 斤 / 实际 11 斤）',
    oil && Math.abs(oil.diffPct - 83.33) < 0.05, oil && '=' + oil.diffPct);

  const rice = r.items.find((x) => x.material_id === 'mat_rice');
  check('大米：无理论值 ⇒ hasTheory=false 且 theoryQty=null（不给编的数）',
    rice && rice.hasTheory === false && rice.theoryQty === null);
  check('大米：仍显示实际用量 180 斤（老板填的不能丢）', rice && rice.actualQty === 180, rice && '=' + rice.actualQty);
  check('大米：差量与差率均为 null（无分母不硬凑）', rice && rice.diffQty === null && rice.diffPct === null);
}

// ===== 4) 少用（负差）也能算 =====
{
  const inv = [{ material_id: 'mat_beef', opening_qty: 0, purchase_qty: 40, closing_qty: 0 }]; // 实际 40 < 理论 61.11
  const r = materialUsage({ cards: CARDS, dineIn: DINE_IN, materials: MATERIALS, inventoryItems: inv });
  const beef = r.items[0];
  check('少用时差量为负', r.ok === true && beef.diffQty < 0, '=' + beef.diffQty);
  check('少用时差率为负', beef.diffPct < 0, '=' + beef.diffPct);
}

// ===== 5) 三种「算不了」=====
{
  const empty = materialUsage({ cards: CARDS, dineIn: DINE_IN, materials: MATERIALS, inventoryItems: [] });
  check('没填任何原料 ⇒ reason=no_items', empty.ok === false && empty.reason === 'no_items', empty.reason);

  const onlyBlank = materialUsage({
    cards: CARDS, dineIn: DINE_IN, materials: MATERIALS,
    inventoryItems: [{ material_id: 'mat_oil', opening_qty: 0, purchase_qty: 0, closing_qty: 0 }],
  });
  check('只填了全空行 ⇒ 也判 no_items（不产出 0 值结论）',
    onlyBlank.ok === false && onlyBlank.reason === 'no_items', onlyBlank.reason);

  const noTheory = materialUsage({
    cards: CARDS, dineIn: DINE_IN, materials: MATERIALS,
    inventoryItems: [{ material_id: 'mat_rice', opening_qty: 10, purchase_qty: 20, closing_qty: 25 }],
  });
  check('原料都不在成本卡里 ⇒ reason=no_theory（但仍带回实际用量）',
    noTheory.ok === false && noTheory.reason === 'no_theory' && noTheory.items.length === 1, noTheory.reason);
}

// ===== 5b) 🔴 G3（2026-11-25 M3 变动面审计）：理论量极小时差率必须抑制 =====
//   实测过：理论 0.001 斤 / 实际 10 斤 ⇒ 差率 1000000%，页面上没法看。
//   处理原则：**差量照给**（10 − 0.001 这个事实有意义），**差率不给**（分母太小比率无意义）。
{
  const tiny = materialUsage({
    cards: [{ card_code: 'C', lines: [{ material_id: 'm', quantity: 0.5, line_type: 1 }] }],
    dineIn: [{ card_code: 'C', qty: 1 }],
    materials: [{ id: 'm', name: '微量料', purchase_unit: '斤', convert_factor: 1000, yield_rate: 50 }],
    inventoryItems: [{ material_id: 'm', opening_qty: 0, purchase_qty: 10, closing_qty: 0 }],
  });
  const it = tiny.items && tiny.items[0];
  check('G3 理论量 0.001 ⇒ pctSuppressed=true（不给差率）', !!it && it.pctSuppressed === true, it && String(it.theoryQty));
  check('G3 差率置 null（不是 0，也不是 1000000%）', !!it && it.diffPct === null, it && 'diffPct=' + it.diffPct);
  check('G3 差量照给（10 − 0.001 ≈ 10.00 这个事实有意义）', !!it && it.diffQty === 10, it && 'diffQty=' + it.diffQty);
  check('G3 理论量仍如实返回（不因抑制差率就抹掉理论值）', !!it && it.theoryQty === 0.001, it && String(it.theoryQty));

  // 边界：理论量**恰好** 0.01（= 5克 × 1份 ÷ 500换算 ÷ 100%出成率）⇒ 不该抑制（判据是 < 不是 <=）
  const edge = materialUsage({
    cards: [{ card_code: 'C', lines: [{ material_id: 'm', quantity: 5, line_type: 1 }] }],
    dineIn: [{ card_code: 'C', qty: 1 }],
    materials: [{ id: 'm', name: '边界料', purchase_unit: '斤', convert_factor: 500, yield_rate: 100 }],
    inventoryItems: [{ material_id: 'm', opening_qty: 0, purchase_qty: 1, closing_qty: 0 }],
  });
  const e = edge.items && edge.items[0];
  check('G3 边界：理论量恰好 0.01 ⇒ 不抑制（用 < 不用 <=）',
    !!e && e.pctSuppressed === false && e.diffPct != null, e && ('theory=' + e.theoryQty + ' diffPct=' + e.diffPct));

  // 反恒真：正常量级（牛肉 84.71 斤）绝不抑制
  const normal = materialUsage({
    cards: CARDS, dineIn: DINE_IN, materials: MATERIALS,
    inventoryItems: [{ material_id: 'mat_beef', opening_qty: 10, purchase_qty: 70, closing_qty: 15 }],
  });
  const beefN = normal.items && normal.items.find((x) => x.material_id === 'mat_beef');
  check('G3 反恒真：正常量级（84.71 斤）不抑制', !!beefN && beefN.pctSuppressed === false && beefN.diffPct != null);
}

// ===== 6) 没销量时理论量为 0 ⇒ 无理论值（不是"该用 0 斤"）=====
{
  const r = materialUsage({
    cards: CARDS, dineIn: [], materials: MATERIALS,
    inventoryItems: [{ material_id: 'mat_beef', opening_qty: 0, purchase_qty: 60, closing_qty: 0 }],
  });
  check('没销量 ⇒ hasTheory=false（不把"用 0 斤"当结论）',
    r.ok === false && r.reason === 'no_theory' && r.items[0].hasTheory === false, r.reason);
}

// ===== 7) 文案键必须真实存在于 TERMS（防静默空白）=====
{
  const { TERMS } = require('../miniprogram/i18n/terms.js');
  const keys = [missingKeyOf('no_items'), missingKeyOf('no_theory'), missingKeyOf('whatever')];
  const miss = keys.filter((k) => typeof TERMS.card[k] !== 'string' || !TERMS.card[k]);
  check('缺项文案键都在 TERMS.card 里真实存在', miss.length === 0, miss.join(',') || '全部命中');
  check('未知 reason 有兜底键', typeof missingKeyOf('whatever') === 'string');
}

// ===== 8) 🔴 页面接线断言（纯函数测不到的那类 bug，用源码级断言钉住）=====
{
  const fs = require('fs');
  const path = require('path');
  const reconJs = fs.readFileSync(path.join(__dirname, '..', 'subpkg/tools/recon/index.js'), 'utf8');
  const reconWxml = fs.readFileSync(path.join(__dirname, '..', 'subpkg/tools/recon/index.wxml'), 'utf8');

  check('接线：calc 里调用 buildMaterialView 并传入 matRes',
    /buildMaterialView\(month,\s*cardsRes,\s*reviewRes,\s*matRes\)/.test(reconJs));

  check('接线：并发多取了 getMaterial（否则拿不到出成率/换算系数，理论量算不出来）',
    /api\.call\('getMaterial'/.test(reconJs));

  // 🔴 2026-11-24 第三期：输入框从 3 个（期初/采购/期末）增到 4 个（+采购金额）。
  //   断言跟着改，但**必须是 4 而不是 ≥3** —— 少一个就说明有人删了某个维度（比如砍掉金额），
  //   那样量价拆分就静默失效了（页面还在、数永远是空）。
  check('接线：四个输入框都绑 onMatQty 并带 data-k（o/p/c/a —— a 是采购金额，第三期）',
    (reconWxml.match(/bindinput="onMatQty"/g) || []).length === 4
    && /data-k="o"/.test(reconWxml) && /data-k="p"/.test(reconWxml)
    && /data-k="c"/.test(reconWxml) && /data-k="a"/.test(reconWxml));

  check('接线：onMatQty 接受 a 键（采购金额），否则金额填了也不落库',
    /\['o',\s*'p',\s*'c',\s*'a'\]\.indexOf\(k\)/.test(reconJs));

  check('接线：buildMaterialView 里调 priceVariance 且读了上月盘点（否则没有比价基准）',
    /priceVariance\(\{[\s\S]{0,200}prevMonth/.test(reconJs) || /savedPrev\[mid\][\s\S]{0,200}priceVariance/.test(reconJs));

  check('接线：onMatQty 用缓存的原始返回局部重算（不得每次重跑 4 个云函数）',
    /onMatQty\(e\)\s*\{[\s\S]{0,900}this\._matRaw/.test(reconJs)
    && !/onMatQty\(e\)\s*\{[\s\S]{0,900}api\.call\(/.test(reconJs));

  check('接线：原料盘点按店按月隔离（走 ss.shopKey，不是裸 key）',
    /loadMatInv\(month\)[\s\S]{0,300}ss\.shopKey\('matinv_'/.test(reconJs));

  // 反恒真：若把出成率除法删掉，理论量必须变化（证明这条逻辑不是空转）
  {
    const cards = [{ card_code: 'C1', lines: [{ material_id: 'm1', quantity: 200, line_type: 1 }] }];
    const mat = { material_id: 'm1', convert_factor: 500, yield_rate: 90 };
    const withYield = theoryQtyOf(cards, { C1: 100 }, mat).theoryQty;
    const noYield = theoryQtyOf(cards, { C1: 100 }, { material_id: 'm1', convert_factor: 500, yield_rate: 100 }).theoryQty;
    check('反恒真：出成率 90% 与 100% 必须算出不同理论量（证明除法真生效）',
      Math.abs(withYield - noYield) > 0.01, withYield.toFixed(2) + ' vs ' + noYield.toFixed(2));
  }
}

console.log('\n==== 原料用量核对自测：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
