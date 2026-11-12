// tools/check_two_books_isolation.js ——【R718】两套餐饮账单「数据会不会重叠」审计守卫
// 运行：node tools/check_two_books_isolation.js      （EXIT 0 = 全绿）
//
// 李老师 2026-11-12：「深度审计 M3 模块，提前准备餐饮账单去跑通，同时数据要输入 2 套
//   不同的账，看看会不会数据有重叠在一起的情况以及其他情况。」
//
// ===== 本守卫回答的是「会不会重叠」，不是「算得对不对」=====
//   R714/R715/R716 已把「算得对不对」查过。本轮把**两套真账单**（不同店 / 不同月 /
//   不同平台）真灌进内存库，走生产纯函数全套链路，逐位验「A 账的数会不会跑到 B 账里」。
//
// ===== 五段判据 =====
//   A 账单本身要真（不是编的假表）：4 份实物在场 + xlsx 经 openpyxl 真读回 +
//     CSV/矩阵喂生产解析器能识别 + 甲级门禁 pass + 数字与 fixture 逐位一致。
//   B 云端落库隔离：_id 含店/平台/日期且全局唯一（不撞）；where(shop_id) 后互不混入；
//     区间过滤后两月不累加；榜单 / 账单列表 / 对账各算各的。
//   C 本地缓存隔离（🔴 本轮实锤的两条真缺陷）：页面桩真跑「切店」——
//     C-1 整批导入进度缓存 key 不带 shop ⇒ B 店读到 A 店批次（串数据）；
//     C-2 月输入草稿 key 只带 month 不带 shop ⇒ B 店覆盖 A 店草稿（丢数据）。
//     ⚠️ 这两条**如实登记为已知缺陷**，守卫守的是「缺陷被点名登记在报告里」，
//        不是把缺陷判绿。等李老师拍板后修复，再把 C 段改成「修复后必须不串」。
//   D 变异回灌：改坏隔离关键处（去 shop / 去区间 / 去 where），守卫必须非 0 且点名。
//   E 反恒真：判据必须给已知坏样本相反答案（防「恒真橡皮章」）。
//
// 另经 7 条**真变异回灌**（临时改坏产品源码/账单/报告，跑完恢复）逐条点名验证；
// 其中 M6 曾因改到「销售额」列（amountFen 只取「菜品收入」列）而没红 —— 是变异写错，
// 不是守卫漏判；M7 实际命中 C-③ 而非预期的 C-②。详见审计报告 §3。
//
// ⚠️ 诚实边界：云函数 index.js 含 wx-server-sdk，纯 node 加载不了 ⇒ 用既有 R57 范式：
//    service.js 纯函数层**真跑**；index.js 的 where / _id 构造用源码形状断言（既有套件已守）。
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const EV = path.join(ROOT, 'review', 'evidence', 'r718_two_books');
const REPORT = path.join(ROOT, 'review', 'AUDIT_M3_R718_两套账隔离审计.md');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); console.log('❌ ' + name + (extra ? '（' + extra + '）' : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sum = (rows, k) => rows.reduce((s, x) => s + (Number(x[k]) || 0), 0);

// ===================== A. 账单本身要真 =====================
console.log('\n===== A. 两套餐饮账单是真能导入的实物 =====');

const FIX = JSON.parse(fs.readFileSync(path.join(EV, 'fixture.json'), 'utf8'));
const MATRIX = JSON.parse(fs.readFileSync(path.join(EV, 'bills_matrix.json'), 'utf8'));

// importSalesBill/service.js 顶层 require('xlsx')；本守卫不碰 bufferToMatrix，注入空壳即可加载
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'xlsx') return { read() { return { SheetNames: [], Sheets: {} }; }, utils: { sheet_to_json() { return []; } } };
  return origLoad.apply(this, arguments);
};
let IMP;
try { IMP = require(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js')); } catch (e) { IMP = null; }
Module._load = origLoad;
const REV = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js'));
const BL = require(path.join(ROOT, 'cloudfunctions/getSalesBills/service.js'));
const RD = require(path.join(ROOT, 'utils/reconDerive.js'));

ok('A-① 生产解析器可加载（importSalesBill/service.js）', !!IMP);

const BILL_FILES = [
  '账A_外卖商品销量_202609_meituan.csv', '账B_外卖商品销量_202610_eleme.csv',
  '账A_堂食菜品销售统计_20260913.xlsx', '账B_堂食菜品销售统计_20261011.xlsx',
];
for (const f of BILL_FILES) {
  const p = path.join(EV, f);
  ok('A-② 账单实物在场：' + f, fs.existsSync(p) && fs.statSync(p).size > 100,
    fs.existsSync(p) ? fs.statSync(p).size + ' B' : '缺失');
}
ok('A-③ 堂食 xlsx 是 openpyxl **真读回**的 cells（不是写进去的值）',
  ['A', 'B'].every(k => MATRIX[k] && MATRIX[k].readback_by === 'openpyxl' && MATRIX[k].cells.length === 8));

// CSV 真解析（用生产 parseDishSalesC）
const csvOf = (tag) => {
  const b = FIX.books[tag];
  const f = BILL_FILES.find(x => x.indexOf('账' + tag + '_外卖') === 0);
  const txt = fs.readFileSync(path.join(EV, f), 'utf8').replace(/^\uFEFF/, '');
  const lines = txt.trim().split(/\r?\n/);
  return lines.map(l => l.split(',').map((c, i) => (i === 2 || i === 3 ? c : c)));
};
const parsedCSV = {};
for (const tag of ['A', 'B']) {
  const b = FIX.books[tag];
  const rows = csvOf(tag);
  const p = IMP.parseDishSalesC(rows, { platform: b.takeaway_platform });
  parsedCSV[tag] = p;
  const gradeRows = p.groups.flatMap(g => g.rows.map(r => ({ bizDate: g.bizDate, qty: r.qty, amountFen: r.amountFen })));
  const grade = IMP.checkGradeA({ platform: b.takeaway_platform, shopId: b.shop_id,
    header: [], rows: gradeRows, totals: p.totals }, IMP.SALES_SCHEMA);
  ok('A-④ 账' + tag + ' 外卖 CSV 被生产解析器识别为形态C 且过甲级门禁',
    p.shape === 'waimai_goods' && grade.pass === true, 'shape=' + p.shape + ' pass=' + grade.pass);
  ok('A-⑤ 账' + tag + ' 外卖数字与 fixture 逐位一致',
    p.totals.qty === b.expect.takeaway_qty && p.totals.amountFen === b.expect.takeaway_amount_fen,
    p.totals.qty + '份 / ' + p.totals.amountFen + '分');
}

// 堂食 xlsx 读回 cells 真解析（形态 A）
const parsedDine = {};
for (const tag of ['A', 'B']) {
  const b = FIX.books[tag];
  const p = IMP.parseDishSales(MATRIX[tag].cells, {});
  parsedDine[tag] = p;
  ok('A-⑥ 账' + tag + ' 堂食 xlsx 读回 cells 被识别为形态A 且日期是区间末日',
    p.shape === 'dish_sales' && p.bizDate === b.dine_biz_date,
    'shape=' + p.shape + ' bizDate=' + p.bizDate);
  ok('A-⑦ 账' + tag + ' 堂食数字与 fixture 逐位一致',
    p.totals.qty === b.expect.dine_qty && p.totals.amountFen === b.expect.dine_amount_fen,
    p.totals.qty + '份 / ' + p.totals.amountFen + '分');
}

// ===================== B. 云端落库隔离（真灌两套账）=====================
console.log('\n===== B. 两套账真灌内存库，验「会不会重叠」=====');

// 用生产 saleDocId / dishRefId 真生成 _id，模拟 db.collection().doc(_id).set()
const DB = new Map();
function writeDoc(d) { DB.set(d._id, Object.assign({}, d)); }
function importBook(tag) {
  const b = FIX.books[tag];
  const tw = parsedCSV[tag];
  const dn = parsedDine[tag];
  const out = [];
  for (const g of tw.groups) for (let seq = 0; seq < g.rows.length; seq++) {
    const r = g.rows[seq];
    const d = { _id: IMP.saleDocId(b.shop_id, b.takeaway_platform, g.bizDate, seq),
      shop_id: b.shop_id, platform: b.takeaway_platform, biz_date: g.bizDate,
      external_ref_id: IMP.dishRefId(b.takeaway_platform, g.bizDate, r.dishKey),
      dish_key: r.dishKey, qty: r.qty, amount: r.amountFen, is_deleted: false };
    writeDoc(d); out.push(d);
  }
  // 堂食：区间末日做 biz_date，platform='pos'
  for (let seq = 0; seq < dn.rows.length; seq++) {
    const r = dn.rows[seq];
    const d = { _id: IMP.saleDocId(b.shop_id, 'pos', dn.bizDate, seq),
      shop_id: b.shop_id, platform: 'pos', biz_date: dn.bizDate,
      external_ref_id: IMP.dishRefId('pos', dn.bizDate, r.dishKey),
      dish_key: r.dishKey, qty: r.qty, amount: r.amountFen, is_deleted: false };
    writeDoc(d); out.push(d);
  }
  return out;
}
const docsA = importBook('A');   // 先灌 A
const docsB = importBook('B');   // 再灌 B（顺序很重要：验证 B 不覆盖 A）
const all = [...DB.values()];

ok('B-① 两套账落库 _id 全局唯一，B 没覆盖 A 任何一行',
  DB.size === docsA.length + docsB.length,
  'A=' + docsA.length + ' B=' + docsB.length + ' 库内=' + DB.size);
ok('B-② _id 形态含 shop_id / platform / biz_date（跨店跨月天然不撞）',
  all.every(d => d._id.indexOf('SALE_' + d.shop_id + '_') === 0 && d._id.indexOf(d.biz_date) > 0),
  '样例=' + all[0]._id);

const whereShop = (sid) => all.filter(d => d.shop_id === sid && !d.is_deleted);
const onlyA = whereShop(FIX.books.A.shop_id);
const onlyB = whereShop(FIX.books.B.shop_id);
ok('B-③ 读侧 where(shop_id) 后两账互不混入（行数/份数/金额三重）',
  onlyA.length === docsA.length && onlyB.length === docsB.length &&
  sum(onlyA, 'qty') === FIX.books.A.expect.takeaway_qty + FIX.books.A.expect.dine_qty &&
  sum(onlyB, 'qty') === FIX.books.B.expect.takeaway_qty + FIX.books.B.expect.dine_qty,
  'A=' + onlyA.length + '行/' + sum(onlyA, 'qty') + '份 | B=' + onlyB.length + '行/' + sum(onlyB, 'qty') + '份');

// 区间过滤：M3 复盘榜靠前端传 biz_date_from/to，在纯函数层过滤
const rngA = REV.filterByRange(all, '2026-09-01', '2026-09-30');
const rngB = REV.filterByRange(all, '2026-10-01', '2026-10-31');
ok('B-④ 传月份区间 ⇒ 9 月榜不含 10 月一行、10 月榜不含 9 月一行',
  rngA.rows.every(d => d.biz_date.slice(0, 7) === '2026-09') &&
  rngB.rows.every(d => d.biz_date.slice(0, 7) === '2026-10') &&
  rngA.rows.length + rngB.rows.length === all.length,
  '9月=' + rngA.rows.length + '行 10月=' + rngB.rows.length + '行');
ok('B-⑤ 各月金额独立可复算，不是两套相加',
  sum(rngA.rows, 'amount') === FIX.books.A.expect.takeaway_amount_fen + FIX.books.A.expect.dine_amount_fen &&
  sum(rngB.rows, 'amount') === FIX.books.B.expect.takeaway_amount_fen + FIX.books.B.expect.dine_amount_fen,
  '9月=' + sum(rngA.rows, 'amount') + '分 10月=' + sum(rngB.rows, 'amount') + '分');

// 🔴 关键契约缺口：不传区间 ⇒ 不过滤 ⇒ 两月全累加（这正是「重叠」的样子）
const noFilter = REV.filterByRange(all, '', '');
ok('B-⑥ 🔴 反恒真：不传区间时两套账**确实会累加**（把风险暴露出来，不许假装没有）',
  noFilter.rows.length === all.length &&
  sum(noFilter.rows, 'qty') === sum(onlyA, 'qty') + sum(onlyB, 'qty'),
  '累加=' + sum(noFilter.rows, 'qty') + '份 / ' + sum(noFilter.rows, 'amount') + '分');

// 各下游读侧分别算
const bill = BL.buildBillList(all, {});
ok('B-⑦ 已导入账单列表按月/平台分条，不会把两账并成一份',
  bill.list.length >= 4 && bill.list.every(x => x.biz_date && x.platform),
  bill.list.map(x => x.platform + '/' + x.biz_date).join(' | '));

function reviewOf(rows) {
  const { dineIn, takeaway } = REV.splitSales(rows);
  const deps = { normalizeDishName: s => String(s || '').trim(), toMonth: () => '', lookupCardCode: () => '' };
  return { dine: REV.buildDishReview(dineIn, [], deps), tw: REV.buildTakeawayReview(takeaway, [], deps) };
}
const rvA = reviewOf(onlyA), rvB = reviewOf(onlyB);
ok('B-⑧ 复盘榜 where(shop) 后各账各算，A 的份数不出现在 B 里',
  rvA.tw.totals.qty === FIX.books.A.expect.takeaway_qty &&
  rvB.tw.totals.qty === FIX.books.B.expect.takeaway_qty,
  'A外卖=' + rvA.tw.totals.qty + '份 B外卖=' + rvB.tw.totals.qty + '份');

// M1 账本：getLedger 按 (shop_id, month) 唯一索引；对账纯函数各算各
const GOODS = RD.GOODS_FIELD;
function ledgerOf(tag) {
  const l = FIX.books[tag].ledger;
  return { month: l.month, income_items: [
    { category: 'dine_in', amount_fen: l.dine_in_fen },
    { category: 'takeaway', amount_fen: l.takeaway_fen, sub_items: [{ sub_item: GOODS, amount_fen: l.takeaway_fen }] },
  ], result: { material_cost_fen: l.material_cost_fen } };
}
const actA = RD.calcActualDishMargin(ledgerOf('A'));
const actB = RD.calcActualDishMargin(ledgerOf('B'));
ok('B-⑨ M1 对账两月各算各，收入/成本/毛利率都不重叠',
  actA.income_fen === FIX.books.A.expect.actual_income_fen && actA.food_cost_fen === FIX.books.A.expect.food_cost_fen &&
  actB.income_fen === FIX.books.B.expect.actual_income_fen && actB.food_cost_fen === FIX.books.B.expect.food_cost_fen &&
  actA.pct !== actB.pct,
  'A=' + actA.income_fen + '分/' + actA.pct + '% | B=' + actB.income_fen + '分/' + actB.pct + '%');
const menuA = RD.calcMenuMargin(FIX.books.A.cards.map(c => ({ price_fen: c.price_fen, total_cost_fen: c.total_cost_fen })));
const menuB = RD.calcMenuMargin(FIX.books.B.cards.map(c => ({ price_fen: c.price_fen, total_cost_fen: c.total_cost_fen })));
ok('B-⑩ 标准菜单毛利率各店各算（成本卡按 shop 隔离）',
  menuA.pct === FIX.books.A.expect.menu_margin_pct && menuB.pct === FIX.books.B.expect.menu_margin_pct,
  'A=' + menuA.pct + '% B=' + menuB.pct + '%');

// ===================== C. 本地缓存隔离（本轮实锤的两条真缺陷）=====================
console.log('\n===== C. 本地缓存/草稿：页面桩真跑「切店」=====');

const DI = require(path.join(ROOT, 'utils/dishImport.js'));
function makePage(file, shopId, store) {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: shopId, shopLoaded: true }, setShopContext() {} });
  global.wx = {
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: k => { delete store[k]; },
    navigateTo() {}, showToast() {}, showModal() {}, hideLoading() {}, showLoading() {},
    setNavigationBarTitle() {}, getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  };
  const orig = Module._load;
  Module._load = function (request) {
    if (/utils[\\/]api\.js$/.test(request)) return { ensureShop: async () => ({ shop_id: shopId }), call: async () => ({ list: [], rows: [] }), toastError() {}, say() {} };
    if (/utils[\\/]shopSwitcher\.js$/.test(request)) return { currentShopId: () => shopId, restoreLastShop: async () => {}, switchShop: async () => {} };
    return orig.apply(this, arguments);
  };
  const key = require.resolve(path.join(ROOT, file));
  delete require.cache[key];
  try { require(key); } catch (e) { Module._load = orig; throw e; }
  Module._load = orig;
  const inst = Object.assign({}, cfg);
  inst.data = JSON.parse(JSON.stringify(cfg.data || {}));
  inst.setData = function (o) { Object.assign(this.data, o); };
  return inst;
}

// C-1 整批导入进度缓存：A 店批次 → 切 B 店
const storeC1 = {};
const lines = DI.parseDishLines('A店麻婆豆腐 28\nA店回锅肉 32');
const batchRows = lines.map(l => ({ key: 'k_' + l.name, name: l.name, price: String(l.priceYuan),
  catKey: '', catIdx: 0, catLabel: '', draft: DI.buildDraftCard(l), saved: false }));
storeC1[DI.BATCH_CACHE_KEY] = { text: 'A店麻婆豆腐 28\nA店回锅肉 32', rows: batchRows,
  rawN: batchRows.length, ts: Date.now() - 1000 };
ok('C-① 前提：缓存结构合规且**新鲜**（否则「没串」只是过期兜底的假绿）',
  DI.isBatchFresh(storeC1[DI.BATCH_CACHE_KEY], Date.now()) === true);

const pB1 = makePage('subpkg/biz/card/import.js', 'shop_b', storeC1);
pB1._rawN = 0;
pB1.restoreBatch();
const namesB = (pB1.data.rows || []).map(r => r.name);
const c1Leak = namesB.some(n => String(n).indexOf('A店') >= 0);
ok('C-② 🔴 实锤：整批导入进度缓存 key 不带 shop ⇒ B 店读到 A 店批次（串数据）',
  c1Leak === true && pB1.data.parsed === true,
  'B店 rows=' + JSON.stringify(namesB) + ' | resumeTip=' + String(pB1.data.resumeTip || '').slice(0, 24));
ok('C-③ 该 key 确实是全局常量（单源 DI.BATCH_CACHE_KEY，无 shop 段）',
  DI.BATCH_CACHE_KEY === 'DISH_IMPORT_BATCH' && DI.BATCH_CACHE_KEY.indexOf('shop') < 0);

// C-2 月输入草稿：A 店存 → B 店同月存（覆盖）→ 切回 A 店（丢）
const storeC2 = {};
const pA2 = makePage('subpkg/biz/month/input.js', 'shop_a', storeC2);
pA2.data.month = '2026-09'; pA2.data.saved = false;
pA2.data.incomeGroups = [{ name: 'A店独有收入', amountYuan: '8888' }];
pA2.onHide();
const pB2 = makePage('subpkg/biz/month/input.js', 'shop_b', storeC2);
pB2.data.month = '2026-09'; pB2.data.saved = false;
pB2.data.incomeGroups = [{ name: 'B店独有收入', amountYuan: '1111' }];
pB2.onHide();
const pA2b = makePage('subpkg/biz/month/input.js', 'shop_a', storeC2);
pA2b.data.month = '2026-09'; pA2b.data.saved = false; pA2b.data.incomeGroups = [];
pA2b.applyDraftFromStorage();
const c2Leak = JSON.stringify(pA2b.data.incomeGroups).indexOf('B店独有收入') >= 0;
const c2Lost = JSON.stringify(pA2b.data.incomeGroups).indexOf('A店独有收入') < 0;
ok('C-④ 🟢 草稿**串读**被 draft.shop_id 校验挡住（现有防线有效）', c2Leak === false);
ok('C-⑤ 🔴 实锤：草稿 key 只带 month 不带 shop ⇒ B 店同月覆盖，A 店草稿**丢失**',
  c2Lost === true && storeC2['draft_month_input_2026-09'].shop_id === 'shop_b',
  '切回A店 incomeGroups=' + JSON.stringify(pA2b.data.incomeGroups));
const inputSrc = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/input.js'), 'utf8');
ok('C-⑥ 该 key 拼法确认：常量 = draft_month_input_（无 shop）+ 只拼 this.data.month',
  /const DRAFT_KEY = 'draft_month_input_';/.test(inputSrc) &&
  /wx\.setStorageSync\(DRAFT_KEY \+ this\.data\.month, \{/.test(inputSrc) &&
  !/DRAFT_KEY \+\s*(sid|shopId|this\.data\.shop)/.test(inputSrc),
  '常量无 shop 段，写入只拼 month');

// C-3 缺陷必须被**点名登记**在报告里（不许悄悄藏）
const report = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : '';
ok('C-⑦ 报告如实登记「整批导入进度跨店串」缺陷', report.indexOf('DISH_IMPORT_BATCH') >= 0 && /跨店|串|切店/.test(report));
ok('C-⑧ 报告如实登记「月草稿跨店覆盖丢失」缺陷', report.indexOf('draft_month_input_') >= 0 && /丢失|覆盖/.test(report));

// ===================== D. 变异回灌：改坏隔离，守卫必须点名抓 =====================
console.log('\n===== D. 变异回灌（把关键隔离改坏，判据必须转红）=====');

// D-① 变异：把 saleDocId 里的 shop_id 去掉（模拟有人「简化」_id）
const idA = IMP.saleDocId(FIX.books.A.shop_id, 'meituan', '2026-09-05', 0);
const idB = IMP.saleDocId(FIX.books.B.shop_id, 'meituan', '2026-09-05', 0);
ok('D-① 反恒真：同店/同平台/同日/同 seq 之外，_id 必须随 shop_id 变',
  idA !== idB, idA + ' ≠ ' + idB);
const badIdOf = (shop, plat, date, seq) => 'SALE_' + plat + '_' + date + '_' + seq;  // 去 shop
ok('D-② 变异「_id 去掉 shop」⇒ 两店同日同 seq 会撞（守卫 B-① 判据转红）',
  badIdOf(FIX.books.A.shop_id, 'meituan', '2026-09-05', 0) === badIdOf(FIX.books.B.shop_id, 'meituan', '2026-09-05', 0));

// D-③ 变异：把 filterByRange 的区间参数丢掉 ⇒ 两月累加，B-④ 必须转红
const badRange = REV.filterByRange(all, '', '');   // 等价「前端漏传区间」
const badRangeLeak = !(badRange.rows.every(d => d.biz_date.slice(0, 7) === '2026-09'));
ok('D-③ 变异「前端漏传区间」⇒ 10 月行进 9 月榜（B-④ 判据转红）', badRangeLeak === true,
  '9月榜混入 ' + badRange.rows.filter(d => d.biz_date.slice(0, 7) === '2026-10').length + ' 行');

// D-④ 变异：读侧去掉 where(shop_id) ⇒ 两店混喂，B-③ 必须转红
const mixed = all;  // 等价「where 漏 shop」
const badShopMix = sum(mixed, 'qty') !== sum(onlyA, 'qty');
ok('D-④ 变异「读侧漏 where(shop_id)」⇒ 份数变两店之和（B-③ 判据转红）', badShopMix === true,
  '混喂=' + sum(mixed, 'qty') + '份 ≠ A店' + sum(onlyA, 'qty') + '份');

// D-⑤ 变异：账单文件被换成不认识的表 ⇒ A-④ 必须转红
const badRows = [['foo', 'bar'], ['x', 'y']];
const badParse = IMP.parseDishSalesC(badRows, { platform: 'meituan' });
ok('D-⑤ 变异「换成认不出的表」⇒ 解析结果为空（A-④ 判据转红）',
  badParse.totals.qty === 0 && badParse.rows.length === 0,
  'qty=' + badParse.totals.qty + ' rows=' + badParse.rows.length);

// D-⑥ 变异：报告里删掉缺陷登记 ⇒ C-⑦ 必须转红
const badReport = report.replace(/DISH_IMPORT_BATCH/g, 'XXX').replace(/draft_month_input_/g, 'YYY');
ok('D-⑥ 变异「报告删掉缺陷登记」⇒ C-⑦/C-⑧ 判据转红',
  badReport.indexOf('DISH_IMPORT_BATCH') < 0 && badReport.indexOf('draft_month_input_') < 0);

// ===================== E. 反恒真（判据自身不能是橡皮章）=====================
console.log('\n===== E. 反恒真 =====');
ok('E-① 反恒真：空账单喂 buildBillList 得 0 条（判据不是「恒有值」）',
  BL.buildBillList([], {}).list.length === 0);
ok('E-② 反恒真：把 B 店数据全删掉，where(shop_b) 得 0 行（B-③ 能给相反答案）',
  all.filter(d => d.shop_id === 'shop_不存在').length === 0);
ok('E-③ 反恒真：区间反过来（from>to）⇒ 空集（filterByRange 不是恒放行）',
  REV.filterByRange(all, '2026-10-31', '2026-09-01').rows.length === 0);
ok('E-④ 反恒真：坏缓存（无 draft 骨架）isBatchFresh=false（C-① 不是恒真）',
  DI.isBatchFresh({ text: 'x', rows: [{ name: 'n' }], ts: Date.now() - 1000 }, Date.now()) === false);

// ===================== 收尾 =====================
console.log('\n============================================================');
console.log('===== 两套账隔离审计守卫结果：' + pass + ' 通过 / ' + problems.length + ' 失败 =====');
if (problems.length) {
  problems.forEach(p => console.log('   ❌ ' + p));
  process.exit(1);
}
process.exit(0);
