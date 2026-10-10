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

const {
  pickMappingRow, judgeMappingAction, normKeyPart,
  // R260 批量形态（规范 v1.9）
  planBatchActions, countActions,
} = require('./service');
const { validateInput, validateBatch } = require('./validate');

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

  // ===== 2. 校验（R260：两种形态**互斥** —— 出现 `items` 字段即走批量分支，
  //   由 validateBatch 负责在"同时给了 dish_key"时 fail-closed；
  //   这样"形状不对的批量请求"不会被静默当成单条处理）=====
  const src = (event && (event.input || event)) || {};
  const isBatchReq = src.items !== undefined;
  const v = isBatchReq ? validateBatch(event) : validateInput(event);
  if (v.error) {
    // 批量拒绝时把「哪几项、为什么」透出去（前端逐行标红；见规范 v1.9 §1）
    return fail(v.error, v.msg, (v.rejected && v.rejected.length) ? { rejected: v.rejected } : undefined);
  }
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

  // ===== 5b. 批量分支（R260）=====
  //   放在这里而不是函数开头：鉴权 / 校验 / 付费墙 / 限流 / 幂等预检**两条路共用**，
  //   批量不是"另一条特权通道"，它必须吃同一套门禁。
  if (v.mode === 'batch') {
    return await runBatchMapping({ db, da, shopId, userId, clientRequestId, items: v.items });
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

// ===== R260：批量关联（规范 v1.9 §0 D26~D28）=====
// 为什么要它（实测的瓶颈，不是"顺手做的批量"）：
//   外卖 SKU 真表 51 个商品名、堂食菜品表 270 行，而 R255 的入口是**一道菜一次 picker +
//   每次选完 `await this.load()` 重算整页** ⇒ 51 次全页往返。批量把往返压成 ⌈N/20⌉ 次。
// 三条不可动摇的语义：
//   ① **原子**：卡存在性先整批校验，任一非法 ⇒ **一条都不写**（逐条跳过 = 用户以为全挂上了）；
//   ② **同门禁**：鉴权/校验/付费墙/限流/幂等 与单条形态共用，批量不是特权通道；
//   ③ **键不归一**：落库仍写原始 dish_key（读侧按原样查；归一化只在前端"建议卡"里用）。
async function runBatchMapping({ db, da, shopId, userId, clientRequestId, items }) {
  const list = Array.isArray(items) ? items : [];

  // ① 本店成本卡 → 现有 card_code 集合（软删由 DataAdapter 过滤）
  //    ⚠️ 用 listAll 而非 list：`shop_cost_card` 是版本模型（只 INSERT），
  //       短页会被当成"到底了" ⇒ 卡被静默漏掉 ⇒ 明明存在的卡被判"不存在"（假拒绝）。
  const cardsRes = await da.listAll('shop_cost_card', { shop_id: shopId });
  const cards = (cardsRes && cardsRes.data) || [];
  const knownCodes = new Set();
  for (const c of cards) {
    const cc = normKeyPart(c.card_code);
    if (cc) knownCodes.add(cc);
  }

  // ② 🔴 先整批校验卡存在性 —— 必须**早于任何写库**（挪到写之后 = 脏数据已落库才报错）
  const rejected = [];
  list.forEach((it, i) => {
    if (!it.card_code) return;               // 空 card_code = 解除，不需要卡存在
    if (!knownCodes.has(it.card_code)) {
      rejected.push({ index: i, dish_key: it.dish_key, reason: 'card_not_found' });
    }
  });
  if (rejected.length) {
    return fail(ERROR_CODES.RESOURCE_NOT_FOUND,
      '有 ' + rejected.length + ' 项要关联的成本卡不存在或已删除，整批未写入',
      { rejected });
  }

  // ③ 既有映射行一次性读全（避免逐项查库；批内新插入的行不在此快照里 ⇒ 故必须先去重）
  const mapRes = await da.listAll(COLL, { shop_id: shopId });
  const rows = (mapRes && mapRes.data) || [];
  const plans = planBatchActions(rows, list);
  const now = nowUtc();

  // ④ 逐项写库（≤ MAX_BATCH=20，串行 —— 云端 timeout 默认 3s 的硬约束，见 service.js 头注）
  for (const p of plans) {
    if (p.action === 'created') {
      await da.insert(COLL, {
        shop_id: shopId,
        platform: p.platform,
        // 🔴 原始 dish_key，**不归一**（读侧按原样查，归一即永远失配）
        external_ref_id: p.dish_key,
        card_code: p.card_code,
        created_at: now,
        updated_at: now,
      });
    } else if (p.action === 'updated') {
      // 🔴 主键必须用 _id：doc(业务键).update() 在真云**静默 0 行**（不报错、不生效）
      const _id = p._id;
      await db.collection(COLL).doc(_id).update({
        data: { card_code: p.card_code, updated_at: now },
      });
    } else if (p.action === 'cleared') {
      await da.softDelete(COLL, p._id, userId);
    }
    // noop：不写库（无行且未给卡 / 有行且卡没变）⇒ 幂等友好
  }

  const counts = countActions(plans);
  const out = {
    shop_id: shopId,
    batch: true,
    counts,
    results: plans.map((p) => ({
      dish_key: p.dish_key, platform: p.platform, card_code: p.card_code, action: p.action,
    })),
    client_request_id: clientRequestId || '',
  };

  // ⑤ 审计（整批一次；契约标「+幂等」⇒ 必须有 writeAudit；键走单源 shopKey）
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'SAVE_DISH_MAPPING_BATCH',
        operator_type: 'user',
        operator_id: userId,
        shop_id: shopId,
        before_data: null,
        after_data: out,
        remark: 'batch:' + counts.total + ' c' + counts.created + ' u' + counts.updated + ' x' + counts.cleared,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }

  return ok(out);
}
