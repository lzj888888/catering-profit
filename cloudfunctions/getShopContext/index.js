// cloudfunctions/getShopContext/index.js —— 批次 4 · 店铺上下文（Controller 层 · 读）
//
// 返回：当前用户默认店铺 + 服务端权威开关（库存/摊销）+ 店铺名/备注。管理入口 / 月度 / 设置页共用。
// 鉴权中间件（批次 0）→ 校验 → 读用户第一个活跃店铺 → 读 shop_switch → 映射出参。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, genId } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { switchesFromRows } = require('./service');
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

  // ===== 2. 取该用户店铺（无就自动建档一个默认店铺）=====
  const shopsRes = await da.list('shop', { user_id: userId });
  let shop = (shopsRes && shopsRes.data && shopsRes.data[0]) || null;
  let created = false;
  if (!shop) {
    const id = genId('shop_');
    await da.insert('shop', {
      id, shop_id: id, user_id: userId, name: '我的店铺', remark: '', created_at: nowUtc(),
    });
    shop = { id, shop_id: id, user_id: userId, name: '我的店铺', remark: '' };
    created = true;
  }
  const shopId = shop.shop_id || shop.id;

  // ===== 3. 读服务端权威开关 =====
  const swRes = await da.list('shop_switch', { shop_id: shopId });
  const switches = switchesFromRows((swRes && swRes.data) || []);

  return ok({
    shop_id: shopId,
    shop_name: shop.name || '',
    shop_remark: shop.remark || '',
    switches,
    is_new_shop: created,
    client_request_id: v.input.client_request_id || '',
  });
};