// cloudfunctions/savePlan/validate.js —— 入参校验（纯函数）· M2v1.2 多方案存储
//
// 契约（core/10 §4）：savePlan 入参 { shop_id, plan:{sandbox_id?, name, sandbox_type, param_json, is_copy?}, client_request_id }
//   + 软删分支 plan._delete === true（此时只校验 shop_id + sandbox_id，跳过 name/param_json）。
// 🔴 命名口径（本批头号红线）：param_json **一律 snake_case**，且**一个都不能少**（§2.2 的 14 个）。
//   出现 camelCase 键 ⇒ INVALID_PARAM（§九：缺字段 / camelCase 会让整块派生量崩成 null，实测）。
const { ERROR_CODES } = require('./common');
const { PARAM_KEYS, hasCamelKey } = require('./paramMap');

const SANDBOX_TYPES = ['site_select', 'biz_sim'];

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const plan = src.plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return err('plan 必须是对象');

  // ===== 软删分支：只认 shop_id + sandbox_id =====
  if (plan._delete === true) {
    if (typeof plan.sandbox_id !== 'string' || !plan.sandbox_id) {
      return err('删除方案需提供 plan.sandbox_id');
    }
    return {
      error: null,
      shop_id: src.shop_id,
      plan: { _delete: true, sandbox_id: plan.sandbox_id, sandbox_type: '', name: '', param_json: null, is_copy: false },
      input: { client_request_id: src.client_request_id || '' },
    };
  }

  // ===== sandbox_type（必填：选址 / 经营推演）=====
  const st = plan.sandbox_type;
  if (SANDBOX_TYPES.indexOf(st) < 0) {
    return err(`plan.sandbox_type 必须是 ${SANDBOX_TYPES.join('|')} 之一（当前：${JSON.stringify(st)}）`);
  }

  // ===== name（必填，保存/复制都需要名字）=====
  if (typeof plan.name !== 'string' || !plan.name.trim()) return err('plan.name 必须是非空字符串');

  // ===== param_json：形状 + 命名口径 + 必填 14 字段 =====
  const p = plan.param_json;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return err('plan.param_json 必须是对象');
  const camelCheck = hasCamelKey(p);
  if (!camelCheck.ok) {
    return err(`param_json 字段命名须 snake_case（出现 camelCase 键：${camelCheck.bad}）`);
  }
  const missing = PARAM_KEYS.filter((k) => !(k in p));
  if (missing.length) {
    return err(`param_json 缺少必需字段：${missing.join(',')}（须全量 14 个 snake_case 字段）`);
  }

  // ===== 字段级类型校验（结构性，不重算引擎 —— 引擎仍会自行 fail-closed）=====
  const mode = p.mode;
  if (mode !== 'forward' && mode !== 'reverse') return err(`param_json.mode 必须是 'forward' 或 'reverse'`);
  const isArr = (v) => Array.isArray(v);
  if (!isArr(p.build_items)) return err('param_json.build_items 必须是数组');
  if (!isArr(p.fixed_items)) return err('param_json.fixed_items 必须是数组');
  if (!isArr(p.var_items)) return err('param_json.var_items 必须是数组');
  const num = (k) => (typeof p[k] === 'number' && isFinite(p[k]));
  if (!num('gross_margin_pct')) return err('param_json.gross_margin_pct 必须是 number');
  if (!num('target_profit_fen')) return err('param_json.target_profit_fen 必须是 number');
  if (!num('expected_revenue_fen')) return err('param_json.expected_revenue_fen 必须是 number');
  if (!num('rev_price_fen')) return err('param_json.rev_price_fen 必须是 number');
  if (!num('seats')) return err('param_json.seats 必须是 number');
  if (!num('open_days')) return err('param_json.open_days 必须是 number');
  if (!num('target_rent_rate')) return err('param_json.target_rent_rate 必须是 number');
  if (!num('pixel_eff_fen')) return err('param_json.pixel_eff_fen 必须是 number');

  // 深拷贝一份 storage 形态（避免调用方改引用污染）
  const paramJson = Object.assign({}, p, {
    build_items: (p.build_items || []).slice(),
    fixed_items: (p.fixed_items || []).slice(),
    var_items: (p.var_items || []).slice(),
  });

  return {
    error: null,
    shop_id: src.shop_id,
    plan: {
      sandbox_id: (typeof plan.sandbox_id === 'string' && plan.sandbox_id) ? plan.sandbox_id : '',
      name: plan.name.trim(),
      sandbox_type: st,
      param_json: paramJson,
      is_copy: plan.is_copy === true,
      _delete: false,
    },
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };