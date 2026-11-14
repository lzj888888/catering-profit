// r731_verify_fixes.js —— 真机前行为验证（在真实模拟器里跑页面源码，读页面 data，不是读源码字符串）
//
// 验四件事：
//   A. 孤岛态：reLaunch 直接落 card/index ⇒ data.island 必须 true（否则老板没有出口）
//   B. 正常态：hub --navigateTo--> card/index ⇒ data.island 必须 false（否则多出一条没用的横杠）
//   C. 沙盘孤岛：reLaunch 落 sandbox/index ⇒ data.island 必须 true
//   D. 模板清除：新建卡 → 套用模板 → tplApplied=true 且 lines>1 → onClearTpl → lines 回到 1 行、tplApplied=false
//
// 用法：node review/evidence/r731_verify_fixes.js [ws://127.0.0.1:9420]
const a = require('miniprogram-automator');
const WS = process.argv[2] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mp;
let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' · ' + detail : '')); }
}
async function ev(fn, arg, tries) {
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return await mp.evaluate(fn, arg); } catch (e) { if (i === n - 1) throw e; await sleep(1200); }
  }
}
const route = async () => { try { return await ev(() => { const s = getCurrentPages(); return s.length ? s[s.length - 1].route : ''; }); } catch (e) { return ''; } };
async function waitRoute(x, n) {
  for (let i = 0; i < (n || 25); i++) { if ((await route()) === x) return true; await sleep(900); }
  return false;
}

(async () => {
  mp = await a.connect({ wsEndpoint: WS });

  // ---------- A. 孤岛态 card/index ----------
  console.log('\n===== A · 孤岛态（分享/最近使用落地）card/index =====');
  await ev(() => { wx.reLaunch({ url: '/subpkg/biz/card/index', fail: () => {} }); return 1; }).catch(() => {});
  await sleep(4500);
  const rA = await waitRoute('subpkg/biz/card/index');
  const dA = rA ? await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    return { depth: getCurrentPages().length, island: p.data.island, hasBarFn: typeof p.onIslandBack === 'function' };
  }).catch(() => null) : null;
  ok('A-① 栈深 = 1', dA && dA.depth === 1, JSON.stringify(dA));
  ok('A-② data.island = true（孤岛条渲染条件成立）', dA && dA.island === true, JSON.stringify(dA));
  ok('A-③ 页面有 onIslandBack 方法（点了真能回）', dA && dA.hasBarFn === true, JSON.stringify(dA));

  // ---------- B. 正常态 card/index ----------
  console.log('\n===== B · 正常点击（配方 hub → 菜品成本毛利）=====');
  await ev(() => { wx.reLaunch({ url: '/pages/m3/hub', fail: () => {} }); return 1; }).catch(() => {});
  await sleep(3500);
  await waitRoute('pages/m3/hub', 15);
  try { await mp.navigateTo('/subpkg/biz/card/index'); } catch (e) { console.log('  navigateTo: ' + e.message); }
  const rB = await waitRoute('subpkg/biz/card/index');
  const dB = rB ? await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    return { depth: getCurrentPages().length, island: p.data.island };
  }).catch(() => null) : null;
  ok('B-① 栈深 = 2（系统自带「←」）', dB && dB.depth === 2, JSON.stringify(dB));
  ok('B-② data.island = false（不渲染多余横杠，零干扰）', dB && dB.island === false, JSON.stringify(dB));

  // ---------- C. 沙盘孤岛 ----------
  console.log('\n===== C · 沙盘孤岛态（分享/最近使用落地）sandbox/index =====');
  await ev(() => { wx.reLaunch({ url: '/subpkg/tools/sandbox/index', fail: () => {} }); return 1; }).catch(() => {});
  await sleep(5000);
  const rC = await waitRoute('subpkg/tools/sandbox/index');
  const dC = rC ? await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    return { depth: getCurrentPages().length, island: p.data.island };
  }).catch(() => null) : null;
  ok('C-① 栈深 = 1 且 data.island = true', dC && dC.depth === 1 && dC.island === true, JSON.stringify(dC));

  // ---------- D. 模板套用 → 清除 ----------
  console.log('\n===== D · 模板套用后「清除模板」真的能清 =====');
  await ev(() => { wx.reLaunch({ url: '/subpkg/biz/card/index', fail: () => {} }); return 1; }).catch(() => {});
  await sleep(3500);
  try { await mp.navigateTo('/subpkg/biz/card/edit?card_code='); } catch (e) { console.log('  navigateTo edit: ' + e.message); }
  const rD = await waitRoute('subpkg/biz/card/edit');
  ok('D-① 进入新建成本卡页', rD, await route());

  if (rD) {
    // 等表单就绪
    for (let i = 0; i < 15; i++) {
      const ready = await ev(() => { const p = getCurrentPages().slice(-1)[0]; return p.data && p.data.loading === false; }).catch(() => false);
      if (ready) break;
      await sleep(900);
    }
    const before = await ev(() => {
      const p = getCurrentPages().slice(-1)[0];
      return { tplApplied: p.data.tplApplied, lines: (p.data.lines || []).length, name: p.data.name };
    }).catch(() => null);
    ok('D-② 初始未套用（tplApplied=false）', before && before.tplApplied === false, JSON.stringify(before));

    // 走**页面自己的** picker 处理器（等价于老板点选品类 → 点选这道菜），
    // ⚠️ 不要在 evaluate 里 require 业务模块：小程序 require 路径相对**页面文件**解析，
    //    evaluate 上下文没有模块基准路径 ⇒ 会抛 "module ... is not defined"（初版踩过）。
    const applied = await ev(() => {
      const p = getCurrentPages().slice(-1)[0];
      p.onName({ detail: { value: '鱼香肉丝' } });
      p.onPickTplCat({ detail: { value: '0' } });      // 第 1 个品类
      p.onPickTemplate({ detail: { value: '0' } });    // 该品类第 1 道菜
      return {
        tplApplied: p.data.tplApplied,
        tplName: p.data.tplAppliedName,
        lines: (p.data.lines || []).length,
        firstLine: (p.data.lines || [])[0] && p.data.lines[0].material_name,
        name: p.data.name,
      };
    }).catch((e) => ({ err: e.message }));
    ok('D-③ 套用后 tplApplied=true（出现了清除入口）', applied && applied.tplApplied === true, JSON.stringify(applied));
    ok('D-④ 套用后配料行 > 1（模板真填进去了）', applied && applied.lines > 1, JSON.stringify(applied));

    const nameBefore = applied && applied.name;

    // 直接调 onClearTpl（未填单价 ⇒ 不该弹确认框，直接清）
    const cleared = await ev(() => {
      const p = getCurrentPages().slice(-1)[0];
      p.onClearTpl();
      return { tplApplied: p.data.tplApplied, lines: (p.data.lines || []).length,
               name: p.data.name, calcMode: p.data.calcMode, batchOutput: p.data.batchOutput,
               blank: (p.data.lines || []).every((l) => !String(l.material_name || '').trim()) };
    }).catch((e) => ({ err: e.message }));
    ok('D-⑤ 清除后 tplApplied 归 false', cleared && cleared.tplApplied === false, JSON.stringify(cleared));
    ok('D-⑥ 清除后配料行回到 1 行且为空', cleared && cleared.lines === 1 && cleared.blank === true, JSON.stringify(cleared));
    ok('D-⑦ 清除后菜名保留（清除只动配料行，不动老板输的菜名）',
      cleared && cleared.name === nameBefore && !!nameBefore, 'before=' + nameBefore + ' after=' + (cleared && cleared.name));
    ok('D-⑧ 清除后模式/批量产出复位（防「整批料钱当一道菜」继续算错）',
      cleared && cleared.calcMode === 'A' && (!cleared.batchOutput || String(cleared.batchOutput) === ''), JSON.stringify(cleared));
  }

  console.log('\n============================================================');
  console.log('R731 修复行为验证：' + pass + ' 通过 / ' + fails.length + ' 失败');
  if (fails.length) fails.forEach((f) => console.log('  · ' + f));
  await mp.disconnect().catch(() => {});
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('VERIFY_ERROR ' + e.message); process.exit(2); });
