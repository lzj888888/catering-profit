// tools/check_takeaway_actual.js ——【R716】外卖页「本单实收」（可选输入）
// 运行：node tools/check_takeaway_actual.js      （EXIT 0 = 全绿）
//
// 背景（R715 报告建议 1 / 李老师 2026-11-12「不知怎么填数字…入错了数字怎么办」）：
//   外卖页此前只有一个「标准单应付」= 成本卡售价 × 份数 + 打包费 + 顾客配送费。
//   外卖普遍在堂食价上加 2~5 元、还有满减/折扣 ⇒ 实收几乎永远不等于这个估算值，
//   老板拿到的是"估的利润"。而老板手上确实有一个真数：外卖后台「订单详情 → 预计收入」。
//
// 本守卫守四件事（每件都是"写起来容易、错起来静默"）：
//   ① 填了实收 ⇒ 只认它，**不再逐项扣费**（重复扣一次，利润平白少一截，零报错）
//   ② 填了实收 ⇒ **不给到手率**（分母是标准单，加价单会算出 >100%，看着像 bug）
//   ③ 填了实收 ⇒ **不画瀑布**（各项占比重加起来对不上 100%，条会自相矛盾）
//   ④ 填了实收 ⇒ 总额法标 available:false 且出**空串不出 '0.00'**
//      （0.00 会被读成"总额法算出来是 0"，而真相是"这套输入下算不了"）
//
// 另外守边界：填 0 / 负数 / 读不成的字，都**不许**被当成"这单实收 0 元"。
//
// 方法：页面桩真跑 `onCalc`（同一份生产源码，不是副本）+ 纯函数级变异回灌。
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE_DIR = path.join(ROOT, 'subpkg/biz/takeaway');
const PAGE_FILE = path.join(PAGE_DIR, 'index.js');
const DERIVE_FILE = path.join(ROOT, 'utils/takeawayDerive.js');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); console.log('❌ ' + name + (extra ? '（' + extra + '）' : '')); }
}

// ===================== 页面桩 =====================
let cfg = null;

/** 加载页面源码（mutateSrc 可改源码，用于变异；绝不落盘） */
function loadPage(mutateSrc, derivePatch) {
  cfg = null;
  let src = fs.readFileSync(PAGE_FILE, 'utf8');
  if (mutateSrc) src = mutateSrc(src);
  global.Page = (c) => { cfg = c; };
  const store = {};
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  global.wx = {
    getStorageSync: (k) => store[k],
    setStorageSync: (k, v) => { store[k] = v; },
    showToast: () => {}, showModal: () => {},
    navigateTo: () => {}, redirectTo: () => {}, navigateBack: () => {}, switchTab: () => {},
    cloud: { callFunction: async () => ({ result: { ok: true, data: {} } }) },
  };
  const fakeRequire = (p) => {
    const abs = /^[./]/.test(p) ? path.resolve(PAGE_DIR, p) : p;
    if (derivePatch && abs === DERIVE_FILE) return derivePatch();
    return require(abs);
  };
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
    mod, mod.exports, fakeRequire, PAGE_DIR, PAGE_FILE);
  if (!cfg) throw new Error('页面桩没有捕获到 Page 配置');
  return cfg;
}

// 基线：一单「麻辣香锅」成本卡售价 32 元 / 成本 12 元，1 份。
// 平台参数故意都填成非零，才能验出「有没有重复扣」。
const BASE = {
  commission_mode: 'rate', commission_rate: '15', commission_min_yuan: '', commission_fixed_yuan: '',
  delivery_fee_yuan: '3.2', delivery_subsidy_yuan: '', promo_yuan: '2',
  pack_fee_yuan: '2', delivery_customer_yuan: '', actual_receipt_yuan: '',
  s_user: { amount_yuan: '', payer: '' }, s_merchant: { amount_yuan: '', payer: 'merchant' },
};

/** 真跑一次「计算」。paramsPatch 覆盖基线参数。 */
async function run(paramsPatch, opt) {
  const o = opt || {};
  const c = loadPage(o.mutateSrc, o.derivePatch);
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p.data.items = [{ rid: 'r1', card_id: 'C1', name: '麻辣香锅', qty: '1' }];
  p.data.packs = [{ rid: 'p1', material_id: '', qty: '0', unit_price_yuan: '' }];
  p.data.dishes = [{ card_id: 'C1', name: '麻辣香锅', price_fen: 3200, unit_cost_fen: 1200, card_type: 1 }];
  p.data.params = JSON.parse(JSON.stringify(BASE));
  Object.assign(p.data.params, paramsPatch || {});
  p.data.targetProfitYuan = '5';
  p.data.mode = 'cash';
  let threw = null;
  try { await p.onCalc(); } catch (e) { threw = e; }
  if (threw) throw threw;
  return p;
}

const yuan = (s) => Number(s);
const fen = (s) => Math.round(Number(s) * 100);

(async function main() {

// ===================== A · 输入链路真跑 =====================
console.log('\n===== A · 输入链路（真跑 onCalc，不 grep） =====');

{
  const p = await run({});
  ok('A-① 不填实收 ⇒ is_actual 为假（走原来的估算路径）', p.data.view.is_actual === false,
    'is_actual=' + p.data.view.is_actual);
  ok('A-② 不填实收 ⇒ 顾客支付 = 32 + 打包费 2 = 34.00（口径未被改动）',
    p.data.view.payment === '34.00', 'payment=' + p.data.view.payment);
  ok('A-③ 不填实收 ⇒ 估算实收 = 34 − 佣金 4.8 − 配送 3.2 − 推广 2 = 24.00（H1 口径仍在）',
    p.data.view.receipt === '24.00', 'receipt=' + p.data.view.receipt);
}

{
  const p = await run({ actual_receipt_yuan: '26' });
  ok('A-④ 填 26 ⇒ is_actual 为真', p.data.view.is_actual === true, 'is_actual=' + p.data.view.is_actual);
  ok('A-⑤ 填 26 ⇒ 商家实收显示 26.00（用的是填的数，不是估算的 24.00）',
    p.data.view.receipt === '26.00', 'receipt=' + p.data.view.receipt);
  ok('A-⑥ 填 26 ⇒ 利润 = 26.00 − 菜 12.00 = 14.00',
    p.data.view.profit === '14.00', 'profit=' + p.data.view.profit);
}

{
  // 元→分不能丢精度：22.5 元 = 2250 分（历史上多处犯过 round(22.5*100)=2250 但浮点写成 2249）
  const p = await run({ actual_receipt_yuan: '22.5' });
  ok('A-⑦ 填 22.5 ⇒ 分 2250、实收 22.50（元→分无浮点丢位）',
    p.data.view.receipt === '22.50' && p.data.result.cash.actual_receipt_fen === 2250,
    'receipt=' + p.data.view.receipt + ' fen=' + p.data.result.cash.actual_receipt_fen);
}

// ===================== B · 不重复扣费 =====================
console.log('\n===== B · 填了实收就不再逐项扣费 =====');

{
  const p = await run({ actual_receipt_yuan: '26' });
  const c = p.data.result.cash;
  ok('B-① 利润恒等于「实收 − 菜成本 − 包材」',
    c.profit_fen === c.receipt_fen - c.dish_cost_fen - c.pack_cost_fen,
    c.profit_fen + ' === ' + c.receipt_fen + ' − ' + c.dish_cost_fen + ' − ' + c.pack_cost_fen);
  ok('B-② 利润里**没有**再减佣金（否则 14.00 会变成 9.20）',
    c.profit_fen === 1400, 'profit_fen=' + c.profit_fen);
}

{
  // 把佣金率从 15% 改成 60%：填了实收 ⇒ 利润必须一分不动
  const a = await run({ actual_receipt_yuan: '26', commission_rate: '15' });
  const b = await run({ actual_receipt_yuan: '26', commission_rate: '60' });
  ok('B-③ 填了实收 ⇒ 改佣金率 15%→60%，利润一分不变（费率确实没参与）',
    a.data.result.cash.profit_fen === b.data.result.cash.profit_fen,
    a.data.result.cash.profit_fen + ' vs ' + b.data.result.cash.profit_fen);
  // 反恒真：不填实收时，同一个改动**必须**让利润变 —— 否则 B-③ 可能是"两边都不动"的假绿
  const c = await run({ commission_rate: '15' });
  const d = await run({ commission_rate: '60' });
  ok('B-④ 反恒真：不填实收 ⇒ 改佣金率利润必须变（证明 B-③ 不是因为费率根本没接上）',
    c.data.result.cash.profit_fen !== d.data.result.cash.profit_fen,
    c.data.result.cash.profit_fen + ' vs ' + d.data.result.cash.profit_fen);
}

// ===================== C · 不给错的数 =====================
console.log('\n===== C · 填了实收就不给到手率 / 不画瀑布 =====');

{
  const p = await run({ actual_receipt_yuan: '26' });
  ok('C-① 填了实收 ⇒ 到手率为 null（不留旧值，不给假百分比）',
    p.data.view.receipt_rate === null, 'receipt_rate=' + JSON.stringify(p.data.view.receipt_rate));
  ok('C-② 填了实收 ⇒ 瀑布为 null（各项占比重加对不上 100%，画出来自相矛盾）',
    p.data.view.waterfall === null, 'waterfall=' + JSON.stringify(p.data.view.waterfall));
  ok('C-③ 填了实收 ⇒ rate_low 为假（null 不能被隐式判成"低于 70%"）',
    p.data.view.rate_low === false, 'rate_low=' + p.data.view.rate_low);
}

{
  // 加价场景：成本卡 32 元，外卖卖 38 元。到手率若硬算 = 38/34 = 112%，必须不许出现
  const p = await run({ actual_receipt_yuan: '38' });
  ok('C-④ 加价单（实收 38 > 标准单 34）⇒ 到手率仍是 null，不会算出 112% 这种"像 bug"的数',
    p.data.view.receipt_rate === null, 'receipt_rate=' + JSON.stringify(p.data.view.receipt_rate));
}

{
  const p = await run({});
  ok('C-⑤ 反恒真：不填实收 ⇒ 到手率必须有值（证明 C-① 不是"永远为 null"）',
    typeof p.data.view.receipt_rate === 'number' && p.data.view.receipt_rate > 0,
    'receipt_rate=' + p.data.view.receipt_rate);
  ok('C-⑥ 反恒真：不填实收 ⇒ 瀑布必须存在（证明 C-② 不是"永远为 null"）',
    !!p.data.view.waterfall && p.data.view.waterfall.items.length > 0,
    p.data.view.waterfall ? p.data.view.waterfall.items.length + ' 段' : 'null');
}

// ===================== D · 总额法不凑数 =====================
console.log('\n===== D · 填了实收 ⇒ 总额法标不可用，且出空串不出 0.00 =====');

{
  const p = await run({ actual_receipt_yuan: '26' });
  ok('D-① 填了实收 ⇒ accrual.available 为 false',
    p.data.result.accrual.available === false, 'available=' + p.data.result.accrual.available);
  ok('D-② 总额法三个数是 null，不是 0（拿标准单凑数会给出第二个"都不准"的利润）',
    p.data.result.accrual.revenue_fen === null && p.data.result.accrual.expense_fen === null
    && p.data.result.accrual.profit_fen === null,
    JSON.stringify([p.data.result.accrual.revenue_fen, p.data.result.accrual.expense_fen, p.data.result.accrual.profit_fen]));
  ok('D-③ 页面拿到的是**空串**不是 "0.00"（"0.00" 会被读成"总额法算出来是 0"）',
    p.data.view.revenue === '' && p.data.view.expense === '' && p.data.view.profit_accrual === '',
    JSON.stringify([p.data.view.revenue, p.data.view.expense, p.data.view.profit_accrual]));
}

{
  const p = await run({});
  ok('D-④ 反恒真：不填实收 ⇒ accrual.available 为真且两口径利润恒等（T-h 不许被这次改动破坏）',
    p.data.result.accrual.available === true
    && p.data.result.cash.profit_fen === p.data.result.accrual.profit_fen,
    'cash=' + p.data.result.cash.profit_fen + ' accrual=' + p.data.result.accrual.profit_fen);
  ok('D-⑤ 反恒真：不填实收 ⇒ 总额法三个数都有值（证明 D-② 不是"从来都是 null"）',
    typeof p.data.result.accrual.revenue_fen === 'number'
    && typeof p.data.result.accrual.profit_fen === 'number',
    'revenue=' + p.data.result.accrual.revenue_fen);
}

// ===================== E · 边界：0 / 负数 / 读不成 =====================
console.log('\n===== E · 边界（不能把 0 当"这单实收 0 元"） =====');

{
  const p0 = await run({ actual_receipt_yuan: '0' });
  ok('E-① 填 0 ⇒ 视为未填，走估算（0 不等于"这单白干"）',
    p0.data.view.is_actual === false && p0.data.view.receipt === '24.00',
    'is_actual=' + p0.data.view.is_actual + ' receipt=' + p0.data.view.receipt);
  const pn = await run({ actual_receipt_yuan: '-26' });
  // 页面层：负数被判「不可读」⇒ 拒算（不产出任何数）。绝不会用负数算出一个"赚更多"的假数。
  ok('E-② 填负数 ⇒ 拒算（不产出数，也不静默退回估算）',
    !pn.data.view && pn.data.badAmountCount > 0,
    'view=' + JSON.stringify(pn.data.view) + ' badAmountCount=' + pn.data.badAmountCount);
  // 纯函数层：就算别的入口绕过页面直接送负数进来，也必须夹到 0（当成没填）
  const D = require(path.join(ROOT, 'utils/takeawayDerive.js'));
  const r = D.calcTakeawayOrder(
    { items: [{ card_id: 'C1', qty: 1 }], packs: [], params: { actual_receipt_fen: -2600 } },
    () => ({ price_fen: 3200, unit_cost_fen: 1200, card_type: 1 }));
  ok('E-②b 纯函数层：直接送 -2600 分 ⇒ is_actual 为假（夹紧在计算单源里，不靠调用方自觉）',
    r.cash.is_actual === false, 'is_actual=' + r.cash.is_actual);
  const pe = await run({ actual_receipt_yuan: '' });
  ok('E-③ 留空 ⇒ 视为未填（默认状态必须是"没填"）',
    pe.data.view.is_actual === false, 'is_actual=' + pe.data.view.is_actual);
}

{
  // 读不成的字：checkAmounts 抓到 ⇒ onCalc 拒算。绝不能静默按估算给数（老板以为按实收算了）
  const p = await run({ actual_receipt_yuan: '' });
  const before = p.data.view.receipt;
  p.data.params.actual_receipt_yuan = '22.5元';
  await p.onCalc();
  ok('E-④ 填「22.5元」这类读不成的数 ⇒ 拒算，不静默退回估算（否则老板以为按实收算了）',
    p.data.view.receipt === before && p.data.badAmountCount > 0,
    'receipt 保持 ' + p.data.view.receipt + '，badAmountCount=' + p.data.badAmountCount);
}

// ===================== F · 模板与文案 =====================
console.log('\n===== F · 模板与文案（防"逻辑对了但没显示 / 显示了但条件反了"） =====');

const wxml = fs.readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8');
const jsSrc = fs.readFileSync(PAGE_FILE, 'utf8');

ok('F-① 输入框绑到 actual_receipt_yuan（且是 digit 键盘）',
  /type="digit"[^>]*data-field="actual_receipt_yuan"/.test(wxml), '');
ok('F-② 到手率那一行带 `!view.is_actual` 条件（否则实测模式仍会印出一行 null%）',
  /wx:if="\{\{!view\.is_actual\}\}"[^>]*>[\s\S]{0,200}?t\.receiptRate/.test(wxml), '');
ok('F-③ 总额法三行包在 accrual_available 分支里',
  /wx:if="\{\{view\.accrual_available\}\}"/.test(wxml) && /wx:if="\{\{!view\.accrual_available\}\}"/.test(wxml), '');
ok('F-④ 填了实收时「顾客支付」改标「标准单应付」（留着旧标签，老板会拿它跟顾客实付对）',
  /view\.is_actual \? t\.stdPayment : t\.payment/.test(wxml), '');
ok('F-⑤ 实收输入框进了金额体检表（否则「22.5元」静默变 0，退回估算且零报错）',
  /actual_receipt_yuan:\s*p\.actual_receipt_yuan/.test(jsSrc), '');
ok('F-⑥ 实收进了 buildOrder 传参（不传就永远算不到）',
  /actual_receipt_fen:\s*fen\(p\.actual_receipt_yuan\)/.test(jsSrc), '');
ok('F-⑦ 默认参数里实收是空串（默认必须是「没填」，不能是 "0"）',
  /actual_receipt_yuan:\s*''/.test(jsSrc), '');

{
  const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.takeaway;
  const keys = ['actualTitle', 'actualLabel', 'actualPh', 'actualNote', 'actualModeTip',
    'accrualUnavailable', 'stdPayment', 'itemGrossActualNote'];
  const bad = keys.filter((k) => typeof T[k] !== 'string' || !T[k].length);
  ok('F-⑧ 八个新文案键都在且非空（漏一个就是真机静默空白）', bad.length === 0, bad.join(',') || '全在');
  ok('F-⑨ 说明里点明「不是顾客付了多少」——填错的后果是利润虚高一倍，一句都不能省',
    /不是顾客付了多少/.test(T.actualNote || ''), '');
}

{
  // 逐行毛利之和 > 本单利润，这是填了实收后必然出现的矛盾数字，必须配解释，否则老板当 bug 报
  const p = await run({ actual_receipt_yuan: '26' });
  const lineGross = p.data.result.lines.reduce((s, l) => s + l.gross_profit_fen, 0);
  ok('F-⑩ 事实核验：实测模式下逐行毛利之和（20.00）确实大于本单利润（14.00）',
    lineGross > p.data.result.cash.profit_fen,
    '行毛利和=' + (lineGross / 100).toFixed(2) + ' vs 利润=' + (p.data.result.cash.profit_fen / 100).toFixed(2));
  ok('F-⑪ 这个矛盾配有说明，且只在实测模式出现（估算模式下两者一致，不需要解释）',
    /class="muted" wx:if="\{\{view\.is_actual\}\}"[^>]*>\{\{t\.itemGrossActualNote\}\}/.test(wxml), '');
  const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.takeaway;
  ok('F-⑫ 说明讲清了原因（「没扣平台抽成」），不是含糊的"仅供参考"',
    /没扣平台抽成/.test(T.itemGrossActualNote || ''), '');
}

// ===================== G · 变异回灌（证明上面不是假绿） =====================
console.log('\n===== G · 变异回灌（改坏计算层，断言必须转红并点名） =====');

function deriveMutated(fromRe, toRe) {
  const src = fs.readFileSync(DERIVE_FILE, 'utf8');
  const mut = src.replace(fromRe, toRe);
  if (mut === src) throw new Error('变异未命中：' + fromRe);
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename', mut)(
    mod, mod.exports, require, path.join(ROOT, 'utils'), DERIVE_FILE);
  return mod.exports;
}

{
  // 变异 1：实收被忽略（回到"只认估算"）⇒ B-②/C-① 必须红
  const D = deriveMutated(
    'const receipt = isActual ? actualReceipt : estimatedReceipt;',
    'const receipt = estimatedReceipt;');
  const p = await run({ actual_receipt_yuan: '26' }, { derivePatch: () => D });
  ok('G-① 变异「实收被忽略」⇒ 利润变回 12.00（断言能抓住这个人最容易写错的地方）',
    p.data.result.cash.profit_fen === 1200, 'profit=' + p.data.result.cash.profit_fen + '（期望 1200 = 估算值）');
}

{
  // 变异 2：到手率条件去掉 !isActual ⇒ 实测模式会印出一个百分比
  const D = deriveMutated(
    'const receiptRate = (!isActual && payment > 0) ? Math.round((receipt / payment) * 10000) / 100 : null;',
    'const receiptRate = payment > 0 ? Math.round((receipt / payment) * 10000) / 100 : null;');
  const p = await run({ actual_receipt_yuan: '26' }, { derivePatch: () => D });
  ok('G-② 变异「到手率不判实测模式」⇒ 凭空印出 26/34=76.47%，断言转红',
    p.data.result.cash.receipt_rate !== null, 'receipt_rate=' + p.data.result.cash.receipt_rate);
}

{
  // 变异 3：边界判据 >0 改成 >=0 ⇒ 填 0 会被当成"实收 0 元"，利润变负
  const D = deriveMutated(
    'const isActual = actualReceipt > 0;',
    'const isActual = actualReceipt >= 0;');
  const p = await run({ actual_receipt_yuan: '0' }, { derivePatch: () => D });
  ok('G-③ 变异「0 也算填了」⇒ is_actual 变真、利润算出 −12.00，断言转红',
    p.data.view.is_actual === true, 'is_actual=' + p.data.view.is_actual + ' profit=' + p.data.view.profit);
}

{
  // 变异 4：总额法照常出数（不标不可用）⇒ 页面会印 0.00 或第二个假利润
  const D = deriveMutated(
    'const accrualAvailable = !isActual;',
    'const accrualAvailable = true;');
  const p = await run({ actual_receipt_yuan: '26' }, { derivePatch: () => D });
  ok('G-④ 变异「总额法照常出数」⇒ available 变真、页面印出第二个利润，断言转红',
    p.data.result.accrual.available === true && p.data.view.revenue !== '',
    'available=' + p.data.result.accrual.available + ' revenue=' + p.data.view.revenue);
}

{
  // 变异 5：页面模板去掉 is_actual 条件（逻辑对但显示错）—— 静态判据必须抓到。
  // 判据分两步：① 变异真的发生了；② F-② 用的那条正则在变异体上**确实不匹配**。
  // 只查①的话，"判据恒真"这种病会被漏掉（改坏了它居然还绿）。
  const F2RE = /wx:if="\{\{!view\.is_actual\}\}"[^>]*>[\s\S]{0,200}?t\.receiptRate/;
  const wBad = wxml.replace(
    /<view class="cell" wx:if="\{\{!view\.is_actual\}\}"><text class="lbl">\{\{t\.receiptRate\}\}/,
    '<view class="cell"><text class="lbl">{{t.receiptRate}}');
  ok('G-⑤ 变异「模板去掉到手率条件」⇒ 变异生效且 F-② 判据转红（判据不是恒真）',
    wBad !== wxml && !F2RE.test(wBad),
    '变异生效=' + (wBad !== wxml) + '，判据在变异体上=' + (F2RE.test(wBad) ? '仍绿（假绿！）' : '已转红'));
}

// ===================== 收尾 =====================
console.log('\n============================================================');
const total = pass + problems.length;
console.log('===== 外卖页「本单实收」守卫结果：' + pass + ' 通过 / ' + problems.length + ' 失败 =====');
if (problems.length) process.exit(1);
process.exit(0);
})().catch((e) => {
  console.error('\n💥 守卫自身异常：' + (e && e.stack || e));
  process.exit(1);
});
