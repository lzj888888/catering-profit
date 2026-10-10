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
//   G1 三步走块在场（wxml 真渲染 `t.flowSteps` + terms 里是 ≥3 项的非空数组）
//   G2 空状态判据必须是**严格相等** `cardCount === 0`（不是 `<=` / `<` / `!==`）
//   G3 两个分层标题都渲染（`t.secStart` / `t.secAfter`）
//   G4 **位置不变式**：三步走块与空状态块的字符下标都必须**小于第一张卡的**下标
//   G5 文案三处齐：i18n 两副本 md5 全等 + hub.js 的 `t:{}` 登记了 7 个新键
//   G6 卡名 ≡ 页面标题（`hub.takeawayTitle` === `ledger.takeaway.title`）
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

  // ================= G1 三步走块 =================
  console.log('\n===== G1 · 三步走块在场 =====');
  const flowHasLoop = /wx:for\s*=\s*"\{\{\s*t\.flowSteps\s*\}\}"/.test(wxml);
  const flowSteps = hub.flowSteps;
  const flowArrOk = Array.isArray(flowSteps) && flowSteps.length >= 3
    && flowSteps.every((s) => typeof s === 'string' && s.trim().length > 0);
  check('G1-1 hub.wxml 真渲染三步走（`wx:for="{{t.flowSteps}}"`）', flowHasLoop,
    flowHasLoop ? '已绑定' : '没找到 flowSteps 的 wx:for —— 引导条不会被渲染');
  check('G1-2 terms.hub.flowSteps 是 ≥3 项非空字符串数组', flowArrOk,
    flowArrOk ? flowSteps.length + ' 步：' + flowSteps.join(' / ') : '实际 = ' + JSON.stringify(flowSteps));

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
  console.log('\n===== G4 · 位置不变式（引导必须在第一张卡之前）=====');
  const iFlow = wxml.indexOf('hub-flow');
  const iFirstCard = wxml.indexOf('class="hub-card"');
  const iHero = wxml.indexOf('hub-hero');
  check('G4-1 三步走块下标 < 第一张卡下标（挪到卡后 ⇒ 老板还是先看到 5 张卡）',
    iFlow >= 0 && iFirstCard >= 0 && iFlow < iFirstCard,
    'flow@' + iFlow + ' firstCard@' + iFirstCard);
  check('G4-2 空状态块下标 < 第一张卡下标（空状态要顶在卡片前面才拦得住）',
    emptyIdx >= 0 && iFirstCard >= 0 && emptyIdx < iFirstCard,
    'empty@' + emptyIdx + ' firstCard@' + iFirstCard);
  check('G4-3 顺序为 hero → flow → 卡（hero 之后紧接引导，不是被别的块插队）',
    iHero >= 0 && iFlow > iHero && iFlow < iFirstCard,
    'hero@' + iHero + ' flow@' + iFlow);

  // ================= G5 文案三处齐 =================
  console.log('\n===== G5 · 文案三处（i18n 双副本 + 页面 t: 登记）=====');
  let md5Eq = false, md5t = '';
  try { const a = md5(TERMS_A), b = md5(TERMS_B); md5Eq = (a === b); md5t = a.slice(0, 8); } catch (e) { md5Eq = false; }
  check('G5-1 i18n 两副本 md5 全等（miniprogram ≡ specs/dev-specs）', md5Eq, 'md5=' + md5t);
  const NEW_KEYS = ['flowTitle', 'flowSteps', 'secStart', 'secAfter', 'emptyTitle', 'emptyDesc', 'emptyBtn'];
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
  check('G5-2 hub.js 的 t:{} 登记了全部 7 个新键（漏登记 ⇒ 引导条静默空白）',
    missing.length === 0,
    missing.length ? ('缺：' + missing.join(', ')) : '7/7 已登记');

  // ================= G6 卡名 ≡ 页面标题 =================
  console.log('\n===== G6 · 卡名与页面标题一致 =====');
  const pageTitle = (TERMS.ledger && TERMS.ledger.takeaway && TERMS.ledger.takeaway.title) || '';
  check('G6-1 hub.takeawayTitle === ledger.takeaway.title（点进去标题不会变，否则用户以为走错页）',
    !!pageTitle && hub.takeawayTitle === pageTitle,
    'hub=' + JSON.stringify(hub.takeawayTitle) + ' page=' + JSON.stringify(pageTitle));
  check('G6-2 hub 卡名不再含"成本及利润"这种把后台动作写进功能名的旧名',
    typeof hub.takeawayTitle === 'string' && hub.takeawayTitle.indexOf('成本及利润') < 0,
    'takeawayTitle=' + JSON.stringify(hub.takeawayTitle));

  // ================= 自失效护栏 =================
  console.log('\n===== S · 自失效护栏（证明本守卫不是恒真）=====');
  const sizesOk = [HUB_WXML, HUB_JS, TERMS_A].every((p) => { try { return fs.statSync(p).size > 200; } catch (e) { return false; } });
  check('S1 三个扫描面文件存在且非空', sizesOk, 'hub.wxml / hub.js / terms.js');
  const cardCount = (wxml.match(/class="hub-card"/g) || []).length;
  check('S2 hub.wxml 里分区卡 ≥ 5 张', cardCount >= 5, '实际 ' + cardCount + ' 张');
  const hubKeyN = Object.keys(hub).length;
  check('S3 terms.hub 键数 ≥ 20（防止把 terms 掏空 ⇒ 判据全找不到）', hubKeyN >= 20, '实际 ' + hubKeyN + ' 个键');

  console.log('\n===== M3 枢纽页引导守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach((b) => console.log('   ❌ ' + b));
  process.exit(failN === 0 ? 0 : 1);
})();
