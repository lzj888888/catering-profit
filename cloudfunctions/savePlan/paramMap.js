// cloudfunctions/savePlan/paramMap.js —— 存库 `param_json`(snake_case) → 引擎入参 `clean`（唯一转换处）
//
// 🔴 铁律（开发规范 v1.2 §4.3 / 本批 §2.3）：
//   1. `param_json` 一律 `snake_case`（14 字段一个不能少）；
//   2. `clean` 是**既有实现**的混合命名（`cityTier`/`bizType`/`buildItems`… 为 camel，
//      `rev_price_fen`/`seats`/`open_days`/`target_rent_rate`/`pixel_eff_fen` 为 snake）——不改引擎，只在这里转；
//   3. 本表是**唯一**转换处，只在服务端做；前端不得做这个转换。
// 表为模块级常量数组，双路径通用（正算/反推），缺字段场景（自测反例 2）由调用方传 `drop` 模拟。
const ERROR_MSG_PREFIX = '[paramMap]';

// `param_json`(snake) → 引擎入参 `clean` 的**单向映射表**（一个不能少 —— 漏一个反例当场红）。
const PARAM_TO_CLEAN = [
  ['mode', 'mode'],
  ['city_tier', 'cityTier'],
  ['biz_type', 'bizType'],
  ['build_items', 'buildItems'],
  ['fixed_items', 'fixedItems'],
  ['var_items', 'varItems'],
  ['gross_margin_pct', 'grossMarginPct'],
  ['target_profit_fen', 'targetProfitFen'],
  ['expected_revenue_fen', 'expectedRevenueFen'],
  ['rev_price_fen', 'rev_price_fen'],
  ['seats', 'seats'],
  ['open_days', 'open_days'],
  ['target_rent_rate', 'target_rent_rate'],
  ['pixel_eff_fen', 'pixel_eff_fen'],
];

// 规范 §2.2 的 14 个字段（snake），供 validate 必填校验复用。
const PARAM_KEYS = PARAM_TO_CLEAN.map((x) => x[0]);

// 🔴 命名口径校验用：`param_json` 里出现这些 camelCase 键 ⇒ INVALID_PARAM（本批 §9）。
//   引擎入参的 camel 名（grossMarginPct 等）与固定 snake 名（rev_price_fen 等）都在禁止列表里，
//   确保存库面**零 camelCase**。
const FORBIDDEN_CAMEL_KEYS = [
  'cityTier', 'bizType', 'buildItems', 'fixedItems', 'varItems',
  'grossMarginPct', 'targetProfitFen', 'expectedRevenueFen',
];

/**
 * 转换：`param_json`(snake) → 引擎入参 `clean`。
 * @param {object} p 存库形态的 param_json（snake，14 字段）
 * @param {Array<string>} [drop] 可选：模拟缺字段（仅自测反例 2 用）
 * @returns {object} clean（混合命名的引擎入参）
 */
function paramToClean(p, drop) {
  const c = {};
  for (const [snake, clean] of PARAM_TO_CLEAN) {
    if (drop && drop.indexOf(snake) >= 0) continue;
    c[clean] = p ? p[snake] : undefined;
  }
  return c;
}

/**
 * 命名口径校验：`param_json` 是否含禁区 camelCase 键。
 * @returns {{ok:boolean, bad?:string}}
 */
function hasCamelKey(p) {
  if (!p || typeof p !== 'object') return { ok: false };
  for (const k of Object.keys(p)) {
    if (FORBIDDEN_CAMEL_KEYS.indexOf(k) >= 0) {
      return { ok: false, bad: k };
    }
  }
  return { ok: true };
}

module.exports = { PARAM_TO_CLEAN, PARAM_KEYS, FORBIDDEN_CAMEL_KEYS, paramToClean, hasCamelKey };