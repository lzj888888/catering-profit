// cloudfunctions/common/dataAdapter.js
// 数据访问层（DataAdapter）：统一注入软删过滤 + 字段默认注入。
// ⚠️ 批次 0 §3 分层约束：所有数据库操作必须走本层，禁止 Controller / Service 直连 db。
//    这样"默认过滤 is_deleted=false"与"统一字段注入"对全树云函数全局生效。
//
// 复审节点①·点3：列表查询一律注入 is_deleted=false，软删数据绝不出现于任何列表。

const { nowUtc } = require('./cx_utilTime');

// 🔴 round154：**列表查询必须显式带上限**。
//   微信云开发官方口径（cloud.tencent.com/document/product/590/19368）：
//     小程序端默认且**最多** 20 条；**云函数端默认 100 条、最多 1000 条**。
//   ⇒ 不写 `.limit()` 时，**第 101 条记录起被静默截断**，且不报错、不告警。
//   本仓实测后果：菜品超过 100 道 / 原料超过 100 种 ⇒ 列表里"少了几道"，老板以为数据丢了。
//   ⚠️ 1000 是**平台硬上限**，写成更大值会在运行时直接抛错 —— 不要"顺手加大"。
//   ⚠️ 这是**正确性修复，不是性能优化**：条数不是省了，是要拿全由前端 filters 决定展示。
const LIST_LIMIT = 1000;

// 🔴 round157：**"要全部行"的读取必须分页 —— 1000 是单页上限，不是"该集合最多 1000 条"**。
//   为什么需要（与 round154 是**同一个缺陷换马甲**）：
//     round154 修的是「`list()` 不写 .limit() ⇒ 默认只返 100 条」；但抬到 1000 之后还有第二层同族截断 ——
//     凡是需要**该店全部行**的读取（成本卡列表要按 card_code 分组取最新版本、免费配额要按 card_code
//     去重计数、半成品判环要遍历全店），只要**总行数 > 1000**，第 1001 条起**照样被静默截断**。
//     `shop_cost_card` 是**版本模型（只 INSERT 不 UPDATE）** ⇒ 每保存一次就多一行（同一道菜改 50 次 = 50 行）：
//     免费档 20 张卡 × 每卡 50 版 = 1000 行 ⇒ **版本膨胀正好把 1000 条吃满**，菜品卡列表开始"静默少卡"，
//     且因为列表无排序，**丢哪张随机**。
//   ⇒ 修法：`listAll()` 用 skip/limit 循环取全。`list()` 保持原样 —— 它的语义是「展示用列表」，
//     上限就是展示上限（round154 已定案），不该为少数"要全量"的场景把成本转嫁给所有列表调用。
//   ⚠️ LIST_TOTAL_CAP 是**防爆护栏**，不是业务额度：达上限仍有剩余时返回 `truncated:true`
//      —— **显式降级，绝不静默少给**（静默才是本缺陷真正的恶）。
//      取值依据：云函数最长 20s、单页 1000 行约 0.2~0.5s ⇒ 20 页（2 万行）约 4~10s，留足余量。
const LIST_TOTAL_CAP = 20000;

function makeAdapter(db) {
  if (!db) throw new Error('DataAdapter requires a db handle');

  // 列表：is_deleted=false 是铁律 —— 放在 Object.assign 最后，不接受 extra 覆盖（A3 修复）。
  // ⚠️ extra 仅承载"过滤条件"，禁止塞 limit/orderBy 等查询选项（会变成字段过滤 → 静默空集）；
  //    需要分页/排序请走批次 4 的 opts 参数，本批次不做。
  // round154：末尾补 `.limit(LIST_LIMIT)` —— 把云函数端默认的 100 条抬到平台最大值 1000。
  // round157：**语义边界** —— 本函数是「展示用列表」，返回条数上限 = LIST_LIMIT（这是特性，不是缺陷）。
  //   需要"该店全部行"（分组取最新 / 去重计数 / 全店遍历）请显式改用 listAll()。
  async function list(coll, where, extra) {
    const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
    return db.collection(coll).where(cond).limit(LIST_LIMIT).get();
  }

  // round157：**分页取全**（突破单页 1000 的静默截断）。软删过滤与 list() 同律。
  //   返回 { data, truncated }：
  //     · truncated === false ⇒ data 就是**全部**命中行（用"短页"判据确认已取完）；
  //     · truncated === true  ⇒ data 已达 LIST_TOTAL_CAP 且仍有剩余 ⇒ 调用方**必须**把这个事实
  //       透传到出参（可见降级），不得当作"取全了"继续算。
  async function listAll(coll, where, extra) {
    const cond = Object.assign({}, extra || {}, where || {}, { is_deleted: false });
    const out = [];
    let truncated = false;
    for (let skip = 0; ; skip += LIST_LIMIT) {
      const r = await db.collection(coll).where(cond).skip(skip).limit(LIST_LIMIT).get();
      const rows = (r && r.data) || [];
      out.push(...rows);
      if (rows.length < LIST_LIMIT) break;                 // 短页 ⇒ 该条件已取完（唯一可信的"到底"判据）
      if (out.length >= LIST_TOTAL_CAP) { truncated = true; break; }
    }
    return { data: out, truncated };
  }

  // 管理端/审计需看软删数据时走此函数（显式命名，便于审计与 code review；普通列表一律用 list）
  async function listIncludingDeleted(coll, where) {
    return db.collection(coll).where(Object.assign({}, where || {})).limit(LIST_LIMIT).get();
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

  return { list, listAll, listIncludingDeleted, get, countActive, softDelete, insert };
}

module.exports = { makeAdapter, LIST_LIMIT, LIST_TOTAL_CAP };
