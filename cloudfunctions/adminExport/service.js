// cloudfunctions/adminExport/service.js —— 批次 6/7 · 导出纯函数（可单测，不接触 wx-server-sdk）
//
// R49（健壮性）：全量导出改为**分页累取到耗尽**，杜绝 limit(1000) 静默截断；
//   循环带安全上限，达到上限**响亮失败**（复用 HARD_CAP_EXCEEDED 语义，不新增错误码）。

// ===================== CSV 纯函数 =====================

/** CSV 单元格转义：含逗号/引号/换行 → 引号包裹并双写引号。 */
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** 行数组 → CSV 文本（统一 \r\n，UTF-8 BOM 便于 Excel 打开中文）。 */
function csvFromRows(header, rows) {
  const all = [header].concat(rows);
  return '\uFEFF' + all.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

// ===================== R63 · 取数形态守卫（与 adminQueryUser/service.js 同源口径）=====================

/** R63 · 查询返回形态异常（期望 { data: [] }）—— 响亮失败，不静默归一为空数组。 */
function invalidShapeError() {
  const e = new Error('查询返回形态异常（期望 { data: [] }）');
  e.code = 'SYSTEM_ERROR';   // 复用既有错误码（core/09 §1.7），不新增
  return e;
}

/**
 * R63 · 取数结果归一 + 形态守卫：null/undefined → []（等价"无数据"）；
 * **非数组 ≠ 无数据** → 响亮失败（防形态漂移被当成"取尽"）。
 */
function asRows(x) {
  if (x == null) return [];
  if (!Array.isArray(x)) throw invalidShapeError();
  return x;
}

// ===================== R49 · 分页累取（纯编排，DB 由调用方注入）=====================

// 分页安全上限（防死循环 / 防单次导出拉爆内存）：20 页 × 1000 = 20000 条
const MAX_EXPORT_PAGES = 20;
const EXPORT_PAGE_SIZE = 1000;
const EXPORT_ROWS_CAP = MAX_EXPORT_PAGES * EXPORT_PAGE_SIZE; // 20000

/**
 * 分页累取到耗尽（R49）。
 * @param {function} fetchPage async (skip:number, limit:number) => Array —— 调用方注入，返回原始行数组
 * @param {object} opts { pageSize?, maxPages? }（默认 1000/20，测试可注入小值）
 * @returns {Promise<Array>} 全部行
 * @throws {object} { code:'HARD_CAP_EXCEEDED' } 达到安全上限（响亮失败，不静默截断）
 */
async function fetchAllPages(fetchPage, opts) {
  const pageSize = (opts && opts.pageSize) || EXPORT_PAGE_SIZE;
  const maxPages = (opts && opts.maxPages) || MAX_EXPORT_PAGES;
  const all = [];
  let page = 0;
  for (;;) {
    if (page >= maxPages) {
      const e = new Error(`导出数据超过安全上限（${maxPages * pageSize} 条），请缩小时间范围或联系客服`);
      e.code = 'HARD_CAP_EXCEEDED'; // 复用既有错误码（不新增）
      throw e;
    }
    // ⚠️ R63：offset 用 all.length（而非 page * pageSize）：探针非空时页起点须随之平移，
    //    否则"短页 + 数据仍在"场景会把中间一段静默跳过。
    const rows = await fetchPage(all.length, pageSize);
    const arr = asRows(rows);
    all.push.apply(all, arr);
    if (arr.length < pageSize) {
      // R63：短页 ≠ 一定耗尽 —— 补一次探针（只多取 1 条）确证；
      //   探针为空 ⇒ 确证耗尽（正常出口）；探针非空 ⇒ 平台返回条数低于请求值，继续下一页。
      const probe = asRows(await fetchPage(all.length, 1));
      if (probe.length === 0) break;
      page++;
      continue;
    }
    page++;
  }
  return all;
}

// ===================== R51 · 分页查询构造（注入 collection 句柄，可单测）=====================

/**
 * 构造分页查询器（R51）：where == null → **跳过 .where()**（全量，不带 where 路径）。
 * ⚠️ 空 where({}) 无平台行为保证（全仓零先例），全量查询不凑恒真条件、不赌平台对空对象的行为。
 * @param {object} coll 注入的 collection 句柄（db.collection(name) 返回值；测试可注入假句柄）
 * @returns {function} (where) => async (skip, limit) => Array —— where 为 null/undefined → 不带 where
 */
function makePagedQuery(coll) {
  return (where) => async (skip, limit) => {
    let q = coll;
    if (where != null) q = q.where(where);   // where == null → 跳过（全量）
    q = q.skip(skip).limit(limit);
    const res = await q.get();
    // R63 形态守卫：形态漂移若静默归一为 []，会被 fetchAllPages 当成"取尽"⇒ 导出成功但为空
    //   （本仓已栽过的形态事故类型：单源 adminAuth.js 记着 `doc().get()` 被当文档本体的教训）。
    if (res == null || !Array.isArray(res.data)) throw invalidShapeError();
    return res.data;
  };
}

module.exports = { csvEscape, csvFromRows, fetchAllPages, makePagedQuery, asRows, invalidShapeError, MAX_EXPORT_PAGES, EXPORT_PAGE_SIZE, EXPORT_ROWS_CAP };