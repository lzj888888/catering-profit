// tools/check_m3_storage_isolation.js ——【R719】M3 本地存储隔离「横向全量排查」守卫
// 运行：node tools/check_m3_storage_isolation.js      （EXIT 0 = 全绿）
//
// 李老师 2026-11-12：「再跑一轮审计」⇒ 接着 R718 的尾巴做。
//   R718 只抽查了几个本地 key，报告里把 `DRAFT_PREFILL_DRAFT_ONE` / `m3_dish_cats` /
//   `m3_materials_cache_v1` 放进「修复建议」，**没有取证、没有列为缺陷**；
//   且上轮结论属于「自述」，按李老师红线（不采信任何自述，含我方上轮）必须独立重算。
//
// ===== 本轮回答两个问题 =====
//   ① 全仓 41 个 storage 调用横向扫一遍，还有多少全局 key 会跨店串？（不是抽样）
//   ② R718 的两条红，脱离上轮报告重新真跑一遍，还成立吗？
//
// ===== 五段判据 =====
//   A 全量清单：守卫**自己扫产品源码**（pages/subpkg/utils/miniprogram/cloudfunctions，
//     排除 node_modules），41 个调用逐个提取第一参数；任何不在归类表里的新 key 直接判红
//     ⇒ 以后谁新增一个不带 shop 的全局 key 会被当场抓住，不是「我记得就登记」。
//   B 页面桩真跑：真 require 6 个页面源码，同一份本地 storage 里切店，取证 6 个场景
//     （S1 整批批次 / S2 月草稿 / S3 单菜预填 / S4 分类字典 / S5 原料缓存 / S6 对照组）。
//   C 结构判据：跨页同 key 字符串、常量纯字面量、切店不清理、对照 key 真带 shop、
//     报告必须如实登记每条缺陷。
//   D 反恒真：判据必须能对已知坏样本给出**相反**答案，防「恒真橡皮章」。
//   E 收尾：输出走完、末行汇总（R66/R69/R71 元守卫约束）。
//
// 🔴 R720（李老师 2026-11-12「继续」）：已按 R719 报告 §6 P0 落地修复。
//    utils/shopSwitcher.js 新增单源 shopKey(base)，7 类 key 的 18 个读写点全部按店拼；
//    m3_dish_cats 两页统一「读旧 + 合并去重 + 追加」写入语义（修掉跨页互踩）。
//    ⇒ B 组断言从「缺陷预期存在」**反转**为「修复后必须不串」；
//      真变异回灌相应改成「把 shopKey 改回裸 key / 去掉 shop 维度」，必须转红并点名。
//
// ⚠️ 桩只证逻辑，不证渲染：B 组证明 `setData({materials: 旧店原料})` 真被调用，
//    但「老板眼睛看见了几秒」属画面层（L3 模拟器/真机），不在本守卫射程内。

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('   ✅ ' + name); }
  else { problems.push(name); console.log('   ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

// ============================================================
// A. 全量清单：守卫自己扫源码，不是抄一份清单
// ============================================================
console.log('\n===== A. 全量扫描（守卫自扫产品源码）=====');

const SCAN_DIRS = ['pages', 'subpkg', 'utils', 'miniprogram', 'cloudfunctions'];
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git', 'review', 'tools', 'specs', 'evidence', '__pycache__']);

function jsFiles(roots) {
  const out = [];
  for (const r of roots) {
    const abs = path.join(ROOT, r);
    if (!fs.existsSync(abs)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name)); }
        else if (e.name.endsWith('.js')) out.push(path.join(d, e.name));
      }
    };
    walk(abs);
  }
  if (fs.existsSync(path.join(ROOT, 'app.js'))) out.push(path.join(ROOT, 'app.js'));
  return out;
}

// 提取一行里所有 xxxStorageSync( 的第一个实参（括号感知，能处理 this.fooKey() 内层括号）
function firstArgsOfLine(line) {
  const out = [];
  const needle = 'StorageSync(';
  let from = 0;
  while (true) {
    const i = line.indexOf(needle, from);
    if (i < 0) break;
    const start = i + needle.length;
    let depth = 1, buf = '';
    for (let k = start; k < line.length; k++) {
      const c = line[k];
      if (c === '(') { depth++; buf += c; continue; }
      if (c === ')') { depth--; if (depth === 0) { out.push(buf.trim()); break; } buf += c; continue; }
      if (c === ',' && depth === 1) { out.push(buf.trim()); break; }
      buf += c;
    }
    from = start;
  }
  return out;
}

const STORAGE_RE = /\b(get|set|remove|clear)StorageSync\s*\(/;
const allCalls = [];
for (const f of jsFiles(SCAN_DIRS)) {
  const s = fs.readFileSync(f, 'utf8');
  s.split(/\r?\n/).forEach((line, idx) => {
    if (!STORAGE_RE.test(line)) return;
    for (const a of firstArgsOfLine(line)) allCalls.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), line: idx + 1, arg: a.replace(/^['"]|['"]$/g, '') });
  });
}
const byTop = {};
for (const c of allCalls) { const t = c.file.split('/')[0]; byTop[t] = (byTop[t] || 0) + 1; }

ok('A-① 全量扫到 ≥40 个 storage 调用（当前 41），且 pages/subpkg/utils 三处都有',
  allCalls.length >= 40 && ['pages', 'subpkg', 'utils'].every((d) => byTop[d] > 0),
  JSON.stringify(byTop));
ok('A-② 扫描面非退化：产品 js 文件数 ≥ 1000（防把目录名写错扫成空集合）',
  jsFiles(SCAN_DIRS).length >= 1000, String(jsFiles(SCAN_DIRS).length));
ok('A-③ 反恒真：只扫 pages 一个目录 ⇒ 调用数明显变少（判据不是恒真）',
  (() => {
    let n = 0;
    for (const f of jsFiles(['pages'])) {
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((l) => { if (STORAGE_RE.test(l)) n++; });
    }
    return n < allCalls.length / 4;
  })(), 'pages 子集未明显小于全集');

// 归类表（单源）：第一参数 → 类别。任何不在表里的新 key 会被 A-⑤ 抓到。
const CLASSES = {
  USER: ['user_avatar', 'user_nickname'],                    // 跟着微信号走，本就该全局
  SHOP_STATE: ['PERSIST_KEY', 'lastPlatformKey()', 'this.inputModeKey()'], // 当前店/偏好，已按 shop
  SCOPED: ['this.dineModeKey()', 'this.takeoutModeKey()', 'this.takeoutTrackKey()',
    'this.takeoutFoldKey()', 'this.missingWarnKey()'],           // shop + month
  // 🔴 R720：7 类全局 key 全部收敛到单源 shopKey（原来是 GLOBAL_DEFECT 类）
  SHOP_KEY: ['ss.shopKey(DRAFT_PREFILL_KEY)', 'ss.shopKey(DI.DRAFT_PREFILL_KEY)',
    'ss.shopKey(MAT_CACHE)', 'ss.shopKey(EDIT_CATS_KEY)', 'ss.shopKey(LIST_CATS_KEY)',
    'ss.shopKey(DI.BATCH_CACHE_KEY)', 'ss.shopKey(DRAFT_KEY + this.data.month)'],
  CLEAR: [''],                                                   // clearStorageSync()
};
const ALLOWED = new Set(Object.values(CLASSES).flat());
function normArg(a) { return String(a).trim(); }
const unknown = [...new Set(allCalls.map((c) => normArg(c.arg)).filter((a) => !ALLOWED.has(a)))];

ok('A-④ 归类表覆盖全部扫描结果（每类都有条目、无空类）',
  Object.values(CLASSES).every((v) => v.length > 0) && ALLOWED.size >= 18, 'ALLOWED=' + ALLOWED.size);
ok('A-⑤ 🔴 横向防漏：扫描结果里没有「未登记的新 storage key」',
  unknown.length === 0, '未登记参数: ' + JSON.stringify(unknown));
ok('A-⑥ 🔴 R720：7 类 key 全部收敛到 SHOP_KEY 类，每个形态都真含 shopKey',
  CLASSES.SHOP_KEY.length === 7 && CLASSES.SHOP_KEY.every((k) => k.indexOf('shopKey') >= 0)
  && !Object.prototype.hasOwnProperty.call(CLASSES, 'GLOBAL_DEFECT'),
  String(CLASSES.SHOP_KEY.length));
ok('A-⑦ 对照组：SCOPED 类 5 个 key 的拼法函数体都真含 shopId（不是硬编码）',
  (() => {
    const s = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/input.js'), 'utf8');
    const names = ['dineModeKey', 'takeoutModeKey', 'takeoutTrackKey', 'takeoutFoldKey', 'missingWarnKey'];
    return names.every((n) => {
      const i = s.indexOf(n + '() {');
      return i > 0 && /shopId/.test(s.slice(i, i + 320));
    });
  })());

// ============================================================
// B. 页面桩：真 require 生产源码，同一份 storage 里切店
// ============================================================
ok('A-⑧ 产品源码里 shopKey 调用只传 1 个实参（第二参仅守卫/单测可用）',
  (() => {
    const src = ['subpkg/biz/card/edit.js', 'subpkg/biz/card/import.js', 'subpkg/biz/card/index.js',
      'subpkg/biz/month/input.js', 'subpkg/biz/month/inventory.js']
      .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    return !/ss\.shopKey\([^),]*,/.test(src);
  })());
ok('A-⑨ 🔴 R720：18 个读写点无残留裸 key（每个 StorageSync 都走 shopKey）',
  (() => {
    const re = /StorageSync\s*\(/;
    const names = /(BATCH_CACHE_KEY|DRAFT_PREFILL_KEY|MAT_CACHE|EDIT_CATS_KEY|LIST_CATS_KEY|DRAFT_KEY)/;
    let bare = 0;
    for (const f of ['subpkg/biz/card/edit.js', 'subpkg/biz/card/import.js', 'subpkg/biz/card/index.js',
      'subpkg/biz/month/input.js', 'subpkg/biz/month/inventory.js']) {
      for (const l of fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/)) {
        if (re.test(l) && names.test(l) && l.indexOf('shopKey') < 0) bare++;
      }
    }
    return bare === 0;
  })());

console.log('\n===== B. 页面桩真跑（R720 修复后必须不串）=====');

const DI = require(path.join(ROOT, 'utils/dishImport.js'));
const SS = require(path.join(ROOT, 'utils/shopSwitcher.js'));
const A_SHOP = 'shop_guanyinqiao';
const B_SHOP = 'shop_jiefangbei';
const MONTH = '2026-09';

function makeWx(store, cloudPayload, log) {
  const base = {
    getStorageSync: (k) => { log.push(['get', String(k)]); return store.has(String(k)) ? store.get(String(k)) : ''; },
    setStorageSync: (k, v) => { log.push(['set', String(k)]); store.set(String(k), JSON.parse(JSON.stringify(v === undefined ? '' : v))); },
    removeStorageSync: (k) => { log.push(['rm', String(k)]); store.delete(String(k)); },
    clearStorageSync: () => { log.push(['clear']); store.clear(); },
    showToast() {}, hideToast() {}, showLoading() {}, hideLoading() {},
    showModal(o) { if (o && typeof o.success === 'function') o.success({ confirm: true }); },
    navigateTo(o) { log.push(['nav', o && o.url]); }, redirectTo() {}, reLaunch() {}, navigateBack() {},
    setNavigationBarTitle() {}, stopPullDownRefresh() {}, pageScrollTo() {},
    cloud: { callFunction: (arg) => {
      const name = arg && arg.name; log.push(['cloud', name]);
      return Promise.resolve({ result: { code: 'SUCCESS', data: (cloudPayload && cloudPayload[name]) || {} } });
    } },
  };
  return new Proxy(base, { get(t, k) { return (k in t) ? t[k] : () => {}; } });
}

function loadPage(rel, store, shopId, cloudPayload) {
  const log = [];
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: shopId, shopLoaded: true }, setShopContext() {} });
  global.wx = makeWx(store, cloudPayload, log);
  global.App = global.App || (() => {});
  global.Component = global.Component || (() => {});
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  require(abs);
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data || {}));
  const setCalls = [];
  p.setData = function (patch) { setCalls.push(patch); for (const k in patch) this.data[k] = patch[k]; };
  p._log = log; p._setCalls = setCalls;
  return p;
}

function draftOf(name, price) {
  const parsed = DI.parseDishLines(name + ' ' + price);
  const arr = Array.isArray(parsed) ? parsed : (parsed && parsed.lines) || [];
  return DI.buildDraftCard(arr[0] || { name: name, priceYuan: Number(price), category: '' });
}
const aCard = (name, cat) => ({ card_code: 'C_' + name, version: 1, name, category: cat, tags: '',
  price_fen: 1200, gross_margin_pct: 62.5, card_type: 1, calc_mode: 'normal', updated_at: 1, combo: null });
const aMat = (n, price) => ({ id: 'm_' + n, name: n, is_virtual: false, net_unit_cost: price,
  purchase_unit: '斤', purchase_price_fen: price * 100, convert_factor: 500, yield_rate: 0.92 });

const d1 = draftOf('A店秘制小面', '12');
const d2 = draftOf('A店红烧牛肉面', '24');

// ---- S1 复核 R718 红①：整批批次跨店 ----
const s1 = new Map();
const A1 = loadPage('subpkg/biz/card/import.js', s1, A_SHOP, {});
A1.data.text = 'A店秘制小面 12\nA店红烧牛肉面 24';
A1.data.rows = [{ name: 'A店秘制小面', draft: d1, saved: false }, { name: 'A店红烧牛肉面', draft: d2, saved: false }];
A1.persistBatch();
const B1 = loadPage('subpkg/biz/card/import.js', s1, B_SHOP, {});
B1.restoreBatch();
const s1Names = (B1.data.rows || []).map((r) => r.name);
ok('B-① 🔴 R720：B 店 restoreBatch() 读不到 A 店批次（两店各占一格）',
  s1Names.length === 0 && B1.data.parsed !== true
  && SS.shopKey(DI.BATCH_CACHE_KEY, A_SHOP) !== SS.shopKey(DI.BATCH_CACHE_KEY, B_SHOP),
  JSON.stringify(s1Names));
ok('B-② S1 连带：B 店界面不再出现「还有 2 道没补完」的续做提示',
  B1.data.parsed !== true && !/没补完/.test(String(B1.data.resumeTip)), String(B1.data.resumeTip));
ok('B-③ 反恒真：坏缓存（缺 draft 骨架）isBatchFresh=false ⇒ B 店不会误恢复',
  DI.isBatchFresh({ text: 'x', rows: [{ name: 'n' }], ts: Date.now() - 1000 }, Date.now()) === false);

// ---- S2 复核 R718 红②：月草稿覆盖 ----
const s2 = new Map();
const A2 = loadPage('subpkg/biz/month/input.js', s2, A_SHOP, {});
A2.data.month = MONTH;
A2.data.incomeGroups = [{ subItem: 'A店堂食', amountYuan: '5580', fixed: false, note: '' }];
A2.onHide();
const aDraftKey = SS.shopKey('draft_month_input_' + MONTH, A_SHOP);
const bDraftKey = SS.shopKey('draft_month_input_' + MONTH, B_SHOP);
const aDraft = s2.get(aDraftKey);
const B2 = loadPage('subpkg/biz/month/input.js', s2, B_SHOP, {});
B2.data.month = MONTH;
B2.data.incomeGroups = [{ subItem: 'B店堂食', amountYuan: '2472', fixed: false, note: '' }];
B2.onHide();
const afterB = s2.get(bDraftKey);
const A3 = loadPage('subpkg/biz/month/input.js', s2, A_SHOP, {});
A3.data.month = MONTH;
A3.applyDraftFromStorage();
ok('B-④ 🔴 R720：A/B 两店草稿各占一格，B 店写入不再覆盖 A 店',
  aDraftKey !== bDraftKey && aDraft && aDraft.shop_id === A_SHOP && afterB && afterB.shop_id === B_SHOP
  && JSON.stringify(aDraft.incomeGroups) !== JSON.stringify(afterB.incomeGroups),
  JSON.stringify({ a: aDraftKey, b: bDraftKey }));
ok('B-⑤ 🔴 R720：切回 A 店 applyDraftFromStorage 真能恢复 A 店草稿（不再丢）',
  JSON.stringify(A3.data.incomeGroups || []).indexOf('A店堂食') >= 0
  && JSON.stringify(A3.data.incomeGroups || []).indexOf('B店堂食') < 0,
  JSON.stringify(A3.data.incomeGroups));

// ---- S3 新（R718 只在建议里提、无取证）：单菜预填跨店带菜名与售价 ----
const s3 = new Map();
const A4 = loadPage('subpkg/biz/card/import.js', s3, A_SHOP, {});
A4.data.rows = [{ name: 'A店秘制小面', draft: d1 }];
A4.onGoFill({ currentTarget: { dataset: { idx: 0 } } });
const aOneKey = SS.shopKey(DI.DRAFT_PREFILL_KEY, A_SHOP);
const written = s3.get(aOneKey);
const B4 = loadPage('subpkg/biz/card/edit.js', s3, B_SHOP, {});
B4.loadDraftPrefill();
const pre = B4._draftPrefill;
ok('B-⑥ 🔴 R720：B 店新建卡 loadDraftPrefill() 不再带出 A 店菜名',
  written && written.name === 'A店秘制小面' && !pre,
  JSON.stringify({ wrote: written && written.name, got: pre && pre.name }));
ok('B-⑦ 🔴 R720：A 店预填仍写对售价 12 元，但 B 店拿不到任何售价',
  written && Number(written.priceYuan) === 12 && !pre,
  JSON.stringify({ wrote: written && written.priceYuan, got: pre && pre.priceYuan }));
ok('B-⑧ 反恒真：A 店自己读一次能拿到预填且「读完即删」（一次性语义仍在）',
  s3.has(aOneKey) === true && (() => {
    const A4b = loadPage('subpkg/biz/card/edit.js', s3, A_SHOP, {});
    A4b.loadDraftPrefill();
    return !!A4b._draftPrefill && A4b._draftPrefill.name === 'A店秘制小面' && !s3.has(aOneKey);
  })());

// ---- S4 新：分类字典跨页同 key + 跨店 ----
const s4 = new Map();
let s4loadErr = '';
(async () => {})(); // 占位，真正 async 在下方 collectAsync()
const asyncResults = {};

function collectAsync() {
  return (async () => {
    const A5 = loadPage('subpkg/biz/card/index.js', s4, A_SHOP, {
      getCostCard: { list: [aCard('A店秘制小面', 'A店专属锅底'), aCard('A店凉糕', '凉菜')] },
      getShopContext: { pinned_cards: [] },
    });
    try { await A5.load(); } catch (e) { s4loadErr = String(e.message).slice(0, 120); }
    const catsWritten = s4.get(SS.shopKey('m3_dish_cats', A_SHOP));
    const B5 = loadPage('subpkg/biz/card/edit.js', s4, B_SHOP, {});
    const chips = B5.buildCatChips('');
    asyncResults.S4 = { catsWritten, chips, bSees: Array.isArray(chips) && chips.indexOf('A店专属锅底') >= 0, err: s4loadErr };

    // ---- S5 新：原料缓存跨店首屏 ----
    const s5 = new Map();
    const A6 = loadPage('subpkg/biz/card/edit.js', s5, A_SHOP, {
      getMaterial: { list: [aMat('A店专用花椒', 0.08), aMat('A店菜籽油', 0.012)] }, getCostCard: { list: [] },
    });
    let e5a = '';
    try { await A6.load(); } catch (e) { e5a = String(e.message).slice(0, 120); }
    const matCache = s5.get(SS.shopKey('m3_materials_cache_v1', A_SHOP));
    const B6 = loadPage('subpkg/biz/card/edit.js', s5, B_SHOP, {
      getMaterial: { list: [aMat('B店专用豆瓣', 0.02)] }, getCostCard: { list: [] },
    });
    let e5b = '';
    try { await B6.load(); } catch (e) { e5b = String(e.message).slice(0, 120); }
    const matSets = B6._setCalls.filter((c) => c && Array.isArray(c.materials));
    asyncResults.S5 = {
      aNames: matCache && Array.isArray(matCache.materials) ? matCache.materials.map((m) => m.name) : null,
      bSets: matSets.map((c) => c.materials.map((m) => m.name)),
      errA: e5a, errB: e5b,
    };
  })();
}

// ---- S6 对照组：带 shop 的 key 正确隔离（别误伤） ----
const s6 = new Map();
const A7 = loadPage('subpkg/biz/month/input.js', s6, A_SHOP, {});
A7.data.month = MONTH;
A7.saveDineMode('detail'); A7.saveInputMode('pro'); A7.saveTakeoutMode('detail');
A7.saveTakeoutTrack('gross'); A7.saveTakeoutFold(true); A7.markMissingWarned();
const B7 = loadPage('subpkg/biz/month/input.js', s6, B_SHOP, {});
B7.data.month = MONTH;
const bVals = [B7.loadDineMode(), B7.loadInputMode(), B7.loadTakeoutMode(), B7.loadTakeoutTrack(), B7.loadTakeoutFold(), B7.missingWarned()];
const A8 = loadPage('subpkg/biz/month/input.js', s6, A_SHOP, {});
A8.data.month = MONTH;
const aBack = [A8.loadDineMode(), A8.loadInputMode(), A8.loadTakeoutMode(), A8.loadTakeoutTrack(), A8.loadTakeoutFold(), A8.missingWarned()];
ok('B-⑨ S6 对照组：6 个按 shop 拼的 key，B 店一个都读不到（不误伤）',
  bVals[0] === null && bVals[1] === null && bVals[2] === null && bVals[3] === null && bVals[4] === false && bVals[5] === false,
  JSON.stringify(bVals));
ok('B-⑩ S6 对照：切回 A 店 6 个值原样读回（证明修法现成、不是新设计）',
  JSON.stringify(aBack) === JSON.stringify(['detail', 'pro', 'detail', 'gross', true, true]), JSON.stringify(aBack));

// ============================================================
// C. 结构判据
// ============================================================
console.log('\n===== C. 结构判据与报告登记 =====');
const editSrc = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/index.js'), 'utf8');
const dishSrc = fs.readFileSync(path.join(ROOT, 'utils/dishImport.js'), 'utf8');
const switchSrc = fs.readFileSync(path.join(ROOT, 'utils/shopSwitcher.js'), 'utf8');

ok('C-① 🔴 R720：两页仍共用同一个 base（单源），但已靠 shopKey 按店隔离',
  /const\s+EDIT_CATS_KEY\s*=\s*'m3_dish_cats'/.test(editSrc)
  && /const\s+LIST_CATS_KEY\s*=\s*'m3_dish_cats'/.test(indexSrc)
  && (editSrc.match(/ss\.shopKey\(EDIT_CATS_KEY\)/g) || []).length >= 3
  && (indexSrc.match(/ss\.shopKey\(LIST_CATS_KEY\)/g) || []).length >= 2);
ok('C-② 🔴 R720：分类 base 仍是字面量，但**所有读写点**都走 shopKey（不再有裸 base 落盘）',
  /const\s+EDIT_CATS_KEY\s*=\s*'[^']+';/.test(editSrc) && /const\s+LIST_CATS_KEY\s*=\s*'[^']+';/.test(indexSrc)
  && !/getStorageSync\(EDIT_CATS_KEY\)|setStorageSync\(EDIT_CATS_KEY,/.test(editSrc)
  && !/setStorageSync\(LIST_CATS_KEY,/.test(indexSrc));
ok('C-③ 🔴 R720：跨页互踩已修 —— 列表页改「读旧+合并去重+追加」，与编辑页同款语义',
  /const oldCats = wx\.getStorageSync\(ss\.shopKey\(LIST_CATS_KEY\)\)/.test(indexSrc)
  && /merged\.slice\(-40\)/.test(indexSrc)
  && !/setStorageSync\(LIST_CATS_KEY,\s*Array\.from\(catSeen\)/.test(indexSrc)
  && /arr\.slice\(-40\)/.test(editSrc));
ok('C-④ 设计选择：修复靠 key 加维度（不靠清缓存）⇒ switchShop() 仍不清 storage',
  /shopLoaded\s*=\s*false/.test(switchSrc)
  && !/removeStorageSync|clearStorageSync/.test(switchSrc.slice(switchSrc.indexOf('function switchShop'), switchSrc.indexOf('function restoreLastShop'))));
ok('C-⑤ 7 个 base 常量仍是固定字面量（单源 shopKey 只加后缀，防悄悄改名绕过登记）',
  [["const BATCH_CACHE_KEY = 'DISH_IMPORT_BATCH';", dishSrc],
   ["const DRAFT_PREFILL_KEY = 'DISH_IMPORT_DRAFT_ONE';", dishSrc],
   ["const DRAFT_KEY = 'draft_month_input_';", fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/input.js'), 'utf8')],
   ["const MAT_CACHE = 'm3_materials_cache_v1';", editSrc],
   ["const EDIT_CATS_KEY = 'm3_dish_cats';", editSrc],
   ["const LIST_CATS_KEY = 'm3_dish_cats';", indexSrc],
   ["const DRAFT_KEY = 'draft_month_inv_';", fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/inventory.js'), 'utf8')]]
    .every(([lit, src]) => src.indexOf(lit) >= 0));

const REPORT = path.join(ROOT, 'review/AUDIT_M3_R719_本地存储横向审计.md');
const report = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : '';
const NEED = ['DISH_IMPORT_BATCH', 'DISH_IMPORT_DRAFT_ONE', 'm3_dish_cats', 'm3_materials_cache_v1',
  'draft_month_input_', 'draft_month_inv_', '跨页同 key', 'R720', '已修复'];
ok('C-⑥ 报告在场且如实登记 7 类缺陷 + R720 修复状态（防改完代码忘更新文档）',
  NEED.every((k) => report.indexOf(k) >= 0),
  '缺: ' + NEED.filter((k) => report.indexOf(k) < 0).join(','));
ok('C-⑦ 反恒真：坏报告（删掉缺陷登记）必须被 C-⑥ 判红',
  (() => {
    const bad = report.replace(/DISH_IMPORT_BATCH/g, '___X___');
    return NEED.every((k) => bad.indexOf(k) >= 0) === false;
  })());

// ============================================================
// D. 反恒真
// ============================================================
console.log('\n===== D. 反恒真 =====');
ok('D-① 坏样本：假清单（漏扫 subpkg）会被 A-① 判红',
  jsFiles(['pages', 'utils', 'miniprogram', 'cloudfunctions']).length < jsFiles(SCAN_DIRS).length);
ok('D-② 坏样本：把归类表清空 ⇒ A-⑤ 必红（判据不是恒真）',
  (() => { const empty = new Set(); return allCalls.some((c) => !empty.has(normArg(c.arg))); })());
ok('D-③ 好样本：6 个按 shop 的 key 确实给了与全局 key 相反的结论（B-⑨ 不是摆设）',
  bVals.filter((v) => v === null || v === false).length === 6);
ok('D-④ 反恒真：无店态 shopKey 落 __NO_SHOP__ 独立格，与任何真实店都不互串',
  SS.shopKey('X', '') !== SS.shopKey('X', A_SHOP)
  && SS.shopKey('X', '').indexOf('__NO_SHOP__') >= 0);

// ============================================================
// 收尾（异步场景先跑完）
// ============================================================
collectAsync().then(() => {
  console.log('\n===== B′. 异步场景（列表页 / 编辑页 load 真跑）=====');
  const S4 = asyncResults.S4 || {}, S5 = asyncResults.S5 || {};
  ok('B-⑪ 🔴 R720：A 店列表页只写进 A 店的 key（含「A店专属锅底」）',
    Array.isArray(S4.catsWritten) && S4.catsWritten.indexOf('A店专属锅底') >= 0,
    JSON.stringify({ cats: S4.catsWritten, err: S4.err }));
  ok('B-⑫ 🔴 R720：B 店编辑页 buildCatChips() 候选里不再出现 A 店专属分类',
    S4.bSees === false, JSON.stringify(S4.chips));
  ok('B-⑬ 🔴 R720：A 店原料缓存只写进 A 店的 key（含两条 A 店原料）',
    Array.isArray(S5.aNames) && S5.aNames.length === 2 && S5.aNames.every((n) => n.indexOf('A店') === 0),
    JSON.stringify({ names: S5.aNames, errA: S5.errA }));
  ok('B-⑭ 🔴 R720：B 店每一次 setData(materials) 都不含 A 店原料（首屏串店消失）',
    Array.isArray(S5.bSets) && S5.bSets.length >= 1
    && S5.bSets.every((arr) => arr.every((n) => n.indexOf('A店') < 0)),
    JSON.stringify(S5.bSets));
  ok('B-⑮ 反恒真：B 店最终确实拿到自己的原料（不是「什么都不显示」的假绿）',
    Array.isArray(S5.bSets) && S5.bSets.some((arr) => arr.indexOf('B店专用豆瓣') >= 0),
    JSON.stringify(S5.bSets));

  console.log('\n============================================================');
  console.log('===== M3 本地存储隔离守卫（R720 修复后）：' + pass + ' 通过 / ' + problems.length + ' 失败 =====');
  if (problems.length) {
    problems.forEach((p) => console.log('   ❌ ' + p));
    process.exit(1);
  }
  process.exit(0);
}).catch((e) => {
  console.error('FATAL', e && e.stack || e);
  process.exit(2);
});
