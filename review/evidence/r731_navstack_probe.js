// r731_navstack_probe.js —— 实测「返回箭头」根因：微信系统导航栏的返回箭头**只在页面栈深度 > 1 时出现**。
// 所以不靠截图（automator 截图不含导航栏），直接读 getCurrentPages().length，这是确定性判据。
//
// 三组对照：
//   A. reLaunch 到 hub（tabBar 页，栈深必然 1）→ 基线，应无箭头
//   B. 从 hub 用 navigateTo 进 card/index（正常点击路径）→ 若栈深 2，微信必给箭头
//   C. reLaunch 直接落 card/index（模拟「分享卡片 / 最近使用」落地）→ 若栈深 1，必无箭头 ⇒ 孤岛
//
// 用法：node review/evidence/r731_navstack_probe.js [wsEndpoint]
const a = require('miniprogram-automator');
const WS = process.argv[2] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mp;

async function ev(fn, arg, tries) {
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return await mp.evaluate(fn, arg); } catch (e) { if (i === n - 1) throw e; await sleep(1200); }
  }
}

// 栈快照：深度 + 路由链。深度是「有没有返回箭头」的唯一决定因素。
const stack = () => ev(() => {
  const ps = getCurrentPages();
  return { depth: ps.length, routes: ps.map((p) => p.route) };
});

async function waitRoute(x, n) {
  for (let i = 0; i < (n || 20); i++) {
    const s = await stack().catch(() => null);
    if (s && s.routes[s.routes.length - 1] === x) return s;
    await sleep(800);
  }
  return stack().catch(() => null);
}

const out = [];
function rec(tag, s, expectArrow) {
  const arrow = s && s.depth > 1;
  out.push({ tag, depth: s && s.depth, routes: s && s.routes, arrow, expectArrow });
  console.log(
    tag + ' ⇒ 栈深=' + (s ? s.depth : '?') +
    ' 系统返回箭头=' + (arrow ? '有' : '无') +
    ' | ' + (s ? s.routes.join(' → ') : '?')
  );
}

(async () => {
  mp = await a.connect({ wsEndpoint: WS });

  // ---------- A. hub（tabBar 页）----------
  await ev(() => { wx.reLaunch({ url: '/pages/m3/hub', fail: () => {} }); return 1; }).catch(() => {});
  await sleep(4000);
  rec('A 配方 hub（tabBar 首页）', await waitRoute('pages/m3/hub'), false);

  // ---------- B. hub --navigateTo--> card/index（正常点击路径）----------
  try { await mp.navigateTo('/subpkg/biz/card/index'); } catch (e) { console.log('B navigateTo 失败: ' + e.message); }
  const sB = await waitRoute('subpkg/biz/card/index');
  rec('B hub→菜品成本毛利（正常点击）', sB, true);

  // ---------- C. 孤岛：直接落到 card/index（分享/最近使用场景）----------
  await sleep(800);
  await ev(() => { wx.reLaunch({ url: '/subpkg/biz/card/index', fail: () => {} }); return 1; }).catch(() => {});
  await sleep(4500);
  const sC = await waitRoute('subpkg/biz/card/index');
  rec('C 直接落地菜品成本毛利（分享/最近使用）', sC, false);

  // ---------- 结论 ----------
  const B = out.find((x) => x.tag.startsWith('B'));
  const C = out.find((x) => x.tag.startsWith('C'));
  console.log('\n========== 结论 ==========');
  console.log('B 正常点击路径栈深 = ' + (B && B.depth) + ' ⇒ 系统箭头 ' + (B && B.arrow ? '有（符合微信规则）' : '无（异常）'));
  console.log('C 孤岛落地栈深 = ' + (C && C.depth) + ' ⇒ 系统箭头 ' + (C && C.arrow ? '有' : '无（孤岛：无任何返回出口）'));
  console.log('\n判读：');
  if (B && B.depth > 1 && C && C.depth === 1) {
    console.log('  · 正常点击路径本应有系统箭头 ⇒ 李老师看到的「没箭头」不是这条路径，');
    console.log('    而是从分享卡片 / 最近使用 / 微信重启恢复到子页面（栈深 1）进去的。');
    console.log('  · 这类「孤岛页」在全仓所有分享落地页都存在（m1 month/result、m2 sandbox/index、m3 card/index）。');
  } else if (B && B.depth === 1) {
    console.log('  · 正常点击路径栈深就是 1 ⇒ 确实是页面结构本身的问题，需查跳转方式。');
  }
  console.log(JSON.stringify({ probe: 'r731', at: new Date().toISOString(), out }, null, 1));
  await mp.disconnect().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('PROBE_ERROR ' + e.message); process.exit(2); });
