// cloudfunctions/checkQuota/service.js —— 批次 5 · 免费配额计算（Service 层纯逻辑）
//
// ⚠️ 配额维度铁律（批次 5 §2.1.1，前后端统一，禁止各算各的）：
//   · 维度 = **user_id**（全店通用，非按店铺）：免费配额跟着用户走，跨该用户所有店铺共享。
//   · M1 = 每用户 **1 家免费账套**（第 2 家店触发付费墙）
//   · M3 = 每用户 **3 张免费成本卡**（第 4 张触发付费墙，按 card_code 去重，版本不计）
//   · M2 = 永久全免费、方案不限套（不参与任何配额判定）
//   · 计数口径：仅统计 `is_deleted=false`（软删不占额）；由 DataAdapter 层过滤后传入活跃数据。
//   · 与硬上限区分：免费额度（1/3）是付费墙阈值；系统另有硬上限（M1 账套 200 / M3 卡 2000）防滥用，
//     付费用户也不得超过。两者不可混淆。
//
// 本函数是「纯计数 + 判定」，输入为已经 DataAdapter 过滤的**活跃**数据数组（业务层不关心软删）。

const { ERROR_CODES } = require('./common');

// 免费额度（付费墙阈值）—— 常量定义于 Service（后端权威，前端不硬编码）
const FREE_LIMIT = { shop: 1, cost_card: 3 };
// 硬上限（防滥用总闸）—— 付费用户也不得超过
const HARD_LIMIT = { shop: 200, cost_card: 2000 };

/**
 * 配额判定（纯函数）。
 * @param {object} p
 *   - userId: string
 *   - scope: 'shop' | 'cost_card'
 *   - activeCount: number（该 user 的**活跃**数量，已由 DataAdapter 过滤 is_deleted=false）
 * @returns {object} {
 *   user_id, scope, used, free_limit, hard_limit,
 *   hit_free_limit: boolean,   // used >= 免费额度（第 N+1 个触发付费墙）
 *   hit_hard_limit: boolean,   // used >= 硬上限（连付费也救不了，走客服）
 * }
 */
function checkQuota(p) {
  const scope = (p && p.scope === 'cost_card') ? 'cost_card' : 'shop';
  const used = Number(p && p.activeCount) || 0;
  const freeLimit = FREE_LIMIT[scope];
  const hardLimit = HARD_LIMIT[scope];
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

module.exports = { checkQuota, FREE_LIMIT, HARD_LIMIT, ERROR_CODES };