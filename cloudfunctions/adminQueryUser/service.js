// cloudfunctions/adminQueryUser/service.js —— 批次 6/7 · 用户查询纯函数（可单测，不接触 wx-server-sdk）
//
// R53（A 类加固）：用户店铺列表分页累取到耗尽，杜绝 limit(20) 静默截断。
//   M1 账套硬上限 200（checkQuota.HARD_LIMIT.shop），故 100/页 × 5 = 500 覆盖全部合法数据；
//   超过安全上限 → **响亮失败**（复用 HARD_CAP_EXCEEDED，不新增错误码），不静默少显示。

const SHOP_PAGE = 100;
const SHOP_MAX_PAGES = 5; // 500 ≥ 硬上限 200

/**
 * 分页累取某用户全部活跃店铺。
 * @param {function} fetchChunk async (skip:number, limit:number) => Array —— 调用方注入
 * @returns {Promise<Array>} 全部店铺
 * @throws {object} { code:'HARD_CAP_EXCEEDED' } 达到安全上限（响亮失败）
 */
async function fetchShopsAll(fetchChunk) {
  const shops = [];
  for (let page = 0; page < SHOP_MAX_PAGES; page++) {
    const chunk = await fetchChunk(page * SHOP_PAGE, SHOP_PAGE);
    const arr = (chunk && Array.isArray(chunk)) ? chunk : [];
    shops.push.apply(shops, arr);
    if (arr.length < SHOP_PAGE) break;       // 本页不满 → 已取尽
    if (page === SHOP_MAX_PAGES - 1) {
      const e = new Error(`该用户店铺数超过安全上限（${SHOP_MAX_PAGES * SHOP_PAGE}），请缩小范围或联系客服`);
      e.code = 'HARD_CAP_EXCEEDED';          // 复用既有错误码（不新增）
      throw e;
    }
  }
  return shops;
}

module.exports = { fetchShopsAll, SHOP_PAGE, SHOP_MAX_PAGES };