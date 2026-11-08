// tools/check_orphan_handler.js —— R630 「死功能」守卫（第 253 套件）
//
// 由来：2026-11-08 一天里连续撞到 5 次同一种病 ——
//   `onPin`（置顶）写完了、带乐观更新和失败回滚，**wxml 里一次都没绑过**；
//   老板点不到，`pinned_cards` 永远是空，而列表排序偏偏以它为先。
// 这类东西**比没做更浪费**：它让人以为已经有了，还在别处反复讨论要不要做。
//
// 判据：js 里的页面 handler（on*/go*/toggle*/do*），只要
//   ① 在对应 wxml 里完全没出现，且 ② js 内部也没人 `this.xxx(` 调用，
// 就是孤儿 —— 直接判红，要求「接上」或「删掉」，不许留着。
//
// 反恒真（防判据自己坏了）：
//   · 扫描面必须够大（≥30 个页面 / ≥200 个 handler），否则说明路径写错了 ⇒ 红；
//   · 白名单只允许「确实不是界面 handler」的极少数特例，且必须在下面写明理由。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }

// 生命周期 / 框架回调：本来就不由 wxml 绑定
const LIFECYCLE = new Set([
  'onLoad', 'onShow', 'onHide', 'onReady', 'onUnload', 'onPullDownRefresh',
  'onShareAppMessage', 'onShareTimeline', 'onReachBottom', 'onResize',
  'onTabItemTap', 'onPageScroll', 'onLaunch', 'onAddToFavorites', 'onSaveExitState',
]);

// 白名单：**只放"确实不是界面 handler"的**，每条必须写理由。
// （留空是常态；加东西之前先问自己"是不是该把它接上或删掉"）
const WHITELIST = new Set([
  // onPickTakeoutMode（M1 月录入 · 外卖「快速/明细」切换）
  //   现状：UI 已不直接绑它 —— 模式改由**口径**派生（毛额→明细 / 净额→快速，见 onPickTakeoutTrack）。
  //   但 R85 套件 A8c 仍钉着它（断言「切换时把 subsidy 搬过去」）⇒ **不能静默删**。
  //   保留并记账，待 A8c 的契约迁到 onPickTakeoutTrack 之后再删。这是**技术债，不是遗忘**。
  'onPickTakeoutMode',
]);

function walk(root, out) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) { walk(p, out); continue; }
    if (e.name.endsWith('.js') && fs.existsSync(p.slice(0, -3) + '.wxml')) out.push(p);
  }
  return out;
}

const files = [];
['subpkg', 'pages'].forEach((d) => {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p)) walk(p, files);
});

sec('扫描面（fail-closed：路径写错就红）');
ok('扫描到「js + wxml 同目录」的页面 ≥ 30 个', files.length >= 30, files.length + ' 个');

let totalHandlers = 0;
const orphans = [];
for (const js of files) {
  const src = fs.readFileSync(js, 'utf8');
  const wxml = fs.readFileSync(js.slice(0, -3) + '.wxml', 'utf8');
  // ⚠️ 用 exec 逐次取捕获组：`String.match` 带 /g 时只返回整串、拿不到第 1 组
  const names = new Set();
  const re = /^ {2}(?:async )?((?:on|go|toggle|do)[A-Z][A-Za-z0-9]*)\(/gm;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  totalHandlers += names.size;
  for (const n of names) {
    if (LIFECYCLE.has(n) || WHITELIST.has(n)) continue;
    if (wxml.indexOf(n) >= 0) continue;                        // ① wxml 有绑定
    if (src.indexOf('this.' + n + '(') >= 0) continue;         // ② js 内部有调用
    orphans.push({ js: path.relative(ROOT, js), name: n });
  }
}

ok('页面 handler 总数 ≥ 200（扫到的量级正常）', totalHandlers >= 200, totalHandlers + ' 个');

sec('孤儿 handler（js 有定义、wxml 没绑、js 内部也没人调）');
ok('孤儿数量 = 0', orphans.length === 0,
  orphans.length ? orphans.map((o) => o.js + '::' + o.name).join(' | ') : '零命中');

// 反恒真：把 LIFECYCLE 以外的判断去掉，必须能"造出"孤儿 —— 证明这套匹配真的会命中
const probe = '  onSomethingNobodyUses() { return 1; }';
const probeName = (probe.match(/^ {2}(?:async )?((?:on|go|toggle|do)[A-Z][A-Za-z0-9]*)\(/) || [])[1];
ok('判据非恒真：一个没人绑、没人调的方法必须被认出来', probeName === 'onSomethingNobodyUses', 'probe=' + probeName);

console.log('\n===== 死功能守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
