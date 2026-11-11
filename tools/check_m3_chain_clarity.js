// tools/check_m3_chain_clarity.js —— M3「一眼看懂链条」守卫（R717）
// 运行： node tools/check_m3_chain_clarity.js      （EXIT 0 = 全绿）
//
// 背景（李老师 2026-11-12）：
//   「只要整个页面人们知道点哪儿是干什么的，然后不会产生歧义。从哪获得数据，从哪看结果，
//     整个这一块链条是完整的。一眼就能知道这是干什么的，为什么放有这个按钮 ——
//     要不然人点都不敢点进去，你做完这个功能也是放了用不上。」
//
// 根因不是缺功能，是**链条上两个断点**：
//   ① 页内自述失真：「说去哪」的那句话指向的东西**已经不存在了** ——
//      R707 把「销量表导入」卡从 M3 枢纽页撤掉，可 hub 的分区标题还写着「导入销量后，再看这些」、
//      外卖卡长描述还写着「销量表请用上面的『销量表导入』」。
//      老板照着这两句去找，扑空；而且页面**照常渲染、零报错**，只有真机点一次才会发现。
//   ② 入口页不说自己在算什么：对账页一进去就是「月份 / 在售菜品数」两个输入框，
//      一句「这页比的是什么」都没有（R712 补的那条只解释了其中一个字段）。
//      ⇒ 老板不敢点、点进去不敢填。
//
// 为什么必须机器守（这类失效的共性 = **静默**）：
//   · 「指向已删入口」的文案不会报错，wxml 插值成文字照样显示；
//   · 说明块被挪到输入框**之后**照样渲染，只是"先让填、后解释"，肉眼很难判定顺序；
//   · `t.xxx` 漏登记 ⇒ 插值成空 ⇒ 说明块消失但卡片/输入框都在（R189 P2-1 同族）；
//   · 新增入口页时**没人记得**补一句定位语 —— 靠人，必然漏。
//
// 判据（四组）：
//   A · 死引用：`TERMS.hub` 的全部字符串**不得**出现已撤入口名「销量表导入」
//       （R707 之后该卡不在本页；「销量表」本身是合法数据源名，不禁）
//   B · 枢纽页分区标题必须配一行「数从哪来」小字
//       B-① 每个 `hub-sec` 恰好配一条 `hub-sec-note`（数量相等，且 ≥2）
//       B-② `hub.js` 的 `t:{}` 里登记了 `secStartNote` / `secAfterNote`（漏登记 = 静默空白）
//       B-③ 两条小字各自点名**真实数据源**（销量表 / 收款日报 / 成本卡 / 进货价 / 原料）
//            —— 写「你的数据」这种空话等于没说，判红
//       B-④ 小字必须出现在**第一张卡之前**（先说数从哪来，再给入口）
//   C · 入口页「先说自己干什么，再让人填」
//       C-① 五个吃外部数据的页各自有定位/来源说明节点（类名单源在 PAGES 表里）
//       C-② 该节点必须**先于**页面首个输入控件（input / picker / switch）；无控件的纯展示页跳过
//       C-③ 该节点绑定的表达式标识符必须在页面 js 里真实登记（防插值成空）
//   D · 自失效护栏（证明上面的判据不是恒真）
//       D-① 扫描面文件都存在且非空
//       D-② PAGES 表 ≥5 页（表被掏空 ⇒ C 组恒绿）
//       D-③ 合成样本「说明块在输入框之后」过不了 C-② 的判据
//       D-④ 合成样本含「销量表导入」必须被 A-① 判红
//
// ⚠️ 本守卫**只管"说没说清楚"**，不判文案好坏 —— 那是人看的活。
//    它守的是三件机器能判的事：**指向的东西还在不在 / 顺序对不对 / 有没有真登记**。
(function () {
  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..');
  const HUB_WXML = path.join(ROOT, 'pages', 'm3', 'hub.wxml');
  const HUB_JS = path.join(ROOT, 'pages', 'm3', 'hub.js');
  const TERMS_A = path.join(ROOT, 'miniprogram', 'i18n', 'terms.js');

  // ===== 单源表：吃**外部数据**的 M3 入口页 =====
  // 为什么只这五页：成本卡 / 原料列表两页的数**是老板自己填的**，不需要告诉"从哪来"，
  //   而且它们靠列表内容自解释（R706/R707 刚删掉多余引导块，不能借这轮又把字墙加回来）。
  //   判据只挂"数从别处来"的页 —— 那里老板才会问「这数你哪来的」。
  const PAGES = [
    { id: '外卖每单赚多少', wxml: 'subpkg/biz/takeaway/index.wxml', js: 'subpkg/biz/takeaway/index.js', cls: 'base-note' },
    { id: '团购每单赚多少', wxml: 'subpkg/biz/groupon/index.wxml', js: 'subpkg/biz/groupon/index.js', cls: 'base-note' },
    { id: '渠道营收', wxml: 'subpkg/biz/revenue/index.wxml', js: 'subpkg/biz/revenue/index.js', cls: 'rev-src' },
    { id: '账上利润和实际营收对不对', wxml: 'subpkg/tools/recon/index.wxml', js: 'subpkg/tools/recon/index.js', cls: 'recon-why' },
    { id: '菜品赚多赚少排行榜', wxml: 'pages/m3/dishreview/index.wxml', js: 'pages/m3/dishreview/index.js', cls: 'afterfact' },
  ];

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }
  function read(p) { return fs.readFileSync(p, 'utf8'); }

  const wxml = read(HUB_WXML);
  const pageJs = read(HUB_JS);
  const { TERMS } = require(TERMS_A);
  const hub = TERMS.hub;

  // ============ 判据（独立函数 = 可被 D 组用合成样本复算，防止判据藏在流程里变成恒真）============
  // A：给定一组文案，返回其中仍指向已撤入口的那些
  const DEAD_WORD = '销量表导入';
  function findDeadRef(values) {
    return values.filter((v) => typeof v === 'string' && v.indexOf(DEAD_WORD) >= 0);
  }
  // C-②：给定一段 wxml 文本与类名，返回「说明块是否先于首个输入控件」
  function noteBeforeInput(src, cls) {
    const i = src.indexOf('class="' + cls);
    if (i < 0) return { ok: false, reason: 'node-missing' };
    let first = -1;
    ['<input', '<picker', '<switch'].forEach((tag) => {
      const p = src.indexOf(tag);
      if (p >= 0 && (first < 0 || p < first)) first = p;
    });
    if (first < 0) return { ok: true, reason: 'no-input' };
    return { ok: i < first, reason: 'note@' + i + ' ctl@' + first };
  }

  // ================= A · 死引用 =================
  console.log('===== A · 不再指向已撤掉的入口 =====');
  const hubStrings = Object.keys(hub).map((k) => hub[k]);
  const dead = findDeadRef(hubStrings);
  check('A-① hub 文案不含已撤入口名「' + DEAD_WORD + '」（R707 已撤该卡，指向它就是死引用）',
    dead.length === 0, dead.length ? '命中 ' + dead.length + ' 条：' + dead[0].slice(0, 30) : '0 条');
  // 反恒真：判据必须能对已知坏样本给出**相反**答案
  check('A-② 反恒真：已知坏样本（含「' + DEAD_WORD + '」）会被 A-① 判红',
    findDeadRef(['销量表请用上面的「' + DEAD_WORD + '」']).length === 1, '坏样本命中 1 条');

  // 🔴 A-③/A-④（R717 真机走查补的漏）：A-① 只拦**六字**「销量表导入」，
  //   而 hub 副标题一直写着**四字变体**「销量导入」—— 同一个已撤入口，换个写法就绕过了。
  //   本轮真机截图就是这么发现漏网的（副标题「原料、成本卡、销量导入、利润复盘」）。
  //   ⇒ 不再靠"猜变体"，改成**位置白名单**：这四字是外卖页内 tab 的真名，
  //     只在 takeawaySub（指向那页内部）里合法，出现在任何别处 = 又在说本页有个不存在的入口。
  const IMPORT_TAB = '销量导入';
  function findStrayImportTab(obj, allowKey) {
    return Object.keys(obj).filter((k) => k !== allowKey
      && typeof obj[k] === 'string' && obj[k].indexOf(IMPORT_TAB) >= 0);
  }
  const stray = findStrayImportTab(hub, 'takeawaySub');
  check('A-③ 「' + IMPORT_TAB + '」只允许出现在 takeawaySub（外卖页 tab 真名），别处出现 = 指向已撤入口',
    stray.length === 0, stray.length ? '越界键：' + stray.join(',') : '0 处');
  check('A-④ 反恒真：副标题写「' + IMPORT_TAB + '」会被 A-③ 判红',
    findStrayImportTab({ subtitle: '原料、成本卡、' + IMPORT_TAB + '、利润复盘', takeawaySub: '「' + IMPORT_TAB + '」' }, 'takeawaySub')
      .length === 1, '影子样本命中 subtitle');

  // 🔴 A-⑤/A-⑥（R717 真机走查补的第二处）：排行榜页**自己就有**导入按钮（R707 把入口搬进了本页首屏），
  //   可它的空态文案还写着「请先在『外卖』页导入《菜品销售统计》」—— 真机截图里，
  //   同一屏同时出现「[导入销量表] 按钮」和「请先去外卖页导入」两条**互斥**的指路。
  //   老板站在这页上，却被要求跑去另一页导同一份数据 ⇒ 这是"从哪获得数据"答了两次、答案还不同。
  //   判据：空态文案必须点本页的按钮，不许出现别的页名。
  function emptyPointsElsewhere(text) {
    return text.indexOf('外卖') >= 0 || text.indexOf('导入销量表') < 0;
  }
  const reviewEmpty = (TERMS.card && TERMS.card.reviewEmpty) || '';
  check('A-⑤ 排行榜空态必须点**本页**的「导入销量表」，不许把人赶去别的页',
    reviewEmpty.length > 0 && !emptyPointsElsewhere(reviewEmpty), reviewEmpty.slice(0, 26));
  check('A-⑥ 反恒真：旧句「请先在『外卖』页导入」会被 A-⑤ 判红',
    emptyPointsElsewhere('还没有导入堂食销量，请先在「外卖」页导入《菜品销售统计》。') === true,
    '旧句样本已证伪');

  // ================= B · 枢纽页：分区标题配「数从哪来」 =================
  console.log('\n===== B · M3 枢纽页：每组卡先说数从哪来 =====');
  const secN = (wxml.match(/class="hub-sec"/g) || []).length;
  const noteN = (wxml.match(/class="hub-sec-note"/g) || []).length;
  check('B-① 每个分区标题恰好配一条来源小字（数量相等，且 ≥2 组）',
    secN >= 2 && noteN === secN, '标题 ' + secN + ' 条 / 小字 ' + noteN + ' 条');
  check('B-② hub.js 的 t:{} 登记了 secStartNote / secAfterNote（漏登记 ⇒ 静默空白）',
    /secStartNote\s*:\s*TERMS\.hub\.secStartNote/.test(pageJs)
    && /secAfterNote\s*:\s*TERMS\.hub\.secAfterNote/.test(pageJs), '两键都已登记');

  const SRC_WORDS = ['销量表', '收款日报', '成本卡', '进货价', '原料'];
  const notes = [hub.secStartNote, hub.secAfterNote].filter((v) => typeof v === 'string');
  const notesOk = notes.length === 2 && notes.every((v) => SRC_WORDS.some((w) => v.indexOf(w) >= 0));
  check('B-③ 两条小字各自点名**真实数据源**（不是「你的数据」这种空话）',
    notesOk, notes.map((v) => v.slice(0, 14)).join(' ｜ '));
  // 反恒真：空话样本必须过不了 B-③ 的成分判据
  const vague = ['数据来自你的数据', '这里用你填的数'];
  check('B-④ 反恒真：不说来源的空话样本过不了 B-③ 的成分判据',
    !vague.every((v) => SRC_WORDS.some((w) => v.indexOf(w) >= 0)), '空话样本已被证伪');

  const firstNote = wxml.indexOf('class="hub-sec-note"');
  const firstCard = wxml.indexOf('class="hub-card"');
  check('B-⑤ 来源小字出现在**第一张卡之前**（先说数从哪来，再给入口）',
    firstNote >= 0 && firstNote < firstCard, 'note@' + firstNote + ' card@' + firstCard);

  // ================= C · 入口页：先说自己干什么，再让人填 =================
  console.log('\n===== C · 五个入口页：说明先于输入框 =====');
  PAGES.forEach((pg, i) => {
    const f = path.join(ROOT, pg.wxml);
    let src = '';
    let exists = true;
    try { src = read(f); } catch (e) { exists = false; }
    check('C-' + (i + 1) + '-① ' + pg.id + ' 有定位/来源说明节点（.' + pg.cls + '）',
      exists && src.indexOf('class="' + pg.cls) >= 0, pg.wxml);

    if (!exists) return;
    const pos = noteBeforeInput(src, pg.cls);
    check('C-' + (i + 1) + '-② ' + pg.id + ' 的说明节点出现在首个输入控件之前',
      pos.ok, pos.reason);

    // C-③ 绑定表达式必须在页面 js 里真实存在（防 t.xxx 漏登记 ⇒ 说明块空白）
    const m = src.match(new RegExp('class="' + pg.cls + '"[^>]*>\\{\\{([^}]+)\\}\\}'));
    let keyOk = false, keyTxt = '(未取到表达式)';
    if (m) {
      const expr = m[1].trim();
      keyTxt = expr;
      const idents = (expr.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []).filter((x) => x !== 't');
      let js2 = '';
      try { js2 = read(path.join(ROOT, pg.js)); } catch (e) { js2 = ''; }
      keyOk = idents.length > 0 && idents.every((id) => js2.indexOf(id) >= 0);
    }
    check('C-' + (i + 1) + '-③ ' + pg.id + ' 的说明节点绑定的键在页面 js 里真实登记',
      keyOk, keyTxt);
  });

  // ================= D · 自失效护栏 =================
  console.log('\n===== D · 自失效护栏（证明本守卫不是恒真）=====');
  const filesOk = [HUB_WXML, HUB_JS, TERMS_A].every((p) => {
    try { return fs.statSync(p).size > 200; } catch (e) { return false; }
  });
  check('D-① 扫描面文件存在且非空', filesOk, 'hub.wxml / hub.js / terms.js');
  check('D-② PAGES 表 ≥5 页（表被掏空 ⇒ C 组恒绿）', PAGES.length >= 5, '实际 ' + PAGES.length + ' 页');
  const shadow = '<input class="x"/>\n<view class="base-note">{{t.note}}</view>';
  check('D-③ 反恒真：合成样本「说明块在输入框之后」过不了 C-② 的位置判据',
    noteBeforeInput(shadow, 'base-note').ok === false, '影子样本已证伪');
  check('D-④ 反恒真：合成样本含「' + DEAD_WORD + '」必须被 A-① 判红',
    findDeadRef(['看上面的『' + DEAD_WORD + '』']).length === 1, '影子样本命中 1 条');
  // 说明块的**总量**下限：防止有人把五页的说明全删成空串（节点还在、内容没了）
  const noteLen = notes.reduce((a, b) => a + b.length, 0);
  check('D-⑤ 两条来源小字总字数 ≥ 20（防止留空节点凑数）', noteLen >= 20, '实际 ' + noteLen + ' 字');

  console.log('\n===== M3 链条清晰度守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach((b) => console.log('   ❌ ' + b));
  process.exit(failN === 0 ? 0 : 1);
})();
