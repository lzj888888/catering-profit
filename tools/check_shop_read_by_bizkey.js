// tools/check_shop_read_by_bizkey.js —— R201 · 守「读库不得用业务键当文档主键」
//
// 根因（R201 真机实锤，证据 review/evidence/R201_console_dump*.txt）：
//   `common/auth.js::assertShopOwner` 写的是 `db.collection('shop').doc(shopId).get()`，
//   而 `shopId` 是**业务键**（`shop.shop_id` 字段值），不是文档 `_id`。
//   微信云开发 `collection.add()` 的 `_id` 由**库自动生成**，`data` 里写的 `_id` **不生效**
//   ⇒ 真实 `_id` ≠ `shop_id` ⇒ `doc(shopId)` 必然 miss ⇒ 统一 `RESOURCE_NOT_FOUND`
//   ⇒ 前端映射成「数据不存在或已被删除」⇒ 真机 4 条反馈同根因。
//
// 本守卫守四条不变式（缺一条就红）：
//   A. `assertShopOwner` 必须有「`_id` miss ⇒ 按 `shop_id` 字段 where 兜底」的路径；
//   B. `assertShopOwner` 的**裸 `doc(shopId)` 形态不得回归**（只允许先查后兜底的快路径）；
//   C. 建店侧不得再写「`data` 里携带 `_id` 以为生效」的形态。
//   D. 🔴 R202 追加：**候选业务键必须 ≥ 2（`shop_id` 与 `id` 同时在场）**。
//      —— R201 只加 `shop_id` 兜底**不足以**修复真机：真云诊断显示存量 `shop` 文档
//         **没有 `shop_id` 字段**，业务键在 `id` 上（同一键三路实测：_id → [] · shop_id → [] · id → ✅）。
//      —— 而读侧 `getShopContext` / `getShopList` 一直是 `shop.shop_id || shop.id`。
//         ⇒ 鉴权侧候选集必须与读侧**一致**，否则「读得到、鉴权 404」的口径分裂会复发。
//
// 🔴 为什么这条必须机器守：它是**假绿型**缺陷 —— 代码读起来完全合理、单跑任何测试都过，
//   只有真云上「按 _id 查」与「按字段查」两条路径结果相反时才暴露（R201 实测就是如此）。
//
// 🔴 本守卫自带**影子用例**（S3-a/S3-b）：把判据函数拿去做「变异体」测试，
//   削弱判据时会自己转红（防「把阈值改大以绕过」这类削弱变异）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUTH_REL = 'cloudfunctions/common/auth.js';

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log('✅ ' + name); }
  else { fail += 1; console.log('❌ ' + name + (detail ? ' — ' + detail : '')); }
}

function readAuth() {
  const p = path.join(ROOT, AUTH_REL);
  return { p, code: fs.readFileSync(p, 'utf8') };
}

/** 取 `assertShopOwner` 的函数体（花括号配平，兼容多行块形态） */
function fnBody(code, fname) {
  const at = code.indexOf('async function ' + fname);
  if (at < 0) return null;
  const open = code.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}

// ===== 扫描面非退化（上限类判据的自失效护栏：扫空 ⇒ 恒绿）=====
const A = readAuth();
check('A-① assertShopOwner 存在且函数体可提取', fnBody(A.code, 'assertShopOwner') !== null);
check('A-② 单源文件体积非退化（≥ 60 行，防扫空/截断）',
  A.code.split(/\r?\n/).length >= 60, '实际 ' + A.code.split(/\r?\n/).length + ' 行');

const body = fnBody(A.code, 'assertShopOwner') || '';

// ===== A. where 兜底路径在位 =====
const hasWhereFallback = /collection\(\s*['"]shop['"]\s*\)\s*\.where\(/.test(body)
  && /shop_id\s*:\s*shopId/.test(body);
check('A-③ assertShopOwner 有「按 shop_id 字段 where 兜底」路径（R201 修法本体）',
  hasWhereFallback, 'body 内未见 where({ ...shop_id: shopId ... })');

// ===== B. 裸 doc(shopId) 形态不得回归 =====
const docCall = /collection\(\s*['"]shop['"]\s*\)\s*\s*\n?\s*\.doc\(([^)]*)\)/.exec(body);
check('A-④ assertShopOwner 内仍有 doc() 快路径（新数据直接命中）', docCall !== null,
  '未见 collection(\'shop\').doc(...)');
if (docCall) {
  const arg = docCall[1].trim();
  // 允许：变量（R201 已改）、以及显式的 _id 变量；不允许：直接把业务键语义塞进去又直接 return
  check('A-⑤ doc() 的入参已改为「可含兜底的变量」而非裸表达式', arg.length > 0, 'arg=' + arg);
}

// ===== C. 建店侧不得再写「data 里携带 _id」=====
// 🔴 r201b 实测踩坑：初版用 `data\s*:\s*\{[^}]*_id\s*:` 判，**误判成红** ——
//   `[^}]*` 会跨行扫到 `data: {` 之后，而 R201 修法在**注释里**写了 `` `_id` `` 三次
//   ⇒ 判据把注释当代码 ⇒ 首跑 2 红（A-⑦/A-⑨），**代码本来是对的**（我方判据错，不是代码错）。
//   ⇒ 修法：**只认代码行**（剥掉 `//` 行注释与 `/* */` 块注释后再判），
//     并且**逐行**判（不跨行拼接），避免"注释/字面量里的同名字段"污染。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
    .join('\n');
}

/** 在 `add(` 之后的代码行里找 `data` 对象是否带 `_id:` 字段（只看代码，不看注释） */
function dataCarriesId(seg) {
  if (!seg) return false;
  const codeOnly = stripComments(seg);
  // 形态 1：单行 `data: { _id: x, ... }`
  if (/data\s*:\s*\{[^}\n]*?(^|[\s,{])_id\s*:/.test(codeOnly)) return true;
  // 形态 2：多行块 `data: {\n  _id: x,\n ... }`
  const lines = codeOnly.split(/\r?\n/);
  let inData = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (/data\s*:\s*\{/.test(l)) {
      inData = true;
      // 同一行就闭合的情况已由形态 1 覆盖；这里只处理 `data: {` 后紧跟内容的多行块
      const after = l.replace(/^.*data\s*:\s*\{/, '');
      if (/(^|[\s,{])_id\s*:/.test(after)) return true;
      continue;
    }
    if (inData) {
      if (l === '}' || l === '},') { inData = false; continue; }
      if (/^_id\s*:/.test(l)) return true; // data 对象内的第一个字段就是 _id ⇒ 违规
    }
  }
  return false;
}

const addShopAt = A.code.indexOf("collection('shop').add");
const addShopSeg = addShopAt >= 0 ? A.code.slice(addShopAt, addShopAt + 700) : '';
check('A-⑥ 建店侧 collection(\'shop\').add 可定位', addShopSeg !== '');
check('A-⑦ 建店 data 内不再携带 _id（R201：add 的 _id 由库生成、不生效）',
  !dataCarriesId(addShopSeg), 'data 对象首个字段是 _id');

const addEntAt = A.code.indexOf("collection('shop_entitlement').add");
const addEntSeg = addEntAt >= 0 ? A.code.slice(addEntAt, addEntAt + 700) : '';
check('A-⑧ 建 entitlement 侧可定位', addEntSeg !== '');
check('A-⑨ 建 entitlement data 内不再携带 _id（同 A-⑦）',
  !dataCarriesId(addEntSeg), 'data 对象首个字段是 _id');

// ===== A2. R202 追加：`id` 字段兜底必须在位（R201 只加 `shop_id` 是不够的）=====
// 🔴 R202 真云实锤（`initDb{only:'diag_shop'}` 只读诊断）：
//   存量 `shop` 文档真实 keys = [_id, id, user_id, name, remark, created_at, is_deleted, updated_at, biz_type]
//   —— **没有 `shop_id` 字段** ⇒ R201 的 ② 段 where 必然 miss，23 个调用点仍全 404。
//   同一业务键三路实测：where({_id}) → [] · where({shop_id}) → [] · where({**id**}) → ✅ 命中。
const hasIdFallback = /collection\(\s*['"]shop['"]\s*\)\s*\.where\(\s*\{\s*id\s*:\s*shopId/.test(body);
check('A-⑩ assertShopOwner 有「按 id 字段 where 兜底」路径（R202：存量店铺的真形态）',
  hasIdFallback, 'body 内未见 where({ id: shopId ... })');

// 抗削弱：候选键必须**同时**在位 —— 只留一个就是「读侧两候选 / 鉴权单候选」的口径分裂复发
const keyCount = (body.match(/shop_id\s*:\s*shopId/g) || []).length
  + (body.match(/where\(\s*\{\s*id\s*:\s*shopId/g) || []).length;
check('A-⑪ 兜底候选键 ≥ 2（shop_id 与 id 同时在场，防「退回单键」削弱）',
  keyCount >= 2, '实际命中 ' + keyCount + ' 处');

// ===== 守卫自身的非退化：影子用例（削弱判据会自红）=====
/** 影子用例：喂给「dataCarriesId」的必须是**真实代码片段**，不是拼出来的字符串 */
check('S3-c 影子正样本：带 `_id:` 的 data 被判违规',
  dataCarriesId("collection('shop').add({ data: { _id: shopId, shop_id: shopId }, });") === true);
check('S3-d 影子负样本：只有注释提到 `_id` 的 data 不算违规（本守卫初版的真 bug）',
  dataCarriesId("collection('shop').add({ data: {\n// 不再写 `_id`\n id: shopId, shop_id: shopId,\n}, });") === false);

/** 用真实 body 当判据函数，检查它能否区分「合规 / 违规」两种实现 */
function judge(realBody, kind) {
  if (kind === 'good') {
    return /collection\(\s*['"]shop['"]\s*\)\s*\.where\(/.test(realBody)
      && /shop_id\s*:\s*shopId/.test(realBody);
  }
  return !/collection\(\s*['"]shop['"]\s*\)\s*\.where\(/.test(realBody)
    || !/shop_id\s*:\s*shopId/.test(realBody);
}
const GOOD = "await db.collection('shop').where({ shop_id: shopId }).limit(1).get();";
const BAD = "await db.collection('shop').doc(shopId).get();";
check('S3-a 影子正样本：合规实现被判绿', judge(GOOD, 'good') === true);
check('S3-b 影子负样本：违规实现被判红', judge(BAD, 'good') === false);

/** R202 影子用例：两键兜底判据自身也要能区分「两键 / 单键」 */
function judge2(realBody) {
  return /collection\(\s*['"]shop['"]\s*\)\s*\.where\(\s*\{\s*id\s*:\s*shopId/.test(realBody);
}
const GOOD2 = "await db.collection('shop').where({ shop_id: shopId, is_deleted: false }).limit(1).get();\n"
  + "await db.collection('shop').where({ id: shopId, is_deleted: false }).limit(1).get();";
const BAD2 = "await db.collection('shop').where({ shop_id: shopId, is_deleted: false }).limit(1).get();";
check('S3-e 影子正样本：两键兜底实现被判绿', judge2(GOOD2) === true);
check('S3-f 影子负样本：只有 shop_id 单键兜底（R201 旧形态）被判红', judge2(BAD2) === false);

console.log('===== R201 店铺读库口径守卫：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
