// tools/check_snapshot_zero.js —— R712 · 版本页快照「0 不等于有值」守卫
//
// 李老师真机（2026-11-12）：「胖头鱼里面它这个版本有两个…但是底下那些采购价换算系数
// 出成率全都是零，只是一个花鲢一斤六块五。这个是有意设计，还是数据没导过来？」
//
// 答案：**是设计（手工录入行本来就没有档案采购价）＋ 一个显示 bug**。
//   saveCostCard/index.js 对手工行固定写 `purchase_price: 0, convert_factor: 0`
//   （注释：手工行无原料可查，5 字段按缺省值）。
//   而 version.js 原来判断写成 `!= null` 再转字符串 ⇒ 0 变成 "0.00" / "0"，
//   在 wxml 的 `wx:if="{{l.purchase_price}}"` 里**字符串为真** ⇒ 印出三个 0。
//
// 这个套件真跑 version.js 的 load()（页面桩 + mock getCardVersions），
// 因为「0 到底变成空串还是 "0.00"」只有真跑才知道 —— 静态 grep 判不出字符串化之后的真假。
//
// 运行：node tools/check_snapshot_zero.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/card/version.js');
const WXML = path.join(ROOT, 'subpkg/biz/card/version.wxml');
const TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
const api = require(path.join(ROOT, 'utils/api.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const SRC = fs.readFileSync(PAGE, 'utf8');
const W = fs.readFileSync(WXML, 'utf8');

// ---- 两行样本：一行手工录入（三字段全 0）、一行档案（有真值）----
function makeVersions() {
  return {
    list: [{
      version: 2, name: '胖头鱼', card_type: 1, specs: [], calc_mode: 'A',
      total_cost_fen: 1300, price_fen: 3800, created_at: 1762900000000,
      loss_rate: 0, aux_fen: 0, category: '卤菜', tags: '',
      lines: [
        {                                    // 手工录入行：就是老板看到的那三行 0
          material_id: '', material_name: '花鲢', quantity: '500', net_unit_cost: 26,
          line_net_cost_fen: 1300, input_type: 2, line_kind: 'main', group_name: '',
          line_type: 1, sub_card_ref: '', sub_version: 0,
          brand_spec: '', purchase_unit: '', purchase_price: 0, convert_factor: 0, yield_rate: 0,
        },
        {                                    // 档案行：三项都有真值，必须照常显示
          material_id: 'mat_1', material_name: '豆瓣酱', quantity: '50', net_unit_cost: 80,
          line_net_cost_fen: 400, input_type: 1, line_kind: 'main', group_name: '',
          line_type: 1, sub_card_ref: '', sub_version: 0,
          brand_spec: '郫县 500g', purchase_unit: '袋', purchase_price: 2400, convert_factor: 500, yield_rate: 92,
        },
      ],
    }],
  };
}

function loadPage(mutate) {
  const src = mutate ? mutate(SRC.replace(/\r\n/g, '\n')) : SRC;
  let cfg = null;
  const g = global;
  const bak = { Page: g.Page, wx: g.wx, getApp: g.getApp };
  g.Page = (c) => { cfg = c; };
  g.wx = { showToast: () => {}, showLoading: () => {}, hideLoading: () => {}, setNavigationBarTitle: () => {} };
  g.getApp = () => ({ globalData: { shop_id: 'shop_test', shopLoaded: true } });
  try {
    const mod = { exports: {} };
    const dir = path.dirname(PAGE);
    const fakeRequire = (p) => require(/^[./]/.test(p) ? path.resolve(dir, p) : p);
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
      mod, mod.exports, fakeRequire, dir, PAGE
    );
  } finally {
    g.Page = bak.Page; g.wx = bak.wx; g.getApp = bak.getApp;
  }
  if (!cfg) throw new Error('页面桩没抓到 Page 配置');
  return cfg;
}

function newPage(cfg) {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) {
    for (const k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) p.data[k] = patch[k]; }
  };
  return p;
}

/** 跑一次 load()，把 api.call 换成返回指定版本数据。 */
const toasts = [];
/** ⚠️ load() 执行期间 global.wx **必须**在位上：页面的 catch 会走 api.toastError → wx.showToast，
 *  而 loadPage 返回时已经把 wx 还原了。首版没挂回来 ⇒ 未捕获 TypeError，
 *  看起来像「页面代码坏了」，实际是桩的缺口。 */
async function runLoad(cfg, versions) {
  const origCall = api.call;
  const origEnsure = api.ensureShop;
  api.ensureShop = async () => ({ shop_id: 'shop_test' });
  api.call = async (name) => {
    if (name === 'getCardVersions') return versions;
    return {};
  };
  const p = newPage(cfg);
  const bakWx = global.wx;
  global.wx = {
    showToast: (o) => { toasts.push((o && o.title) || ''); },
    showLoading: () => {}, hideLoading: () => {}, setNavigationBarTitle: () => {},
    pageScrollTo: () => {}, navigateBack: () => {}, navigateTo: () => {},
  };
  try {
    await p.load();
  } finally {
    global.wx = bakWx;
    api.call = origCall; api.ensureShop = origEnsure;
  }
  return p;
}

(async function () {
  const CFG = loadPage(null);

  console.log('\n===== A 组 · 手工录入行的三个 0 不许印出来 =====');
  toasts.length = 0;
  const P = await runLoad(CFG, makeVersions());
  ok('A-⓪b 前提：load() 一路没弹错误提示（弹了就说明桩或页面有别的毛病）',
    toasts.length === 0, toasts.join(' / ') || '无 toast');
  const lines = (P.data.list && P.data.list[0] && P.data.list[0].lines) || [];
  ok('A-⓪ 前提：真跑到两行（手工行 + 档案行）', lines.length === 2, '行数=' + lines.length);

  const manual = lines[0] || {};
  const arch = lines[1] || {};
  ok('A-① 🔴 手工行 purchase_price（0）⇒ 空串，不是 "0.00"',
    manual.purchase_price === '', '实际=' + JSON.stringify(manual.purchase_price));
  ok('A-② 手工行 convert_factor（0）⇒ 空串，不是 "0"',
    manual.convert_factor === '', '实际=' + JSON.stringify(manual.convert_factor));
  ok('A-③ 手工行 yield_rate（0）⇒ 空串，不是 "0"',
    manual.yield_rate === '', '实际=' + JSON.stringify(manual.yield_rate));
  ok('A-③b 手工行三个值在 wxml 的 wx:if 里必须是**假**（字符串 "0.00" 是真，这就是原 bug）',
    !manual.purchase_price && !manual.convert_factor && !manual.yield_rate,
    '真值? ' + [manual.purchase_price, manual.convert_factor, manual.yield_rate]
      .map((v) => (v ? '真' : '假')).join('/'));

  console.log('\n===== B 组 · 档案行不许被这刀误伤 =====');
  ok('B-① 档案行 purchase_price 照常出（24.00）',
    arch.purchase_price === '24.00', '实际=' + JSON.stringify(arch.purchase_price));
  ok('B-② 档案行 convert_factor 照常出（500）',
    arch.convert_factor === '500', '实际=' + JSON.stringify(arch.convert_factor));
  ok('B-③ 档案行 yield_rate 照常出（92）',
    arch.yield_rate === '92', '实际=' + JSON.stringify(arch.yield_rate));
  ok('B-④ 档案行的品牌规格/采购单位也没丢',
    arch.brand_spec === '郫县 500g' && arch.purchase_unit === '袋',
    arch.brand_spec + '/' + arch.purchase_unit);

  console.log('\n===== C 组 · 「手工录入行」必须被说出来 =====');
  const tip = TERMS.card && TERMS.card.snapshotNoArchive;
  ok('C-① 文案单源存在（TERMS.card.snapshotNoArchive）', typeof tip === 'string' && tip.length > 0, tip || '缺失');
  ok('C-② wxml 有「手工行」说明分支（否则老板只会看到空着，仍会问「是不是没导过来」）',
    W.indexOf('snap-none') >= 0 && W.indexOf('snapshotNoArchive') >= 0, '');
  ok('C-③ 说明只在 input_type === 2 时出现（不能给档案行也贴这句）',
    /wx:elif="\{\{l\.input_type === 2/.test(W), '');
  ok('C-④ 说明分支是 wx:elif（与快照块互斥，不会两块同时出现）',
    W.indexOf('wx:elif') >= 0, '');

  console.log('\n===== D 组 · 变异回灌 =====');
  // M1：把判据改回 `!= null`（= 改前写法）⇒ 三行 0 必须变回字符串
  const M1 = loadPage((s) => s
    .replace("(Number(l.purchase_price) || 0) > 0 ? api.fenToYuan(l.purchase_price, 2) : ''",
      'l.purchase_price != null ? api.fenToYuan(l.purchase_price, 2) : \'\'')
    .replace("(Number(l.convert_factor) || 0) > 0 ? String(l.convert_factor) : ''",
      'l.convert_factor != null ? String(l.convert_factor) : \'\'')
    .replace("(Number(l.yield_rate) || 0) > 0 ? String(l.yield_rate) : ''",
      'l.yield_rate != null ? String(l.yield_rate) : \'\''));
  const MP = await runLoad(M1, makeVersions());
  const ml = (MP.data.list[0].lines) || [];
  const mManual = ml[0] || {};
  ok('D-① 变异「改回 != null」⇒ 手工行变回 "0.00"/"0"（A-①~③ 有分辨力）',
    mManual.purchase_price === '0.00' && mManual.convert_factor === '0' && mManual.yield_rate === '0',
    JSON.stringify([mManual.purchase_price, mManual.convert_factor, mManual.yield_rate]));
  ok('D-② 变异后这三个值在 wx:if 里为**真**（这正是老板看到三个 0 的机制）',
    !!(mManual.purchase_price && mManual.convert_factor && mManual.yield_rate),
    '真值? ' + [mManual.purchase_price, mManual.convert_factor, mManual.yield_rate].map((v) => (v ? '真' : '假')).join('/'));

  // M2：把档案行的真值也一起收掉（一刀切）⇒ B 组必红
  const M2 = loadPage((s) => s.replace('(Number(l.purchase_price) || 0) > 0 ?', 'false ?'));
  const M2P = await runLoad(M2, makeVersions());
  const m2arch = (M2P.data.list[0].lines || [])[1] || {};
  ok('D-③ 变异「一刀切收起采购价」⇒ 档案行的价没了（B-① 有分辨力）',
    m2arch.purchase_price === '', '实际=' + JSON.stringify(m2arch.purchase_price));

  console.log('\n===== E 组 · 恢复版本不受影响（只读 4 个字段） =====');
  const restoreSeg = (SRC.match(/async doRestore\(v\)[\s\S]*?const card = \{/) || [''])[0];
  const readsSnapshot = /purchase_price|convert_factor|yield_rate/.test(restoreSeg);
  ok('E-① doRestore 不读这三个快照字段（所以把它们置空对「恢复」零影响）',
    restoreSeg.length > 0 && !readsSnapshot, restoreSeg.length ? (readsSnapshot ? '仍在读（红）' : '未读') : '未找到 doRestore');

  console.log('\n' + '='.repeat(60));
  console.log('===== 版本页快照 0 值守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail === 0 ? 0 : 1);
})();
