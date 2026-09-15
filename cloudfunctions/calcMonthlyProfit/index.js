// cloudfunctions/calcMonthlyProfit/index.js —— 批次 1 · POC3 双利润引擎（Controller 层）
//
// 分层归属：
//   Controller：过批次 0 鉴权中间件（resolveAuth + assertShopOwner）→ 参数校验/清洗
//               → 从 shop_switch 读服务端权威开关 → 把「干净数据」传给 Service。
//   Service   ：calcMonthlyProfit/service.js，纯计算，不碰云与前端请求。
//
// ⚠️ 本批只验证算法，不做任何数据库写入、不做前端页面。
//   「写操作带 client_request_id 幂等」在此为读/计算请求，无写；仍接受该字段并透传校验（后续批次留痕用）。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');               // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { calcMonthlyProfit } = require('./service');
const { validateInput } = require('./validate');   // 入参校验（纯函数，无云依赖，可单测；R27 抽出）

// shop_switch 服务端开关键（第 8 章表结构约定；集合仅管理端可写，天然防前端篡改）
const SWITCH_KEY_INVENTORY = 'inventory_switch';   // 库存开关
const SWITCH_KEY_AMORTIZE = 'amortize_switch';     // 摊销开关

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

  // ===== 3. 服务端权威开关（防前端篡改）：优先读 shop_switch，前端值仅作参考 =====
  const sw = await readSwitches(db, shopId, v.input);
  if (sw.error) return fail(sw.error, sw.msg);

  // ===== 4. 组装干净数据 → Service 纯计算 =====
  const clean = {
    incomeItems: v.incomeItems,        // 收入明细（分）
    expenseItems: v.expenseItems,      // 费用明细（分）
    directConsumeFen: v.input.directConsumeFen,
    amortizeFen: v.input.amortizeFen || 0,
    amortizeSwitchOn: sw.amortizeSwitchOn,     // 服务端权威
    inventorySwitchOn: sw.inventorySwitchOn,   // 服务端权威
    inventory: v.input.inventory || {},
    pendingSettlementFen: v.input.pendingSettlementFen || 0,
  };
  const result = calcMonthlyProfit(clean);

  return ok({
    shop_id: shopId,
    month: v.input.month || '',
    client_request_id: v.input.client_request_id || '',
    ...result,
  });
};

// ---- switch 读取：服务端权威，前端传入仅作参考 ----
async function readSwitches(db, shopId, input) {
  const out = { inventorySwitchOn: false, amortizeSwitchOn: false };
  const keys = [SWITCH_KEY_INVENTORY, SWITCH_KEY_AMORTIZE];
  try {
    const res = await db.collection('shop_switch')
      .where({ shop_id: shopId, switch_key: db.command.in(keys), is_deleted: false })
      .limit(20).get();
    const rows = (res && res.data) || [];
    const byKey = {};
    for (const r of rows) byKey[r.switch_key] = !!r.enabled;
    // 服务端存在 → 以服务端为准；不存在 → 回落前端参考值（但计算口径仍以本读值为最终）
    out.inventorySwitchOn = byKey[SWITCH_KEY_INVENTORY] !== undefined
      ? byKey[SWITCH_KEY_INVENTORY]
      : !!input.inventory_switch_reference;
    out.amortizeSwitchOn = byKey[SWITCH_KEY_AMORTIZE] !== undefined
      ? byKey[SWITCH_KEY_AMORTIZE]
      : !!input.amortize_switch_reference;
    return out;
  } catch (e) {
    return { error: ERROR_CODES.SYSTEM_ERROR, msg: 'read shop_switch failed: ' + e.message };
  }
}

// ---- 参数校验见 validate.js（R27 抽出：纯函数、无云依赖、可单测；金额字段必须 JSON number）----
