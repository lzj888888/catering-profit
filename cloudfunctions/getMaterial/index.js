// cloudfunctions/getMaterial/index.js —— 批次 3 · POC2 原料档案（Controller 层 · 读）
//
// 鉴权中间件（批次 0）→ 校验 → 经 DataAdapter.list 读「该店活跃原料（含虚拟半成品）」
//   （DataAdapter 统一注入 is_deleted=false，软删天然排除）→ 逐条映射出参（含净料单位成本）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { docToOutput } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 参数校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. 读该店活跃原料（DataAdapter 注入 is_deleted=false；extra 仅承载过滤条件）=====
  const da = makeAdapter(db);
  const extra = v.is_virtual === null ? {} : { is_virtual: v.is_virtual };
  const res = await da.list('shop_material', { shop_id: shopId }, extra);
  const list = ((res && res.data) || []).map(docToOutput);

  return ok({
    shop_id: shopId,
    client_request_id: v.input.client_request_id || '',
    list,
  });
};