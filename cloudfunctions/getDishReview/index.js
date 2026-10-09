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

// 🔴 R232 C-9：名称归一**必须**走单源 common/dishKey.js::normalizeDishName。
//   此处原有一份内联 normName()（注释只写「与 service.js 同口径」，但**环上零守卫**）：
//   任一侧将来改规则 ⇒ 两侧分叉 ⇒ **全菜匹配不上** ⇒ 用户看到「所有菜都没成本」且**无报错**（失效静默）。
const { normalizeDishName } = common.dishKey;

// 🔴 R232 C-10：月份格式化**必须**走单源 common/utilTime.js::toMonth（UTC 口径）。
//   此处原有一份 monthOf() 用本地时区 getFullYear()/getMonth()，违反 utilTime 文件头明文的
//   「铁律：时间统一 UTC」⇒ 每月 1 日 00:00~08:00（UTC+8）创建的成本卡会算出**上一个**月。
//   用法与 adminExport / adminInit 等既有函数完全一致（const { ... } = common.utilTime）。
const { toMonth } = common.utilTime;

// 🔴 R232f：算法层已外提到 service.js（纯函数 · 零 db）⇒ 6 处口径首次可被独立复算。
//   本文件只负责：鉴权 → 付费墙 → 取数 → 调 service → 返回。
const { buildDishReview, buildTakeawayReview, splitSales, mergeTotals } = require('./service');

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

  // ===== 3. 读全部销量行（去掉 platform 过滤；listAll 分页取全，突破单页 1000）=====
  const salesRes = await da.listAll('external_sales_daily', { shop_id: shopId });
  const allSales = (salesRes && salesRes.data) || [];

  // ===== 4. 读成本卡（listAll，取各 card_code 最新版本；软删自动过滤）=====
  const cardsRes = await da.listAll('shop_cost_card', { shop_id: shopId });
  const cards = (cardsRes && cardsRes.data) || [];

  // ===== 4b. 读菜名映射表（R253 决策 2；表为空 ⇒ 行为与接线前逐行等价）=====
  //   🔴 `shop_dish_mapping` 唯一键 = (shop_id, platform, external_ref_id)（R239 已建索引）。
  //   此处 `external_ref_id` 存**平台侧菜品 ID / dish_key**（规范 §6.2，稳定）；
  //   与销量行的 `external_ref_id`（'DISH:<platform>:<biz_date>:<dish_key>'）**语义不同**，
  //   故查找键取 `dish_key`，不取销量行的 external_ref_id（含日期会天天失配）。
  //   ⚠️ 读失败不阻断主流程：映射表是**增强**，缺失时应回落名称匹配而非整页报错。
  let mapping = [];
  try {
    const mapRes = await da.listAll('shop_dish_mapping', { shop_id: shopId });
    mapping = (mapRes && mapRes.data) || [];
  } catch (e) { mapping = []; }
  // (platform + '|' + dish_key) → card_code；同键后者覆盖（同一挂钩重复登记取最新）
  const mapIndex = new Map();
  for (const m of mapping) {
    const p = (m.platform == null ? '' : String(m.platform)).trim();
    const ref = (m.external_ref_id == null ? '' : String(m.external_ref_id)).trim();
    const cc = (m.card_code == null ? '' : String(m.card_code)).trim();
    if (!ref || !cc) continue;
    mapIndex.set(p + '|' + ref, cc);
  }
  const lookupCardCode = (dishKey, platform) => {
    const k = (dishKey == null ? '' : String(dishKey)).trim();
    if (!k) return '';
    const p = (platform == null ? '' : String(platform)).trim();
    return mapIndex.get(p + '|' + k) || mapIndex.get('|' + k) || '';
  };

  // ===== 5~6. 分流 + 聚合 + 匹配 + 毛利计算 + 排名 + 合计（纯函数 · 见 service.js）=====
  //   🔴 分流在 service 层做（splitSales 可复算），不在 index 做业务判断。
  const { dineIn, takeaway: takeawaySales } = splitSales(allSales);
  const deps = { normalizeDishName, toMonth, lookupCardCode };
  const { dine_in: ranked, unmatched, totals: dineTotals } = buildDishReview(dineIn, cards, deps);
  const takeawayResult = buildTakeawayReview(takeawaySales, cards, deps);

  // 🔴🔴 R254：顶层 totals 必须是【堂食 + 外卖】的全渠道合计 —— 原只取堂食一份，
  //    纯外卖店铺（堂食 0 行）主结论卡恒显示「0 / ¥0.00」（真云实证：taobao 51 道菜、
  //    by_platform.taobao.totals.amountFen 非 0，而顶层 totals 全 0）。合并走 service 纯函数
  //    （可复算，不在这里写业务判断）。
  const totals = mergeTotals(dineTotals, takeawayResult.totals);

  return ok({
    shop_id: shopId,
    dine_in: ranked,        // 堂食排行
    // 无外卖数据 ⇒ null（空态，不默认 0，红线 18）；有数据 ⇒ { by_platform, totals }
    takeaway: Object.keys(takeawayResult.by_platform).length ? takeawayResult : null,
    unmatched,
    totals,                 // 🔴 R254：全渠道合计（堂食 + 各外卖平台），不再是「仅堂食」
    truncated: !!(salesRes.truncated || cardsRes.truncated),
    client_request_id: (event && event.client_request_id) || '',
  });
};
