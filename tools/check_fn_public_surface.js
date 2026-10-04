// tools/check_fn_public_surface.js —— 【R215】云函数「公开面」守卫（无鉴权函数必须登记 + 定时/探针类必须自保）
// 运行：node tools/check_fn_public_surface.js
//
// 为什么需要它（真实缺陷，2026-10-04 · R214 全链路通跑发现）：
//   `cloudfunctions/payExpireNotify/index.js` 的 `exports.main` **无任何来源校验**，而它扫的是
//   `shop_entitlement` **全表**并回 `user_id + expire_at` ⇒ 任意已登录用户在小程序端
//   `wx.cloud.callFunction({ name: 'payExpireNotify' })` 就能拉到别人的付费状态；
//   同族的 `smokeTest` 是**写库探针**（建集合 / 往 probe_tmp 写数据），同样可被任意用户触发。
//   ⚠️ 而**既有守卫一条都抓不到** —— 不是判据写错，是**压根没有这一层判据**：
//      · `check_auth_guard_shape`（R194）守「assertShopOwner 的返回形状」与它的 20 个**调用点**，
//        它只看**已经有鉴权**的函数；
//      · `check_fn_inventory`（R62）守「函数清单 ≡ 契约文档」；
//      · `check_privacy_collection`（R68）守隐私收集项与代码出处；
//      · `check_idempotency`（R73）守幂等与审计。
//      ⇒「这个函数的**入口有没有鉴权/自保**」此前零机器判据 ⇒ 新增函数漏鉴权时全绿放行。
//
// 判据（**分类穷尽**，而不是"应当有鉴权"的白名单断言 —— 后者在 admin/回调/定时三类上必假红）：
//   S 扫描面（fail-closed）：函数目录数 / 契约文档 / A 类数下界 / 锚点函数在场。
//   A 三分穷尽：每个 `cloudfunctions/<fn>/index.js` 必落进 A（用户鉴权）/ B（admin 鉴权）/ C（免鉴权）之一。
//   B C 类必须**逐条登记**在 PUBLIC_FNS（缺一即红且点名）。
//   C 登记表双向防腐：每项 why ≥ 12 字 + 目录必须存在（陈旧键 ⇒ 红）+ **已带鉴权却仍登记 ⇒ 红**。
//   D `mustSelfGuard: true` 的项必须**真的判了来源**（`getWXContext` 取到 OPENID 后有 return 拒绝）。
//   E 自失效护栏：断言数下界 + 扫描面文件数下界（防"扫空 ⇒ 0 ≤ 预算 ⇒ 恒绿"）。
//
// ⚠️ 诚实边界（本守卫**不**守的，别当它守了）：
//   ① 不判 A/B 类鉴权的**强度**（如 `requireRole(sess.role, ['super'])` 的角色串是否正确）—— 属业务语义；
//   ② 不判 `payCallback` 的验签**实现**是否真生效（现由 `verifyCallbackSign` 默认 fail-closed 兜底）；
//   ③ 不判 `adminInit` / `adminLogin` 的服务端幂等与限额 —— 它们是"初始化/登录"入口，
//      结构上不可能要求 token；**其加固属 admin 面独立议题**，本守卫只保证「存在且被登记」。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const DOC_REL = 'specs/dev-specs/core/10_云函数清单与接口契约.md';
const DOC = path.join(ROOT, DOC_REL);

const NON_FN = ['common', '_adminCore'];     // 非函数目录（共享模块 / admin 复用内核）
const MIN_FNS = 40;                          // 实测 43 个函数目录 ⇒ 保守下界
const MIN_AUTHED = 25;                       // 实测 A 类 29 个 ⇒ 保守下界
const MIN_PUBLIC = 4;                        // 实测 C 类 6 个 ⇒ 保守下界
const MIN_ASSERTIONS = 15;                   // 实测 16 条 ⇒ 保守下沿
const ANCHOR_AUTHED = ['getShopContext', 'saveCostCard', 'getLedger'];   // 必然有鉴权的锚点

// 用户鉴权（**生产形态**：解构导入后直接 await 取返回值的 .error 判失败）
// ⚠️ 不能只写 `assertShopOwner(` —— `smokeTest` 里有一处 `common.assertShopOwner(db, ...)` 的
//    **探针式调用**（断言函数自身行为、不取 data）⇒ 裸匹配会把它误判成"有鉴权"（R215 实测假阴性）。
const USER_AUTH_RE = /resolveAuth\s*\(|=\s*await\s+assertShopOwner\s*\(/;
// admin 鉴权（来自 ./adminAuth 派生：requireAuth(loginLog, user, token) + requireRole(role, [...])）
const ADMIN_AUTH_RE = /requireAuth\s*\(|requireRole\s*\(/;
// 来源校验：取调用方上下文 + 用它判 OPENID 并 return 拒绝
const CTX_RE = /getWXContext\s*\(/;
const OPENID_RE = /OPENID/;
// ⚠️ 必须要求 OPENID 出现在 **if 条件里且紧接一段 return** —— 否则误判（R215 首跑实测）：
//    宽松版 `OPENID[\s\S]{0,160}?return` 会把 `const out = { openid: ctx.OPENID }; return out;`
//    这种"只读不判"的代码判成"已拒绝"（C-④ 自证样本当场转红揭穿）。
//    判据形态边界：OPENID 必须**直接**写在 if 条件中（`const u = !!ctx.OPENID; if (u) return` 这类
//    间接写法不算 —— 本守卫宁可漏（另立语义判据）也不假红，此边界明写在注释里）。
const REJECT_RE = /if\s*\([^)]*OPENID[^)]*\)[\s\S]{0,120}?\breturn\b/;

// ===== C 类（免鉴权函数）逐条登记 =====
// 每条必须写 why（≥12 字）说明「为什么结构上不可能/不需要用户鉴权」；
// mustSelfGuard: true 表示它**能拿到用户上下文**、因此必须自带来源校验（否则就是洞）。
const PUBLIC_FNS = [
  { fn: 'adminInit', why: 'admin 后台初始化（建首个超管）—— 运维在控制台执行，一次性幂等', mustSelfGuard: false },
  { fn: 'adminLogin', why: 'admin 后台登录入口 —— 登录动作本身不可能要求已有 token', mustSelfGuard: false },
  { fn: 'initDb', why: '一次性建库（仅 dev 部署 + 自带 env 门禁）—— 管理员手动运行一次', mustSelfGuard: false },
  { fn: 'payCallback', why: '微信支付回调 —— 平台调用无登录态，改由 verifyCallbackSign 验签 fail-closed 兜底', mustSelfGuard: false },
  { fn: 'payExpireNotify', why: '定时触发器任务 —— R215 已加固：有用户 OPENID 即拒绝（只放行定时/控制台）', mustSelfGuard: true },
  { fn: 'smokeTest', why: '真云诊断探针（会建集合/写库）—— R215 已加固：有用户 OPENID 即拒绝', mustSelfGuard: true },
];

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// 剥注释（块注释 + 整行 // 注释）：源码形状扫描必须先做这步，否则自述注释里的示例会自我命中
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/)
    .map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
}

// 分类（返回 'A' | 'B' | 'C'）—— 纯函数，供合成样本自证复用
function classify(code) {
  if (USER_AUTH_RE.test(code)) return 'A';
  if (ADMIN_AUTH_RE.test(code)) return 'B';
  return 'C';
}
// 来源校验判定（同上，纯函数）
function selfGuarded(code) {
  return CTX_RE.test(code) && OPENID_RE.test(code) && REJECT_RE.test(code);
}

console.log('===== S · 扫描面（fail-closed）=====');
const dirs = fs.readdirSync(CF, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !NON_FN.includes(d.name))
  .map((d) => d.name).sort();
const withIdx = dirs.filter((n) => fs.existsSync(path.join(CF, n, 'index.js')));
check('S-① 函数目录数 ≥ ' + MIN_FNS + '（扫描面非退化）', dirs.length >= MIN_FNS, '实测 ' + dirs.length + ' 个目录 / ' + withIdx.length + ' 个有 index.js');

const docOk = fs.existsSync(DOC);
check('S-② 契约文档存在', docOk, DOC_REL);
if (!docOk) {
  console.log('==== R215 云函数公开面守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
  process.exit(1);
}
const docLines = fs.readFileSync(DOC, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
check('S-② 契约文档行数 ≥ 100（没读成空/半截文件）', docLines.length >= 100, docLines.length + ' 行');

const cls = new Map();      // fn -> 'A' | 'B' | 'C'
for (const n of withIdx) {
  cls.set(n, classify(stripComments(fs.readFileSync(path.join(CF, n, 'index.js'), 'utf8'))));
}
const authedA = withIdx.filter((n) => cls.get(n) === 'A');
const authedB = withIdx.filter((n) => cls.get(n) === 'B');
const publicC = withIdx.filter((n) => cls.get(n) === 'C');
check('S-③ A 类（用户鉴权）函数数 ≥ ' + MIN_AUTHED + '（扫描面非退化）', authedA.length >= MIN_AUTHED,
  '实测 A=' + authedA.length + ' / B=' + authedB.length + ' / C=' + publicC.length);
const missAnchor = ANCHOR_AUTHED.filter((n) => cls.get(n) !== 'A');
check('S-④ 锚点函数（' + ANCHOR_AUTHED.join(' / ') + '）都在 A 类', missAnchor.length === 0,
  missAnchor.length ? '不在 A 类：' + missAnchor.join(' / ') : '三个锚点全在');

console.log('\n===== A · 三分穷尽（每个函数必有归类）=====');
const unclassified = withIdx.filter((n) => !['A', 'B', 'C'].includes(cls.get(n)));
check('A-① 每个函数都落进 A/B/C 之一（无"未分类"）', unclassified.length === 0,
  unclassified.length ? '未分类：' + unclassified.join(' / ') : withIdx.length + ' 个全部归类');
check('A-② C 类（免鉴权）数量 ≥ ' + MIN_PUBLIC + '（扫描面非退化）', publicC.length >= MIN_PUBLIC,
  '实测 ' + publicC.length + ' 个：' + publicC.join(' / '));

console.log('\n===== B · 免鉴权函数必须逐条登记 =====');
const regFns = PUBLIC_FNS.map((x) => x.fn);
const notRegistered = publicC.filter((n) => !regFns.includes(n));
check('B-① C 类全部登记在 PUBLIC_FNS（新增免鉴权函数必须补登记）', notRegistered.length === 0,
  notRegistered.length ? '未登记：' + notRegistered.join(' / ') : publicC.length + ' 个全部登记');
const noWhy = PUBLIC_FNS.filter((x) => !x.why || x.why.length < 12);
check('B-② 每条登记都有 why（≥12 字，说明为什么不需要鉴权）', noWhy.length === 0,
  noWhy.length ? '缺 why：' + noWhy.map((x) => x.fn).join(' / ') : PUBLIC_FNS.length + ' 条全有');
const stale = PUBLIC_FNS.filter((x) => !dirs.includes(x.fn));
check('B-③ 登记表无陈旧键（每条目录必须真实存在）', stale.length === 0,
  stale.length ? '目录不存在：' + stale.map((x) => x.fn).join(' / ') : PUBLIC_FNS.length + ' 条全在');
const wrongReg = PUBLIC_FNS.filter((x) => dirs.includes(x.fn) && cls.get(x.fn) !== 'C');
check('B-④ 反向：「已带鉴权却仍登记为免鉴权」⇒ 红（登记表不得腐化）', wrongReg.length === 0,
  wrongReg.length ? '已鉴权仍登记：' + wrongReg.map((x) => x.fn + '(' + cls.get(x.fn) + ')').join(' / ') : '无过期登记');

console.log('\n===== C · 定时/探针类必须自带来源校验 =====');
const mustGuard = PUBLIC_FNS.filter((x) => x.mustSelfGuard === true);
check('C-① 必须自保的登记项数 ≥ 2（定时 + 探针）', mustGuard.length >= 2, '实测 ' + mustGuard.length + ' 项：' + mustGuard.map((x) => x.fn).join(' / '));
const guardBad = [];
for (const x of mustGuard) {
  const p = path.join(CF, x.fn, 'index.js');
  if (!fs.existsSync(p)) { guardBad.push(x.fn + '(无 index.js)'); continue; }
  if (!selfGuarded(stripComments(fs.readFileSync(p, 'utf8')))) guardBad.push(x.fn);
}
check('C-② 每个必须自保的函数都真的判了来源（OPENID 后 return 拒绝）', guardBad.length === 0,
  guardBad.length ? '未自保：' + guardBad.join(' / ') : mustGuard.length + ' 个已判');
// 解析器自证（合成样本）：否则 selfGuarded 一坏，C-② 就静默恒假/恒真
const SAMPLE_GUARDED = 'exports.main = async () => { const ctx = cloud.getWXContext(); if (ctx && ctx.OPENID) return fail(ERROR_CODES.FORBIDDEN); };';
const SAMPLE_OPEN = 'exports.main = async () => { const ctx = cloud.getWXContext(); const out = { openid: ctx.OPENID }; return out; };';
check('C-③ 解析器自证：判了来源的样本 ⇒ true', selfGuarded(SAMPLE_GUARDED) === true);
check('C-④ 解析器自证：只取 OPENID 不拒绝的样本 ⇒ false', selfGuarded(SAMPLE_OPEN) === false);

console.log('\n===== D · 自失效护栏 =====');
const total = pass + failN + 2;    // +2 = 本段两条断言自身
check('D-① 断言数 ≥ ' + MIN_ASSERTIONS + '（实测 ' + total + ' 的保守下沿）', total >= MIN_ASSERTIONS, '本段之前 ' + (pass + failN) + ' 条');
check('D-② 扫描面文件数 ≥ ' + MIN_FNS + '（防"扫空 ⇒ 全绿"）', withIdx.length >= MIN_FNS, '实测 ' + withIdx.length + ' 个 index.js');

console.log('\n==== R215 云函数公开面守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
