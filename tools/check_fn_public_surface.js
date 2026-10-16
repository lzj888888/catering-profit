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
//   E 契约「鉴权」列 ≡ 实然归属校验（**R298 / B4 越权面**）：契约说 `user+shop` 的函数，
//     代码里必须真的做归属校验（`= await assertShopOwner(`），或显式登记进 SHOP_AUTH_WAIVED；
//     豁免表双向防腐 + 解析器自证（含「入参格里带转义竖线」的样本 —— 手切列会切歪）。
//     ⚠️ E 组**置于 D 组之前**，使 D-①「断言数下界」覆盖全部判据（D 是收尾的自失效护栏）。
//   F 自失效护栏：断言数下界 + 扫描面文件数下界（防"扫空 ⇒ 0 ≤ 预算 ⇒ 恒绿"）。
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
const MIN_ASSERTIONS = 20;                   // R298 扩 E 组后实测 27 条 ⇒ 保守下沿 20（原 17 条时为 15）
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
  // 🔴 R298（B4）：本项原先 `mustSelfGuard: false`，理由写的是「不读 OPENID、不写库」——
  //   那句**只回答了「它自己会不会写坏数据」，没回答「别人能不能调它」**。实测：
  //   `wx.cloud.callFunction({name:'verifyTangshi'})` 是**客户端可直达**的（其自身头注的触发方式就是 `mp.evaluate`），
  //   返回 `{count, sumYuan, shopIds, ...}` ⇒ **跨租户**暴露（含他人 `shop_id` 列表 + 全库聚合）。
  //   ⇒ 与 `payExpireNotify` / `smokeTest` 同族，按 R215 定式改为必须自保（同批已在源码侧加来源校验）。
  { fn: 'verifyTangshi', why: 'M3.33 一次性只读探针（固定 where 聚合 external_sales_daily；不写库）—— R298 已加固：有用户 OPENID 即拒绝', mustSelfGuard: true },
];

// ===== E 组配套：契约「鉴权」列含 shop、但**有意不做** `assertShopOwner` 的登记表 =====
// 双向防腐（同 §B 组手法）：① 陈旧键（契约里其实不含 shop）⇒ 红；② 腐化（代码其实做了归属校验）⇒ 红。
// 每条必须写 why ≥12 字。
const SHOP_AUTH_WAIVED = [
  {
    fn: 'getShopContext',
    why: '恒取「本人第一店」（da.list(shop,{user_id})[0]），**完全忽略** event.shop_id ⇒ 按构造不可能读到他人店',
  },
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
// 🔴 R298：下界由 2 抬到 3 —— 原下界=2 时，**把某一项改回 mustSelfGuard:false 就能静默缩表**
//   （实测：verifyTangshi 改回 false 后 C-① 仍绿、C-② 只查剩下 2 项也绿）⇒ 覆盖数必须钉住。
check('C-① 必须自保的登记项数 ≥ 3（定时 + 两个探针）', mustGuard.length >= 3, '实测 ' + mustGuard.length + ' 项：' + mustGuard.map((x) => x.fn).join(' / '));
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


console.log('\n===== E · 契约「鉴权」列 ≡ 实然归属校验（R298 · B4 越权面）=====');
// 解析契约表行。🔴 必须按**未转义**的竖线切：`|` 在 markdown 表格里可用 `\|` 转义，
//   而本表「入参」格里的联合类型写作 `'cc'\|'user'\|'shop'\|'all'` ⇒ 朴素 split('|') 会把列**整体切歪**，
//   于是「鉴权」列会读到邻格内容（实测：smokeTest 的入参格含 'shop' ⇒ 它的鉴权格被误读成含 shop）。
function contractAuthByFn(lines) {
  const out = [];
  for (const l of lines) {
    const m = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/.exec(l);
    if (!m) continue;
    const parts = l.split(/(?<!\\)\|/);
    if (parts.length < 7) continue;
    out.push({ fn: m[1], auth: parts[parts.length - 2].trim() });
  }
  return out;
}
const contractRows = contractAuthByFn(docLines);
const shopAuthFns = contractRows.filter((r) => /shop/i.test(r.auth)).map((r) => r.fn).filter((n) => withIdx.includes(n));
check('E-① 契约「鉴权」列含 shop 的函数数 ≥ 24（解析器非退化）', shopAuthFns.length >= 24, '实测 ' + shopAuthFns.length + ' 个');
// 生产形态归属校验（与 A 组同口径：解构导入后直接 await 取返回值）
const OWNER_PROD_RE = /=\s*await\s+assertShopOwner\s*\(/;
function hasOwnerCheck(fn) {
  const p = path.join(CF, fn, 'index.js');
  if (!fs.existsSync(p)) return false;
  return OWNER_PROD_RE.test(stripComments(fs.readFileSync(p, 'utf8')));
}
const waivedFns = SHOP_AUTH_WAIVED.map((x) => x.fn);
const noOwner = shopAuthFns.filter((n) => !hasOwnerCheck(n) && !waivedFns.includes(n));
check('E-② 契约含 shop 的函数都必须有归属校验（或显式豁免）', noOwner.length === 0,
  noOwner.length ? '缺归属校验：' + noOwner.join(' / ') : shopAuthFns.length + ' 个已覆盖（含 ' + waivedFns.length + ' 条豁免）');
const staleWaive = SHOP_AUTH_WAIVED.filter((x) => !shopAuthFns.includes(x.fn));
check('E-③ 豁免表无陈旧键（契约里确实标了含 shop）', staleWaive.length === 0,
  staleWaive.length ? '陈旧：' + staleWaive.map((x) => x.fn).join(' / ') : waivedFns.length + ' 条均对应');
const rotWaive = SHOP_AUTH_WAIVED.filter((x) => hasOwnerCheck(x.fn));
check('E-④ 豁免表反向防腐：已补归属校验却仍登记豁免 ⇒ 红', rotWaive.length === 0,
  rotWaive.length ? '已补仍登记：' + rotWaive.map((x) => x.fn).join(' / ') : '无腐化');
const noWhy2 = SHOP_AUTH_WAIVED.filter((x) => !x.why || x.why.length < 12);
check('E-⑤ 每条豁免都有 why（≥12 字，说明为什么不需要归属校验）', noWhy2.length === 0,
  noWhy2.length ? '缺 why：' + noWhy2.map((x) => x.fn).join(' / ') : SHOP_AUTH_WAIVED.length + ' 条全有');
const ownerCount = withIdx.filter(hasOwnerCheck).length;
check('E-⑥ 有归属校验的函数数 ≥ 26（扫描面非退化）', ownerCount >= 26, '实测 ' + ownerCount + ' 个');
// 解析器自证（合成样本）：正样本含转义竖线的入参格，负样本鉴权列不含 shop
const SAMPLE_SHOP = '| `fakeShopFn` | 用途 | `{ x: \'a\'\\|\'b\' }` | `{}` | user+shop |';
const SAMPLE_USER = '| `fakeUserFn` | 用途 | `{ shop_id }` | `{}` | user |';
const parsedShop = contractAuthByFn([SAMPLE_SHOP]);
const parsedUser = contractAuthByFn([SAMPLE_USER]);
check('E-⑦ 解析器自证：带转义竖线的 user+shop 行 ⇒ 认出该函数且鉴权含 shop',
  parsedShop.length === 1 && parsedShop[0].fn === 'fakeShopFn' && /shop/i.test(parsedShop[0].auth),
  parsedShop.length ? (parsedShop[0].fn + ' / auth=' + parsedShop[0].auth) : '未解析出');
check('E-⑧ 解析器自证：鉴权列=user 的行 ⇒ 不落入 shop 面（哪怕入参格含 shop_id）',
  parsedUser.length === 1 && !/shop/i.test(parsedUser[0].auth),
  parsedUser.length ? ('auth=' + parsedUser[0].auth) : '未解析出');
// 🔴 R298 变异回灌实证（M6，第一次跑「未如期」）：只写 E-⑦/E-⑧ 时，把 `split(/(?<!\\)\|/)`
//   退回朴素 `split('|')` **判据照样全绿** —— 因为转义竖线落在**中间**格子，
//   而取法是 `parts[parts.length - 2]`（倒数第二格），对"中部多切几刀"天然免疫。
//   ⇒ 那次的 M6 属**变异太弱**（测的是假的），不是守卫太弱。
//   真正的分辨点在**鉴权格自身含转义竖线**（如 `user+shop\|幂等`）：朴素切法会把该格劈成两段，
//   倒数第二格只剩「幂等」⇒ 判据必须能抓到。下面这条样本就是为此补的。
const SAMPLE_AUTH_PIPE = '| `fakePipeFn` | 用途 | `{ }` | `{}` | user+shop\\|幂等 |';
const parsedPipe = contractAuthByFn([SAMPLE_AUTH_PIPE]);
check('E-⑨ 解析器自证：鉴权格**内含转义竖线**（user+shop\\|幂等）⇒ 仍读出该格且含 shop',
  parsedPipe.length === 1 && /shop/i.test(parsedPipe[0].auth) && /幂等/.test(parsedPipe[0].auth),
  parsedPipe.length ? ('auth=' + parsedPipe[0].auth) : '未解析出');

console.log('\n===== D · 自失效护栏 =====');
const total = pass + failN + 2;    // +2 = 本段两条断言自身
check('D-① 断言数 ≥ ' + MIN_ASSERTIONS + '（实测 ' + total + ' 的保守下沿）', total >= MIN_ASSERTIONS, '本段之前 ' + (pass + failN) + ' 条');
check('D-② 扫描面文件数 ≥ ' + MIN_FNS + '（防"扫空 ⇒ 全绿"）', withIdx.length >= MIN_FNS, '实测 ' + withIdx.length + ' 个 index.js');

console.log('\n==== R215 云函数公开面守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
