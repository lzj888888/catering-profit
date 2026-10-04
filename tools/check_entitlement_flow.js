// tools/check_entitlement_flow.js —— R213 · 会员权益链路守卫（免费额度 / 到期 / 续费 / 后台调权）
//
// ===== 为什么立这条 =====
//   豆包主对话把「会员权限全流程端到端测试」列为 P0 阻塞项；R212 对账确认：仓内**零权益 e2e 用例**
//   （tools/ 下 73 个 check_* 与 17 个 selftest_*，无一条覆盖权益链路）。而权益是**收钱的那条线**：
//   额度判错 = 免费用户白拿；付费语义分叉 = 两个接口给出两个答案。
//   ⇒ 本条把四段链路变成机器判据，且**能实跑的一律实跑**（require 生产单源，不靠读代码猜）。
//
// ===== 判据 =====
//   E-A 实跑单源 common/entitlement.js —— isPaid 边界（0/null/过期/未来/注入 now）+ 能力清单 + 开放默认
//   E-B 实跑配额判定 checkQuota/service.js —— 阈值翻转点(20/21) + 硬上限 + fail-closed（缺配置必抛）
//   E-C 链路在场（穷尽分类）—— 额度真相源 / 写侧拦截 / **到期判定单源不扩散** / 续费 / 调权 / 查询 / 通知 / 前端键
//   E-D 自失效护栏 —— 扫描面下界 + 关键目录锚点在场 + 断言数下界
//
// 🔴 E-C③ 是本轮真缺陷的固化：entitlement.js 注释明写「严禁在函数体内再写一遍 expireAt > nowUtc()」，
//   但实扫抓到两处扩散（adminQueryUser 的 tier 判定、payQueryEntitlement 的 is_active），本轮已接回单源。
//   ⚠️ 该判据必须**剥注释**再扫（单源与 exportData 里都有"举例说明"性质的注释），且排除 cx_ 派生副本。
//
// 运行：node tools/check_entitlement_flow.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; } };
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// 剥注释（与 check_requires.js 同法）：防注释里的「举例说明」被当成真实调用
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

// ============================================================
(async () => {
console.log('===== E-A 实跑单源（cloudfunctions/common/entitlement.js）=====');
let ENT = null;
try { ENT = require(path.join(CF, 'common', 'entitlement.js')); } catch (_) { ENT = null; }
check('E-A① 单源可加载且导出齐备（PAID_FEATURES/isPaid/hasFeature/loadExpireAt）',
  !!(ENT && typeof ENT.isPaid === 'function' && typeof ENT.hasFeature === 'function'
    && Array.isArray(ENT.PAID_FEATURES) && typeof ENT.loadExpireAt === 'function'),
  ENT ? Object.keys(ENT).join(', ') : '加载失败');

// 加载失败时后续断言一律 fail-closed（返回 null ⇒ 与 true/false 比较皆不等 ⇒ 红），且**断言数恒定**
const E = ENT || {};
const isPaid = (typeof E.isPaid === 'function') ? E.isPaid : (() => null);
const PAID = Array.isArray(E.PAID_FEATURES) ? E.PAID_FEATURES : [];
const hasFeature = (typeof E.hasFeature === 'function') ? E.hasFeature : (() => null);
const NOW = 1700000000000;

check('E-A② isPaid(0) === false（无权益记录 = 免费）', isPaid(0, NOW) === false, String(isPaid(0, NOW)));
check('E-A③ isPaid(null / undefined) === false（空值不得被当成付费）',
  isPaid(null, NOW) === false && isPaid(undefined, NOW) === false);
check('E-A④ 过期（NOW-1）=== false', isPaid(NOW - 1, NOW) === false);
check('E-A⑤ 未过期（NOW+1）=== true', isPaid(NOW + 1, NOW) === true);
check('E-A⑥ 注入 now 生效：同一 expireAt 配不同 now ⇒ 结论翻转',
  isPaid(NOW + 1000, NOW) === true && isPaid(NOW + 1000, NOW + 5000) === false);
check('E-A⑦ 付费能力清单 ≥3 且含 export / m3_combo / m3_takeaway',
  PAID.length >= 3 && ['export', 'm3_combo', 'm3_takeaway'].every((k) => PAID.indexOf(k) >= 0),
  '[' + PAID.join(', ') + ']');
// ⚠️ hasFeature 是 async ⇒ 必须 await（同步写 === true 会与 Promise 比较，恒假）
let openDefault = null;
try { openDefault = await hasFeature(null, 'u', 'no_such_feature'); } catch (_) { openDefault = null; }
check('E-A⑧ 开放默认：未登记能力恒解锁（不因漏登记而锁死用户）', openDefault === true, String(openDefault));
check('E-A⑨ 等号边界：isPaid(NOW, NOW) === false（严格大于 ⇒ 到期时刻即失效）',
  isPaid(NOW, NOW) === false);

// ============================================================
console.log('===== E-B 实跑配额判定（cloudfunctions/checkQuota/service.js）=====');
let QSVC = null;
try { QSVC = require(path.join(CF, 'checkQuota', 'service.js')); } catch (_) { QSVC = null; }
check('E-B① 配额单源可加载且导出 checkQuota', !!(QSVC && typeof QSVC.checkQuota === 'function'),
  QSVC ? Object.keys(QSVC).join(', ') : '加载失败');

let ERRC = {};
try { ERRC = require(path.join(CF, 'common', 'errors.js')).ERROR_CODES || {}; } catch (_) { ERRC = {}; }
const SYS = ERRC.SYSTEM_ERROR;
const qc = (QSVC && typeof QSVC.checkQuota === 'function') ? QSVC.checkQuota : (() => { throw new Error('unavailable'); });
const LIM = { shop: 1, cost_card: 20, hard_shop: 200, hard_card: 2000 };
const call = (p) => { try { return qc(p); } catch (_) { return null; } };
const r19 = call({ userId: 'u', scope: 'cost_card', activeCount: 19, limits: LIM });
const r20 = call({ userId: 'u', scope: 'cost_card', activeCount: 20, limits: LIM });
const r1999 = call({ userId: 'u', scope: 'cost_card', activeCount: 1999, limits: LIM });
const r2000 = call({ userId: 'u', scope: 'cost_card', activeCount: 2000, limits: LIM });
let threwMissing = false;
let threwScope = false;
try { qc({ userId: 'u', scope: 'cost_card', activeCount: 0, limits: null }); } catch (e) { threwMissing = !!(e && e.code === SYS); }
try { qc({ userId: 'u', scope: 'cost_card', activeCount: 0, limits: { shop: 1 } }); } catch (e) { threwScope = !!(e && e.code === SYS); }

check('E-B② 第 20 张（used=19）不触发免费墙', !!(r19 && r19.hit_free_limit === false),
  r19 ? 'hit_free_limit=' + r19.hit_free_limit : '未返回');
check('E-B③ 第 21 张（used=20）触发免费墙（阈值翻转点）', !!(r20 && r20.hit_free_limit === true),
  r20 ? 'hit_free_limit=' + r20.hit_free_limit : '未返回');
check('E-B④ 硬上限：used=1999 未触顶 / used=2000 触顶',
  !!(r1999 && r1999.hit_hard_limit === false && r2000 && r2000.hit_hard_limit === true));
check('E-B⑤ 缺 limits ⇒ 抛 SYSTEM_ERROR（fail-closed，不静默放行）', threwMissing, 'code=' + SYS);
check('E-B⑥ 缺该 scope 的额度值 ⇒ 抛（不回落字面量兜底）', threwScope);
check('E-B⑦ 影子：判定对 used 单调翻转（19→20），证明判据有分辨力',
  !!(r19 && r20 && r19.hit_free_limit !== r20.hit_free_limit));

// ============================================================
console.log('===== E-C 链路在场（穷尽分类）=====');
const cqIdx = read('cloudfunctions/checkQuota/index.js');
check('E-C① 免费额度唯一真相源：checkQuota 读 feature_permissions.plan_free.limits',
  /feature_permissions/.test(cqIdx) && /plan_free/.test(cqIdx) && /\.limits/.test(cqIdx));
const scc = read('cloudfunctions/saveCostCard/index.js');
check('E-C② 写侧真拦截：saveCostCard 超限即 fail（不靠前端拦）',
  /judgeCardQuota\s*\(/.test(scc) && /hit_free_limit/.test(scc) && /FREE_LIMIT_EXCEEDED/.test(scc));

// C③ 到期判定单源不扩散（真缺陷固化点）
const SCAN_ROOTS = ['cloudfunctions', 'utils', 'pages'];
function walkJs(p, out) {
  let ents = [];
  try { ents = fs.readdirSync(p, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const q = path.join(p, e.name);
    if (e.isDirectory()) walkJs(q, out);
    else if (/\.js$/.test(e.name)) out.push(q);
  }
  return out;
}
const jsFiles = [];
for (const r of SCAN_ROOTS) {
  const abs = path.join(ROOT, r);
  if (fs.existsSync(abs)) walkJs(abs, jsFiles);
}
check('E-C③a 扫描面非退化：扫描到的 .js 数 ≥ 100（防遍历失效 ⇒ 零命中假绿）',
  jsFiles.length >= 100, jsFiles.length + ' 个');

const HAND_RE = /(expire_?[Aa]t)\s*>\s*(now\b|nowUtc\s*\(|Date\.now\s*\(|serverNow|nowMs|NOW\b)/;
const handWritten = [];
for (const p of jsFiles) {
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  if (/\/cx_[A-Za-z0-9_]+\.js$/.test(rel)) continue;          // 派生副本：与单源同体，不算第二源
  if (rel === 'cloudfunctions/common/entitlement.js') continue; // 单源本体
  const body = stripJsComments(read(rel));
  body.split('\n').forEach((line, i) => {
    if (HAND_RE.test(line)) handWritten.push(rel + ':' + (i + 1) + ' ' + line.trim().slice(0, 60));
  });
}
check('E-C③b 到期判定单源不扩散（除 common/entitlement.js 外无手写「到期比较」）',
  handWritten.length === 0,
  handWritten.length ? handWritten.slice(0, 4).join(' | ') : '全仓 0 处手写（判定一律走 isPaid）');

check('E-C④ 续费链路在场：payRenew 存在且写 expire_at',
  exists('cloudfunctions/payRenew/index.js') && /expire_at/.test(read('cloudfunctions/payRenew/index.js')));
const age = read('cloudfunctions/adminGrantEntitlement/index.js');
check('E-C⑤ 后台调权在场：adminGrantEntitlement 写 expire_at + 审计留痕',
  /expire_at/.test(age) && /writeAudit/.test(age));
const pq = read('cloudfunctions/payQueryEntitlement/service.js');
check('E-C⑥ 查询出参含 is_active / days_left，且判定走单源 isPaid',
  /is_active/.test(pq) && /days_left/.test(pq) && /isPaid\s*\(/.test(pq));
check('E-C⑦ 到期提醒链路在场：payExpireNotify 存在',
  exists('cloudfunctions/payExpireNotify/index.js'));
const pw = read('utils/paywall.js');
check('E-C⑧ 前端免费额度触发键 saveLimit 在场（额度打满能弹墙）',
  /PAYWALL_TYPES\s*=/.test(pw) && /'saveLimit'/.test(pw));

// ============================================================
console.log('===== E-D 自失效护栏 =====');
const cfDirs = (() => {
  try { return fs.readdirSync(CF, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch (_) { return []; }
})();
check('E-D① 扫描面下界：cloudfunctions 目录 ≥ 30（防遍历失效）', cfDirs.length >= 30, cfDirs.length + ' 个目录');
const NEED = ['checkQuota', 'saveCostCard', 'syncCostCard', 'payRenew', 'payQueryEntitlement',
  'adminGrantEntitlement', 'payExpireNotify', 'payCreateOrder', 'payCallback', 'common'];
const miss = NEED.filter((d) => cfDirs.indexOf(d) < 0);
check('E-D② 关键目录全部在场（锚点在场，防路径打错）',
  miss.length === 0, miss.length ? '缺 ' + miss.join(',') : NEED.length + ' 个齐备');
check('E-D③ 断言数下界 ≥ 24（实测 27 的保守下沿，防断言行被删）',
  pass >= 24, '本条之前已累计 ✅ ' + pass + ' 条');

// ⚠️ R69：末行必须是收尾行；R66：每段标题下至少一条断言；§12.1：别在文案里写「N 通过 / M 失败」组合。
if (fails.length) console.log('失败项：' + fails.join(' | '));
console.log('R213 权益链路：免费额度阈值/到期判定/续费/后台调权四段均已机器可判。');
console.log('\n===== R213 会员权益链路守卫结果：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => { console.log('❌ 守卫自身异常：' + (e && e.message)); process.exit(1); });
