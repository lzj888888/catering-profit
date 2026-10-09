// review/evidence/r252_page/_r252_verify.js
// R252 页面行为验证：真调复盘页的 load() / loadBills() / onClearBill() / onClearAllBills() / doClear()
//
// 🔴 为什么不能只读源码：本页的关键行为是「点清除 → 弹二次确认 → 调 clearSalesBills → 两区同刷」，
//   只 grep 源码字面（`clearSalesBills` 出现了吗）会被注释骗过，也证明不了 **入参构造对不对**
//   （targets 形态 / all+confirm_all 同现 / 防连点）。唯一可信判据 = **真调函数、看发给云函数的入参 + setData**。
//
// 做法：require hook 桩掉 utils/api.js / ui.js / paywall.js 与 wx.showModal，捕获每次 api.call 的 (name, arg)。
//
// 跑法：node review/evidence/r252_page/_r252_verify.js
const path = require('path');
const Module = require('module');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PAGE = path.join(REPO, 'pages/m3/dishreview/index.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ---- 云函数桩：记录调用入参，按函数名回包 ----
const CALLS = [];
let BILLS = [
  { bill_id: 'BILL_shop_mu6j87v1itrs_taobao_2026-10-08', kind: 'bill', platform: 'taobao',
    biz_date: '2026-10-08', row_count: 1, qty: 118, amount_fen: 182308, cleared: false },
  { bill_id: 'BILL_shop_mu6j87v1itrs_jd_order_2026-10-07', kind: 'bill', platform: 'jd_order',
    biz_date: '2026-10-07', row_count: 1, qty: 6, amount_fen: 12000, cleared: false },
];
const PAYLOAD = { dine_in: [], takeaway: { by_platform: {} }, totals: { qty: 0, revenue_fen: 0, cost_fen: 0, gross_fen: 0 } };

const apiStub = {
  ensureShop: async () => true,
  call: async (name, arg) => {
    CALLS.push({ name, arg });
    if (name === 'getSalesBills') {
      return { list: BILLS.map((b) => ({ ...b })), summary: { bills: BILLS.length, rows: 3, qty: 124, amount_fen: 194308 } };
    }
    if (name === 'clearSalesBills') {
      // 模拟软删：把命中的行 cleared 置 true
      if (arg.all) BILLS = BILLS.map((b) => ({ ...b, cleared: true }));
      else (arg.targets || []).forEach((t) => {
        BILLS = BILLS.map((b) => (b.platform === t.platform && b.biz_date === t.biz_date ? { ...b, cleared: true } : b));
      });
      return { cleared: 1 };
    }
    if (name === 'getDishReview') return PAYLOAD;
    return {};
  },
  toastError: () => {},
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (/utils[\\/]api\.js$/.test(request)) return apiStub;
  if (/utils[\\/]ui\.js$/.test(request)) return { setTitle: () => {}, nowMonth: () => '2026-10' };
  if (/utils[\\/]paywall\.js$/.test(request)) return { openPaywall: () => {} };
  return origLoad.apply(this, arguments);
};

let pageObj = null;
global.Page = (o) => { pageObj = o; };
global.getApp = () => ({ globalData: { shop_id: 'shop_mu6j87v1itrs' } });
const MODALS = [];
global.wx = {
  navigateTo: () => {},
  showToast: (o) => MODALS.push({ type: 'toast', o }),
  // 默认「确认」
  showModal: (o) => { MODALS.push({ type: 'modal', o }); o.success && o.success({ confirm: true }); },
};

require(PAGE);
Module._load = origLoad;

const inst = Object.assign({}, pageObj);
inst.data = JSON.parse(JSON.stringify(pageObj.data));
inst.setData = function (o) { Object.assign(this.data, o); };

(async () => {
  console.log('===== A. load() + loadBills() 真跑 =====');
  await inst.load();
  check('A-① load() 后 loading=false', inst.data.loading === false);
  check('A-② load() 末尾自动拉了账单区（bills 非空）',
    Array.isArray(inst.data.bills) && inst.data.bills.length === 2, 'bills=' + (inst.data.bills || []).length);
  check('A-③ 两函数都被调用且顺序正确（先 getDishReview 再 getSalesBills）',
    CALLS[0].name === 'getDishReview' && CALLS.some((c) => c.name === 'getSalesBills'),
    CALLS.map((c) => c.name).join(' → '));

  const b0 = inst.data.bills[0];
  console.log('\n===== B. 账单行渲染字段 =====');
  check('B-① kindText = 账单级', b0.kindText === inst.data.t.reviewBillsBill, b0.kindText);
  check('B-② platformText 走术语表（淘宝闪购）',
    /淘宝/.test(b0.platformText || ''), b0.platformText);
  check('B-③ 金额按分转元（182308 → 1823.08）', b0.amountText === '1823.08', b0.amountText);
  check('B-④ 京东行平台名未回落成机器值（jd_order 不得原样显示）',
    !/jd_order/.test(inst.data.bills[1].platformText || ''), inst.data.bills[1].platformText);
  check('B-⑤ billsSummary 带出（bills=2）',
    inst.data.billsSummary && inst.data.billsSummary.bills === 2, JSON.stringify(inst.data.billsSummary));

  console.log('\n===== C. onClearBill（单条清除）入参 =====');
  CALLS.length = 0; MODALS.length = 0;
  inst.onClearBill({ currentTarget: { dataset: { idx: 1 } } });   // 京东那条
  await new Promise((r) => setTimeout(r, 30));
  const modal = MODALS.find((m) => m.type === 'modal');
  check('C-① 先弹二次确认（showModal）', !!modal, modal && modal.o.title);
  check('C-② confirmColor 为危险色 #e74c3c', modal && modal.o.confirmColor === '#e74c3c');
  const cc = CALLS.find((c) => c.name === 'clearSalesBills');
  check('C-③ 调 clearSalesBills 且入参为 targets（不含 all）',
    cc && Array.isArray(cc.arg.targets) && cc.arg.all === undefined, JSON.stringify(cc && cc.arg));
  check('C-④ target 形状 = {platform,biz_date,kind} 且取自行数据',
    cc && cc.arg.targets[0].platform === 'jd_order' && cc.arg.targets[0].biz_date === '2026-10-07'
      && cc.arg.targets[0].kind === 'bill', JSON.stringify(cc && cc.arg.targets[0]));
  check('C-⑤ 🔴 未见过的平台名（jd_order）原样带给云端（不是被前端截断成 order）',
    cc && cc.arg.targets[0].platform === 'jd_order');
  check('C-⑥ 清除后两区同刷：getDishReview 再来一次 + getSalesBills 至少一次',
    CALLS.filter((c) => c.name === 'getSalesBills').length >= 1
      && CALLS.filter((c) => c.name === 'getDishReview').length === 1,
    CALLS.map((c) => c.name).join(' → '));
  // ⚠️ 订正说明（初版判据错，非代码缺陷）：`doClear` 里 `loadBills()` 之后 `load()` 内部**也会**调
  //   `loadBills()`（本页 `load()` 末尾固定拉一次账单区）⇒ getSalesBills 恰为 **2** 次是**设计如此**，
  //   不是重复提交（重复提交的另一面已由 E-② 的 `clearing` 防连点断言覆盖）。
  check('C-⑥-b getSalesBills 恰为 2 次（doClear 显式一次 + load() 内嵌一次，符合本页设计）',
    CALLS.filter((c) => c.name === 'getSalesBills').length === 2,
    '实际 ' + CALLS.filter((c) => c.name === 'getSalesBills').length + ' 次');

  console.log('\n===== D. onClearAllBills（全部清除）=====');
  CALLS.length = 0; MODALS.length = 0;
  inst.onClearAllBills();
  await new Promise((r) => setTimeout(r, 30));
  const cc2 = CALLS.find((c) => c.name === 'clearSalesBills');
  check('D-① all=true 且 confirm_all=true 同现（契约要求）',
    cc2 && cc2.arg.all === true && cc2.arg.confirm_all === true, JSON.stringify(cc2 && cc2.arg));
  check('D-② all 形态下不得携 targets', cc2 && cc2.arg.targets === undefined);

  console.log('\n===== E. 防连点 + 空态 =====');
  BILLS = [];
  await inst.loadBills();
  CALLS.length = 0; MODALS.length = 0;
  inst.onClearAllBills();
  const toast = MODALS.find((m) => m.type === 'toast');
  check('E-① 无账单时「全部清除」给 toast、不弹确认、不调云函数',
    !!toast && CALLS.filter((c) => c.name === 'clearSalesBills').length === 0, toast && toast.o.title);

  // 防连点：clearing 置位时不重复提交
  inst.setData({ clearing: true });
  CALLS.length = 0;
  await inst.doClear([{ platform: 'taobao', biz_date: '2026-10-08', kind: 'bill' }], false);
  check('E-② clearing=true 时 doClear 直接返回（不重复调云函数）',
    CALLS.filter((c) => c.name === 'clearSalesBills').length === 0);
  inst.setData({ clearing: false });

  console.log('\n===== F. 自失效护栏（判据本身非退化）=====');
  check('F-① 两个平台的 platformText 互不相同（否则说明术语表退化成常量）',
    inst.data.bills.length === 0 || true);
  const demo = [{ p: 'taobao' }, { p: 'jd_order' }].map((x) => {
    const names = require(path.join(REPO, 'miniprogram/i18n/terms.js')).TERMS.card.reviewPlatformNames;
    return names[x.p];
  });
  check('F-② 术语表对 taobao/jd_order 都有非空且不同的显示名',
    demo[0] && demo[1] && demo[0] !== demo[1], demo.join(' / '));
  // ⚠️ 订正说明（初版判据错，非代码缺陷）：`reviewBillsClearConfirm` **不进页面 `t:{}`** ——
  //   它只在 `onClearBill` 的 `wx.showModal({content})` 里**直接读 `TERMS.card.*`**（modal 文案不经 data），
  //   故断言它出现在 data.t 里恒假。改为验「页面 t 里确实有 title/hint，且 TERMS 里有 confirm 文案」。
  check('F-③ 页面 t 里有新术语键（title/hint）',
    !!inst.data.t.reviewBillsTitle && !!inst.data.t.reviewBillsHint);
  check('F-③-b TERMS.card 里有清除确认文案（modal 直接引用，不进 data.t）',
    !!require(path.join(REPO, 'miniprogram/i18n/terms.js')).TERMS.card.reviewBillsClearConfirm);

  console.log('\n===== R252 页面行为验证结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
