// cloudfunctions/getDishReview/index.js —— M3.33 单品毛利复盘（读销量 + 成本卡 → 排名）
//
// 口径（§2.4 写死）：
//   单品总物料成本 = 销售份数(qty 整数) × 该卡 total_cost（卡内锁定标准成本，整数分）
//   单品毛利       = 单品营收(amount 整数分) − 单品总物料成本
//   单品毛利率     = 毛利 ÷ 营收
// 约束：两个来源分开呈现（堂食/外卖，本批外卖缺失 ⇒ 空态，红线 18 不默认 0）；
//       不回写成本卡 / M1；毛利率阈值用户自定义（前端标注，非警戒线）；
//       成本用卡内锁定值（旧卡 ⇒ 带 snapshot_month 由前端提示「该卡成本为 X 月快照」）。
// 🔴 付费墙：m3_dishreview（导入可免费保存、看复盘才拦 —— 见 terms.paywall.dishreview）。
//    未匹配 = 无同名成本卡的 dish_key ⇒ 单列返回，绝不静默归零（红线 17）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { hasFeature } = common;
const { makeAdapter } = common.dataAdapter;

// 名称归一（与 cloudfunctions/importSalesBill/service.js::normalizeDishName 同口径）
function normName(name) {
  if (name == null) return '';
  let s = String(name).trim();
  try { s = s.normalize('NFKC'); } catch (e) { /* 老运行时无 normalize 则原样 */ }
  return s;
}

function monthOf(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权 =====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 付费墙（铁律：付费墙必须先于付费功能落地）=====
  const unlocked = await hasFeature(db, userId, 'm3_dishreview');
  if (!unlocked) return fail(ERROR_CODES.FEATURE_LOCKED);

  const da = makeAdapter(db);

  // ===== 3. 读堂食销量（platform='pos'；listAll 分页取全，突破单页 1000）=====
  const salesRes = await da.listAll('external_sales_daily', { shop_id: shopId, platform: 'pos' });
  const sales = (salesRes && salesRes.data) || [];

  // ===== 4. 读成本卡（listAll，取各 card_code 最新版本；软删自动过滤）=====
  const cardsRes = await da.listAll('shop_cost_card', { shop_id: shopId });
  const latestByCode = new Map();
  const nameToCode = new Map();   // 归一名称 → card_code（最新版本）
  for (const c of ((cardsRes && cardsRes.data) || [])) {
    const cc = c.card_code;
    if (!cc) continue;
    const cur = latestByCode.get(cc);
    if (!cur || (c.version || 0) > (cur.version || 0)) latestByCode.set(cc, c);
  }
  for (const [cc, c] of latestByCode) {
    const nm = normName(c.name);
    if (nm) nameToCode.set(nm, cc);
  }

  // ===== 5. 按 dish_key 聚合销量 =====
  const agg = new Map();
  for (const s of sales) {
    const k = (s.dish_key == null ? '' : String(s.dish_key)).trim();
    if (!k) continue;
    const a = agg.get(k) || { qty: 0, amountFen: 0 };
    a.qty += (Number(s.qty) || 0);
    a.amountFen += (Number(s.amount) || 0);
    agg.set(k, a);
  }

  // ===== 6. 计算排名（全量明细，不截断）=====
  const ranked = [];
  const unmatched = [];
  for (const [dishKey, a] of agg) {
    const cardCode = nameToCode.get(normName(dishKey)) || '';
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
      snapshot_month: monthOf(card.created_at),
    });
  }
  ranked.sort((x, y) => y.grossFen - x.grossFen);   // 毛利降序

  const totals = {
    qty: ranked.reduce((s, x) => s + x.qty, 0) + unmatched.reduce((s, x) => s + x.qty, 0),
    amountFen: ranked.reduce((s, x) => s + x.amountFen, 0) + unmatched.reduce((s, x) => s + x.amountFen, 0),
    costFen: ranked.reduce((s, x) => s + x.totalCostFen, 0),
    grossFen: ranked.reduce((s, x) => s + x.grossFen, 0),
    dishCount: ranked.length,
    unmatchedCount: unmatched.length,
  };

  return ok({
    shop_id: shopId,
    dine_in: ranked,        // 堂食排行
    takeaway: null,         // 形态 C（外卖商品销量）本批不做 ⇒ 空态，不默认 0（红线 18）
    unmatched,
    totals,
    truncated: !!(salesRes.truncated || cardsRes.truncated),
    client_request_id: (event && event.client_request_id) || '',
  });
};
