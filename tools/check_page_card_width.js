// tools/check_page_card_width.js —— 全局「半宽卡片」雷区守卫（R296c 立 · R296d 反转为「必须缺席」）
//
// 事故复盘（一次「改了几次没改对」的真实事故）：
//   早期首页九宫格用**全局** `.card { width: 48%; margin: 1%; }`。
//   2026-10-14 矩阵页 / 对比页也复用了 `.card` 这个类名 ⇒ 静默继承半宽 ⇒
//   卡内 `.field`（display:flex）里的 `<text class="label">` 被右侧控件（min-width 200rpx）
//   挤到 ~1 字宽 ⇒ **中文逐字断行 = 「竖版文字」**（用户原话「原来都是竖版的字体」、
//   「改了几次没有改成横版」）。
//   round276 的修法是把表格 `.td` 加宽 —— **方向跑偏**（竖的是卡片里的 label，不是表格），
//   所以怎么改都不见效。
//
// R296c：两页改用**唯一类名** `.mcard`（配 wxml 同步改），先止血。
// R296d：进一步**拆雷** —— 实扫证明 `class="card"` / 组合类 `.card.hl`·`.card.net` /
//        动态绑定三种写法**全仓零用量**（首页早已改用 `hero-*` 体系），
//        遂把 `app.wxss` 里那三条 `.card*` 规则**删掉**。
//        ⇒ 本守卫的判据随之**反转为「必须缺席」**：只要全局再冒出一个精确 `.card`，
//          就是又埋了一颗「任何页面复用即竖排」的雷。
//
// 判据（fail-closed）：
//   A-① 全局样式表（app.wxss）里**不得**出现精确类名 `.card` 的规则
//        （`.card` / `.card.hl` / `.card,` 都算；`.card2`、`.card-title`、`.mcard` 不算）
//   A-② 页面层面的双保险：任一页面 wxml 用了 `class="card"` ⇒ 该页自己的 `.wxss`
//        **必须**声明 `.card` 且含显式 `width`（防「以为全局有、其实没有」的空样式）
//   A-③ 负样本互证：合成的「全局有半宽 .card」样本必须被 A-① 判红 ⇒ 判据非恒真
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
}
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }
function walk(dir, out, filter) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, out, filter);
    else if (filter(p)) out.push(p);
  }
  return out;
}
function stripComments(s) { return String(s || '').replace(/\/\*[\s\S]*?\*\//g, ''); }

// 取某个**精确**类名的规则体（要求选择器以该类名开头且后随 空白/{/./, ——
// 避免命中 `.card2` / `.card-title` / `.mcard`）。
function ruleBody(css, cls) {
  const m = stripComments(css).match(new RegExp('(?:^|\\n)\\s*' + cls.replace('.', '\\.') + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
}
// 全局是否存在**精确类名** `.card` 的规则（含 `.card.hl` / `.card,` 这类组合/并列写法）
function hasBareCardRule(css) {
  return /^\s*\.card(?=[\s.,{])/m.test(stripComments(css));
}

// ============ A 主判据 ============
const appWxss = read(path.join(ROOT, 'app.wxss'));
check('A-① 全局样式表零精确类名 `.card`（否则任何页面复用即继承半宽 ⇒ 卡片半宽 ⇒ 文字竖排）',
  !hasBareCardRule(appWxss),
  hasBareCardRule(appWxss)
    ? '🔴 app.wxss 仍存在 .card 规则（雷又埋回来了）'
    : 'app.wxss 已无 .card（R296d 拆雷完成）');

const wxmls = walk(path.join(ROOT, 'pages'), [], (p) => /\.wxml$/.test(p));
const offenders = [];
for (const wf of wxmls) {
  const src = stripComments(read(wf)).replace(/<!--[\s\S]*?-->/g, '');   // 剥注释，防注释里出现 class="card" 误报
  if (!/class="card"/.test(src)) continue;
  const own = ruleBody(read(wf.replace(/\.wxml$/, '.wxss')), '.card');
  if (!/width\s*:/.test(own)) offenders.push(path.relative(ROOT, wf).replace(/\\/g, '/'));
}
check('A-② 用了 `class="card"` 的页面，其 wxss 必须显式声明 `.card{width:…}`（防空样式 / 防再踩半宽）',
  offenders.length === 0, offenders.length ? '违规页：' + offenders.join(' | ') : '零违规（' + wxmls.length + ' 页已扫）');

// ============ A-③ 负样本互证（判据非恒真）============
const negGlobal = '.card { width: 48%; margin: 1%; }';
const negHit = hasBareCardRule(negGlobal) === true
  && hasBareCardRule('.card2 { width: 100%; }') === false
  && hasBareCardRule('.card-title { font-weight: 700; }') === false
  && hasBareCardRule('.mcard { width: auto; }') === false;
check('A-③ 负样本互证：只对精确 `.card` 判红，`.card2`/`.card-title`/`.mcard` 不误伤 ⇒ 判据非恒真',
  negHit, 'negHit=' + negHit);

console.log('\n===== 页面卡片宽度冲突守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
