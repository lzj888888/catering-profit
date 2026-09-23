// cloudfunctions/common/index.js
// 公共层单源（批次 0 地基）。后续 1~7 批云函数的复用方式（见 tools/sync_common.js）：
//   本目录是「单源」，由 tools/sync_common.js 复制进每个 cloudfunctions/<func>/common/；
//   云函数内统一 require('./common')（指向自身目录内的副本，而非 ../common —— 后者云端 MODULE_NOT_FOUND）。
module.exports = {
  errors: require('./cx_errors'),
  ERROR_CODES: require('./cx_errors').ERROR_CODES,
  ok: require('./cx_errors').ok,
  fail: require('./cx_errors').fail,
  // A6b（2026-09-19）：「唯一键冲突」判定单源 —— resolveAuth / getShopContext 建档容错共用。
  isDuplicateKeyError: require('./cx_errors').isDuplicateKeyError,

  utilTime: require('./cx_utilTime'),

  money: require('./cx_money'),

  dataAdapter: require('./cx_dataAdapter'),

  auth: require('./cx_auth'),
  resolveAuth: require('./cx_auth').resolveAuth,
  assertShopOwner: require('./cx_auth').assertShopOwner,
  // 🔴 2026-09-18 真云事故：auth.js 早已 export genId，但本聚合入口**漏导**，
  //    而 archiveMonth/getShopContext/saveAsset/saveCostCard/saveLedger/saveMaterial/syncCostCard
  //    都写 `const { ..., genId } = common` ⇒ 云端运行期 TypeError: genId is not a function。
  //    最致命的一条 = getShopContext 建店分支 ⇒ **全新用户首次进入必崩**。
  //    伴侣守卫：tools/check_requires.js §2「common 解构符号导出完整性」。
  genId: require('./cx_auth').genId,
  // 🔴 同族风险（勿重犯 genId 的错）：新增的单源符号**必须**在本聚合入口同时导出，
  //    否则调用点 `const { defaultShopId } = common` 会在真云上 TypeError（本地测不出）。
  //    伴侣守卫：tools/check_requires.js §2「common 解构符号导出完整性」。
  defaultShopId: require('./cx_auth').defaultShopId,
  defaultEntitlementId: require('./cx_auth').defaultEntitlementId,

  idempotency: require('./cx_idempotency'),
  rateLimit: require('./cx_rateLimit'),
  audit: require('./cx_audit'),

  // M2 餐饮指标参考库（分业态 × 分城市层级）· 口径单源
  // ⚠️ 同 genId 的教训：新增单源符号务必在此聚合入口导出，否则云端 `const { indicatorRef } = common` 会 TypeError。
  //    伴侣守卫：tools/check_requires.js §2。
  indicatorRef: require('./cx_indicatorRef'),
};
