// cloudfunctions/saveLedger/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, month, income_items[{amount_fen}], expense_items[{amount_fen}], direct_consume_fen, inventory?, archive_override?, client_request_id }。
// 金额一律「分」JSON number（R27）；明细只收 amount_fen（R30 双收即拒）。
const { ERROR_CODES } = require('./common');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function cleanItems(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) return { error: ERROR_CODES.INVALID_PARAM, msg: '明细必须是数组' };
  const out = [];
  for (const it of list) {
    const hasCamel = it && it.amountFen !== undefined;
    if (!(it && it.amount_fen !== undefined)) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: hasCamel ? '金额字段用 snake_case 的 amount_fen' : '明细缺少 amount_fen' };
    }
    if (hasCamel) return { error: ERROR_CODES.INVALID_PARAM, msg: '明细金额字段并存，只收 amount_fen（R30）' };
    const v = it.amount_fen;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: '明细 amount_fen 必须是非负整数分（JSON number，字符串不接受）' };
    }
    out.push({ amountFen: v, name: it.name || '' });
  }
  return out;
}

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');
  if (typeof src.month !== 'string' || !MONTH_RE.test(src.month)) return err('month 必须是 YYYY-MM');

  const incomeItems = cleanItems(src.income_items);
  if (incomeItems.error) return incomeItems;
  const expenseItems = cleanItems(src.expense_items);
  if (expenseItems.error) return expenseItems;

  const f = (v, name, allowZero) => {
    if (v === undefined || v === null) return allowZero ? 0 : null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return err(`${name} 必须是非负整数分`);
    return v;
  };
  const directConsumeFen = f(src.direct_consume_fen, 'direct_consume_fen', true);
  if (directConsumeFen && directConsumeFen.error) return directConsumeFen;

  let inventory = { openingFen: 0, purchaseFen: 0, closingFen: 0 };
  if (src.inventory && typeof src.inventory === 'object') {
    for (const k of ['opening_fen', 'purchase_fen', 'closing_fen']) {
      const vv = f(src.inventory[k], 'inventory.' + k, true);
      if (vv.error) return vv;
      inventory[k.replace('_fen', '') + 'Fen'] = vv;
    }
  }

  return {
    error: null,
    shop_id: src.shop_id, month: src.month,
    incomeItems, expenseItems,
    directConsumeFen, inventory,
    archiveOverride: src.archive_override === true,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, cleanItems, MONTH_RE, ERROR_CODES };