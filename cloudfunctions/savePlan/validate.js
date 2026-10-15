// cloudfunctions/savePlan/validate.js —— 入参校验（纯函数）· M2v1.2 多方案存储
//
// 契约（core/10 §4）：savePlan 入参 { shop_id, plan:{sandbox_id?, name, sandbox_type, param_json, is_copy?}, client_request_id }
//   + 软删分支 plan._delete === true（此时只校验 shop_id + sandbox_id，跳过 name/param_json）。
// 🔴 命名口径（本批头号红线）：param_json **一律 snake_case**，且**一个都不能少**（§2.2 的 14 个）。
//   出现 camelCase 键 ⇒ INVALID_PARAM（§九：缺字段 / camelCase 会让整块派生量崩成 null，实测）。
const { ERROR_CODES, indicatorRef } = require('./common');
const { PARAM_KEYS, hasCamelKey } = require('./paramMap');

const SANDBOX_TYPES = ['site_select', 'biz_sim'];

// ===== 🔴🔴 R297 第三轮：字段级**范围**判据 =====
//   为什么必须有：本函数**服务端自算快照**（内联引擎副本），而原实现只判 `typeof number && isFinite`
//   ⇒ 毛利率 150 / -20、负房租、年限 0、变效率 300 全部收下。实测（探针 `_probe_tmp/r297_saveplan_range.js`）：
//     毛利率 65  ⇒ 快照保本 42564.11 元（正常）
//     毛利率 150 ⇒ 快照保本 **18444.45** 元  ← **照样落库成"方案"**，多方案对比页拿它当最优
//   且 `pages/sandbox/index.js::onSavePlan` **不要求先算成功**（只校验方案名）⇒ 老板填 150、计算报错、
//   但"保存"照样成功 ⇒ 静默错账落盘（同族病第四例：单源判据被**另一条入口**绕开，前三条见
//   calcSandbox/validate.js 头注）。
//   ⚠️ 跨云函数包**无法 require**（每个函数是独立上传包）⇒ 这里是与 `calcSandbox/validate.js::checkClean`
//      等价的副本，**由守卫 `tools/check_m2_entry_parity.js` 用同一张用例表双跑、钉死结论一致**（漂移即红）。
//      —— 与 `utils/bizPreset.js::BUILD_DEFAULT_YEARS` 前端副本同一范式。
const MAX_ITEMS = 20;                 // 单类清单上限（与 calcSandbox 同值）
const MAX_BUILD_YEARS = 20;           // 摊销年限上限（与 calcSandbox 同值）
const mkErr = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
const isIntNum = (v) => typeof v === 'number' && Number.isInteger(v);

// 返回 null = 合法；{error,msg} = 非法。副作用：把 build_items 缺失的 years 归一成单源默认。
function checkParamRanges(p, isReverse) {
  if (indicatorRef.CITY_KEYS.indexOf(p.city_tier) < 0) {
    return mkErr(`param_json.city_tier 必须是 ${indicatorRef.CITY_KEYS.join('|')} 之一`);
  }
  if (indicatorRef.BIZ_KEYS.indexOf(p.biz_type) < 0) {
    return mkErr(`param_json.biz_type 必须是 ${indicatorRef.BIZ_KEYS.join('|')} 之一`);
  }

  // ---- 一次性建店投入（key/fen/years）----
  const bi = p.build_items;
  if (bi.length > MAX_ITEMS) return mkErr(`param_json.build_items 最多 ${MAX_ITEMS} 项`);
  const buildSeen = {};
  for (let i = 0; i < bi.length; i++) {
    const it = bi[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) return mkErr(`param_json.build_items[${i}] 必须是对象`);
    if (indicatorRef.BUILD_KEYS.indexOf(it.key) < 0) {
      return mkErr(`param_json.build_items[${i}].key 不在白名单（${indicatorRef.BUILD_KEYS.join('|')}）`);
    }
    if (buildSeen[it.key]) return mkErr(`param_json.build_items 中 key 重复：${it.key}`);
    buildSeen[it.key] = 1;
    if (!isIntNum(it.fen) || it.fen < 0) return mkErr(`param_json.build_items[${i}].fen 必须是非负整数分`);
    // 年限：缺省取该类型的默认年限（单源 indicatorRef，与 calcSandbox normalizeClean 同口径）
    const y = (it.years === undefined || it.years === null) ? indicatorRef.BUILD_DEFAULT_YEARS[it.key] : it.years;
    if (!isIntNum(y) || y < 1 || y > MAX_BUILD_YEARS) {
      return mkErr(`param_json.build_items[${i}].years 必须是 1~${MAX_BUILD_YEARS} 的整数`);
    }
    it.years = y;
  }

  // ---- 每月固定支出（key/fen）----
  const fi = p.fixed_items;
  if (fi.length > MAX_ITEMS) return mkErr(`param_json.fixed_items 最多 ${MAX_ITEMS} 项`);
  const fixedSeen = {};
  for (let i = 0; i < fi.length; i++) {
    const it = fi[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) return mkErr(`param_json.fixed_items[${i}] 必须是对象`);
    if (indicatorRef.FIXED_KEYS.indexOf(it.key) < 0) {
      return mkErr(`param_json.fixed_items[${i}].key 不在白名单（${indicatorRef.FIXED_KEYS.join('|')}）`);
    }
    if (fixedSeen[it.key]) return mkErr(`param_json.fixed_items 中 key 重复：${it.key}（同类应合并成一项，否则指标对照会串）`);
    fixedSeen[it.key] = 1;
    if (!isIntNum(it.fen) || it.fen < 0) return mkErr(`param_json.fixed_items[${i}].fen 必须是非负整数分`);
  }

  // ---- 跟营业额挂钩的费用（key/pct）----
  const vi = p.var_items;
  if (vi.length > MAX_ITEMS) return mkErr(`param_json.var_items 最多 ${MAX_ITEMS} 项`);
  const varSeen = {};
  for (let i = 0; i < vi.length; i++) {
    const it = vi[i];
    if (!it || typeof it !== 'object' || Array.isArray(it)) return mkErr(`param_json.var_items[${i}] 必须是对象`);
    if (indicatorRef.VAR_KEYS.indexOf(it.key) < 0) {
      return mkErr(`param_json.var_items[${i}].key 不在白名单（${indicatorRef.VAR_KEYS.join('|')}）`);
    }
    if (varSeen[it.key]) return mkErr(`param_json.var_items 中 key 重复：${it.key}`);
    varSeen[it.key] = 1;
    const pv = it.pct;
    if (typeof pv !== 'number' || !isFinite(pv) || pv < 0 || pv > 100) {
      return mkErr(`param_json.var_items[${i}].pct 必须是 ∈ [0,100] 的 number（%）`);
    }
  }

  // ---- 标量：毛利率 / 目标利润 / 预计营业额 ----
  const gp = p.gross_margin_pct;
  if (typeof gp !== 'number' || !isFinite(gp) || gp < 0 || gp > 100) {
    return mkErr('param_json.gross_margin_pct 必须是 ∈ [0,100] 的 number（%）');
  }
  if (!isIntNum(p.target_profit_fen) || p.target_profit_fen < 0) {
    return mkErr('param_json.target_profit_fen 必须是非负整数分');
  }
  if (!isIntNum(p.expected_revenue_fen) || p.expected_revenue_fen < 0) {
    return mkErr('param_json.expected_revenue_fen 必须是非负整数分');
  }

  // ---- 反推模式：约束 + 专属入参 ----
  if (isReverse) {
    if (fixedSeen.rent) return mkErr('反推模式下房租由目标租金率导出，请勿在固定支出中重复填写房租');
    if (!isIntNum(p.rev_price_fen) || p.rev_price_fen <= 0) {
      return mkErr('反推模式下 param_json.rev_price_fen（客单价）必须是 > 0 的整数分');
    }
    if (!isIntNum(p.seats) || p.seats <= 0) {
      return mkErr('反推模式下 param_json.seats（座位数）必须是 > 0 的整数');
    }
    if (!isIntNum(p.open_days) || p.open_days < 1 || p.open_days > 31) {
      return mkErr('反推模式下 param_json.open_days（每月营业天数）必须是 1~31 的整数');
    }
    const trr = p.target_rent_rate;
    if (typeof trr !== 'number' || !isFinite(trr) || trr <= 0 || trr > 100) {
      return mkErr('反推模式下 param_json.target_rent_rate（目标租金率）必须是 (0,100] 的 number');
    }
    if (!isIntNum(p.pixel_eff_fen) || p.pixel_eff_fen < 0) {
      return mkErr('param_json.pixel_eff_fen（坪效）必须是非负整数分');
    }
  }

  return null;
}

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

  // ===== 🔴 R297 第三轮：字段级范围判据（原缺失 ⇒ 假快照落库；口径须与 calcSandbox 等价）=====
  const isReverse = mode === 'reverse';
  const rangeBad = checkParamRanges(p, isReverse);
  if (rangeBad) return rangeBad;

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