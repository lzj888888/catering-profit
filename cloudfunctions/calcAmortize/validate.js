// cloudfunctions/calcAmortize/validate.js —— 入参校验（纯函数，无云依赖，可单测）。
//
// 从批次 1 沿用的纪律（R27 裁决，不留口子）：
//   · 金额/键字段必须是 JSON number（整数）；字符串一律 INVALID_PARAM，错误信息点名「字段名」。
//   · 资产数据主力来自 DB 台账，统一经 docToAsset 校验（见下方）；前端 wire 入参**不再接受 assets**
//     （R34：删除死代码入口，避免「校验了但不用」的潜在越权面，单一真相源 = 服务端台账）。
//
// 月份口径：YYYY-MM，month ∈ [01,12]，与批次 0 时间工具 toMonth 输出格式一致。

const { ERROR_CODES } = require('./common');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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

  // ⚠️ 资产一律从服务端台账读取（index.js 经 da.list + docToAsset），wire 入参不接收 assets。
  //    历史「可选 assets 入口」已删除（R34）：它既不被使用，又构成潜在越权面，删除以守单一真相源。

  return {
    error: null,
    shop_id,
    month,
    input: {
      month,
      client_request_id: event.client_request_id || '',
    },
  };
}

// DB 台账文档 → Service 干净资产对象。
// 与入参校验同纪律（R27）：内部可信源也要守结构合法性（R32）——台账是唯一真相源，
// 脏字段会静默产出错账；本项目对涉金额缺陷一律要求"响亮失败"。
// 复用本文件的 MONTH_RE 与 ERROR_CODES，错误信息沿用「点名 asset_id + 字段」风格。
function docToAsset(doc) {
  const id = doc.asset_id || doc.id;
  // R36：asset_id 必须是非空字符串（删 cleanAssets 时一并丢失的守卫，第 9 轮补回）。
  //       所有错误信息都以「点名 asset_id」为前提，缺失/非字符串会让错误信息点名一个不存在的 id。
  if (typeof id !== 'string' || !id) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: `台账资产缺少 asset_id（必须是非空字符串）` };
  }
  // R35：total_value 必须严格是 JSON number（整数分），禁止 Number() 强转。
  //      Number(null/""/true/[]) 会静默变成 0/1 等非负整数放行，把脏值当「0 元资产」计算 → 静默错账。
  const total = doc.total_value;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: `台账资产 asset_id=${id} 的 total_value 必须是「分」非负整数（JSON number，字符串不接受）` };
  }
  const startMonth = doc.start_month;
  if (typeof startMonth !== 'string' || !MONTH_RE.test(startMonth)) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: `台账资产 asset_id=${id} 的 start_month 必须是 YYYY-MM` };
  }
  // ⚠️ 必须用 typeof 严格判型，不能用 Number() 强转：字符串 "36" 经 Number() 会变 36 放行，
  // 但在引擎里 start + "36" - 1 会触发字符串拼接（start 是数字），区间算飞 → 静默错账（R32 复现）。
  if (typeof doc.total_months !== 'number' || !Number.isInteger(doc.total_months) || doc.total_months < 1) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: `台账资产 asset_id=${id} 的 total_months 必须是 ≥1 的整数（JSON number，字符串不接受）` };
  }
  const totalMonths = doc.total_months;
  const terminateMonth = doc.terminate_month || '';
  if (terminateMonth !== '' && (typeof terminateMonth !== 'string' || !MONTH_RE.test(terminateMonth))) {
    throw { code: ERROR_CODES.INVALID_PARAM, msg: `台账资产 asset_id=${id} 的 terminate_month 必须是 YYYY-MM 或留空` };
  }
  return {
    asset_id: id,
    name: doc.name || '',
    total_value: total,
    start_month: startMonth,
    total_months: totalMonths,
    terminate_month: terminateMonth,
  };
}

module.exports = { validateInput, MONTH_RE, docToAsset, ERROR_CODES };
