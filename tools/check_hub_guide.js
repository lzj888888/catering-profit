// tools/check_hub_guide.js —— M3 枢纽页「三步走 + 分层 + 空状态」守卫（R263）
// 运行： node tools/check_hub_guide.js      （EXIT 0 = 全绿）
//
// 背景（李老师 2026-10-10 真机反馈）：
//   进 M3「配方」页「进来一脸懵 —— 不知道这个模块能做什么、怎么做、结果去哪里看」。
//   根因不是缺功能，是**呈现**：5 张分区卡**平级**摆着，没有任何"先做哪步 / 做完结果在哪"的线索。
//
// 为什么必须机器守：
//   这类"引导块"在真机上的失效方式是**静默**的 ——
//     · 把 `wx:if="{{cardCount === 0}}"` 放宽成 `<= 0` ⇒ 网络抖动（cardCount 停在 -1）也会
//       弹出"你还没有卡"，把老用户吓一跳，而**界面照样渲染、零报错**；
//     · 把引导块挪到卡片后面 ⇒ 老板还是先看到 5 张卡 = 本轮要解决的问题原样复现，肉眼看不出来；
//     · `flowSteps` 是**数组**，页面 `t:{}` 漏登记 ⇒ `{{t.flowSteps}}` 插值成空 ⇒ 引导条只剩标题（静默空白，R189 同族）；
//     · 卡名与页面标题不一致 ⇒ 点进去"名字变了"，用户以为走错页。
//
// 判据（六条，覆盖上面四种静默失效）：
//   🔴 R706 结构变更（李老师 2026-11-11）：原「三步走独立引导块」与其下的全局
//      「＋新建菜品成本卡」按钮**功能完全重复**于下面 8 张卡，已整体删除，
//      折叠成卡片名称前的序号徽章（未做 `①` 灰 / 做完 `✓` 墨绿，由 stepFlags 驱动）。
//      判据跟着改，但**要守的东西一条没减**：
//        · 引导仍须出现在卡片之前（现在引导就是"第一张卡是 ① 号卡"本身）；
//        · 仍须有完成态（stepFlags 必须真绑到 3 张卡，不能退化成静态文字）；
//        · 不允许有第二套入口（hub-flow / hub-quick 不许回来）。
//
//   G1 步骤引导在场（3 张卡各带 `hub-step` + stepFlags 完成态绑定 + ①②③ 三个序号）
//   G2 空状态判据必须是**严格相等** `cardCount === 0`（不是 `<=` / `<` / `!==`）
//   G3 两个分层标题都渲染（`t.secStart` / `t.secAfter`）
//   G4 **位置不变式**：第一步（① 号卡）必须是**第一张卡**，且空状态在卡之前
//   G5 文案两处齐：i18n 两副本 md5 全等 + hub.js 的 `t:{}` 登记了新键
//   G6 卡名 ≡ 页面标题（`hub.takeawayTitle` === `ledger.takeaway.title`）
//   G7 **不许有第二套入口**：页内不得再出现 hub-flow / hub-quick（R706 删掉的那两块）
//   G8 步骤徽章是**活的**：`hub-step` 必须带 `{{stepFlags[n] ? 'on' : ''}}`（静态 ✓ 判红）
//
// 自失效护栏（防本守卫被改小 / 判据恒真）：
//   S1 三个扫描面文件都存在且非空
//   S2 hub.wxml 里 `hub-card` 出现 ≥ 5 次（分区卡没被删光 ⇒ 位置不变式才有意义）
//   S3 terms 的 `hub` 组键数 ≥ 20（防止"把 terms 掏空 ⇒ 判据全找不到 ⇒ 恒假/恒真"）
(function () {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const ROOT = path.resolve(__dirname, '..');
  const HUB_WXML = path.join(ROOT, 'pages', 'm3', 'hub.wxml');
  const HUB_JS = path.join(ROOT, 'pages', 'm3', 'hub.js');
  const TERMS_A = path.join(ROOT, 'miniprogram', 'i18n', 'terms.js');
  const TERMS_B = path.join(ROOT, 'specs', 'dev-specs', 'i18n', 'terms.js');

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }
  function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

  const wxml = fs.readFileSync(HUB_WXML, 'utf8');
  const pageJs = fs.readFileSync(HUB_JS, 'utf8');
  const TERMS = require(TERMS_A).TERMS;
  const hub = TERMS.hub || {};

  // ================= G1 步骤引导（R706：折叠成卡片序号徽章）=================
  console.log('\n===== G1 · 步骤引导（卡片序号徽章）=====');
  // 🔴 为什么不再查 `wx:for="{{t.flowSteps}}"`：那个独立引导块已被删除（与 8 张卡重复）。
  //   现在要守的是"引导信息以另一种形态还在" —— 3 张关键卡各带一枚序号徽章。
  const stepBindN = (wxml.match(/class="hub-step \{\{stepFlags\[\d\] \? 'on' : ''\}\}"/g) || []).length;
  check('G1-1 步骤序号徽章绑到 stepFlags（≥3 张卡，未做 ①/②/③ · 做完 ✓）',
    stepBindN >= 3, '实际 ' + stepBindN + ' 处绑定');
  const numOk = ['①', '②', '③'].every((n) => wxml.indexOf(n) >= 0);
  check('G1-2 三个序号 ①②③ 都在 wxml 里真出现（缺一个 ⇒ 步骤链断在中间）',
    numOk, numOk ? '①②③ 齐' : '缺号');
  // 分区标题是序号含义的**唯一解释处**（卡片上不再重复写"先填进价/再配料"）
  const secExplains = /[①②③]/.test(hub.secStart || '') && /[①②③]/.test(hub.secAfter || '');
  check('G1-3 分区标题解释了序号含义（secStart / secAfter 各含 ①②③ 之一）',
    secExplains,
    'secStart=' + JSON.stringify(hub.secStart) + ' secAfter=' + JSON.stringify(hub.secAfter));

  // ================= G2 空状态判据必须严格相等 =================
  console.log('\n===== G2 · 空状态判据（严格 === 0）=====');
  const emptyIdx = wxml.indexOf('hub-empty');
  const strictZero = /wx:if\s*=\s*"\{\{\s*cardCount\s*===\s*0\s*\}\}"/.test(wxml);
  check('G2-1 空状态用严格 `cardCount === 0`（不用 <= / < / 真值判断）', strictZero,
    strictZero ? '严格相等' : '未找到严格相等写法');
  // ⚠️ 判据只盯**空状态那一处**表达式，不扫全文件 —— 页内另有合法的 `cardCount >= 0`（显示卡数），
  //    扫全文件会把它误判成"宽松写法"（本守卫首版就踩了这一下）。
  const emptyTag = (wxml.match(/<view[^>]*hub-empty[^>]*wx:if\s*=\s*"([^"]*)"/) || [])[1] || '';
  const emptyExprClean = /^\s*\{\{\s*cardCount\s*===\s*0\s*\}\}\s*$/.test(emptyTag);
  check('G2-2 空状态表达式里没有别的比较/真值写法（`<=` / `<` / `!cardCount` 都会把"没读到(-1)"误判成空）',
    emptyExprClean, '表达式 = ' + JSON.stringify(emptyTag));
  // 判据的**上游**：-1 语义本身不能被破坏 —— 失败时若写入 0，再严格的 `=== 0` 也会误报。
  const initMinus1 = /cardCount\s*:\s*-1/.test(pageJs);
  const catchBlocks = pageJs.match(/catch\s*\([^)]*\)\s*\{[^}]*\}/g) || [];
  const catchWritesCount = catchBlocks.some((b) => /cardCount/.test(b));
  check('G2-3 data 初值 -1 且失败路径不写 cardCount（失败写 0 ⇒ 网络一抖就误报「你还没有卡」）',
    initMinus1 && !catchWritesCount,
    'init-1=' + initMinus1 + ' 失败路径写 cardCount=' + catchWritesCount);

  // ================= G3 分层标题 =================
  console.log('\n===== G3 · 分层标题 =====');
  const secStartOk = /\{\{\s*t\.secStart\s*\}\}/.test(wxml) && typeof hub.secStart === 'string' && hub.secStart.length > 0;
  const secAfterOk = /\{\{\s*t\.secAfter\s*\}\}/.test(wxml) && typeof hub.secAfter === 'string' && hub.secAfter.length > 0;
  check('G3-1 「先做」层标题渲染且文案非空', secStartOk, 'secStart=' + JSON.stringify(hub.secStart));
  check('G3-2 「有卡之后」层标题渲染且文案非空', secAfterOk, 'secAfter=' + JSON.stringify(hub.secAfter));

  // ================= G4 位置不变式 =================
  console.log('\n===== G4 · 位置不变式（第一步必须在最前）=====');
  const iFirstCard = wxml.indexOf('class="hub-card"');
  const iHero = wxml.indexOf('hub-hero');
  // ⚠️ 必须找**三元里的** `: '①'`，不能直接 indexOf('①') ——
  //   卡片上方有注释 `<!-- ① 原料必须先有价… -->`，会先命中注释，判据当场假绿。
  const iT1 = wxml.indexOf(": '①'");
  const iT2 = wxml.indexOf(": '②'");
  const iT3 = wxml.indexOf(": '③'");
  check('G4-1 三张步骤卡按 ①②③ 顺序排列，且都在第一张卡内',
    iFirstCard >= 0 && iT1 > iFirstCard && iT2 > iT1 && iT3 > iT2,
    'firstCard@' + iFirstCard + ' ①②③@' + iT1 + '/' + iT2 + '/' + iT3);
  // 第一张卡必须是原料卡（先有进价，后面配料的成本才不是空的）
  const firstCardBlock = wxml.slice(iFirstCard, iFirstCard + 400);
  check('G4-2 第一张卡是「进货原料价表」（bindtap=goMaterial）',
    /bindtap="goMaterial"/.test(firstCardBlock),
    (firstCardBlock.match(/bindtap="(\w+)"/) || [])[1] || '未取到');
  check('G4-3 空状态块下标 < 第一张卡下标（空状态要顶在卡片前面才拦得住）',
    emptyIdx >= 0 && iFirstCard >= 0 && emptyIdx < iFirstCard,
    'empty@' + emptyIdx + ' firstCard@' + iFirstCard);
  check('G4-4 hero 在所有卡之前（标题先于入口）',
    iHero >= 0 && iFirstCard >= 0 && iHero < iFirstCard,
    'hero@' + iHero + ' firstCard@' + iFirstCard);

  // ================= G5 文案三处齐 =================
  console.log('\n===== G5 · 文案三处（i18n 双副本 + 页面 t: 登记）=====');
  let md5Eq = false, md5t = '';
  try { const a = md5(TERMS_A), b = md5(TERMS_B); md5Eq = (a === b); md5t = a.slice(0, 8); } catch (e) { md5Eq = false; }
  check('G5-1 i18n 两副本 md5 全等（miniprogram ≡ specs/dev-specs）', md5Eq, 'md5=' + md5t);
  // R706：flowTitle / flowSteps 已随引导块一起删除 ⇒ 改查仍在用的 5 键。
  const NEW_KEYS = ['secStart', 'secAfter', 'emptyTitle', 'emptyDesc', 'emptyBtn'];
  const mk = pageJs.match(/^[ \t]*t[ \t]*:[ \t]*\{/m);
  let tBlock = '';
  if (mk) {
    const b0 = pageJs.indexOf('{', mk.index);
    let depth = 0, end = -1;
    for (let k = b0; k < pageJs.length; k++) {
      if (pageJs[k] === '{') depth++;
      else if (pageJs[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end > 0) tBlock = pageJs.slice(b0, end + 1);
  }
  const missing = NEW_KEYS.filter((k) => !new RegExp('^[ \\t]*' + k + '[ \\t]*:', 'm').test(tBlock));
  check('G5-2 hub.js 的 t:{} 登记了全部 5 个在用键（漏登记 ⇒ 该处静默空白）',
    missing.length === 0,
    missing.length ? ('缺：' + missing.join(', ')) : NEW_KEYS.length + '/' + NEW_KEYS.length + ' 已登记');

  // ================= G6 卡名 ≡ 页面标题 =================
  console.log('\n===== G6 · 卡名与页面标题一致 =====');
  const pageTitle = (TERMS.ledger && TERMS.ledger.takeaway && TERMS.ledger.takeaway.title) || '';
  check('G6-1 hub.takeawayTitle === ledger.takeaway.title（点进去标题不会变，否则用户以为走错页）',
    !!pageTitle && hub.takeawayTitle === pageTitle,
    'hub=' + JSON.stringify(hub.takeawayTitle) + ' page=' + JSON.stringify(pageTitle));
  check('G6-2 hub 卡名不再含"成本及利润"这种把后台动作写进功能名的旧名',
    typeof hub.takeawayTitle === 'string' && hub.takeawayTitle.indexOf('成本及利润') < 0,
    'takeawayTitle=' + JSON.stringify(hub.takeawayTitle));

  // ================= G7 不许有第二套入口 =================
  // 🔴 R706（李老师 2026-11-11）：「上面那两行去填什么和底下那两个按钮，其实它俩功能是一样的」
  //   原页有**三套并行入口**指向同一批页面：
  //     ① 三步走引导块（①→原料卡 ②→成本卡 ③→销量导入卡）+ 直达按钮
  //     ② 全局「＋新建菜品成本卡」按钮
  //     ③ 下面 8 张卡
  //   ① ② 已删。本组守"不许回来" —— 它们回来时页面照样渲染、零报错，只靠肉眼看不出。
  console.log('\n===== G7 · 不许有第二套入口（hub-flow / hub-quick）=====');
  const noSecondEntry = (src) => src.indexOf('hub-flow') < 0 && src.indexOf('hub-quick') < 0;
  check('G7-1 页内不再有 hub-flow（三步走独立块）与 hub-quick（全局新建按钮）',
    noSecondEntry(wxml), 'hub-flow=' + wxml.indexOf('hub-flow') + ' hub-quick=' + wxml.indexOf('hub-quick'));
  check('G7-2 反恒真：影子样本（含 hub-quick 的旧写法）必须判红',
    noSecondEntry('<button class="btn primary hub-quick" bindtap="goCard">＋ 新建菜品成本卡</button>') === false,
    '影子样本已证伪');
  // 方法层面：goStep 这个"引导块专用跳转"若还在，说明有人把按钮加回来了却没走卡片
  check('G7-3 goStep 不再存在（它是引导块按钮的专用跳转；卡片自己 bindtap 已覆盖）',
    !/goStep\s*\(/.test(pageJs), 'goStep 命中 ' + (/goStep\s*\(/.test(pageJs) ? '有' : '无'));

  // ================= G8 步骤徽章是活的 =================
  console.log('\n===== G8 · 步骤徽章必须由 stepFlags 驱动 =====');
  // 🔴 最容易的退化：把 `{{stepFlags[0] ? '✓' : '①'}}` 直接写成静态 `①` —— 页面照常渲染、
  //   永远显示"未做"，老板做完所有步骤仍看到三个 ①，且**零报错**。这类静默失真必须机器守。
  const triExprN = (wxml.match(/\{\{stepFlags\[\d\] \? '✓' : '①'\}\}|\{\{stepFlags\[\d\] \? '✓' : '②'\}\}|\{\{stepFlags\[\d\] \? '✓' : '③'\}\}/g) || []).length;
  check('G8-1 三张卡的序号都用三元表达式（`stepFlags[n] ? ✓ : 序号`），不是静态字符',
    triExprN >= 3, '实际 ' + triExprN + ' 处三元');
  const flagsLen = /stepFlags\s*:\s*\[\s*false\s*,\s*false\s*,\s*false\s*\]/.test(pageJs);
  check('G8-2 data 初值 stepFlags = [false,false,false]（fail-closed：读失败=未完成，不冒充已完成）',
    flagsLen, flagsLen ? '三态初值正确' : '初值被改');
  check('G8-3 反恒真：静态序号样本过不了 G8-1 的判据',
    ((`<text class="hub-step">{{'①'}}</text>`).match(/\{\{stepFlags\[\d\] \? '✓' : '①'\}\}/g) || []).length === 0,
    '影子样本已证伪');

  // ================= 自失效护栏 =================
  console.log('\n===== S · 自失效护栏（证明本守卫不是恒真）=====');
  const sizesOk = [HUB_WXML, HUB_JS, TERMS_A].every((p) => { try { return fs.statSync(p).size > 200; } catch (e) { return false; } });
  check('S1 三个扫描面文件存在且非空', sizesOk, 'hub.wxml / hub.js / terms.js');
  const cardCount = (wxml.match(/class="hub-card"/g) || []).length;
  // R706：卡片仍是 8 张（删的是引导块与快捷按钮，不是卡片）
  check('S2 hub.wxml 里分区卡 ≥ 5 张（删引导块时不许顺手删卡）', cardCount >= 5, '实际 ' + cardCount + ' 张');
  const hubKeyN = Object.keys(hub).length;
  check('S3 terms.hub 键数 ≥ 20（防止把 terms 掏空 ⇒ 判据全找不到）', hubKeyN >= 20, '实际 ' + hubKeyN + ' 个键');

  console.log('\n===== M3 枢纽页引导守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach((b) => console.log('   ❌ ' + b));
  process.exit(failN === 0 ? 0 : 1);
})();
