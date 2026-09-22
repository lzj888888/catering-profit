// cloudfunctions/saveLedger/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, month, income_items[{category,name,amount_fen?,sub_items?}], expense_items[...], direct_consume_fen, inventory?, archive_override?, client_request_id }。
//
// A2（批次 8）：明细支持**二级细项** sub_items。
//   · 形态 A（新）：{ category, name, sub_items: [{ sub_item, amount_fen }] } —— **大类金额由云函数汇总**（Σ sub_items.amount_fen），
//     前端传的 amount_fen 不采信（计算下沉铁律）；sub_items 可为空数组（等价 0 元）。
//   · 形态 B（旧）：{ amount_fen, name } —— 兼容旧调用，无细项，amount_fen 直接用。
// 金额一律「分」JSON number（R27）；sub_item 字符串 ≤20 字、允许为空。
const { ERROR_CODES } = require('./common');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const SUB_ITEM_MAX_LEN = 20;

function isFenNonNeg(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * 校验明细数组（收入/费用共用）。
 * 输出（内部 camelCase，供双利润引擎直接用 amountFen）：
 *   [{ category, name, amountFen, subItems: [{ subItem, amountFen }] }]
 *   amountFen = 大类金额：有 sub_items 时 = Σ 细项（云函数汇总，不采信前端大类值）；否则 = 前端 amount_fen。
 */
function cleanItems(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) return { error: ERROR_CODES.INVALID_PARAM, msg: '明细必须是数组' };
  const out = [];
  for (const it of list) {
    const hasCamel = it && it.amountFen !== undefined;
    if (!(it && typeof it === 'object')) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: '明细必须是对象' };
    }
    if (hasCamel) return { error: ERROR_CODES.INVALID_PARAM, msg: '金额字段用 snake_case 的 amount_fen（R30）' };

    const category = (typeof it.category === 'string' && it.category) ? it.category : '';
    const name = (typeof it.name === 'string') ? it.name : '';

    // —— 细项（A2）——
    let subItems = [];
    if (it.sub_items !== undefined && it.sub_items !== null) {
      if (!Array.isArray(it.sub_items)) return { error: ERROR_CODES.INVALID_PARAM, msg: 'sub_items 必须是数组' };
      let sum = 0;
      for (const si of it.sub_items) {
        if (!si || typeof si !== 'object') return { error: ERROR_CODES.INVALID_PARAM, msg: 'sub_items 每项必须是对象' };
        const subItem = (typeof si.sub_item === 'string') ? si.sub_item.trim() : '';
        if (subItem.length > SUB_ITEM_MAX_LEN) return { error: ERROR_CODES.INVALID_PARAM, msg: `sub_item 长度不能超过 ${SUB_ITEM_MAX_LEN} 字` };
        const amt = si.amount_fen;
        if (!isFenNonNeg(amt)) return { error: ERROR_CODES.INVALID_PARAM, msg: 'sub_items 的 amount_fen 必须是非负整数分（JSON number）' };
        subItems.push({ subItem, amountFen: amt });
        sum += amt;
      }
      out.push({ category, name, amountFen: sum, subItems }); // 云函数汇总大类金额（不采信前端）
      continue;
    }

    // —— 旧形态：单行大类金额 ——
    if (!(it && it.amount_fen !== undefined)) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: '明细缺少 amount_fen 或 sub_items' };
    }
    const v = it.amount_fen;
    if (!isFenNonNeg(v)) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: '明细 amount_fen 必须是非负整数分（JSON number，字符串不接受）' };
    }
    out.push({ category, name, amountFen: v, subItems: [] });
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

  // round107：`lump_sum_fen` **入参已退休** —— 一次性投入改由台账（shop_amortize 里 mode='lump' 的行）
  //   在 saveLedger/index.js §5 服务端求和。前端不再有机会漏传/误传这个值，
  //   于是 round106 那条「缺省 = 不动」的可选入参规则连同它的两个坑一起消失。
  //   ⚠️ 别把这条规则照搬回来：少一个「前端可传、缺省语义微妙」的金额入参，就少一类静默清零。

  // round103：契约里 `inventory?` 是**可选**入参（`core/10_云函数清单与接口契约.md` 第 43 行）
  //   ⇒ 缺省语义 = **本次不动库存**，返回 null 交 Controller 沿用库内现值。
  //   🔴 原实现缺省时返回全 0 对象，而 Controller 无条件 `inventory: v.inventory` 覆盖落库
  //   ⇒ 从月度录入页保存一次就把盘点**静默清零**（实跑复现：真实消耗 23,000 → 0，error 为 null）。
  let inventory = null;
  if (src.inventory && typeof src.inventory === 'object') {
    inventory = { openingFen: 0, purchaseFen: 0, closingFen: 0 };
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

module.exports = { validateInput, cleanItems, MONTH_RE, SUB_ITEM_MAX_LEN, ERROR_CODES };