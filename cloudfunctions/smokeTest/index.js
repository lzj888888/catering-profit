// cloudfunctions/smokeTest/index.js
// 一次性云侧探针：答 A6 / A7 / require('./common') / doc().get() 契约 四个从没在真 wx-server-sdk 上验证过的前提。
// 部署后在云开发控制台「云函数 → smokeTest → 测试」用空 {} 触发，看返回 JSON。
// ⚠️ 本函数刻意不依赖任何本沙箱行为；价值只在「跑到真云上」。删除：跑完去控制台手动删 __probe 集合（SDK 不能 drop collection）。
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
  // 兜底：目录解析失败时直接指到 index.js（2026-09-15 云端曾报 Cannot find module './common'）
  try { common = require('./common/index.js'); commonOk = true; commonErr = 'fallback ok: ' + e.message; }
  catch (e2) { commonErr = e.message + ' || fallback: ' + e2.message; }
}

// ①b 云端文件清单自检（诊断用：确认 common/ 到底有没有被打进包）
let fsDiag = {};
try {
  fsDiag.root = fs.readdirSync(__dirname);
  fsDiag.hasCommonDir = fs.existsSync(__dirname + '/common');
  fsDiag.common = fsDiag.hasCommonDir ? fs.readdirSync(__dirname + '/common') : null;
  fsDiag.cwd = process.cwd();
} catch (e) { fsDiag = { THROW: e.message }; }

exports.main = async () => {
  const out = {
    env: '', fsDiag, requireCommon: {}, createCollection: {}, createIndex: {}, docGet: {},
    docGetMissing: {}, uniqueEnforce: {}, assertShopOwner: {}, dataAdapterGet: {},
  };

  // 确保探针集合存在（建索引/写入前先建集合，避免对不存在集合操作报无意义错）
  try { await db.createCollection(PROBE); out.createCollection = { ok: true }; }
  catch (e) { out.createCollection = { ok: false, msg: e.message }; }  // 「已存在」属正常，看 msg 判读

  // 环境（顺带确认 env 取值与门禁判据一致）
  try { out.env = String(cloud.getWXContext().ENV || process.env.TCB_ENV || ''); }
  catch (e) { out.env = 'ERR:' + e.message; }

  out.requireCommon = { ok: commonOk, err: commonErr, exports: common ? Object.keys(common) : null };

  // ② createIndex 是否存在 / 可用（答 A7）
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

  // ② 续：unique 索引是否真的生效（插入重复 k）
  try {
    await db.collection(PROBE).add({ data: { k: 'dup_test' } });
    await db.collection(PROBE).add({ data: { k: 'dup_test' } });
    out.uniqueEnforce = { result: '未报错 → unique 索引可能未生效（A7 判定为「索引不可用」）' };
  } catch (e) { out.uniqueEnforce = { result: '报错（符合预期）', message: e.message }; }

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

  return out;
};
