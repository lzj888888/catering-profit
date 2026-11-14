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
const { buildDishReview, buildTakeawayReview, splitSales, mergeTotals, computeCoverage, filterByRange, coverageStats, calcWeightedMenuPct, buildFreeTop } = require('./service');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权 =====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 付费墙（A8：由「整页锁」改为「两层」）=====
  //  🔴 改前：`if (!unlocked) return fail(FEATURE_LOCKED)` —— 点开就整页弹窗，一个数都不给。
  //     而本页的前置成本是全站最高的：老板必须先 ①导入销量表 ②建成本卡 ③逐条做菜名映射，
  //     三件苦力做完、点开想看结果的那一刻被整页拦住 ⇒ 这不是转化，是赶人（规范 v1.1 §1 拆墙）。
  //  ⇒ 改为两层：
  //     · 免费档给他**自己的原始数据**：销量 Top10 + 覆盖率 + 未匹配清单（锁住这些只会招恨，
  //       而「你有 8 道菜没建卡」这句本身就是驱动他去建卡的动力）
  //     · 付费档给他**我们加工出的结论**：完整毛利排行 + 全渠道合计 + 导出
  //  ⚠️ 分层**必须在后端按权益判**，不接受前端传 tier —— 否则改个参数就白嫖，付费墙形同虚设。
  const unlocked = await hasFeature(db, userId, 'm3_dishreview');
  const tier = unlocked ? 'full' : 'free';

  const da = makeAdapter(db);

  // ===== 3. 读全部销量行（去掉 platform 过滤；listAll 分页取全，突破单页 1000）=====
  // 🔴 R301：**契约入参 `biz_date_from` / `biz_date_to` 的补实现**。
  //   契约（`specs/dev-specs/core/10_云函数清单与接口契约.md`）**一直**声明这两个入参，
  //   而实现从未读取 ⇒ 复盘榜把历次导入的**多个月份全部累加**、页面却按"当前月"呈现
  //   ⇒ 「这道菜这个月卖过」是错的（**静默错数**；真样本就是 7 天表，"一段"冒充"整月"）。
  //   为什么在 **service 纯函数层**过滤而不在 `where` 里加范围条件：
  //     `common/dataAdapter.js` 的 `where` 只支持**等值**，加范围支持要动全仓 **51 份**
  //     `cx_dataAdapter.js` 派生副本（要跑 sync_common）⇒ 改动面与风险不成比例；
  //     而**在内存里过滤与在库里过滤结果逐行等价**（`listAll` 本来就读该店全量行，读的量不变）。
  const bizFrom = event && event.biz_date_from;
  const bizTo = event && event.biz_date_to;
  const salesRes = await da.listAll('external_sales_daily', { shop_id: shopId });
  const rawSales = (salesRes && salesRes.data) || [];
  const { rows: allSales, from: rangeFrom, to: rangeTo, days: rangeDays } = filterByRange(rawSales, bizFrom, bizTo);
  // 🔴 R574 / #110：`rangeDays` 只按 biz_date 去重 —— 堂食 7 天汇总表落库后 36 行同一个 biz_date
  //   ⇒ 它会报「1 天」，而实际覆盖 7 天。故另算一份**粒度感知**的覆盖天数，**不改 rangeDays 旧语义**
  //   （旧语义已被前端文案与套件锁定），只在出参里如实多给三项，由前端决定怎么说。
  const cov = coverageStats(allSales);

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

  // ===== R272：覆盖率 C 档口径 + 自助餐（快餐）人均食材成本 =====
  //   分母=制作类+自助（剔除零售转售），自助按人均食材成本计入分子；另聚合自助营收/份数。
  //   自助食材消耗总额来自店铺设置（switch_key='m3_buffet_food_cost_total'，值=分字符串），未填则 hasCostInput=false。
  const allTagged = dineIn.concat(takeawaySales);
  const matchedKeys = new Set();
  const collectKeys = (arr) => {
    for (const r of (arr || [])) if (r && r.dish_key) matchedKeys.add(String(r.dish_key).trim());
  };
  collectKeys(ranked);
  if (takeawayResult.by_platform) {
    for (const p of Object.keys(takeawayResult.by_platform)) collectKeys(takeawayResult.by_platform[p].ranked);
  }
  let buffetFoodCostTotalFen = null;
  try {
    const bsRes = await da.list('shop_switch', { shop_id: shopId, switch_key: 'm3_buffet_food_cost_total' });
    const bsRow = (bsRes && bsRes.data && bsRes.data[0]) || null;
    if (bsRow && bsRow.value != null && bsRow.value !== '') buffetFoodCostTotalFen = Number(bsRow.value) || null;
  } catch (e) { buffetFoodCostTotalFen = null; }
  const coverage = computeCoverage(allTagged, matchedKeys, buffetFoodCostTotalFen);

  // ===== 4c. R255：映射表**带出**（供前端展示「已关联 / 解除」）=====
  //   🔴 零额外查询：`mapping` 是第 4b 步已经读进来的同一份数据，此处只做投影（不新增一次 listAll）。
  //   为什么必须带出：**挂错卡时该菜会从 unmatched 变 ranked，未匹配清单里就没有它了**
  //   ⇒ 用户既改不了也删不掉 ⇒ 死结。前端据这份列表渲染「已关联菜品」小节 + 解除按钮。
  const mappingList = [];
  for (const m of mapping) {
    const ref = (m.external_ref_id == null ? '' : String(m.external_ref_id)).trim();
    const cc = (m.card_code == null ? '' : String(m.card_code)).trim();
    if (!ref || !cc) continue;
    mappingList.push({
      platform: (m.platform == null ? '' : String(m.platform)).trim(),
      dish_key: ref,
      card_code: cc,
    });
  }

  // ⚠️ 下面两个出参分支里的 `range` 是**内联字面量**，看着重复，但**不许提成公共变量** ——
  //   `tools/check_dishreview_engine.js` 14-②/②b 是**文本正则**守卫，它按
  //   `range: { … from: rangeFrom … }` 这个结构判「云端如实回了期间」；
  //   一旦抽成 `range: rangeObj`，守卫就匹配不到（语义没变却判红，R574 已经踩过一次）。
  //   ⇒ 两处必须逐字一致；改一处就得改另一处。
  const truncatedFlag = !!(salesRes.truncated || cardsRes.truncated);
  const reqId = (event && event.client_request_id) || '';

  // ===== A8 免费档（tier='free'）=====
  //   只回「销量榜 Top10 + 覆盖率 + 未匹配清单」，**剥掉 totalCostFen / grossFen / marginPct**。
  //   ⚠️ 排序**不能沿用 ranked 的毛利降序** —— 那等于用排序把「谁毛利高」泄出去。
  //      改按销量降序（同量比金额、再比菜名兜底 ⇒ 顺序稳定，两次 load 不会抖）。
  //   ⚠️ 外卖的毛利榜不给，但**外卖的未匹配清单必须合并回顶层** —— 那是老板自己导入的数据，
  //      也是「去建卡」的入口；把它一起藏了，免费档就变成一张空壳，谁也不会因此付钱。
  if (tier === 'free') {
    // 🔴 R729：加权标量必须用**全量 ranked**（下面的 freeTop 只是 slice(0,10) 的展示副本），
    //   且用成本卡标价 price_list 而非销量实收 amountFen（后者含优惠 ⇒ 口径会变成「实际毛利率」）。
    //   只回一个聚合数 + 覆盖率/原因，不回任何逐菜成本、毛利或售价 ⇒ 付费档卖的「可拆解结论」不受影响。
    // 🔴 R194-A 修复：加权标量分子必须用【全渠道 ranked】（堂食 + 各平台外卖），
    //   与分母 totals.qty（全渠道，R254 已合并）口径一致；否则纯外卖店恒 no_match、
    //   混合店覆盖率被结构性压低甚至被 low_match 抑制（同文件 computeCoverage 已是全渠道口径）。
    const allChannelRanked = ranked.slice();
    if (takeawayResult.by_platform) {
      for (const p of Object.keys(takeawayResult.by_platform)) {
        const pr = takeawayResult.by_platform[p] && takeawayResult.by_platform[p].ranked;
        if (Array.isArray(pr)) allChannelRanked.push(...pr);
      }
    }
    const weighted = calcWeightedMenuPct(allChannelRanked, cards, totals.qty);
    const FREE_TOP_N = 10;
    // 🔴 R194-A 同根：销量榜/已建卡数也用全渠道（按 dish_key 合并跨渠道同菜；纯堂食逐行等价）。
    const freeTopRes = buildFreeTop(ranked, takeawayResult, FREE_TOP_N);
    const freeTop = freeTopRes.top;
    const freeUnmatched = (unmatched || []).slice();
    if (takeawayResult.by_platform) {
      for (const p of Object.keys(takeawayResult.by_platform)) {
        const u = (takeawayResult.by_platform[p] || {}).unmatched;
        if (Array.isArray(u)) freeUnmatched.push(...u);
      }
    }
    return ok({
      shop_id: shopId,
      tier: 'free',
      free_top: freeTop,             // 销量 Top N（无成本/毛利字段）
      free_top_n: FREE_TOP_N,
      free_ranked_total: freeTopRes.totalDistinct,   // 「一共 N 道已建卡」（全渠道去重）⇒ 让他自己看出还差多少没看到
      mapping: mappingList,
      range: {
        from: rangeFrom,
        to: rangeTo,
        days: rangeDays,
        covered_days: cov.coveredDays,
        has_interval: cov.hasInterval,
        has_unknown: cov.hasUnknown,
      },
      unmatched: freeUnmatched,
      // 合计只给**数量口径**：给了 costFen/grossFen 就等于把毛利白送出去
      totals: {
        qty: totals.qty,
        amountFen: totals.amountFen,
        dishCount: totals.dishCount,
        unmatchedCount: totals.unmatchedCount,
      },
      coverageA: coverage.coverageA,
      coverageC: coverage.coverageC,
      buffet: coverage.buffet,
      truncated: truncatedFlag,
      // 🔴 R729：加权口径（聚合标量，非逐菜明细）。pct=null 时前端必须明示原因，绝不静默回落售价口径。
      weighted_menu_pct: weighted.pct,
      weighted_reason: weighted.reason,
      weighted_coverage: weighted.coverage,
      client_request_id: reqId,
    });
  }

  return ok({
    shop_id: shopId,
    tier: 'full',
    mapping: mappingList,   // 🔴 R255：本店现有菜名映射（前端据此可展示 / 解除，防「挂错卡无入口」）
    // 🔴 R301：**如实回报统计期间**（契约出参里的 `range{from,to}`）。
    //   · `from`/`to` 为空串 ⇒ **未按区间过滤**（调用方没给 / 只给了一端）⇒ 前端必须显示
    //     "全部期间"而不是假装单月 —— 期间口径**不许由前端猜**。
    //   · `days` = 该期间内**实际有数据的天数**（去重）⇒ 直接把"这个月只有 7 天数据"暴露出来。
    //   · R574 / #110 增三项（**均为如实回，不是估计**）：
    //       `covered_days` = 真实覆盖天数（区间行按期间并集算；与 days 不等 ⇒ 说明含汇总表）；
    //       `has_interval` = 存在「一段=一行」的汇总表数据 ⇒ 前端**必须**提示，不许当逐日比；
    //       `has_unknown`  = 存在粒度未知的行（主要是本功能上线前的历史导入）⇒ 提示可重导补齐。
    range: {
      from: rangeFrom,
      to: rangeTo,
      days: rangeDays,
      covered_days: cov.coveredDays,
      has_interval: cov.hasInterval,
      has_unknown: cov.hasUnknown,
    },
    dine_in: ranked,        // 堂食排行
    // 无外卖数据 ⇒ null（空态，不默认 0，红线 18）；有数据 ⇒ { by_platform, totals }
    takeaway: Object.keys(takeawayResult.by_platform).length ? takeawayResult : null,
    unmatched,
    totals,                 // 🔴 R254：全渠道合计（堂食 + 各外卖平台），不再是「仅堂食」
    // R272：覆盖率 C 档口径 + 自助餐人均食材成本（分母剔除零售、自助计分子；自助另走人均成本）
    coverageA: coverage.coverageA,
    coverageC: coverage.coverageC,
    buffet: coverage.buffet,
    truncated: truncatedFlag,
    client_request_id: reqId,
  });
};