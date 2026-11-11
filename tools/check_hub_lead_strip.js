// tools/check_hub_lead_strip.js —— M3 枢纽页「第一层两张卡是横条」守卫（R713）
// 运行： node tools/check_hub_lead_strip.js      （EXIT 0 = 全绿）
//
// 背景（李老师 2026-11-12 真机反馈第 ① 条）：
//   「原料进价表、菜品成本毛利这两张卡跟下面五张长得一样，容易混，改成长条」。
//   根因不是丑，是**分不清层级**：上两张是"必须先做、做完才有数"的主链路，
//   下面五张是"有数据之后拿来用的工具"，八张同形同尺寸 ⇒ 老板当成同一批功能挑着点。
//
// 为什么必须机器守（这类失效全是静默的）：
//   ① 覆盖顺序：`.hub-grid-lead .hub-card` 与 `.hub-grid .hub-card` 的**特异性完全相同**
//      （都是两个类选择器），谁生效**只取决于源码先后**。谁把 lead 那段往上挪一格
//      （改样式时最顺手的事），横条当场变回 50% 宽竖排 —— 页面照样渲染、零报错；
//      反过来，若有人为了"省事"把 lead 的 width 写进 `.hub-grid .hub-card`，
//      下面五张宫格也会被一起撑成全宽 ⇒ 同样是静默改版。
//   ② 忘了包 `.hub-main`：顶层 `.hub-card` 是 `display:flex`（横排），
//      name / count / desc 三个兄弟不包一层的话会被拆成**三列并排**，文字挤成一柱。
//   ③ 顺手加第二个类名：`check_hub_guide` 的 S2/G4 按字面量 `class="hub-card"` 数卡数，
//      加第二个类会让它数到 0 ⇒ 误报"卡片丢了"（这道守卫会先一步判红，说明白原因）。
//   ④ 顺手在本页写回底色/圆角/阴影：脱离 app.wxss `.sb-*` 单源（check_m3_style_b B-① 也守着，
//      但它只取**第一次**出现的 `.hub-card {`，新加的复合选择器它抓不到 ⇒ 这里补上）。
//
// 判据：
//   A 结构面：lead 容器恰好 1 个且在第二层宫格之前；lead 内恰好 2 张卡、宫格内 5 张；
//             卡片类名仍是**单类名** hub-card；每张横条卡内用 `.hub-main` 把文字包成一组
//   B 层叠裁决：把 hub.wxss **真跑一遍层叠**（匹配 → 特异性 → 源码顺序），算出
//             「横条内的 .hub-card 最终 flex-direction / width」与「宫格内的」分别是多少 ——
//             不靠读注释、不靠"我看它写在后面"
//   C 单源面：lead 组里针对 .hub-card 的规则不许声明底色/圆角/阴影；字号一律 ≥28rpx（AD 红线）
//   S 自失效护栏：文件非空 + 反恒真（把两条规则顺序对调，B 的裁决必须转成 column）
//
// 🔴 本文件不用正则（本机曾把反斜杠转成斜杠 ⇒ 落盘即语法错），一律 indexOf + slice。
(function () {
  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..');
  const HUB_WXML = path.join(ROOT, 'pages', 'm3', 'hub.wxml');
  const HUB_WXSS = path.join(ROOT, 'pages', 'm3', 'hub.wxss');

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }
  function countOf(s, needle) {
    let n = 0, i = 0;
    while (true) { const k = s.indexOf(needle, i); if (k < 0) break; n++; i = k + needle.length; }
    return n;
  }
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

  // ===== 迷你 CSS 层叠求值（只支持类选择器后代链，够本页用）=====
  function parseRules(css) {
    const s = stripCssComments(css);
    const rules = [];
    let i = 0;
    while (true) {
      const b = s.indexOf('{', i);
      if (b < 0) break;
      const close = s.indexOf('}', b);
      if (close < 0) break;
      const selText = s.slice(i, b).split(';').pop(); // 丢掉上一条声明尾巴（若有）
      const body = s.slice(b + 1, close);
      selText.split(',').forEach(function (one) {
        const sel = one.split(String.fromCharCode(10)).join(' ').split(String.fromCharCode(13)).join(' ').trim();
        if (!sel || sel.charAt(0) !== '.') return;
        rules.push({ sel: sel, body: body, pos: b, blank: false });
      });
      i = close + 1;
    }
    return rules;
  }
  function classesOf(part) {
    return part.split('.').filter(function (x) { return x.length > 0; });
  }
  function partMatches(classes, part) {
    const need = classesOf(part);
    if (!need.length) return false;
    return need.every(function (c) { return classes.indexOf(c) >= 0; });
  }
  // el = { cls: [...], anc: [[...], [...]] }  anc 由近到远
  function selectorMatches(sel, el) {
    const parts = sel.split(' ').filter(function (x) { return x.length > 0; });
    if (!parts.length) return false;
    if (!partMatches(el.cls, parts[parts.length - 1])) return false;
    let ai = 0;
    for (let pi = parts.length - 2; pi >= 0; pi--) {
      let found = -1;
      for (let k = ai; k < el.anc.length; k++) {
        if (partMatches(el.anc[k], parts[pi])) { found = k; break; }
      }
      if (found < 0) return false;
      ai = found + 1;
    }
    return true;
  }
  function specificity(sel) {
    const parts = sel.split(' ').filter(function (x) { return x.length > 0; });
    let n = 0;
    parts.forEach(function (p) { n += classesOf(p).length; });
    return n;
  }
  // 求某元素某属性的最终值：特异性高者胜，同特异性取源码靠后者
  // ⚠️ 必须防 `min-width:` 被当成 `width:`（indexOf 会命中后半截）—— 否则判据读到的
  //    是无关声明，而页面照样渲染、零报错，属于本仓记过的"假绿"同族。
  function propValue(body, prop) {
    let i = 0;
    while (true) {
      const k = body.indexOf(prop + ':', i);
      if (k < 0) return null;
      if (k === 0 || body.charAt(k - 1) !== '-') {
        return body.slice(k + prop.length + 1).split(';')[0].trim();
      }
      i = k + prop.length + 1;
    }
  }
  function cascade(rules, el, prop) {
    let best = null;
    rules.forEach(function (r) {
      if (!selectorMatches(r.sel, el)) return;
      const val = propValue(r.body, prop);
      if (val === null) return;
      const spec = specificity(r.sel);
      if (best !== null && spec < best.spec) return;
      if (best !== null && spec === best.spec && r.pos < best.pos) return;
      best = { val: val, spec: spec, pos: r.pos, sel: r.sel };
    });
    return best;
  }

  const wxml = fs.readFileSync(HUB_WXML, 'utf8');
  const wxss = fs.readFileSync(HUB_WXSS, 'utf8');
  const rules = parseRules(wxss);

  // 祖先链（与 hub.wxml 实际嵌套一致）：根 view.container > view.hub-grid[.hub-grid-lead] > view.hub-card
  const ROOT_ANC = [['container', 'safe-bottom', 'sb-page']];
  const elLead = { cls: ['hub-card'], anc: [['hub-grid', 'hub-grid-lead']].concat(ROOT_ANC) };
  const elGrid = { cls: ['hub-card'], anc: [['hub-grid']].concat(ROOT_ANC) };

  // ================= A · 结构面 =================
  console.log('\n===== A · 结构面（谁在横条里、谁在宫格里）=====');
  const leadDecl = 'class="hub-grid hub-grid-lead"';
  const gridDecl = 'class="hub-grid"';
  const nLead = countOf(wxml, leadDecl);
  const nGrid = countOf(wxml, gridDecl);
  check('A-① 第一层容器恰好 1 个带 hub-grid-lead，第二层宫格恰好 1 个不带',
    nLead === 1 && nGrid === 1, 'lead=' + nLead + ' grid=' + nGrid);
  const iLead = wxml.indexOf(leadDecl);
  const iGrid = wxml.indexOf(gridDecl);
  check('A-② lead 容器在宫格**之前**（①② 必须排在最前，位置不变式由 check_hub_guide G4 兜底）',
    iLead >= 0 && iGrid >= 0 && iLead < iGrid, 'lead@' + iLead + ' grid@' + iGrid);

  const totalCards = countOf(wxml, 'class="hub-card"');
  const leadZone = wxml.slice(iLead, iGrid);
  const gridZone = wxml.slice(iGrid);
  const leadCards = countOf(leadZone, 'class="hub-card"');
  const gridCards = countOf(gridZone, 'class="hub-card"');
  check('A-③ 横条里恰好 2 张卡、宫格里 5 张（横条不许吞掉工具卡，也不许只剩 1 张）',
    leadCards === 2 && gridCards === 5 && totalCards === 7,
    'lead=' + leadCards + ' grid=' + gridCards + ' 总=' + totalCards);
  // 卡片类名不许变成 "hub-card xxx"：S2/G4 按字面量数卡数，多一个类就数到 0
  check('A-④ 卡片仍是**单类名** `class="hub-card"`（加了第二个类 ⇒ check_hub_guide S2 数到 0 ⇒ 误报丢卡）',
    totalCards === 7, '字面量命中 ' + totalCards + ' 处');
  // 三行文字必须包进一组，否则 flex 会把 name/count/desc 排成三列
  const nMain = countOf(leadZone, 'class="hub-main"');
  check('A-⑤ 两张横条卡各自用 `.hub-main` 把标题/卡数/描述包成一组（不包 ⇒ 三行文字被 flex 排成三列）',
    nMain === 2, 'hub-main=' + nMain + ' 处');
  // 横条里必须有图标（横排靠"图标在左、文字在右"给出层级差，没图标就只是变宽）
  check('A-⑥ 两张横条卡都带图标块（hub-ico）',
    countOf(leadZone, 'class="hub-ico ') === 2, 'hub-ico=' + countOf(leadZone, 'class="hub-ico '));

  // ================= B · 层叠裁决（真算，不靠眼睛看顺序）=================
  console.log('\n===== B · 层叠裁决（真跑一遍层叠，算出最终生效值）=====');
  const leadDir = cascade(rules, elLead, 'flex-direction');
  const gridDir = cascade(rules, elGrid, 'flex-direction');
  check('B-① 横条卡最终 flex-direction = row（覆盖生效）',
    !!leadDir && leadDir.val === 'row',
    leadDir ? leadDir.val + ' ← ' + leadDir.sel : '没有规则命中');
  check('B-② 宫格卡最终 flex-direction 仍是 column（横条没写宽 ⇒ 宫格不许被带偏）',
    !!gridDir && gridDir.val === 'column',
    gridDir ? gridDir.val + ' ← ' + gridDir.sel : '没有规则命中');
  const leadW = cascade(rules, elLead, 'width');
  check('B-③ 横条卡最终 width = 100%',
    !!leadW && leadW.val === '100%', leadW ? leadW.val + ' ← ' + leadW.sel : '没有规则命中');
  const gridW = cascade(rules, elGrid, 'width');
  check('B-④ 宫格卡最终宽度仍是 calc(50% - 10rpx)（两列不变）',
    !!gridW && gridW.val.indexOf('calc(50%') === 0, gridW ? gridW.val + ' ← ' + gridW.sel : '没有规则命中');
  // 图标尺寸：横条 88rpx（回到大号）、宫格 72rpx（两列必须缩），两者都要真的分开
  const leadIco = cascade(rules, { cls: ['hub-ico', 'hub-ico-material'], anc: elLead.anc }, 'width');
  const gridIco = cascade(rules, { cls: ['hub-ico', 'hub-ico-material'], anc: elGrid.anc }, 'width');
  check('B-⑤ 图标块两套尺寸真的分开了（横条 88rpx / 宫格 72rpx）',
    !!leadIco && leadIco.val === '88rpx' && !!gridIco && gridIco.val === '72rpx',
    'lead=' + (leadIco && leadIco.val) + ' grid=' + (gridIco && gridIco.val));

  // ================= C · 单源面 + AD 红线 =================
  console.log('\n===== C · 单源面与字号红线 =====');
  const SHELL = ['background', 'border-radius', 'box-shadow'];
  const leadCardRules = rules.filter(function (r) {
    return r.sel.indexOf('.hub-grid-lead') === 0
      && r.sel.slice(-9) === '.hub-card'
      && r.sel.indexOf('hub-ico') < 0;
  });
  const dirty = leadCardRules.filter(function (r) {
    return SHELL.some(function (p) { return r.body.indexOf(p + ':') >= 0; });
  });
  check('C-② lead 组里针对 .hub-card 的规则不重写底色/圆角/阴影（写了 ⇒ 本页脱离 .sb-* 单源）',
    leadCardRules.length > 0 && dirty.length === 0,
    '规则 ' + leadCardRules.length + ' 条 / 脏 ' + dirty.length + ' 条');
  // 字号红线：lead 组内所有 font-size ≥ 28rpx
  const sizeBad = [];
  const leadRulesAll = rules.filter(function (r) { return r.sel.indexOf('.hub-grid-lead') === 0; });
  check('C-① lead 组真的被扫到了（>0 条规则）—— 否则 C-①/C-② 会因"一条都没匹配"而恒绿',
    leadRulesAll.length >= 4, '扫到 ' + leadRulesAll.length + ' 条 lead 规则');
  leadRulesAll.forEach(function (r) {
    let i = 0;
    while (true) {
      const k = r.body.indexOf('font-size:', i);
      if (k < 0) break;
      const v = r.body.slice(k + 10).split(';')[0].trim();
      const num = parseInt(v, 10);
      if (!(num >= 28)) sizeBad.push(r.sel + ' → ' + v);
      i = k + 10;
    }
  });
  check('C-③ lead 组里没有 <28rpx 的字号（AD 红线：店里光线差，小字等于看不见）',
    sizeBad.length === 0, sizeBad.length ? sizeBad.join(' | ') : '全部 ≥28rpx');

  // ================= S · 自失效护栏（证明 B 的裁决不是恒真）=================
  console.log('\n===== S · 自失效护栏 =====');
  check('S1 两个扫描面文件存在且非空',
    fs.statSync(HUB_WXML).size > 200 && fs.statSync(HUB_WXSS).size > 200,
    'hub.wxml / hub.wxss');
  // 反恒真①：把 lead 规则的 pos 整体挪到宫格规则之前（等价于"那段被往上挪了"），
  //   层叠结果必须变回 column —— 证明 B-① 不是"因为文件里这么写着"才绿，而是真的算出来的。
  const gridMinPos = rules.reduce(function (m, r) {
    return (r.sel === '.hub-grid .hub-card' && r.pos < m) ? r.pos : m;
  }, Number.MAX_SAFE_INTEGER);
  const rulesMoved = rules.map(function (r) {
    const c = { sel: r.sel, body: r.body, pos: r.pos };
    if (c.sel.indexOf('.hub-grid-lead') === 0) c.pos = gridMinPos - 1;
    return c;
  });
  const movedDir = cascade(rulesMoved, elLead, 'flex-direction');
  check('S2 反恒真：lead 规则被挪到宫格之前后，横条 flex-direction 变成 column（B-① 算得出顺序失效）',
    !!movedDir && movedDir.val === 'column',
    movedDir ? movedDir.val + ' ← ' + movedDir.sel : '没有规则命中');
  // 反恒真②：影子样本 —— 把 width 写进全局 .hub-grid .hub-card，宫格必须被判红
  const negWxss = wxss.split('.hub-grid .hub-card {').join('.hub-grid .hub-card { width: 100%;');
  const negGridW = cascade(parseRules(negWxss), elGrid, 'width');
  check('S3 反恒真：给宫格规则写 width:100% 后，B-④ 的判据会转 false（抓得到"宫格被带偏"）',
    !!negGridW && negGridW.val !== 'calc(50% - 10rpx)', negGridW ? negGridW.val : 'null');

  console.log('\n===== M3 第一层横条守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach(function (b) { console.log('   ❌ ' + b); });
  process.exit(failN === 0 ? 0 : 1);
})();
