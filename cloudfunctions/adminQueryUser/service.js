// cloudfunctions/adminQueryUser/service.js —— 批次 6/7 · 用户查询纯函数（可单测，不接触 wx-server-sdk）
//
// R53（A 类加固）：用户店铺列表分页累取到耗尽，杜绝 limit(20) 静默截断。
//   M1 账套硬上限 200（checkQuota.HARD_LIMIT.shop），故 100/页 × 5 = 500 覆盖全部合法数据；
//   超过安全上限 → **响亮失败**（复用 HARD_CAP_EXCEEDED，不新增错误码），不静默少显示。
//
// R63（A 类加固续）：把「取尽」判据依赖的两个**未验证前提**升级为可关闭的缺口 ——
//   前提①「平台如实返回所请求条数」：若平台对 limit 有更低上限（或某些条件下少返回），
//     首页即 `arr.length < SHOP_PAGE` ⇒ 直接 break ⇒ **静默少显示**，与 R53 要杀的原始病同族。
//     ⇒ 修法：短页后补一次**探针查询**（只多取 1 条）确证耗尽，确证不了就继续翻页。
//   前提②「返回形态恒为 { data: [] }」：形态漂移时若静默归一为 []，会被上游当成"取尽"
//     ⇒ **静默成功但为空**（正是本仓 `doc().get()` 被当文档本体用的同类事故）。
//     ⇒ 修法：**形态守卫**放在注入点（生产路径），形态异常一律**响亮失败**。
//   两处错误码均**复用既有码**（core/09 / common/errors.js），不新增 —— 故 A–L 门禁的
//   「错误码三向同步」不受扰动。

const SHOP_PAGE = 100;
const SHOP_MAX_PAGES = 5; // 500 ≥ 硬上限 200

/** R63 · 查询返回形态异常（期望 { data: [] }）—— 响亮失败，不静默归一为空数组。 */
function invalidShapeError() {
  const e = new Error('查询返回形态异常（期望 { data: [] }）');
  e.code = 'SYSTEM_ERROR';   // 复用既有错误码（core/09 §1.7），不新增
  return e;
}

/**
 * R63 · 取数结果归一 + 形态守卫：null/undefined → []（等价"无数据"）；
 * **非数组 ≠ 无数据** → 响亮失败（防形态漂移被当成"取尽"）。
 * @param {*} x 注入方返回的原始值
 * @returns {Array} 行数组
 * @throws {object} { code:'SYSTEM_ERROR' } 形态异常
 */
function asRows(x) {
  if (x == null) return [];
  if (!Array.isArray(x)) throw invalidShapeError();
  return x;
}

/**
 * R63 · 构造店铺分页查询器（注入 collection 句柄，可单测）。
 * 形态守卫放在**注入点** ⇒ 生产路径上"静默空"变成"响亮失败"。
 * @param {object} coll 注入的 collection 句柄（db.collection('shop')；测试可注入假句柄）
 * @param {object|null} where 查询条件（null/undefined → 不带 where）
 * @returns {function} async (skip, limit) => Array
 */
function makeShopPageQuery(coll, where) {
  return async (skip, limit) => {
    let q = coll;
    if (where != null) q = q.where(where);
    q = q.skip(skip).limit(limit);
    const res = await q.get();
    if (res == null || !Array.isArray(res.data)) throw invalidShapeError();
    return res.data;
  };
}

/**
 * 分页累取某用户全部活跃店铺（R53 取尽 + R63 探针确证）。
 * @param {function} fetchChunk async (skip:number, limit:number) => Array —— 调用方注入
 * @returns {Promise<Array>} 全部店铺
 * @throws {object} { code:'HARD_CAP_EXCEEDED' } 达到安全上限（响亮失败）
 * @throws {object} { code:'SYSTEM_ERROR' } 分页取数形态异常（响亮失败）
 */
async function fetchShopsAll(fetchChunk) {
  const shops = [];
  let page = 0;
  for (;;) {
    // ⚠️ 上限检查放在**循环顶部**（而非"满页后"）：R63 探针非空会 `continue`，
    //   若此时页数配额已尽，必须在下一轮顶部**响亮失败** —— 否则会静默返回部分数据
    //   （那正是 R63 要杀的病，比不探针更隐蔽）。
    if (page >= SHOP_MAX_PAGES) {
      const e = new Error(`该用户店铺数超过安全上限（${SHOP_MAX_PAGES * SHOP_PAGE}），请缩小范围或联系客服`);
      e.code = 'HARD_CAP_EXCEEDED';          // 复用既有错误码（不新增）
      throw e;
    }
    // ⚠️ offset 用 shops.length（而非 page * SHOP_PAGE）：探针非空时页起点须随之平移，
    //    否则"短页 + 数据仍在"场景会把中间一段静默跳过。
    const chunk = await fetchChunk(shops.length, SHOP_PAGE);
    const arr = asRows(chunk);
    shops.push.apply(shops, arr);
    if (arr.length < SHOP_PAGE) {
      // R63：短页 ≠ 一定耗尽 —— 补一次探针（只多取 1 条）确证。
      //   探针为空 ⇒ 确证耗尽（正常出口）；探针非空 ⇒ 平台返回条数低于请求值，
      //   **继续下一页**（offset 已用动态值，探针那条不会被跳过也不重复）。
      const probe = asRows(await fetchChunk(shops.length, 1));
      if (probe.length === 0) break;
      page++;
      continue;
    }
    page++;
  }
  return shops;
}

module.exports = { fetchShopsAll, makeShopPageQuery, asRows, SHOP_PAGE, SHOP_MAX_PAGES };
