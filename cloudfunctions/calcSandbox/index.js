// cloudfunctions/calcSandbox/index.js —— 批次 4 · M2 开店测算（Controller 层 · 纯计算锚点）
//
// 分层：鉴权中间件（批次 0）→ 校验/清洗 → Service 纯引擎 → 返回（只算不写）。
// ⚠️ 前端**不做**任何公式，只展示本函数返回的分整数；展示值以此为准（防篡改由 Service 重算校验兜底）。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { calcSandbox, calcSandboxReverse, ENGINE_VERSION } = require('./service');
// 🔴 R386：解释锚点 —— 每条结论都要能回答"按哪版引擎、哪版行业带算的"（PLAN_AI §6）。
//   BANDS_VERSION 是内容哈希（改区间自动变），不手写版本号（手写必腐）。
const { BANDS_VERSION } = common.indicatorRef;
// 🔴 R297：validateClean = 矩阵分支逐行校验入口（与 validateInput 共用 checkClean 单源判据）
const { validateInput, validateClean } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 0. 鉴权中间件（批次 0，所有分支共用）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  // ===== 0.5. G1 场景矩阵批量计算（M2 选址反推改造 · 免费引流，不绑定店铺、不触发付费墙）=====
  // 🔴 口径：前端用 assembleItems 把每个维度组合装配成 clean 参数（与单测完全一致），整批送来；
  //   本分支只做「循环调 calcSandbox」，**引擎 service.js 一行不改**（与 R219/R223/R234 同一套路）。
  // 🔴 不校验店铺归属 / 不读库 / 不碰付费墙 —— 它是纯测算，数据全部来自用户输入，无店铺资产可读。
  //   店铺 id 由 api.call 自动注入，本分支直接忽略（避免把免费引流工具误绑成「需先开店铺」）。
  if (event && event.action === 'matrix') {
    const arr = Array.isArray(event.clean_array) ? event.clean_array : [];
    if (arr.length === 0 || arr.length > 1000) {
      return fail(ERROR_CODES.INVALID_PARAM, 'matrix.clean_array 需 1~1000 个 clean 参数');
    }
    // 🔴🔴 R297 第二轮：逐行走**与单算同一套**字段级判据（validateClean，单源 checkClean）。
    //   改前这里**零校验**直接喂引擎 ⇒ 老板把矩阵页「毛利率」档位填 150（页面维度是自由文本、
    //   只判 isFinite）⇒ 保本 46111→18444 元、房租填负数 ⇒ 19444 元，**零报错**（静默错账）。
    //   口径：算不出的一档 ⇒ 该行给 **null**（前端显示「—」）并在 rejected 里说明哪一档、为什么，
    //   **绝不用一个能算但错的数顶上**（与项目「算不出就 null / 不渲染」同源）。
    const rejected = [];
    const rows = arr.map((c, i) => {
      const v = validateClean(c && typeof c === 'object' ? c : {});
      if (v.error) {
        rejected.push({ index: i, code: v.error, msg: v.msg });
        return null;
      }
      return calcSandbox(v.clean);
    });
    // 全部算不出 ⇒ 响亮失败（fail-closed），而不是甩给前端一屏 null
    if (rejected.length === arr.length) {
      const first = rejected[0];
      return fail(first.code || ERROR_CODES.INVALID_PARAM, `矩阵第 ${first.index + 1} 档：${first.msg}`);
    }
    return ok({
      client_request_id: (event.client_request_id) || '',
      engine_version: ENGINE_VERSION,
      bands_version: BANDS_VERSION,
      rows,
      rejected,
    });
  }

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. Service 纯计算 =====
  const r = calcSandbox(v.clean);

  // ===== 3.5. M2v1.1 反推分支：mode='reverse' ⇒ 调 calcSandboxReverse，出参追加 reverse 块 =====
  const out = {
    shop_id: shopId,
    client_request_id: v.input.client_request_id || '',
    ...r,
  };
  if (v.clean.mode === 'reverse') {
    out.reverse = calcSandboxReverse(v.clean);
  }
  // 🔴 R386：与矩阵分支同一口径（两处都加，少一处就会出现"有的结论有版本、有的没有"）
  out.engine_version = ENGINE_VERSION;
  out.bands_version = BANDS_VERSION;

  return ok(out);
};