/* R745 M3 独立审计 · 只读真跑探针 D3
 * 目标: 用 node 真实执行验证"付费墙话术 ↔ 放行逻辑"是否一致
 *   1) 前端 utils/featureFlags.js: PAYWALL_ENABLED / FREE_ACCESS_MODE 实际值
 *   2) 前端 utils/entitlement.js::fetchEntitlement 在免费期是否真的短路 is_active=true
 *   3) 所有云函数 cx_payFlags.js 副本 FREE_ACCESS 是否一致(true), 找漂移
 *   4) 真实 require getDishReview/cx_entitlement.js::hasFeature, 调 'm3_dishreview'/'export' 看返回
 *   5) 真实 require exportData 的 cx_entitlement 副本 同上
 * 只读, 不修改任何现有文件. 允许写本探针自身(_r745_probeD*.js 前缀).
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const out = [];
const E = s => out.push(s);

// ---- 1) 前端开关 ----
try {
  const ff = require(path.join(ROOT, 'utils/featureFlags.js'));
  E('[1] 前端 featureFlags: PAYWALL_ENABLED=' + ff.PAYWALL_ENABLED
    + ' FREE_ACCESS_MODE=' + ff.FREE_ACCESS_MODE
    + ' BILL_IMPORT_ENABLED=' + ff.BILL_IMPORT_ENABLED
    + ' PROMO_ENABLED=' + ff.PROMO_ENABLED);
} catch (e) { E('[1] require featureFlags 失败: ' + e.message); }

// ---- 2) 前端 entitlement 短路 (mock 掉 wx / getApp / api) ----
try {
  global.getApp = () => ({ globalData: { shop_id: 'S' } });
  global.wx = {};
  // 屏蔽 api.js 里可能的云 SDK require: 直接替换 require 缓存
  const apiPath = path.join(ROOT, 'utils/api.js');
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: { call: async () => ({}) } };
  const ent = require(path.join(ROOT, 'utils/entitlement.js'));
  ent.fetchEntitlement().then(r => {
    E('[2] 前端 fetchEntitlement() 实返: ' + JSON.stringify(r));
    E('    => isPaid(ent)=' + ent.isPaid(r) + ' expireSoonDays=' + ent.expireSoonDays(r));
    flush();
  }).catch(e => { E('[2] fetchEntitlement 抛错: ' + e.message); flush(); });
} catch (e) { E('[2] require entitlement 失败: ' + e.message); flush(); }

let flushed = false;
function flush() { if (flushed) return; flushed = true; process.stdout.write(out.join('\n') + '\n'); }

// ---- 3) 所有云函数 cx_payFlags.js 副本 FREE_ACCESS 一致性 ----
const cfRoot = path.join(ROOT, 'cloudfunctions');
let dirs = [];
try { dirs = fs.readdirSync(cfRoot).filter(n => fs.statSync(path.join(cfRoot, n)).isDirectory()); } catch (e) {}
const vals = [];
for (const d of dirs) {
  const p = path.join(cfRoot, d, 'cx_payFlags.js');
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8');
  const m = txt.match(/const\s+FREE_ACCESS\s*=\s*(true|false)/);
  vals.push({ cf: d, v: m ? m[1] : 'NOT_FOUND' });
}
E('[3] 云函数 cx_payFlags.js 副本数=' + vals.length);
const bad = vals.filter(x => x.v !== 'true');
E('    非 true 的副本(漂移): ' + (bad.length ? bad.map(x => x.cf + '=' + x.v).join(', ') : '无 (全部 true)'));
E('    全部取值: ' + [...new Set(vals.map(x => x.v))].join(','));

// ---- 4/5) 真跑 hasFeature ----
function probeHasFeature(cfName) {
  try {
    const p = path.join(cfRoot, cfName, 'cx_entitlement.js');
    const mod = require(p);
    const dbStub = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }) };
    return Promise.all(['m3_dishreview', 'export', 'm3_takeaway', 'not_a_feature'].map(k =>
      mod.hasFeature(dbStub, 'U1', k).then(r => k + '=' + r)
    )).then(rs => {
      E('[hasFeature@' + cfName + '] ' + rs.join(' , '));
    }).catch(e => E('[hasFeature@' + cfName + '] 抛错: ' + e.message));
  } catch (e) { E('[hasFeature@' + cfName + '] require 失败: ' + e.message); return Promise.resolve(); }
}
(async () => {
  await probeHasFeature('getDishReview');
  await probeHasFeature('exportData');
  flush();
})();
