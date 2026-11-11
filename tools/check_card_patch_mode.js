// tools/check_card_patch_mode.js —— 「补价模式」（R708）页面行为守卫
//
// 为什么需要它（L2 页面桩，不是 grep）：
//   R708 往成本卡编辑页加了第三个显示状态 `lean`：从批量导入「去补价」进来时，
//   页面只留 菜名 + 原料行 + 售价 + 吸底保存。这个改动**全部是 wxml 上的 wx:if**，
//   静态守卫只能证明「条件写着」，证不了：
//     ① 进来时真的进了这个状态（而不是 patchMode 永远为 false 的死分支）
//     ② 普通新建 / 编辑态**没有**被误伤（这才是最贵的错：一刀切会把正常建卡也砍成空页）
//     ③ 逃生口真的能来回切（不然精简态是死胡同）
//     ④ 本地「专业」偏好不会把精简态当场破掉
//     ⑤ **隐藏 ≠ 清空**：被收起的损耗率/分类/核算模式必须仍在保存载荷里
//
// 判据全部跑**页面源码本身**（require subpkg/biz/card/edit.js），不是副本；
// 变异回灌用 `new Function` 内存重载，不落盘（见 F 组）。

'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/card/edit.js');
const SRC = fs.readFileSync(PAGE, 'utf8');
const TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;

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
    setStorageSync: (k, v) => { store[k] = v; },
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
        // 统一按 api.js 的剥壳契约回：result.code === 'SUCCESS' 才算成功
        return Promise.resolve({
          result: {
            code: 'SUCCESS',
            data: {
              list: [],
              shop_id: 'shop_test',
              total_cost_fen: 0, gross_profit_fen: 0, gross_margin_pct: 0,
              unit_cost_fen: 0, reverse_price_fen: 0,
              quota: null,
            },
          },
        });
      },
    },
  };
}

/** 加载页面源码（可选：先做文本变异）。返回 Page 配置。 */
function loadPage(mutate) {
  const src = mutate ? mutate(SRC) : SRC;
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
  if (!cfg) throw new Error('页面桩没抓到 Page 配置（源码里没有 Page({...})？）');
  return cfg;
}

const CFG = loadPage(null);

/** 造一个独立页面实例：深拷贝 data + 真合并的 setData。wx 在调用期间挂回 global。 */
function newPage() {
  const p = Object.assign({}, CFG);
  p.data = JSON.parse(JSON.stringify(CFG.data));
  p.setData = function (patch) {
    for (const k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) this.data[k] = patch[k]; }
  };
  return p;
}

/** 在 wx 桩就位的前提下跑一段（handler 里会直接摸全局 wx）。
 *  🔴 getApp 也必须一起挂：`inputModeKey()` 走 `getApp().globalData.shop_id`，
 *     漏挂会让 `loadInputMode` 的 try/catch 静默吞掉 ReferenceError ⇒ 恒回 null
 *     （首跑就踩到：D-② 与 F-② 假红，因为「偏好」根本没被读到，不是代码的问题）。 */
async function withWx(fn) {
  const bakWx = global.wx;
  const bakApp = global.getApp;
  global.wx = makeWx();
  global.getApp = () => ({ globalData: { shop_id: 'shop_test', shopLoaded: true } });
  try { return await fn(); } finally { global.wx = bakWx; global.getApp = bakApp; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一份最小可用草稿（buildDraftCard 的产物形态：两行手工行、单价空着等老板补）
function makeDraft() {
  return {
    name: '耙牛肉',
    category: '烧菜',
    priceYuan: 68,
    lossRate: '5',
    is_draft: true,
    lines: [
      { input_type: 2, material_id: '', material_name: '牛肉', qty: '300', qty_unit: '克',
        price_unit: '克', unit_price_yuan: '', yield_rate: '80', line_kind: 'main' },
      { input_type: 2, material_id: '', material_name: '调料', qty: '1', qty_unit: '份',
        price_unit: '份', unit_price_yuan: '', yield_rate: '100', line_kind: 'main' },
    ],
  };
}

// ============ A 组：进得来 ============
console.log('\n===== A 从「去补价」进来，真的进补价模式 =====');
let A = null;
(async () => {
  // 每次 onLoad 前清空本地偏好，避免上一场景污染
  for (const k of Object.keys(store)) delete store[k];
  store[require(path.join(ROOT, 'utils/dishImport.js')).DRAFT_PREFILL_KEY] = makeDraft();
  A = newPage();
  await withWx(async () => { A.onLoad({ from_draft: '1' }); await sleep(20); });

  ok('A-① `patchMode` 真的被置位（不是永远 false 的死分支）', A.data.patchMode === true, 'patchMode=' + A.data.patchMode);
  ok('A-② `lean` 随之成立（页面进入精简态）', A.data.lean === true, 'lean=' + A.data.lean);
  ok('A-③ `patchFull` 初值 false（默认不展开，否则等于没精简）', A.data.patchFull === false, 'patchFull=' + A.data.patchFull);
  ok('A-④ 保存后出口文案是「返回导入，继续下一道」（不是「返回列表」）',
    A.data.backLabel === TERMS.card.backToImport, A.data.backLabel);
  ok('A-⑤ 强制 novice（老板本地若记着「专业」，精简态会被高级项当场破掉）',
    A.data.inputMode === 'novice', 'inputMode=' + A.data.inputMode);
  ok('A-⑥ 草稿真被吃进原料行（补价模式不许把预填弄丢）',
    (A.data.lines || []).length >= 2 && A.data.lines.some((l) => l.material_name === '牛肉'),
    '行数=' + (A.data.lines || []).length + ' / ' + (A.data.lines || []).map((l) => l.material_name).join(','));
  ok('A-⑦ 草稿读完即删（否则下次手动新建会被这张草稿污染）',
    !store[require(path.join(ROOT, 'utils/dishImport.js')).DRAFT_PREFILL_KEY],
    '暂存键 ' + (store[require(path.join(ROOT, 'utils/dishImport.js')).DRAFT_PREFILL_KEY] ? '仍在(红)' : '已清'));
  ok('A-⑧ 菜名/售价按草稿预填（补价模式的前提是「其余都已填好」）',
    A.data.name === '耙牛肉' && Number(A.data.priceYuan) === 68,
    'name=' + A.data.name + ' price=' + A.data.priceYuan);

  // ============ B 组：不许误伤正常路径 ============
  console.log('\n===== B 普通新建 / 编辑态**不许**进补价模式（最贵的错就是一刀切） =====');
  for (const k of Object.keys(store)) delete store[k];
  const B1 = newPage();
  await withWx(async () => { B1.onLoad({}); await sleep(20); });
  ok('B-① 普通新建：patchMode 为 false', B1.data.patchMode === false, 'patchMode=' + B1.data.patchMode);
  ok('B-② 普通新建：lean 为 false（全功能页，一个控件都不许少）', B1.data.lean === false, 'lean=' + B1.data.lean);
  ok('B-③ 普通新建：出口仍是「返回列表」', B1.data.backLabel === TERMS.card.backToList, B1.data.backLabel);

  const B2 = newPage();
  await withWx(async () => { B2.onLoad({ card_code: 'c_1', from_draft: '1' }); await sleep(20); });
  ok('B-④ 🔴 编辑态**即使带了 from_draft 也不进补价模式**（编辑要用卡里真实数据，草稿会被静默丢弃）',
    B2.data.patchMode === false && B2.data.lean === false,
    'patchMode=' + B2.data.patchMode + ' lean=' + B2.data.lean);

  // ============ C 组：逃生口 ============
  console.log('\n===== C 逃生口能来回切（否则精简态是死胡同） =====');
  await withWx(async () => { A.onLeanToggle(); });
  ok('C-① 点一次「展开完整设置」⇒ 退出精简态、patchFull 置位',
    A.data.lean === false && A.data.patchFull === true,
    'lean=' + A.data.lean + ' patchFull=' + A.data.patchFull);
  await withWx(async () => { A.onLeanToggle(); });
  ok('C-② 再点一次「收起」⇒ 回到精简态', A.data.lean === true && A.data.patchFull === false,
    'lean=' + A.data.lean + ' patchFull=' + A.data.patchFull);
  const C3 = newPage();
  await withWx(async () => { C3.onLoad({}); await sleep(20); C3.onLeanToggle(); });
  ok('C-③ 🔴 非补价模式下点它**不会**把页面变精简（lean 恒由 patchMode 把关）',
    C3.data.lean === false && C3.data.patchFull === true,
    'lean=' + C3.data.lean + ' patchFull=' + C3.data.patchFull);

  // ============ D 组：偏好不得破精简态 ============
  console.log('\n===== D 本地「专业」偏好不许破掉精简态（但也不能把偏好整个废掉） =====');
  for (const k of Object.keys(store)) delete store[k];
  store['card_input_mode_shop_test'] = 'pro';
  store[require(path.join(ROOT, 'utils/dishImport.js')).DRAFT_PREFILL_KEY] = makeDraft();
  const D1 = newPage();
  await withWx(async () => { D1.onLoad({ from_draft: '1' }); await sleep(20); });
  ok('D-① 🔴 记着「专业」⇒ 补价模式仍强制 novice（否则高级项一铺开，精简态当场失效）',
    D1.data.inputMode === 'novice', 'inputMode=' + D1.data.inputMode);

  for (const k of Object.keys(store)) delete store[k];
  store['card_input_mode_shop_test'] = 'pro';
  const D2 = newPage();
  await withWx(async () => { D2.onLoad({}); await sleep(20); });
  ok('D-② 普通新建仍尊重「专业」偏好（偏好没被整个废掉 —— 这刀只切补价模式）',
    D2.data.inputMode === 'pro', 'inputMode=' + D2.data.inputMode);

  // ============ E 组：隐藏 ≠ 清空 ============
  console.log('\n===== E 隐藏 ≠ 清空：被收起的字段必须仍在保存载荷里 =====');
  // 在补价页里把三个「被 lean 收起」的字段改成非默认值，然后真跑 doSave 看送出去什么
  sent.length = 0;
  A.setData({
    lossRate: '7.5', category: '烧菜·招牌', calcMode: 'A', auxYuan: '1.20',
    lines: [
      { rid: 1, input_type: 2, material_id: '', material_name: '牛肉', qty: '300', qty_unit: '克',
        price_unit: '克', unit_price_yuan: '42', yield_rate: '80', line_kind: 'main', qtyUnitIdx: 0, priceUnitIdx: 0 },
    ],
  });
  await withWx(async () => { await A.doSave(); await sleep(10); });
  const saveCall = sent.filter((c) => c && c.name === 'saveCostCard').pop();
  const card = saveCall && saveCall.data && saveCall.data.card;
  ok('E-① 补价模式（精简态）保存真的发出了 saveCostCard', !!card,
    card ? 'name=' + card.name : '未发出 / toast=' + toastMsgs.slice(-2).join('|'));
  if (card) {
    ok('E-② 🔴 被收起的「损耗率」仍在载荷里（隐藏 ≠ 清空）',
      Number(card.loss_pct) === 7.5, 'loss_pct=' + card.loss_pct);
    ok('E-③ 🔴 被收起的「分类」仍在载荷里',
      String(card.category || '') === '烧菜·招牌', 'category=' + card.category);
    ok('E-④ 菜名/售价/原料行没被精简态弄丢',
      card.name === '耙牛肉' && Number(card.priceYuan) === 68
      && Array.isArray(card.lines) && card.lines.length === 1,
      'name=' + card.name + ' priceYuan=' + card.priceYuan + ' lines=' + (card.lines || []).length);
    // ⚠️ 载荷字段名沿用**前端名**（priceYuan / auxYuan / loss_pct），不是下划线式 ——
    //   首跑把 `price_yuan` / `aux_yuan` 当字段名，两个断言假红（代码没错，是判据写错）。
    ok('E-⑤ 被收起的「辅料分担」仍在载荷里',
      Number(card.auxYuan) === 1.2, 'auxYuan=' + card.auxYuan);
  } else {
    ok('E-② 载荷断言（无载荷时整组转红）', false, '拿不到 card 对象');
    ok('E-③ 同上', false); ok('E-④ 同上', false); ok('E-⑤ 同上', false);
  }

  // ============ F 组：变异回灌 ============
  console.log('\n===== F 变异回灌：判据有分辨力（改坏了必须点名） =====');
  // F-① 把 applyLean 派生式改成恒 false ⇒ A-② 必须不成立
  const M1 = loadPage((s) => s.replace(
    'lean: !!(this.data.patchMode && !this.data.patchFull)',
    'lean: false'
  ));
  ok('F-① 变异「lean 恒 false」⇒ 补价模式不再精简（判据会转红）',
    M1.data && M1.data.lean === false, '变异体 data.lean=' + (M1.data && M1.data.lean));

  // F-② 去掉「强制 novice」⇒ 记着 pro 时应变回 pro（证明 D-① 不是恒真）
  const M2 = loadPage((s) => s.replace(
    "inputMode: this.data.patchMode ? 'novice' : (this.loadInputMode() || 'novice')",
    "inputMode: this.loadInputMode() || 'novice'"
  ));
  for (const k of Object.keys(store)) delete store[k];
  store['card_input_mode_shop_test'] = 'pro';
  store[require(path.join(ROOT, 'utils/dishImport.js')).DRAFT_PREFILL_KEY] = makeDraft();
  const M2p = (() => {
    const p = Object.assign({}, M2);
    p.data = JSON.parse(JSON.stringify(M2.data));
    p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
    return p;
  })();
  await withWx(async () => { M2p.onLoad({ from_draft: '1' }); await sleep(20); });
  ok('F-② 变异「去掉强制 novice」⇒ 记着 pro 的机器上精简态被破（D-① 有分辨力）',
    M2p.data.inputMode === 'pro', '变异体 inputMode=' + M2p.data.inputMode);

  // F-③ 让普通新建也进补价模式 ⇒ B-① 应转红（证明 "来源标记" 真有把关）
  const M3 = loadPage((s) => s.replace(
    'if (!this.data.isEdit && q && q.from_draft) {',
    'if (!this.data.isEdit) {'
  ));
  const M3p = (() => {
    const p = Object.assign({}, M3);
    p.data = JSON.parse(JSON.stringify(M3.data));
    p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
    return p;
  })();
  for (const k of Object.keys(store)) delete store[k];
  await withWx(async () => { M3p.onLoad({}); await sleep(20); });
  ok('F-③ 变异「普通新建也进补价模式」⇒ B-① 会转红（来源标记有把关）',
    M3p.data.patchMode === true, '变异体 patchMode=' + M3p.data.patchMode);

  console.log('\n===== 补价模式页面行为守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(failN === 0 ? 0 : 1);
})();
