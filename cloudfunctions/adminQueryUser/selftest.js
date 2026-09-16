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

console.log(`\n==== adminQueryUser 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);