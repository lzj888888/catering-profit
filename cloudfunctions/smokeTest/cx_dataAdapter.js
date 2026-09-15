// cloudfunctions/common/dataAdapter.js
// 数据访问层（DataAdapter）：统一注入软删过滤 + 字段默认注入。
// ⚠️ 批次 0 §3 分层约束：所有数据库操作必须走本层，禁止 Controller / Service 直连 db。
//    这样"默认过滤 is_deleted=false"与"统一字段注入"对全树云函数全局生效。
//
// 复审节点①·点3：列表查询一律注入 is_deleted=false，软删数据绝不出现于任何列表。

const { nowUtc } = require('./cx_utilTime');

function makeAdapter(db) {
  if (!db) throw new Error('DataAdapter requires a db handle');

  // 列表：is_deleted=false 是铁律 —— 放在 Object.assign 最后，不接受 extra 覆盖（A3 修复）。
  // ⚠️ extra 仅承载"过滤条件"，禁止塞 limit/orderBy 等查询选项（会变成字段过滤 → 静默空集）；
  //    需要分页/排序请走批次 4 的 opts 参数，本批次不做。
  async function list(coll, where, extra) {
    const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
    return db.collection(coll).where(cond).get();
  }

  // 管理端/审计需看软删数据时走此函数（显式命名，便于审计与 code review；普通列表一律用 list）
  async function listIncludingDeleted(coll, where) {
    return db.collection(coll).where(Object.assign({}, where || {})).get();
  }

  // 单条：软删视为不存在
  async function get(coll, id) {
    let r;
    try { r = await db.collection(coll).doc(id).get(); } catch (e) { return null; }
    const doc = r && r.data;                 // ⚠️ doc().get() 返回结果对象 {data}
    if (!doc || doc.is_deleted) return null; // 软删视为不存在
    return doc;
  }

  // 计数：仅活跃（is_deleted=false）。免费配额计数即基于此（v1.4 §10.5 软删不占额）
  async function countActive(coll, where) {
    const cond = Object.assign({}, where || {}, { is_deleted: false });
    return db.collection(coll).where(cond).count();
  }

  // 软删：写 is_deleted=true + delete_at + delete_by（绝不物理删除）
  async function softDelete(coll, id, operatorId) {
    return db.collection(coll).doc(id).update({
      data: { is_deleted: true, delete_at: nowUtc(), delete_by: operatorId || '' },
    });
  }

  // 插入：默认注入 created_at / updated_at / is_deleted=false
  async function insert(coll, data) {
    const now = nowUtc();
    return db.collection(coll).add({
      data: Object.assign({ created_at: now, updated_at: now, is_deleted: false }, data),
    });
  }

  return { list, listIncludingDeleted, get, countActive, softDelete, insert };
}

module.exports = { makeAdapter };
