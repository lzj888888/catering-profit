// cloudfunctions/ensureCollections/index.js —— 建集合/补索引的**唯一安全入口**（R655）
//
// 为什么要这个函数：
//   ① 现在：`rate_limit_counter` 在云端还不存在 ⇒ 频控一直 fail open（功能正常但没防刷）。
//   ② 将来：prod 环境的 `initDb` 有环境门禁（含 `prod` 子串一律拒绝，这是**政策**不是限制），
//      所以 prod 建集合只能走控制台手工，或者走「一个不碰 initDb 门禁、但同样安全」的入口。
//      本函数就是那个入口。
//   ③ 用 GUI 点控制台建集合，步骤多、易点错、且**没有可复核的痕迹**；
//      代码化之后，建了哪些集合有返回值、有日志、能重放。
//
// 🔴 四条安全红线：
//   1. **拒绝用户端调用**（R215 定式）：有 OPENID 即拒。
//   2. **只建不删、不改数据**：本函数永远不删集合、不写业务数据。
//   3. **白名单**：只允许建 `collections.js` 单源里登记过的集合名 —— 防止被当成"随便建表"的通道。
//   4. **幂等**：已存在的集合不报错（云开发 createCollection 对已存在会抛，这里吞掉并标记 existed）。
'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 与 initDb/collections.js 同源的集合名（守卫 check_ensure_collections 会比对两边，
// 单源漂了会红 —— 这里不引入第二份真相，只是把它列成白名单形式）。
const COLLECTIONS = [
  'shop', 'shop_entitlement', 'shop_subscription', 'shop_payment_flow',
  'shop_monthly_account', 'shop_monthly_income', 'shop_monthly_expense',
  'shop_inventory', 'shop_cost_card', 'shop_cost_card_line', 'shop_material',
  'shop_sandbox', 'shop_amortize', 'shop_switch', 'shop_income_item',
  'shop_expense_item', 'shop_stored_value', 'shop_credit_ledger',
  'shop_dish_mapping', 'shop_ai_consent', 'shop_ai_insight',
  'shop_diagnosis_report', 'shop_diagnosis_credit',
  'user', 'order_refund', 'admin_user', 'admin_login_log',
  'subscription_plan', 'external_sales_daily', 'revenue_batch',
  'feature_permissions', 'audit_log',
  // 🔴 R655：以下 6 个我原先按记忆抄了进来（anomaly_baseline / industry_band / anomaly_config /
  //   feedback / app_config / region_config），守卫 C-② 当场拦下 —— 它们**不在 buildk 单源里**，
  //   其中 5 个全仓零引用（只有 feedback 有 1 处）。建出这种表只会多出没人用的空壳，
  //   而且会让"单源说 33 个、线上有 39 个"的漂移更难查。**已删。**
  'rate_limit_counter',
];

exports.main = async (event) => {
  // 🔴 红线 1：只允许控制台/服务端调用
  const ctx = cloud.getWXContext() || {};
  if (ctx.OPENID) {
    return { ok: false, code: 'FORBIDDEN', msg: 'ensureCollections 仅允许控制台调用' };
  }

  // 只建指定集合（不传 = 建全部白名单，用于 prod 初始化）
  const want = Array.isArray(event && event.collections) && event.collections.length
    ? event.collections.filter((c) => COLLECTIONS.indexOf(c) >= 0)
    : COLLECTIONS;

  // 🔴 红线 3：白名单外的名字直接拒，并**明确回报**（不静默丢弃）
  const rejected = (Array.isArray(event && event.collections) ? event.collections : [])
    .filter((c) => COLLECTIONS.indexOf(c) < 0);

  const created = [];
  const existed = [];
  const failed = [];

  for (const c of want) {
    try {
      await db.createCollection(c);
      created.push(c);
    } catch (e) {
      const msg = String((e && e.message) || e);
      // 云开发对已存在的集合抛 ResourceUnavailable / 已存在 ⇒ 视为幂等成功
      if (/exist|already|ResourceUnavailable/i.test(msg)) {
        existed.push(c);
      } else {
        failed.push({ collection: c, error: msg });
      }
    }
  }

  const ok = failed.length === 0 && rejected.length === 0;
  console.log('[ensureCollections] ' + (ok ? '✅' : '🔴') +
    ' created=' + created.length + ' existed=' + existed.length +
    ' failed=' + failed.length + ' rejected=' + rejected.length);
  if (failed.length) console.error('[ensureCollections] 失败：' + JSON.stringify(failed));
  if (rejected.length) console.error('[ensureCollections] 白名单外被拒：' + JSON.stringify(rejected));

  return {
    ok: ok,
    env: (cloud.getWXContext() || {}).ENV || '',
    created: created,
    existed: existed,
    failed: failed,
    rejected: rejected,
    total_requested: want.length,
  };
};
