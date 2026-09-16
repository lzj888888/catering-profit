// cloudfunctions/calcBom/index.js —— 批次 3 · POC2 BOM 两层 + 快照成本（Controller 层 · 纯计算锚点）
//
// 分层归属：
//   Controller：过批次 0 鉴权中间件（resolveAuth + assertShopOwner）→ 参数校验/清洗
//               → 把干净数据传给 Service 纯引擎 → 返回计算输出。
//   Service   ：calcBom/service.js，纯函数，不碰云与前端请求（POC2 锚点）。
//
// ⚠️ 本函数**只算不写**（契约 core/10 §3）：计算结果由前端展示 / 由保存类函数落库。
//   `calcBom` 既是可独立 `callFunction` 的云函数，也是「计算锚点」——保存卡时同样复用同一套公式。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { calcCostCard } = require('./service');
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

  // ===== 2. 参数校验 / 清洗 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. Service 纯计算 =====
  const r = calcCostCard(v.card);

  return ok({
    shop_id: shopId,
    client_request_id: v.input.client_request_id || '',
    material_total_fen: r.material_total_fen,
    unit_cost_fen: r.unit_cost_fen,
    batch_total_fen: r.batch_total_fen,
    gross_profit_fen: r.gross_profit_fen,
    gross_margin_pct: r.gross_margin_pct,
    reverse_price_fen: r.reverse_price_fen,
    lines: r.lines,
  });
};