// review/_page_stub_recon_20261125.js —— 对账页「段三」页面级验证（node 桩，真跑页面源码）
// 运行： node review/_page_stub_recon_20261125.js
//
// 🔴 为什么必须有这一层：算法层 e2e 已经证明「公式对」，但**页面会不会崩**是另一件事 ——
//   buildMaterialView 里用 api.yuanToFen / this.loadMatInv / this.data.months，
//   任何一个参数错、或 require 少了，真机上就是白屏。静态 grep 与纯函数 selftest 都抓不到。
//
// ⚠️ 它不进门禁（放 review/），是一次性取证；要长期守请转成 tools/check_*.js。

const path = require('path');
const ROOT = path.join(__dirname, '..');

// ============ 一、最小桩（只桩页面跑起来必需的）============
const store = { 'shop_current_id': 'shop_test' };
let cfg = null;

global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
global.wx = {
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
  showToast: () => {},
  navigateTo: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, platform: 'devtools' }),
  cloud: { callFunction: () => Promise.resolve({ result: { code: 0 } }) },
};

// 页面 require 时会连带 require utils/api.js —— 它可能读 wx.cloud，桩已备。
require(path.join(ROOT, 'subpkg/tools/recon/index.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

check('页面源码能被 require（Page 配置已捕获）', !!cfg && typeof cfg.buildMaterialView === 'function');

// ============ 二、造实例（setData 必须真合并，否则测不到）============
const p = Object.assign({}, cfg);
p.data = JSON.parse(JSON.stringify(cfg.data));
p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
p.data.months = ['2026-11', '2026-10', '2026-09'];   // 倒序，curMonth 的下一项 = 上月
p.data.curMonth = '2026-11';

// ============ 三、测试数据（与 _e2e_test 同一套）============
// 🔴 fixture 必须用 getMaterial 的**真实出参字段名**（purchase_price_fen），否则桩自己也会绿。
//   见 R737 同族教训：按引擎的样子造数，而不是按库的样子造。
//   并且故意把「食用油」排在「牛肉」之前 —— 若排序失效（price 恒 0），顺序不会变，断言会红。
const MATERIALS = [
  { id: 'm_oil', name: '食用油', purchase_unit: '斤', purchase_price_fen: 900, convert_factor: 500, yield_rate: 100 },
  { id: 'm_beef', name: '牛肉', purchase_unit: '斤', purchase_price_fen: 1800, convert_factor: 500, yield_rate: 85 },
  { id: 'm_pork', name: '猪肉', purchase_unit: '斤', purchase_price_fen: 1400, convert_factor: 500, yield_rate: 95 },
  { id: 'm_noodle', name: '面条', purchase_unit: '斤', purchase_price_fen: 400, convert_factor: 500, yield_rate: 100 },
  { id: 'm_rice', name: '大米', purchase_unit: '斤', purchase_price_fen: 320, convert_factor: 500, yield_rate: 100 },
  { id: 'm_pep', name: '青椒', purchase_unit: '斤', purchase_price_fen: 500, convert_factor: 500, yield_rate: 90 },
];
const CARDS = [
  { card_code: 'C001', card_type: 1, price_fen: 2800, lines: [
    { material_id: 'm_beef', quantity: 120, line_type: 1 },
    { material_id: 'm_noodle', quantity: 150, line_type: 1 },
    { material_id: 'm_oil', quantity: 15, line_type: 1 }] },
  { card_code: 'C002', card_type: 1, price_fen: 2200, lines: [
    { material_id: 'm_pork', quantity: 100, line_type: 1 },
    { material_id: 'm_pep', quantity: 150, line_type: 1 },
    { material_id: 'm_oil', quantity: 20, line_type: 1 }] },
  { card_code: 'C003', card_type: 1, price_fen: 200, lines: [
    { material_id: 'm_rice', quantity: 200, line_type: 1 }] },
];
const DINE_IN = [
  { card_code: 'C001', qty: 300 },
  { card_code: 'C002', qty: 250 },
  { card_code: 'C003', qty: 400 },
];

// 本月盘点（按店按月的 key 由 shopKey 生成，这里先用同一套写进 store）
const ss = require(path.join(ROOT, 'utils/shopSwitcher.js'));
const kNov = ss.shopKey('matinv_2026-11');
const kOct = ss.shopKey('matinv_2026-10');
store[kNov] = {
  m_beef: { o: 5, p: 95, c: 8, a: 1710 },
  m_pork: { o: 3, p: 55, c: 5, a: 770 },
  m_noodle: { o: 10, p: 85, c: 8, a: 340 },
  m_oil: { o: 2, p: 22, c: 3, a: 198 },
  m_rice: { o: 20, p: 150, c: 12, a: 480 },
  m_pep: { o: 1, p: 85, c: 5, a: 425 },
};
store[kOct] = { m_beef: { o: 0, p: 80, c: 0, a: 1280 } };   // 上月只为做量价对比

// ============ 四、真跑 buildMaterialView ============
const view = p.buildMaterialView('2026-11', { list: CARDS }, { dine_in: DINE_IN }, { list: MATERIALS });

check('buildMaterialView 不抛异常且 ok=true', !!view && view.ok === true, view && view.reason);
check('出 6 行（top8 内只有 6 个原料）', view && view.rows.length === 6, view && '=' + view.rows.length);
// 🔴 排序断言：fixture 里油排在牛肉前，按「理论采购金额」降序后牛肉必须排第 1。
//   若 purchase_price_fen 读成 undefined（写成 purchase_price）⇒ price 恒 0 ⇒ 顺序不变 ⇒ 这条必红。
check('按「理论采购金额」降序：牛肉(1525元) 排在 食用油(171元) 之前',
  view && view.rows[0] && view.rows[0].material_id === 'm_beef',
  view && view.rows[0] && ('第1行=' + view.rows[0].name));

const beef = view.rows.find((r) => r.material_id === 'm_beef');
const oil = view.rows.find((r) => r.material_id === 'm_oil');
check('牛肉理论量 84.71 斤（÷出成率 85% 生效）', beef && beef.theoryText === '84.71', beef && '=' + beef.theoryText);
check('牛肉实际 92 斤 / 差 +8.6%', beef && beef.actualText === '92.00' && beef.diffText === '+8.6%',
  beef && beef.actualText + ' / ' + beef.diffText);
check('食用油 diffOver=true（+10.5%，页面应变红）', oil && oil.diffOver === true && oil.diffText === '+10.5%',
  oil && oil.diffText);

// 量价：牛肉「比上月 +12.5%」「买贵/多买」
check('牛肉有均价 ¥18.00', beef && beef.priceCurText === '18.00', beef && beef.priceCurText);
check('牛肉「比上月 +12.5%」且 level=up（应提示变化较大）',
  beef && beef.priceChgText === '+12.5%' && beef.priceChgLevel === 'up', beef && beef.priceChgText + ' / ' + beef.priceChgLevel);
check('牛肉「买贵 190 / 多买 240」', beef && beef.priceImpactText === '190.00' && beef.qtyImpactText === '240.00',
  beef && beef.priceImpactText + ' / ' + beef.qtyImpactText);
check('牛肉 priceImpactOver=true（买贵要标红）', beef && beef.priceImpactOver === true);

// 上月没填的原料：应给 priceNeedPrev，不能编同比
const pork = view.rows.find((r) => r.material_id === 'm_pork');
check('猪肉上月没填 ⇒ priceNeedPrev=true（不编同比）', pork && pork.priceNeedPrev === true);
check('猪肉 priceChgText 为空（不显示假涨幅）', pork && pork.priceChgText === '');

// ============ 五、真跑 onMatQty（输入 → 落库 → 重算）============
p._matRaw = { cardsRes: { list: CARDS }, reviewRes: { dine_in: DINE_IN }, matRes: { list: MATERIALS } };
p.onMatQty({ currentTarget: { dataset: { mid: 'm_oil', k: 'p' } }, detail: { value: '30' } });

const savedOil = store[kNov] && store[kNov].m_oil;
check('onMatQty 写入本地（食用油采购改成 30）', savedOil && Number(savedOil.p) === 30, savedOil && 'p=' + savedOil.p);
const oil2 = (p.data.material.rows || []).find((r) => r.material_id === 'm_oil');
check('onMatQty 立刻重算（食用油实际 = 2+30−3 = 29 斤）', oil2 && oil2.actualText === '29.00', oil2 && oil2.actualText);
check('重算后差率变化（+52.6% 左右，不再是 +10.5%）', oil2 && oil2.diffText && oil2.diffText !== '+10.5%', oil2 && oil2.diffText);

// 非法输入不落库
const before = store[kNov].m_oil.p;
p.onMatQty({ currentTarget: { dataset: { mid: 'm_oil', k: 'p' } }, detail: { value: 'abc' } });
check('onMatQty 非法输入不落库（防脏值）', store[kNov].m_oil.p === before, '仍=' + store[kNov].m_oil.p);

// ============ 六、空态：没填任何盘点 ============
delete store[kNov];
const viewEmpty = p.buildMaterialView('2026-11', { list: CARDS }, { dine_in: DINE_IN }, { list: MATERIALS });
check('没填盘点 ⇒ 仍出 6 行（只显示理论量，不显示实际/差）',
  viewEmpty.ok === true && viewEmpty.rows.length === 6 && viewEmpty.rows[0].actualText === '',
  viewEmpty.rows && viewEmpty.rows[0] && 'actualText="' + viewEmpty.rows[0].actualText + '"');

// ============ 七、没有原料档案 ⇒ 算不了（不能白屏）============
const viewNoMat = p.buildMaterialView('2026-11', { list: CARDS }, { dine_in: DINE_IN }, {});
check('没拿到原料档案 ⇒ ok=false 且带缺项文案（不白屏）',
  viewNoMat.ok === false && typeof viewNoMat.missText === 'string' && viewNoMat.missText.length > 0,
  viewNoMat.reason + ' / ' + (viewNoMat.missText || '').slice(0, 12) + '…');

console.log('\n==== 对账页段三 · 页面级验证：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
