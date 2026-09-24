// tools/check_doc_id_write.js —— R130 · 云函数「写库必须用权威主键 `_id`」守卫
//
// ===== 为什么立这条（round116 真云血案）=====
// `dataAdapter.get()` 在 2026-09-19 修过「业务主键 ≠ `_id`」——**但只修了读**（加了按
// `id/material_id/asset_id/shop_id/account_id` 逐个兜底查），**写仍用业务键**。于是：
//   ① `da.get(coll, 业务id)` 走兜底**命中**（读得到）
//   ② 调用方拿返回文档 / 入参里的**业务 id** 去 `doc(业务id).update()`
//   ③ 若该文档 `_id ≠ 业务id` ⇒ `doc()` 指向**不存在的文档**
//   ④ 微信云开发 `update()` 对不存在文档 **静默返回 0 行、不抛异常**
//   ⑤ ⇒ 接口回 `SUCCESS`、库里**一个字没改**、两端都看不到任何错。
//
// round116 真云实证（`_gui/_probe_r116.js proof`）：
//   写 name='R116PROBE' + biz_type='cafe' → 返回 SUCCESS → **立刻回读仍是 '默认店铺' / ''**。
//   用户可见症状 = M1 结果页「行业选完没变化」（**没有任何报错**）。
//   受害面（同族扫出 3 处，全部真云静默失效）：
//     `saveShopSetting:49`（已修）/ `saveMaterial:62`（已修）/
//     `saveCostCard:228`（已修）/ `syncCostCard:153`（已修）。
//
// ===== 本守卫判据 =====
// 扫 `cloudfunctions/**`（跳过 `common/`：那是单源，adapter 内部本就要按传入 id 操作），
// 对每个 `.doc(<arg>).update|remove(`：
//   ✅ arg 直接含 `_id`（如 `exist._id || a.asset_id`）
//   ✅ arg 是**简单标识符**，且**回溯其定义行含 `_id`**（如 `const docId = acct._id || acct.id`）
//   ⭕ 显式白名单（必须写理由；白名单 = 已核过的例外，不是"改代码迎合"）
//   ❌ 其余 ⇒ 违规
//
// ⚠️ 反面提醒（防后人误判）：`doc().update()` 返回 `{stats:{updated:0}}` 时**不是报错**，
//    所以「没抛异常」永远不能当作「写成功了」。凡新增写操作，必须同时判 `stats.updated`。

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CF_DIR = path.join(REPO, 'cloudfunctions');

// ===== 白名单：已人工核过的例外（必须带理由，禁止为了变绿而加）=====
const ALLOW = [
  {
    file: 'smokeTest/index.js',
    arg: 'id',
    why: '真云探针函数：id 由探针自身以显式 `_id`（上一轮 add 的返回值）传入，非业务键；且是测试专用入口。',
  },
  {
    file: 'adminRefundMark/index.js',
    arg: 'docId',
    why: '管理端注入依赖（markOrderRefunded/updateEntitlement），docId 由调用方传入。',
    todo: '⚠️ 待办（round116 已记 NOTE）：调用方传的是否为 `_id` 未核；管理端退款链路单独一轮收口。',
  },
];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('✅ ' + m); };
const no = (m) => { fail++; console.log('❌ ' + m); };
const check = (m, c) => (c ? ok(m) : no(m));

// ===================== 解析器（自带钉死样本，先验自己）=====================

// 剥注释 + 清空字符串内容（引号保留以维语法）。
// ⚠️ 两个都必须做：
//   · 剥注释 ⇒ 注释里举例的 `.doc(a.id).update(` 不该被当成真写点；
//   · 清空字符串 ⇒ `const s = ".doc(a.id).update("` 里的**文本**也不该被扫到（P-⑪ 钉死样本）。
//   注意：字符串里出现 `.doc()` 只可能是"描述性文本"，真写点必然是代码 ⇒ 清空不会漏报。
function stripJs(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let q = null;      // 当前引号字符
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (q) {
      if (c === '\\') { i += 2; continue; }        // 转义序列整段丢弃
      if (c === q) { q = null; out += c; }         // 闭合引号保留
      i++; continue;                               // 串内字符一律不输出
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// 含 `_id`（词边界）
function hasIdToken(s) {
  return /(^|[^A-Za-z0-9_$])_id([^A-Za-z0-9_$]|$)/.test(s);
}

// 取「所在函数体」的起点（最近一个 `=> {` 或 `function … {` 之后）。
// 🔴 为什么必须有这道边界（round116 实测踩过）：
//   若在**整个文件**里回溯同名变量，`smokeTest` 的形参 `id`（141 行 `(coll, id) => {`，调用方传 `r._id`）
//   会被同文件 78 行的另一个 `id = addRes._id` **隔着几十行、跨函数**误判为"安全" ⇒ **假绿**。
//   函数体边界把回溯限制在"这个写点真正看得见的作用域"，形参在边界之前 ⇒ 正确判违规（交给白名单显式豁免）。
function fnBoundary(code, atIdx) {
  const pre = code.slice(0, atIdx);
  const re = /(=>\s*\{|function\b[^{;]*\{)/g;
  let last = -1, m;
  while ((m = re.exec(pre))) last = m.index + m[0].length;
  return last;
}

// 判断参数安全：直接含 _id，或简单标识符且**其所在函数体内**有含 _id 的赋值
function judgeArg(arg, src, atIdx) {
  const a = String(arg || '').trim();
  const at = (atIdx === undefined || atIdx === null) ? String(src).length : atIdx;
  if (!a) return { safe: false, why: '空参数' };
  if (hasIdToken(a)) return { safe: true, why: '参数含 _id' };
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(a)) return { safe: false, why: '参数是表达式且不含 _id：' + a };
  // 简单标识符 ⇒ 在**所在函数体**内回溯赋值（含 `const/let/var x = …` 与裸赋值 `x = …`；
  //   `saveLedger` 是后者：151 `let accountId;` + 153 `accountId = existing._id || existing.id;`），
  //   只要**任一处** RHS 含 `_id` 即判安全。
  const b = fnBoundary(String(src), at);
  const scope = String(src).slice(b < 0 ? 0 : b, at);
  const esc = a.replace(/[$]/g, '\\$');
  const assignRe = new RegExp('(^|[^A-Za-z0-9_$.])' + esc + '\\s*=\\s*([^;\\n]{0,140})', 'gm');
  let m;
  while ((m = assignRe.exec(scope))) {
    if (hasIdToken(m[2])) return { safe: true, why: '变量 ' + a + ' 在所在函数体内赋值含 _id' };
  }
  return { safe: false, why: '变量 ' + a + ' 在所在函数体内未见含 _id 的赋值' };
}

// 扫描一个源文件：返回 [{ line, op, arg, safe, why }]
function scanSource(src) {
  const code = stripJs(src);
  const hits = [];
  const re = /\.doc\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    // 配平括号取参数
    let i = re.lastIndex - 1; // 指向 '('
    let depth = 0, j = i, inQ = null;
    for (; j < code.length; j++) {
      const c = code[j];
      if (inQ) { if (c === '\\') { j++; continue; } if (c === inQ) inQ = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inQ = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    const arg = code.slice(i + 1, j);
    // 其后必须紧跟 .update( / .set( / .remove(
    const tail = code.slice(j + 1, j + 40);
    const tm = tail.match(/^\s*\.\s*(update|set|remove)\s*\(/);
    if (!tm) continue;
    const op = tm[1];
    const line = code.slice(0, m.index).split('\n').length;
    const v = judgeArg(arg, code, m.index);   // ⚠️ 必须传位置：回溯要限定在所在函数体内
    hits.push({ line, op, arg: arg.replace(/\s+/g, ' ').trim(), safe: v.safe, why: v.why });
  }
  return hits;
}

// ===================== P：解析器钉死样本（先证解析器本身）=====================
console.log('===== P. 解析器自带钉死样本 =====');
check('P-① 负样本：`.doc(m.id).update(` 判违规',
  judgeArg('m.id', 'const m={}').safe === false);
check('P-② 负样本：`.doc(vm.id || vm.material_id).update(` 判违规',
  judgeArg('vm.id || vm.material_id', '').safe === false);
check('P-③ 正样本：`.doc(exist._id || a.asset_id).update(` 判安全',
  judgeArg('exist._id || a.asset_id', '').safe === true);
check('P-④ 正样本：`.doc(row._id).update(` 判安全', judgeArg('row._id', '').safe === true);
check('P-⑤ 变量回溯：`const rid = doc._id || x;` + `.doc(rid)` 判安全',
  judgeArg('rid', 'const rid = doc._id || x;').safe === true);
check('P-⑥ 变量回溯：`const rid = x.id;` + `.doc(rid)` 判违规',
  judgeArg('rid', 'const rid = x.id;').safe === false);
check('P-⑦ 变量无定义 ⇒ 判违规（fail-closed，不猜）',
  judgeArg('mystery', '// nothing here').safe === false);
check('P-⑧ `_id` 词边界：`foo_ids` / `grid` 不算含 `_id`',
  hasIdToken('foo_ids') === false && hasIdToken('grid') === false && hasIdToken('x._id') === true);
check('P-⑨ 剥注释：注释里的 `.doc(a.id).update(` 不被扫到',
  scanSource('// .doc(a.id).update({})\nconst x=1;\n').length === 0);
check('P-⑩ 剥注释（块注释）：`/* .doc(a.id).update() */` 不被扫到',
  scanSource('/* .doc(a.id).update({}) */\n').length === 0);
check('P-⑪ 字符串里的 `.doc(...)` 不被误扫（引号感知）',
  scanSource('const s = ".doc(a.id).update(";\n').length === 0);
check('P-⑫ 扫描真样本：`.doc(shopDoc.id || shopId).update(` 被抓且判违规',
  (() => { const h = scanSource('await db.collection("shop").doc(shopDoc.id || shopId).update({data:{}});'); return h.length === 1 && h[0].op === 'update' && h[0].safe === false; })());
check('P-⑬ 扫描真样本：`.doc(exist._id || m.id).update(` 被抓且判安全',
  (() => { const h = scanSource('await db.collection("shop_material").doc(exist._id || m.id).update({data:{}});'); return h.length === 1 && h[0].safe === true; })());
check('P-⑭ `.doc()` 后不接 update/set/remove（纯读）不报',
  scanSource('await db.collection("shop").doc(id).get();').length === 0);
// 🔴 P-⑮ 是「函数体边界」的存在理由：同文件、不同函数里的同名变量**绝不能**互相作保。
check('P-⑮ 跨函数同名不串：形参 `id` 不被同文件另一处的 `id = …_id…` 误判为安全',
  (() => {
    const s = 'const a = () => {\n  const id = res._id;\n  return id;\n};\n'
      + 'const f = async (coll, id) => {\n  await db.collection(coll).doc(id).remove();\n};';
    const h = scanSource(s);
    return h.length === 1 && h[0].safe === false;
  })());
check('P-⑯ 同函数体内赋值：`const rid = x._id || y;` 后 `.doc(rid).update(` 判安全',
  (() => {
    const s = 'const f = async () => {\n  const rid = x._id || y;\n'
      + '  await db.collection("c").doc(rid).update({ data: {} });\n};';
    const h = scanSource(s);
    return h.length === 1 && h[0].safe === true;
  })());

// ===================== A：真扫 cloudfunctions =====================
console.log('===== A. 真扫 cloudfunctions（单源，非派生态）=====');

function listDirs() {
  return fs.readdirSync(CF_DIR).filter((d) => {
    try { return fs.statSync(path.join(CF_DIR, d)).isDirectory(); } catch (e) { return false; }
  });
}

// 只扫单源：跳过 `common`（adapter 内部本就要按传入 id 操作）与派生副本 `cx_*`
function collectFiles() {
  const out = [];
  for (const d of listDirs()) {
    if (d === 'common') continue;
    const dir = path.join(CF_DIR, d);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.js$/.test(f)) continue;
      if (/^cx_/.test(f)) continue;          // 派生副本（单源在 common/）
      if (f === 'selftest.js') continue;     // 自测文件不落库
      out.push({ rel: d + '/' + f, abs: path.join(dir, f) });
    }
  }
  return out;
}

const files = collectFiles();
check('A-① 扫到的云函数目录数 ≥ 40（覆盖真单源）', listDirs().length >= 40);
check('A-② 扫到的文件数 ≥ 80', files.length >= 80);

const violations = [];
const allHits = [];
for (const f of files) {
  const src = fs.readFileSync(f.abs, 'utf8');
  for (const h of scanSource(src)) {
    allHits.push({ file: f.rel, ...h });
    if (h.safe) continue;
    const allowed = ALLOW.some((a) => a.file === f.rel && a.arg === h.arg);
    if (!allowed) violations.push({ file: f.rel, ...h });
  }
}
check('A-③ 真扫到 .doc().update/remove 的写点 ≥ 15 处（守卫确有活干）', allHits.length >= 15);
check('A-④ 🔴 违规数 == 0（写库一律用 _id 或显式白名单）', violations.length === 0);
check('A-⑤ 全部写点中，含 _id 的占比 ≥ 60%（安全写法是主流）',
  allHits.filter((h) => h.safe).length / Math.max(1, allHits.length) >= 0.6);

// 点名确认本轮 4 处修复点都已是安全写法（防"改回旧写法"悄悄回归）
const MUST_SAFE = [
  ['saveShopSetting/index.js', 'shopRid'],
  ['saveMaterial/index.js', 'exist._id || m.id'],
  ['saveCostCard/index.js', 'vm._id || vm.id || vm.material_id'],
  ['syncCostCard/index.js', 'vm._id || vm.id || vm.material_id'],
];
for (const [rel, arg] of MUST_SAFE) {
  const hit = allHits.find((h) => h.file === rel && h.arg === arg);
  check('A-⑥ 本轮修复点已是安全写法：' + rel + ' ← doc(' + arg + ')', !!hit && hit.safe === true);
}

// ===================== B：白名单自身要诚实（不许空泛）=====================
console.log('===== B. 白名单约束 =====');
check('B-① 每条白名单都写了 `why`（非空且 ≥ 20 字）',
  ALLOW.every((a) => typeof a.why === 'string' && a.why.length >= 20));
check('B-② 白名单条目数 ≤ 3（多了说明豁免失控）', ALLOW.length <= 3);
check('B-③ 白名单里的 file 真实存在', ALLOW.every((a) => fs.existsSync(path.join(CF_DIR, a.file))));
check('B-④ 白名单确实被用到（无死条目）',
  ALLOW.every((a) => {
    const src = fs.readFileSync(path.join(CF_DIR, a.file), 'utf8');
    return scanSource(src).some((h) => h.arg === a.arg && !h.safe);
  }));
check('B-⑤ 带 todo 的白名单条目已标注后续动作', ALLOW.every((a) => a.todo === undefined || /待办|待核/.test(a.todo)));

// ===================== C：反面红线（防"静默成功"写法复活）=====================
console.log('===== C. 反面红线 =====');
check('C-① 负样本仍判违规：`doc(accountId)` 且定义不含 _id',
  judgeArg('accountId', 'let accountId = x.id;').safe === false);
check('C-② 负样本仍判违规：`doc(material_id)`',
  judgeArg('material_id', '').safe === false);
check('C-③ 解析器不把 `.doc().set()` 漏掉（set 也是写）',
  scanSource('await db.collection("x").doc(a.id).set({data:{}});').length === 1);
check('C-④ 解析器不把 `.doc().remove()` 漏掉',
  scanSource('await db.collection("x").doc(a.id).remove();').length === 1);
check('C-⑤ 跨行 `.doc(\n  arg\n).update(` 仍能抓到',
  scanSource('await db.collection("x").doc(\n  a.id\n).update({data:{}});').length === 1);

// ===================== E：断言数下界 =====================
console.log('===== E. 覆盖度 =====');
const TOTAL = pass + fail;
// ⚠️ 下界别凭估（本仓已交过 3 次学费）：先真跑一次读末行 N，再取保守下沿。
//    本轮实测 36 ⇒ 取 33（留 3 条余量，防后续正常增删即红）。
check('E-① 断言数 ≥ 33（实测 36 的保守下沿）', TOTAL >= 33);

console.log('');
console.log('==== R130 写库主键守卫：' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fail) {
  console.log('--- 违规明细（写库未用 _id）---');
  for (const v of violations) console.log('  ❌ ' + v.file + ':' + v.line + ' [' + v.op + '] doc(' + v.arg + ') — ' + v.why);
  process.exit(1);
}
