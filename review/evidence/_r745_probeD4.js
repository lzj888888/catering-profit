/* R745 M3 独立审计 · 只读真跑探针 D4
 * 专测: 云函数 hasFeature 在真实 FREE_ACCESS 取值下的返回, 佐证 getDishReview.tier.
 * 只读, 不修改任何现有文件.
 */
const path = require('path');
const ROOT = process.cwd();
(async () => {
  for (const cf of ['getDishReview', 'exportData', 'saveCostCard', 'syncCostCard', 'saveDishMapping']) {
    const ePath = path.join(ROOT, 'cloudfunctions', cf, 'cx_entitlement.js');
    const fPath = path.join(ROOT, 'cloudfunctions', cf, 'cx_payFlags.js');
    let mod, flags;
    try { mod = require(ePath); flags = require(fPath); }
    catch (err) { console.log(cf + ' => require 失败: ' + err.message); continue; }
    const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }) };
    const r1 = await mod.hasFeature(db, 'U1', 'm3_dishreview');
    const r2 = await mod.hasFeature(db, 'U1', 'export');
    console.log(cf.padEnd(16) + ' FREE_ACCESS=' + flags.FREE_ACCESS
      + '  hasFeature(m3_dishreview)=' + r1 + '  hasFeature(export)=' + r2
      + '  => getDishReview.tier=' + (r1 ? "'full'" : "'free'"));
  }
})();
