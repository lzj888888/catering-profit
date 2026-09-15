// cloudfunctions/calcAmortize/validate.js —— 入参校验（纯函数，无云依赖，可单测）。
//
// 从批次 1 沿用的纪律（R27 裁决，不留口子）：
//   · 金额/键字段必须是 JSON number（整数）；字符串一律 INVALID_PARAM，错误信息点名「字段名」。
//   · 若前端误传 asset 数组（本批数据主力来自 DB 台账），其 total_value 等金额字段同样按此纪律校验。
// service.js 内部对 DB 台账资产也做同规则防御（见 index.js 的 docToAsset），双保险。
//
// 月份口径：YYYY-MM，month ∈ [01,12]，与批次 0 时间工具 toMonth 输出格式一致。

const { ERROR_CODES } = require('./common');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// 金额/键字段校验器：必须是 JSON number 的非负整数；undefined/null 按缺省回落；非 number → INVALID_PARAM
function f(v, name) {
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    return { error: ERROR_CODES.INVALID_PARAM, msg: `${name} 必须是「分」非负整数（JSON number，字符串不接受）` };
  }
  return v;
}

// 校验可选的前端 assets 数组（当传了时）。service 以隔离的干净对象喂入，不信任原始引用。
function cleanAssets(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    return { error: ERROR_CODES.INVALID_PARAM, msg: 'assets 必须是数组' };
  }
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== 'object') {
      return { error: ERROR_CODES.INVALID_PARAM, msg: 'assets 数组元素必须是对象' };
    }
    const id = a.asset_id;
    if (typeof id !== 'string' || !id) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: 'assets[].asset_id 必须是非空字符串' };
    }
    // total_value 金额校验：非 number 字符串 → INVALID_PARAM（R27 纪律）
    const total = f(a.total_value, `assets[].asset_id=${id} 的 total_value`);
    if (typeof total === 'object' && total.error) return total;
    const start = a.start_month;
    if (typeof start !== 'string' || !MONTH_RE.test(start)) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: `assets[].asset_id=${id} 的 start_month 必须是 YYYY-MM` };
    }
    const totalMonths = a.total_months;
    if (typeof totalMonths !== 'number' || !Number.isInteger(totalMonths) || totalMonths <= 0) {
      return { error: ERROR_CODES.INVALID_PARAM, msg: `assets[].asset_id=${id} 的 total_months 必须是正整数（JSON number）` };
    }
    let terminate_month = '';
    if (a.terminate_month !== undefined && a.terminate_month !== null && a.terminate_month !== '') {
      if (typeof a.terminate_month !== 'string' || !MONTH_RE.test(a.terminate_month)) {
        return { error: ERROR_CODES.INVALID_PARAM, msg: `assets[].asset_id=${id} 的 terminate_month 必须是 YYYY-MM 或留空` };
      }
      terminate_month = a.terminate_month;
    }
    out.push({
      asset_id: id,
      name: typeof a.name === 'string' ? a.name : '',
      total_value: total,
      start_month: start,
      total_months: totalMonths,
      terminate_month,
    });
  }
  return out;
}

function validateInput(event) {
  const err = (msg) => ({ error: ERROR_CODES.INVALID_PARAM, msg });
  if (!event || typeof event !== 'object') return err('event 必须是对象');

  // shop_id：本批 Controller 已过 assertShopOwner；这里仍校验非空非 string 即拒（双保险，错误点名）
  const shop_id = event.shop_id;
  if (typeof shop_id !== 'string' || !shop_id) {
    return err('shop_id 必须是非空字符串');
  }

  // month：YYYY-MM 且月合法
  const month = event.month;
  if (typeof month !== 'string' || !MONTH_RE.test(month)) {
    return err('month 必须是 YYYY-MM（如 2026-01）');
  }

  // 可选 assets（前端手动喂资产数组场景）；数据主力来自 DB 台账，见 index.js
  const assets = cleanAssets(event.assets);
  if (assets.error) return assets;

  return {
    error: null,
    shop_id,
    month,
    assets,
    input: {
      month,
      client_request_id: event.client_request_id || '',
    },
  };
}

module.exports = { validateInput, cleanAssets, MONTH_RE };