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
const common = require('./common');
const { ERROR_CODES, indicatorRef } = common;

const MAX_ITEMS = 20;                 // 单类清单上限（防构造超长数组撑爆）
const MAX_BUILD_YEARS = 20;           // 摊销年限上限

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  // ---- 城市层级 / 业态（白名单）----
  const cityTier = src.city_tier;
  if (indicatorRef.CITY_KEYS.indexOf(cityTier) < 0) {
    return err(`city_tier 必须是 ${indicatorRef.CITY_KEYS.join('|')} 之一`);
  }
  const bizType = src.biz_type;
  if (indicatorRef.BIZ_KEYS.indexOf(bizType) < 0) {
    return err(`biz_type 必须是 ${indicatorRef.BIZ_KEYS.join('|')} 之一`);
  }

  // ---- 金额：分非负整数（JSON number，不收字符串 —— R27）----
  const fen = (v, name) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return err(`${name} 必须是非负整数分（JSON number，字符串不接受）`);
    }
    return v;
  };
  const pct = (v, name) => {
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) {
      return err(`${name} 必须是 ∈ [0,100] 的 number（%）`);
    }
    return v;
  };
  const objOf = (v, name) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return err(`${name} 必须是对象`);
    return v;
  };
  const arrOf = (v, name, allowMissing) => {
    if (v === undefined || v === null) return allowMissing ? [] : err(`${name} 必填`);
    if (!Array.isArray(v)) return err(`${name} 必须是数组`);
    if (v.length > MAX_ITEMS) return err(`${name} 最多 ${MAX_ITEMS} 项`);
    return v;
  };

  // ---- 一次性建店投入（key/fen/years）----
  const build_items = arrOf(src.build_items, 'build_items', true);
  if (build_items && build_items.error) return build_items;
  const buildItems = [];
  const buildSeen = {};
  for (let i = 0; i < build_items.length; i++) {
    const it = objOf(build_items[i], `build_items[${i}]`);
    if (it.error) return it;
    if (indicatorRef.BUILD_KEYS.indexOf(it.key) < 0) {
      return err(`build_items[${i}].key 不在白名单（${indicatorRef.BUILD_KEYS.join('|')}）`);
    }
    if (buildSeen[it.key]) return err(`build_items 中 key 重复：${it.key}`);
    buildSeen[it.key] = 1;
    const f = fen(it.fen, `build_items[${i}].fen`);
    if (f && f.error) return f;
    // 年限：正整数 ∈ [1, MAX_BUILD_YEARS]；缺省取该类型的默认年限（单源 indicatorRef）
    let years = it.years === undefined || it.years === null
      ? indicatorRef.BUILD_DEFAULT_YEARS[it.key] : it.years;
    if (typeof years !== 'number' || !Number.isInteger(years) || years < 1 || years > MAX_BUILD_YEARS) {
      return err(`build_items[${i}].years 必须是 1~${MAX_BUILD_YEARS} 的整数`);
    }
    buildItems.push({ key: it.key, fen: f, years });
  }

  // ---- 每月固定支出（key/fen）----
  const fixed_items = arrOf(src.fixed_items, 'fixed_items', false);
  if (fixed_items && fixed_items.error) return fixed_items;
  // ⚠️ round114 起**不再要求 fixed_items 非空**（实测坐实的真缺陷修复）：
  //    M2 页面在用户"一个字没填"时也要能拿到 bands_preview（行业参考区间）与 amount_preview
  //    （参考金额起点）—— 这两者只依赖 业态 × 城市（× 预计营业额），与固定支出无关。
  //    旧校验会把空表单直接拒成 INVALID_PARAM ⇒ 前端 catch ⇒ 参考区间**根本没显示**
  //    （round113 宣称"进页面就有参考"，实际零生效）+ 用户还收到一条英文 key 报错。
  //    "没填够"属于**页面语义**（前端 hasFixed 控制不展示测算结果），不是入参非法。
  //    注意：这里只是**允许空数组**，并没有丢弃任何数据（fail-closed 说的是"不静默丢数据"）。
  const fixedItems = [];
  const fixedSeen = {};
  for (let i = 0; i < fixed_items.length; i++) {
    const it = objOf(fixed_items[i], `fixed_items[${i}]`);
    if (it.error) return it;
    if (indicatorRef.FIXED_KEYS.indexOf(it.key) < 0) {
      return err(`fixed_items[${i}].key 不在白名单（${indicatorRef.FIXED_KEYS.join('|')}）`);
    }
    if (fixedSeen[it.key]) return err(`fixed_items 中 key 重复：${it.key}（同类应合并成一项，否则指标对照会串）`);
    fixedSeen[it.key] = 1;
    const f = fen(it.fen, `fixed_items[${i}].fen`);
    if (f && f.error) return f;
    fixedItems.push({ key: it.key, fen: f });
  }

  // ---- 跟营业额挂钩的费用（key/pct）----
  const var_items = arrOf(src.var_items, 'var_items', true);
  if (var_items && var_items.error) return var_items;
  const varItems = [];
  const varSeen = {};
  for (let i = 0; i < var_items.length; i++) {
    const it = objOf(var_items[i], `var_items[${i}]`);
    if (it.error) return it;
    if (indicatorRef.VAR_KEYS.indexOf(it.key) < 0) {
      return err(`var_items[${i}].key 不在白名单（${indicatorRef.VAR_KEYS.join('|')}）`);
    }
    if (varSeen[it.key]) return err(`var_items 中 key 重复：${it.key}`);
    varSeen[it.key] = 1;
    const p = pct(it.pct, `var_items[${i}].pct`);
    if (p && p.error) return p;
    varItems.push({ key: it.key, pct: p });
  }

  // ---- 菜品毛利率（%）与目标月利润（分）----
  const grossMarginPct = pct(src.gross_margin_pct, 'gross_margin_pct');
  if (grossMarginPct && grossMarginPct.error) return grossMarginPct;
  const targetProfitFen = fen(src.target_profit_fen, 'target_profit_fen');
  if (targetProfitFen && targetProfitFen.error) return targetProfitFen;

  // ---- 预计月营业额（分，选填）：只用于反算「各项参考金额」；未填（null/undefined/0）= 不反算 ----
  const expRaw = src.expected_revenue_fen === undefined || src.expected_revenue_fen === null
    ? 0 : src.expected_revenue_fen;
  const expectedRevenueFen = fen(expRaw, 'expected_revenue_fen');
  if (expectedRevenueFen && expectedRevenueFen.error) return expectedRevenueFen;

  return {
    error: null,
    shop_id: src.shop_id,
    clean: {
      cityTier, bizType,
      buildItems, fixedItems, varItems,
      grossMarginPct, targetProfitFen, expectedRevenueFen,
    },
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };
