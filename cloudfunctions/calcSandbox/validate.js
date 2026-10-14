// cloudfunctions/calcSandbox/validate.js —— 入参校验（纯函数）· v2 契约
//
// v2（2026-09-23 李老师拍板）：入参由「4 个固定金额 + 3 个变效率」改为**结构化清单**
//   —— 支持"自选费用类型 + 自填细项"（对齐 M1 的「大类 + 加细项」心智），
//      并补入 一次性建店投入（分摊到月）与 城市层级/业态（用于餐饮指标对照）。
//
// 🔴 白名单来自 common/indicatorRef.js（**单源**），本文件不得自行 hardcode 枚举 ——
//    否则加一项费用要改两处，必然漂移。
//
// 校验一律 fail-closed：类型不对 / 超范围 / key 不在白名单 / key 重复 → 直接拒，绝不静默丢弃。
//
// 🔴🔴 R297 第二轮：字段级判据**只有 `checkClean` 这一份**。
//   此前 `action:'matrix'`（场景矩阵批量测算）分支**完全绕过 validate**，把前端送来的裸 clean
//   直接喂引擎 ⇒ 老板在矩阵页把「毛利率」档位填 150（页面维度是自由文本、只判 isFinite）
//   ⇒ 保本点 46111→18444 元、房租填负数 ⇒ 19444 元，**零报错**（静默错账，方向还是"更好看"）。
//   现在 wire 路径（validateInput）与 clean 路径（validateClean，矩阵分支逐行用）**共用同一套判据**。
const common = require('./common');
const { ERROR_CODES, indicatorRef } = common;

const MAX_ITEMS = 20;                 // 单类清单上限（防构造超长数组撑爆）
const MAX_BUILD_YEARS = 20;           // 摊销年限上限

// ---------- 校验原语（模块级，两个入口共用；返回 err 对象表示不合法）----------
const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
const isErr = (x) => !!x && typeof x === 'object' && x.error;

const fen = (v, name) => (
  (typeof v === 'number' && Number.isInteger(v) && v >= 0)
    ? v
    : err(`${name} 必须是非负整数分（JSON number，字符串不接受）`)
);
const pct = (v, name) => (
  (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100)
    ? v
    : err(`${name} 必须是 ∈ [0,100] 的 number（%）`)
);
const objOf = (v, name) => (
  (v && typeof v === 'object' && !Array.isArray(v)) ? v : err(`${name} 必须是对象`)
);
const arrOf = (v, name, allowMissing) => {
  if (v === undefined || v === null) return allowMissing ? [] : err(`${name} 必填`);
  if (!Array.isArray(v)) return err(`${name} 必须是数组`);
  if (v.length > MAX_ITEMS) return err(`${name} 最多 ${MAX_ITEMS} 项`);
  return v;
};

// ---------- 归一化：把「缺省」补成口径默认值（**单源** indicatorRef）----------
// ⚠️ 只补缺省，**不把非法值改合法** —— 那正是「静默替老板编数」，由 checkClean 负责拒。
function normalizeClean(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const clean = Object.assign({}, c);
  if (clean.mode === undefined || clean.mode === null) clean.mode = 'forward';
  if (Array.isArray(clean.buildItems)) {
    clean.buildItems = clean.buildItems.map((it) => {
      if (!it || typeof it !== 'object') return it;
      const y = (it.years === undefined || it.years === null)
        ? indicatorRef.BUILD_DEFAULT_YEARS[it.key] : it.years;
      return Object.assign({}, it, { years: y });
    });
  }
  if (clean.expectedRevenueFen === undefined || clean.expectedRevenueFen === null) clean.expectedRevenueFen = 0;
  if (clean.validDays === undefined || clean.validDays === null) clean.validDays = 0;
  return clean;
}

// ---------- 🔒 字段级判据唯一实现（clean 形状）----------
// 返回 null = 合法；{error,msg} = 非法。
function checkClean(c, isReverse) {
  if (!c || typeof c !== 'object') return err('clean 必须是对象');

  // ---- 城市层级 / 业态（白名单）----
  if (indicatorRef.CITY_KEYS.indexOf(c.cityTier) < 0) {
    return err(`cityTier 必须是 ${indicatorRef.CITY_KEYS.join('|')} 之一`);
  }
  if (indicatorRef.BIZ_KEYS.indexOf(c.bizType) < 0) {
    return err(`bizType 必须是 ${indicatorRef.BIZ_KEYS.join('|')} 之一`);
  }

  // ---- 一次性建店投入（key/fen/years）----
  const buildItems = arrOf(c.buildItems, 'buildItems', true);
  if (isErr(buildItems)) return buildItems;
  const buildSeen = {};
  for (let i = 0; i < buildItems.length; i++) {
    const it = objOf(buildItems[i], `buildItems[${i}]`);
    if (isErr(it)) return it;
    if (indicatorRef.BUILD_KEYS.indexOf(it.key) < 0) {
      return err(`buildItems[${i}].key 不在白名单（${indicatorRef.BUILD_KEYS.join('|')}）`);
    }
    if (buildSeen[it.key]) return err(`buildItems 中 key 重复：${it.key}`);
    buildSeen[it.key] = 1;
    const f = fen(it.fen, `buildItems[${i}].fen`);
    if (isErr(f)) return f;
    const years = it.years;
    if (typeof years !== 'number' || !Number.isInteger(years) || years < 1 || years > MAX_BUILD_YEARS) {
      return err(`buildItems[${i}].years 必须是 1~${MAX_BUILD_YEARS} 的整数`);
    }
  }

  // ---- 每月固定支出（key/fen）----
  // ⚠️ round114 起**不再要求 fixedItems 非空**（实测坐实的真缺陷修复）：
  //    M2 页面在用户"一个字没填"时也要能拿到 bands_preview（行业参考区间）与 amount_preview
  //    （参考金额起点）—— 这两者只依赖 业态 × 城市（× 预计营业额），与固定支出无关。
  //    旧校验会把空表单直接拒成 INVALID_PARAM ⇒ 前端 catch ⇒ 参考区间**根本没显示**。
  //    "没填够"属于**页面语义**（前端 hasFixed 控制不展示测算结果），不是入参非法。
  const fixedItems = arrOf(c.fixedItems, 'fixedItems', false);
  if (isErr(fixedItems)) return fixedItems;
  const fixedSeen = {};
  for (let i = 0; i < fixedItems.length; i++) {
    const it = objOf(fixedItems[i], `fixedItems[${i}]`);
    if (isErr(it)) return it;
    if (indicatorRef.FIXED_KEYS.indexOf(it.key) < 0) {
      return err(`fixedItems[${i}].key 不在白名单（${indicatorRef.FIXED_KEYS.join('|')}）`);
    }
    if (fixedSeen[it.key]) return err(`fixedItems 中 key 重复：${it.key}（同类应合并成一项，否则指标对照会串）`);
    fixedSeen[it.key] = 1;
    const f = fen(it.fen, `fixedItems[${i}].fen`);
    if (isErr(f)) return f;
  }

  // ---- 跟营业额挂钩的费用（key/pct）----
  const varItems = arrOf(c.varItems, 'varItems', true);
  if (isErr(varItems)) return varItems;
  const varSeen = {};
  for (let i = 0; i < varItems.length; i++) {
    const it = objOf(varItems[i], `varItems[${i}]`);
    if (isErr(it)) return it;
    if (indicatorRef.VAR_KEYS.indexOf(it.key) < 0) {
      return err(`varItems[${i}].key 不在白名单（${indicatorRef.VAR_KEYS.join('|')}）`);
    }
    if (varSeen[it.key]) return err(`varItems 中 key 重复：${it.key}`);
    varSeen[it.key] = 1;
    const p = pct(it.pct, `varItems[${i}].pct`);
    if (isErr(p)) return p;
  }

  // ---- 菜品毛利率（%）与目标月利润（分）----
  const g = pct(c.grossMarginPct, 'grossMarginPct');
  if (isErr(g)) return g;
  const t = fen(c.targetProfitFen, 'targetProfitFen');
  if (isErr(t)) return t;
  const e = fen(c.expectedRevenueFen, 'expectedRevenueFen');
  if (isErr(e)) return e;

  // ---- 正向：营业天数（validDays，选填 1~31；0/null/undefined = 没填 ⇒ service 回退 30）----
  // 🔴 #1（P0-1，round272）：与反向 openDays 口径对齐，消除「正向÷30 / 反向÷openDays」不一致。
  // 🔴 round273 修正：0 一律视为「没填」（哨兵值），**真填了**却越界才报契约错。
  if (!isReverse) {
    const vd = c.validDays;
    if (vd !== undefined && vd !== null && vd !== 0) {
      if (typeof vd !== 'number' || !Number.isInteger(vd) || vd < 1 || vd > 31) {
        return err('validDays（每月营业天数）必须是 1~31 的整数');
      }
    }
  }

  // ---- 反推约束 + 反推入参（M2v1.1 · 全部 fail-closed）----
  // 🔴 核心口径：反推模式下房租由目标租金率导出，fixedItems 不得含 rent（重复计租 ⇒ R 虚高 25%）。
  if (isReverse && fixedSeen.rent) {
    return err('反推模式下房租由目标租金率导出，请勿在固定支出中重复填写房租');
  }
  if (isReverse) {
    if (typeof c.rev_price_fen !== 'number' || !Number.isInteger(c.rev_price_fen) || c.rev_price_fen <= 0) {
      return err('反推模式下 rev_price_fen（客单价）必须是 > 0 的整数分');
    }
    if (typeof c.seats !== 'number' || !Number.isInteger(c.seats) || c.seats <= 0) {
      return err('反推模式下 seats（座位数）必须是 > 0 的整数');
    }
    if (typeof c.open_days !== 'number' || !Number.isInteger(c.open_days) || c.open_days < 1 || c.open_days > 31) {
      return err('反推模式下 open_days（每月营业天数）必须是 1~31 的整数');
    }
    const trr = c.target_rent_rate;
    if (typeof trr !== 'number' || !isFinite(trr) || trr <= 0 || trr > 100) {
      return err('反推模式下 target_rent_rate（目标租金率）必须是 (0,100] 的 number');
    }
    const pef = (c.pixel_eff_fen === undefined || c.pixel_eff_fen === null) ? 0 : c.pixel_eff_fen;
    if (typeof pef !== 'number' || !Number.isInteger(pef) || pef < 0) {
      return err('pixel_eff_fen（坪效）必须是非负整数分');
    }
  }

  return null;
}

// ---------- 入口二：clean 形状直接校验（矩阵分支逐行用）----------
// 出参与 validateInput 同形：{ error: null, clean } / { error, msg }
function validateClean(rawClean) {
  const clean = normalizeClean(rawClean);
  if (clean.mode !== 'forward' && clean.mode !== 'reverse') {
    return err(`mode 必须是 'forward' 或 'reverse'（当前值：${JSON.stringify(clean.mode)}）`);
  }
  const bad = checkClean(clean, clean.mode === 'reverse');
  if (bad) return bad;
  return { error: null, clean };
}

// ---------- 入口一：wire（snake_case）→ 归一化 → 同一套 checkClean ----------
function validateInput(event) {
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  // ---- mode：正算 / 反推（M2v1.1）。缺省 / 'forward' ⇒ 正算 ----
  const modeRaw = (src.mode === undefined || src.mode === null) ? 'forward' : src.mode;
  if (modeRaw !== 'forward' && modeRaw !== 'reverse') {
    return err(`mode 必须是 'forward' 或 'reverse'（当前值：${JSON.stringify(modeRaw)}）`);
  }
  const isReverse = modeRaw === 'reverse';

  // ---- wire → clean 形状（数值一律原样带过去，判据交给 checkClean 单源）----
  const clean = normalizeClean({
    mode: modeRaw,
    cityTier: src.city_tier,
    bizType: src.biz_type,
    buildItems: Array.isArray(src.build_items) ? src.build_items : (src.build_items === undefined || src.build_items === null ? [] : src.build_items),
    fixedItems: src.fixed_items,
    varItems: Array.isArray(src.var_items) ? src.var_items : (src.var_items === undefined || src.var_items === null ? [] : src.var_items),
    grossMarginPct: src.gross_margin_pct,
    targetProfitFen: src.target_profit_fen,
    expectedRevenueFen: src.expected_revenue_fen,
    validDays: src.valid_days,
    rev_price_fen: isReverse ? src.rev_price_fen : 0,
    seats: isReverse ? src.seats : 0,
    open_days: isReverse ? src.open_days : 0,
    target_rent_rate: isReverse ? src.target_rent_rate : 0,
    pixel_eff_fen: isReverse ? src.pixel_eff_fen : 0,
  });

  const bad = checkClean(clean, isReverse);
  if (bad) return bad;

  return {
    error: null,
    shop_id: src.shop_id,
    clean,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, validateClean, ERROR_CODES };
