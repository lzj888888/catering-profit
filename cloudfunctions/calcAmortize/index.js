// cloudfunctions/calcAmortize/index.js —— 批次 2 · POC1 摊销边界与尾差残值（Controller 层）
//
// 分层归属：
//   Controller：过批次 0 鉴权中间件（resolveAuth + assertShopOwner）→ 参数校验/清洗
//               → 经 DataAdapter 读该店「活跃」摊销资产台账（已自动过滤 is_deleted=true，软删不参与计算）
//               → 把干净资产数组传给 Service 纯函数 → 把当月摊销明细写入 shop_amortize（落库留痕）
//   Service   ：calcAmortize/service.js，纯计算，不碰云与前端请求。
//
// 输出对接批次 1：返回 data 含 total_amount（当月摊销总费用，分整数）+ details（各资产明细），
//                数值格式与 calcMonthlyProfit 的「当月摊销总费用」输入完全对齐，可直接传入。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { calcAmortize } = require('./service');
const { validateInput } = require('./validate');    // 入参校验（纯函数，无云依赖，可单测）

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

  // ===== 5. 写入 shop_amortize：持久化当月各资产摊销明细（落库留痕，供后续批次读取/审计）=====
  const writeErr = await writeMonthlyAmortize(da, shopId, v.month, result.details);
  if (writeErr) return fail(ERROR_CODES.SYSTEM_ERROR, writeErr);

  return ok({
    shop_id: shopId,
    month: v.month,
    client_request_id: v.input.client_request_id || '',
    ...result,
  });
};

// ---- DB 台账文档 → Service 干净资产对象 ----
// 字段对齐 M1 规范 shop_amortize：asset_id(或 id)/name/total_value/start_month/total_months/terminate_month。
// 金额 total_value 做同纪律防御：非法值 → 抛 INVALID_PARAM 点名 asset_id（服务端台账也必有整数分）。
function docToAsset(doc) {
  const id = doc.asset_id || doc.id;
  const total = Number(doc.total_value);
  if (!Number.isInteger(total) || total < 0) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: `台账资产 asset_id=${id} 的 total_value 必须是「分」非负整数` };
  }
  return {
    asset_id: id,
    name: doc.name || '',
    total_value: total,
    start_month: doc.start_month,
    total_months: doc.total_months,
    terminate_month: doc.terminate_month || '',
  };
}

// 把当月各资产摊销明细写入 shop_amortize（一条资产一行，DataAdapter 自动注入 created_at/updated_at/is_deleted=false）
async function writeMonthlyAmortize(da, shopId, month, details) {
  try {
    for (const d of (details || [])) {
      await da.insert('shop_amortize', {
        shop_id: shopId,
        month,
        asset_id: d.asset_id,
        name: d.name,
        amount_fen: d.amount_fen,
        start_month: d.start_month,
        total_months: d.total_months,
        terminate_month: d.terminate_month,
        residual_loss: d.residual_loss,
      });
    }
    return null;
  } catch (e) {
    return 'write shop_amortize failed: ' + e.message;
  }
}