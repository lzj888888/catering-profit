#!/usr/bin/env node
// tools/check_pay_orders_stub.js —— R1-8（台账）订单记录页行为守卫
//
// 为什么需要它：`subpkg/tools/pay/orders.js` 此前零桩，只有静态形状守卫提及。
//   它不参与算钱，但它是**唯一会表态「售卖虚拟商品」的页面**，三道门任何一道漏了
//   都是提审/合规问题，而且**页面不会报错**：
//
//   🔴 showRenew 三重门 = PAYWALL_ENABLED && !isIOS() && (expire_at===0 || days_left<=30)
//      · 提审期（PAYWALL_ENABLED=false）入口一旦可见 = 在小程序内售卖虚拟商品的表态；
//      · R45：iOS 端不得在小程序内购买虚拟商品（苹果审核红线）；
//      · 长期有效（days_left>30）不该天天挂「续费」打扰老板。
//   🔴 onRenew 还有**第二道纵深**：入口已隐藏，函数内再拦一次
//      —— 防 wxml 改版 / deep link 直达漏网。静态守卫看不到「纵深有没有真执行」。
//   🔴 权益查询失败必须**静默吞掉**（不该让订单列表跟着白屏），但订单接口失败要提示。
//
// 取证层级：L2 页面桩（Page/wx/getApp/依赖全桩，真跑页面源码）。
//   ⚠️ 不替代真机：验的是「渲染什么 / 门控放不放行 / 提交什么载荷」，不验视觉。
//
// 运行：node tools/check_pay_orders_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/tools/pay/orders.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 可变量 ----------
let payFlag = false;        // PAYWALL_ENABLED
let iosFlag = false;        // isIOS()
let entResp = null;         // fetchEntitlement 出参；null = 用默认
let entThrows = false;
let orderResp = { list: [] };
let orderThrows = false;
let renewResp = { enable_real_payment: false };
let renewThrows = false;
let seen = {};
let cfg = null;
let appStub = null;

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls = (seen.calls || []).concat({ name, params });
    if (name === 'payOrderList') { if (orderThrows) throw new Error('stub: 订单列表失败'); return orderResp; }
    if (name === 'payRenew') { if (renewThrows) throw new Error('stub: 续费下单失败'); return renewResp; }
    return {};
  },
  fenToYuan: (fen, digits) => {
    const v = (Number(fen) || 0) / 100;
    return v.toFixed(digits === undefined ? 2 : digits);
  },
  toastError: (e) => { seen.toastError = (seen.toastError || 0) + 1; seen.lastErr = e && (e.msg || e.message); },
};
const mockUi = { setTitle: (t) => { seen.title = t; } };
const mockEntitle = {
  fetchEntitlement: async () => {
    if (entThrows) throw new Error('stub: 权益查询失败');
    return entResp || { expire_at: 0, is_active: false, days_left: 0 };
  },
  beijingDate: (ms) => '2026-12-31',
  isPaid: () => false,
  expireSoonDays: () => 0,
};
const mockPlatform = { isIOS: () => iosFlag };
const mockFlags = { PAYWALL_ENABLED: false, FREE_ACCESS_MODE: true };
const mockPaywall = { showNotOpen: () => { seen.showNotOpen = (seen.showNotOpen || 0) + 1; }, openPaywall: () => {} };

const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
  '../../../utils/entitlement.js': mockEntitle,
  '../../../utils/platform.js': mockPlatform,
  '../../../utils/featureFlags.js': mockFlags,
  '../../../utils/paywall.js': mockPaywall,
  '../../../miniprogram/i18n/terms.js': { TERMS },
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
  mockFlags.PAYWALL_ENABLED = payFlag;
  mockFlags.FREE_ACCESS_MODE = !payFlag;
  appStub = { globalData: { shop_id: 'shop_test' } };
  global.getApp = () => appStub;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：pay/orders.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() {
  seen = {}; entResp = null; entThrows = false;
  orderResp = { list: [] }; orderThrows = false;
  renewResp = { enable_real_payment: false }; renewThrows = false;
}

global.Page = (c) => { cfg = c; };
global.wx = {
  showToast: (o) => { seen.toasts = (seen.toasts || []).concat([o]); },
  showModal: (o) => { seen.modals = (seen.modals || []).concat([o]); },
  stopPullDownRefresh: () => { seen.stopped = true; },
};

// 一组订单样本：覆盖三种状态 + 有/无支付时间
const ORDERS = [
  { order_no: 'NO001', plan_name: '月卡', amount_fen: 2200000, channel: 'wechat', status: 'paid', paid_at: 1762000000000 },
  { order_no: 'NO002', plan_name: '季卡', amount_fen: 5900000, channel: 'manual', status: 'pending', paid_at: 0 },
  { order_no: 'NO003', plan_name: '', amount_fen: 990000, channel: '', status: 'manual', paid_at: null },
];

(async () => {
  console.log('[R1-8] 订单记录页行为守卫（三重门 / 纵深拦截 / 失败降级 / 载荷）');
  const SRC = fs.readFileSync(PAGE, 'utf8');
  loadCfg();

  // =====================================================
  // A · load 装配
  // =====================================================
  sec('A · load 装配（订单只读展示，不参与算钱）');

  reset(); payFlag = false; iosFlag = false;
  orderResp = { list: ORDERS };
  let p = fresh(loadCfg());
  await p.load();
  const rows = p.data.orders || [];
  check('A-① 订单条数与关键字段透传（order_no / plan_name / channel / status）',
    rows.length === 3 && rows[0].order_no === 'NO001' && rows[0].plan_name === '月卡'
    && rows[0].channel === 'wechat' && rows[0].status === 'paid',
    'rows=' + rows.length);
  check('A-② 金额按「分 → 元 两位小数」展示（2200000 ⇒ 22000.00）',
    rows[0].amount === '22000.00' && rows[2].amount === '9900.00',
    JSON.stringify(rows.map((r) => r.amount)));
  check('A-③ 状态三态映射（paid / pending / 其它 ⇒ 人工）',
    rows[0].status_text === TERMS.pay.statusPaid && rows[1].status_text === TERMS.pay.statusPending
    && rows[2].status_text === TERMS.pay.statusManual,
    JSON.stringify(rows.map((r) => r.status_text)));
  check('A-④ 无支付时间 ⇒ 破折号（不渲染 undefined / Invalid Date）',
    rows[1].paid_at === '—' && rows[2].paid_at === '—',
    JSON.stringify(rows.map((r) => r.paid_at)));
  check('A-⑤ 空方案名/空渠道 ⇒ 空串兜底', rows[2].plan_name === '' && rows[2].channel === '');
  check('A-⑥ 成功后 loading 收起 + 标题来自术语单源',
    p.data.loading === false && seen.title === TERMS.pay.orderTitle, 'title=' + seen.title);
  check('A-⑦ 页面调 api.fenToYuan 而非自己算（静态锁，防止桩实现与真身脱节）',
    /api\.fenToYuan\(o\.amount_fen,\s*2\)/.test(SRC));

  reset(); payFlag = false;
  entThrows = true; orderResp = { list: ORDERS };
  p = fresh(loadCfg());
  let aErr = null;
  try { await p.load(); } catch (e) { aErr = e; }
  check('A-⑧ 🔴 权益查询失败**不阻断**订单列表（静默吞掉），且没有 toast',
    aErr === null && p.data.orders.length === 3 && p.data.loading === false && !seen.toastError,
    aErr ? aErr.message : 'orders=' + p.data.orders.length + ' toastError=' + (seen.toastError || 0));

  reset(); payFlag = false;
  orderThrows = true;
  p = fresh(loadCfg());
  try { await p.load(); } catch (e) { aErr = e; }
  check('A-⑨ 订单接口失败 ⇒ 不崩、loading 收起、有错误提示',
    aErr === null && p.data.loading === false && seen.toastError === 1,
    'toastError=' + (seen.toastError || 0));

  reset(); payFlag = false;
  entResp = { expire_at: 1767000000000, is_active: true, days_left: 90 };
  p = fresh(loadCfg());
  await p.load();
  check('A-⑩ 有到期时间 ⇒ expireText 由 beijingDate 产出（不是原始毫秒数）',
    p.data.expireText === '2026-12-31', 'expireText=' + p.data.expireText);

  reset(); payFlag = false;
  entResp = { expire_at: 0, is_active: false, days_left: 0 };
  p = fresh(loadCfg());
  await p.load();
  check('A-⑪ 无到期时间 ⇒ expireText 空串（不渲染 1970）', p.data.expireText === '');

  // =====================================================
  // B · 续费可见性（三重门）
  // =====================================================
  sec('B · showRenew 三重门');

  const show = async (pf, ios, ent) => {
    reset(); payFlag = pf; iosFlag = ios; entResp = ent; orderResp = { list: [] };
    const q = fresh(loadCfg());
    await q.load();
    return q.data.showRenew;
  };

  check('B-① 🔴 提审期 PAYWALL_ENABLED=false ⇒ 恒不显示（否则等于在小程序内售卖虚拟商品）',
    (await show(false, false, { expire_at: 0, days_left: 0 })) === false);
  check('B-② 开关开 + 非 iOS + 无到期时间 ⇒ 显示（到期后允许续）',
    (await show(true, false, { expire_at: 0, days_left: 0 })) === true);
  check('B-③ 🔴 开关开 + 长期有效（days_left=90）⇒ 不显示（不天天打扰）',
    (await show(true, false, { expire_at: 1767000000000, days_left: 90 })) === false);
  check('B-④ 🔴 开关开 + iOS ⇒ 不显示（R45 苹果审核红线）',
    (await show(true, true, { expire_at: 0, days_left: 0 })) === false);
  check('B-⑤ 开关开 + 非 iOS + 临期（days_left=7）⇒ 显示',
    (await show(true, false, { expire_at: 1767000000000, days_left: 7 })) === true);

  // =====================================================
  // C · onRenew 纵深
  // =====================================================
  sec('C · onRenew 纵深（入口隐藏 ≠ 函数放行）');

  const renew = async (pf, ios, resp, throws) => {
    reset(); payFlag = pf; iosFlag = ios;
    renewResp = resp === undefined ? { enable_real_payment: false } : resp;
    renewThrows = !!throws;
    const q = fresh(loadCfg());
    await q.onRenew();
    return q;
  };

  await renew(false, false);
  const callsOff = (seen.calls || []).filter((c) => c.name === 'payRenew');
  check('C-① 🔴 开关关 ⇒ showNotOpen 且**绝不调 payRenew**（提审期连建单都不允许）',
    seen.showNotOpen === 1 && callsOff.length === 0,
    'showNotOpen=' + (seen.showNotOpen || 0) + ' payRenew=' + callsOff.length);

  await renew(true, true);
  const mIos = (seen.modals || [])[0] || {};
  const callsIos = (seen.calls || []).filter((c) => c.name === 'payRenew');
  check('C-② 🔴 开关开但 iOS ⇒ 弹 iosBlocked 且**不调 payRenew**（纵深再拦一道）',
    mIos.title === TERMS.pay.iosBlockedTitle && callsIos.length === 0,
    'modal=' + mIos.title + ' payRenew=' + callsIos.length);

  await renew(true, false);
  const rn = (seen.calls || []).filter((c) => c.name === 'payRenew')[0];
  check('C-③ 开关开 + 非 iOS ⇒ 真调 payRenew，载荷带 plan_id / channel / 幂等键',
    !!rn && rn.params.plan_id === 'plan_basic_month' && rn.params.channel === 'wechat'
    && /^rn_/.test(rn.params.client_request_id),
    rn ? JSON.stringify(rn.params) : '未调用');

  const modalCs = (seen.modals || [])[0] || {};
  check('C-④ enable_real_payment=false ⇒ 弹「联系客服开通」（私域阶段不假装能付）',
    modalCs.title === TERMS.pay.contactService && modalCs.content === TERMS.pay.contactServiceHint,
    'modal=' + modalCs.title);

  await renew(true, false, { enable_real_payment: true });
  check('C-⑤ enable_real_payment=true ⇒ 不弹客服窗（不误导）',
    (seen.modals || []).length === 0, 'modals=' + (seen.modals || []).length);

  let cErr = null;
  try { await renew(true, false, {}, true); } catch (e) { cErr = e; }
  check('C-⑥ 下单接口抛错 ⇒ 不崩 + toastError',
    cErr === null && seen.toastError === 1, 'toastError=' + (seen.toastError || 0));

  reset(); payFlag = false; orderResp = { list: [] };
  p = fresh(loadCfg());
  p.onPullDownRefresh();
  // 页面写的是 this.load().then(...)，函数本身不返回 Promise ⇒ await 等不到，
  // 必须显式让出一次微任务队列（这是守卫的写法问题，不是产品缺陷）
  await new Promise((r) => setTimeout(r, 0));
  check('C-⑦ 下拉刷新 ⇒ 重新 load 且收起刷新动画', seen.stopped === true && p.data.loading === false);

  // =====================================================
  // D · 界面契约
  // =====================================================
  sec('D · 界面契约');

  loadCfg();
  const t = cfg.data.t;
  const emptyKeys = Object.keys(t).filter((k) => !String(t[k] || '').trim());
  check('D-① t 无空键（wxml 用到的文案漏登记 ⇒ 静默空白）',
    emptyKeys.length === 0, '空键=' + JSON.stringify(emptyKeys));
  check('D-② 关键文案取自术语单源（不页内硬编码）',
    t.title === TERMS.pay.orderTitle && t.renew === TERMS.pay.renew && t.empty === TERMS.pay.empty);
  check('D-③ t 键数量与 wxml 引用一致（防漏登的粗粒度兜底）', Object.keys(t).length >= 17,
    'keys=' + Object.keys(t).length);

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

  // M-1 去掉提审期门 ⇒ 开关关也显示续费
  await mut('M-1 去掉 PAYWALL_ENABLED 门',
    'showRenew: PAYWALL_ENABLED && !isIOS() && (ent.expire_at === 0 || ent.days_left <= 30),',
    'showRenew: !isIOS() && (ent.expire_at === 0 || ent.days_left <= 30),',
    () => { reset(); payFlag = false; iosFlag = false; entResp = { expire_at: 0, days_left: 0 }; orderResp = { list: [] }; },
    async (mc) => {
      const q = fresh(mc); await q.load();
      return { degraded: q.data.showRenew === true, detail: 'B-① 提审期竟显示续费：showRenew=' + q.data.showRenew };
    });

  // M-2 去掉 iOS 门
  await mut('M-2 去掉 !isIOS() 门',
    'showRenew: PAYWALL_ENABLED && !isIOS() && (ent.expire_at === 0 || ent.days_left <= 30),',
    'showRenew: PAYWALL_ENABLED && (ent.expire_at === 0 || ent.days_left <= 30),',
    () => { reset(); payFlag = true; iosFlag = true; entResp = { expire_at: 0, days_left: 0 }; orderResp = { list: [] }; },
    async (mc) => {
      const q = fresh(mc); await q.load();
      return { degraded: q.data.showRenew === true, detail: 'B-④ iOS 竟显示续费：showRenew=' + q.data.showRenew };
    });

  // M-3 去掉 onRenew 的开关纵深
  await mut('M-3 去掉 onRenew 提审期纵深',
    'if (!PAYWALL_ENABLED) return showNotOpen();',
    'if (false) return showNotOpen();',
    () => { reset(); payFlag = false; iosFlag = false; renewResp = { enable_real_payment: false }; },
    async (mc) => {
      const q = fresh(mc); await q.onRenew();
      const n = (seen.calls || []).filter((c) => c.name === 'payRenew').length;
      return { degraded: !seen.showNotOpen && n > 0, detail: 'C-① 提审期竟建单：payRenew=' + n + ' showNotOpen=' + (seen.showNotOpen || 0) };
    });

  // M-4 放宽到期窗口 ⇒ 长期有效也挂续费
  await mut('M-4 放宽临期窗口到 999 天',
    'ent.days_left <= 30', 'ent.days_left <= 999',
    () => { reset(); payFlag = true; iosFlag = false; entResp = { expire_at: 1767000000000, days_left: 90 }; orderResp = { list: [] }; },
    async (mc) => {
      const q = fresh(mc); await q.load();
      return { degraded: q.data.showRenew === true, detail: 'B-③ 长期有效竟显示续费：showRenew=' + q.data.showRenew };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e && (e.stack || e.message)); process.exit(2); });
