// cloudfunctions/common/index.js
// 公共层单源（批次 0 地基）。后续 1~7 批云函数的复用方式（见 tools/sync_common.js）：
//   本目录是「单源」，由 tools/sync_common.js 复制进每个 cloudfunctions/<func>/common/；
//   云函数内统一 require('./common')（指向自身目录内的副本，而非 ../common —— 后者云端 MODULE_NOT_FOUND）。
module.exports = {
  errors: require('./errors'),
  ERROR_CODES: require('./errors').ERROR_CODES,
  ok: require('./errors').ok,
  fail: require('./errors').fail,

  utilTime: require('./utilTime'),

  money: require('./money'),

  dataAdapter: require('./dataAdapter'),

  auth: require('./auth'),
  resolveAuth: require('./auth').resolveAuth,
  assertShopOwner: require('./auth').assertShopOwner,
  // 🔴 2026-09-18 真云事故：auth.js 早已 export genId，但本聚合入口**漏导**，
  //    而 archiveMonth/getShopContext/saveAsset/saveCostCard/saveLedger/saveMaterial/syncCostCard
  //    都写 `const { ..., genId } = common` ⇒ 云端运行期 TypeError: genId is not a function。
  //    最致命的一条 = getShopContext 建店分支 ⇒ **全新用户首次进入必崩**。
  //    伴侣守卫：tools/check_requires.js §2「common 解构符号导出完整性」。
  genId: require('./auth').genId,

  idempotency: require('./idempotency'),
  rateLimit: require('./rateLimit'),
  audit: require('./audit'),
};
