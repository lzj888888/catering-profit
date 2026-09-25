// cloudfunctions/initDb/index.js
// 一次性建库云函数（仅 dev 手动运行一次）。部署为云函数 initDb。
// 依赖：安装 wx-server-sdk（见 package.json）。
// ⚠️ prod 25 张集合由云开发控制台创建，本函数**绝不部署到 prod**（见 gate 门禁）。
//    （这是**政策**，不是能力限制：本函数在 dev 侧能建集合；"不部署到 prod"是刻意的风险控制，
//     与「索引能不能代码建」是两件事 —— 后者见 collections.js 顶部与 tools/apply_indexes.js。）
//
// 入参（可选）：
//   {}                      → 全量：建集合 + 建索引 + 补种（默认，与历史行为一致）
//   { only: 'seed_missing' } → **轻量补种通道**：只补缺失的种子行，不碰集合/索引（round122 新增，见下）
//
// ⚠️ 种子幂等语义（round122 修正，R20 登记的那句「重复执行不产生第二条种子」仍然成立）：
//   旧实现把 `feature_permissions` 的播种挂在「`subscription_plan` 整表为空」这个**总闸**下 ⇒
//   已建库环境（播过一次后 subscription_plan 非空）**永远无法再新增种子行**。
//   M3 免费配额行 `plan_free` 正是这样卡住的：代码已合入、云端就是没有该行 ⇒
//   `checkQuota` 读不到 `limits` ⇒ fail-closed 返回 SYSTEM_ERROR ⇒ 配额相关调用全站报错。
//   ⇒ 判定粒度由「整表」细化到「整行（plan_id + feature_key）」：缺失者补插、已存在者跳过。

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

  // ⚡ 轻量补种通道（round122）：只补种，不建表、不建索引，**必须放在最前**。
  //   为什么需要它：默认路径要跑 25 次 createCollection + 40 次 createIndex，
  //   而线上云函数默认 timeout 可能只有 3s（R86 未闭环）⇒ 补种请求往往**走不到播种那一步就被超时掐死**，
  //   表现出来是「调用失败」而不是「补种成功」⇒ 会让人误判成"播种逻辑坏了"。
  //   已建库环境补**新增**种子行时走这条（实测 < 1s）。
  if (event && event.only === 'seed_missing') {
    await seedPlans(result);
    await seedFeaturePermissions(result);
    return result;
  }

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

  // 3. 种子（幂等；与轻量通道共用同一实现，避免两处漂移）
  await seedPlans(result);
  await seedFeaturePermissions(result);

  // 成功：不设置 blocked 字段 → 返回结果中 blocked === undefined（复审点5）
  return result;
};

// ===== 种子子过程 =====

// subscription_plan：仅当整表为空时插入（价格表是全量替换语义，无逐行补的必要）
async function seedPlans(result) {
  try {
    const cnt = await db.collection('subscription_plan').count();
    if (cnt.total === 0) {
      await db.collection('subscription_plan').add({ data: SEED_PLANS });
      result.seeds.push('subscription_plan');
    }
  } catch (e) {
    result.errors.push(`seed subscription_plan: ${e.message}`);
  }
}

// feature_permissions：逐 (plan_id, feature_key) 幂等补种
async function seedFeaturePermissions(result) {
  try {
    const CAP = 1000;
    const exist = await db.collection('feature_permissions')
      .field({ plan_id: true, feature_key: true }).limit(CAP).get();
    const rows = (exist && exist.data) || [];
    if (rows.length >= CAP) {
      // fail-closed：比对不全时**拒绝盲目补插**（否则可能插出重复行）
      result.errors.push(`seed feature_permissions: 行数达分页上限 ${CAP}，未能全量比对，已跳过补种`);
      return;
    }
    const have = new Set(rows.map((r) => `${r.plan_id}::${r.feature_key}`));
    for (const row of SEED_FEATURES) {
      const key = `${row.plan_id}::${row.feature_key}`;
      if (have.has(key)) continue;
      await db.collection('feature_permissions').add({ data: row });
      result.seeds.push(`feature_permissions:${key}`);
    }
  } catch (e) {
    result.errors.push(`seed feature_permissions: ${e.message}`);
  }
}
