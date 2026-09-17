// cloudfunctions/initDb/collections.js
// 批次 0 §2.4 基础表结构（25 张集合 + 索引 + 种子数据）单一真相源。
// 本文件为**纯数据/纯函数**，不依赖 wx-server-sdk，供云函数与自测脚本共同引用（避免漂移）。
// 与 specs/dev-specs/prototype/init_db.js 及 core/10 云函数清单同步锁死。

// ===== 1. 集合清单（25 张，严格对应批次 0 §2.4）=====
const COLLECTIONS = [
  // A 类 · 已锁定表
  'shop_material', 'shop_cost_card', 'shop_cost_card_line', 'shop_sandbox',
  'shop_amortize', 'audit_log',
  // B 类 · 设计表
  'shop_monthly_account', 'shop_monthly_income', 'shop_monthly_expense',
  'shop_inventory', 'shop_stored_value', 'shop_credit_ledger',
  'subscription_plan', 'feature_permissions', 'shop_switch',
  'shop_income_item', 'shop_expense_item', 'shop_subscription', 'shop_payment_flow',
  // 补充表
  'user', 'shop', 'shop_entitlement', 'order_refund', 'admin_user', 'admin_login_log',
];

// ===== 2. 索引定义 =====
const INDEXES = {
  user: [
    { name: 'idx_openid', unique: true, keys: { openid: 1 } },
    { name: 'idx_user_id', unique: true, keys: { user_id: 1 } },
  ],
  shop: [
    { name: 'idx_shop_user', keys: { user_id: 1 } },
    { name: 'idx_shop_user_del', keys: { user_id: 1, is_deleted: 1 } },
  ],
  shop_entitlement: [
    { name: 'idx_ent_user', unique: true, keys: { user_id: 1 } },
    { name: 'idx_ent_expire', keys: { expire_at: 1 } },
  ],
  shop_subscription: [
    { name: 'idx_sub_user', keys: { user_id: 1 } },
  ],
  shop_payment_flow: [
    { name: 'idx_pay_user', keys: { user_id: 1 } },
    { name: 'idx_pay_order', unique: true, keys: { order_no: 1 } },
    { name: 'idx_pay_shop', keys: { shop_id: 1 } },
  ],
  order_refund: [
    { name: 'idx_refund_order', unique: true, keys: { order_id: 1 } },
    { name: 'idx_refund_user', keys: { user_id: 1 } },
  ],
  shop_monthly_account: [
    { name: 'idx_acc_shop_month', unique: true, keys: { shop_id: 1, month: 1 } },
    { name: 'idx_acc_shop_del', keys: { shop_id: 1, is_deleted: 1 } },
  ],
  shop_monthly_income: [
    { name: 'idx_inc_shop_month', keys: { shop_id: 1, month: 1 } },
  ],
  shop_monthly_expense: [
    { name: 'idx_exp_shop_month', keys: { shop_id: 1, month: 1 } },
  ],
  shop_inventory: [
    { name: 'idx_inv_shop_month', unique: true, keys: { shop_id: 1, month: 1 } },
  ],
  shop_cost_card: [
    { name: 'idx_card_shop', keys: { shop_id: 1 } },
    // R38（2026-09-16）：多版本模型（同 card_code、version 递增）⇒ 单列唯一会被第二版撞库。
    // 改复合唯一 (shop_id, card_code, version)：允许多版本、防同版本重复，并充当并发守卫
    //  （saveCostCard 是"读最大版本+1"的非原子写，唯一索引让撞车变成响亮失败）。
    { name: 'idx_card_code_version', unique: true, keys: { shop_id: 1, card_code: 1, version: 1 } },
  ],
  shop_cost_card_line: [
    { name: 'idx_line_card', keys: { card_id: 1 } },
  ],
  shop_material: [
    { name: 'idx_mat_shop', keys: { shop_id: 1 } },
    { name: 'idx_mat_shop_virtual', keys: { shop_id: 1, is_virtual: 1 } },
  ],
  shop_sandbox: [
    { name: 'idx_sb_shop', keys: { shop_id: 1 } },
    { name: 'idx_sb_shop_del', keys: { shop_id: 1, is_deleted: 1 } },
  ],
  shop_amortize: [
    { name: 'idx_amort_shop', keys: { shop_id: 1 } },
  ],
  shop_switch: [
    { name: 'idx_switch_shop_key', unique: true, keys: { shop_id: 1, switch_key: 1 } },
  ],
  audit_log: [
    { name: 'idx_audit_shop', keys: { shop_id: 1 } },
    { name: 'idx_audit_action', keys: { action: 1 } },
    { name: 'idx_audit_created', keys: { created_at: -1 } },
    // 🔒 R72：幂等预检（common/idempotency.js::checkIdempotent）按 idempotency_key 查重，
    //   而 audit_log 是**只增不删**的审计表 ⇒ 无索引时每次幂等检查都全表扫描、随时间线性恶化。
    //   ⚠️ 上线前必须创建（A7）。**结论更正（2026-09-17 实测）**：wx-server-sdk 确无 createIndex
    //   （index.js 全包零命中 createIndex + index.d.ts 的 Collection 无任何索引方法，双验证），
    //   但「索引只能靠人在控制台填」是**错的** —— 官方 HTTP API `POST /tcb/updateindex` 可脚本化
    //   批量建索引，本仓用法见 tools/apply_indexes.js（索引清单从本文件派生，故此处不写任何计数）。
    //   saveCostCard 的「重放」形态查询额外带 shop_id 条件，但无需复合索引——idempotency_key 基数已足够。
    { name: 'idx_audit_idem', keys: { idempotency_key: 1 } },
  ],
  admin_user: [
    { name: 'idx_admin_username', unique: true, keys: { username: 1 } },
  ],
  admin_login_log: [
    { name: 'idx_login_admin', keys: { admin_id: 1 } },
  ],
  subscription_plan: [
    { name: 'idx_plan_enabled', keys: { enabled: 1, sort: 1 } },
  ],
  feature_permissions: [
    { name: 'idx_fp_plan', keys: { plan_id: 1 } },
  ],
  shop_stored_value: [
    { name: 'idx_sv_shop', keys: { shop_id: 1 } },
    { name: 'idx_sv_shop_month', keys: { shop_id: 1, month: 1 } },
  ],
  shop_credit_ledger: [
    { name: 'idx_cl_shop', keys: { shop_id: 1 } },
    { name: 'idx_cl_shop_created', keys: { shop_id: 1, created_at: -1 } },
  ],
  shop_income_item: [
    { name: 'idx_ii_shop_month', keys: { shop_id: 1, month: 1 } },
  ],
  shop_expense_item: [
    { name: 'idx_ei_shop_month', keys: { shop_id: 1, month: 1 } },
  ],
};

// ===== 3. 种子数据（套餐 + 功能权限；价格/名从表读，禁硬编码）=====
// 价格/天数严格对齐商业化方案_v1.4 四档套餐（price=分整数，days=自然日）
const SEED_PLANS = [
  { plan_id: 'plan_basic_month', name: '真实利润·月', price: 2590, days: 31, type: 'one_time', enabled: true, sort: 1 },
  { plan_id: 'plan_basic_quarter', name: '真实利润·季', price: 6900, days: 90, type: 'one_time', enabled: true, sort: 2 },
  { plan_id: 'plan_basic_year', name: '真实利润·年', price: 19900, days: 365, type: 'one_time', enabled: true, sort: 3 },
  { plan_id: 'plan_auto_subscribe', name: '真实利润·自动续费(月)', price: 1990, days: 31, type: 'auto_subscribe', enabled: true, sort: 4 },
];
const SEED_FEATURES = SEED_PLANS.map((p) => ({ plan_id: p.plan_id, feature_key: 'real_profit', enabled: true }))
  .concat(SEED_PLANS.map((p) => ({ plan_id: p.plan_id, feature_key: 'export', enabled: true })));

/**
 * 环境门禁（dev 仅放行，prod 恒拒）。纯函数，供云函数 main 与自测脚本共用。
 * 逻辑对齐 core/06 §1.3.1 / prototype/init_db.js：
 *   1) 配置了 DEV_ENV_ID → 走精确白名单（env === DEV_ENV_ID）
 *   2) 始终生效兜底：env 含 "prod" 子串一律拒绝（即便白名单分支也受约束）
 *   失败方向一律关闭：blocked=true；放行返回 { blocked: undefined }（即 blocked===undefined）
 * @param {string} envRaw 当前环境 ID（来自 cloud.getWXContext().ENV 回落 TCB_ENV）
 * @param {string} devEnvIdRaw 配置的 dev 环境白名单（process.env.DEV_ENV_ID）
 * @returns {{blocked: (boolean|undefined), reason?: string}}
 */
function gate(envRaw, devEnvIdRaw) {
  let env = String(envRaw == null ? '' : envRaw).toLowerCase();
  const DEV_ENV_ID = String(devEnvIdRaw == null ? '' : devEnvIdRaw).toLowerCase();
  const isDevEnv = (DEV_ENV_ID ? (env === DEV_ENV_ID) : /dev/.test(env)) && !/prod/.test(env);
  if (!isDevEnv) {
    return { blocked: true, reason: 'INITDB_DEV_ONLY: initDb 仅允许 dev 环境，prod 集合请由控制台手工创建' };
  }
  return { blocked: undefined };
}

module.exports = { COLLECTIONS, INDEXES, SEED_PLANS, SEED_FEATURES, gate };
