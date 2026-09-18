// cloudfunctions/smokeTest/index.js
// 一次性云侧探针：答 A7 / require('./common') / doc().get() 契约 三个从没在真 wx-server-sdk 上验证过的前提。
// 🔴 它**不答 A6**：`uniqueEnforce` 零证明力（2026-09-18 裁定）——  A6 的唯一证据是"真集合上手工插入重复三元组被拒"。
// 部署后在云开发控制台「云函数 → smokeTest → 测试」用空 {} 触发，看返回 JSON。
// ⚠️ 本函数刻意不依赖任何本沙箱行为；价值只在「跑到真云上」。删除：跑完去控制台手动删 probe_tmp 集合（SDK 不能 drop collection）。
const cloud = require('wx-server-sdk');
const fs = require('fs');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ⚠️ 2026-09-15 实测：集合名**不能以下划线开头**（微信报 -501007 invalid parameters），故由 __probe 改名
const PROBE = 'probe_tmp';

// ① require('./common') 是否可解析（不可解析则整个函数起不来——用 try 包住以便同时答其余三条）
let commonOk = false, commonErr = null, common = null;
try { common = require('./common'); commonOk = true; }
catch (e) {
  commonErr = e.message;
  // ⚠️ R29（round 12）：扁平化后包内只有 `common.js`、**没有** `common/` 目录，
  //    所以下面的 fallback **永不可能成功** —— 保留它只是为了在探针输出里留下
  //    「目录形态在云端确实不可用」的证据，**别把它当修复手段**。
  //    真判据是 fsDiag.hasCommonFile / commonShape（见 ①b）。
  //    （2026-09-15 云端曾报 Cannot find module './common'）
  try { common = require('./common/index.js'); commonOk = true; commonErr = 'fallback ok: ' + e.message; }
  catch (e2) { commonErr = e.message + ' || fallback(预期失败): ' + e2.message; }
}

// ①b 云端文件清单自检（诊断用：确认 common 到底以**什么形态**被打进包）
//     R29（round 12）：扁平化之后 `hasCommonDir` 恒 false —— 这个字段名读起来像"common 没打进包"，
//     ① 是误导、② 掩盖了真实形态。故补 `hasCommonFile`（common.js 存在性）作**真判据**，
//     并给出三态结论 `commonShape`，看一眼就知道是扁平文件 / 目录 / 真缺失。
let fsDiag = {};
try {
  fsDiag.root = fs.readdirSync(__dirname);
  fsDiag.hasCommonFile = fs.existsSync(__dirname + '/common.js');  // ← 真判据（扁平形态）
  fsDiag.hasCommonDir = fs.existsSync(__dirname + '/common');      // ← 扁平化后恒 false，勿据此判"没打进包"
  fsDiag.common = fsDiag.hasCommonDir ? fs.readdirSync(__dirname + '/common') : null;
  fsDiag.commonShape = fsDiag.hasCommonFile
    ? 'flat-file(common.js)'
    : (fsDiag.hasCommonDir ? 'dir(common/)' : 'ABSENT(common 未打进包)');
  fsDiag.cwd = process.cwd();
} catch (e) { fsDiag = { THROW: e.message }; }

// ⚠️ ⑥ 段（真集合唯一约束实测）**默认不跑**，靠入参 `{ uniq: 'cc' | 'user' | 'shop' | 'all' }` 触发。
//   为什么：线上 `smokeTest` 的 timeout 仍是平台默认 **3 秒**（R86 未闭环），
//   而 ⑥ 段有 6 次真库往返 ⇒ 全量跑容易超时拿不到结果。拆成单项跑 = 每项都在 3 秒内。
//   默认行为与历史 runbook 完全一致（不加 ⑥），已归档的证据不受影响。
exports.main = async (event) => {
  const out = {
    env: '', fsDiag, requireCommon: {}, createCollection: {}, createIndex: {}, docGet: {},
    docGetMissing: {}, uniqueEnforce: {}, assertShopOwner: {}, dataAdapterGet: {},
    uniqueReal: {},
  };

  // 确保探针集合存在（建索引/写入前先建集合，避免对不存在集合操作报无意义错）
  try { await db.createCollection(PROBE); out.createCollection = { ok: true }; }
  catch (e) { out.createCollection = { ok: false, msg: e.message }; }  // 「已存在」属正常，看 msg 判读

  // 环境（顺带确认 env 取值与门禁判据一致）
  try { out.env = String(cloud.getWXContext().ENV || process.env.TCB_ENV || ''); }
  catch (e) { out.env = 'ERR:' + e.message; }

  out.requireCommon = { ok: commonOk, err: commonErr, exports: common ? Object.keys(common) : null };

  // ② createIndex 是否存在（答 A7；已定案 = **不支持**，此处只作复核——typeof=undefined 即符合预期，勿据此再改结论）
  try {
    const coll = db.collection(PROBE);
    out.createIndex.typeof = typeof coll.createIndex;
    if (typeof coll.createIndex === 'function') {
      await coll.createIndex({ name: 'idx_probe_k', unique: true, keys: { k: 1 } });
      out.createIndex.call = 'OK（未抛异常）';
    }
  } catch (e) { out.createIndex.call = 'THROW: ' + (e.errCode || e.code || '') + ' ' + e.message; }

  // ③ doc().get() 返回形状（答 A1/A2 —— 若 hasDataField=false，则 A1/A2 修法错误须回退）
  try {
    const addRes = await db.collection(PROBE).add({ data: { k: 'probe_' + Date.now(), is_deleted: false, created_at: Date.now() } });
    const id = addRes._id;
    const got = await db.collection(PROBE).doc(id).get();
    out.docGet = {
      topLevelKeys: Object.keys(got || {}),
      hasDataField: !!(got && got.data),
      dataKeys: got && got.data ? Object.keys(got.data) : null,
      id: id,
    };
  } catch (e) { out.docGet = { THROW: e.message }; }

  // ④ 文档不存在时：reject 还是 {data:null}（答 A1 的 try/catch 是否必需）
  try {
    const miss = await db.collection(PROBE).doc('__definitely_not_exist__').get();
    out.docGetMissing = { behavior: 'resolve', topLevelKeys: Object.keys(miss || {}), data: miss && miss.data === null ? 'null' : typeof (miss && miss.data) };
  } catch (e) { out.docGetMissing = { behavior: 'reject', message: e.message }; }

  // ② 续：唯一约束自检 —— 🔴 本项**零证明力、不作判据**（2026-09-18 复核裁定；此前文案印的是旧结论，已废）
  //    PROBE 集合上从未建过 `idx_probe_k`（A7 已定案：SDK 无 createIndex）⇒ 插入同 k「不报错」是**必然**结果。
  //    两条禁令：① **不得**据此升级 A6（"唯一约束不可用"）；② **不得**据任何取值回退既有结论。
  //    真实的唯一性证据只有一条：在**真集合**上手工插入重复三元组被拒（见 SMOKETEST_RUNBOOK 步骤 5 / 执行单 §3）。
  try {
    await db.collection(PROBE).add({ data: { k: 'dup_test' } });
    await db.collection(PROBE).add({ data: { k: 'dup_test' } });
    out.uniqueEnforce = { result: '未报错（预期内）', proof: 'none', note: '本集合无该 unique 索引 ⇒ 不报错是必然；不得据此判定 A6/A7' };
  } catch (e) {
    out.uniqueEnforce = { result: '报错', proof: 'partial', note: '仅说明存在某项唯一约束，仍不构成 A6 证据', message: e.message };
  }

  // ⑤ 在真云上跑一次 A1 的落点（应当返回 RESOURCE_NOT_FOUND，而不是抛异常/恒 FORBIDDEN）
  if (commonOk && typeof common.assertShopOwner === 'function') {
    try { out.assertShopOwner = await common.assertShopOwner(db, '__no_such_shop__', 'u_probe'); }
    catch (e) { out.assertShopOwner = { THROW: e.message }; }
  } else {
    out.assertShopOwner = { skipped: !commonOk ? 'common 未加载' : 'assertShopOwner 未导出' };
  }

  // ⑤b 直接验 A2 落点：dataAdapter.get 对软删文档必须返回 null（真 SDK 上）
  if (commonOk && common.dataAdapter && typeof common.dataAdapter.makeAdapter === 'function') {
    try {
      const da = common.dataAdapter.makeAdapter(db);
      const res = await db.collection(PROBE).add({ data: { k: 'soft_del', is_deleted: false, created_at: Date.now() } });
      const live = await da.get(PROBE, res._id);
      await db.collection(PROBE).doc(res._id).update({ data: { is_deleted: true } });
      const dead = await da.get(PROBE, res._id);
      out.dataAdapterGet = { liveIsDoc: !!(live && live.k === 'soft_del' && !live.data), deadIsNull: dead === null };
    } catch (e) { out.dataAdapterGet = { THROW: e.message }; }
  } else {
    out.dataAdapterGet = { skipped: !commonOk ? 'common 未加载' : 'dataAdapter.makeAdapter 未导出' };
  }

  // ===== ⑥ 真集合唯一约束实测（§3 / A6a / A6b）=====
  // 为什么加这一段：这三条此前**只能靠控制台 GUI 手工插重复三元组**（属人工面，一直挂着重）。
  //   smokeTest 有裸写库能力 ⇒ 可以程序化完成，且**自带清理**（按显式 `_id` 删除，不留垃圾）。
  // 🔴 判读纪律（勿反）：
  //   写入「成功」= 该键**没有**唯一兜底；写入「被拒」= 唯一约束**真生效**。
  //   §3  = `idx_card_code_version`(shop_id+card_code+version, unique) ⇒ 重复三元组**必须被拒**；
  //   A6a = `user.idx_openid`(unique)                                 ⇒ 重复 openid **必须被拒**；
  //   A6b = `shop.idx_shop_user`(**非** unique)                        ⇒ 同 user_id **应当成功**（= 无兜底，正是风险点）。
  const P = 'zz_probe_';
  const tryAdd = async (coll, data) => {
    try { const r = await db.collection(coll).add({ data }); return { ok: true, _id: r._id }; }
    catch (e) { return { ok: false, code: e.errCode || e.code || '', msg: e.message }; }
  };
  const tryRemove = async (coll, id) => {
    try { await db.collection(coll).doc(id).remove(); return true; } catch (e) { return false; }
  };
  const judge = (a, b, enforceExpected) => {
    if (!a.ok) return 'INCONCLUSIVE（首次写入就失败，集合/权限问题，非索引结论）';
    if (enforceExpected) return b.ok ? '❌ NOT_ENFORCED（重复写入成功 ⇒ 索引未生效）' : '✅ UNIQUE_ENFORCED（重复被拒）';
    return b.ok ? '✅ NO_UNIQUE_BACKSTOP（预期内：该键确实无唯一兜底）' : '⚠️ UNEXPECTED_REJECT（本应放行却被拒 ⇒ 索引与单源不符）';
  };
  const W = String((event && event.uniq) || '');            // '' = 不跑（默认）；'cc' / 'user' / 'shop' / 'all'
  const want = (k) => W === 'all' || W === k;
  try {
    // §3 · shop_cost_card 三元组（unique: shop_id + card_code + version）
    if (want('cc')) {
      const base = { shop_id: P + 'shop', card_code: P + 'card', version: 1, name: 'probe', created_at: Date.now() };
      const a = await tryAdd('shop_cost_card', Object.assign({ _id: P + 'cc1' }, base));
      const b = await tryAdd('shop_cost_card', Object.assign({ _id: P + 'cc2' }, base));
      out.uniqueReal.idx_card_code_version = { first: a, second: b, verdict: judge(a, b, true) };
      out.uniqueReal.cleanup_cc = {
        cc1: await tryRemove('shop_cost_card', P + 'cc1'),
        cc2: await tryRemove('shop_cost_card', P + 'cc2'),
      };
    }
    // A6a · user.openid（unique）⇒ 重复 openid 必须被拒
    if (want('user')) {
      const a = await tryAdd('user', { _id: P + 'u1', openid: P + 'openid', user_id: P + 'uid1', created_at: Date.now() });
      const b = await tryAdd('user', { _id: P + 'u2', openid: P + 'openid', user_id: P + 'uid2', created_at: Date.now() });
      out.uniqueReal.A6a_user_openid = { first: a, second: b, verdict: judge(a, b, true) };
      out.uniqueReal.cleanup_user = {
        u1: await tryRemove('user', P + 'u1'),
        u2: await tryRemove('user', P + 'u2'),
      };
    }
    // A6b · shop.user_id（**非** unique）⇒ 同 user_id 应能建出两个店 = 无兜底（预期内，正是风险点）
    if (want('shop')) {
      const base = { user_id: P + 'sameuser', name: 'probe', created_at: Date.now() };
      const a = await tryAdd('shop', Object.assign({ _id: P + 's1', shop_id: P + 's1' }, base));
      const b = await tryAdd('shop', Object.assign({ _id: P + 's2', shop_id: P + 's2' }, base));
      out.uniqueReal.A6b_shop_user_id = { first: a, second: b, verdict: judge(a, b, false) };
      out.uniqueReal.cleanup_shop = {
        s1: await tryRemove('shop', P + 's1'),
        s2: await tryRemove('shop', P + 's2'),
      };
    }
    if (!W) out.uniqueReal.skipped = "未触发：入参加 { uniq: 'cc' | 'user' | 'shop' | 'all' } 才跑（线上 timeout=3s，拆项跑）";
  } catch (e) {
    out.uniqueReal = { THROW: e.message };
  }

  return out;
};
