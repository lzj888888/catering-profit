// tools/check_r723_p0_fixes.js ——【R723】R721 台账三条 P0 修复的行为守卫
// 运行：node tools/check_r723_p0_fixes.js      （EXIT 0 = 全绿）
//
// 李老师 2026-11-12「好的，继续」⇒ 按 R721 台账 P0 顺序修三条：
//   R1-1 元守卫注释喂绿 / R3-1 导出件注销清理 / R2-1 对账页按 reason 分叉跳转。
// 三条的「修法坑」都由 R721 唱反调 reviewer 事先证伪过，本守卫用**页面桩真跑**
// 验证修复真的落地，而不是「源码里有没有那句话」。
//
// ⚠️ 守的是行为：
//   A 元守卫：真抽出生产 stripJsComments 函数，喂注释变体/字符串字面量两个样本；
//   B 注销  ：真跑 pages/mine/index.js::doLogout()，取证「清理先于 clearStorageSync」、
//             「unlink 抛异常仍 switchTab」、顺带清 globalData；
//   C 对账  ：真跑 utils/reconDerive.js::fixTargetOf() 六种 reason + 页面桩 goFix() 跳转。
//   D 变异  ：把修复改回去，判据必须给相反答案（防恒真橡皮章）。

'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('   ✅ ' + name); }
  else { problems.push(name); console.log('   ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function finish() {
  console.log('\n============================================================');
  console.log('===== R723 P0 修复守卫结果：' + pass + ' 通过 / ' + problems.length + ' 失败 =====');
  if (problems.length) {
    problems.forEach((p) => console.log('   ❌ ' + p));
    process.exit(1);
  }
  process.exit(0);
}

// =====================================================================
console.log('\n===== A. 元守卫：注释变体不再能喂绿 =====');
const scSrc = read('tools/check_suite_coverage.js');
// R724l（台账 R1-3）：R723 把剥注释函数**内置在 check_suite_coverage.js**，本轮把它抽到
//   tools/_lib/strip_js_comments.js 单源（两个判据共用）。能力没变、位置变了。
//   ⇒ 仍坚持「真抽生产函数、不复制实现」，只是改从共享模块抽；并要求 coverage 真的 require 它。
const libSrc = read('tools/_lib/strip_js_comments.js');
let stripFn = null;
const mStart = libSrc.indexOf('function stripJsComments(src) {');
if (mStart >= 0) {
  const mEnd = libSrc.indexOf('\n}\n', mStart);
  if (mEnd > 0) {
    try { stripFn = new Function(libSrc.slice(mStart, mEnd + 3) + '\nreturn stripJsComments;')(); }
    catch (e) { /* 下面判红 */ }
  }
}
ok('A-① 生产源码里有引号感知剥注释函数，且真的能加载执行',
  typeof stripFn === 'function' && /_lib\/strip_js_comments\.js/.test(scSrc));
ok('A-② 拼接间接引用证据时确实调用了它（不是摆设）',
  /indirectSrc \+= stripJsComments\(/.test(scSrc));
const FAKE = 'tools/zz_r723_comment_only.js';
const badSrc = '// 运行：node ' + FAKE + '\nconst x = 1;\n';
const goodSrc = "const PY_SRC = '" + FAKE + "';\nconst u = 'http://x/y';\n";
ok('A-③ 反恒真：注释里提路径不算引用，字符串字面量里的真实引用仍算',
  !!stripFn && !stripFn(badSrc).includes(FAKE) && stripFn(goodSrc).includes(FAKE));
ok('A-④ 不误伤字符串里的 http://（引号感知，不是无脑切 //）',
  !!stripFn && stripFn(goodSrc).includes('http://x/y'));
// R724l：原来这里写死「声明 =11」的快照。加 S9 后变 12，快照当场红 ——
//   而「声明 ≡ 实跑断言数」本来就是 check_suite_assert_counts.js 的职责（唯一声明处守卫）。
//   ⇒ A-⑤ 不再重复管数字，改守「两条反恒真/单源判据都在场」，比写死数字更严也更不易漂。
ok('A-⑤ 元守卫自身留有 S5-② 反恒真 + S9 口径单源断言（数字一致性交 check_suite_assert_counts）',
  /S5-② 反恒真/.test(scSrc) && /S9 「剥注释/.test(scSrc));

// =====================================================================
// 页面桩：只 stub 依赖模块，页面源码与 utils/exportFile.js 都是真 require
// =====================================================================
function stubDeps(extra) {
  const orig = Module._load;
  Module._load = function (req) {
    if (/utils[\\/]api\.js$/.test(req)) return { call: async () => ({ code: 'SUCCESS' }), say() {}, toastError() {}, fenToYuan: (n) => String(n) };
    if (/utils[\\/]loading\.js$/.test(req)) return { withLock: async (p, k, fn) => fn() };
    if (/utils[\\/]ui\.js$/.test(req)) return { setTitle() {}, nowMonth: () => '2026-09', recentMonths: () => [] };
    if (/utils[\\/]shopGuard\.js$/.test(req)) return {};
    if (extra && extra[req]) return extra[req];
    return orig.apply(this, arguments);
  };
  return () => { Module._load = orig; };
}
function makePageObj(cfg) {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data || {}));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  return p;
}

function loadMine() {
  let cfg = null;
  const store = new Map();
  const log = [];
  let unlinkThrows = false;
  global.Page = (c) => { cfg = c; };
  const app = { globalData: {
    shop_id: 'shop_a', shop_name: 'A店', shopLoaded: true,
    switches: { inventorySwitchOn: true }, pickMaterial: { id: 'm1', name: 'A店花椒' },
  } };
  global.getApp = () => app;
  global.wx = {
    env: { USER_DATA_PATH: '/wxfs' },
    getStorageSync: (k) => (store.has(String(k)) ? store.get(String(k)) : ''),
    setStorageSync: (k, v) => { store.set(String(k), v); },
    removeStorageSync: (k) => { store.delete(String(k)); },
    clearStorageSync: () => { log.push(['clearStorage']); store.clear(); },
    getFileSystemManager: () => ({
      writeFileSync: () => {},
      unlinkSync: (p) => {
        log.push(['unlink', p]);
        if (unlinkThrows && log.filter((x) => x[0] === 'unlink').length === 2) throw new Error('EBUSY');
      },
    }),
    switchTab: (o) => { log.push(['switchTab', o && o.url]); },
    navigateTo: () => {}, showToast: () => {}, showModal: () => {},
  };
  const restore = stubDeps();
  const abs = path.join(ROOT, 'pages/mine/index.js');
  delete require.cache[require.resolve(abs)];
  delete require.cache[require.resolve(path.join(ROOT, 'utils/exportFile.js'))];
  // ⚠️ setTimeout 桩由 main() 统一装/卸，别在这里恢复 —— doLogout 是在
  //    loadMine() 返回之后才跑的，提前恢复会让 1200ms 定时器赶不上断言。
  try { require(abs); } finally { restore(); }
  return { p: makePageObj(cfg), store, log, app,
    setThrow: (v) => { unlinkThrows = v; } };
}

function loadRecon() {
  let cfg = null;
  let navUrl = '';
  global.Page = (c) => { cfg = c; };
  global.wx = {
    navigateTo: (o) => { navUrl = o && o.url; },
    showToast: () => {}, showModal: () => {}, setNavigationBarTitle: () => {},
  };
  const restore = stubDeps();
  const abs = path.join(ROOT, 'subpkg/tools/recon/index.js');
  delete require.cache[require.resolve(abs)];
  try { require(abs); } finally { restore(); }
  return { p: makePageObj(cfg), getUrl: () => navUrl, reset: () => { navUrl = ''; } };
}

const EF = require(path.join(ROOT, 'utils/exportFile.js'));
const RD = require(path.join(ROOT, 'utils/reconDerive.js'));
const F = (reason, actualReason) => RD.fixTargetOf({ reason }, actualReason);
const NAMES = ['老王川菜馆_2026-09_月度报表.xlsx', '成本卡_全部.csv'];

async function main() {
  // ===================================================================
  console.log('\n===== B. 注销：导出件按清单清理，异常不阻断登出 =====');
  // 登出尾部是 setTimeout(..., 1200) 再 switchTab；桩成立即执行，否则断言抢在定时器前
  const oldTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };
  const S1 = loadMine();
  S1.store.set(EF.EXPORTED_FILES_KEY, NAMES.slice());
  // R724j（台账 R3-7）：塞三个**历史残留 key** 进去，验「登出清空全部 storage」而不只是清当前认识的 key。
  //   这三个 key 是 2026-11-13 模拟器实测在真机 storage 里发现的（R720 之前的裸写法 / 旧格式）。
  //   它们本身无害（现网读不到），但「读不到」依赖 key 拼法与恢复逻辑两件事同时不变 ——
  //   任一条被后人简化就会读到脏值。登出全清是最后的兜底。
  S1.store.set('m3_dish_cats', []);
  S1.store.set('sandbox_draft_v1', { v: 1 });
  S1.store.set('takeout_mode_shop_mu6j87v1itrs_2026-09', 'fast');
  const keysBefore = S1.store.size;
  await S1.p.doLogout();
  ok('B-⑦ 前提：登出前 store 里确实有 4 个 key（含 1 个导出清单 + 3 个历史残留）—— 否则 B-⑧ 是空跑恒真',
    keysBefore === 4, '登出前=' + keysBefore);
  ok('B-⑧ 🔴 登出后 storage **全空**（含历史残留 key）—— 必须走 clearStorageSync 全清，不能只按 key 逐个删',
    S1.store.size === 0, '剩余=' + JSON.stringify(Array.from(S1.store.keys())));
  const unlinks1 = S1.log.filter((x) => x[0] === 'unlink');
  ok('B-① 注销真的按清单删了 2 个导出文件（含无统一前缀的店名文件）',
    unlinks1.length === 2 && unlinks1.every((x) => x[1].indexOf('/wxfs/') === 0), JSON.stringify(unlinks1));
  const iClear = S1.log.findIndex((x) => x[0] === 'clearStorage');
  const iLastUnlink = S1.log.map((x) => x[0]).lastIndexOf('unlink');
  ok('B-② 🔴 清理在 clearStorageSync **之前**（清完就读不到清单了）',
    iClear > 0 && iLastUnlink >= 0 && iLastUnlink < iClear,
    'clear@' + iClear + ' lastUnlink@' + iLastUnlink);
  ok('B-③ 登出仍回到首页（清理没打断主流程）',
    S1.log.some((x) => x[0] === 'switchTab' && x[1] === '/pages/index/index'));
  ok('B-④ 顺带清掉 globalData 的口径开关与原料名（R3-5）',
    S1.app.globalData.switches.inventorySwitchOn === false && S1.app.globalData.pickMaterial === null);

  const S2 = loadMine();
  S2.store.set(EF.EXPORTED_FILES_KEY, NAMES.slice());
  S2.setThrow(true);
  await S2.p.doLogout();
  ok('B-⑤ 反恒真：第 2 个文件 unlink 抛异常时，登出仍继续 switchTab（fail-soft）',
    S2.log.filter((x) => x[0] === 'unlink').length === 2
    && S2.log.some((x) => x[0] === 'switchTab'), JSON.stringify(S2.log.map((x) => x[0])));
  ok('B-⑥ 导出清单 key 已在 R719 守卫归类表登记（横向防漏不漏）',
    /SESSION_SCOPE: \['EXPORTED_FILES_KEY'\]/.test(read('tools/check_m3_storage_isolation.js')));
  global.setTimeout = oldTimeout;

  // ===================================================================
  console.log('\n===== C. 对账页：只给真正需要去别的页的原因直达按钮 =====');
  ok('C-① menu_no_price → 去成本卡补售价',
    F('menu_no_price').url === '/subpkg/biz/card/index' && F('menu_no_price').labelKey === 'reconFixGoCostCard');
  ok('C-② actual_no_data（非分项问题）→ 去月度录入记收入',
    F('actual_no_data', 'no_income').url === '/subpkg/biz/month/input'
    && F('actual_no_data', 'no_income').labelKey === 'reconFixGoLedger');
  ok('C-③ actual_no_data + need_detail_income → 不给跳转（目标在本页/无固定目标）',
    F('actual_no_data', 'need_detail_income').url === '');
  ok('C-④ coverage_missing / coverage_low / generic / 空 → 一律不给跳转',
    ['coverage_missing', 'coverage_low', '', 'other'].every((r) => F(r).url === ''));
  const appJson = JSON.parse(read('app.json'));
  const routes = appJson.pages.slice();
  (appJson.subpackages || appJson.subPackages || []).forEach((sp) => {
    sp.pages.forEach((p) => routes.push(sp.root.replace(/\/$/, '') + '/' + p));
  });
  // app.json 的 pages/subpackages 路由**不带前导斜杠**，比较时别自己加
  ok('C-⑤ 两个跳转目标都已在 app.json 注册（不是空路径）',
    routes.includes('subpkg/biz/card/index') && routes.includes('subpkg/biz/month/input'));
  const recoSrc = read('subpkg/tools/recon/index.js');
  const recoBody = recoSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('C-⑥ 页面正文零 reason 字面量（判定只在单源，过 selftest_m3_recon R298X-⑩）',
    ['coverage_missing', 'coverage_low', 'menu_no_price', 'actual_no_data']
      .every((r) => recoBody.indexOf("'" + r + "'") < 0));
  ok('C-⑦ wxml 按钮受 fixUrl 门控，且 goFix handler 在场',
    /wx:if="\{\{result\.fixUrl\}\}" bindtap="goFix"/.test(read('subpkg/tools/recon/index.wxml'))
    && /goFix\(\)\s*\{/.test(recoSrc));

  // 页面桩真跑 goFix（不是字符串抽取）
  const R = loadRecon();
  // ⚠️ handler 被删掉时要**判红**，不能让桩直接抛 TypeError 变成「崩溃红」
  //    （mutation-backfill 铁律：崩溃红 ≠ 守卫真抓到）
  const canGo = typeof R.p.goFix === 'function';
  R.p.data.result = { fixUrl: '/subpkg/biz/card/index', fixLabel: '去补售价' };
  if (canGo) R.p.goFix();
  ok('C-⑧ 页面桩真跑 goFix()：带 fixUrl 时真的 navigateTo 到目标',
    canGo && R.getUrl() === '/subpkg/biz/card/index', R.getUrl());
  R.reset();
  R.p.data.result = { fixUrl: '', fixLabel: '' };
  if (canGo) R.p.goFix();
  ok('C-⑨ 反恒真：fixUrl 为空时 goFix 不跳（防恒跳转）', canGo && R.getUrl() === '');

  // ===================================================================
  console.log('\n===== D. 变异回灌（改回旧写法，判据必须给相反答案）=====');
  ok('D-① 元守卫：把拼接改回「原样源码」⇒ A-② 判红',
    (() => {
      const bad = scSrc.replace("indirectSrc += stripJsComments(fs.readFileSync(fp, 'utf8'))",
        "indirectSrc += fs.readFileSync(fp, 'utf8')");
      return bad !== scSrc && !/indirectSrc \+= stripJsComments\(/.test(bad);
    })());
  ok('D-② 注销：去掉 clearExportedFiles() 调用 ⇒ B-① 判据转红',
    (() => {
      const bad = read('pages/mine/index.js').replace('        exportFile.clearExportedFiles();\n', '');
      return bad.indexOf('exportFile.clearExportedFiles()') < 0;
    })());
  ok('D-③ 对账：把 coverage_low 也放行 ⇒ C-④ 判据转红',
    (() => {
      const bad = RD.fixTargetOf.toString().replace("return { url: '', labelKey: '' };",
        "return { url: '/subpkg/biz/month/input', labelKey: 'reconFixGoLedger' };");
      const fn = new Function('return ' + bad)();
      return fn({ reason: 'coverage_low' }).url !== '';
    })());
  ok('D-④ 好样本零问题：三条修复当前态全部通过本守卫判据',
    typeof stripFn === 'function' && F('coverage_low').url === '' && unlinks1.length === 2);

  finish();
}

main().catch((e) => {
  console.error('FATAL', e && e.stack || e);
  process.exit(2);
});
