// utils/gradeGate.js —— 批次 F 数据可信度甲级门禁（纯校验 · 不落库）
//
// 依据 v1.4 §5.2 三级门禁之「甲级（前置门禁）」：
//   ① 通道连通（rows 非空、无异常）
//   ② Schema 校验（字段名/类型/数值范围）
//   ③ 关键指标非空（shop_id / biz_date / amount）
// 🔴 不通过直接阻断（fail-closed），不进入落库；失败清单可直接喂前端显示。

// external_sales_daily 的 schema（v1.4 §6.1 + PLAN §四-bis 账单级取值）
const SALES_SCHEMA = {
  fields: {
    shop_id: { type: 'string', required: true },
    biz_date: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    external_ref_id: { type: 'string', required: true },
    dish_key: { type: 'string', required: true },
    qty: { type: 'number', required: true, integer: true, min: 0 },
    amount: { type: 'number', required: true, integer: true },
    platform: { type: 'string', required: true, enum: ['taobao', 'meituan', 'eleme', 'other'] },
    source: { type: 'string', required: true, enum: ['oauth', 'excel', 'manual'] },
    created_at: { type: 'number', required: true, integer: true },
  },
};

/**
 * 甲级门禁校验。
 * @param {{platform:string, header:string[], rows:Array, totals:object, shopId?:string}} input
 * @param {object} schema external_sales_daily schema（默认 SALES_SCHEMA）
 * @returns {{pass:boolean, level:'A', failures:Array<{code:string, field:string, msg:string}>}}
 */
function checkGradeA(input, schema) {
  const s = schema || SALES_SCHEMA;
  const fields = s.fields || {};
  const failures = [];
  const { platform, rows, totals } = input || {};
  const rowList = Array.isArray(rows) ? rows : [];

  // ===== ① 通道连通：rows 非空、无异常 =====
  if (rowList.length === 0) {
    failures.push({ code: 'CHANNEL_EMPTY', field: 'rows', msg: '未解析到任何数据行' });
  }
  if (!totals || totals.amountFen == null || !Number.isFinite(totals.amountFen)) {
    failures.push({ code: 'CHANNEL_TOTAL_MISSING', field: 'totals.amountFen', msg: '合计金额缺失或非法' });
  }

  // ===== ② Schema 校验：platform 合法 + 每行字段类型/数值范围 =====
  const platformEnum = (fields.platform && fields.platform.enum) || [];
  if (!platform || platformEnum.indexOf(platform) < 0) {
    failures.push({ code: 'SCHEMA_PLATFORM', field: 'platform', msg: `平台未知：${platform}` });
  }
  for (let i = 0; i < rowList.length; i++) {
    const r = rowList[i] || {};
    if (typeof r.bizDate !== 'string' || !(fields.biz_date ? fields.biz_date.pattern.test(r.bizDate) : /^\d{4}-\d{2}-\d{2}$/.test(r.bizDate))) {
      failures.push({ code: 'SCHEMA_BIZDATE', field: `rows[${i}].bizDate`, msg: `账单日期格式错误：${r.bizDate}` });
    }
    if (typeof r.amountFen !== 'number' || !Number.isInteger(r.amountFen)) {
      failures.push({ code: 'SCHEMA_AMOUNT', field: `rows[${i}].amountFen`, msg: `金额不是整数分：${r.amountFen}` });
    }
    if (typeof r.qty !== 'number' || !Number.isInteger(r.qty) || r.qty < (fields.qty ? fields.qty.min : 0)) {
      failures.push({ code: 'SCHEMA_QTY', field: `rows[${i}].qty`, msg: `订单数非法：${r.qty}` });
    }
  }

  // ===== ③ 关键指标非空：shop_id / biz_date / amount =====
  if (input.shopId === undefined || input.shopId === null || input.shopId === '') {
    failures.push({ code: 'REQUIRED_SHOP_ID', field: 'shop_id', msg: '门店 ID 为空' });
  }
  for (let i = 0; i < rowList.length; i++) {
    if (!rowList[i] || rowList[i].bizDate == null || rowList[i].bizDate === '') {
      failures.push({ code: 'REQUIRED_BIZDATE', field: `rows[${i}].bizDate`, msg: '账单日期为空' });
    }
  }
  if (!totals || totals.amountFen == null) {
    failures.push({ code: 'REQUIRED_AMOUNT', field: 'amount', msg: '金额为空' });
  }

  return { pass: failures.length === 0, level: 'A', failures };
}

module.exports = { checkGradeA, SALES_SCHEMA };
