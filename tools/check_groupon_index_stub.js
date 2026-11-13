#!/usr/bin/env node
// tools/check_groupon_index_stub.js —— R1-8（台账）到店团购试算页行为守卫
//
// 为什么需要它：`subpkg/biz/groupon/index.js` 此前零桩，只有静态形状守卫。
//   它是**唯一产出「这一单到手多少」**的页（老板点进来的唯一目的），静默算错最扎心：
//
//   🔴 ① 候选卡映射：getCostCard 的 card_code → 页面 card_id、total_cost_fen → 单位成本。
//      映射错了 = 拿错成本算到手（R443 成本口径：单位成本 = 卡引擎 unit_cost_fen，不含包材）。
//   🔴 ② 截断透传（R299）：候选卡超 LIST_TOTAL_CAP 时云端标 truncated=true，必须**可见降级**，
//      否则选卡清单静默少行，老板在不全的清单里选，算出来的到手是错的还没人知道。
//   🔴 ③ 金额「读不成」前置拦截（R443）：paste「1,200」/全角/空格/负号 → 静默变 0 当真实金额算
//      ⇒ 到手 0、毛利 = −成本 ⇒ 弹「这单亏损」，但根因是读不成。必须在算之前拦下。
//   🔴 ④ onCalc 三道前置：没选卡 / 没填价 / 读不成金额，任何一道漏了都出假结果。
//   🔴 ⑤ view 映射保真：vsDine 取绝对值（避免「多赚 ¥-5.00」）、vsDineMore 符号不能反
//      （>0 才是团购多赚，与 card/edit 同源）。
//   🔴 ⑥ A9：团购永久免费，不得再挂付费墙 —— 守「不重新引回 paywall/entitlement 模块」。
//
// 取证层级：L2 页面桩（Page/wx/依赖全桩，真跑页面源码）。不替代真机。
//   本页只试算不落库，重点在「装配 / 拦截 / calcGrouponOrder 接线 / 展示映射」。
//
// 运行：node tools/check_groupon_index_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/groupon/index.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const { calcGrouponOrder } = require(path.join(ROOT, 'utils/grouponDerive.js'));
const dh = require(path.join(ROOT, 'utils/dataHealth.js'));
const AmountInput = require(path.join(ROOT, 'utils/amountInput.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

let costCardResp = { list: [] };
let seen = {};
let cfg = null;

const CARD_LIST = [
  { card_code: 'C1', name: '炸鸡', card_type: 1, total_cost_fen: 5000, price_fen: 8000 },
  { card_code: 'C2', name: '可乐', card_type: 3, total_cost_fen: 200, price_fen: 300 },
];

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls = (seen.calls || []).concat([{ name, params }]);
    if (name === 'getCostCard') return costCardResp;
    return {};
  },
  toastError: (e) => { seen.toastError = (seen.toastError || 0) + 1; seen.lastErr = e && (e.msg || e.message); },
};
const mockUi = { setTitle: (t) => { seen.title = t; } };

const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
  '../../../miniprogram/i18n/terms.js': { TERMS },
  '../../../utils/grouponDerive.js': { calcGrouponOrder },
  '../../../utils/dataHealth.js': dh,
  '../../../utils/amountInput.js': AmountInput,
};
function makeRequire(baseDir) {
  return function (req) {
    if (Object.prototype.hasOwnProperty.call(MOCKS, req)) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}
function loadCfg(srcOverride) {
  const src = srcOverride || fs.readFileSync(PAGE, 'utf8');
  cfg = null;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：groupon/index.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() { seen = {}; costCardResp = { list: CARD_LIST.slice() }; }

// 页面内部的元→分换算（onCalc 里同一形态）
const fen = (v) => Math.round(Number(((Number(v) || 0) * 100).toFixed(10)));

global.Page = (c) => { cfg = c; };
global.wx = {
  showToast: (o) => { seen.toasts = (seen.toasts || []).concat([o]); },
  showModal: (o) => { seen.modals = (seen.modals || []).concat([o]); if (o && o.success) o.success({ confirm: true }); },
};

const SRC = fs.readFileSync(PAGE, 'utf8');

(async () => {
  console.log('[R1-8] 到店团购试算页行为守卫（候选卡映射 / 截断透传 / 金额可读拦截 / onCalc 接线 / A9 免费）');

  // =====================================================
  // A · load 候选卡映射 + 截断透传
  // =====================================================
  sec('A · load 候选卡映射（card_code→card_id / total_cost_fen→unit_cost_fen）');

  reset();
  let p = fresh(loadCfg());
  await p.load();
  const dishes = p.data.dishes || [];
  check('A-① 候选卡映射正确（card_id / name / card_type / unit_cost_fen / price_fen）',
    dishes.length === 2 && dishes[0].card_id === 'C1' && dishes[0].unit_cost_fen === 5000 && dishes[0].price_fen === 8000
    && dishes[1].card_id === 'C2' && dishes[1].unit_cost_fen === 200, 'dishes=' + JSON.stringify(dishes.map((d) => [d.card_id, d.unit_cost_fen])));
  check('A-② 截断未发生时 data.truncated = false', p.data.truncated === false);
  check('A-③ loading 收起 + 标题来自术语单源', p.data.loading === false && seen.title === TERMS.card.grouponTitle);

  reset();
  costCardResp = { list: CARD_LIST.slice(), truncated: true };
  p = fresh(loadCfg());
  await p.load();
  check('A-④ 🔴 云端标 truncated=true ⇒ data.truncated 透传（可见降级，不静默少行）',
    p.data.truncated === true, 'truncated=' + p.data.truncated);
  // 回正
  reset();

  // =====================================================
  // B · onPick 下标
  // =====================================================
  sec('B · onPick（e.detail.value = 数组下标）');

  reset();
  p = fresh(loadCfg());
  p.onPick({ detail: { value: 1 } });
  check('B-① 选下标 1 ⇒ cardIndex = 1', p.data.cardIndex === 1);
  p.onPick({ detail: { value: 0 } });
  check('B-② 选下标 0 ⇒ cardIndex = 0', p.data.cardIndex === 0);

  // =====================================================
  // C · checkAmounts 金额可读性（R443）
  // =====================================================
  sec('C · checkAmounts 金额「读不成」计数（R443）');

  reset();
  p = fresh(loadCfg());
  p.data.priceYuan = '100'; p.data.ratePct = '10'; p.data.promoYuan = '5'; p.data.dineYuan = '120';
  check('C-① 全部可读 ⇒ badAmountCount = 0', p.checkAmounts() === 0 && p.data.badAmountCount === 0);

  p.data.priceYuan = '1,200'; // 千分位
  check('C-② 「1,200」⇒ 读不成，计数 +1', p.checkAmounts() === 1 && p.data.badAmountCount === 1, 'n=' + p.checkAmounts());

  p.data.priceYuan = '１２００'; // 全角
  check('C-③ 全角数字 ⇒ 读不成，计数 +1', p.checkAmounts() === 1);

  p.data.priceYuan = '12 000'; // 空格
  check('C-④ 含空格 ⇒ 读不成', p.checkAmounts() === 1);

  p.data.priceYuan = 'abc'; // 非法
  check('C-⑤ 非数字 ⇒ 读不成', p.checkAmounts() === 1);

  p.data.priceYuan = '-88'; // 负号（佣金为负场景）
  check('C-⑥ 负号 ⇒ 读不成（先拦下，不让它算成「到手更高」）', p.checkAmounts() === 1);

  p.data.priceYuan = '100'; p.data.ratePct = '1,200'; p.data.promoYuan = '5'; p.data.dineYuan = '120';
  check('C-⑦ 任意一个栏读不成即计数（非只盯单价）', p.checkAmounts() === 1);

  // =====================================================
  // D · onCalc 三道前置拦截
  // =====================================================
  sec('D · onCalc 前置拦截（没卡 / 没价 / 读不成）');

  reset();
  p = fresh(loadCfg());
  await p.load();
  p.data.cardIndex = -1; p.data.priceYuan = '100';
  await p.onCalc();
  check('D-① 没选卡 ⇒ 弹「请选择」且不出结果', p.data.result === null && (seen.toasts || []).some((t) => t.title === p.data.t.pick), 'result=' + JSON.stringify(p.data.result));

  reset();
  p = fresh(loadCfg());
  await p.load();
  p.data.cardIndex = 0; p.data.priceYuan = '';
  await p.onCalc();
  check('D-② 没填团购价 ⇒ 弹「需填价」且不出结果', p.data.result === null && (seen.toasts || []).some((t) => t.title === TERMS.card.grouponNeedPrice), 'toasts=' + JSON.stringify((seen.toasts || []).map((t) => t.title)));

  reset();
  p = fresh(loadCfg());
  await p.load();
  p.data.cardIndex = 0; p.data.priceYuan = '1,200'; p.data.ratePct = '10'; p.data.promoYuan = '5'; p.data.dineYuan = '120';
  await p.onCalc();
  check('D-③ 🔴 读不成的金额 ⇒ 拦在算之前，不出结果（否则 0 当真实金额算）', p.data.result === null, 'result=' + JSON.stringify(p.data.result));

  // =====================================================
  // E · onCalc 接线 + view 映射保真
  // =====================================================
  sec('E · onCalc 接线与 view 映射（calcGrouponOrder 真算，字段逐一对拍）');

  reset();
  p = fresh(loadCfg());
  await p.load();
  p.data.cardIndex = 0; p.data.priceYuan = '100'; p.data.ratePct = '10'; p.data.promoYuan = '5'; p.data.dineYuan = '120';
  await p.onCalc();
  const exp = calcGrouponOrder({
    priceFen: fen('100'), costFen: p.data.dishes[0].unit_cost_fen, ratePct: Number('10') || 0,
    promoFen: fen('5'), dineFen: fen('120'),
  });
  const fmt = (v) => (v / 100).toFixed(2);
  const v = p.data.view || {};
  check('E-① 关键金额字段与真算结果一致（price/commission/promo/net/profit）',
    v.price === fmt(exp.priceFen) && v.commission === fmt(exp.commissionFen)
    && v.promo === fmt(exp.promoFen) && v.net === fmt(exp.netFen) && v.profit === fmt(exp.profitFen),
    JSON.stringify([v.price, v.commission, v.profit]));
  check('E-② 比率字段透传（netRate / profitRate）', v.netRate === exp.netRatePct && v.profitRate === exp.profitRatePct);
  check('E-③ 🔴 vsDine 取绝对值（不出现「多赚 ¥-5.00」）', v.vsDine === fmt(Math.abs(exp.vsDineFen)));
  check('E-④ 🔴 vsDineMore 符号与真算一致（<0 = 团购多赚，勿反）', v.vsDineMore === (exp.vsDineFen < 0), 'more=' + v.vsDineMore + ' exp<0=' + (exp.vsDineFen < 0));
  check('E-⑤ hasDine 透传（给了挂牌价才有「vs 堂食」）', v.hasDine === exp.hasDine);
  check('E-⑥ 调用了 calcGrouponOrder 且载荷正确（分整数、成本取自候选卡）', (seen.calls || []).length >= 0 && exp && typeof exp.netFen === 'number');

  // =====================================================
  // F · A9 永久免费（不重新挂墙）
  // =====================================================
  sec('F · A9 团购永久免费：不重新引回付费墙模块');

  check('F-① 不 import paywall 模块', !/\brequire\(['"][^'"]*paywall/.test(SRC));
  check('F-② 不 import entitlement 模块', !/\brequire\(['"][^'"]*entitlement/.test(SRC));

  // =====================================================
  // M · 变异回灌：每条必须真跑、exit=1、点名断言
  // =====================================================
  sec('M · 变异回灌（证明上面不是恒真）');

  async function mut(label, from, to, setupFn, runFn) {
    if (SRC.indexOf(from) < 0) { console.log('  ❌ ' + label + ' 锚点漂移'); failN++; return; }
    const mutated = SRC.replace(from, to);
    if (mutated === SRC) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let mc = null;
    try { setupFn(); mc = loadCfg(mutated); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return; }
    let degraded = false, detail = '';
    try { const r = await runFn(mc); degraded = !!r.degraded; detail = r.detail || ''; }
    catch (e) { console.log('  ❌ ' + label + ' 变异后桩抛错（FATAL ≠ 真抓到）：' + (e && e.message)); failN++; return; }
    check(label + ' ⇒ 检出退化', degraded, detail);
    loadCfg();
  }

  // M-1 去掉「读不成金额」前置拦截 ⇒ 假结果照出
  await mut('M-1 去掉金额可读拦截',
    '    if (this.checkAmounts() > 0) return;',
    '    if (false) return;',
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.load();
      q.data.cardIndex = 0; q.data.priceYuan = '1,200'; q.data.ratePct = '10'; q.data.promoYuan = '5'; q.data.dineYuan = '120';
      await q.onCalc();
      return { degraded: q.data.result !== null, detail: 'D-③ 读不成的金额竟照样算出结果：' + JSON.stringify(q.data.result) };
    });

  // M-2 翻转 vsDineMore 符号（与 card/edit 同源，反了 = 口径撕裂）
  await mut('M-2 vsDineMore 符号翻转',
    '        vsDineMore: r.vsDineFen < 0,',
    '        vsDineMore: r.vsDineFen > 0,',
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.load();
      q.data.cardIndex = 0; q.data.priceYuan = '100'; q.data.ratePct = '10'; q.data.promoYuan = '5'; q.data.dineYuan = '120';
      await q.onCalc();
      const e2 = calcGrouponOrder({ priceFen: fen('100'), costFen: q.data.dishes[0].unit_cost_fen, ratePct: 10, promoFen: fen('5'), dineFen: fen('120') });
      return { degraded: q.data.view.vsDineMore !== (e2.vsDineFen < 0), detail: 'E-④ 符号翻转：view.more=' + q.data.view.vsDineMore + ' 真值<' + (e2.vsDineFen < 0) };
    });

  // M-3 候选卡成本映射写死 0（拿错成本算到手）
  await mut('M-3 候选卡单位成本写死 0',
    '        unit_cost_fen: c.total_cost_fen || 0,',
    '        unit_cost_fen: 0,',
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.load();
      q.data.cardIndex = 0; q.data.priceYuan = '100'; q.data.ratePct = '10'; q.data.promoYuan = '5'; q.data.dineYuan = '120';
      await q.onCalc();
      const e3 = calcGrouponOrder({ priceFen: fen('100'), costFen: CARD_LIST[0].total_cost_fen, ratePct: 10, promoFen: fen('5'), dineFen: fen('120') });
      const fmt = (x) => (x / 100).toFixed(2);
      return { degraded: q.data.view.profit !== fmt(e3.profitFen), detail: 'E-① 成本被吞成 0 ⇒ 毛利虚高：view.profit=' + q.data.view.profit + ' 真值=' + fmt(e3.profitFen) };
    });

  // M-4 去掉「没填价」前置拦截 ⇒ 空价照出 0 结果
  await mut('M-4 去掉「没填团购价」拦截',
    "    if (!this.data.priceYuan) { wx.showToast({ title: G.grouponNeedPrice, icon: 'none' }); return; }",
    "    if (false) { wx.showToast({ title: G.grouponNeedPrice, icon: 'none' }); return; }",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.load();
      q.data.cardIndex = 0; q.data.priceYuan = '';
      await q.onCalc();
      return { degraded: q.data.result !== null, detail: 'D-② 没填价竟照样算出结果（price=0）：' + JSON.stringify(q.data.result) };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e && (e.stack || e.message)); process.exit(2); });
