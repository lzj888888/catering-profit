// cloudfunctions/checkQuota/service.js —— 批次 5 / M3.22 批次 A1 · 免费配额计算（Service 层纯逻辑）
//
// ⚠️ 配额维度铁律：
//   · 店铺维度按 user_id（免费档仅 1 账套）；成本卡维度按 shop_id（shop_cost_card 无 user_id 字段，只有 created_by，
//     跨店维度需 created_by 索引，本批次不引入）—— 见 index.js 头注实测口径。
//   · M2 = 永久全免费、方案不限套（不参与任何配额判定）。
//   · 计数口径：仅统计 `is_deleted=false`（软删不占额）；由 DataAdapter 层过滤后传入活跃数据。
//
// M3.22（批次 A1）：额度值**不再硬编码**于本文件。FREE_LIMIT / HARD_LIMIT 常量已删除，
//   改为**入参 `limits` 注入**，形如 { shop, cost_card, hard_shop, hard_card }，唯一真相源 =
//   feature_permissions 的 plan_free.limits（见 initDb/collections.js 种子）。
//   ⚠️ 不得保留任何额度字面量兜底：取不到 limits ⇒ 抛 SYSTEM_ERROR + 明确 msg（本批次不新增错误码，
//     复用既有 SYSTEM_ERROR 响亮失败 —— 同 adminQueryUser/service.js「复用 HARD_CAP_EXCEEDED，不新增错误码」先例）。

const { ERROR_CODES } = require('./common');

/**
 * 配额判定（纯函数）。
 * @param {object} p
 *   - userId: string
 *   - scope: 'shop' | 'cost_card'
 *   - activeCount: number（已由 DataAdapter 过滤 is_deleted=false 的活跃数量）
 *   - limits: { shop, cost_card, hard_shop, hard_card }（注入，唯一真相源 = feature_permissions.plan_free.limits）
 * @returns {object} {
 *   user_id, scope, used, free_limit, hard_limit,
 *   hit_free_limit: boolean,   // used >= 免费额度（第 N+1 个触发付费墙）
 *   hit_hard_limit: boolean,   // used >= 硬上限（连付费也救不了，走客服）
 * }
 * @throws {{code:'SYSTEM_ERROR'}} 缺 limits 或该 scope 的额度值缺失 → 响亮失败（不静默放行）
 */
function checkQuota(p) {
  const scope = (p && p.scope === 'cost_card') ? 'cost_card' : 'shop';
  const used = Number(p && p.activeCount) || 0;
  const limits = p && p.limits;
  const freeLimit = limits && limits[scope];
  const hardLimit = limits && limits[scope === 'shop' ? 'hard_shop' : 'hard_card'];
  if (freeLimit === undefined || freeLimit === null || hardLimit === undefined || hardLimit === null) {
    const e = new Error(`配额配置缺失（plan_id=plan_free，scope=${scope}）`);
    e.code = ERROR_CODES.SYSTEM_ERROR;
    throw e;
  }
  return {
    user_id: (p && p.userId) || '',
    scope,
    used,
    free_limit: freeLimit,
    hard_limit: hardLimit,
    // used >= 免费额度 → 下一次保存（第 freeLimit+1 个）超限
    hit_free_limit: used >= freeLimit,
    hit_hard_limit: used >= hardLimit,
  };
}

module.exports = { checkQuota, ERROR_CODES };