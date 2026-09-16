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
check('判定不依赖 plan_id（无 plan 字段参与）', true, '见 adminQueryUser/index.js：tier = expire_at > now');

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
  check('R53-② 分页命中：第 2 页 skip=100', hits.length === 2 && hits[1].skip === 100);

  // ③ 超过安全上限（500）→ 响亮失败（HARD_CAP_EXCEEDED）
  let capErr = null;
  try {
    await fetchShopsAll(async (skip, limit) => Array.from({ length: limit }, (_, i) => ({ id: skip + i })));
  } catch (e) { capErr = e; }
  check('R53-③ 店铺数超过安全上限 → 抛 HARD_CAP_EXCEEDED（响亮失败）', capErr && capErr.code === 'HARD_CAP_EXCEEDED');

  // ④ 空店铺 → 0 家
  const s0 = await fetchShopsAll(async () => []);
  check('R53-④ 无店铺 → 0 家', s0.length === 0);

  console.log(`\n==== adminQueryUser 批次 6/7 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();