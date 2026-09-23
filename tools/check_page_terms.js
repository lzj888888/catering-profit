// tools/check_page_terms.js —— 页面「术语键引用即存在」守卫（R124，round108）
// 运行： node tools/check_page_terms.js      （EXIT 0 = 全绿）
//
// 背景（李老师 2026-09-23 真机反馈，同族病）：
//   摊销页底部主按钮渲染成**纯蓝色、上面没有文字** —— 因为 `pages/month/amortize.js` 写的是
//   `TERMS.amortizePage.amortAdd`，而 terms.js 里**根本没有 `amortAdd` 这个键** ⇒ 取到 `undefined`
//   ⇒ WXML 插值成空串 ⇒ 按钮只剩底色。术语本体一直是 `amortizePage.add`（「新增摊销资产」）。
//   顺着这一处全仓一扫，同族**共 7 处**（同一轮全修）：
//     · 空按钮 ×1：`amortizeAdd`（上面这处）
//     · 空文案 ×4：input.wxml 用 `t.scopeShow/scopeHide/classTotalSuffix/presetHintPrefix`，
//       而 input.js 的 `t` 里**一个都没映射**（术语本体一直在 `TERMS.ledger` 里）
//     · 空 placeholder ×2：`t.dmAmtPh`（术语在 `TERMS.ledger.dineMode.amtPh`）、
//       card/edit.wxml 的 `t.dishNamePh`（术语在 `TERMS.card.dishNamePh`，页面漏映射）
//
// 为什么必须机器守（这个缺口有多大）：
//   WXML 对 `{{undefined}}` **不报错、不警告**，静默渲染成空 —— 于是「少映射一个键」这种错误
//   在真机上表现为**空白文案 / 空白按钮 / 空白 placeholder**，在全部 96 个套件里**零覆盖**：
//   `check_js_syntax`（R122）只验能不能编译；`check_wxml_structure`（R123）只验属性有没有错成文本；
//   各 selftest 用 grep 找**存在的字符串**（找不到就报红），而这里恰恰是**找不到却没人找**。
//   ⇒ 与 R122/R123 同型：都是「页面这层没有套件读它」。本守卫补上「**页面引用的术语键必须真的存在**」。
//
// 判据（两条腿，方向相反、缺一不可）：
//   ① 反查 terms：页面/工具 .js 里每一处 `TERMS.<组>.<键>` 字面引用，都必须在 terms 模块里解析得出。
//   ② 反查页面 t：每个 .wxml 里用到的 `t.<键>`，都必须在该页 .js 的 `t: { ... }` 键集合里。
//   两条腿对应**两种不同的漏法**：①漏在「术语名写错/术语被删」，②漏在「忘了往 t 里映射」
//   （本次 7 处里 6 处属 ②：术语好好的，只是没搬进页面的视图模型）。
//
// 自失效护栏（防本守卫被改小/恒真）：
//   S1 扫描面文件数 ≥ 40（页面 + 工具 + 前端根）；
//   S2 判据① 命中 `TERMS.` 引用的**总次数** ≥ 400（低于此说明解析器坏了或扫描面被写窄）；
//   S3 判据② 命中 `t.` 用法的**总次数** ≥ 300，且**带 `t: {` 块的页面数** ≥ 8；
//   S4 锚点页面必须在扫描面内（含事故现场 `pages/month/amortize.js` 与 `pages/month/input.wxml`）。
//
// 边界（诚实声明，别高估）：
//   · 判据② 只认**字面块形态** `t: { ... }`（按花括号配平）。若某页用 `t: Object.assign(...)` /
//     运行时 `setData({'t.x': …})` 拼视图模型，本守卫**看不到**它的键 —— 这类页面由 S3 的下界兜底，
//     会在「带 `t: {` 块的页面数」变少时红灯，不会静默放行。
//   · 判据① 剥注释后扫描（`//` 与 `/* */`）—— 注释里举例写术语名不该判红（本仓历史上正是踩过
//     「守卫被自己注释绊红」，见 round107 batch8b A9-② 的教训）。
//   · 只验「存在 / 不存在」，**不验文案对不对**（文案口径由 K11 双副本一致 + 术语套件承担）。
(function () {
  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..');
  const TERMS_PATH = path.join(ROOT, 'miniprogram', 'i18n', 'terms.js');
  const SCAN_ROOTS = ['pages', 'utils', 'miniprogram'];
  const EXTRA_FILES = ['app.js'];

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }

  // 等长空格替换 ⇒ 行号与列位不漂移，报错能直接定位
  function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let inLine = false, inBlock = false, inStr = null;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (inLine) { if (c === '\n') { inLine = false; out += c; } else out += ' '; i++; continue; }
      if (inBlock) {
        if (c === '*' && d === '/') { inBlock = false; out += '  '; i += 2; continue; }
        out += (c === '\n') ? c : ' '; i++; continue;
      }
      if (inStr) {
        if (c === '\\') { out += '  '; i += 2; continue; }
        if (c === inStr) { inStr = null; out += c; i++; continue; }
        out += (c === '\n') ? c : ' '; i++; continue;
      }
      if (c === '/' && d === '/') { inLine = true; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { inBlock = true; out += '  '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
      out += c; i++;
    }
    return out;
  }

  function walk(dir, out, filter) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (/^(node_modules|\.git|review|_qr_archive)$/.test(e.name)) continue;
        walk(path.join(dir, e.name), out, filter);
        continue;
      }
      const fp = path.join(dir, e.name);
      if (filter(fp)) out.push(fp);
    }
  }

  const jsFiles = [];
  for (const r of SCAN_ROOTS) walk(path.join(ROOT, r), jsFiles, (p) => /\.js$/.test(p));
  for (const f of EXTRA_FILES) { const p = path.join(ROOT, f); if (fs.existsSync(p)) jsFiles.push(p); }
  const wxmlFiles = [];
  walk(path.join(ROOT, 'pages'), wxmlFiles, (p) => /\.wxml$/.test(p));

  const terms = require(TERMS_PATH).TERMS;

  // ================= 判据 ①：TERMS.<组>.<键> 必须解析得出 =================
  console.log('\n===== P1 · 页面/工具引用的术语键必须存在（TERMS.<组>.<键>）=====');
  const p1Miss = [];
  let p1Hits = 0;
  const ANCHORS_JS = ['pages/month/amortize.js', 'pages/month/input.js'];
  const seenAnchor = {};
  for (const fp of jsFiles) {
    const rel = path.relative(ROOT, fp).split(path.sep).join('/');
    if (ANCHORS_JS.indexOf(rel) >= 0) seenAnchor[rel] = true;
    const code = stripComments(fs.readFileSync(fp, 'utf8'));
    const lines = code.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const re = /TERMS\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
      let m;
      while ((m = re.exec(lines[li]))) {
        p1Hits++;
        const grp = terms[m[1]];
        const val = grp ? grp[m[2]] : undefined;
        if (val === undefined) {
          p1Miss.push(rel + ':' + (li + 1) + '  TERMS.' + m[1] + '.' + m[2]
            + ' → ' + (grp ? '组内无此键' : '无此术语组'));
        }
      }
    }
  }
  check('P1-1 全仓 TERMS.<组>.<键> 引用均可解析（零悬空引用）',
    p1Miss.length === 0,
    p1Miss.length ? ('悬空 ' + p1Miss.length + ' 处：' + p1Miss.slice(0, 6).join(' | ')) : ('解析 ' + p1Hits + ' 处引用，全部命中'));

  // ================= 判据 ②：wxml 的 t.<键> 必须在同页 t 里 =================
  console.log('\n===== P2 · .wxml 用到的 t.<键> 必须在同页 .js 的 t:{} 里 =====');
  const p2Miss = [];
  let p2Hits = 0, blockPages = 0;
  const ANCHORS_WXML = ['pages/month/input.wxml'];
  const seenWxmlAnchor = {};
  for (const wf of wxmlFiles) {
    const relW = path.relative(ROOT, wf).split(path.sep).join('/');
    if (ANCHORS_WXML.indexOf(relW) >= 0) seenWxmlAnchor[relW] = true;
    const jsf = wf.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(jsf)) continue;
    const src = fs.readFileSync(jsf, 'utf8');
    // ⚠️ 必须锚定「行首缩进 + t: {」—— 否则会误命中 `saveAsset({ asset: {` 里的 `t: {`（round108 踩过）
    const mk = src.match(/^[ \t]*t[ \t]*:[ \t]*\{/m);
    if (!mk) continue;
    const b0 = src.indexOf('{', mk.index);
    let depth = 0, end = -1;
    for (let k = b0; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end < 0) continue;                       // 配平不了 ⇒ 归 P2-3 兜底报红
    blockPages++;
    const block = src.slice(b0, end + 1);
    const keys = {};
    const kre = /^[ \t]*([A-Za-z_$][\w$]*)[ \t]*:/gm;
    let km;
    while ((km = kre.exec(block))) keys[km[1]] = true;

    const wsrc = fs.readFileSync(wf, 'utf8');
    const lines = wsrc.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const tre = /\bt\.([A-Za-z_$][\w$]*)/g;
      let tm;
      while ((tm = tre.exec(lines[li]))) {
        p2Hits++;
        if (!keys[tm[1]]) {
          p2Miss.push(relW + ':' + (li + 1) + '  用了 t.' + tm[1] + ' 但 ' + path.basename(jsf) + ' 的 t 里没有');
        }
      }
    }
  }
  check('P2-1 每个页面 wxml 用到的 t.<键> 都在同页 t:{} 里（零静默空白）',
    p2Miss.length === 0,
    p2Miss.length ? ('缺失 ' + p2Miss.length + ' 处：' + p2Miss.slice(0, 6).join(' | ')) : ('核对 ' + p2Hits + ' 处用法 / ' + blockPages + ' 个页面'));

  const unparsed = wxmlFiles.filter((wf) => {
    const jsf = wf.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(jsf)) return false;
    const w = fs.readFileSync(wf, 'utf8');
    if (!/\bt\.[A-Za-z_$]/.test(w)) return false;
    return !/^[ \t]*t[ \t]*:[ \t]*\{/m.test(fs.readFileSync(jsf, 'utf8'));
  });
  check('P2-2 用了 `t.` 的页面都能静态解析出 t 块（否则本守卫对该页是盲区，须显式处理）',
    unparsed.length === 0,
    unparsed.length ? ('无法解析：' + unparsed.map((p) => path.relative(ROOT, p).split(path.sep).join('/')).join(', '))
      : '全部可解析');
  const unbalanced = wxmlFiles.filter((wf) => {
    const jsf = wf.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(jsf)) return false;
    const src = fs.readFileSync(jsf, 'utf8');
    const mk = src.match(/^[ \t]*t[ \t]*:[ \t]*\{/m);
    if (!mk) return false;
    const b0 = src.indexOf('{', mk.index);
    let depth = 0;
    for (let k = b0; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) return false; }
    }
    return true;
  });
  check('P2-3 t 块花括号必须配平（配不平 ⇒ P2-1 会静默放行，等于守卫失灵）',
    unbalanced.length === 0,
    unbalanced.length ? ('配平失败：' + unbalanced.length + ' 个页面') : '全部配平');

  // ================= 自失效护栏（防扫描面被写窄 / 判据恒真）=================
  console.log('\n===== P0 · 自失效护栏（证明本守卫不是恒真）=====');
  check('S1 扫描面非空：页面/工具 .js ≥ 20 个', jsFiles.length >= 20, '实际 ' + jsFiles.length + ' 个');
  check('S2 判据① 确实在解析引用：TERMS. 命中 ≥ 400 次', p1Hits >= 400, '实际 ' + p1Hits + ' 次');
  check('S3 判据② 确实在看页面：t. 用法 ≥ 300 次 / 带 t 块页面 ≥ 8 个',
    p2Hits >= 300 && blockPages >= 8, 't. 用法 ' + p2Hits + ' 次 / 页面 ' + blockPages + ' 个');
  const anchorOk = ANCHORS_JS.every((a) => seenAnchor[a]) && ANCHORS_WXML.every((a) => seenWxmlAnchor[a]);
  check('S4 锚点文件在扫描面内（含本轮事故现场 amortize.js / input.wxml）', anchorOk,
    anchorOk ? '4 个锚点全命中' : '锚点缺失 ⇒ 扫描面可能被写窄');

  console.log('\n===== 页面术语键守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) {
    bad.forEach((b) => console.log('   ❌ ' + b));
    p1Miss.slice(0, 20).forEach((x) => console.log('   · ' + x));
    p2Miss.slice(0, 20).forEach((x) => console.log('   · ' + x));
  }
  process.exit(failN === 0 ? 0 : 1);
})();
