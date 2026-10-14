// tools/check_page_card_width.js —— 页面卡片宽度冲突守卫（R296c，2026-10-14）
//
// 为什么立这条（一次「改了几次没改对」的事故）：
//   `app.wxss` 第 10 行有一条**全局**规则 `.card { width: 48%; margin: 1%; }`
//   —— 它是给「首页九宫格」用的**半宽**卡片。任何**其它页面**只要复用了 `.card` 这个类名、
//   而自己 `.wxss` 里又**没有显式覆盖 width**，就会继承 `width: 48%` ⇒ 卡片只剩半宽 ⇒
//   卡片内 `.field`（display:flex）里的 `<text class="label">` 被右侧控件（min-width 200rpx）
//   挤到 ~1 字宽 ⇒ **一字一行 = 「竖版文字」**（用户原话「原来都是竖版的字体」）。
//
//   R296c 实证：`pages/sandbox/matrix` 与 `pages/sandbox/compare` **两页都中招**；
//   此前 round276 的修法是「加宽表格 `.td`」——**方向跑偏**（竖的是卡片里的 label，不是表格），
//   所以「改了几次没改成横版」。本次根治 = 改用唯一类名 `.mcard`（配 wxml 同步改）。
//
// 判据（fail-closed）：
//   A-① 全局 `.card` 的「半宽」定义必须在场（本守卫的前提；被删/改名 ⇒ 前提失效，判红提示重建）
//   A-② 任一页面 wxml 用了 `class="card"` ⇒ 该页同名 `.wxss` **必须**声明 `.card` 且含显式 `width`
//   A-③ 负样本互证：含 `class="card"` 但本页无 width 的样本必须被判红 ⇒ 判据非恒真
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
// 取某个类名规则体（要求属性行以类名开头，避免命中 .card-title / .mcard 等）
function ruleBody(css, cls) {
  const m = css.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp('(?:^|\\n)\\s*' + cls.replace('.', '\\.') + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
}

const appWxss = read(path.join(ROOT, 'app.wxss'));
const globalCard = ruleBody(appWxss, '.card');
check('A-① 全局 `.card` 半宽定义在场（width: 48% · 首页九宫格专用）',
  /width\s*:\s*48%/.test(globalCard), globalCard ? globalCard.trim().replace(/\s+/g, ' ').slice(0, 70) : '未找到 .card 定义');

const wxmls = walk(path.join(ROOT, 'pages'), [], (p) => /\.wxml$/.test(p));
const offenders = [];
for (const wf of wxmls) {
  const src = read(wf).replace(/<!--[\s\S]*?-->/g, '');   // 剥注释，防注释里出现 class="card" 误报
  if (!/class="card"/.test(src)) continue;
  const own = ruleBody(read(wf.replace(/\.wxml$/, '.wxss')), '.card');
  if (!/width\s*:/.test(own)) offenders.push(path.relative(ROOT, wf).replace(/\\/g, '/'));
}
check('A-② 用了 `class="card"` 的页面，其 wxss 必须显式覆盖 width（否则继承 48% ⇒ 卡片半宽 ⇒ 文字竖排）',
  offenders.length === 0, offenders.length ? '违规页：' + offenders.join(' | ') : '零违规（' + wxmls.length + ' 页已扫）');

const negWxml = '<view class="card">x</view>';
const negWxss = '.card { background:#fff; }';
const negHit = /class="card"/.test(negWxml) && !/width\s*:/.test(ruleBody(negWxss, '.card'));
check('A-③ 负样本（用 .card 但本页无 width）必被判红 ⇒ 判据非恒真', negHit, 'negHit=' + negHit);

console.log('\n===== 页面卡片宽度冲突守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
