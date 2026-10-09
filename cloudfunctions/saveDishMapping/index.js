// cloudfunctions/saveDishMapping/index.js —— 菜名映射**写侧**（R255 · 承接 R253 方案 §五的 M3/M4）
//
// 为什么现在才做写侧（R254 真云探针坐实，非推断）：
//   R253 已把映射表**读侧**接好（getDishReview 会先查 shop_dish_mapping），但**没有任何入口写一行**
//   ⇒ 表恒空 ⇒ 那条读路径永远走不到。真云实证：taobao 平台块 51 道菜 ¥1823.08，`ranked` **0 条**、
//   `unmatchedCount` **51** ⇒ 单品毛利恒算不出来。而客户端直读该集合返回
//   `DATABASE_PERMISSION_DENIED`（core/15 第 27 行：「仅管理端可读写，客户端零直连」）
//   ⇒ **造映射记录只能走云函数，没有第二条路**。
//
// 铁律（照本仓既有写侧函数的纪律，一条不少）：
//   ① 鉴权 resolveAuth + assertShopOwner（A 类 ⇒ 无需登记 check_fn_public_surface 的 PUBLIC_FNS）；
//   ② 付费墙 **先于**付费功能落地（m3_dishreview，与 getDishReview 同域 —— 映射的价值完全依附复盘，
//      免费档"能写不能读"没有意义）；
//   ③ 写限流 R213（store 必须模块级单例，写在 main 里 ⇒ 计数永远为 1 ⇒ 限流恒不触发）；
//   ④ 幂等（重放形态）：findPriorResult 早于任何业务写，契约标「+幂等」⇒ 必须有 writeAudit；
//   ⑤ 🔴 写库主键必用 `_id`（`doc(业务键).update()` 真云**静默 0 行**）；
//   ⑥ 解除映射走**软删**（可逆），绝不物理删除；
//   ⑦ 🔴 键必须与读侧逐字对齐（见 service.js 头注；错位 = 死输入）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { makeAdapter } = common.dataAdapter;

const { pickMappingRow, judgeMappingAction, normKeyPart } = require('./service');
const { validateInput } = require('./validate');

// 🔒 R213 写限流（openid 维度 60 次/分钟）
//   🔴 store 必须模块级单例：放进 exports.main 里每次调用都是新桶 ⇒ 计数永远 1 ⇒ 限流恒不触发
//      （零件齐全却等于没接线 —— 守卫 tools/check_rate_limit_params.js::A8 钉死这一点）。
const RATE_STORE = new Map();
const rateLimitCheck = common.rateLimit.makeRateLimiter(RATE_STORE);

const COLL = 'shop_dish_mapping';
// 付费域：与 getDishReview 同一个（派生规则：PAID_FEATURES 里的 m3_dishreview）
const FEATURE = 'm3_dishreview';

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权 =====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);
  const clientRequestId = v.input.client_request_id;

  // ===== 3. 付费墙（铁律：先于付费功能落地）=====
  const unlocked = await common.hasFeature(db, userId, FEATURE);
  if (!unlocked) return fail(ERROR_CODES.FEATURE_LOCKED);

  // ===== 4. 写限流（在鉴权 + 校验之后：非法请求当场拒绝，不占限额）=====
  const rl = await rateLimitCheck(userId);
  if (rl.limited) return fail(rl.code);

  // ===== 5. 幂等预检（早于任何业务写）=====
  const da = makeAdapter(db);
  if (clientRequestId) {
    const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
    if (prior) return ok(prior);
  }

  // ===== 6. card_code 非空 ⇒ 该卡必须在本店存在且未软删 =====
  //   🔴 挂到不存在的卡 = **死挂钩**：映射行写进去了，读侧查到 card_code 却发现
  //      latestByCode 里没有 ⇒ 回落名称匹配 ⇒ 照旧 unmatched，而用户以为挂上了。
  //      与其静默无效，不如当场拒绝（A7 锚点）。
  let cardName = '';
  if (v.card_code) {
    const cardsRes = await da.listAll('shop_cost_card', { shop_id: shopId });
    const cards = (cardsRes && cardsRes.data) || [];
    let latest = null;
    for (const c of cards) {
      if (normKeyPart(c.card_code) !== v.card_code) continue;
      if (!latest || (Number(c.version) || 0) > (Number(latest.version) || 0)) latest = c;
    }
    if (!latest) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, '成本卡不存在或已删除');
    cardName = latest.name || '';
  }

  // ===== 7. 找既有映射行（唯一键 (shop_id, platform, external_ref_id)）=====
  const mapRes = await da.listAll(COLL, { shop_id: shopId });
  const rows = (mapRes && mapRes.data) || [];
  const row = pickMappingRow(rows, v.platform, v.dish_key);
  const action = judgeMappingAction(row, v.card_code);
  const now = nowUtc();

  if (action === 'created') {
    await da.insert(COLL, {
      shop_id: shopId,
      platform: v.platform,
      // 🔴 原始 dish_key，**不归一**（读侧按原样查，归一即失配）
      external_ref_id: v.dish_key,
      card_code: v.card_code,
      created_at: now,
      updated_at: now,
    });
  } else if (action === 'updated') {
    // 🔴 主键必须用 _id：doc(业务键).update() 在真云**静默 0 行**（不报错、不生效）。
    await db.collection(COLL).doc(row._id).update({
      data: {
        card_code: v.card_code,
        updated_at: now,
      },
    });
  } else if (action === 'cleared') {
    // 可逆：软删（读侧经 DataAdapter 自动过滤 is_deleted=false ⇒ 下次复盘自然回落未匹配）
    await da.softDelete(COLL, row._id, userId);
  }
  // noop：不写库（无行且未给卡 / 有行且卡没变）⇒ 幂等友好，仍返回成功

  const out = {
    shop_id: shopId,
    platform: v.platform,
    dish_key: v.dish_key,
    card_code: v.card_code,
    card_name: cardName,
    action,
    client_request_id: clientRequestId || '',
  };

  // ===== 8. 审计（契约标「+幂等」⇒ 必须有 writeAudit；键走单源 shopKey）=====
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'SAVE_DISH_MAPPING',
        operator_type: 'user',
        operator_id: userId,
        shop_id: shopId,
        before_data: row ? { card_code: normKeyPart(row.card_code) } : null,
        after_data: out,
        remark: action,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }

  return ok(out);
};
