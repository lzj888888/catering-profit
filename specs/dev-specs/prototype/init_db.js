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
    //   ⚠️ 上线前必须**另外建索引**（wx-server-sdk 无 createIndex，A7 已定案 ⇒ 本函数建不上）。
    //     建法三选一（2026-09-17 更新，旧口径「只能靠人在控制台填」已证伪）：
    //     ① 脚本化（首选）`node tools/apply_indexes.js --apply --secret-file <文件>`（官方 HTTP API，幂等可回读）；
    //     ② GUI 键鼠自动驾驶（无密钥，实证 40/40，脚本见 review/evidence/index_buildout_20260917/scripts/）；
    //     ③ 控制台逐条填（兜底，照 `索引补齐核对单.md`）。
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

// ===== A3（批次 8）：收入/费用分类配置种子（shop_income_item / shop_expense_item）=====
// 结构对齐 A1（费用四大类 = 运营/人工/营销/其他）与 02 数据集 S1；
// ⚠️ 营销类「外卖平台佣金」「团购平台佣金」为**独立细项，不合并**（04 核对清单 阶段 2）。
const SEED_INCOME_ITEMS = [
  { item_key: 'income_dine_cash',       item_name: '现金',         category: 'dine_in',  sort_order: 10, enabled: true, is_system: true },
  { item_key: 'income_dine_wepay',      item_name: '微信支付宝',   category: 'dine_in',  sort_order: 20, enabled: true, is_system: true },
  { item_key: 'income_dine_stored',     item_name: '储值消费',     category: 'dine_in',  sort_order: 30, enabled: true, is_system: true },
  { item_key: 'income_dine_groupon',    item_name: '团购券核销',   category: 'dine_in',  sort_order: 40, enabled: true, is_system: true },
  { item_key: 'income_dine_credit',     item_name: '企业挂账消费', category: 'dine_in',  sort_order: 50, enabled: true, is_system: true },
  { item_key: 'income_takeaway_goods',  item_name: '商品总价',     category: 'takeaway', sort_order: 10, enabled: true, is_system: true },
  { item_key: 'income_takeaway_pack',   item_name: '打包费',       category: 'takeaway', sort_order: 20, enabled: true, is_system: true },
  { item_key: 'income_takeaway_subsidy', item_name: '商家活动补贴', category: 'takeaway', sort_order: 30, enabled: true, is_system: true },
  { item_key: 'income_other_scrap',     item_name: '废品变卖',     category: 'other',    sort_order: 10, enabled: true, is_system: true },
  { item_key: 'income_other_premade',   item_name: '预制菜零售',   category: 'other',    sort_order: 20, enabled: true, is_system: true },
];
const SEED_EXPENSE_ITEMS = [
  { item_key: 'exp_op_rent',            item_name: '房租',         category: 'operation', sort_order: 10, enabled: true, is_system: true },
  { item_key: 'exp_op_property',        item_name: '物业费',       category: 'operation', sort_order: 20, enabled: true, is_system: true },
  { item_key: 'exp_op_water',           item_name: '水费',         category: 'operation', sort_order: 30, enabled: true, is_system: true },
  { item_key: 'exp_op_electric',        item_name: '电费',         category: 'operation', sort_order: 40, enabled: true, is_system: true },
  { item_key: 'exp_op_gas',             item_name: '燃气费',       category: 'operation', sort_order: 50, enabled: true, is_system: true },
  { item_key: 'exp_op_trash',           item_name: '垃圾清运费',   category: 'operation', sort_order: 60, enabled: true, is_system: true },
  { item_key: 'exp_op_network',         item_name: '宽带网费',     category: 'operation', sort_order: 70, enabled: true, is_system: true },
  { item_key: 'exp_labor_salary',       item_name: '工资绩效',     category: 'labor',     sort_order: 10, enabled: true, is_system: true },
  { item_key: 'exp_labor_social',       item_name: '社保',         category: 'labor',     sort_order: 20, enabled: true, is_system: true },
  { item_key: 'exp_labor_dorm',         item_name: '员工宿舍',     category: 'labor',     sort_order: 30, enabled: true, is_system: true },
  { item_key: 'exp_labor_meal',         item_name: '员工餐',       category: 'labor',     sort_order: 40, enabled: true, is_system: true },
  { item_key: 'exp_labor_uniform',      item_name: '工装福利',     category: 'labor',     sort_order: 50, enabled: true, is_system: true },
  { item_key: 'exp_mkt_takeaway_com',   item_name: '外卖平台佣金',   category: 'marketing', sort_order: 10, enabled: true, is_system: true },
  { item_key: 'exp_mkt_takeaway_deliv', item_name: '外卖配送服务费', category: 'marketing', sort_order: 20, enabled: true, is_system: true },
  { item_key: 'exp_mkt_takeaway_subsidy', item_name: '外卖活动补贴', category: 'marketing', sort_order: 30, enabled: true, is_system: true },
  { item_key: 'exp_mkt_takeaway_delivsub', item_name: '外卖配送补贴', category: 'marketing', sort_order: 40, enabled: true, is_system: true },
  { item_key: 'exp_mkt_takeaway_promo', item_name: '外卖推广费',     category: 'marketing', sort_order: 50, enabled: true, is_system: true },
  { item_key: 'exp_mkt_groupon_com',    item_name: '团购平台佣金',   category: 'marketing', sort_order: 60, enabled: true, is_system: true },
  { item_key: 'exp_other_accounting',   item_name: '代账费',       category: 'other',     sort_order: 10, enabled: true, is_system: true },
  { item_key: 'exp_other_misc',         item_name: '其他杂项',     category: 'other',     sort_order: 20, enabled: true, is_system: true },
];

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
  // 未配置白名单时给出启动告警（不阻断）：启发式分支的安全性依赖"prod 环境 ID 含 prod 子串"这一否定式假设，
  // 若将来有人把生产环境命名成 catering-live-dev / catering-release-dev（含 dev、不含 prod）会被放行。
  if (!DEV_ENV_ID) console.warn('[GATE] DEV_ENV_ID 未配置，initDb 当前走启发式匹配（依赖环境命名约定），建议配置为精确白名单');
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
      // 兼容英文(already/exist/EXISTS)与中文(已存在)等措辞，避免重跑时把"集合已存在"噪声误记进 errors
      if (!/already|exist|EXISTS|已存在|已建|冲突/i.test(e.message || '')) {
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
    // A3：收入/费用分类配置种子（shop_income_item / shop_expense_item）
    const incCnt = await db.collection('shop_income_item').count();
    if (incCnt.total === 0) {
      await db.collection('shop_income_item').add({ data: SEED_INCOME_ITEMS });
      result.seeds.push('shop_income_item');
    }
    const expCnt = await db.collection('shop_expense_item').count();
    if (expCnt.total === 0) {
      await db.collection('shop_expense_item').add({ data: SEED_EXPENSE_ITEMS });
      result.seeds.push('shop_expense_item');
    }
  } catch (e) {
    result.errors.push(`seed: ${e.message}`);
  }

  return result;
};
