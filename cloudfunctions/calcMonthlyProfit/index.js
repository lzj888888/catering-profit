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

// ---- 参数校验：金额一律「分」非负整数；收入/费用合计由 Service 系统汇总，禁止传 total ----
function validateInput(event) {
  const err = (msg) => ({ error: ERROR_CODES.INVALID_PARAM, msg });
  if (!event || typeof event !== 'object') return err('event must be an object');

  const src = event.input || event;

  // 明细数组：逐项检查 amountFen 为非负整数分
  const incomeItems = cleanItems(src.income_items);
  if (incomeItems.error) return incomeItems;
  const expenseItems = cleanItems(src.expense_items);
  if (expenseItems.error) return expenseItems;

  // 直接填消耗 / 摊销 / 待结算 / 库存
  const f = (v, name) => {
    const n = Number(v);
    if (v === undefined || v === null) return 0;
    if (!Number.isInteger(n) || n < 0) return err(`${name} 必须是「分」非负整数`);
    return n;
  };
  const directConsumeFen = f(src.direct_consume_fen, 'direct_consume_fen');
  if (typeof directConsumeFen === 'object' && directConsumeFen.error) return directConsumeFen;
  const amortizeFen = f(src.amortize_fen, 'amortize_fen');
  if (typeof amortizeFen === 'object' && amortizeFen.error) return amortizeFen;
  const pendingFen = f(src.pending_settlement_fen, 'pending_settlement_fen');
  if (typeof pendingFen === 'object' && pendingFen.error) return pendingFen;

  let inventory = {};
  if (src.inventory && typeof src.inventory === 'object') {
    const iv = src.inventory;
    for (const k of ['opening_fen', 'purchase_fen', 'closing_fen']) {
      const vv = f(iv[k], 'inventory.' + k);
      if (typeof vv === 'object' && vv.error) return vv;
      inventory[k] = vv;
    }
  }

  return {
    error: null,
    incomeItems,
    expenseItems,
    input: {
      month: src.month || '',
      client_request_id: src.client_request_id || '',
      directConsumeFen, amortizeFen, pendingFen, inventory,
      inventory_switch_reference: !!src.inventory_switch_reference,
      amortize_switch_reference: !!src.amortize_switch_reference,
    },
  };
}

function cleanItems(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    return { error: ERROR_CODES.INVALID_PARAM, msg: '明细必须是数组' };
  }
  const out = [];
  for (const it of list) {
    const n = Number(it && it.amountFen !== undefined ? it.amountFen : it && it.amount_fen);
    if (!Number.isInteger(n) || n < 0) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: '明细 amountFen 必须是「分」非负整数' };
    }
    out.push({ amountFen: n });
  }
  return out;
}