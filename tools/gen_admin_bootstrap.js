#!/usr/bin/env node
/**
 * tools/gen_admin_bootstrap.js —— 首超管（bootstrap）凭据生成器
 *
 * 为什么需要它（R58）：
 *   core/16 §7 要求「首超管不可由代码自动建」，引导方式写明「运维执行 adminInit（**或控制台脚本**）」。
 *   但 `adminInit` 的 env 门禁是 **prod 恒拒**（index.js:22 `/prod/` → 拒，空 env 也拒）
 *   ⇒ **prod 环境没有可用的 bootstrap 通道**；而手工往 `admin_user` 插文档又算不出 scrypt 密码哈希。
 *   同时 R48 之后 `requireAuth` 是 fail-closed（`status !== 'active'` 一律拒），
 *   手工插入的文档**必须**带 `status:'active'`，否则该管理员被永久拒且 `adminInit`「已有记录即拒」无法自愈。
 *
 * 本脚本把这条路径变成「可复现 + 可自检 + 不会漏字段」：
 *   1. 复用**交付物本身**的哈希实现（`cloudfunctions/_adminCore/adminAuth.js` 单源，零依赖纯 node crypto），
 *      不重写算法、不引入第二套实现；
 *   2. 逐字段对齐 `adminInit/index.js` 写入 `admin_user` 的形状（**从源码解析比对**，防两侧漂移）；
 *   3. 生成后立刻用同一套 `verifyPassword` 做**回环自检**（哈希→校验必须为真）；
 *   4. 只打印、不落盘（除非显式 `--out`）；不打印明文密码；不写日志。
 *
 * 用法：
 *   node tools/gen_admin_bootstrap.js --username <2~32位字母数字下划线> --password <8~64位>
 *        [--role super|op] [--admin-id adm_xxx] [--out <文件.json>] [--now <unix_ms>]
 *   # 事后校验（例如核对控制台里那条记录是否与本次生成一致）：
 *   node tools/gen_admin_bootstrap.js --verify --password <明文> --salt <hex> --hash <hex>
 *
 * 控制台落地步骤（prod / dev 通用）：
 *   云开发控制台 → 数据库 → 集合管理 → `admin_user` → 添加记录 → 切换到 JSON 视图 → 粘贴本脚本输出的 JSON → 保存
 *   ⚠️ 必须确认 `status` 字段为字符串 "active"（R48 fail-closed 的放行条件）
 *   ⚠️ 首个超管建好后，后续管理员一律走后台「新增管理员」（写 audit_log）或 dev 的 adminInit
 *
 * ⚠️ 安全：明文密码只在本机进程内使用，不写盘、不进日志、不进仓库；
 *    本脚本位于 `tools/`（已在 project.config.json 的 packOptions.ignore 内），不会随小程序包发布。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ADMIN_AUTH = path.join(ROOT, 'cloudfunctions', '_adminCore', 'adminAuth.js');
const ADMIN_INIT = path.join(ROOT, 'cloudfunctions', 'adminInit', 'index.js');

// ---------- 小工具 ----------
function die(msg) {
  console.error('[FAIL] ' + msg);
  process.exit(1);
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verify') { out.verify = true; continue; }
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) die('参数 ' + a + ' 缺值');
      out[k] = v;
      i++;
    } else out._.push(a);
  }
  return out;
}

// ---------- 1. 复用交付物里的哈希实现（不引第二套） ----------
if (!fs.existsSync(ADMIN_AUTH)) die('找不到单源 auth 模块：' + ADMIN_AUTH);
const auth = require(ADMIN_AUTH);
for (const fn of ['genSalt', 'hashPassword', 'verifyPassword']) {
  if (typeof auth[fn] !== 'function') die('单源 auth 未导出 ' + fn + '()，实现已变，请复核本脚本');
}

// ---------- 2. 从 adminInit 源码解析「期望字段集」，防两侧漂移 ----------
/**
 * 取出 `db.collection('admin_user').add({ data: { ... } })` 里的顶层字段名。
 * 只做括号配平 + 顶层 `key:` 匹配，不执行被解析代码。
 */
function expectedFieldsFromAdminInit() {
  const src = fs.readFileSync(ADMIN_INIT, 'utf8');
  const at = src.indexOf("collection('admin_user')");
  if (at < 0) die('adminInit 里找不到 collection(\'admin_user\')，实现已变，请复核本脚本');
  const open = src.indexOf('data:', at);
  if (open < 0) die('adminInit 里找不到 data:，实现已变，请复核本脚本');
  const braceStart = src.indexOf('{', open);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) die('adminInit 的 data 块括号不配平，请复核本脚本');
  const body = src.slice(braceStart + 1, end);
  const keys = [];
  let d = 0;
  const lines = body.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (d === 0) {
      // 兼容两种写法：`role: 'super',` 与简写 `salt,`（adminInit 里 salt 用的就是简写）
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/.exec(t);
      if (m) keys.push(m[1]);
    }
    for (const ch of line) { if (ch === '{' || ch === '[') d++; else if (ch === '}' || ch === ']') d--; }
  }
  return keys;
}

const EXPECTED = expectedFieldsFromAdminInit();

// ---------- 3. 组装文档 ----------
function buildDoc(opts) {
  const salt = auth.genSalt();
  const pwdHash = auth.hashPassword(opts.password, salt);
  const adminId = opts.adminId ||
    ('adm_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36));
  const now = opts.now != null ? Number(opts.now) : Date.now();
  return {
    doc: {
      admin_id: adminId,
      username: opts.username,
      pwd_hash: pwdHash,
      salt,
      role: opts.role,
      status: 'active',        // ← R48 fail-closed 的放行条件，必须为字符串 'active'
      locked_until: 0,
      last_login_at: 0,
      created_at: now,
      updated_at: now,
    },
    salt, pwdHash,
  };
}

// ---------- 4. 自检 ----------
function selfCheck(doc, password) {
  const errs = [];
  const got = Object.keys(doc);
  const missing = EXPECTED.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !EXPECTED.includes(k));
  if (missing.length) errs.push('缺 adminInit 期望字段: ' + missing.join(', '));
  if (extra.length) errs.push('多出 adminInit 没有的字段: ' + extra.join(', '));
  if (doc.status !== 'active') errs.push("status 必须为字符串 'active'（R48 fail-closed）");
  if (!auth.verifyPassword(password, doc.salt, doc.pwd_hash)) errs.push('哈希回环自检失败（verifyPassword 为假）');
  if (!/^[A-Za-z0-9_]{2,32}$/.test(doc.username)) errs.push('username 不符合 adminInit 的校验：2~32 位字母/数字/下划线');
  if (typeof password !== 'string' || password.length < 8 || password.length > 64) errs.push('password 不符合 adminInit 的校验：8~64 位');
  if (typeof doc.pwd_hash !== 'string' || doc.pwd_hash.length !== 128) errs.push('pwd_hash 应为 64 字节 hex（128 字符）');
  if (typeof doc.salt !== 'string' || doc.salt.length !== 32) errs.push('salt 应为 16 字节 hex（32 字符）');
  return errs;
}

// ---------- main ----------
const args = parseArgs(process.argv.slice(2));

if (args.verify) {
  const { password, salt, hash } = args;
  if (!password || !salt || !hash) die('--verify 需要 --password --salt --hash 三者');
  const okv = auth.verifyPassword(password, salt, hash);
  console.log(okv ? '[OK] 该 (password, salt, hash) 三者自洽 —— 控制台记录与本次生成一致'
                   : '[FAIL] 三者不自洽：可能抄错、或记录被改过');
  process.exit(okv ? 0 : 1);
}

const username = args.username;
const password = args.password;
if (!username) die('缺 --username');
if (!password) die('缺 --password');
const role = args.role || 'super';
if (role !== 'super' && role !== 'op') die('--role 只能是 super 或 op');
const nowArg = args.now != null ? args.now : undefined;

const { doc } = buildDoc({ username, password, role, adminId: args['admin-id'], now: nowArg });
const errs = selfCheck(doc, password);
if (errs.length) {
  console.error('[FAIL] 自检未通过：');
  errs.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}

console.log('=== admin_user 文档（复制此 JSON 到控制台 → 添加记录 → JSON 视图）===');
console.log(JSON.stringify(doc, null, 2));
console.log('');
console.log('=== 自检 ===');
console.log('[OK] 字段集 ≡ adminInit 写入形状：' + EXPECTED.join(', '));
console.log('[OK] status = "active"（R48 fail-closed 放行条件）');
console.log('[OK] 哈希回环：verifyPassword(password, salt, pwd_hash) === true');
console.log('[OK] 算法同源：cloudfunctions/_adminCore/adminAuth.js（scryptSync, keylen=64, 盐 16 字节 hex）');
console.log('');
console.log('=== 落地步骤 ===');
console.log('1. 云开发控制台 → 数据库 → 集合管理 → admin_user → 添加记录 → 切换 JSON 视图 → 粘贴上面的 JSON → 保存');
console.log('2. 保存后核对：status 为字符串 "active"、pwd_hash 128 字符、salt 32 字符');
console.log('3. 用 adminLogin 登录验证（5 次密码错误会锁 30 分钟，别试错）');
console.log('4. ⚠️ 首个超管建好后，后续管理员一律走后台「新增管理员」（写 audit_log）');
console.log('5. ⚠️ 明文密码勿留在剪贴板/聊天记录；本脚本不落盘（除非 --out）');

if (args.out) {
  fs.writeFileSync(args.out, JSON.stringify(doc, null, 2), 'utf8');
  console.log('');
  console.log('[INFO] 已写出：' + args.out + '（内含 pwd_hash/salt，勿提交仓库）');
}
