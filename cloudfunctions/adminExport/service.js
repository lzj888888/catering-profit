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
    const rows = await fetchPage(page * pageSize, pageSize);
    const arr = (rows && Array.isArray(rows)) ? rows : [];
    all.push.apply(all, arr);
    if (arr.length < pageSize) break;   // 本页不满 → 已取尽
    page++;
  }
  return all;
}

module.exports = { csvEscape, csvFromRows, fetchAllPages, MAX_EXPORT_PAGES, EXPORT_PAGE_SIZE, EXPORT_ROWS_CAP };