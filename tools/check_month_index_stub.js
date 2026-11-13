#!/usr/bin/env node
// tools/check_month_index_stub.js —— R1-8（台账）M1 月度经营首页行为守卫
//
// 为什么需要它：`subpkg/biz/month/index.js` 此前零桩，只有静态形状守卫。
//   它是**每个老板每月必进的总入口**（看本月赚没赚、结账归档），静默错误最伤人：
//
//   🔴 ① 月份下拉构成（R209 同类）：recentMonths(24) ∪ 已建档 ∪ 当前月，倒序去重。
//      若只取 getMonthList 返回的「已建档」月，新店首次只剩当月、补录上月连选项都没有
//      （李老师真机反馈「月份选择只有两个月份」）。
//   🔴 ② 有没有账本 = `!!d.account_id`（R298·C2）。d.result 对无账本月**恒为对象**
//      （getLedger 返回「默认空账」），用 `|| null` 判会恒真 ⇒ 无账本月渲染成一份 0 账本。
//      空月必须 `result=null` 走 `wx:if` 空态卡，否则老板分不清「没数据」还是「加载失败」。
//   🔴 ③ onMonthChange 的 `e.detail.value` 是**选中项下标（数字）**不是月份串
//      （全站其余 selector picker 都是取数组元素，这里是唯一走漏的一处 ⇒ R209 真机「点月就报错」）。
//   🔴 ④ 权限查询失败必须 fail-closed 到免费档（isPaid=false），不能因接口抖一下就升成付费档。
//   🔴 ⑤ 归档/取消归档/清空的载荷必须正确（archive:true/false、confirm:true、月份正确），
//      归档错月是「改了历史报表」级别的错误，清空是软删必须 confirm。
//
// 取证层级：L2 页面桩（Page/wx/getApp/依赖全桩，真跑页面源码）。不替代真机。
//   本页不自己算钱（金额一律取 getLedger 返回的分整数），所以重点在**装配、判定、路由、载荷**。
//
// 运行：node tools/check_month_index_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/month/index.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const profitLabel = require(path.join(ROOT, 'utils/profitLabel.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 可变量 ----------
const CUR_MONTH = '2026-11';
let entResp = null;          // fetchEntitlement 出参；null = 用默认
let entThrows = false;
let seen = {};
let cfg = null;
let appStub = null;

// 建模 getLedger 两种返回：
//   · 有账本月：带 account_id + result（真实账）
//   · 无账本月：getLedger 仍回「默认空账」—— **含 result 对象、无 account_id**（R298·C2 关键事实）
const LEDGER_CUR = {
  account_id: 'ACC_CUR', is_archive: false, switches: { inv: true },
  result: {
    income_total_fen: 100000, expense_total_fen: 60000, gross_profit_fen: 40000,
    gross_margin_pct: 40, operation_ref_profit_fen: 38000,
    total_factor_real_profit_fen: 39000, profit_diff_fen: 1000,
  },
};
const LEDGER_OTHER = {
  is_archive: false, switches: {},
  // 无 account_id，但 result 是默认空账对象（不是 null）—— 这正是 R298·C2 的坑
  result: {
    income_total_fen: 0, expense_total_fen: 0, gross_profit_fen: 0,
    gross_margin_pct: 0, operation_ref_profit_fen: 0,
    total_factor_real_profit_fen: 0, profit_diff_fen: 0,
  },
};

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls = (seen.calls || []).concat([{ name, params }]);
    if (name === 'getMonthList') return { list: [{ month: '2026-09' }, { month: '2026-10' }] };
    if (name === 'getLedger') {
      const m = params && params.month;
      return m === CUR_MONTH ? LEDGER_CUR : LEDGER_OTHER;
    }
    return {};
  },
  fenToYuan: (fen, digits) => {
    const v = (Number(fen) || 0) / 100;
    return v.toFixed(digits === undefined ? 2 : digits);
  },
  toastError: (e) => { seen.toastError = (seen.toastError || 0) + 1; seen.lastErr = e && (e.msg || e.message); },
};
const mockUi = {
  setTitle: (t) => { seen.title = t; },
  nowMonth: () => CUR_MONTH,
  // recentMonths(24)：最近 24 个月（含当月），倒序由页面再排
  recentMonths: (n) => {
    const out = [];
    const d = new Date(2026, 10, 1); // 2026-11
    for (let i = 0; i < (n || 24); i++) {
      out.push(d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1));
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  },
  prevMonth: (m) => {
    const y = Number(String(m).slice(0, 4)), mo = Number(String(m).slice(5, 7));
    const d = new Date(y, mo - 2, 1);
    const mm = d.getMonth() + 1;
    return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm;
  },
};
const mockEntitle = {
  fetchEntitlement: async () => {
    if (entThrows) throw new Error('stub: 权益查询失败');
    return entResp || { expire_at: 0, is_active: false, days_left: 0 };
  },
  isPaid: (ent) => !!(ent && ent.is_active),
  expireSoonDays: (ent) => (ent && ent.days_left) || 0,
};

const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
  '../../../utils/entitlement.js': mockEntitle,
  '../../../miniprogram/i18n/terms.js': { TERMS },
  '../../../utils/profitLabel.js': profitLabel,
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
  appStub = { globalData: { switches: { inv: true } } };
  global.getApp = () => appStub;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：month/index.js');
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
}
function flush() { return new Promise((r) => setTimeout(r, 5)); }

global.Page = (c) => { cfg = c; };
global.wx = {
  showModal: (o) => { seen.modals = (seen.modals || []).concat([o]); if (o && o.success) o.success({ confirm: true }); },
  showToast: (o) => { seen.toasts = (seen.toasts || []).concat([o]); },
  stopPullDownRefresh: () => { seen.stopped = true; },
  navigateTo: (o) => { seen.nav = (seen.nav || []).concat([o]); },
};

const SRC = fs.readFileSync(PAGE, 'utf8');

// 生成一个带账本月的 loadMonth 结果快照（用于比对字段映射）
function expectedResult(ledger) {
  const r = ledger.result;
  const fmt = (v) => (v == null ? '0.00' : mockApi.fenToYuan(v, 2));
  return {
    income_total_fen: r.income_total_fen, expense_total_fen: r.expense_total_fen,
    gross_profit_fen: r.gross_profit_fen, gross_margin_pct: r.gross_margin_pct,
    operation_ref_profit_fen: r.operation_ref_profit_fen,
    total_factor_real_profit_fen: r.total_factor_real_profit_fen, profit_diff_fen: r.profit_diff_fen,
    income_total: fmt(r.income_total_fen), expense_total: fmt(r.expense_total_fen),
    gross_profit: fmt(r.gross_profit_fen), ref_profit: fmt(r.operation_ref_profit_fen),
    true_profit: fmt(r.total_factor_real_profit_fen), profit_diff: fmt(r.profit_diff_fen),
  };
}

(async () => {
  console.log('[R1-8] M1 月度经营首页行为守卫（月份并集 / account_id 判定 / 下标选择 / 权益 fail-closed / 归档载荷）');

  // =====================================================
  // A · bootstrap 月份下拉构成
  // =====================================================
  sec('A · bootstrap 月份下拉（recentMonths ∪ 已建档 ∪ 当前月，去重倒序）');

  reset();
  let p = fresh(loadCfg());
  await p.bootstrap();
  const months = p.data.months || [];
  const sortedDesc = months.slice().sort().reverse();
  check('A-① 月份列表倒序（最新月在最前）', JSON.stringify(months) === JSON.stringify(sortedDesc), months.slice(0, 4).join(','));
  check('A-② 含当前月（即使不在「已建档」里）', months.indexOf(CUR_MONTH) >= 0);
  check('A-③ 含已建档月 2026-09 / 2026-10', months.indexOf('2026-09') >= 0 && months.indexOf('2026-10') >= 0);
  check('A-④ 去重（无重复项）', new Set(months).size === months.length);
  check('A-⑤ curMonth = 当前月，monthIndex 命中其下标', p.data.curMonth === CUR_MONTH && months[p.data.monthIndex] === CUR_MONTH, 'idx=' + p.data.monthIndex);
  check('A-⑥ loading 收起 + 标题来自术语单源', p.data.loading === false && seen.title === TERMS.modules.m1.navTitle);

  // =====================================================
  // B · 有没有账本 = account_id（R298·C2）
  // =====================================================
  sec('B · loadMonth 账本判定（account_id，非 result 恒真）');

  reset();
  p = fresh(loadCfg());
  await p.loadMonth(CUR_MONTH);
  check('B-① 有 account_id 月 ⇒ result 映射且关键字段透传',
    !!p.data.result && p.data.result.income_total === '1000.00' && p.data.result.true_profit === '390.00' && p.data.result.ref_profit === '380.00',
    p.data.result && JSON.stringify([p.data.result.income_total, p.data.result.true_profit]));
  check('B-② 有账本月 ⇒ canArchive = 未归档且 account 存在', p.data.canArchive === true);
  check('B-③ isArchive 来自后端 is_archive', p.data.isArchive === false);
  check('B-④ switches 取后端权威值（getLedger.switches）', p.data.switches && p.data.switches.inv === true);

  reset();
  p = fresh(loadCfg());
  await p.loadMonth('2026-10'); // LEDGER_OTHER：无 account_id，但 result 是默认空账对象
  check('B-⑤ 🔴 无 account_id 月 ⇒ result 必须为 null（走空态卡，不渲染 0 账本）',
    p.data.result === null, 'result=' + JSON.stringify(p.data.result));
  check('B-⑥ 无账本月 ⇒ canArchive = false', p.data.canArchive === false);
  check('B-⑦ 无账本月 ⇒ prevMonth 归档态也按无账本算', p.data.canArchivePrev === false);

  // =====================================================
  // C · profitLabel / basisText 接线
  // =====================================================
  sec('C · 利润标签与倒轧库存文案接线（与首页/结果页同源）');

  reset();
  p = fresh(loadCfg());
  await p.loadMonth(CUR_MONTH);
  const lab = profitLabel.pickProfitLabel(LEDGER_CUR, 'real');
  check('C-① profitTitle / profitNote 取自 profitLabel 单源（不页内硬编码口径）',
    p.data.result.profitTitle === lab.title && p.data.result.profitNote === lab.note,
    'title=' + p.data.result.profitTitle);
  // basisText：仅当 stocktake 且 closingFen 有值
  const expectBasis = (lab.basis === 'stocktake' && lab.closingFen != null)
    ? TERMS.resultPage.basisStock(mockApi.fenToYuan(lab.closingFen, 2)) : '';
  check('C-② basisText 仅在「盘点 + 有期末库存」时非空，且文案来自单源',
    p.data.result.basisText === expectBasis,
    'basis="' + p.data.result.basisText + '" / expect="' + expectBasis + '"');

  // =====================================================
  // D · onMonthChange 取数组下标（R209 回归）
  // =====================================================
  sec('D · onMonthChange（e.detail.value = 选中项下标，非月份串）');

  // 装配好 months + curMonth
  reset();
  p = fresh(loadCfg());
  p.data.months = ['2026-11', '2026-10', '2026-09'];
  p.data.curMonth = '2026-11';

  reset();
  await p.onMonthChange({ detail: { value: 1 } });
  await flush();
  const gl = (seen.calls || []).filter((c) => c.name === 'getLedger' && c.params.month === '2026-10');
  check('D-① 选下标 1 ⇒ 加载 months[1] = 2026-10（不是把 1 当月份串）', gl.length === 1, 'getLedger(2026-10)=' + gl.length);

  reset();
  await p.onMonthChange({ detail: { value: 1 } }); // 选回当前正显示的月（2026-10，D-① 已把它设为显示月）
  await flush();
  const sameCnt = (seen.calls || []).filter((c) => c.name === 'getLedger').length;
  check('D-② 选回当前正显示的月 ⇒ 不发起 loadMonth（防护：重复/越界不刷接口）', sameCnt === 0, 'getLedger=' + sameCnt);

  reset();
  await p.onMonthChange({ detail: { value: 99 } }); // 越界
  await flush();
  const oobCnt = (seen.calls || []).filter((c) => c.name === 'getLedger').length;
  check('D-③ 越界下标 ⇒ 不发起 loadMonth', oobCnt === 0, 'getLedger=' + oobCnt);

  // =====================================================
  // E · 归档 / 取消归档 / 清空 载荷
  // =====================================================
  sec('E · 归档 / 取消归档 / 清空 载荷正确');

  reset();
  p = fresh(loadCfg());
  p.data.curMonth = CUR_MONTH;
  p.data.prevMonth = '2026-10';
  await p.onArchive();
  await flush();
  let arc = (seen.calls || []).filter((c) => c.name === 'archiveMonth')[0];
  check('E-① 归档本月 ⇒ archiveMonth({month: 当前月, archive: true})',
    !!arc && arc.params.month === CUR_MONTH && arc.params.archive === true, arc ? JSON.stringify(arc.params) : '未调用');

  reset();
  await p.onArchivePrev();
  await flush();
  let arcPrev = (seen.calls || []).filter((c) => c.name === 'archiveMonth')[0];
  check('E-② 归档上月 ⇒ archiveMonth({month: 上月, archive: true})',
    !!arcPrev && arcPrev.params.month === '2026-10' && arcPrev.params.archive === true, arcPrev ? JSON.stringify(arcPrev.params) : '未调用');

  reset();
  await p.onUnarchive();
  await flush();
  let unarc = (seen.calls || []).filter((c) => c.name === 'archiveMonth')[0];
  check('E-③ 取消归档 ⇒ archiveMonth({month: 当前月, archive: false})（点错月自救）',
    !!unarc && unarc.params.month === CUR_MONTH && unarc.params.archive === false, unarc ? JSON.stringify(unarc.params) : '未调用');

  reset();
  await p.onClearMonth();
  await flush();
  let clr = (seen.calls || []).filter((c) => c.name === 'clearMonth')[0];
  check('E-④ 清空本月 ⇒ clearMonth({month: 当前月, confirm: true})（软删必须 confirm）',
    !!clr && clr.params.month === CUR_MONTH && clr.params.confirm === true, clr ? JSON.stringify(clr.params) : '未调用');

  // =====================================================
  // F · 权益查询失败 fail-closed 到免费档
  // =====================================================
  sec('F · 权益查询失败 fail-closed（不升成付费档）');

  reset(); entThrows = true;
  p = fresh(loadCfg());
  await p.bootstrap();
  check('F-① 权益接口抛错 ⇒ isPaid=false / expireSoonDays=0 / isExpired=false（回落免费档）',
    p.data.isPaid === false && p.data.expireSoonDays === 0 && p.data.isExpired === false,
    'isPaid=' + p.data.isPaid + ' soon=' + p.data.expireSoonDays + ' expired=' + p.data.isExpired);
  check('F-② 失败回落时 expireSoonText 空（不渲染残留提示）', p.data.expireSoonText === '');

  reset();
  entResp = { expire_at: 1767000000000, is_active: true, days_left: 30 };
  p = fresh(loadCfg());
  await p.bootstrap();
  check('F-③ 有效付费 ⇒ isPaid=true', p.data.isPaid === true);

  reset();
  entResp = { expire_at: 9999999999999, is_active: false, days_left: 0 };
  p = fresh(loadCfg());
  await p.bootstrap();
  check('F-④ 曾付费已过期 ⇒ isExpired=true（回落免费档 + 提示，不假装仍付费）', p.data.isExpired === true);

  reset();
  entResp = { expire_at: 1767000000000, is_active: true, days_left: 5 };
  p = fresh(loadCfg());
  await p.bootstrap();
  const expectSoon = (typeof TERMS.pay.expireSoonBody === 'function') ? TERMS.pay.expireSoonBody(5) : null;
  check('F-⑤ 临期 5 天 ⇒ expireSoonText 非空（双渠道提示之一）',
    p.data.expireSoonDays === 5 && (expectSoon === null || p.data.expireSoonText === expectSoon),
    'soon=' + p.data.expireSoonDays + ' text="' + p.data.expireSoonText + '"');

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

  // M-1 把「有没有账本」的判据从 account_id 改成 result（回到 R298·C2 的坑）
  await mut('M-1 账本判定改用 result（恒真）',
    'const hasLedger = !!d.account_id;',
    'const hasLedger = !!d.result;',
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.loadMonth('2026-10'); // LEDGER_OTHER：无 account_id、但 result 是默认空账对象
      return { degraded: q.data.result !== null, detail: 'B-⑤ 无账本月竟渲染 result：' + JSON.stringify(q.data.result) };
    });

  // M-2 把 onMonthChange 的下标取值改回「直接拿 e.detail.value 当月份串」（R209 回归）
  await mut('M-2 onMonthChange 直接拿 value 当月份',
    "    const i = Number(e.detail.value);\n    const month = this.data.months[i];\n    if (!month || month === this.data.curMonth) return;   // 越界/重复选择：不发起无效请求\n    this.setData({ monthIndex: i, loading: true });",
    "    const month = e.detail.value;\n    if (!month || month === this.data.curMonth) return;   // 越界/重复选择：不发起无效请求\n    this.setData({ monthIndex: 0, loading: true });",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      q.data.months = ['2026-11', '2026-10', '2026-09'];
      q.data.curMonth = '2026-11';
      await q.onMonthChange({ detail: { value: 1 } });
      await flush();
      const g = (seen.calls || []).filter((c) => c.name === 'getLedger' && c.params.month === '2026-10');
      const wrong = (seen.calls || []).filter((c) => c.name === 'getLedger' && (c.params.month === 1 || c.params.month === '1'));
      return { degraded: g.length === 0 && wrong.length >= 1, detail: 'D-① 选下标 1 竟把 1 当月份串去 getLedger：' + JSON.stringify((seen.calls || []).filter((c) => c.name === 'getLedger').map((c) => c.params.month)) };
    });

  // M-3 把 monthIndex 写死 0（选了非最新月时高亮指错）。
  //   ⚠️ 不能靠 bootstrap 默认（当前月恒为最新、下标本就 0，写死 0 也看不出）——
  //   这里把 nowMonth 改成「已建档但非最新」的 2026-09，使 curMonth 落在列表中部，
  //   若 monthIndex 写死 0 就会指到 2026-11 而非 2026-09。
  await mut('M-3 monthIndex 写死 0',
    "monthIndex: Math.max(0, months.indexOf(cur)), loading: false });",
    "monthIndex: 0, loading: false });",
    () => { reset(); mockUi.nowMonth = () => '2026-09'; },
    async (mc) => {
      const q = fresh(mc);
      await q.bootstrap();
      const wrong = q.data.months[q.data.monthIndex] !== q.data.curMonth;
      return { degraded: wrong, detail: 'A-⑤ monthIndex 写死 0 ⇒ 高亮指到 ' + q.data.months[q.data.monthIndex] + ' 而非 ' + q.data.curMonth };
    });
  mockUi.nowMonth = () => CUR_MONTH; // 还原，后续 run 不受影响

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e && (e.stack || e.message)); process.exit(2); });
