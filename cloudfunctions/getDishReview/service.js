// cloudfunctions/getDishReview/service.js —— M3.33 单品毛利复盘 · **纯计算层**（零 db / 零云依赖）
//
// 为什么拆出来（R232f）：本函数原先把「聚合 + 匹配 + 毛利计算 + 排名 + totals」全部内联在
//   `exports.main` 里 ⇒ 算法**无法被独立 require**，因而**环上零判据**。
//   姊妹函数 `importSalesBill` 是本仓的标准形态（index 鉴权 + service 纯算法 + validate），
//   本文件把 getDishReview 对齐到同一形态，让 6 处口径第一次可被机器复算。
//
// 🔴 口径（§2.4 写死，一字不改 —— 与拆分前逐行等价）：
//   单品总物料成本 = 销售份数(qty 整数) × 该卡 total_cost（卡内锁定标准成本，整数分）
//   单品毛利       = 单品营收(amount 整数分) − 单品总物料成本
//   单品毛利率     = 毛利 ÷ 营收（营收为 0 ⇒ 记 0，不产生 NaN/Infinity）
//   排名           = 毛利降序
//   未匹配         = 无同名成本卡的 dish_key ⇒ **单列返回，绝不静默归零**（红线 17）
//   最新版本       = 同 card_code 取 version 最大者（软删由适配层过滤，本层不见软删行）
//
// 🔴 本层**必须**零外部依赖（不 require wx-server-sdk / 不碰 db），否则又变成不可测。
//   名称归一 / 月份格式化由调用方注入（index.js 从 common 单源取），保证单源不扩散。
'use strict';

/**
 * 核心：把一组销量行聚合 → 匹配成本卡 → 算毛利 → 排名 → 合计（两条路共用，不复制）。
 * @param {Array<{dish_key:string, qty:*, amount:*}>} sales 一组销量行
 * @param {Array<{card_code:string, version:number, name:string, total_cost:*, created_at:*}>} cards 成本卡（全版本）
 * @param {{normalizeDishName:Function, toMonth:Function, lookupCardCode?:Function}} deps 单源注入
 *   `lookupCardCode(dishKey, platform) => card_code|''`（可空）：菜名映射表查询（R253 决策 2）。
 * @returns {{ranked:Array, unmatched:Array, totals:Object}}
 */
function rankReview(sales, cards, deps) {
  const normalizeDishName = deps.normalizeDishName;
  const toMonth = deps.toMonth;

  // ===== 1. 取各 card_code 最新版本 =====
  const latestByCode = new Map();
  for (const c of (cards || [])) {
    const cc = c.card_code;
    if (!cc) continue;
    const cur = latestByCode.get(cc);
    if (!cur || (c.version || 0) > (cur.version || 0)) latestByCode.set(cc, c);
  }

  // ===== 2. 归一名称 → card_code（最新版本）=====
  const nameToCode = new Map();
  for (const [cc, c] of latestByCode) {
    const nm = normalizeDishName(c.name);
    if (nm) nameToCode.set(nm, cc);
  }

  // ===== 3. 按 dish_key 聚合销量 =====
  // 🔴 R253：聚合桶带上 `platform` —— 映射表唯一键是 (shop_id, platform, external_ref_id)
  //   ⇒ 同一 dish_key 在不同平台可挂不同卡，查表必须带平台，否则跨平台串卡。
  const agg = new Map();
  for (const s of (sales || [])) {
    const k = (s.dish_key == null ? '' : String(s.dish_key)).trim();
    if (!k) continue;                                    // 空 dish_key 跳过（不计入、不报错）
    const a = agg.get(k) || { qty: 0, amountFen: 0, platform: '' };
    a.qty += (Number(s.qty) || 0);
    a.amountFen += (Number(s.amount) || 0);
    // 同 dish_key 跨平台混入时以首个非空平台为准（rankReview 的调用方已按平台分组，正常不会混）
    if (!a.platform) a.platform = (s.platform == null ? '' : String(s.platform)).trim();
    agg.set(k, a);
  }

  // ===== 4. 匹配 + 计算（未匹配单列，不归零）=====
  // 🔴 R253（决策 2）：匹配**先查菜名映射表**，查不到再回落同名归一匹配。
  //   为什么需要映射表：菜名匹配走 `normalizeDishName`（trim + NFKC），**保留规格后缀与括号** ⇒
  //   平台侧写「耙牛肉(小份)」而成本卡叫「耙牛肉」时，两边归一后依然不等 ⇒ 静默落 unmatched。
  //   映射表（shop_dish_mapping）是人工一次性挂钩（平台菜品 → 本地卡），比字符串猜名可靠。
  //   🔴 回落是**必须**的：映射表为空（新店／尚未挂钩）时行为须与改动前**逐行等价**，
  //      否则本次改动会让所有存量用户"忽然全菜不匹配"。
  //   🔴 键用 `dishKey` 而**不是**销量行的 external_ref_id：两者语义不同 ——
  //      销量行 = 'DISH:<platform>:<biz_date>:<dish_key>'（**含日期**，逐日变），
  //      映射表 = 平台侧菜品 ID / dish_key（**稳定**）。用 external_ref_id 作键会天天匹配不上。
  const lookupCardCode = deps.lookupCardCode;            // 可空 ⇒ 无映射表时退化为纯名称匹配
  const ranked = [];
  const unmatched = [];
  for (const [dishKey, a] of agg) {
    let cardCode = '';
    if (typeof lookupCardCode === 'function') {
      cardCode = lookupCardCode(dishKey, a.platform) || '';
    }
    if (!cardCode || !latestByCode.has(cardCode)) {
      cardCode = nameToCode.get(normalizeDishName(dishKey)) || '';   // 回落：同名归一（原口径）
    }
    const card = cardCode ? latestByCode.get(cardCode) : null;
    if (!card) {
      unmatched.push({ dish_key: dishKey, name: dishKey, qty: a.qty, amountFen: a.amountFen });
      continue;
    }
    const unitCostFen = Number(card.total_cost) || 0;
    const totalCostFen = Math.round(a.qty * unitCostFen);
    const grossFen = a.amountFen - totalCostFen;
    const marginPct = a.amountFen > 0 ? Math.round((grossFen / a.amountFen) * 10000) / 100 : 0;
    ranked.push({
      dish_key: dishKey,
      name: card.name || dishKey,
      card_code: cardCode,
      qty: a.qty,
      amountFen: a.amountFen,
      totalCostFen,
      grossFen,
      marginPct,
      snapshot_month: toMonth(card.created_at),
    });
  }
  ranked.sort((x, y) => y.grossFen - x.grossFen);         // 毛利降序

  // ===== 5. 合计（qty/amount 含未匹配；cost/gross 只算已匹配 —— 未匹配无成本可算）=====
  const totals = {
    qty: ranked.reduce((s, x) => s + x.qty, 0) + unmatched.reduce((s, x) => s + x.qty, 0),
    amountFen: ranked.reduce((s, x) => s + x.amountFen, 0) + unmatched.reduce((s, x) => s + x.amountFen, 0),
    costFen: ranked.reduce((s, x) => s + x.totalCostFen, 0),
    grossFen: ranked.reduce((s, x) => s + x.grossFen, 0),
    dishCount: ranked.length,
    unmatchedCount: unmatched.length,
  };

  return { ranked, unmatched, totals };
}

/**
 * 构建堂食单品毛利复盘（platform='pos'）。
 * @param {Array} sales 堂食销量行
 * @param {Array} cards 成本卡（全版本）
 * @param {{normalizeDishName:Function, toMonth:Function}} deps
 * @returns {{dine_in:Array, unmatched:Array, totals:Object}}
 */
function buildDishReview(sales, cards, deps) {
  const { ranked, unmatched, totals } = rankReview(sales, cards, deps);
  return { dine_in: ranked, unmatched, totals };
}

/**
 * 构建外卖单品毛利复盘（platform !== 'pos'，多平台混合）。
 * 🔴 与堂食**同构**：复用 rankReview，按平台分组各跑一遍，不复制算法。
 * 🔴 zeroAmount 标记：amountFen=0 且 qty>0 的行照常计入排名（确实卖了），但加 `zeroAmount:true`
 *    供前端加「口味询问类 SKU，不计营收」标注（v1.7 C-5）；不剔除、不归 unmatched。
 * @param {Array<{dish_key:string, qty:*, amount:*, platform:string}>} sales 非 pos 销量行
 * @param {Array} cards 成本卡（全版本）
 * @param {{normalizeDishName:Function, toMonth:Function}} deps
 * @returns {{by_platform:Object<string,{ranked,unmatched,totals}>, totals:Object}}
 */
function buildTakeawayReview(sales, cards, deps) {
  // 按 platform 分组（外卖可能同时有美团/饿了么/淘宝闪购）
  const byPlatform = new Map();
  for (const s of (sales || [])) {
    const p = (s.platform == null ? '' : String(s.platform)).trim();
    if (!p || p === 'pos') continue;
    const list = byPlatform.get(p) || [];
    list.push(s);
    byPlatform.set(p, list);
  }

  const by_platform = {};
  const totals = { qty: 0, amountFen: 0, costFen: 0, grossFen: 0, dishCount: 0, unmatchedCount: 0 };
  for (const [p, list] of byPlatform) {
    const { ranked, unmatched, totals: t } = rankReview(list, cards, deps);
    // v1.7 C-5：零价高销量行照常入榜，仅加标记
    for (const r of ranked) r.zeroAmount = (r.amountFen === 0 && r.qty > 0);
    by_platform[p] = { ranked, unmatched, totals: t };
    totals.qty += t.qty;
    totals.amountFen += t.amountFen;
    totals.costFen += t.costFen;
    totals.grossFen += t.grossFen;
    totals.dishCount += t.dishCount;
    totals.unmatchedCount += t.unmatchedCount;
  }
  return { by_platform, totals };
}

/**
 * 合并两份 totals（堂食 + 外卖）为「全渠道合计」（纯函数 · 零 db · 可复算）。
 *
 * 🔴 R254 真云缺陷：顶层 totals 原本**只取堂食那一份**
 *    （index.js 原写法 `const {...totals} = buildDishReview(...)`，外卖的 `takeawayResult.totals` 被丢弃），
 *    而前端主结论卡渲染的正是这个顶层 totals（pages/m3/dishreview/index.wxml `{{totals.qty}}` 等）
 *    ⇒ 纯外卖店铺（堂食 0 行，本仓真云现状）主结论卡恒显示
 *      「份数 0 / 营收 ¥0.00 / 成本 ¥0.00 / 毛利 ¥0.00」，
 *      而同一屏的平台块里却明明白白列着 51 道菜、¥1823 的销量
 *      ⇒ 用户视角 =「导进来了但合计是 0」—— 比空态更误导（空态至少不会让人以为算错了）。
 *
 * 🔴 口径（与 rankReview 的 totals 同源，逐字段相加，**不取平均、不去重**）：
 *    qty / amountFen 含未匹配（卖了就算营收）；costFen / grossFen 只算已匹配（未匹配无成本可算）；
 *    dishCount = 已匹配菜品数；unmatchedCount = 未匹配菜品数。
 *
 * @param {Object} a 堂食 totals（缺省视为全 0）
 * @param {Object} b 外卖 totals（缺省视为全 0）
 * @returns {{qty:number, amountFen:number, costFen:number, grossFen:number, dishCount:number, unmatchedCount:number}}
 */
const TOTALS_FIELDS = ['qty', 'amountFen', 'costFen', 'grossFen', 'dishCount', 'unmatchedCount'];

function mergeTotals(a, b) {
  const out = {};
  for (const f of TOTALS_FIELDS) {
    const x = (a && typeof a[f] === 'number' && isFinite(a[f])) ? a[f] : 0;
    const y = (b && typeof b[f] === 'number' && isFinite(b[f])) ? b[f] : 0;
    out[f] = x + y;
  }
  return out;
}

/**
 * 把全量销量行**在 service 层**分流（可复算；不在 index 做业务判断）。
 * @param {Array<{platform:string}>} sales
 * @returns {{dineIn:Array, takeaway:Array}} dineIn = platform==='pos'；takeaway = 其余非空平台
 */
function splitSales(sales) {
  const dineIn = [];
  const takeaway = [];
  for (const s of (sales || [])) {
    const p = (s.platform == null ? '' : String(s.platform)).trim();
    const category = classifyDishKey(s.dish_key);
    const tagged = Object.assign({}, s, { category });
    if (p === 'pos') dineIn.push(tagged);
    else if (p) takeaway.push(tagged);
  }
  return { dineIn, takeaway };
}

// ===== R272：销售行分类（制作类 / 零售转售 / 自助餐）=====
// 为什么需要：覆盖率 C 档的分母要剔除零售、自助计入分子；自助餐另走「人均食材成本」口径。
// 🔴 关键字匹配（可调）：快餐/自助/随便吃=自助；烟/酒/饮料/槟榔等=零售转售；其余=制作类。
//   用户 2026-10-10 确认：快餐=一份钱随便吃，不建单品成本卡，改人均食材成本口径。
//   🔴 缺省全归「made」：无关键字命中的行保持原口径，C 档退化为 A 档（零破坏，对其余店无影响）。
const CATEGORY_KEYWORDS = {
  buffet: ['快餐', '自助', '随便吃', '小火锅'],
  retail: ['烟', '酒', '饮料', '槟榔', '啤酒', '可乐', '雪碧', '奶茶', '矿泉水'],
};
function classifyDishKey(name) {
  const n = (name == null ? '' : String(name)).trim();
  if (!n) return 'made';
  for (const kw of CATEGORY_KEYWORDS.buffet) if (n.indexOf(kw) >= 0) return 'buffet';
  for (const kw of CATEGORY_KEYWORDS.retail) if (n.indexOf(kw) >= 0) return 'retail';
  return 'made';
}

/**
 * 计算覆盖率 A 档 / C 档 + 自助餐聚合（纯函数 · 零 db · 可复算）。
 * @param {Array} allSales 已打 category 标签的全部销量行（splitSales 产物合并）
 * @param {Set<string>} matchedKeys 已匹配到成本卡的 dish_key 集合
 * @param {number|null} buffetFoodCostTotalFen 本月自助餐线食材消耗总额（分），来自店铺设置；null=未填
 * @returns {{coverageA:Object, coverageC:Object, buffet:Object}}
 */
function computeCoverage(allSales, matchedKeys, buffetFoodCostTotalFen) {
  let madeRevenue = 0, madeMatchedRevenue = 0;
  let buffetRevenue = 0, buffetMeals = 0;
  let retailRevenue = 0;
  let totalRevenue = 0, matchedRevenue = 0;
  const mk = matchedKeys || new Set();
  for (const s of (allSales || [])) {
    const key = (s.dish_key == null ? '' : String(s.dish_key)).trim();
    const cat = s.category || 'made';
    const amt = Number(s.amount) || 0;        // external_sales_daily.amount 为分
    const qty = Number(s.qty) || 0;
    totalRevenue += amt;
    if (mk.has(key)) matchedRevenue += amt;
    if (cat === 'made') {
      madeRevenue += amt;
      if (mk.has(key)) madeMatchedRevenue += amt;
    } else if (cat === 'buffet') {
      buffetRevenue += amt; buffetMeals += qty;
    } else if (cat === 'retail') {
      retailRevenue += amt;
    }
  }
  // A 档：分母=全部营收（含零售+自助），分子=已匹配营收
  const coverageA_pct = totalRevenue > 0 ? Math.round((matchedRevenue * 100) / totalRevenue) : 0;
  // C 档：分母=制作类+自助（剔除零售转售），分子=制作类已匹配+自助（自助按人均成本口径计入）
  const denomC = madeRevenue + buffetRevenue;
  const numC = madeMatchedRevenue + buffetRevenue;
  const coverageC_pct = denomC > 0 ? Math.round((numC * 100) / denomC) : 0;
  // 自助餐人均口径
  const perCapitaPriceFen = buffetMeals > 0 ? Math.round(buffetRevenue / buffetMeals) : 0;
  const perCapitaCostFen = (buffetFoodCostTotalFen && buffetFoodCostTotalFen > 0 && buffetMeals > 0)
    ? Math.round(buffetFoodCostTotalFen / buffetMeals) : null;
  const grossMarginPct = (perCapitaCostFen != null && perCapitaPriceFen > 0)
    ? Math.round(((perCapitaPriceFen - perCapitaCostFen) * 100) / perCapitaPriceFen) : null;
  // ===== R272b：行业基准人均食材成本（网上平均数据，供「数字是否合理」对照）=====
  // 来源（2024-2025 行业平均）：
  //   · 餐饮O2O 2025 暑期实测食材成本率 41%（较 2024 升 5pp）；美团/红餐《自助餐发展报告2024》：40%–60%；
  //   · 15 元低价自助 食材 5–7 元/人（成本率 35%–45%）；60 元自助 18–24 元/人（~30%–40%）；
  //   · 美式自助 Food cost 30%–45% of revenue。综合取中位数 ~40%、合理区间 30%–55%。
  // 🔴 用户原话（2026-10-11）：每个店客人不同——重体力劳动者吃得多、蓝领吃得少；鲜肉与冻肉价差 ~2 倍。
  //   ⇒ 做成【低/中/高】三档带：低=冻品/蓝领为主、高=鲜肉/重体力为主，正对应用户的门店差异。
  const BENCH = { low: 0.30, mid: 0.40, high: 0.50 };
  const benchCostLowFen = perCapitaPriceFen ? Math.round(perCapitaPriceFen * BENCH.low) : 0;
  const benchCostMidFen = perCapitaPriceFen ? Math.round(perCapitaPriceFen * BENCH.mid) : 0;
  const benchCostHighFen = perCapitaPriceFen ? Math.round(perCapitaPriceFen * BENCH.high) : 0;
  // 用户实际成本率（仅在已填月消耗时判）
  let actualRatePct = null, actualFlag = '';
  if (perCapitaCostFen != null && perCapitaPriceFen > 0) {
    actualRatePct = Math.round((perCapitaCostFen * 100) / perCapitaPriceFen);
    if (actualRatePct > 55) actualFlag = '偏高';        // 食材成本吃紧，注意控损/调价
    else if (actualRatePct < 25) actualFlag = '偏低';    // 冻品为主或数据待核
    else actualFlag = '合理';
  }
  return {
    coverageA: { pct: coverageA_pct },
    coverageC: {
      pct: coverageC_pct,
      madeRevenueFen: madeRevenue,
      buffetRevenueFen: buffetRevenue,
      retailRevenueFen: retailRevenue,
      matchedMadeRevenueFen: madeMatchedRevenue,
    },
    buffet: {
      revenueFen: buffetRevenue,
      meals: buffetMeals,
      perCapitaPriceFen,
      perCapitaCostFen,
      grossMarginPct,
      hasCostInput: !!(buffetFoodCostTotalFen && buffetFoodCostTotalFen > 0),
      // R272b：行业基准带（低/中/高），供对照「你的实际是否合合理」
      benchmark: {
        rateLowPct: Math.round(BENCH.low * 100),
        rateMidPct: Math.round(BENCH.mid * 100),
        rateHighPct: Math.round(BENCH.high * 100),
        costLowFen: benchCostLowFen,
        costMidFen: benchCostMidFen,
        costHighFen: benchCostHighFen,
        actualRatePct,
        actualFlag,            // '' | '合理' | '偏高' | '偏低'
      },
    },
  };
}

module.exports = { buildDishReview, buildTakeawayReview, rankReview, splitSales, mergeTotals, TOTALS_FIELDS, computeCoverage, classifyDishKey };
