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

  // 🔴 2026-09-19 真云缺陷修复（**本轮最大发现**）：**业务主键 ≠ `_id`**
  //   根因：`insert()` 走 `add({data})` ⇒ `_id` 由**云端自动生成**，与文档里的 `asset_id` / `material_id` /
  //   `shop_id` / `id` 等**业务主键不是同一个值**；而 `doc(id).get()` 是**按 `_id` 查**
  //   ⇒ 真云上凡用 `da.get(coll, 业务主键)` 的地方**一律返回 null**。
  //   受害 6 处（真云 100% 不可用）：`saveCostCard:103` / `syncCostCard:66`（成本卡引用原料 ⇒ RESOURCE_NOT_FOUND）
  //   / `saveAsset:44`（编辑·报废资产）/ `saveMaterial:57`（编辑物料）/ `saveShopSetting:39`
  //   / `exportData:62`（导出读不到店铺）。**反证**：`smokeTest:114/116` 传的是真 `_id`（`res._id`）⇒ 一直正常。
  //   为什么本地测不出：mock adapter 的 get 直接按业务 id 命中，**从未模拟「_id ≠ 业务主键」这一真云事实**。
  //   修法：`_id` 查不到时**按业务主键字段兜底查**（覆盖存量数据；增量数据同理）。
  //   ⚠️ 兜底字段只列**唯一性**字段 —— `card_code` **不列**（多版本模型下同 card_code 有多条，会取错版本）。
  const BIZ_KEY_FIELDS = ['id', 'material_id', 'asset_id', 'shop_id', 'account_id'];

  // 单条：软删视为不存在
  async function get(coll, id) {
    let r;
    try { r = await db.collection(coll).doc(id).get(); } catch (e) { r = null; }
    let doc = r && r.data;                   // ⚠️ doc().get() 返回结果对象 {data}
    if (!doc) {
      // 兜底：按业务主键字段查（字段不存在时 where 返回空、不报错 ⇒ 安全逐个试）
      for (let i = 0; i < BIZ_KEY_FIELDS.length && !doc; i++) {
        try {
          const q = await db.collection(coll).where({ [BIZ_KEY_FIELDS[i]]: id }).limit(1).get();
          const hit = q && q.data && q.data[0];
          if (hit) doc = hit;
        } catch (e) { /* 该字段无索引/不存在 ⇒ 忽略，试下一个 */ }
      }
    }
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
