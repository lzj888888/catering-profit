// tools/check_import_batch_cache.js —— 「整批导入进度」本地续做守卫（R711）
//
// 为什么必须有它（L2 页面桩，不是 grep）：
//   R711 之前，导入页只把「一道菜的草稿」落盘，整批 rows + 粘贴原文全躺在页面 data 里。
//   而页面被销毁是**必现**路径：老板补了 5 道 → 想回 M3 看一眼 → 再点进来 ⇒ 页面重建 ⇒ 空。
//   代价不对称：已补完的 5 道云端已经有卡，可重新粘贴后每行都是 `saved:false`、
//   看着像一道都没做过 ⇒ 老板会再补一遍、同名的卡被重复建。
//
//   ⇒ 这个改动全部是「读存储 / 写存储」，静态守卫只能证明「代码里出现过 setStorageSync」，
//     证不了这四件真事：
//       ① 解析成功后**真的落了盘**（不是只在某个分支落）
//       ② saved 标记**跟着一起落盘**（这才是「不用重补」的依据，漏它就等于白做）
//       ③ 页面重建后**真的接得回来**，且 text / rows / 汇总都对得上
//       ④ 过期 / 结构坏 / 时间戳在未来 ⇒ 一律不恢复（fail-closed，绝不半信半疑恢复半张表）
//
// 判据全部跑**页面源码本身**（require subpkg/biz/card/import.js），不是副本。

'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/card/import.js');
const SRC = fs.readFileSync(PAGE, 'utf8');
const DI = require(path.join(ROOT, 'utils/dishImport.js'));
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ============ 页面桩 ============
const store = {};
const sent = [];
let toastMsgs = [];

function makeWx() {
  return {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
    removeStorageSync: (k) => { delete store[k]; },
    showToast: (o) => { toastMsgs.push((o && o.title) || ''); },
    showModal: () => {},
    navigateTo: () => {},
    navigateBack: () => {},
    pageScrollTo: () => {},
    setNavigationBarTitle: () => {},
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, platform: 'devtools' }),
    getNetworkType: () => {},
    cloud: {
      callFunction: (o) => {
        sent.push(o);
        const name = o && o.name;
        // getMaterial 回一份非空列表（否则原料库体检块会画「你还没有原料」，与本套件无关）
        const data = name === 'getMaterial' ? { list: [{ _id: 'm1', name: '牛肉' }] } : { list: [] };
        return Promise.resolve({ result: { code: 'SUCCESS', data } });
      },
    },
  };
}

function loadPage(mutate) {
  // ⚠️ 变异串一律按 LF 写（源码文件是 CRLF，不归一则 str.replace 静默不命中 ⇒
  //   变异体还是原样的代码，那条判据就白绿了 —— 这个坑本轮自己踩过一次）。
  const src = mutate ? mutate(SRC.replace(/\r\n/g, '\n')) : SRC;
  let cfg = null;
  const g = global;
  const bak = { Page: g.Page, getApp: g.getApp, wx: g.wx };
  g.Page = (c) => { cfg = c; };
  g.getApp = () => ({ globalData: { shop_id: 'shop_test', shopLoaded: true } });
  g.wx = makeWx();
  try {
    if (mutate) {
      const mod = { exports: {} };
      const dir = path.dirname(PAGE);
      const fakeRequire = (p) => require(/^[./]/.test(p) ? path.resolve(dir, p) : p);
      // eslint-disable-next-line no-new-func
      new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
        mod, mod.exports, fakeRequire, dir, PAGE
      );
    } else {
      delete require.cache[require.resolve(PAGE)];
      require(PAGE);
    }
  } finally {
    g.Page = bak.Page; g.getApp = bak.getApp; g.wx = bak.wx;
  }
  if (!cfg) throw new Error('页面桩没抓到 Page 配置');
  return cfg;
}

const CFG = loadPage(null);

/** 造一个独立页面实例（等价于「小程序重新创建这个页面」）。 */
function newPage() {
  const p = Object.assign({}, CFG);
  p.data = JSON.parse(JSON.stringify(CFG.data));
  p.setData = function (patch) {
    for (const k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) this.data[k] = patch[k]; }
  };
  return p;
}

async function withWx(fn) {
  const bakWx = global.wx;
  const bakApp = global.getApp;
  global.wx = makeWx();
  global.getApp = () => ({ globalData: { shop_id: 'shop_test', shopLoaded: true } });
  try { return await fn(); } finally { global.wx = bakWx; global.getApp = bakApp; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一份「真表」样本：表头 + 3 道菜（走 #162 修好后的列定位路径，售价能拿到）
const MENU = [
  '菜品名称\t菜品分类\t销售数量\t销售额\t单价',
  '耙牛肉\t卤味烧腊\t12\t816\t68',
  '卤肥肠\t卤味烧腊\t9\t540\t60',
  '毛肚\t荤菜\t4\t112\t28',
].join('\n');

(async () => {
  // ============ A 组：解析成功即落盘 ============
  console.log('\n===== A 解析成功 ⇒ 整批落盘（不是只有某一条分支才存） =====');
  for (const k of Object.keys(store)) delete store[k];
  const A = newPage();
  await withWx(async () => { A.onLoad(); await sleep(20); });
  ok('A-① 首次进页面：本地还没有批次（不是一进来就写空壳）',
    !store[DI.BATCH_CACHE_KEY], 'key=' + (store[DI.BATCH_CACHE_KEY] ? '有(红)' : '无'));

  await withWx(async () => { A.onParse(MENU); await sleep(10); });
  ok('A-② 解析出 3 道菜', (A.data.rows || []).length === 3, '行数=' + (A.data.rows || []).length);
  const c1 = store[DI.BATCH_CACHE_KEY];
  ok('A-③ 🔴 解析成功后真的落盘了（不是等老板点保存才存）', !!c1, c1 ? 'ts=' + c1.ts : '未落盘');
  if (c1) {
    ok('A-④ 落盘里带原文（老板回来能看到自己粘的是什么）',
      typeof c1.text === 'string' && c1.text.indexOf('耙牛肉') >= 0, 'text 长度=' + String(c1.text || '').length);
    ok('A-⑤ 落盘里带全部 3 行 + rawN（对账行才有分母）',
      Array.isArray(c1.rows) && c1.rows.length === 3 && Number(c1.rawN) === 4,
      'rows=' + (c1.rows || []).length + ' rawN=' + c1.rawN);
    ok('A-⑥ 落盘里带时间戳（否则没法判过期）', Number(c1.ts) > 0, 'ts=' + c1.ts);
  } else {
    ok('A-④ ~ A-⑥', false, '没有落盘，后续逐项无从判');
  }

  // ============ B 组：saved 标记必须跟着落盘（本轮的核心价值） ============
  console.log('\n===== B 「已补过」必须活得下来 —— 漏了它就等于让老板重补一遍 =====');
  // 模拟「这道菜真的在云端存上了」：getCostCard 回同名卡
  const B = newPage();
  await withWx(async () => { B.onLoad(); await sleep(20); });
  await withWx(async () => { B.onParse(MENU); await sleep(10); });
  await withWx(async () => {
    const origWx = global.wx;
    // 覆盖云端返回：getCostCard 回「耙牛肉」
    const bak = origWx.cloud.callFunction;
    origWx.cloud.callFunction = (o) => {
      if (o && o.name === 'getCostCard') {
        return Promise.resolve({ result: { code: 'SUCCESS', data: { list: [{ _id: 'c1', name: '耙牛肉' }] } } });
      }
      return bak(o);
    };
    try { await B.confirmSaved('耙牛肉'); await sleep(10); } finally { origWx.cloud.callFunction = bak; }
  });
  ok('B-① 核对上之后那一行被标 saved', !!B.data.rows.find((r) => r.name === '耙牛肉' && r.saved),
    (B.data.rows || []).map((r) => r.name + ':' + !!r.saved).join(','));
  const c2 = store[DI.BATCH_CACHE_KEY];
  ok('B-② 🔴 saved 标记**立刻**落盘了（不等下次解析，否则杀掉就丢）',
    !!c2 && Array.isArray(c2.rows) && c2.rows.some((r) => r.name === '耙牛肉' && r.saved),
    c2 ? (c2.rows || []).map((r) => r.name + ':' + !!r.saved).join(',') : '未落盘');

  // ============ C 组：页面重建后接得回来 ============
  console.log('\n===== C 模拟「回 M3 再进来」：整批 + 进度都要接得上 =====');
  const C = newPage();
  await withWx(async () => { C.onLoad(); await sleep(20); });
  ok('C-① 粘贴原文回来了', String(C.data.text || '').indexOf('耙牛肉') >= 0,
    'text 长度=' + String(C.data.text || '').length);
  ok('C-② 3 行都回来了', (C.data.rows || []).length === 3, '行数=' + (C.data.rows || []).length);
  ok('C-③ 🔴 已补过的那道**仍然标着已保存**（否则老板会重补、同名卡重复建）',
    !!(C.data.rows || []).find((r) => r.name === '耙牛肉' && r.saved),
    (C.data.rows || []).map((r) => r.name + ':' + !!r.saved).join(','));
  ok('C-④ 汇总行重新算出来了（不吃缓存里的旧串）',
    /共\s*3\s*道/.test(String(C.data.summaryText || '')), C.data.summaryText);
  ok('C-⑤ 对账行的分母沿用 rawN（4 行 ⇒ 粘贴 4 / 识别 3 / 跳过 1）',
    /4/.test(String(C.data.reconText || '')) && /3/.test(String(C.data.reconText || '')), C.data.reconText);
  ok('C-⑥ 🔴 有「这是上次那批」的说明，且说清已补 1 道 / 还剩 2 道',
    String(C.data.resumeTip || '').indexOf('上次') >= 0
    && String(C.data.resumeTip || '').indexOf('1') >= 0
    && String(C.data.resumeTip || '').indexOf('2') >= 0, C.data.resumeTip);
  ok('C-⑦ 恢复的行三色状态是**现算**的（status 非空、与 draft 对得上）',
    (C.data.rows || []).length > 0 && (C.data.rows || []).every((r) => !!r.status && !!r.statusText),
    (C.data.rows || []).map((r) => r.name + ':' + r.status).join(','));
  await withWx(async () => { C.onDismissResume(); });
  ok('C-⑧ 点一下能收起说明（不是永久挂一条横幅）', C.data.resumeTip === '', C.data.resumeTip);

  // ============ D 组：fail-closed ============
  console.log('\n===== D 过期 / 坏数据 / 时间在将来 ⇒ 一律不恢复 =====');
  const mkCache = (over) => Object.assign({
    text: MENU,
    rows: [{ name: '耙牛肉', price: '68.00', draft: { name: '耙牛肉', priceYuan: 68 }, saved: true }],
    rawN: 4,
    ts: Date.now(),
  }, over || {});

  // D-① 超过 7 天
  for (const k of Object.keys(store)) delete store[k];
  store[DI.BATCH_CACHE_KEY] = mkCache({ ts: Date.now() - 8 * 24 * 3600 * 1000 });
  const D1 = newPage();
  await withWx(async () => { D1.onLoad(); await sleep(20); });
  ok('D-① 超过 7 天 ⇒ 不恢复，且顺手把 key 删掉（否则坏 key 会被反复读）',
    (D1.data.rows || []).length === 0 && !store[DI.BATCH_CACHE_KEY],
    '行数=' + (D1.data.rows || []).length + ' key=' + (store[DI.BATCH_CACHE_KEY] ? '仍在(红)' : '已清'));

  // D-② rows 为空
  for (const k of Object.keys(store)) delete store[k];
  store[DI.BATCH_CACHE_KEY] = mkCache({ rows: [] });
  const D2 = newPage();
  await withWx(async () => { D2.onLoad(); await sleep(20); });
  ok('D-② rows 是空数组 ⇒ 不恢复（空壳没有恢复的意义）',
    (D2.data.rows || []).length === 0, '行数=' + (D2.data.rows || []).length);

  // D-③ 行里没有 draft 骨架
  for (const k of Object.keys(store)) delete store[k];
  store[DI.BATCH_CACHE_KEY] = mkCache({ rows: [{ name: '耙牛肉', price: '68.00' }] });
  const D3 = newPage();
  await withWx(async () => { D3.onLoad(); await sleep(20); });
  ok('D-③ 行缺 draft ⇒ 整批不恢复（绝不半信半疑恢复半张表）',
    (D3.data.rows || []).length === 0, '行数=' + (D3.data.rows || []).length);

  // D-④ 时间戳在未来（系统时间被改过）
  for (const k of Object.keys(store)) delete store[k];
  store[DI.BATCH_CACHE_KEY] = mkCache({ ts: Date.now() + 365 * 24 * 3600 * 1000 });
  const D4 = newPage();
  await withWx(async () => { D4.onLoad(); await sleep(20); });
  ok('D-④ 时间戳在将来 ⇒ 不恢复（否则「7 天后」永远算不到）',
    (D4.data.rows || []).length === 0, '行数=' + (D4.data.rows || []).length);

  // D-⑤ text 不是字符串
  for (const k of Object.keys(store)) delete store[k];
  store[DI.BATCH_CACHE_KEY] = mkCache({ text: 123 });
  const D5 = newPage();
  await withWx(async () => { D5.onLoad(); await sleep(20); });
  ok('D-⑤ text 不是字符串 ⇒ 不恢复（结构不对就当没有）',
    (D5.data.rows || []).length === 0, '行数=' + (D5.data.rows || []).length);

  // ============ E 组：不许把好的覆盖成坏的 ============
  console.log('\n===== E 空批次 / 解析失败**不许**覆盖掉上一批 =====');
  for (const k of Object.keys(store)) delete store[k];
  const E = newPage();
  await withWx(async () => { E.onLoad(); await sleep(20); E.onParse(MENU); await sleep(10); });
  const before = JSON.stringify(store[DI.BATCH_CACHE_KEY] || {});
  // 再粘一张「套餐明细」（会被体检拒收 ⇒ rows 空）
  await withWx(async () => {
    E.onParse('套餐\t单品名称\n耙牛肉\t牛肉');
    await sleep(10);
  });
  ok('E-① 被体检拒收时 rows 清空', (E.data.rows || []).length === 0, '行数=' + (E.data.rows || []).length);
  ok('E-② 🔴 但**本地那批没被覆盖**（空批次不落盘，否则老板手滑一次旧活全没）',
    JSON.stringify(store[DI.BATCH_CACHE_KEY] || {}) === before,
    '覆盖前长度=' + before.length + ' 现在=' + JSON.stringify(store[DI.BATCH_CACHE_KEY] || {}).length);

  // ============ F 组：docs / 接线 ============
  console.log('\n===== F 接线与单源 =====');
  ok('F-① 键与有效期走 dishImport 单源（不在页面里另写字符串）',
    /DI\.BATCH_CACHE_KEY/.test(SRC) && !/['"]DISH_IMPORT_BATCH['"]/.test(SRC),
    '页面内裸写键字符串=' + (/['"]DISH_IMPORT_BATCH['"]/.test(SRC) ? '有(红)' : '无'));
  ok('F-② 四处进度变化点都接了落盘（解析 / 改价 / 改品类 / 标已保存）',
    (SRC.match(/this\.persistBatch\(\)/g) || []).length >= 4,
    'persistBatch 调用 ' + (SRC.match(/this\.persistBatch\(\)/g) || []).length + ' 处');
  ok('F-③ 恢复入口在 onLoad 里被真调用（不是死方法）',
    /onLoad\(\)\s*\{[\s\S]{0,200}this\.restoreBatch\(\)/.test(SRC), '见 onLoad');
  ok('F-④ 提示条在 wxml 里真渲染并绑了收起（不是只有 data 字段）',
    /wx:if="\{\{resumeTip\}\}"/.test(fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/import.wxml'), 'utf8'))
    && /bindtap="onDismissResume"/.test(fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/import.wxml'), 'utf8')),
    '见 import.wxml');

  // ============ G 组：变异回灌（判据有分辨力） ============
  console.log('\n===== G 变异回灌：改坏了必须点名 =====');
  const mkPage = (cfg) => {
    const p = Object.assign({}, cfg);
    p.data = JSON.parse(JSON.stringify(cfg.data));
    p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
    return p;
  };

  // G-① 去掉「标已保存后落盘」⇒ B-② 必须不成立
  const M1 = loadPage((s) => s.replace(
    '      // 🔴 R711：saved 标记必须立刻落盘 —— 它就是「老板不用重补」的唯一依据\n      this.persistBatch();\n',
    ''
  ));
  for (const k of Object.keys(store)) delete store[k];
  const M1p = mkPage(M1);
  await withWx(async () => { M1p.onLoad(); await sleep(20); M1p.onParse(MENU); await sleep(10); });
  await withWx(async () => {
    const origWx = global.wx;
    const bak = origWx.cloud.callFunction;
    origWx.cloud.callFunction = (o) => (o && o.name === 'getCostCard'
      ? Promise.resolve({ result: { code: 'SUCCESS', data: { list: [{ _id: 'c1', name: '耙牛肉' }] } } })
      : bak(o));
    try { await M1p.confirmSaved('耙牛肉'); await sleep(10); } finally { origWx.cloud.callFunction = bak; }
  });
  ok('G-① 变异「标已保存后不落盘」⇒ 盘上的 saved 仍是 false（B-② 有分辨力）',
    !!M1p.data.rows.find((r) => r.name === '耙牛肉' && r.saved)
    && !(store[DI.BATCH_CACHE_KEY].rows || []).find((r) => r.name === '耙牛肉' && r.saved),
    '界面saved=' + !!M1p.data.rows.find((r) => r.name === '耙牛肉' && r.saved)
    + ' 盘上saved=' + !!(store[DI.BATCH_CACHE_KEY].rows || []).find((r) => r.name === '耙牛肉' && r.saved));

  // G-② 去掉 onLoad 里的恢复调用 ⇒ C-② 必须不成立
  const M2 = loadPage((s) => s.replace('    this.restoreBatch();\n', ''));
  for (const k of Object.keys(store)) delete store[k];
  const M2p = mkPage(M2);
  await withWx(async () => { M2p.onLoad(); await sleep(20); M2p.onParse(MENU); await sleep(10); });
  const M2q = mkPage(M2);   // 模拟重建
  await withWx(async () => { M2q.onLoad(); await sleep(20); });
  ok('G-② 变异「onLoad 不恢复」⇒ 重建后是空页（C-② 有分辨力）',
    (M2q.data.rows || []).length === 0, '行数=' + (M2q.data.rows || []).length);

  // G-③ 「空批次不许覆盖上一批」其实有**两道**独立防线，必须分开验 —— 首版混成一条，
  //   变异打在第二道上、而执行的路径根本没经过它 ⇒ 判据假红（代码是对的）。
  //   第一道：体检拒收 / 解析出 0 行时**直接 return，不调 persistBatch**（由 E-② 守）；
  //   第二道：persistBatch 自己 `if (!rows.length) return`（当前 UI 无路径能走到，
  //           是防「以后新增调用点忘了判空」的护栏）⇒ 用**直接调用**验它，别指望 UI 路径触发。
  const G3 = mkPage(CFG);
  for (const kk of Object.keys(store)) delete store[kk];
  await withWx(async () => { G3.onLoad(); await sleep(20); G3.onParse(MENU); await sleep(10); });
  const before3 = JSON.stringify(store[DI.BATCH_CACHE_KEY] || {});
  G3.setData({ rows: [] });
  await withWx(async () => { G3.persistBatch(); });
  ok('G-③ 第二道防线：persistBatch 自己对空批次早退（不覆盖上一批）',
    JSON.stringify(store[DI.BATCH_CACHE_KEY] || {}) === before3,
    '覆盖前后相同=' + (JSON.stringify(store[DI.BATCH_CACHE_KEY] || {}) === before3));

  // 变异：删掉早退 ⇒ 空批次真的会覆盖（证明 G-③ 不是恒真）
  const M3 = loadPage((x) => x.replace('    if (!rows.length) return;   // 空批次不落盘', '    // MUT'));
  const M3p = mkPage(M3);
  for (const kk of Object.keys(store)) delete store[kk];
  await withWx(async () => { M3p.onLoad(); await sleep(20); M3p.onParse(MENU); await sleep(10); });
  const before3b = JSON.stringify(store[DI.BATCH_CACHE_KEY] || {});
  M3p.setData({ rows: [] });
  await withWx(async () => { M3p.persistBatch(); });
  ok('G-③b 变异「删掉空批次早退」⇒ 真的被空壳覆盖（G-③ 有分辨力）',
    JSON.stringify(store[DI.BATCH_CACHE_KEY] || {}) !== before3b,
    '覆盖前后相同=' + (JSON.stringify(store[DI.BATCH_CACHE_KEY] || {}) === before3b));

  // G-④ 过期判断去掉 ⇒ D-① 必须不成立
  const M4 = loadPage((s) => s.replace('  if (now - ts > BATCH_TTL_MS) return false;', '  // MUT: 不判过期'));
  // 注意：isBatchFresh 在 DI 里，这里改页面源码没用 —— 直接对 DI 做行为验证
  const srcDi = fs.readFileSync(path.join(ROOT, 'utils/dishImport.js'), 'utf8');
  ok('G-④ 过期判据在单源里（DI.isBatchFresh），页面只调用不自己判',
    /DI\.isBatchFresh\(/.test(SRC) && !/BATCH_TTL_MS/.test(SRC),
    'DI调用=' + /DI\.isBatchFresh\(/.test(SRC) + ' 页面自判=' + /BATCH_TTL_MS/.test(SRC));
  void M4; void srcDi;

  // G-⑤ isBatchFresh 自身有分辨力（正样本全过、每种坏法各挡一次）
  const good = { text: 'x', rows: [{ name: 'a', draft: {} }], ts: 1000 };
  ok('G-⑤ 单源 isBatchFresh 正样本通过 / 六种坏法逐条挡下（判据不恒真）',
    DI.isBatchFresh(good, 2000) === true
    && DI.isBatchFresh(null, 2000) === false
    && DI.isBatchFresh({ text: '', rows: good.rows, ts: 1000 }, 2000) === false
    && DI.isBatchFresh({ text: 'x', rows: [], ts: 1000 }, 2000) === false
    && DI.isBatchFresh({ text: 'x', rows: [{ name: 'a' }], ts: 1000 }, 2000) === false
    && DI.isBatchFresh({ text: 'x', rows: good.rows, ts: 2000 + DI.BATCH_TTL_MS + 1 }, 2000) === false
    && DI.isBatchFresh({ text: 'x', rows: good.rows, ts: 3000 }, 2000) === false,
    'TTL=' + DI.BATCH_TTL_MS + 'ms');

  console.log('\n===== 整批导入进度续做守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  void toastMsgs; void sent; void TERMS;
  process.exit(failN === 0 ? 0 : 1);
})();
