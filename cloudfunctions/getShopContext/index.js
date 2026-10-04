// cloudfunctions/getShopContext/index.js —— 批次 4 · 店铺上下文（Controller 层 · 读）
//
// 返回：当前用户默认店铺 + 服务端权威开关（库存/摊销）+ 店铺名/备注。管理入口 / 月度 / 设置页共用。
// 鉴权中间件（批次 0）→ 校验 → 读用户第一个活跃店铺 → 读 shop_switch → 映射出参。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, genId, defaultShopId, isDuplicateKeyError } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { switchesFromRows, takeawayParamsFromRows, menuDishCountFromRows } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  const da = makeAdapter(db);

  // ===== 2. 取该用户店铺（**仅**「从未建过店」的新用户才自动建档）=====
  const shopsRes = await da.list('shop', { user_id: userId });
  let shop = (shopsRes && shopsRes.data && shopsRes.data[0]) || null;
  let created = false;

  // 🔴 R208：**必须先分清「从未建店的新用户」与「主动删空的老用户」**，两者处理完全不同。
  //   背景：R208 起放开「删除最后一家店」（免费档否则永久锁死，见 manageShop/service.js::decideDelete）。
  //   放开后若这里仍无条件 autoProvision，会同时炸出两个坑：
  //     坑 A（体验）：用户删完店，下一秒进任何页面 ⇒ 这里又插一个「我的店铺」⇒ 删除形同没删。
  //     坑 B（🔴🔴 全站不可用 —— 这条会致命）：`defaultShopId(userId)` 是**确定性** `_id`，
  //        而软删**不物理删文档**（`is_deleted=true` 仍在库）⇒ 同 `_id` 再 insert 必撞键
  //        ⇒ 走下面的 catch（isDuplicateKeyError）⇒ `created=false`
  //        ⇒ 回读仍为空（文档是软删态，不在 is_deleted=false 列表里）
  //        ⇒ `fail('店铺初始化失败（并发冲突后回读为空）')` ⇒ **用户此后所有页面全部报错**。
  //   ⇒ 二者用「该 user_id 名下是否**曾经存在**过店铺（含软删）」区分，**只有全新用户才兜底建店**。
  if (!shop) {
    const everRes = await da.listIncludingDeleted('shop', { user_id: userId });
    const everHad = (everRes && everRes.data && everRes.data.length > 0);
    if (everHad) {
      // ⚠️ 用户是自己把店铺清空（或最后一家被删）⇒ **不自动建**，返回「无店铺」状态，
      //    交前端店铺页引导新建一个，其免费额度（used=0）也正好还剩着。
      //    出参结构与正常返回**同形**（开关/偏好给默认值），前端无需分支处理。
      return ok({
        shop_id: '',
        shop_name: '',
        shop_remark: '',
        switches: switchesFromRows([]),
        takeaway_params: takeawayParamsFromRows([]),
        menu_dish_count: menuDishCountFromRows([]),
        pinned_cards: [],
        pinned_materials: [],
        no_shop: true,
        is_new_shop: false,
        client_request_id: v.input.client_request_id || '',
      });
    }
  }
  if (!shop) {
    // 🔴 A6b 兜底（2026-09-19 真云实测 `shop.idx_shop_user` **非** unique：
    //    同一 user_id 连插两次都成功 ⇒ 「先查后建」在并发下会建出两个店）。
    //    修法 = 键格式复用**单源** `common.defaultShopId(userId)`（确定性 `_id`）：
    //    第二个并发请求必然撞 `_id` 被库拒，而不是靠"我先查过一遍"。
    //    ⚠️ 撞键后**必须回读**；回读仍为空 ⇒ fail-closed（不猜、不硬返回假 shop_id）。
    const id = defaultShopId(userId);
    try {
      await da.insert('shop', {
        _id: id, id, shop_id: id, user_id: userId, name: '我的店铺', remark: '', created_at: nowUtc(),
      });
      created = true;
    } catch (e) {
      if (!isDuplicateKeyError(e)) {
        return fail(ERROR_CODES.SYSTEM_ERROR, (e && (e.msg || e.message)) || '店铺初始化失败');
      }
      created = false; // 并发方已建好
    }
    const again = await da.list('shop', { user_id: userId });
    shop = (again && again.data && again.data[0]) || null;
    if (!shop) return fail(ERROR_CODES.SYSTEM_ERROR, '店铺初始化失败（并发冲突后回读为空）');
  }
  const shopId = shop.shop_id || shop.id;

  // ===== 3. 读服务端权威开关 =====
  const swRes = await da.list('shop_switch', { shop_id: shopId });
  const swRows = (swRes && swRes.data) || [];
  const switches = switchesFromRows(swRows);
  const takeawayParams = takeawayParamsFromRows(swRows);
  const menuDishCount = menuDishCountFromRows(swRows);

  return ok({
    shop_id: shopId,
    shop_name: shop.name || '',
    shop_remark: shop.remark || '',
    // R208：无店铺状态的显式标志（契约键**恒存在**，新用户建档路径恒为 false ⇒ 前端不必辨空）
    no_shop: false,
    switches,
    // M3.17（批次 D）：外卖平台参数默认值（JSON 字符串；缺省 '' 由前端 parse 兜底）
    takeaway_params: takeawayParams,
    // M3.21（批次 E）：本月在售菜品数（缺省 null = 未填）
    menu_dish_count: menuDishCount,
    // round156：列表置顶（店铺级偏好，同 biz_type/city_tier 一样随上下文下发）。
    //   存量店铺没有这两个字段 ⇒ 给 []（fail-soft，不回填、不报错）。
    pinned_cards: Array.isArray(shop.pinned_cards) ? shop.pinned_cards : [],
    pinned_materials: Array.isArray(shop.pinned_materials) ? shop.pinned_materials : [],
    is_new_shop: created,
    client_request_id: v.input.client_request_id || '',
  });
};