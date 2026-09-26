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

  // ===== 3. Service 纯计算（基础份：口径一字不变）=====
  let r;
  try {
    r = calcCostCard(v.card);
  } catch (e) {
    // R81：引擎对非法 mode 抛 INVALID_PARAM（透传为响亮失败），其余按系统错误兜底
    if (e && e.code) return fail(e.code, e.msg || e.message);
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '成本计算失败');
  }

  // ===== 4. M3.15（R150）多规格试算（可选；**入参变换**，引擎本身一行不改）=====
  //   规格成本 = calcCostCard({ lines: 派生后的 lines, auxFen: 派生后的辅料桶, ... })
  //   🔴 三条硬约束：① specDerive 只在 common 单源（不内联进任何 service.js）；
  //     ② 规格成本**不得**写进基础份 total_cost（下面返回的 unit_cost_fen 仍是基础份值）；
  //     ③ 系数全 1 ⇒ 派生结果 ≡ 原入参（由 common/specDerive.js 的 k===1 分支构造保证）。
  const specResults = [];
  for (const key of v.spec_keys) {
    const preset = common.specDerive.findPreset(key);
    if (!preset) continue;
    const priceFen = (v.spec_prices && v.spec_prices[key] != null) ? v.spec_prices[key] : 0;
    try {
      const d = common.deriveSpec(v.card.lines, v.card.auxFen, preset.coef);
      const sr = calcCostCard({
        mode: v.card.mode,
        lines: d.lines,
        auxFen: d.auxFen,
        lossPct: v.card.lossPct,
        batchOutput: v.card.batchOutput,
        priceFen,
        targetMarginPct: v.card.targetMarginPct,
      });
      specResults.push({
        spec_key: preset.spec_key,
        name: preset.name,
        coef: preset.coef,                    // 用的是哪套系数（页面据此显示"主料×0.5"）
        price_fen: priceFen,
        material_total_fen: sr.material_total_fen,
        unit_cost_fen: sr.unit_cost_fen,      // 规格成本（**展示/试算值**，不落库）
        gross_profit_fen: sr.gross_profit_fen,
        gross_margin_pct: sr.gross_margin_pct,
        reverse_price_fen: sr.reverse_price_fen, // 按目标毛利率反推的规格建议价
      });
    } catch (e) {
      if (e && e.code) return fail(e.code, e.msg || e.message);
      return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '规格试算失败');
    }
  }

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
    spec_results: specResults,
  });
};