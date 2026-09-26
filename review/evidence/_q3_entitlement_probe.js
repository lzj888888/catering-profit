// _q3_entitlement_probe.js —— 批次 Q2/Q3 落地的行为级取证
// 运行：node review/evidence/_q3_entitlement_probe.js（cwd = 仓根）
// 目的：付费判定下沉到 common/entitlement.js 后，**用假 DB 实跑**（不是看代码"像"对了就当通过）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'review', 'evidence', 'entitlement_probe_r147.txt');
const lines = [];
let pass = 0, failN = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; lines.push(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; lines.push(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// —— 实测对象 = 生产单源本体（不经云函数外壳，避免 wx-server-sdk 干扰）
const ENT = require(path.join(ROOT, 'cloudfunctions', 'common', 'entitlement.js'));
const { isPaid, hasFeature, PAID_FEATURES, loadExpireAt } = ENT;
const NOW = Date.now(), DAY = 24 * 3600 * 1000;

// 假 DB：只实现 loadExpireAt 用到的那条调用链
const fakeDb = (rows) => ({
  collection: (name) => ({
    where: () => ({ limit: () => ({ get: async () => ({ data: rows }) }) }),
    _name: name,
  }),
});
const dbWith = (expireAt) => fakeDb([{ expire_at: expireAt }]);

(async () => {
  lines.push('===== Q3 · 付费判定单源 hasFeature 行为级取证 =====');
  lines.push(`付费域清单 PAID_FEATURES = [${PAID_FEATURES.join(', ')}]`);

  const paid = await hasFeature(dbWith(NOW + 30 * DAY), 'u1', 'export');
  const free = await hasFeature(dbWith(0), 'u1', 'export');
  const expired = await hasFeature(dbWith(NOW - DAY), 'u1', 'export');
  chk('付费（到期未到）→ true', paid === true, `export=${paid}`);
  chk('免费（expire_at=0）→ false', free === false, `export=${free}`);
  chk('已过期（到期时刻早于现在）→ false', expired === false, `export=${expired}`);
  chk('三者结论非恒真/恒假（证明判定真的读了时间）', paid !== free && free === expired,
    `paid=${paid} free=${free} expired=${expired}`);

  // 无权益档：便于 Reproduction 的边界
  chk('无 shop_entitlement 档 → 按免费（fail-closed 到"不许用"，不是"随便用"）',
    (await hasFeature(fakeDb([]), 'u_nodoc', 'export')) === false);

  // 付费域登记 vs 未登记
  chk('m3_combo 走付费域（S1 落地即被墙）', (await hasFeature(dbWith(0), 'u1', 'm3_combo')) === false);
  chk('m3_takeaway 走付费域（S2 落地即被墙）', (await hasFeature(dbWith(0), 'u1', 'm3_takeaway')) === false);
  chk('未登记能力恒开放（漏登记不该锁死用户）', (await hasFeature(dbWith(0), 'u1', 'm3_edit')) === true);

  // 纯函数边界
  chk('isPaid 边界：恰好等于 now ⇒ false（不给自己留学号"正好到期还能用"）',
    isPaid(NOW, NOW) === false && isPaid(NOW + 1, NOW) === true);
  chk('isPaid 脏数据：NaN / undefined ⇒ false（不因类型脏而放行）',
    isPaid(undefined, NOW) === false && isPaid(NaN, NOW) === false);

  lines.push('');
  lines.push('===== Q2 · calc_status 写侧赋值（静态取证，补充 L13 的动态口径判据）=====');
  const saver = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'saveCostCard', 'index.js'), 'utf8');
  chk("saveCostCard 落库显式写 calc_status: 'calculated'",
    /calc_status:\s*'calculated'/.test(saver));
  chk('两处计数均排除 draft（读侧 checkQuota / 写侧 saveCostCard）', (() => {
    const a = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'checkQuota', 'index.js'), 'utf8');
    return /calc_status\s*===\s*'draft'/.test(a) && /calc_status\s*===\s*'draft'/.test(saver);
  })());

  lines.push('');
  lines.push(`===== 取证结果：${pass} 通过 / ${failN} 失败 =====`);
  const txt = lines.join('\n');
  fs.writeFileSync(OUT, txt, 'utf8');
  process.stdout.write(txt + '\n');
  process.exit(failN === 0 ? 0 : 1);
})();
