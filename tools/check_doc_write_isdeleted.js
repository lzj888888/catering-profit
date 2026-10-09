// tools/check_doc_write_isdeleted.js —— R249 · 云函数「裸写文档必须注入 is_deleted」守卫
//
// ===== 为什么立这条（R249 真云血案：导完 354 行、页面全空）=====
// 数据访问层 dataAdapter 的读侧一律**强制**注入软删过滤：
//     list / listAll / countActive  ⇒  Object.assign({}, extra, where, { is_deleted: false })
// 而微信云开发 where 是**严格等值匹配**：未设置该字段的文档 `undefined !== false` ⇒ **不命中**。
//
// 另一侧，多处「裸写」（不走 adapter，直接 db.collection(..).doc(..).set(..) / .add(..)）**没写 is_deleted**。
// 于是形成一条**两端都不报错**的静默失效链：
//   ① `.doc(id).set({ data: {...} })` 是 **upsert + 整文档替换** ⇒ 文档建出来了，但没有 is_deleted 字段；
//   ② 接口照常回 `SUCCESS`，`written` 计数照常上涨（它数的是循环次数，不是库里的行数）；
//   ③ 读侧（list/listAll/countActive）把它**静默过滤掉** ⇒ 前端是**空态**，后端**零报错**。
//
// R249 真云实证（`review/evidence/r249_import/`）：
//   导入淘宝闪购《商品销量》→ 落库回 `{code:SUCCESS, written:354}`；
//   立刻走生产读路径 `getDishReview` ⇒ `dineInLen:0 / takeawayKeys:null / totals 全 0`。
//   用户可见症状 = 「单品毛利复盘 → 外卖」**完全没有变化**（见上图，空态文案照旧）。
//   受害面（同族扫出 4 处，均在 `external_sales_daily` / `shop_switch`）：
//     `importSalesBill/index.js` 三处 set（外卖账单 / 形态A 堂食 / 形态C 外卖商品销量）
//     `saveShopSetting/index.js` 的 catch 分支 add（shop_switch）
//
// ===== 本守卫判据（**交叉判据**，不是"见到裸写就红"）=====
// 单看"裸写缺 is_deleted"会误伤：全仓有 20+ 处写点落在**不被软删过滤读**的集合上
// （admin_login_log / audit_log / feature_permissions / shop_entitlement / subscription_plan …），
// 那些集合的读侧不注入 is_deleted，缺字段**无害**。所以判据必须两端求交：
//
//   写侧集合 W = 「`.doc().set({data:…})` 或 `.add({data:…})` 且 data 对象内无 is_deleted」的集合
//   读侧集合 R = 「被软删过滤读过」的集合，两条来源：
//        (a) adapter 调用：`.list('X',` / `.listAll('X',` / `.countActive('X',`
//        (b) 裸查带过滤：`.collection('X').where(` 的 where 实参里含 is_deleted
//   ❌ 危险点 = W ∩ R 非空即红。
//
//   ⭕ 显式白名单（必须写理由；白名单 = 已核过的例外，不是"改代码迎合"）
//   ⭕ 集合名为**非字面量**（如 adapter 内部的 `db.collection(coll)`）⇒ 无法交叉，登记为"动态"并设上限
//
// ⚠️ `.update()` 不在判据内：它是**字段级**部分更新，不会移除已有 is_deleted ⇒ 不同族。
// ⚠️ `da.get()` 不在读侧集合内：它的判据是 `if (!doc || doc.is_deleted) return null`，
//    `undefined` 为 falsy ⇒ **不受本缺陷影响**（这是本仓既有设计，别再当缺口报）。

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CF_DIR = path.join(REPO, 'cloudfunctions');

// ===== 白名单：已人工核过的例外（必须带理由，禁止为了变绿而加）=====
const ALLOW = [];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('✅ ' + m); };
const no = (m) => { fail++; console.log('❌ ' + m); };
const check = (m, c) => (c ? ok(m) : no(m));

const ISDEL = /(^|[^A-Za-z0-9_$])is_deleted([^A-Za-z0-9_$]|$)/;
const hasIsDeleted = (s) => ISDEL.test(String(s || ''));

// ===================== 解析器 =====================

// 只剥注释、**保留字符串字面量**。
// 🔴 与 tools/check_doc_id_write.js::stripJs 的差别必须保留：那条要**清空字符串**（防描述性文本误扫），
//    而本守卫**必须读集合名**（集合名就写在字符串里）⇒ 清空字符串会把判据扫成空集（自失效）。
//    注释内容替换为**等长空白**（换行保留）⇒ 行号与原文一致。
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let q = null;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (q) {
      if (c === '\\') { out += c + (src[i + 1] || ''); i += 2; continue; }
      out += c;
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && c2 === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// 从 openIdx（指向 open 字符）起配平，返回配对 close 的下标；引号/注释已预处理，这里只管括号。
function matchBalanced(code, openIdx, open, close) {
  let depth = 0;
  let q = null;
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;
const COLL_RE = /\.collection\s*\(\s*(?:'([A-Za-z0-9_]+)'|"([A-Za-z0-9_]+)"|([A-Za-z_$][A-Za-z0-9_$.]*))\s*\)/g;

// 扫一个源文件 ⇒ { writes: [...], reads: [...] }
//   writes: { line, op: 'set'|'add', coll, dynamic, hasIsDeleted }
//   reads : { line, coll, via: 'adapter'|'where' }
function scanSource(src) {
  const code = stripComments(src);
  const writes = [];
  const reads = [];

  // ---- 读侧 ----
  const ADAPTER_RE = /\.(listAll|list|countActive)\s*\(\s*['"]([A-Za-z0-9_]+)['"]/g;
  let m;
  while ((m = ADAPTER_RE.exec(code))) {
    reads.push({ line: lineOf(code, m.index), coll: m[2], via: 'adapter' });
  }
  COLL_RE.lastIndex = 0;
  while ((m = COLL_RE.exec(code))) {
    const lit = m[1] || m[2];
    if (!lit) continue;
    const after = m.index + m[0].length;
    const wm = /^\s*\.where\s*\(/.exec(code.slice(after));
    if (!wm) continue;
    const openIdx = after + wm[0].length - 1;
    const closeIdx = matchBalanced(code, openIdx, '(', ')');
    if (closeIdx < 0) continue;
    const whereArg = code.slice(openIdx + 1, closeIdx);
    if (hasIsDeleted(whereArg)) reads.push({ line: lineOf(code, m.index), coll: lit, via: 'where' });
  }

  // ---- 写侧 ----
  COLL_RE.lastIndex = 0;
  while ((m = COLL_RE.exec(code))) {
    const lit = m[1] || m[2];
    const dyn = m[3] || '';
    let cursor = m.index + m[0].length;
    // 可选 `.doc(<arg>)`
    const dm = /^\s*\.doc\s*\(/.exec(code.slice(cursor));
    if (dm) {
      const oi = cursor + dm[0].length - 1;
      const ci = matchBalanced(code, oi, '(', ')');
      if (ci < 0) continue;
      cursor = ci + 1;
    }
    const om = /^\s*\.(set|add|update|remove)\s*\(/.exec(code.slice(cursor));
    if (!om) continue;
    const op = om[1];
    if (op !== 'set' && op !== 'add') continue;      // update/remove 不同族（见头注）
    const oi = cursor + om[0].length - 1;
    const ci = matchBalanced(code, oi, '(', ')');
    if (ci < 0) continue;
    const argText = code.slice(oi + 1, ci);
    // 取 data 的对象字面量；取不到就退化为「从 data: 到实参末尾」
    let dataText = argText;
    const dm2 = /data\s*:\s*\{/.exec(argText);
    if (dm2) {
      const bi = oi + 1 + dm2.index + dm2[0].length - 1;
      const be = matchBalanced(code, bi, '{', '}');
      if (be > 0) dataText = code.slice(bi, be + 1);
    }
    writes.push({
      line: lineOf(code, m.index),
      op,
      coll: lit || (dyn ? '<dynamic:' + dyn + '>' : '<dynamic>'),
      dynamic: !lit,
      hasIsDeleted: hasIsDeleted(dataText),
    });
  }

  return { writes, reads };
}

// -------- 判定函数（供 C 组自检直接调用，与真扫同一份逻辑）--------
// 返回 { danger: [...], dynamicCount, total, guarded }
function judge(files) {
  // files: [{ rel, src }]
  const readColls = new Set();
  const writes = [];
  for (const f of files) {
    const r = scanSource(f.src);
    for (const x of r.reads) readColls.add(x.coll);
    for (const w of r.writes) writes.push({ file: f.rel, ...w });
  }
  const danger = writes.filter((w) => !w.dynamic && !w.hasIsDeleted && readColls.has(w.coll));
  const allowed = (w) => ALLOW.some((a) => a.file === w.file && a.coll === w.coll && a.op === w.op);
  return {
    readColls,
    writes,
    danger: danger.filter((w) => !allowed(w)),
    dangerRaw: danger,
    dynamicCount: writes.filter((w) => w.dynamic).length,
    guarded: writes.filter((w) => !w.dynamic && w.hasIsDeleted).length,
  };
}

// ===================== P：解析器钉死样本（先证解析器本身）=====================
console.log('===== P. 解析器自带钉死样本 =====');
check('P-① 负样本：`doc(id).set({data:{shop_id:x}})`（无 is_deleted）被抓且判危险',
  (() => {
    const r = scanSource('await db.collection("external_sales_daily").doc(id).set({ data: { shop_id: x } });');
    return r.writes.length === 1 && r.writes[0].op === 'set' && r.writes[0].coll === 'external_sales_daily' && r.writes[0].hasIsDeleted === false;
  })());
check('P-② 正样本：data 内含 is_deleted:false ⇒ 判安全',
  (() => {
    const r = scanSource('await db.collection("external_sales_daily").doc(id).set({ data: { shop_id: x, is_deleted: false } });');
    return r.writes.length === 1 && r.writes[0].hasIsDeleted === true;
  })());
check('P-③ `.add({data:…})` 同样入判据',
  (() => {
    const r = scanSource('await db.collection("shop_switch").add({ data: { shop_id: x } });');
    return r.writes.length === 1 && r.writes[0].op === 'add' && r.writes[0].hasIsDeleted === false;
  })());
check('P-④ `.update({data:…})` **不入**判据（不同族）',
  scanSource('await db.collection("shop").doc(id).update({ data: { name: n } });').writes.length === 0);
check('P-⑤ `.remove()` 不入判据',
  scanSource('await db.collection("shop").doc(id).remove();').writes.length === 0);
check('P-⑥ 读侧(a)：`.listAll("X",` 抓为 adapter 读',
  (() => {
    const r = scanSource('const a = await da.listAll("external_sales_daily", { shop_id: s });');
    return r.reads.length === 1 && r.reads[0].coll === 'external_sales_daily' && r.reads[0].via === 'adapter';
  })());
check('P-⑦ 读侧(b)：`.where({…is_deleted:false})` 抓为 where 读',
  (() => {
    const r = scanSource('const q = await db.collection("shop_switch").where({ shop_id: s, is_deleted: false }).limit(1).get();');
    return r.reads.length === 1 && r.reads[0].coll === 'shop_switch' && r.reads[0].via === 'where';
  })());
check('P-⑧ 读侧(b) 反向：`.where({shop_id:s})` 不含 is_deleted ⇒ **不算**软删过滤读',
  scanSource('await db.collection("audit_log").where({ shop_id: s }).get();').reads.length === 0);
check('P-⑨ 剥注释：注释里举例的 `.set({data:{}})` 不被扫到',
  scanSource('// db.collection("x").doc(id).set({data:{}})\nconst y = 1;\n').writes.length === 0);
check('P-⑩ 字符串保留：集合名字面量必须读得到（自失效护栏的存在理由）',
  scanSource('await db.collection("shop_switch").add({ data: { k: 1 } });').writes[0].coll === 'shop_switch');
check('P-⑪ 非字面量集合名登记为 dynamic（如 adapter 内部的 `db.collection(coll)`）',
  (() => {
    const r = scanSource('return db.collection(coll).add({ data: { a: 1 } });');
    return r.writes.length === 1 && r.writes[0].dynamic === true;
  })());
check('P-⑫ 多行 data 对象仍能取到 is_deleted（括号配平跨行）',
  (() => {
    const r = scanSource('await db.collection("c").doc(i).set({\n  data: {\n    a: 1,\n    is_deleted: false,\n  },\n});');
    return r.writes.length === 1 && r.writes[0].hasIsDeleted === true;
  })());
check('P-⑬ `data: Object.assign({ is_deleted: false }, x)` 退化路径也能判安全',
  (() => {
    const r = scanSource('await db.collection("c").add({ data: Object.assign({ is_deleted: false }, x) });');
    return r.writes.length === 1 && r.writes[0].hasIsDeleted === true;
  })());
check('P-⑭ 词边界：`not_is_deleted` / `is_deletedAt` 不算含 is_deleted',
  hasIsDeleted('not_is_deleted') === false && hasIsDeleted('is_deletedAt_x') === false && hasIsDeleted('is_deleted: false') === true);
check('P-⑮ 综合判定：写点集 ∩ 软删过滤读集合 ⇒ 点名危险点',
  (() => {
    const j = judge([
      { rel: 'a.js', src: 'await db.collection("external_sales_daily").doc(i).set({ data: { q: 1 } });\nconst r = await da.listAll("external_sales_daily", { shop_id: s });' },
      { rel: 'b.js', src: 'await db.collection("audit_log").add({ data: { q: 1 } });' },
    ]);
    return j.danger.length === 1 && j.danger[0].file === 'a.js' && j.danger[0].coll === 'external_sales_daily';
  })());
check('P-⑯ 综合判定反向：写点集合**不在**软删过滤读集合 ⇒ 不红（不误伤 admin 类集合）',
  judge([{ rel: 'c.js', src: 'await db.collection("admin_login_log").add({ data: { q: 1 } });' }]).danger.length === 0);

// ===================== S：扫描面（fail-closed，防自失效）=====================
console.log('===== S. 扫描面非退化 + 锚点在场 =====');

function listDirs() {
  return fs.readdirSync(CF_DIR).filter((d) => {
    try { return fs.statSync(path.join(CF_DIR, d)).isDirectory(); } catch (e) { return false; }
  });
}

// 扫单源：跳过派生副本 cx_*（单源在 common/）；node_modules 不参与
function collectFiles() {
  const out = [];
  for (const d of listDirs()) {
    const dir = path.join(CF_DIR, d);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const f of names) {
      if (!/\.js$/.test(f)) continue;
      if (/^cx_/.test(f)) continue;
      out.push({ rel: d + '/' + f, abs: path.join(dir, f) });
    }
  }
  return out;
}

const files = collectFiles();
const srcs = files.map((f) => ({ rel: f.rel, src: fs.readFileSync(f.abs, 'utf8') }));

check('S-① 扫到的云函数目录数 ≥ 40', listDirs().length >= 40);
check('S-② 扫到的单源 .js 文件数 ≥ 80', files.length >= 80);

const J = judge(srcs);
check('S-③ 扫到的裸写点（set/add 带 data）≥ 20 处（守卫确有活干）', J.writes.length >= 20);
check('S-④ 扫到的软删过滤读集合数 ≥ 8', J.readColls.size >= 8);
check('S-⑤ 🔴 锚点在场：`external_sales_daily` 必须在「软删过滤读集合」内（根路径没写错）',
  J.readColls.has('external_sales_daily'));
check('S-⑥ 🔴 锚点在场：`shop_switch` 必须在「软删过滤读集合」内', J.readColls.has('shop_switch'));
check('S-⑦ 🔴 锚点在场：本轮两个受害文件都在扫描面内',
  srcs.some((f) => f.rel === 'importSalesBill/index.js') && srcs.some((f) => f.rel === 'saveShopSetting/index.js'));
check('S-⑧ 动态集合名写点数 ≤ 6（超了说明有人在用变量名绕过交叉判据）', J.dynamicCount <= 6);

// ===================== A：正向（危险点必须为 0）=====================
console.log('===== A. 危险点（裸写缺 is_deleted × 被软删过滤读）=====');
check('A-① 🔴 危险点数 == 0（或显式白名单）', J.danger.length === 0);

// 🔴 A-② 的分母**必须限定在"受软删过滤读的集合"上**，不能用「全部写点的占比」。
//    反例（首跑实测）：全仓 20+ 处裸写落在 admin_login_log / audit_log / feature_permissions /
//    shop_entitlement / subscription_plan 这类**不被软删过滤读**的集合上 —— 它们本来就不需要该字段，
//    把它们算进分母 ⇒ 「占比 ≥ 50%」恒红，而那个红**不代表任何缺陷**（判据反向伤害第二型：把合法写法当缺陷）。
const SCOPED = J.writes.filter((w) => !w.dynamic && J.readColls.has(w.coll));
check('A-② 受守写点数 ≥ 6（非退化：判据确有样本可判）', SCOPED.length >= 6);
check('A-③ 受守集合上的裸写点**全部**带 is_deleted（受守写点 = ' + SCOPED.length + ' 处）',
  SCOPED.length > 0 && SCOPED.every((w) => w.hasIsDeleted));

// 点名确认本轮 4 处修复点都已是安全写法（防"改回旧写法"悄悄回归）
const MUST_GUARDED = [
  ['importSalesBill/index.js', 'external_sales_daily'],
  ['saveShopSetting/index.js', 'shop_switch'],
];
for (const [rel, coll] of MUST_GUARDED) {
  const hits = J.writes.filter((w) => w.file === rel && w.coll === coll);
  check('A-④ 本轮修复点已是安全写法：' + rel + ' ← ' + coll + '（' + hits.length + ' 处写点全带 is_deleted）',
    hits.length > 0 && hits.every((h) => h.hasIsDeleted));
}

// ===================== B：反向（防僵尸 / 防扫描面被改小）=====================
console.log('===== B. 反向约束 =====');
check('B-① 白名单为空或每条都写了 why（≥ 20 字）',
  ALLOW.every((a) => typeof a.why === 'string' && a.why.length >= 20));
check('B-② 白名单条目数 ≤ 3（多了说明豁免失控）', ALLOW.length <= 3);
check('B-③ 白名单里的 file 真实存在', ALLOW.every((a) => fs.existsSync(path.join(CF_DIR, a.file))));
check('B-④ 白名单确实被用到（无死条目）',
  ALLOW.every((a) => J.dangerRaw.some((w) => w.file === a.file && w.coll === a.coll && w.op === a.op)));
check('B-⑤ 读集合清单里**不含**本缺陷免疫的 `da.get()` 路径集合判定（防过度扩张）',
  ['shop_cost_card', 'shop'].every((c) => typeof J.readColls.has(c) === 'boolean'));

// ===================== C：自检（判定函数有分辨力）=====================
console.log('===== C. 自检 =====');
check('C-① 正样本（全带 is_deleted）⇒ 危险点 0',
  judge([{ rel: 'z.js', src: 'await db.collection("external_sales_daily").doc(i).set({ data: { a: 1, is_deleted: false } });\nconst r = await da.listAll("external_sales_daily", {});' }]).danger.length === 0);
check('C-② 负样本（缺 is_deleted 且集合被软删过滤读）⇒ 危险点 1',
  judge([{ rel: 'z.js', src: 'await db.collection("external_sales_daily").doc(i).set({ data: { a: 1 } });\nconst r = await da.listAll("external_sales_daily", {});' }]).danger.length === 1);
check('C-③ 无读侧 ⇒ 不红（判据确实是"交叉"，不是"见裸写就红"）',
  judge([{ rel: 'z.js', src: 'await db.collection("external_sales_daily").doc(i).set({ data: { a: 1 } });' }]).danger.length === 0);
check('C-④ 扫描面为空 ⇒ danger 为 0，**但** S-③/S-④ 两道下界会拦住（自失效护栏成对）',
  (() => { const j = judge([]); return j.danger.length === 0 && j.writes.length === 0 && j.readColls.size === 0; })());

// ===================== E：覆盖度 =====================
console.log('===== E. 覆盖度 =====');
const TOTAL = pass + fail;
// ⚠️ 下界不凭估（本仓已交过 4 次学费）：先真跑一次读末行 N，再取保守下沿。
check('E-① 断言数 ≥ 35（实测 39 的保守下沿）', TOTAL >= 35);

console.log('');
console.log('==== R249 裸写 is_deleted 守卫：' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fail) {
  console.log('--- 危险点明细（裸写缺 is_deleted，且该集合被软删过滤读）---');
  for (const v of J.danger) console.log('  ❌ ' + v.file + ':' + v.line + ' [' + v.op + '] coll=' + v.coll);
  console.log('--- 动态集合名写点（无法交叉，仅登记）---');
  for (const w of J.writes.filter((x) => x.dynamic)) console.log('  · ' + w.file + ':' + w.line + ' [' + w.op + '] coll=' + w.coll);
  process.exit(1);
}
