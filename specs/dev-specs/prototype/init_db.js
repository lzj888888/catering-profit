/**
 * initDb · 一次性建库云函数（部署为云函数 initDb，仅手动运行一次）
 *
 * 依据：批次 0 §2.4 基础表结构（25 张集合 + 索引 + 种子数据）
 * 作用：云开发集合必须显式创建 + 建索引，否则业务代码一跑就报「集合不存在」。
 *       本函数把所有集合、索引、初始套餐/权限种子一次性建好。
 *
 * 部署：在 inscode / 云开发控制台新建云函数 initDb，把本文件内容贴入，
 *       依赖安装 wx-server-sdk，部署后「测试调用」运行一次即可（可重复运行，已存在则跳过）。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ===== 1. 集合清单（严格对应批次 0 §2.4）=====
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

// ===== 2. 索引定义（复合/唯一按批次 0 §2.4 索引段）=====
// 形式：{ collection: [ { name, unique, keys } ] }
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
    { name: 'idx_card_code', unique: true, keys: { card_code: 1 } },
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
  // 审查 P1-5：补齐此前遗漏的四张集合索引
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

// ===== 3. 种子数据（套餐 + 功能权限，价格/名从表读，禁硬编码）=====
// 价格/天数严格对齐商业化方案_v1.4 四档套餐（单位：price=分整数，days=自然日）
// 阶段1前端仅展示单次月包；季/年/自动订阅后台预埋、前端按阶段隐藏
const SEED_PLANS = [
  { plan_id: 'plan_basic_month', name: '真实利润·月', price: 2590, days: 31, type: 'one_time', enabled: true, sort: 1 },
  { plan_id: 'plan_basic_quarter', name: '真实利润·季', price: 6900, days: 90, type: 'one_time', enabled: true, sort: 2 },
  { plan_id: 'plan_basic_year', name: '真实利润·年', price: 19900, days: 365, type: 'one_time', enabled: true, sort: 3 },
  { plan_id: 'plan_auto_subscribe', name: '真实利润·自动续费(月)', price: 1990, days: 31, type: 'auto_subscribe', enabled: true, sort: 4 },
];
// 真实利润功能对全部付费套餐开放
const SEED_FEATURES = SEED_PLANS.map(p => ({ plan_id: p.plan_id, feature_key: 'real_profit', enabled: true }))
  .concat(SEED_PLANS.map(p => ({ plan_id: p.plan_id, feature_key: 'export', enabled: true })));

// ===== 4. 执行 =====
exports.main = async (event, context) => {
  // 🚫 生产环境部署禁令（与 seed_demo 一致）：initDb 仅允许 dev 环境运行。
  // 生产环境 25 张集合由云开发控制台手工创建（一次性），本函数**绝不部署到 prod**。
  // 约定：环境 ID 形如 catering-dev-xxxxxx（dev）/ catering-prod-xxxxxx（prod），见 写码阶段启动执行手册 / core/06。
  // 门禁匹配规则（详见 core/06 §1.3.1，commit 8a9c5e0 教训）：
  //   1) 若配置了 DEV_ENV_ID 环境变量 → 走精确白名单（env === DEV_ENV_ID），对命名漂移/随机后缀双重免疫（推荐最终形态）；
  //      否则启发式：放行含 "dev" 子串的环境。
  //   2) 【始终生效的兜底】任何情况下 env 含 "prod" 子串一律拒绝 —— 白名单分支同样受此约束，
  //      防 DEV_ENV_ID 被误配到 prod 云函数环境变量（复制环境变量是常见人为事故）导致 prod 被放行。
  //      命名约定为 catering-prod-*，该兜底对正常 prod 恒成立、不误伤放行路径。
  //   失败方向一律关闭（env 取空/取值失败/匹配失败都 blocked），本分支仅写服务端日志、绝不回传 env 值（core/06:58-62 环境 ID 属敏感信息）。
  // env 取值（与 seed_demo.js 对齐）：优先 wxContext.ENV，其为空(undefined/'')或 getWXContext() 抛错时回落到 TCB_ENV
  //   （云开发标准变量，非 WX_ENV）。⚠️ 兜底必须写在 try 表达式内部：若只在 catch 里兜底，
  //   getWXContext() 正常返回但 ENV 为空时会被赋成 ''，兜底永不生效（即刚修掉的误拦复发）。
  let env = '';
  try { env = String(cloud.getWXContext().ENV || process.env.TCB_ENV || ''); } catch (e) { env = String(process.env.TCB_ENV || ''); }
  env = env.toLowerCase();
  const DEV_ENV_ID = (process.env.DEV_ENV_ID || '').toLowerCase();
  const isDevEnv = (DEV_ENV_ID ? (env === DEV_ENV_ID) : /dev/.test(env)) && !/prod/.test(env);
  if (!isDevEnv) {
    console.error(`[INITDB_BLOCKED] env="${env}" 非 dev 环境，禁止建库与播种演示数据`);
    return { blocked: true, reason: 'INITDB_DEV_ONLY: initDb 仅允许 dev 环境，prod 集合请由控制台手工创建' };
  }
  const result = { created: [], indexes: [], seeds: [], errors: [] };

  // 4.1 建集合（已存在则跳过）
  for (const c of COLLECTIONS) {
    try {
      await db.createCollection(c);
      result.created.push(c);
    } catch (e) {
      // 集合已存在 / 环境不支持 createCollection 时静默跳过
      if (!/already|exist|EXISTS/i.test(e.message || '')) {
        result.errors.push(`create ${c}: ${e.message}`);
      }
    }
  }

  // 4.2 建索引（API 因 SDK 版本差异可能不支持，失败记日志，可在控制台手动补）
  for (const [coll, idxs] of Object.entries(INDEXES)) {
    for (const idx of idxs) {
      try {
        // 云开发 Node SDK 索引创建（如报错"createIndex is not a function"，请到云开发控制台手动建，定义见本文件）
        await db.collection(coll).createIndex({ name: idx.name, unique: !!idx.unique, keys: idx.keys });
        result.indexes.push(`${coll}.${idx.name}`);
      } catch (e) {
        result.errors.push(`index ${coll}.${idx.name}: ${e.message}`);
      }
    }
  }

  // 4.3 种子（仅当为空时插入，避免重复）
  try {
    const cnt = await db.collection('subscription_plan').count();
    if (cnt.total === 0) {
      await db.collection('subscription_plan').add({ data: SEED_PLANS });
      await db.collection('feature_permissions').add({ data: SEED_FEATURES });
      result.seeds.push('subscription_plan', 'feature_permissions');
    }
  } catch (e) {
    result.errors.push(`seed: ${e.message}`);
  }

  return result;
};
