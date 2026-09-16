// cloudfunctions/detectCycle/index.js —— 批次 3 · POC2 BOM 循环引用检测（Controller 层）
//
// 分层归属：鉴权中间件（批次 0）→ 校验 edges → detectCycle/service.js 纯 DFS 判环。
// 命中依赖环：Service throw { code:'BOM_CYCLE_DETECTED' } → 本层捕获 → fail(code)，**数据不入库**。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { detectCycle } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 参数校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. DFS 判环（深度 ≤5）=====
  // 契约（core/10 §3）：出参 { has_cycle }；命中依赖环时抛 BOM_CYCLE_DETECTED。
  try {
    const step = detectCycle(v.edges);
    if (step.has_cycle) {
      return fail(ERROR_CODES.BOM_CYCLE_DETECTED, '检测到循环引用（A→…→A），禁止保存，数据不入库');
    }
    return ok({
      shop_id: shopId,
      client_request_id: v.input.client_request_id || '',
      has_cycle: false,
    });
  } catch (e) {
    if (e && e.code === ERROR_CODES.BOM_CYCLE_DETECTED) {
      return fail(e.code, '检测到循环引用（A→…→A），禁止保存');
    }
    return fail(ERROR_CODES.SYSTEM_ERROR, 'detectCycle 执行失败: ' + (e && e.message));
  }
};