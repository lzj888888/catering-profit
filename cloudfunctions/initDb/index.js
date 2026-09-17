// cloudfunctions/initDb/index.js
// 一次性建库云函数（仅 dev 手动运行一次）。部署为云函数 initDb。
// 依赖：安装 wx-server-sdk（见 package.json）。
// ⚠️ prod 25 张集合由云开发控制台创建，本函数**绝不部署到 prod**（见 gate 门禁）。
//    （这是**政策**，不是能力限制：本函数在 dev 侧能建集合；"不部署到 prod"是刻意的风险控制，
//     与「索引能不能代码建」是两件事 —— 后者见 collections.js 顶部与 tools/apply_indexes.js。）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { COLLECTIONS, INDEXES, SEED_PLANS, SEED_FEATURES, gate } = require('./collections');

exports.main = async (event, context) => {
  // ===== 环境门禁（与 collections.gate 共享逻辑；失败方向一律关闭，blocked 字段不回传 env 值）=====
  // env 取值：优先 cloud.getWXContext().ENV，为空或抛错时回落 process.env.TCB_ENV（兜底写在 try 内）
  let env = '';
  try { env = String(cloud.getWXContext().ENV || process.env.TCB_ENV || ''); } catch (e) { env = String(process.env.TCB_ENV || ''); }
  const g = gate(env, process.env.DEV_ENV_ID);
  if (g.blocked) {
    console.error(`[INITDB_BLOCKED] env="${env}" 非 dev 环境，禁止建库与播种演示数据`);
    return { blocked: true, reason: g.reason };
  }

  const result = { created: [], indexes: [], seeds: [], errors: [] };

  // 1. 建集合（已存在则跳过）
  for (const c of COLLECTIONS) {
    try {
      await db.createCollection(c);
      result.created.push(c); // 复审点5：fresh dev 环境此处应有 25 项
    } catch (e) {
      if (!/already|exist|EXISTS|已存在|已建|冲突/i.test(e.message || '')) {
        result.errors.push(`create ${c}: ${e.message}`);
      }
    }
  }

  // 2. 建索引（SDK 版本差异可能不支持，失败记日志可在控制台手动补）
  for (const [coll, idxs] of Object.entries(INDEXES)) {
    for (const idx of idxs) {
      try {
        await db.collection(coll).createIndex({ name: idx.name, unique: !!idx.unique, keys: idx.keys });
        result.indexes.push(`${coll}.${idx.name}`);
      } catch (e) {
        result.errors.push(`index ${coll}.${idx.name}: ${e.message}`);
      }
    }
  }

  // 3. 种子（仅当为空时插入，避免重复）
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

  // 成功：不设置 blocked 字段 → 返回结果中 blocked === undefined（复审点5）
  return result;
};
