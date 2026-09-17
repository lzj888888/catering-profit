// cloudfunctions/adminQueryUser/selftest.js —— 批次 6 · 用户查询自测（openid 打码 + 档位判定）
// 运行： node cloudfunctions/adminQueryUser/selftest.js
// 覆盖：openid_mask（防敏感泄露）、档位判定（只读 expire_at，不读 plan_id）。
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 与 index.js 同款 maskOpenid 纯函数
function maskOpenid(openid) {
  if (!openid) return '';
  if (openid.length <= 10) return openid;
  return openid.slice(0, 6) + '****' + openid.slice(-4);
}

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

console.log('===== openid 打码（防敏感泄露）=====');
const masked = maskOpenid('oXk3m5nQpRtUvWxYzA1b2');
check('长 openid → 前6后4 + ****（中间打码）', masked === 'oXk3m5****A1b2', masked);
check('打码不泄露完整 openid', !masked.includes('nQpRtUvWxYz'));
check('空 openid → 空串', maskOpenid('') === '');

console.log('===== 档位判定（解耦铁律：只读 expire_at）=====');
const tier = (expireAt) => (expireAt > Date.now() ? 'paid' : 'free');
check('expire_at 有效 → paid', tier(NOW + 30 * DAY) === 'paid');
check('expire_at 过期 → free', tier(NOW - DAY) === 'free');
check('无权益(0) → free', tier(0) === 'free');
check('判定不依赖 plan_id（无 plan 字段参与）',
  (() => { const s = require('fs').readFileSync(require('path').join(__dirname, 'index.js'), 'utf8').replace(/^\s*\/\/.*$/gm, ''); return /expireAt\s*>\s*Date\.now\(\)/.test(s) && !/plan_id/.test(s); })(),
  'index.js:74：tier 仅由 expire_at 决定（🔒 R71：原为恒真断言）');

console.log('');
console.log('===== R53 · 店铺列表分页累取（A 类加固，service.fetchShopsAll 真实实现）=====');
const { fetchShopsAll } = require('./service');
(async () => {
  // ① 20 家（旧 limit 会被截断的量级）→ 一次取尽
  const s20 = await fetchShopsAll(async (skip, limit) => Array.from({ length: Math.min(20, 20 - skip) }, (_, i) => ({ id: skip + i })));
  check('R53-① 20 家店 → 全部取到（旧 limit(20) 恰好取尽，分页同样取尽）', s20.length === 20);

  // ② 150 家（>20，旧 limit(20) 会静默截断）→ 分页取尽
  const total = 150;
  const hits = [];
  const s150 = await fetchShopsAll(async (skip, limit) => {
    hits.push({ skip, limit });
    const n = Math.min(limit, total - skip);
    return Array.from({ length: Math.max(0, n) }, (_, i) => ({ id: skip + i }));
  });
  check('R53-② 150 家店（>20）→ 分页取尽，无静默截断', s150.length === 150, `len=${s150.length}`);
  check('R53-② 分页命中：第 2 页 skip=100（+ R63 探针 skip=150/limit=1）',
    hits.length === 3 && hits[0].skip === 0 && hits[1].skip === 100 && hits[2].skip === 150 && hits[2].limit === 1,
    'hits=' + JSON.stringify(hits));

  // ③ 超过安全上限（500）→ 响亮失败（HARD_CAP_EXCEEDED）
  let capErr = null;
  try {
    await fetchShopsAll(async (skip, limit) => Array.from({ length: limit }, (_, i) => ({ id: skip + i })));
  } catch (e) { capErr = e; }
  check('R53-③ 店铺数超过安全上限 → 抛 HARD_CAP_EXCEEDED（响亮失败）', capErr && capErr.code === 'HARD_CAP_EXCEEDED');

  // ④ 空店铺 → 0 家
  const s0 = await fetchShopsAll(async () => []);
  check('R53-④ 无店铺 → 0 家', s0.length === 0);

  // ===== R63：短页探针 + 形态守卫（取尽判据不再依赖两个未验证前提）=====
  console.log('');
  console.log('===== R63 · 短页探针 + 形态守卫（service.makeShopPageQuery / asRows 真实实现）=====');

  // ⑤ 前提①-正面：首页偶发少返回（5 条，远低于请求的 100）→ 探针确证未耗尽 → 继续取尽
  //    （R53 逻辑 `arr.length < SHOP_PAGE → break` 在此**只取到 5 家** ⇒ 静默截断 100 家）
  {
    const TOTAL = 105;
    const s = await fetchShopsAll(async (skip, limit) => {
      const n = skip === 0 ? Math.min(5, TOTAL) : Math.max(0, Math.min(limit, TOTAL - skip));
      return Array.from({ length: n }, (_, i) => ({ id: skip + i }));
    });
    check('R63-① 首页短页（5/100）→ 探针确证未耗尽，仍取尽 105 家（旧逻辑只取 5 家）',
      s.length === TOTAL, `len=${s.length}`);
    check('R63-② 探针不跳不重：id 连续 0..104', s.every((x, i) => x.id === i));
  }

  // ⑥ 前提①-反面：平台单次上限（30）远低于请求值 → 页数配额耗尽 ⇒ **响亮失败**
  //    （关键：不能静默返回已取到的 150 家 —— 那比旧逻辑更隐蔽）
  {
    let capErr = null;
    try {
      await fetchShopsAll(async (skip, limit) => {
        const n = Math.max(0, Math.min(30, limit, 250 - skip));
        return Array.from({ length: n }, (_, i) => ({ id: skip + i }));
      });
    } catch (e) { capErr = e; }
    check('R63-③ 平台单次上限 30 条 ⇒ 页数用尽时响亮失败 HARD_CAP_EXCEEDED（不静默返回部分）',
      capErr && capErr.code === 'HARD_CAP_EXCEEDED', capErr ? capErr.code : 'no-throw');
  }

  // ⑦ 前提②：形态守卫 —— 形态异常一律响亮失败，不静默归一为 []（否则会被当成"取尽"）
  {
    const { makeShopPageQuery, asRows } = require('./service');
    const collWith = (ret) => ({
      where() { return this; }, skip() { return this; }, limit() { return this; },
      async get() { return ret; },
    });
    let shapeErr = null;
    try { await makeShopPageQuery(collWith({}), { user_id: 'u1' })(0, 100); } catch (e) { shapeErr = e; }
    check('R63-④ 形态 {}(无 data) → 抛 SYSTEM_ERROR（不静默当空）', shapeErr && shapeErr.code === 'SYSTEM_ERROR');
    let shapeErr2 = null;
    try { await makeShopPageQuery(collWith({ data: null }), null)(0, 100); } catch (e) { shapeErr2 = e; }
    check('R63-⑤ 形态 {data:null} → 抛 SYSTEM_ERROR', shapeErr2 && shapeErr2.code === 'SYSTEM_ERROR');
    const okRows = await makeShopPageQuery(collWith({ data: [{ id: 's1' }] }), null)(0, 100);
    check('R63-⑥ 形态 {data:[...]} → 正常返回数组', Array.isArray(okRows) && okRows.length === 1);
    const emptyRows = await makeShopPageQuery(collWith({ data: [] }), null)(0, 100);
    check('R63-⑦ 形态 {data:[]} → 返回 []（空 ≠ 异常）', Array.isArray(emptyRows) && emptyRows.length === 0);
    check('R63-⑧ asRows(null/undefined) → []（无数据不是异常）',
      asRows(null).length === 0 && asRows(undefined).length === 0);
    let asErr = null;
    try { asRows({}); } catch (e) { asErr = e; }
    check('R63-⑨ asRows(非数组非 null) → 抛 SYSTEM_ERROR', asErr && asErr.code === 'SYSTEM_ERROR');
  }

  console.log(`\n==== adminQueryUser 批次 6/7 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();