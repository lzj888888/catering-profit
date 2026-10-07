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
 * @param {{normalizeDishName:Function, toMonth:Function}} deps 单源注入
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
  const agg = new Map();
  for (const s of (sales || [])) {
    const k = (s.dish_key == null ? '' : String(s.dish_key)).trim();
    if (!k) continue;                                    // 空 dish_key 跳过（不计入、不报错）
    const a = agg.get(k) || { qty: 0, amountFen: 0 };
    a.qty += (Number(s.qty) || 0);
    a.amountFen += (Number(s.amount) || 0);
    agg.set(k, a);
  }

  // ===== 4. 匹配 + 计算（未匹配单列，不归零）=====
  const ranked = [];
  const unmatched = [];
  for (const [dishKey, a] of agg) {
    const cardCode = nameToCode.get(normalizeDishName(dishKey)) || '';
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
 * 把全量销量行**在 service 层**分流（可复算；不在 index 做业务判断）。
 * @param {Array<{platform:string}>} sales
 * @returns {{dineIn:Array, takeaway:Array}} dineIn = platform==='pos'；takeaway = 其余非空平台
 */
function splitSales(sales) {
  const dineIn = [];
  const takeaway = [];
  for (const s of (sales || [])) {
    const p = (s.platform == null ? '' : String(s.platform)).trim();
    if (p === 'pos') dineIn.push(s);
    else if (p) takeaway.push(s);
  }
  return { dineIn, takeaway };
}

module.exports = { buildDishReview, buildTakeawayReview, rankReview, splitSales };
