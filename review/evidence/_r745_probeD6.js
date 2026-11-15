/* R745 M3 独立审计 · 只读真跑探针 D6
 * 验证: 配额超限错误码经 api.call -> msgOf -> toast 到底给用户显示什么,
 *       与 PAYWALL_ENABLED=false(无开通入口) 是否自相矛盾.
 * 只读, 不修改任何现有文件.
 */
const path = require('path');
const ROOT = process.cwd();
const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const ff = require(path.join(ROOT, 'utils/featureFlags.js'));
console.log('PAYWALL_ENABLED =', ff.PAYWALL_ENABLED, ' FREE_ACCESS_MODE =', ff.FREE_ACCESS_MODE);
console.log("CODE_TO_I18N['FREE_LIMIT_EXCEEDED'] =", T.CODE_TO_I18N && T.CODE_TO_I18N['FREE_LIMIT_EXCEEDED']);
console.log("msgOf('FREE_LIMIT_EXCEEDED') =", T.msgOf('FREE_LIMIT_EXCEEDED'));
console.log("msgOf('FREE_LIMIT') =", T.msgOf('FREE_LIMIT'));
console.log("TERMS['ERR.FREE_LIMIT'] =", T.TERMS['ERR.FREE_LIMIT']);
console.log('TERMS.card.quotaUsedUp =', T.TERMS.card && T.TERMS.card.quotaUsedUp);
console.log('TERMS.card.quotaRemainTpl =', T.TERMS.card && T.TERMS.card.quotaRemainTpl);
console.log('TERMS.paywall.combo.content =', T.TERMS.paywall && T.TERMS.paywall.combo && T.TERMS.paywall.combo.content);
console.log('TERMS.paywall.freeLimitCardTitle =', T.TERMS.pay && T.TERMS.pay.freeLimitCardTitle);
console.log('TERMS.pay.freeLimitCardBody =', T.TERMS.pay && T.TERMS.pay.freeLimitCardBody);
console.log('TERMS.pay.freeLimitGeneric =', T.TERMS.pay && T.TERMS.pay.freeLimitGeneric);
