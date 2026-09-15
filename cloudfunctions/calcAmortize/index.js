// cloudfunctions/calcAmortize/index.js —— 批次 2 · POC1 摊销边界与尾差残值（Controller 层）
//
// 分层归属：
//   Controller：过批次 0 鉴权中间件（resolveAuth + assertShopOwner）→ 参数校验/清洗
//               → 经 DataAdapter 读该店「活跃」摊销资产台账（已自动过滤 is_deleted=true，软删不参与计算）
//               → 把干净资产数组传给 Service 纯函数 → 纯计算返回当月摊销（契约 core/10:46：只算不写，总额由调用方落库）
//   Service   ：calcAmortize/service.js，纯计算，不碰云与前端请求。
//
// 输出对接批次 1：返回 data 含 total_amount_fen（当月摊销总费用，分整数）+ details（各资产明细），
//                数值格式与 calcMonthlyProfit 的「当月摊销总费用」输入完全对齐，可直接传入。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { calcAmortize } = require('./service');
const { validateInput, docToAsset } = require('./validate');    // 入参校验 + 台账映射（纯函数，无云依赖，可单测）

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 参数校验 / 清洗（金额字段纪律见 validate.js，R27 不留口子）=====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. 读该店活跃摊销资产台账（DataAdapter 统一注入 is_deleted=false，软删资产天然被排除，业务层不关心）=====
  const da = makeAdapter(db);
  const readRes = await da.list('shop_amortize', { shop_id: shopId });
  const assets = (readRes && readRes.data || []).map(docToAsset);

  // ===== 4. Service 纯计算（多资产独立尾差倒挤）=====
  const result = calcAmortize(assets, v.month);

  // ===== 5. 纯计算返回（契约 core/10:46：calcAmortize 只算不写；月度摊销总额由调用方落到 shop_monthly_account）=====
  return ok({
    shop_id: shopId,
    month: v.month,
    client_request_id: v.input.client_request_id || '',
    ...result,
  });
};

// （DB 台账文档 → Service 干净资产对象 已抽到 validate.js 的 docToAsset，纯函数、可单测；
//  calcAmortize 按契约 core/10:46 只算不写，月度摊销总额由调用方落到 shop_monthly_account。）