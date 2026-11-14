// tools/check_island_back.js —— 孤岛页兜底返回守卫（R731）
//
// 【为什么要有这个守卫】
//   微信系统导航栏的「←」返回箭头**只在页面栈深度 > 1 时渲染**。页面被「直接落地」打开时
//   （① 点分享卡片 ② 从小程序「最近使用」进入 ③ 微信后台回收后恢复）栈深 = 1 ⇒ 没有箭头，
//   而页面自身若也没有出口 ⇒ 老板被困死，只能杀进程重进。
//   `utils/islandBack.js` 是判据单源，三个分享落地页（shareCard.PATH）都必须接上它。
//
// 【本守卫的判据分四层，缺一层就可能假绿】
//   A · 判据行为面：喂真 `getCurrentPages` 桩，验 need() 的三种取值（含 fail-closed）
//   B · 路由纯函数：homeOf 必须回**各自模块的家**，不能一律踢回核算 tab
//   C · 接线面（源码锁）：三页 js 真的调了 need()/goHome()，三页 wxml 真的有 island-bar
//   D · 反恒真：把判据改坏（need 恒返回 false）必须让 A 转红 —— 证明 A 不是恒真
//   E · 覆盖面：shareCard.PATH 的每个落地页都必须在 IRST 清单里（将来加 m4 漏接会被抓）
//
// 跑法：node tools/check_island_back.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);
const rd = (rel) => fs.readFileSync(P(rel), 'utf8');

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' · ' + detail : '')); }
}
function fail(name, detail) { fails.push(name); console.log('  ❌ ' + name + (detail ? ' · ' + detail : '')); }

// 落地页清单：kind → 页面文件（必须与 utils/shareCard.js::PATH 对齐，E 层会校验）
const LANDING = [
  { kind: 'm1', file: 'subpkg/biz/month/result',  home: '/pages/index/index' },
  { kind: 'm2', file: 'subpkg/tools/sandbox/index', home: '/pages/index/index' },
  { kind: 'm3', file: 'subpkg/biz/card/index',    home: '/pages/m3/hub' },
];

// ---------- A · 判据行为面 ----------
console.log('\n===== A · 判据行为面（feed 真 getCurrentPages 桩）=====');

// islandBack.need() 依赖全局 getCurrentPages，每次换桩都要清 require 缓存
function loadWithStack(depth, throwIt) {
  delete require.cache[require.resolve(P('utils/islandBack.js'))];
  global.getCurrentPages = throwIt
    ? () => { throw new Error('boom'); }
    : () => new Array(depth).fill({ route: 'x' });
  return require(P('utils/islandBack.js'));
}

try {
  // 栈深 1 ⇒ 孤岛（无上层可返回）
  const d1 = loadWithStack(1, false);
  ok('A-① 栈深 = 1 ⇒ need() = true（孤岛，必须显示兜底出口）', d1.need() === true, 'got ' + d1.need());

  // 栈深 2 ⇒ 有系统「←」⇒ 不该显示
  const d2 = loadWithStack(2, false);
  ok('A-② 栈深 = 2 ⇒ need() = false（正常点击路径，系统有「←」，零干扰）', d2.need() === false, 'got ' + d2.need());

  // 栈深 5 ⇒ 同上
  const d5 = loadWithStack(5, false);
  ok('A-③ 栈深 = 5 ⇒ need() = false（多层页面不误判成孤岛）', d5.need() === false, 'got ' + d5.need());

  // API 抛异常 ⇒ fail-closed（不显示，不误挡内容）
  const dX = loadWithStack(0, true);
  let threw = false; let val = null;
  try { val = dX.need(); } catch (e) { threw = true; }
  ok('A-④ getCurrentPages 抛异常 ⇒ need() = false 且不抛（fail-closed：宁可少显示不误挡）',
    threw === false && val === false, 'threw=' + threw + ' val=' + val);

  // 无全局 getCurrentPages（非页面环境）⇒ 同样 fail-closed
  const dN = loadWithStack(1, false);
  delete global.getCurrentPages;
  let threw2 = false; let val2 = null;
  try { val2 = dN.need(); } catch (e) { threw2 = true; }
  ok('A-⑤ 无 getCurrentPages 全局 ⇒ need() = false 且不抛（同上）',
    threw2 === false && val2 === false, 'threw=' + threw2 + ' val=' + val2);
} catch (e) {
  fail('A 组执行异常', e.message);
}

// ---------- B · 路由纯函数 ----------
console.log('\n===== B · homeOf 路由（回各自模块的家）=====');
try {
  const ib = loadWithStack(2, false);
  LANDING.forEach((L, i) => {
    ok('B-' + (i + 1) + ' homeOf(' + L.kind + ') = ' + L.home,
      ib.homeOf(L.kind) === L.home, 'got ' + ib.homeOf(L.kind));
  });
  ok('B-④ 未知 kind ⇒ 回落默认首页（不返回 undefined）',
    typeof ib.homeOf('zzz') === 'string' && ib.homeOf('zzz').length > 0, 'got ' + ib.homeOf('zzz'));
} catch (e) {
  fail('B 组执行异常', e.message);
}

// ---------- C · 接线面（源码锁）----------
console.log('\n===== C · 接线面（三页 js + wxml 真的接上了）=====');
LANDING.forEach((L, i) => {
  const js = rd(L.file + '.js');
  const wxml = rd(L.file + '.wxml');
  const n = i + 1;
  ok('C-' + n + 'a ' + L.file + '.js require 了 islandBack',
    /islandBack\s*=\s*require\([^)]*utils\/islandBack\.js/.test(js));
  ok('C-' + n + 'b ' + L.file + '.js 的 onShow 调 islandBack.need()',
    /onShow\s*\(\s*\)\s*\{[\s\S]{0,240}?islandBack\.need\(\)/.test(js));
  ok('C-' + n + 'c ' + L.file + '.js 的 onIslandBack 走 goHome(\'' + L.kind + '\')',
    new RegExp("onIslandBack\\s*\\(\\s*\\)\\s*\\{[^}]*goHome\\(\\s*'" + L.kind + "'\\s*\\)").test(js));
  ok('C-' + n + 'd ' + L.file + '.wxml 有 island-bar 且受 island 控制、点了调 onIslandBack',
    /class="island-bar"/.test(wxml) && /wx:if="\{\{island\}\}"/.test(wxml) && /bindtap="onIslandBack"/.test(wxml));
});

// ---------- D · 反恒真（把判据改坏，A 必须转红）----------
console.log('\n===== D · 反恒真（改坏判据必须被抓）=====');
{
  // 合成一个「need 恒返回 false」的坏模块，用它跑同样的 A-① 判据
  const src = rd('utils/islandBack.js').replace(
    /function need\(\) \{[\s\S]*?\n\}/,
    'function need() { return false; }'
  );
  const mutated = src !== rd('utils/islandBack.js');
  // 真跑坏模块：写到临时文件后 require
  const tmp = path.join(ROOT, '.islandback_mut_tmp.js');
  let badSays = null;
  try {
    fs.writeFileSync(tmp, src, 'utf8');
    delete require.cache[require.resolve(tmp)];
    global.getCurrentPages = () => [{ route: 'x' }];   // 栈深 1
    badSays = require(tmp).need();
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* 清不掉不阻断 */ }
  }
  ok('D-① 判据真的被替换了（替换点存在，不是空改）', mutated);
  ok('D-② 坏判据（need 恒 false）在栈深 1 时给出 false ⇒ A-① 会转红，证明 A 非恒真',
    badSays === false, 'got ' + badSays);
}

// ---------- E · 覆盖面（分享落地页一个都不能漏）----------
console.log('\n===== E · 覆盖面（shareCard.PATH 的落地页必须全在清单里）=====');
try {
  const shareSrc = rd('utils/shareCard.js');
  const paths = [];
  const re = /(?:m\d+)\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(shareSrc)) !== null) paths.push(m[1]);
  const pathBlock = paths.filter((p) => p.startsWith('/subpkg/') || p.startsWith('/pages/'));
  const covered = new Set(LANDING.map((L) => L.file));
  const missed = pathBlock.filter((p) => !covered.has(p.replace(/^\//, '')));
  ok('E-① shareCard 声明的 ' + pathBlock.length + ' 个落地页全部有孤岛兜底（清单未漏）',
    pathBlock.length > 0 && missed.length === 0, 'missed=' + JSON.stringify(missed));
  ok('E-② 清单里的页面文件都真实存在（防清单写着、文件被改名）',
    LANDING.every((L) => fs.existsSync(P(L.file + '.js')) && fs.existsSync(P(L.file + '.wxml'))));
} catch (e) {
  fail('E 组执行异常', e.message);
}

// ---------- 汇总 ----------
console.log('\n============================================================');
console.log('孤岛页兜底返回守卫结果：' + pass + ' 通过 / ' + fails.length + ' 失败');
if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  · ' + f)); }
process.exit(fails.length ? 1 : 0);
