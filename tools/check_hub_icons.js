// tools/check_hub_icons.js —— M3 枢纽页图标与状态徽标守卫（R758）
// 运行： node tools/check_hub_icons.js      （EXIT 0 = 全绿）
//
// 背景（李老师 2026-11-25）：「每个都是一个字做的 LOGO，感觉有点单薄，整体页面有点素，
//   全是文字感」⇒ 8 个单字图标换成线性 PNG + 每张卡挂一枚**带真实语义**的状态徽标。
//
// 为什么必须机器守（失效全是静默的，界面照渲染、零报错）：
//   · 图标文件被 .gitignore 漏掉 / 误删 ⇒ `<image src>` 加载失败，图标块变空白渐变方块；
//   · terms 里的路径写错一个字母 ⇒ WXML 插值出坏路径，同样静默空白（本仓 R189 P2-1 同族）；
//   · 有人把 `<image>` 改回 `{{t.icoXxx}}` 单字 ⇒ 视觉退回 R758 之前，却没人报 bug；
//   · 徽标文案漏登记 ⇒ WXML 插成空串，徽标只剩底色药丸（"空白徽标"）；
//   · 生成脚本被删/关键函数被改 ⇒ 图标不再可复现，下次换配色只能手画。
//
// 判据：
//   A 资源面：8 个 PNG 存在、非空、PNG 魔数正确；生成脚本在场且含 8 个 draw_* 函数
//   B 接线面：wxml 的 `<image class="hub-ico-img" src="{{t.icoXxx}}">` 恰好 8 处，
//             且每个 icoXxx 的 terms 路径都指向 A 里真实存在的文件
//   C 徽标面：5 个徽标键 double-check（terms 双副本 + hub.js t:{} 登记 + wxml 真引用）
//   D 反恒真：造坏路径 / 去掉 image 的影子样本必须判红，证明判据不是恒真
(function () {
  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..');
  const P = {
    wxml: path.join(ROOT, 'pages', 'm3', 'hub.wxml'),
    js: path.join(ROOT, 'pages', 'm3', 'hub.js'),
    termsA: path.join(ROOT, 'miniprogram', 'i18n', 'terms.js'),
    termsB: path.join(ROOT, 'specs', 'dev-specs', 'i18n', 'terms.js'),
    gen: path.join(ROOT, 'tools', 'gen_hub_icons.py'),
    iconDir: path.join(ROOT, 'images', 'hub'),
  };
  const ICON_KEYS = ['icoMaterial', 'icoCard', 'icoTakeaway', 'icoGroupon',
    'icoReview', 'icoRevenue', 'icoRecon', 'icoPromo'];
  const BADGE_KEYS = ['badgeDone', 'badgeTodo', 'badgeBuilt', 'badgeTool', 'badgeData'];

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }
  function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }
  function size(p) { try { return fs.statSync(p).size; } catch (e) { return -1; } }

  const wxml = read(P.wxml);
  const hubJs = read(P.js);
  const termsSrc = read(P.termsA);
  const terms = require(P.termsA).TERMS;
  const hub = terms.hub || {};
  const genSrc = read(P.gen);

  console.log('\n===== A · 资源面（8 个 PNG + 生成脚本可复现）=====');
  const missing = ICON_KEYS.filter((k) => {
    const rel = hub[k];
    if (typeof rel !== 'string' || rel.indexOf('/images/hub/') !== 0) return true;
    const fp = path.join(ROOT, rel);
    return size(fp) < 100;
  });
  check('A-① 8 个图标 terms 路径都是 /images/hub/*.png 且文件非空',
    missing.length === 0, missing.length ? ('缺/坏：' + missing.join(',')) : '8/8 在位');
  const pngOk = ICON_KEYS.filter((k) => {
    const fp = path.join(ROOT, hub[k]);
    try {
      const b = fs.readFileSync(fp);
      return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    } catch (e) { return false; }
  }).length;
  check('A-② 8 个文件都是真 PNG（魔数 89 50 4E 47，不是空壳/文本文件）',
    pngOk === 8, pngOk + '/8');
  const drawFns = ICON_KEYS.filter((k) => {
    const fn = 'draw_' + k.replace(/^ico/, '').toLowerCase();
    return genSrc.indexOf('def ' + fn + '(') >= 0;
  });
  check('A-③ 生成脚本含 8 个 draw_* 函数（图标可复现，非手画黑盒）',
    drawFns.length === 8, drawFns.length + '/8');
  check('A-④ 生成脚本产出目录指向 images/hub（的路径与实际一致）',
    genSrc.indexOf("'images', 'hub'") >= 0 || genSrc.indexOf('images/hub') >= 0);

  console.log('\n===== B · 接线面（wxml image 引用 ↔ terms 路径 ↔ 真文件）=====');
  // 逐个 ico 键查 wxml 里有没有对应的 <image ... src="{{t.KEY}}">
  const wired = ICON_KEYS.filter((k) => {
    const re = new RegExp('<image[^>]*class="hub-ico-img"[^>]*src="\\{\\{t\\.' + k + '\\}\\}"');
    return re.test(wxml);
  });
  check('B-① 8 个图标全部用 <image class="hub-ico-img" src="{{t.icoXxx}}"> 接线（没退回单字插值）',
    wired.length === 8, wired.length + '/8');
  const imgTotal = (wxml.match(/<image[^>]*class="hub-ico-img"/g) || []).length;
  check('B-② hub.wxml 里 hub-ico-img 恰好 8 处（多一张少一张都判红）',
    imgTotal === 8, '实际 ' + imgTotal + ' 处');
  // 每个路径解析到真文件
  const resolved = ICON_KEYS.filter((k) => {
    const rel = hub[k];
    return typeof rel === 'string' && fs.existsSync(path.join(ROOT, rel));
  });
  check('B-③ 8 个 terms 路径都能解析到磁盘文件（写错一个字母 ⇒ 图标静默空白）',
    resolved.length === 8, resolved.length + '/8');
  // 单字回退侦测：hub-ico 块里不该再有 {{t.icoXxx}} 直接当文字渲染
  const nakedIco = (wxml.match(/<view class="hub-ico[^"]*">\{\{t\.ico\w+\}\}<\/view>/g) || []).length;
  check('B-④ 没有把 {{t.icoXxx}} 直接塞进 hub-ico 当文字（R758 前的单字形态）',
    nakedIco === 0, nakedIco + ' 处裸插值');

  console.log('\n===== C · 徽标面（5 键三处齐）=====');
  const termsSrcB = read(P.termsB);
  const mb = BADGE_KEYS.filter((k) => typeof hub[k] === 'string' && hub[k].length > 0);
  check('C-① 5 个徽标文案都在 terms.hub 里且非空', mb.length === 5, mb.length + '/5');
  const inJs = BADGE_KEYS.filter((k) => hubJs.indexOf(k + ': TERMS.hub.' + k) >= 0);
  check('C-② 5 个徽标都在 hub.js 的 t:{} 里登记（漏登记 ⇒ 空徽标）',
    inJs.length === 5, inJs.length + '/5');
  const inWxml = BADGE_KEYS.filter((k) => wxml.indexOf('t.' + k) >= 0);
  check('C-③ 5 个徽标都在 hub.wxml 里真引用（定义了不用 = 死文案）',
    inWxml.length === 5, inWxml.length + '/5');
  check('C-④ 5 个徽标文案在两份 i18n 里都出现（md5 一致由 hub-guide G5-1 另守）',
    BADGE_KEYS.every((k) => new RegExp(k + ": '").test(termsSrc) && new RegExp(k + ": '").test(termsSrcB)));

  console.log('\n===== D · 反恒真（证明上面判据抓得到漂移）=====');
  // 影子样本：把 src 路径改坏，B-③ 的解析逻辑必须判假
  const shadowWxml = wxml.replace('src="{{t.icoMaterial}}"', 'src="{{t.icoNotExist}}"');
  const shadowWired = /<image[^>]*class="hub-ico-img"[^>]*src="\{\{t\.icoMaterial\}\}"/.test(shadowWxml);
  check('D-① 影子样本：把 image src 改坏 ⇒ B-① 对 icoMaterial 的判定转 false',
    shadowWired === false, '影子判定 = ' + shadowWired);
  // 影子样本：裸插值形态必须被 B-④ 抓到
  const shadowNaked = '<view class="hub-ico hub-ico-card">{{t.icoCard}}</view>';
  const nakedRe = /<view class="hub-ico[^"]*">\{\{t\.ico\w+\}\}<\/view>/;
  check('D-② 影子样本：单字裸插值形态 ⇒ B-④ 判据转 true（抓得到回退）',
    nakedRe.test(shadowNaked) === true);
  // 影子样本：不存在的图标文件名必须被 A-① 抓到
  const shadowTerms = Object.assign({}, hub, { icoCard: '/images/hub/no_such_file.png' });
  const shadowMissing = typeof shadowTerms.icoCard === 'string'
    && size(path.join(ROOT, shadowTerms.icoCard)) < 100;
  check('D-③ 影子样本：坏路径 ⇒ A-① 的 missing 判定转 true',
    shadowMissing === true);

  console.log('\n===== M3 图标与徽标守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach((b) => console.log('   ❌ ' + b));
  process.exit(failN === 0 ? 0 : 1);
})();
