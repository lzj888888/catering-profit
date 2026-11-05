// tools/check_m3_style_b.js —— M3 三页（枢纽/物料/成本卡）风格 B 外壳一致性守卫（R437 · 队列 #6）
// 运行： node tools/check_m3_style_b.js    （EXIT 0 = 全绿）
//
// 为什么需要这道守卫（漂移是静默的）：
//   2026-10-22 李老师选定风格 B（卡片化）后，外观一致靠的是"三页都引用同一组声明"。
//   这类一致性没有编译期约束，失效方式全是**界面照样渲染、零报错**：
//     · 某页后人改版时把 `sb-page` 类名去掉 ⇒ 只有那一页底色退回 #f5f6f8，与另两页差一档；
//     · 某页把圆角/阴影**又写回自己 wxss**（改样式时最顺手的做法）⇒ 单源被架空，
//       下次调圆角只改 app.wxss 会发现"有一页不动"，而当时没人知道两份值已经分叉；
//     · 枢纽页的卡**不能**加 `sb-card` 类名（`check_hub_guide` 的 S2/G4 按字面量
//       `class="hub-card"` 定位），它的统一只能靠 app.wxss 声明组里的 `.hub-card` 选择器
//       ⇒ 谁把那个选择器从组里删掉，枢纽页会**悄悄**回到旧形态，其它两页却看不出来。
//
// 判据分三层：
//   A 引用面：三页根节点带 sb-page、两张列表页的卡带 sb-card、声明组里有枢纽的三个类
//   B 反漂移面：枢纽三块与物料筛选条**不得**在自己 wxss 里重新声明底色/圆角/阴影
//   C 自失效护栏：文件面存在 + 选择器组没被掏空 + 合成负样本证明 A 的判据不是恒真
//
// ⚠️ 本文件不用正则（本机会把反斜杠转成斜杠 ⇒ 落盘即语法错），一律 indexOf + slice。
(function () {
  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..');
  const P = {
    app: path.join(ROOT, 'app.wxss'),
    hubWxml: path.join(ROOT, 'pages', 'm3', 'hub.wxml'),
    hubWxss: path.join(ROOT, 'pages', 'm3', 'hub.wxss'),
    matWxml: path.join(ROOT, 'subpkg', 'biz', 'material', 'index.wxml'),
    matWxss: path.join(ROOT, 'subpkg', 'biz', 'material', 'index.wxss'),
    cardWxml: path.join(ROOT, 'subpkg', 'biz', 'card', 'index.wxml'),
    cardWxss: path.join(ROOT, 'subpkg', 'biz', 'card', 'index.wxss')
  };

  let pass = 0, fail = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { fail++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }
  function read(p) { return fs.readFileSync(p, 'utf8'); }
  function size(p) { try { return fs.statSync(p).size; } catch (e) { return -1; } }
  // 🔴 必须先剥注释再判声明：本守卫首版就栽在这 —— `.hub-card` 的注释里写着
  //    "把 box-shadow 让给单源"，纯 indexOf 把它判成"自己声明了阴影" ⇒ 判红在注释上。
  //    这与 R299 记的"只 grep 词出现 ⇒ 被注释喂成恒真"是同一个坑的两面。
  function stripCssComments(css) {
    let out = '', i = 0;
    while (true) {
      const a = css.indexOf('/*', i);
      if (a < 0) { out += css.slice(i); break; }
      out += css.slice(i, a);
      const b = css.indexOf('*/', a + 2);
      if (b < 0) break;
      i = b + 2;
    }
    return out;
  }
  function countOf(s, needle) {
    let n = 0, i = 0;
    while (true) { const k = s.indexOf(needle, i); if (k < 0) break; n++; i = k + needle.length; }
    return n;
  }
  // 取某个选择器规则体（花括号按深度配对；selector 取**第一次**出现）
  function ruleBody(css, sel) {
    const i = css.indexOf(sel);
    if (i < 0) return null;
    const b = css.indexOf('{', i);
    if (b < 0) return null;
    let depth = 0;
    for (let k = b; k < css.length; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') { depth--; if (depth === 0) return css.slice(b + 1, k); }
    }
    return null;
  }
  // 取包含某个子串的那一行（模板里 class 与元素写在同一行）
  function lineWith(s, needle) {
    const i = s.indexOf(needle);
    if (i < 0) return '';
    const a = s.lastIndexOf('\n', i) + 1;
    const b = s.indexOf('\n', i);
    return s.slice(a, b < 0 ? s.length : b);
  }
  // 判据本体抽成纯函数，便于用合成负样本证明它不恒真
  function rootHasClass(wxml, cls) {
    const s = wxml.trimStart();
    if (s.indexOf('<view') !== 0) return false;
    const end = s.indexOf('>');
    if (end < 0) return false;
    return s.slice(0, end).indexOf(cls) >= 0;
  }
  function anyRuleDeclares(css, cls, props) {
    const body = ruleBody(css, cls);
    if (body === null) return null;
    return props.some(function (p) { return body.indexOf(p) >= 0; });
  }

  const app = read(P.app);
  const hubWxml = read(P.hubWxml);
  const hubWxss = read(P.hubWxss);
  const matWxml = read(P.matWxml);
  const matWxss = read(P.matWxss);
  const cardWxml = read(P.cardWxml);
  const cardWxss = read(P.cardWxss);

  console.log('\n===== A · 引用面（三页是否真在用同一组外壳）=====');
  check('A-① 枢纽页根节点带 sb-page（页底色走单源，不是自己写背景色）',
    rootHasClass(hubWxml, 'sb-page'), lineWith(hubWxml, '<view').slice(0, 80));
  check('A-② 物料页两个分支（正常态 / 加载态）根节点都带 sb-page',
    rootHasClass(matWxml, 'sb-page') && countOf(matWxml, 'sb-page') === 2,
    'sb-page 出现 ' + countOf(matWxml, 'sb-page') + ' 次（应为 2）');
  check('A-③ 成本卡页根节点带 sb-page', rootHasClass(cardWxml, 'sb-page'),
    lineWith(cardWxml, '<view').slice(0, 80));

  const matCardLine = lineWith(matWxml, 'class="card2 stripe-material');
  check('A-④ 物料列表卡带 sb-card（与 .card2 并存：色条形态仍由本页 wxss 给）',
    matCardLine.indexOf('sb-card') >= 0, matCardLine.trim().slice(0, 90));
  const cardCardLine = lineWith(cardWxml, 'class="card2 sb-card');
  check('A-⑤ 成本卡列表卡带 sb-card（同上，动态 stripe- 绑定不受影响）',
    cardCardLine.indexOf('sb-card') >= 0, cardCardLine.trim().slice(0, 90));

  // 选择器列表要取**行首那一段**（文件上方说明段里也出现 `.sb-card` 字样 ⇒ 不能凭空 indexOf）
  const appNoCmt = stripCssComments(app);
  const gselStart = appNoCmt.indexOf('\n.sb-card,');
  const sbSelLine = gselStart < 0 ? '' : appNoCmt.slice(gselStart + 1, appNoCmt.indexOf('{', gselStart));
  const sbGroup = ruleBody(appNoCmt, '.sb-card');
  const grp = sbGroup === null ? '' : sbGroup;
  check('A-⑥ 枢纽卡并入声明组（.hub-card 在选择器列表里 —— 它不能加类名，只能这样共享）',
    sbSelLine.indexOf('.hub-card') >= 0, sbSelLine.trim());
  check('A-⑦ 三步走块并入声明组（.hub-flow）', sbSelLine.indexOf('.hub-flow') >= 0, sbSelLine.trim());
  check('A-⑧ 空状态块并入声明组（.hub-empty）', sbSelLine.indexOf('.hub-empty') >= 0, sbSelLine.trim());
  check('A-⑨ 列表卡用复合选择器 .sb-card.card2（保住 17 个共用 .card2 的页面不外溢）',
    sbSelLine.indexOf('.sb-card.card2') >= 0, sbSelLine.trim());

  console.log('\n===== B · 反漂移面（三页不得自己重写底色/圆角/阴影）=====');
  const shellProps = ['background', 'border-radius', 'box-shadow'];
  const hubWxssNoCmt = stripCssComments(hubWxss);
  const matWxssNoCmt = stripCssComments(matWxss);
  const hubCardDup = anyRuleDeclares(hubWxssNoCmt, '.hub-card {', shellProps);
  check('B-① hub.wxss 的 .hub-card 不重写底色/圆角/阴影（写了 ⇒ 枢纽页停在风格 A 的双层蓝影）',
    hubCardDup === false, hubCardDup === null ? '规则不存在（改名了？）' : '声明体干净');
  const hubFlowDup = anyRuleDeclares(hubWxssNoCmt, '.hub-flow {', shellProps);
  check('B-② hub.wxss 的 .hub-flow 同上', hubFlowDup === false,
    hubFlowDup === null ? '规则不存在' : '声明体干净');
  const hubEmptyDup = anyRuleDeclares(hubWxssNoCmt, '.hub-empty {', shellProps);
  check('B-③ hub.wxss 的 .hub-empty 同上（虚线边框是它专属语义，允许保留 border）',
    hubEmptyDup === false, hubEmptyDup === null ? '规则不存在' : '声明体干净');
  const catDup = anyRuleDeclares(matWxssNoCmt, '.cat-picker {', ['background', 'border-radius']);
  check('B-④ 物料页 .cat-picker 不自己写白底/12rpx 圆角（同屏两种圆角正是"看起来不统一"的来源）',
    catDup === false, catDup === null ? '规则不存在' : '声明体干净');

  console.log('\n===== C · 自失效护栏（证明上面的判据不是恒真）=====');
  const filesOk = [P.app, P.hubWxml, P.hubWxss, P.matWxml, P.matWxss, P.cardWxml, P.cardWxss]
    .every(function (p) { return size(p) > 200; });
  check('C-① 七个扫描面文件存在且非空', filesOk, 'app.wxss + 三页 wxml/wxss');
  check('C-② 选择器组没被掏空（≥5 个选择器；掏空后 A-⑥~⑨ 会找不到 ⇒ 假绿）',
    countOf(sbSelLine, '.') >= 5, '选择器行：' + sbSelLine.trim());
  // 合成负样本：把 sb-page 从根节点摘掉，判据必须转 false
  const negHub = hubWxml.replace('sb-page', '');
  // 合成负样本 2：把白底写回 .hub-card，B 层判据必须转 false
  const negHubWxss = hubWxss.replace('.hub-card {', '.hub-card { background: #fff;');
  check('C-③ 合成负样本：摘掉 sb-page ⇒ A-① 的判据转 false（判据非恒真）',
    rootHasClass(negHub, 'sb-page') === false, 'neg hub 判定 = ' + rootHasClass(negHub, 'sb-page'));
  const negDup = anyRuleDeclares(stripCssComments(negHubWxss), '.hub-card {', shellProps);
  check('C-④ 合成负样本：给 .hub-card 写回 background ⇒ B-① 的判据转 true（能抓到漂移）',
    negDup === true, 'neg 判定 = ' + negDup);
  const cardWxssUsed = cardWxss.length > 0;
  check('C-⑤ 成本卡页 wxss 被读到（防止路径写错导致该面恒空 ⇒ 未来加断言时恒绿）',
    cardWxssUsed, 'length=' + cardWxss.length);

  console.log('\n===== M3 三页风格 B 外壳守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  if (fail) bad.forEach(function (b) { console.log('   ❌ ' + b); });
  process.exit(fail === 0 ? 0 : 1);
})();
