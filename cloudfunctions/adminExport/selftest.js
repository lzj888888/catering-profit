// cloudfunctions/adminExport/selftest.js —— 批次 6 · 导出 CSV 自测（字段完整 / 角色控权）
// 运行： node cloudfunctions/adminExport/selftest.js
// 覆盖验收 8（导出 CSV 能打开且字段完整）+ §2.9 角色控权。
const { csvEscape, csvFromRows } = (function () {
  // 内联复用 index.js 的 CSV 纯函数（单测不引 wx-server-sdk）
  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvFromRows(header, rows) {
    const all = [header].concat(rows);
    return '\uFEFF' + all.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  }
  return { csvEscape, csvFromRows };
})();

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== CSV 转义 =====');
check('普通值原样', csvEscape('MO123') === 'MO123');
check('含逗号 → 引号包裹', csvEscape('a,b') === '"a,b"');
check('含引号 → 双写引号', csvEscape('he said "hi"') === '"he said ""hi"""');
check('含换行 → 引号包裹', csvEscape('a\nb') === '"a\nb"');
check('null/undefined → 空串', csvEscape(null) === '' && csvEscape(undefined) === '');

console.log('===== 验收 8 · 订单 CSV 字段完整 =====');
const header = ['order_no', 'user_id', 'amount_fen', 'plan_id', 'plan_name', 'status', 'channel', 'paid_at', 'created_at'];
const rows = [
  ['MO1', 'u1', 2590, 'plan_basic_month', '真实利润·月', 'paid', 'manual', 1726000000000, 1725900000000],
  ['MO2', 'u2', 19900, 'plan_basic_year', '真实利润·年', 'refunded', 'wechat', 1726000000001, 1725900000001],
];
const csv = csvFromRows(header, rows);
check('含 UTF-8 BOM（Excel 打开中文不乱码）', csv.charCodeAt(0) === 0xFEFF);
check('首行 = 表头 9 字段', csv.split('\r\n')[0].split(',').length === 9, csv.split('\r\n')[0]);
check('数据行数与金额分完整', csv.split('\r\n').length === 3 && csv.includes('2590') && csv.includes('19900'));
check('中文套餐名正确转义', csv.includes('真实利润·月'));
check('每行 9 列（字段完整）', csv.split('\r\n').slice(1).every((l) => l.split(',').length === 9));

console.log('===== §2.9 角色控权（index.js 内联逻辑对照）=====');
// adminExport：scope=entitlements 仅 super；运营仅 orders
const requireRole = (role, allowed) => (allowed && allowed.indexOf(role) >= 0) ? null : 'ADMIN_PERMISSION_DENIED';
check('super 可导出全量(entitlements)', requireRole('super', ['super']) === null);
check('op 导出全量 → 拒绝', requireRole('op', ['super']) === 'ADMIN_PERMISSION_DENIED');
check('op 可导出订单明细(orders)', requireRole('op', ['super', 'op']) === null);

console.log('===== 权益 CSV（全量导出，仅超管）=====');
const eh = ['user_id', 'expire_at', 'source', 'updated_at'];
const ecsv = csvFromRows(eh, [['u1', 1727000000000, 'manual', 1726000000000]]);
check('权益 CSV 4 字段 + BOM', ecsv.split('\r\n')[0].split(',').length === 4 && ecsv.charCodeAt(0) === 0xFEFF);

console.log('');
console.log('===== R49 · 分页累取到耗尽（fetchAllPages，service.js）=====');
const { fetchAllPages } = require('./service');
(async () => {
  // ① 常规：不足一页 → 取尽
  //    ⚠️ R63：注入方**必须遵守契约**「skip 超界 → 返回空」，否则探针会把它误判成"还有更多"
  const small = await fetchAllPages(async (skip, limit) => {
    const n = Math.max(0, Math.min(3, 3 - skip));
    return Array.from({ length: n }, (_, i) => ({ id: skip + i }));
  });
  check('不足一页 → 全部取到（3 条）', small.length === 3);

  // ② >1000 条边界：1500 条 → 分 2 页取尽，无静默截断
  const total = 1500;
  const pageHits = [];
  const big = await fetchAllPages(async (skip, limit) => {
    pageHits.push({ skip, limit });
    const n = Math.min(limit, total - skip);
    return Array.from({ length: Math.max(0, n) }, (_, i) => ({ id: skip + i }));
  });
  check('1500 条 → 分页取尽（无静默截断）', big.length === 1500);
  check('分页命中：页1 skip=0/limit=1000，页2 skip=1000/limit=1000（+ R63 探针 skip=1500/limit=1）',
    pageHits.length === 3 && pageHits[0].skip === 0 && pageHits[1].skip === 1000
      && pageHits[2].skip === 1500 && pageHits[2].limit === 1,
    'hits=' + JSON.stringify(pageHits.map((h) => [h.skip, h.limit])));

  // ③ 精确边界：恰好 2000 条（20 页 × 1000）→ 取尽不触发上限
  const exact = await fetchAllPages(async (skip, limit) => {
    const n = Math.min(limit, 2000 - skip);
    return Array.from({ length: Math.max(0, n) }, (_, i) => ({ id: skip + i }));
  });
  check('恰好 2000 条（上限内）→ 取尽', exact.length === 2000);

  // ④ 超过安全上限（20000）→ 响亮失败（HARD_CAP_EXCEEDED），不静默截断
  let capErr = null;
  try {
    await fetchAllPages(async (skip, limit) => Array.from({ length: limit }, (_, i) => ({ id: skip + i })), { pageSize: 1000, maxPages: 20 });
  } catch (e) { capErr = e; }
  check('超过安全上限 → 抛 HARD_CAP_EXCEEDED（响亮失败）', capErr && capErr.code === 'HARD_CAP_EXCEEDED');

  // ⑤ 注入小上限（测试可控）：maxPages=2 且数据不断 → 第 3 页触发响亮失败
  let smallCapErr = null;
  try {
    await fetchAllPages(async (skip, limit) => Array.from({ length: limit }, (_, i) => ({ id: skip + i })), { pageSize: 3, maxPages: 2 });
  } catch (e) { smallCapErr = e; }
  check('注入 maxPages=2 且数据不断 → 响亮失败', smallCapErr && smallCapErr.code === 'HARD_CAP_EXCEEDED');

  // ⑥ 空集合 → 0 条
  const empty = await fetchAllPages(async () => []);
  check('空集合 → 0 条', empty.length === 0);

  // ===== R63：短页探针 + 形态守卫（取尽判据不再依赖两个未验证前提）=====
  console.log('');
  console.log('===== R63 · 短页探针 + 形态守卫（fetchAllPages / makePagedQuery / asRows）=====');

  // ⑦ 前提①-正面：首页偶发少返回（50，远低于请求的 1000）→ 探针确证未耗尽 → 继续取尽
  //    （R49 逻辑 `arr.length < pageSize → break` 在此**只取到 50 条** ⇒ 静默少导出 1250 条）
  {
    const TOTAL = 1300;
    const big2 = await fetchAllPages(async (skip, limit) => {
      const n = skip === 0 ? Math.min(50, TOTAL) : Math.max(0, Math.min(limit, TOTAL - skip));
      return Array.from({ length: n }, (_, i) => ({ id: skip + i }));
    });
    check('R63-① 首页短页（50/1000）→ 探针确证未耗尽，仍取尽 1300 条（旧逻辑只取 50）',
      big2.length === TOTAL, `len=${big2.length}`);
    check('R63-② 探针不跳不重：id 连续 0..1299', big2.every((x, i) => x.id === i));
  }

  // ⑧ 前提①-反面：平台单次上限（300）远低于请求值 → 页数用尽 ⇒ **响亮失败**（不静默返回已取部分）
  {
    let capErr2 = null;
    try {
      await fetchAllPages(async (skip, limit) => {
        const n = Math.max(0, Math.min(300, limit, 5000 - skip));
        return Array.from({ length: n }, (_, i) => ({ id: skip + i }));
      }, { pageSize: 1000, maxPages: 3 });
    } catch (e) { capErr2 = e; }
    check('R63-③ 平台单次上限 300 条 ⇒ 页数用尽时响亮失败 HARD_CAP_EXCEEDED（不静默返回部分）',
      capErr2 && capErr2.code === 'HARD_CAP_EXCEEDED', capErr2 ? capErr2.code : 'no-throw');
  }

  // ⑨ 前提②：形态守卫（makePagedQuery 是**注入点** ⇒ 生产路径上"静默空"变"响亮失败"）
  {
    const { makePagedQuery, asRows } = require('./service');
    const collRet = (ret) => ({
      where() { return this; }, skip() { return this; }, limit() { return this; },
      async get() { return ret; },
    });
    let sh1 = null;
    try { await makePagedQuery(collRet({}))(null)(0, 1000); } catch (e) { sh1 = e; }
    check('R63-④ 形态 {}(无 data) → 抛 SYSTEM_ERROR（不静默当空 ⇒ 不被当成"取尽"）',
      sh1 && sh1.code === 'SYSTEM_ERROR');
    let sh2 = null;
    try { await makePagedQuery(collRet({ data: 'oops' }))(null)(0, 1000); } catch (e) { sh2 = e; }
    check('R63-⑤ 形态 {data:"oops"}(非数组) → 抛 SYSTEM_ERROR', sh2 && sh2.code === 'SYSTEM_ERROR');
    const okr = await makePagedQuery(collRet({ data: [{ id: 'e9' }] }))(null)(0, 1000);
    check('R63-⑥ 形态 {data:[...]} → 正常返回数组', Array.isArray(okr) && okr.length === 1);
    const emptyr = await makePagedQuery(collRet({ data: [] }))(null)(0, 1000);
    check('R63-⑦ 形态 {data:[]} → 返回 []（空 ≠ 异常）', Array.isArray(emptyr) && emptyr.length === 0);
    check('R63-⑧ asRows(null/undefined) → []（无数据不是异常）',
      asRows(null).length === 0 && asRows(undefined).length === 0);
    let asE = null;
    try { asRows(123); } catch (e) { asE = e; }
    check('R63-⑨ asRows(非数组非 null) → 抛 SYSTEM_ERROR', asE && asE.code === 'SYSTEM_ERROR');
  }

  console.log(`\n==== adminExport R49 子测：${pass} 通过 / ${failN} 失败 ====`);

  // ===== R51 · where=null 走不带 where 的路径（makePagedQuery 真实实现）=====
  // ⚠️ 与 R49 段**共用同一个 IIFE**（2026-09-17 修隐性竞态）：原先两段各起一个 IIFE，
  //   而只有 R51 段尾部调 `process.exit`；R51 用假集合（微任务即完成）⇒ **抢先退出进程**，
  //   把 R49 段后半截腰斩。R63 给 fetchAllPages 加探针后 await 链变长，该竞态首次暴露：
  //   实跑只见「不足一页」一条，1500/2000/上限/空集合/R63 共十余条**一条都没执行**。
  const { makePagedQuery } = require('./service');
// 假 collection：记录调用形态，链式返回自身（模拟 wx SDK 查询对象），get 返回 {data}
function makeFakeColl() {
  const calls = [];
  const coll = {
    where(cond) { calls.push('where:' + JSON.stringify(cond)); return coll; },
    skip(n) { calls.push('skip:' + n); return coll; },
    limit(n) { calls.push('limit:' + n); return coll; },
    get: async () => ({ data: [{ id: 'e1' }] }),
  };
  return { calls, coll };
}

  // ① where=null（entitlements 全量）→ 不出现 where 调用
  const f1 = makeFakeColl();
  const rows1 = await makePagedQuery(f1.coll)(null)(0, 1000);
  check('R51-① where=null → 无 where() 调用（只有 skip/limit/get）',
    rows1.length === 1 && !f1.calls.some((c) => c.indexOf('where:') === 0),
    'calls=' + f1.calls.join(','));
  check('R51-① where=null → skip/limit 顺序正确',
    f1.calls.join(',') === 'skip:0,limit:1000', 'calls=' + f1.calls.join(','));

  // ② where 对象（orders 明细）→ 有 where() 调用且条件透传
  const f2 = makeFakeColl();
  const cond = { is_deleted: false, user_id: 'u1' };
  await makePagedQuery(f2.coll)(cond)(0, 1000);
  check('R51-② where 对象 → 调用 .where(cond) 且条件透传',
    f2.calls[0] === 'where:' + JSON.stringify(cond), 'calls=' + f2.calls.join(','));

  // ③ 禁止回归：全量路径不产生空 where({})（index.js 已传 null）
  const f3 = makeFakeColl();
  await makePagedQuery(f3.coll)(null)(0, 1000);
  check('R51-③ 全量路径不产生空 where({})', !f3.calls.some((c) => c === 'where:{}'), 'calls=' + f3.calls.join(','));

  console.log(`\n==== adminExport 批次 6/7 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();