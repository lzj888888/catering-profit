// cloudfunctions/getShopList/index.js —— 批次 7 · 多店铺列表（Controller 层 · 读）
//
// ⚠️ 店铺切换器数据源（批次 7 §2.3/§2.7）：
//   · 列表**仅含 is_deleted=false**（软删店铺不进入切换列表、不占免费配额，DataAdapter 统一过滤）
//   · 免费配额维度 = user_id（M1 每用户 1 家免费账套；第 2 家店保存时触发付费墙，**切换不触发**）
//   · 返回 hit_free_limit 供前端「新增店铺」按钮判断；店铺切换本身永不弹窗。
// ⚠️ 与批次 0 auth 一致：只取 ctx.OPENID 识别用户，绝不信任前端传入的 user_id。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth } = common;
const { ok, fail, ERROR_CODES } = common;
const { makeAdapter } = common.dataAdapter;

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  // ===== 2. 读该用户全部活跃店铺（软删自动排除）=====
  const da = makeAdapter(db);
  const res = await da.list('shop', { user_id: userId });
  const shops = (res && res.data) || [];

  // ===== 3. 出参（仅活跃店铺）=====
  const list = shops.map((s) => ({
    shop_id: s.shop_id || s.id,
    name: s.name || '',
    remark: s.remark || '',
  }));

  // M3.22（批次 A1）：免费额度唯一真相源 = feature_permissions.plan_free.limits.shop（不再硬编码 1）
  const fpRes = await db.collection('feature_permissions').where({ plan_id: 'plan_free' }).limit(1).get();
  const fp = fpRes && fpRes.data && fpRes.data[0];
  const limits = fp && fp.limits;
  const freeShopLimit = limits && limits.shop;
  if (freeShopLimit === undefined || freeShopLimit === null) {
    return fail(ERROR_CODES.SYSTEM_ERROR, '配额配置缺失（plan_id=plan_free）');
  }
  const hitFreeLimit = shops.length >= freeShopLimit;

  return ok({
    shop_id: (event && event.shop_id) || '',
    list,
    free_limit: freeShopLimit,
    used: shops.length,
    hit_free_limit: hitFreeLimit,
    client_request_id: (event && event.input && event.input.client_request_id) || '',
  });
};