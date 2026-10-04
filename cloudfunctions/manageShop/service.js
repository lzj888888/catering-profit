// cloudfunctions/manageShop/service.js —— 店铺管理纯逻辑（Service 层，可被 selftest 直接 require）
//
// 三件事：① 额度判定（新建）② 边界判定（删除必须留一家）③ 文档构造（确定性 `_id` = 幂等由构造保证）。
// 🔴 额度**不硬编码**：唯一真相源 `feature_permissions.plan_free.limits`（与 getShopList / checkQuota 同源），
//    取不到即抛 SYSTEM_ERROR（响亮失败，不静默放行）—— 沿用 checkQuota/service.js 既有先例。
// 🔴 软删语义：绝不物理删除（历史账本/成本卡仍在库里，只是店铺从列表与额度里消失）。
const { ERROR_CODES } = require('./common');

const NAME_MAX = 20;
const CREATE_ID_PREFIX = 'shop_';

/**
 * 取店铺维度额度（注入值；缺配置 ⇒ 抛 SYSTEM_ERROR）。
 * @param {object} limits feature_permissions.plan_free.limits
 * @returns {{free_limit:number, hard_limit:number|null}}
 */
function requireShopLimits(limits) {
  const freeLimit = limits && limits.shop;
  const hardLimit = limits && limits.hard_shop;
  if (freeLimit === undefined || freeLimit === null) {
    const e = new Error('配额配置缺失（plan_id=plan_free，scope=shop）');
    e.code = ERROR_CODES.SYSTEM_ERROR;
    throw e;
  }
  return {
    free_limit: freeLimit,
    hard_limit: (hardLimit === undefined || hardLimit === null) ? null : hardLimit,
  };
}

/**
 * 新建店铺判定（纯函数）。
 * @param {{used:number, limits:object}} p
 * @returns {{used, free_limit, hard_limit, hit_free_limit, hit_hard_limit}}
 */
function decideCreate(p) {
  const used = Number(p && p.used) || 0;
  const lim = requireShopLimits(p && p.limits);
  return {
    used,
    free_limit: lim.free_limit,
    hard_limit: lim.hard_limit,
    hit_free_limit: used >= lim.free_limit,
    hit_hard_limit: lim.hard_limit !== null && used >= lim.hard_limit,
  };
}

/**
 * 删除店铺判定（纯函数）。
 *
 * 🔴 R208 语义更正（此前 `allowed: active >= 2` 是**错的**，把免费档永久锁死）：
 *   旧判据注释称「删完必须还剩 ≥1 家，否则用户把自己锁死（没店可进、也没店可建）」——
 *   这条理由**不成立**：软删店铺既不进列表也不占配额（`utils/shopSwitcher.js` 头注、
 *   `getShopList` 的 `used = active 列表长度`），删光后 used 由 1 回落 0，**免费额度刚好够再建 1 家**。
 *   真正把用户锁死的反而是旧判据本身：免费档只有 1 家店 ⇒ 永远凑不到 active>=2 ⇒ 删除键形同虚设，
 *   而 `TERMS.exp.deleteConfirm` 却承诺「删除后…不再占用店铺额度」⇒ 文案承诺的事用户永远兑现不了。
 *   且档位错阶：想换店 ⇒ 得先有 2 家 ⇒ 第 2 家已被付费墙拦 ⇒ 免费用户**换不了店名之外的任何东西**。
 *
 *   ⇒ 新语义：**只要还有 ≥1 家活跃店铺就允许删**；删到 0 家即为「额度已释放」，可调 decideCreate 再建。
 *
 * @param {{activeCount:number}} p activeCount = 当前活跃（is_deleted=false）店铺数
 * @returns {{activeCount:number, remaining:number, allowed:boolean}} remaining 为删除后的活跃数
 */
function decideDelete(p) {
  const active = Number(p && p.activeCount) || 0;
  return { activeCount: active, remaining: active > 0 ? active - 1 : 0, allowed: active >= 1 };
}

/**
 * 新建店铺的 `_id`：**由 (userId, clientRequestId) 确定性派生**。
 * 幂等由构造保证（同一次点击的重试 ⇒ 同一 `_id` ⇒ 撞库即回读首次结果），与 `common/defaultShopId` 同一手法。
 * 无 crid ⇒ 返回空串（调用方退化为 genId；此种情况不做幂等约束，由前端在途锁保证不重复点）。
 */
function buildCreateShopId(userId, clientRequestId) {
  if (!clientRequestId) return '';
  return CREATE_ID_PREFIX + String(userId || '') + '_' + String(clientRequestId);
}

/** 新建店铺文档（wizard-free：只有名字，其余给默认值）。 */
function buildShopDoc(p) {
  const now = p && p.now;
  const id = (p && p._id) || '';
  return {
    _id: id, id, shop_id: id,
    user_id: (p && p.userId) || '',
    name: (p && p.name) || '',
    remark: '',
    created_at: now, updated_at: now, is_deleted: false,
  };
}

/** 重命名补丁（只改名 ⇒ 不动 remark/业态等其它字段）。 */
function buildRenamePatch(p) {
  return { name: (p && p.name) || '', updated_at: p && p.now };
}

module.exports = {
  requireShopLimits, decideCreate, decideDelete,
  buildCreateShopId, buildShopDoc, buildRenamePatch,
  NAME_MAX, CREATE_ID_PREFIX, ERROR_CODES,
};
