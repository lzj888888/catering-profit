// cloudfunctions/common/payFlags.js —— 云端支付/商业化开关（单源）
//
// 🔴 为什么必须单独建一个文件：
//   云函数独立打包、**读不到**前端 `utils/featureFlags.js`。若前端"免费放行"而云端仍判权益，
//   会出现「外卖能算、导出点不动」「套餐存不了」这类**半开半关**状态，且全程不报错
//   —— 正是本仓 PITFALLS §26 反复踩的形态（入口在、功能被藏）。
//
// 🔴 与前端同值，机器把关：
//   `FREE_ACCESS` 必须 === `!frontend.PAYWALL_ENABLED`，
//   由 `tools/check_paywall_coverage.js` L9-⑧ 双向比对（改一处忘另一处 ⇒ 转红）。
//
// 🔴 语义：FREE_ACCESS = true 时，`hasFeature()` 对所有付费域恒返回 true。
//   注意这**不是**"删掉收费"——`PAID_FEATURES`、订单表、套餐表、payCreateOrder/payRenew
//   全部原样保留；只是当前阶段不把用户挡在功能外。
//
// 阶段：
//   ① 现在（主体个人 / 提审期 / 未接虚拟支付）：FREE_ACCESS = true —— 功能全开、无购买入口
//   ② 虚拟支付开通后：改 false，恢复按 `shop_entitlement.expire_at` 判定
'use strict';

const FREE_ACCESS = true;

module.exports = { FREE_ACCESS };
