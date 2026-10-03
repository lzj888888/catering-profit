// tools/check_auth_guard_shape.js —— 【R194】鉴权返回形状守卫（「越权拦截不得静默失效」）
// 运行：node tools/check_auth_guard_shape.js
//
// 为什么需要它（真实缺陷，2026-10-03 实测）：
//   `common/auth.js::assertShopOwner` 曾用 `fail(code)` 构造失败返回，而 `common/errors.js::fail()`
//   产出 **`{code, msg, data}`（没有 `error` 字段）**；而**全部 20 处**调用点统一写成
//      `const owner = await assertShopOwner(...); if (owner.error) return fail(owner.error, owner.msg);`
//   ⇒ `owner.error` **恒为 undefined** ⇒ 分支永不进入 ⇒ **归属校验形同不存在**。
//   真实后果：任意已登录用户把 `shop_id` 换成别人的，即可读/写他人店铺数据。
//   本地探针（修前）：返回 `{"code":"FORBIDDEN",...}`，`owner.error === undefined` ⇒ 放行。
//
// 🔴 为什么既有门禁一条都没抓到：A15 只守「cloudfunctions 有没有被顺手改」，
//    check_error_codes（L 组）只守「错误码全集 ≡ 定义」，而本缺陷是**返回形状 ↔ 判据字段的失配**——
//    两侧各自都"合法"，只有把两处**放在一起看**才发现。这正是本守卫存在的唯一理由。
//
// 判据（六条，全部形态/语义级，不做裸 includes 假绿）：
//   G1 扫描面非退化（fail-closed）：单源存在且够长；派生副本数 ≥ 实测下沿。
//   G2 `assertShopOwner` **每个 return 分支都显式给出 error 字段**（成功给 error: null）。
//   G3 单源 `auth.js` **不得再出现 `return ok(...)` / `return fail(...)`**（那是本次根因）。
//   G4 派生副本同形：抽 ≥ 3 个函数目录的 cx_auth.js，assertShopOwner 也必须是 {error} 形状
//      （证明修复**真的派生出去了**，不是只改了单源）。
//   G5 关键锚点在场：`FORBIDDEN` 分支必须还在（防止有人"修好形状"顺手删了越权拦截本体）。
//   G6 调用点判据统一：**生产调用点**（`= await assertShopOwner(`，不带 `common.` 限定）
//      一律用 `.error` 判，且**不得**出现 `.code ===` 变体（成功返回已无 code 字段，判 code 会变成新的恒假分支）。
//      ⚠️ `smokeTest` 的 `common.assertShopOwner(db, '__no_such_shop__', …)` 是**探针式**调用
//         （断言函数自身行为、不取 data）⇒ 按"带 `common.` 限定 = 探针"排除，不做 fake 例外名单。
//
// 🔴 三条实现教训（首跑 14/17 三红，全是**我方判据错**，不是被测代码错）：
//   ① 按「行首是 return」取分支 ⇒ 漏掉 `if (…) return …;` 的单行形态（实测 4 条只数到 2）
//      ⇒ 改为**按 return 关键字切段**，形态无关。
//   ② 注释里的示例代码会被源码形状扫描命中（我的自述注释里写了 `return fail(`）⇒ **先剥注释再扫**。
//   ③ 探针式调用不是"漏判"，别把它当缺陷记 —— 判据要能区分**生产调用点**与**探针调用点**。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_REL = 'cloudfunctions/common/auth.js';
const SRC = path.join(ROOT, SRC_REL);
const CF = path.join(ROOT, 'cloudfunctions');
const MIN_COPIES = 40;        // 实测 43 个函数目录各有一份 cx_auth.js ⇒ 保守下界 40
const MIN_CALL_SITES = 18;    // 实测 20 处生产调用点 ⇒ 保守下沿

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

// 取函数体（从函数名后的第一个 { 起做花括号配平）。取不到 ⇒ null（调用方 fail-closed）。
function fnBody(src, fname) {
  const at = src.indexOf('function ' + fname + '(');
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

console.log('===== G1 扫描面（fail-closed）=====');
const srcOk = fs.existsSync(SRC);
check('G1 单源 auth.js 存在', srcOk, SRC_REL);
if (!srcOk) { console.log('==== R194 鉴权返回形状守卫：' + pass + ' 通过 / ' + failN + ' 失败 ===='); process.exit(1); }

const rawSrc = fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '');
const src = stripComments(rawSrc);
check('G1 单源长度 ≥ 2000 字符（没读成空/半截文件）', rawSrc.length >= 2000, rawSrc.length + ' 字符');

const dirs = fs.readdirSync(CF, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'common' && d.name !== '_adminCore')
  .map((d) => d.name).sort();
const copies = dirs.filter((n) => fs.existsSync(path.join(CF, n, 'cx_auth.js')));
check('G1 派生副本 cx_auth.js 数 ≥ ' + MIN_COPIES + '（扫描面非退化）', copies.length >= MIN_COPIES, '实测 ' + copies.length + ' 个');

console.log('\n===== G2 assertShopOwner 每个分支都带 error 字段 =====');
const body = fnBody(src, 'assertShopOwner');
check('G2 能切出 assertShopOwner 函数体', !!body);
if (body) {
  // 按 return 关键字切段（形态无关：单行 if / 块 / 多行都算），看紧邻片段里有没有 error:
  const segs = body.split(/\breturn\b/).slice(1);
  const bad = segs.filter((s) => !/error\s*:/.test(s.slice(0, 200)));
  check('G2 return 分支数 ≥ 3（空 id / 不存在或软删 / 非本人）', segs.length >= 3, segs.length + ' 条');
  check('G2 所有 return 都显式带 error 字段', bad.length === 0,
    bad.length ? '缺 error：' + bad.map((s) => s.slice(0, 40).trim()).join(' | ') : segs.length + ' 条全带');
  check('G2 成功分支给 error: null（不是只给 data）', /error\s*:\s*null/.test(body));
}

console.log('\n===== G3 单源不得再用 ok()/fail() 构造返回（本次根因）=====');
check('G3 无 return ok(...)', (src.match(/return\s+ok\s*\(/g) || []).length === 0);
check('G3 无 return fail(...)', (src.match(/return\s+fail\s*\(/g) || []).length === 0);
// 只在「引入 ./errors 的那一行」上做词边界检查（别扫全文：`fail` 会撞到注释与其它标识符）
const errImport = src.split(/\r?\n/).filter((l) => /require\('\.\/errors'\)/.test(l)).join('\n');
const hasOk = /(?:^|[^A-Za-z0-9_$])ok(?:[^A-Za-z0-9_$]|$)/.test(errImport);
const hasFail = /(?:^|[^A-Za-z0-9_$])fail(?:[^A-Za-z0-9_$]|$)/.test(errImport);
check('G3 也不再从 errors 引入 ok/fail（避免"留着等人再踩"）', errImport.length > 0 && !hasOk && !hasFail,
  errImport.length ? errImport.trim() : '未找到 require(\'./errors\') 行');

console.log('\n===== G4 派生副本同形（修复真的派出去了）=====');
const sample = copies.slice(0, 3);
check('G4 至少抽到 3 个函数目录的副本', sample.length === 3, sample.join(' / '));
const copyBad = [];
for (const n of sample) {
  const b = fnBody(stripComments(fs.readFileSync(path.join(CF, n, 'cx_auth.js'), 'utf8')), 'assertShopOwner');
  if (!b || !/error\s*:\s*null/.test(b) || !/error\s*:\s*ERROR_CODES\.FORBIDDEN/.test(b)) copyBad.push(n);
}
check('G4 抽检副本的 assertShopOwner 已是 error 形状', copyBad.length === 0,
  copyBad.length ? '仍旧形状：' + copyBad.join(' / ') : sample.length + ' 个同形');

console.log('\n===== G5 越权拦截本体还在（关键锚点在场）=====');
check('G5 单源含 FORBIDDEN 分支', /error\s*:\s*ERROR_CODES\.FORBIDDEN/.test(src));
check('G5 单源仍比对 shop.user_id 与传入 userId', /shop\.user_id\s*!==\s*userId/.test(src));

console.log('\n===== G6 调用点判据与返回形状一致 =====');
const callers = [];
for (const n of dirs) {
  const p = path.join(CF, n, 'index.js');
  if (!fs.existsSync(p)) continue;
  const t = stripComments(fs.readFileSync(p, 'utf8'));
  if (!/=\s*await\s+assertShopOwner\s*\(/.test(t)) continue;   // 生产形态：解构导入后直接调用取返回值
  callers.push({ n, t });
}
check('G6 生产调用点数量 ≥ ' + MIN_CALL_SITES + '（扫描面非退化）', callers.length >= MIN_CALL_SITES, '实测 ' + callers.length + ' 个函数');
const wrongJudge = callers.filter((c) => !/owner\.error/.test(c.t)).map((c) => c.n);
check('G6 每个调用点都用 .error 判失败', wrongJudge.length === 0,
  wrongJudge.length ? '未判：' + wrongJudge.join(' / ') : callers.length + ' 个全判');
const codeJudge = callers.filter((c) => /owner\.code/.test(c.t)).map((c) => c.n);
check('G6 无 owner.code 变体（成功返回已无 code 字段，判它会恒假）', codeJudge.length === 0,
  codeJudge.length ? '混用：' + codeJudge.join(' / ') : '无混用');

console.log('\n==== R194 鉴权返回形状守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
