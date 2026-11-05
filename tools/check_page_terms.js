// tools/check_page_terms.js —— 页面「术语键引用即存在」守卫（R124，round108）
// 运行： node tools/check_page_terms.js      （EXIT 0 = 全绿）
//
// 背景（李老师 2026-09-23 真机反馈，同族病）：
//   摊销页底部主按钮渲染成**纯蓝色、上面没有文字** —— 因为 `subpkg/biz/month/amortize.js` 写的是
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
//   ③（R298 新增）**术语值不得被当字面量比较**：`r.subItem === '外卖活动补贴'` 这类写法，
//   一旦术语表改名就**静默失灵**（上锁失效/补贴带不过去/警示色消失），零报错、门禁全绿。
//   判据① 只守「键存在」，**守不到「值被当键」** ⇒ 本判据补上这一面。
//   精确形态 = 「**含中文 且 ∈ 术语值集**」两个字条件合取（缺一不可）—— 只查"∈ 值集"会把
//   `category: 'dine_in'` 这类**合法机器码**判红（实测 54 处假阳性）；只查"含中文"则脱离术语单源语义。
//   ④（R545 新增）**术语值不得出现模块代号 M1/M2/M3**：老板不认代号，只认"账上算的 / 按成本卡算的"。
//   判据①②③ 都在守「键对不对」，**守不到「话说不说得人懂」**；而这条恰好零报错、零崩溃 ——
//   老板看了一头雾水也不会有人来报 bug。只判**值**、不判**键**（`paybackSeeM3` 这类键名用户看不到）。
//
// 自失效护栏（防本守卫被改小/恒真）：
//   S1 扫描面文件数 ≥ 40（页面 + 工具 + 前端根）；
//   S2 判据① 命中 `TERMS.` 引用的**总次数** ≥ 400（低于此说明解析器坏了或扫描面被写窄）；
//   S3 判据② 命中 `t.` 用法的**总次数** ≥ 300，且**带 `t: {` 块的页面数** ≥ 8；
//   S4 锚点页面必须在扫描面内（含事故现场 `subpkg/biz/month/amortize.js` 与 `subpkg/biz/month/input.wxml`）。
//   S5 判据③ 必须真的在扫比较型字面量（≥150 次）且术语值集非缩水（≥800 串）。
//   ⚠️ 判据③ 用的是**保字符串内容**的剥注释（`stripCommentsKeepStr`）—— 复用 `stripComments`
//      会把串内容换成空格 ⇒ 判据全盲、"命中 0" 是假阴性（R298 实测踩到，靠影子样本抓出）。
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
  const SCAN_ROOTS = ['pages', 'subpkg', 'utils', 'miniprogram'];
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

  // 🔴 R298：判据③ 必须**看见字符串内容**，故不能复用上面的 stripComments（它把串内容换成空格 ⇒ 判据全盲）。
  //    本函数只剥注释，字符串字面量**原样保留**。（这是影子样本当场抓出来的 bug：P3-1 报"命中 0"
  //    而 P3-2/P3-3 正样本同样返回空 ⇒ 判据根本看不见 —— 与 R297「0 命中可能是探测器坏了」同型。）
  function stripCommentsKeepStr(src) {
    let out = ''; let i = 0; const n = src.length;
    let inLine = false, inBlock = false, inStr = null;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (inLine) { if (c === '\n') { inLine = false; out += c; } else out += ' '; i++; continue; }
      if (inBlock) {
        if (c === '*' && d === '/') { inBlock = false; out += '  '; i += 2; continue; }
        out += (c === '\n') ? c : ' '; i++; continue;
      }
      if (inStr) {
        if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
        out += c; i++;
        if (c === inStr) inStr = null;
        continue;
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
  // R423 分包化：wxml 不再全在 pages/ 下（扫描面必须含 subpkg/，否则分包页的文案引用漏检）
  walk(path.join(ROOT, 'pages'), wxmlFiles, (p) => /\.wxml$/.test(p));
  if (fs.existsSync(path.join(ROOT, 'subpkg'))) walk(path.join(ROOT, 'subpkg'), wxmlFiles, (p) => /\.wxml$/.test(p));

  const terms = require(TERMS_PATH).TERMS;

  // ================= 判据 ①：TERMS.<组>.<键> 必须解析得出 =================
  console.log('\n===== P1 · 页面/工具引用的术语键必须存在（TERMS.<组>.<键>）=====');
  const p1Miss = [];
  let p1Hits = 0;
  const ANCHORS_JS = ['subpkg/biz/month/amortize.js', 'subpkg/biz/month/input.js'];
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
  const ANCHORS_WXML = ['subpkg/biz/month/input.wxml'];
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

  // ================= 判据 ③：术语值不得被当字面量比较（R298）=================
  // 背景（R297 第七轮 A1 复核实测，3 处）：
  //   · `input.js` 用 `r.subItem === '外卖活动补贴'` 做「费用侧手改上锁」与「补贴自动带出」的定位；
  //   · `dishreview/index.js` 用 `bm.actualFlag === '偏高'` 决定成本率警示色（**跨端契约**：
  //     云端回中文串、前端拿中文串比较）。
  // 后果：术语表一改名 ⇒ 该逻辑**静默失灵**（上锁失效 / 补贴带不过去 / 警示色消失），零报错、
  //   门禁全绿 —— 与「M2 细项名当机器键 ⇒ 改名静默失效」同族病。
  //   判据① 只守「键存在」，**守不到「值被当键」** ⇒ 本判据补上这一面。
  // 边界：只扫 pages/ · utils/ · miniprogram/ 的 .js；`miniprogram/i18n/terms.js` 是定义源、排除；
  //   剥注释（注释里举例写术语值不判红）；云端够不到术语表，跨端契约另行机械化（机器码）。
  console.log('\n===== P3 · 页面/工具层不得把「术语值」当字面量比较 =====');
  const TERM_VALS = new Set();
  (function collectVals(o, seen) {
    if (o === null || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') TERM_VALS.add(v);
      else if (typeof v === 'object') collectVals(v, seen);
    }
  })(terms, new Set());

  // 比较型用法（'X' 出现在比较/定位位置）。纯函数 ⇒ 影子样本可直接证伪它。
  // 🔴 判据的**精确形态**（实测校准，别放宽）：
  //   `含中文 且 ∈ 术语值集 的字面量`。—— 两个条件缺一不可：
  //   · 只判"∈ 术语值集"会误杀**机器码**：术语表里 `category: 'dine_in'` 这类项**既是键又是值**，
  //     于是 `g.category === 'dine_in'` 会被判红（实测 54 处假阳性）——而它恰恰是**正确写法**。
  //   · 只判"含中文"会误杀一切正常中文判断（`name.includes('店')` 之类），且脱离"术语单源"语义。
  //   ⇒ 合取之后正好命中缺陷家族本身：「**一个外显词被当机器键**」。
  const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;   // 中文/全角标点 ⇒ 是外显词，不是机器码
  const CMP_PATS = [
    ['=== / !==', /(?:===|!==)\s*'([^'\\]*)'/g],
    ['indexOf', /\.indexOf\(\s*'([^'\\]*)'/g],
    ['includes', /\.includes\(\s*'([^'\\]*)'/g],
    ['case', /\bcase\s+'([^'\\]*)'/g],
  ];
  const CMP_ALL = /(?:===|!==)\s*'[^'\\]*'|\.indexOf\(\s*'[^'\\]*'|\.includes\(\s*'[^'\\]*'|\bcase\s+'[^'\\]*'/g;
  function findTermValueLiterals(strippedSrc, valueSet) {
    const out = [];
    for (const pair of CMP_PATS) {
      const re = pair[1];
      re.lastIndex = 0;                        // 复用带 g 的正则 ⇒ 必须归零，否则第二次调用漏扫
      let m;
      while ((m = re.exec(strippedSrc))) {
        if (m[1] && CJK.test(m[1]) && valueSet.has(m[1])) out.push(pair[0] + ' ' + JSON.stringify(m[1]));
      }
    }
    return out;
  }

  const p3Hits = [];
  let p3Cmp = 0;
  for (const fp of jsFiles) {
    const rel = path.relative(ROOT, fp).split(path.sep).join('/');
    if (rel === 'miniprogram/i18n/terms.js') continue;      // 定义源自身不扫（它的值本就是术语）
    const code = stripCommentsKeepStr(fs.readFileSync(fp, 'utf8'));
    p3Cmp += (code.match(CMP_ALL) || []).length;
    findTermValueLiterals(code, TERM_VALS).forEach((h) => p3Hits.push(rel + '  ' + h));
  }
  check('P3-1 零处「把术语值当字面量比较」（改名会静默失灵的同族病）',
    p3Hits.length === 0,
    p3Hits.length ? ('命中 ' + p3Hits.length + ' 处：' + p3Hits.slice(0, 6).join(' | '))
      : ('扫 ' + p3Cmp + ' 处比较型字面量，命中 0'));

  // 影子样本（正样本必红 / 负样本必绿）—— 证明判据有分辨力，且**逐条证明不是放宽过头的恒真**
  const sBad1 = findTermValueLiterals(stripCommentsKeepStr("if (r.subItem === '外卖活动补贴') {}"), TERM_VALS);
  check("P3-2 正样本「=== '外卖活动补贴'」判红（本轮真事故形态）", sBad1.length === 1, JSON.stringify(sBad1));
  const sBad2 = findTermValueLiterals(stripCommentsKeepStr("const c = (bm.flag === '偏高') ? 'warn' : '';"), TERM_VALS);
  check("P3-3 正样本「=== '偏高'」判红（跨端中文契约的旧形态）", sBad2.length === 1, JSON.stringify(sBad2));
  const sOk1 = findTermValueLiterals(stripCommentsKeepStr("if (x === '这个字符串不在术语表里') {}"), TERM_VALS);
  check('P3-4 负样本「含中文但不在术语表里的串」判绿（不误杀正常中文判断）', sOk1.length === 0, JSON.stringify(sOk1));
  // 🔴 这条是本判据**最容易被放宽过头**的地方：机器码在术语表里也是"值"（`category: 'dine_in'`）,
  //    若判据只查"∈ 术语值集"，`g.category === 'dine_in'`（**正确写法**）会被判红 —— 实测 54 处假阳性。
  const sOk2 = findTermValueLiterals(stripCommentsKeepStr("if (g.category === 'dine_in') {}"), TERM_VALS);
  check("P3-5 负样本「机器码 'dine_in'（在术语表里但是码）」判绿 —— 防止判据放宽成 54 处假阳性",
    sOk2.length === 0, JSON.stringify(sOk2));
  const sOk3 = findTermValueLiterals(stripCommentsKeepStr("// 注释里写 '外卖活动补贴' 不算\nconst a = 1;"), TERM_VALS);
  check('P3-6 负样本「注释里的术语值」判绿（剥注释生效，避免守卫被自己的说明注释绊红）',
    sOk3.length === 0, JSON.stringify(sOk3));

  // ================= P4 组：用户可见文案不得出现模块代号（R545）=================
  // 为什么守：老板不认 M1/M2/M3。2026-10-27 实测全仓有 **4 处用户可见**文案带代号
  //   （对账页两个标签「M3 标准菜单毛利率 / M1 实际菜品毛利率」/ 报表免责句 / 首页四步引导），
  //   而注释里有几十处（**不该**判红）。与 R124 同族：不报错、不崩溃，只是老板看不懂；
  //   哪天有人再写回去，没有任何一套件会发现。
  // 判据：terms 里**每个字符串值**（含模板串；剥注释、保串内容）都不得含独立的 M1/M2/M3。
  //   🔴 只判「值」不判「键」—— `paybackSeeM3` 是键名，页面里谁都看不到，不该管。
  console.log('');
  console.log('===== P4 组 · 用户可见文案不得出现模块代号（M1/M2/M3）=====');
  const CODE_RE = /\bM[123]\b/;
  function literalsOf(src) {
    const t = stripCommentsKeepStr(src);
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
    let m;
    while ((m = re.exec(t)) !== null) out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
    return out;
  }
  const termLits = literalsOf(fs.readFileSync(TERMS_PATH, 'utf8'));
  const codeVals = termLits.filter((v) => CODE_RE.test(v));
  check('P4-1 术语值零模块代号（老板看不懂 M1/M2/M3）', codeVals.length === 0,
    codeVals.length ? '发现 ' + codeVals.length + ' 处：' + codeVals.slice(0, 5).join(' | ')
      : termLits.length + ' 个字符串值全部干净');
  // 三条影子样本：一条正样本证明抓得到，两条负样本证明不会误杀（本轮真形态 + 键名形态）
  check("P4-2 正样本「M2 开口」判红（本轮真事故形态）",
    literalsOf("x: 'M2 开口'").filter((v) => CODE_RE.test(v)).length === 1);
  check('P4-3 负样本「注释里写 M2」判绿（剥注释生效，不误杀说明性注释）',
    literalsOf("// 见 M2 注释\nx: '正常'").filter((v) => CODE_RE.test(v)).length === 0);
  check("P4-4 负样本「键名带 M3」判绿（键名用户看不到，只管值）",
    literalsOf("paybackSeeM3: '查看完整回本测算'").filter((v) => CODE_RE.test(v)).length === 0);
  check('P4-5 自失效：术语值抽样 ≥ 2000 个（低于此说明抽取器坏了或文件被写窄）',
    termLits.length >= 2000, '实际 ' + termLits.length + ' 个');

  // ================= R 组：分叉文案必须真接线（R320）=================
  // 为什么守：`*Rev` 是「另一场景」的文案（已有铺面 vs 想开的店）。实测
  //   expectRevLabelRev / expectRevNoteRev **定义了 0 处引用** ⇒ "想开的店"却显示
  //   "看收银后台取最近一月"，老板还没开店。与 R124 同族：术语在、页面不读，**零报错**。
  console.log('');
  console.log('===== R 组 · 分叉文案（*Rev）必须真接线 =====');
  const allPageSrc = jsFiles.concat(wxmlFiles).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const usedInPages = (k) => new RegExp('(?:t|M)\\.' + k + '\\b').test(allPageSrc);
  const revKeys = [];
  for (const g of Object.keys(terms)) {
    const grp = terms[g];
    if (!grp || typeof grp !== 'object') continue;
    for (const k of Object.keys(grp)) if (/Rev$/.test(k)) revKeys.push(k);
  }
  const revDead = revKeys.filter((k) => !usedInPages(k));
  check('R1 每个 *Rev 文案都真被页面引用（0 引用 = 死文案）', revDead.length === 0,
    revDead.length ? '未接线：' + revDead.join(',') : revKeys.length + ' 个全部接线');
  const sb = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/index.wxml'), 'utf8');
  const sbKeys = ['headcountLabelRev', 'expectRevTitleRev', 'expectRevLabelRev', 'expectRevNoteRev'];
  const sbMissing = sbKeys.filter((k) => sb.indexOf('t.' + k) < 0);
  check('R2 sandbox 四处场景文案按 mode 分叉（少了就退回另一场景的措辞）', sbMissing.length === 0,
    sbMissing.length ? '未分叉：' + sbMissing.join(',') : '4 处均分叉');
  check('R3 自失效：造一个没人用的 *Rev 假键，必须被判红', !usedInPages('zzzFakeRevKey'));

  // ================= 自失效护栏（防扫描面被写窄 / 判据恒真）=================
  console.log('\n===== P0 · 自失效护栏（证明本守卫不是恒真）=====');
  check('S1 扫描面非空：页面/工具 .js ≥ 20 个', jsFiles.length >= 20, '实际 ' + jsFiles.length + ' 个');
  check('S2 判据① 确实在解析引用：TERMS. 命中 ≥ 400 次', p1Hits >= 400, '实际 ' + p1Hits + ' 次');
  check('S3 判据② 确实在看页面：t. 用法 ≥ 300 次 / 带 t 块页面 ≥ 8 个',
    p2Hits >= 300 && blockPages >= 8, 't. 用法 ' + p2Hits + ' 次 / 页面 ' + blockPages + ' 个');
  const anchorOk = ANCHORS_JS.every((a) => seenAnchor[a]) && ANCHORS_WXML.every((a) => seenWxmlAnchor[a]);
  check('S4 锚点文件在扫描面内（含本轮事故现场 amortize.js / input.wxml）', anchorOk,
    anchorOk ? '4 个锚点全命中' : '锚点缺失 ⇒ 扫描面可能被写窄');
  check('S5 判据③ 确实在扫比较：比较型字面量 ≥ 150 次 / TERMS 叶子串 ≥ 800',
    p3Cmp >= 150 && TERM_VALS.size >= 800, '实际 ' + p3Cmp + ' 次 / ' + TERM_VALS.size + ' 串');

  // ===== S6 转圈文案必须是「正在做的事」（R393）=====
  // 为什么守：实测三处把**别的动作的文案**当转圈标题 ——
  //   · 同步成本卡（onSync / 批量同步）借了 exp.exportIng「正在导出…」⇒ 老板以为在导文件，
  //     等半天没有文件可打开；
  //   · 确认导入后落库借了按钮文案 importConfirm「确认导入」⇒ 读起来像"还要再确认一次"，
  //     与实际"已经确认、正在落库"相反。
  // 可枚举的形态判据：进行时文案以「…」结尾（"正在同步…" / "加载中…"）。
  //   ⇒ 借来的动作名（"确认导入"）与忘加省略号（"正在保存"）都过不去；
  //     而这条不需要理解语义，所以不会腐。
  // ⚠️ 本环境会把反斜杠写坏 ⇒ 全程用 indexOf / split，不用正则转义。
  {
    const termsSrc = fs.readFileSync(TERMS_PATH, 'utf8');
    let loadingCount = 0;
    const offenders = [];
    jsFiles.forEach((f) => {
      const src = fs.readFileSync(f, 'utf8');
      const parts = src.split('wx.showLoading');
      for (let i = 1; i < parts.length; i++) {
        const seg = parts[i].slice(0, 300);
        const ti = seg.indexOf('title:');
        if (ti < 0) continue;
        loadingCount++;
        let expr = seg.slice(ti + 6).trim();
        const c1 = expr.indexOf(',');
        const c2 = expr.indexOf('}');
        const cutAt = (c1 < 0) ? c2 : ((c2 < 0) ? c1 : Math.min(c1, c2));
        if (cutAt >= 0) expr = expr.slice(0, cutAt).trim();
        // 进度式转圈是**拼接表达式**（'正在保存… ' + done + '/' + total）：
        //   取 '+' 之前的固定部分判形态 —— 拼接的变量部分不该影响"是不是进行时"。
        const plusAt = expr.indexOf('+');
        if (plusAt >= 0) expr = expr.slice(0, plusAt).trim();
        const leaf = expr.split('.').pop();
        const at = termsSrc.indexOf(leaf + ": '");
        let txt = '';
        if (at >= 0) {
          const start = at + leaf.length + 3;
          const end = termsSrc.indexOf("'", start);
          txt = termsSrc.slice(start, end < 0 ? start : end);
        }
        const shapeOk = txt.length > 0 && (txt.slice(-1) === '…' || txt.slice(-3) === '...');
        if (!shapeOk) offenders.push(f.replace(ROOT, '') + ' → ' + expr + ' = "' + txt + '"');
      }
    });
    check('S6 转圈标题都是进行时形态（以「…」结尾）',
      offenders.length === 0 && loadingCount >= 8,
      offenders.length ? offenders.slice(0, 3).join(' / ') : ('扫到 ' + loadingCount + ' 处'));
  }

  // ===== S7 成功提示必须是「完成态」（R394）=====
  // 为什么守：绿色对勾 + 动词 = 老板分不清"还要做"还是"做好了"。
  //   R394 实测 15 处：7 处把 buttons.save（"保存"）当成功提示、3 处把菜单项文案（"删除"/"复制"）当提示、
  //   还有"切换店铺"（这是页面标题）、"结账并归档"（这是按钮）、"提前报废"、"堂食"（这是用途名）。
  //   完成态标志只有三个：已 / 完成 / 成功。判据硬、可枚举、不腐。
  // ⚠️ 动态表达式（拼接、函数调用）跳过 —— 但用「解析到的条数 ≥ 20」兜住，防止判据被写窄成恒真。
  {
    const termsSrc2 = fs.readFileSync(TERMS_PATH, 'utf8');
    const DONE_WORDS = ['已', '完成', '成功'];
    let resolved = 0;
    const skipped = [];
    const badDone = [];
    jsFiles.forEach((f) => {
      const src = fs.readFileSync(f, 'utf8');
      const parts = src.split('wx.showToast');
      for (let i = 1; i < parts.length; i++) {
        const seg = parts[i].slice(0, 320);
        if (seg.indexOf("icon: 'success'") < 0) continue;
        const ti = seg.indexOf('title:');
        if (ti < 0) { skipped.push(f.replace(ROOT, '') + ' (无 title)'); continue; }
        let expr = seg.slice(ti + 6).trim();
        const c1 = expr.indexOf(',');
        const c2 = expr.indexOf('}');
        const cutAt = (c1 < 0) ? c2 : ((c2 < 0) ? c1 : Math.min(c1, c2));
        if (cutAt >= 0) expr = expr.slice(0, cutAt).trim();
        let txt = '';
        if (expr.charAt(0) === "'") {
          const e2 = expr.indexOf("'", 1);
          txt = (e2 > 0) ? expr.slice(1, e2) : '';
        } else if (expr.indexOf('+') < 0 && expr.indexOf('(') < 0 && expr.indexOf('?') < 0) {
          const leaf = expr.split('.').pop();
          const at = termsSrc2.indexOf(leaf + ": '");
          if (at >= 0) {
            const start = at + leaf.length + 3;
            const end = termsSrc2.indexOf("'", start);
            txt = termsSrc2.slice(start, end < 0 ? start : end);
          }
        } else {
          skipped.push(f.replace(ROOT, '') + ' ' + expr.slice(0, 40));
          continue;
        }
        // 🔴 静态引用但取不到文本 ⇒ **判红**（不是跳过）。
        //   否则把术语键删掉，这条会被当成"动态表达式"静默放过 —— 那正是本守卫最初要抓的病
        //   （WXML 对 undefined 不报错，静默渲染成空）。
        if (!txt) {
          badDone.push(f.replace(ROOT, '') + ' ' + expr.slice(0, 40) + '（取不到文本）');
          continue;
        }
        resolved++;
        if (!DONE_WORDS.some((w) => txt.indexOf(w) >= 0)) {
          badDone.push(f.replace(ROOT, '') + ' → "' + txt + '"');
        }
      }
    });
    check('S7 绿勾提示一律写完成态（已/完成/成功）',
      badDone.length === 0 && resolved >= 20,
      badDone.length ? badDone.slice(0, 3).join(' / ')
        : ('解析 ' + resolved + ' 条全部合规，跳过动态 ' + skipped.length + ' 条'));
  }

  console.log('\n===== 页面术语键守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) {
    bad.forEach((b) => console.log('   ❌ ' + b));
    p1Miss.slice(0, 20).forEach((x) => console.log('   · ' + x));
    p2Miss.slice(0, 20).forEach((x) => console.log('   · ' + x));
  }
  process.exit(failN === 0 ? 0 : 1);
})();
