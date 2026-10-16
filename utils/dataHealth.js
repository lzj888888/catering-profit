// utils/dataHealth.js —— 云函数出参 `truncated` 的前端**唯一**消费谓词（R299）
//
// 为什么必须有这个单源（本仓同族病的最后一公里）：
//   `cloudfunctions/common/dataAdapter.js::listAll` 的契约原文写着 ——
//     「`truncated === true` ⇒ data 已达 `LIST_TOTAL_CAP`（20000）且仍有剩余 ⇒ 调用方**必须**
//       把这个事实透传到出参（**可见降级**），不得当作『取全了』继续算。」
//   四个云函数（getDishReview / getCostCard / getSalesBills / manageShop）**都照做了**，
//   但前端此前 **零消费**（全仓 `grep truncated pages/ utils/ miniprogram/` 为空命中）
//   ⇒ 数据一超上限，复盘榜 / 账单列表 / 成本卡列表就**静默少行**，页面照常渲染、零提示。
//   ⇒ 这正是「**写读取方 ≠ 修好**」「**读到了 ≠ 送出去了**」在**最后一公里**的同族形态：
//      出参有事实、判据有要求、**用户面前什么都没有**。
//
// 用法（页面侧）：
//   const dh = require('../../../utils/dataHealth.js');
//   const res = await api.call('getCostCard', {});
//   this.setData({ truncated: dh.isTruncated(res) });     // 再在 wxml 里渲染 t.dataTruncated
//
// 🔴 判据钉在 `=== true` 上（不是真值判断）：契约语义是**布尔**；
//    若某天云端回字符串 'true'/'1'，那是契约破了、应当判红而不是被宽松地放行。
//    守 `tools/check_truncated_surfaced.js`。
'use strict';

/**
 * 该出参是否被服务端标记为「已达读取上限、可能不全」。
 * @param {*} res 云函数 `ok(...)` 的出参（`utils/api.js::call` 已剥壳）
 * @returns {boolean}
 */
function isTruncated(res) {
  return !!(res && res.truncated === true);
}

module.exports = { isTruncated };
