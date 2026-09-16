// utils/validate.js —— 批次 7 · 表单校验工具（前端体验层）
//
// ⚠️ 铁律（批次 7 §2.1/§2.6）：**前端校验只为体验，云函数必须再校验一次**——前端校验不是安全边界。
// ⚠️ 错误码一律用全局标准码（INVALID_PARAM 等），错误文案从 i18n/terms.js 映射（terms.exp 函数词条），
//   禁止自定义错误码与硬编码文案。
//
// 返回约定：{ ok:true } 或 { ok:false, code:'INVALID_PARAM', msg:<i18n 文案> }
const { msgOf, TERMS } = require('../miniprogram/i18n/terms.js');
const EX = TERMS.exp;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(msg) {
  return { ok: false, code: 'INVALID_PARAM', msg: msg || msgOf('INVALID_PARAM') };
}

/** 必填项：非空字符串/非 null/非 undefined */
function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fail(EX.required(label));
  }
  return { ok: true };
}

/** 金额（元，字符串/数字）：非负有限数 */
function money(value, label) {
  const n = Number(value);
  if (value === '' || value === undefined || value === null || !isFinite(n)) {
    return fail(EX.moneyReq(label));
  }
  if (n < 0) return fail(EX.moneyNeg(label));
  return { ok: true };
}

/** 百分比：非负且 <= 100 */
function percent(value, label) {
  const n = Number(value);
  if (!isFinite(n)) return fail(EX.moneyReq(label));
  if (n < 0) return fail(EX.moneyNeg(label));
  if (n > 100) return fail(EX.pctMax100(label));
  return { ok: true };
}

/** 月份 YYYY-MM */
function month(value, label) {
  if (!MONTH_RE.test(String(value || ''))) return fail(EX.monthFormat(label));
  return { ok: true };
}

/** 日期 YYYY-MM-DD */
function date(value, label) {
  if (!DATE_RE.test(String(value || ''))) return fail(EX.dateFormat(label));
  return { ok: true };
}

/** 正整数（份数/月数等） */
function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fail(EX.positiveInt(label));
  return { ok: true };
}

/** 批量校验：任意失败即返回首个错误 */
function anyChecks(checks) {
  for (const c of checks) {
    if (c && c.ok === false) return c;
  }
  return { ok: true };
}

module.exports = { required, money, percent, month, date, positiveInt, anyChecks, MONTH_RE, DATE_RE };