// cloudfunctions/calcMonthlyProfit/validate.js —— 入参校验（纯函数，无云依赖，可单测）。
//
// 从 index.js 抽出（R27）：index.js 顶部 require('wx-server-sdk')，无法在纯 Node 下单测，
// 故把纯校验逻辑独立成模块，云函数与单测脚本都 require 它，行为完全一致。
//
// ⚠️ R27（复审方裁决：不留口子）：金额字段必须是 JSON number（整数分）。
//   - 标量 f() 与明细 amount_fen 一律 `typeof v === 'number'`，字符串一律 INVALID_PARAM。
//   - 理由：表单 <input> 原生值就是字符串，前端漏一次 Number() 会一路"看起来正常"、错到账目里
//     （同族反模式：amount_fen 双收、±0.01 容差掩膜、门禁豁免表）。云函数入参是 JSON，
//     wx.cloud.callFunction 会把 JS number 序列化成 number，合法调用不会被误伤。
//   - 错误信息点名字段，便于开发期立刻定位，而不是查半天。

const { ERROR_CODES } = require('./common');

// 明细数组：逐项检查 amount_fen。契约层只认 snake_case（批次 0 §2.9 / core/10 R20）。
function cleanItems(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    return { error: ERROR_CODES.INVALID_PARAM, msg: '明细必须是数组' };
  }
  const out = [];
  for (const it of list) {
    const hasSnake = it && it.amount_fen !== undefined;
    const hasCamel = it && it.amountFen !== undefined;
    if (!hasSnake) {
      return {
        error: ERROR_CODES.INVALID_PARAM,
        msg: hasCamel
          ? '明细金额字段请用 snake_case 的 amount_fen（不收 amountFen）'
          : '明细缺少 amount_fen（「分」非负整数）',
      };
    }
    if (hasCamel && Number(it.amountFen) !== Number(it.amount_fen)) {
      return {
        error: ERROR_CODES.INVALID_PARAM,
        msg: '明细金额字段冲突：amountFen 与 amount_fen 不相等，请只传 amount_fen',
      };
    }
    const v = it.amount_fen;
    // R27：必须是 JSON number（整数分）；字符串一律拒绝（响亮失败，勿静默兼容）
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: '明细 amount_fen 必须是「分」非负整数（JSON number，字符串不接受）' };
    }
    out.push({ amountFen: v }); // 转成 Service 内部形态（Service 层用 camelCase JS 变量名）
  }
  return out;
}

// 入参校验：金额一律「分」非负整数；收入/费用合计由 Service 系统汇总，禁止传 total。
function validateInput(event) {
  const err = (msg) => ({ error: ERROR_CODES.INVALID_PARAM, msg });
  if (!event || typeof event !== 'object') return err('event must be an object');

  const src = event.input || event;

  // 明细数组：逐项检查 amount_fen 为非负整数分（契约层只认 snake_case，见 cleanItems 注释）
  const incomeItems = cleanItems(src.income_items);
  if (incomeItems.error) return incomeItems;
  const expenseItems = cleanItems(src.expense_items);
  if (expenseItems.error) return expenseItems;

  // 直接填消耗 / 摊销 / 待结算 / 库存
  const f = (v, name) => {
    if (v === undefined || v === null) return 0;
    // R27：标量金额收紧为 JSON number（整数分）；字符串一律拒（刻意设计，勿绕过）
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return err(`${name} 必须是「分」非负整数（JSON number，字符串不接受）`);
    }
    return v;
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

module.exports = { validateInput, cleanItems };
