#!/usr/bin/env node
// tools/check_revenue_manual_index_stub.js —— R1-8（台账）营收手录页行为守卫
//
// 为什么需要它：`subpkg/biz/revenue/manual/index.js` 此前零桩，只有静态形状守卫。
//   它是「不会用 Excel 的老板」唯一的月营收入口，手填的数直接拼成日报表存库，
//   静默错误最伤人：
//
//   🔴 ① 串月残留（R620 红线）：换月必须清空上一月残留的 val/ph，否则把 9 月的数当成
//      10 月的存进去 —— 「串月是最难发现的错」，零报错、对账时才炸。
//   🔴 ② 空保存拦截：一个数都没填就保存 ⇒ 云端写一条空记录，老板以为存了其实没存。
//   🔴 ③ 重入保护（saving）：连点保存发两次请求，可能重复写 / 重复弹窗。
//   🔴 ④ collect 过滤非数：type=digit 一般只出数字，但桩里直接写 ''/abc 等价输入时，
//      NaN 不能被当合法数送上去（否则云端 Number('abc')=NaN 落库）。
//   🔴 ⑤ need_confirm 不二次落盘：本月已有数 ⇒ 弹确认框并 return；若漏 return 会
//      穿透到「已保存」分支，弹错弹窗、还可能 navigateBack 误以为存好了。
//   🔴 ⑥ recommit 必带 confirm:true：确认替换时若漏 confirm，云端会再次判 need_confirm，
//      陷入「确认了还是说已有数」的死循环。
//   🔴 ⑦ prefill/ref + prevMonth 边界（R620）：本月已填→预填回现值；本月未填→拿上月当灰字；
//      prevMonth 必须正确处理 1 月→去年 12 月（不能用 setMonth-1 朴素写法）。
//
// 取证层级：L2 页面桩（Page/wx/getApp/依赖全桩，真跑页面源码）。不替代真机。
//   本页不自己算账（汇总/缺失渠道在云端），重点在**装配、判定、载荷、路由、串月**。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/revenue/manual/index.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 可变量 ----------
let seen = {};
let saveResponse = { ok: true };
let storedMap = {};        // month -> manual_fields（模拟云端已存的手动字段）

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls.push({ name, params });
    if (name === 'importSalesBill') {
      if (params.action === 'revenue_get') {
        const m = params.month;
        if (Object.prototype.hasOwnProperty.call(storedMap, m)) {
          return { revenue_stored: { source: 'manual', manual_fields: storedMap[m] } };
        }
        return { revenue_stored: null };
      }
      if (params.action === 'revenue_save_manual') return saveResponse;
    }
    return {};
  },
  fenToYuan: (fen, digits) => { const v = (Number(fen) || 0) / 100; return v.toFixed(digits === undefined ? 2 : digits); },
  toastError: (e) => { seen.toastError = (seen.toastError || 0) + 1; seen.lastErr = e && (e.msg || e.message); },
};
const mockUi = { setTitle: (t) => { seen.title = t; } };

const MOCKS = {
  '../../../../utils/api.js': mockApi,
  '../../../../utils/ui.js': mockUi,
};
function makeRequire(baseDir) {
  return function (req) {
    if (Object.prototype.hasOwnProperty.call(MOCKS, req)) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}

let cfg = null;
function loadCfg(srcOverride) {
  const src = srcOverride || SRC;
  cfg = null;
  global.getApp = () => ({ globalData: { switches: { inv: true } } });
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：revenue/manual/index.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() {
  seen = { calls: [], toasts: [], modals: [], nav: [], redirected: [], scrolled: false };
  saveResponse = { ok: true };
  storedMap = {};
}
function flush() { return new Promise((r) => setTimeout(r, 15)); }

global.Page = (c) => { cfg = c; };
global.wx = {
  showToast: (o) => { seen.toasts.push(o); },
  showModal: (o) => { seen.modals.push(o); },
  showLoading: () => {},
  hideLoading: () => {},
  navigateBack: () => { seen.nav.push('back'); },
  redirectTo: (o) => { seen.redirected.push(o); },
  chooseMedia: () => {},
  previewImage: () => {},
  stopPullDownRefresh: () => {},
};

const SRC = fs.readFileSync(PAGE, 'utf8');

(async () => {
  console.log('[R1-8] 营收手录页行为守卫（串月清空 / 空保存拦截 / 重入保护 / collect 过滤 / need_confirm 不二次落盘 / recommit confirm / prefill·ref·prevMonth）');

  // =====================================================
  // A · 串月残留（R620 红线）：换月必须清空 val
  // =====================================================
  sec('A · 串月残留（R620）：onMonthChange 必须清空上一月填的值');
  reset();
  let p = fresh(loadCfg());
  await p.onLoad(); await flush();
  p.onInput({ currentTarget: { dataset: { g: 0, i: 0 } }, detail: { value: '500' } });
  const before = p.data.groups[0].items[0].val;
  p.onMonthChange({ detail: { value: '2026-03' } });
  await flush();
  check('A-① 🔴 换月前现金框填了 500，换月后该框 val 必须清空（防串月）',
    before === '500' && p.data.groups[0].items[0].val === '',
    'before=' + before + ' after=' + p.data.groups[0].items[0].val);

  // =====================================================
  // B · 空保存拦截：一个数都没填不能落库
  // =====================================================
  sec('B · 空保存拦截：fields 为空 ⇒ 不调 save_manual + 弹 emptyTip');
  reset();
  p = fresh(loadCfg());
  await p.onLoad(); await flush();
  await p.onSave(); await flush();
  const bSave = seen.calls.filter((c) => c.name === 'importSalesBill' && c.params.action === 'revenue_save_manual').length;
  const bModal = (seen.modals || []).filter((m) => m.content === TERMS.revenueManual.emptyTip).length;
  check('B-① 🔴 空 fields ⇒ 不调 revenue_save_manual + 弹 emptyTip', bSave === 0 && bModal === 1, 'save=' + bSave + ' modal=' + bModal);

  // =====================================================
  // C · 重入保护（saving）：连点只发一次
  // =====================================================
  sec('C · 重入保护：saving=true 时 onSave 直接 return');
  reset();
  p = fresh(loadCfg());
  await p.onLoad(); await flush();
  p.data.groups[0].items[0].val = '100';
  p.data.saving = true;
  await p.onSave(); await flush();
  const cSave = seen.calls.filter((c) => c.name === 'importSalesBill' && c.params.action === 'revenue_save_manual').length;
  check('C-① saving=true ⇒ onSave 提前 return，不调 revenue_save_manual', cSave === 0, 'save=' + cSave);

  // =====================================================
  // D · collect 过滤：非空 + 有限数才收
  // =====================================================
  sec('D · collect：只收非空且有限数（空与 NaN 都排除）');
  reset();
  p = fresh(loadCfg());
  await p.onLoad(); await flush();
  // group0=dinein[cash,scan], group1=takeaway[waimaiMeituan,...]
  p.data.groups[0].items[0].val = '123';   // cash → 123
  p.data.groups[0].items[1].val = '';      // scan → 空，排除
  p.data.groups[1].items[0].val = 'abc';   // waimaiMeituan → 非有限数，排除
  const fields = p.collect();
  check('D-① 🔴 collect：cash=123 收进、scan(空) 与 waimaiMeituan(abc) 排除',
    fields.cash === 123 && fields.scan === undefined && fields.waimaiMeituan === undefined,
    'fields=' + JSON.stringify(fields));

  // =====================================================
  // E · need_confirm 不二次落盘 / 不穿透到「已保存」分支
  // =====================================================
  sec('E · need_confirm：弹确认框并 return，不弹 savedTitle、不 navigateBack');
  reset();
  saveResponse = { need_confirm: true, diff: { oldTotalYuan: 100, newTotalYuan: 200, totalDeltaYuan: 100 } };
  p = fresh(loadCfg());
  await p.onLoad(); await flush();
  p.data.groups[0].items[0].val = '100';
  await p.onSave(); await flush();
  const eSave = seen.calls.filter((c) => c.name === 'importSalesBill' && c.params.action === 'revenue_save_manual').length;
  const eDup = (seen.modals || []).filter((m) => m.title === TERMS.revenueManual.dupTitle).length;
  const eSaved = (seen.modals || []).filter((m) => m.title === TERMS.revenueManual.savedTitle).length;
  const eNav = (seen.nav || []).length;
  check('E-① 🔴 need_confirm ⇒ 只弹 dupTitle、不弹 savedTitle、不 navigateBack、save 仅 1 次',
    eSave === 1 && eDup === 1 && eSaved === 0 && eNav === 0,
    'save=' + eSave + ' dup=' + eDup + ' saved=' + eSaved + ' nav=' + eNav);

  // =====================================================
  // F · recommit 必带 confirm:true
  // =====================================================
  sec('F · recommit：确认替换必须带 confirm:true');
  reset();
  p = fresh(loadCfg());
  await p.onLoad(); await flush();
  await p.recommit({ cash: 123 }); await flush();
  const fCall = seen.calls.filter((c) => c.name === 'importSalesBill' && c.params.action === 'revenue_save_manual');
  const fConfirm = fCall.length === 1 && fCall[0].params.input && fCall[0].params.input.confirm === true;
  check('F-① 🔴 recommit ⇒ 调 save_manual 且 input.confirm===true', fConfirm, 'calls=' + fCall.length + (fCall[0] ? ' confirm=' + (fCall[0].params.input || {}).confirm : ''));

  // =====================================================
  // G · prefill 路径：本月已填 → 把存着的值预填回 val
  // =====================================================
  sec('G · prefill：本月已存 ⇒ 把存着的值预填回 val（baseMode=prefill）');
  reset();
  storedMap['2026-03'] = { cash: 999 };
  p = fresh(loadCfg());
  await p.onLoad(); await flush();
  await p.loadBase('2026-03'); await flush();
  const gItem = p.data.groups[0].items[0];
  check('G-① 本月已存 ⇒ 现金框 val 预填回「999」且 baseMode=prefill',
    gItem.val === '999' && p.data.baseMode === 'prefill',
    'val=' + gItem.val + ' mode=' + p.data.baseMode);

  // =====================================================
  // H · ref 路径 + prevMonth 边界：本月未填 → 拿上月灰字，且上月取数月份正确
  // =====================================================
  sec('H · ref + prevMonth：本月未存、上月已存 ⇒ 灰字参考，ref 取数用上月');
  reset();
  storedMap['2026-02'] = { cash: 888 };
  p = fresh(loadCfg());
  await p.onLoad(); await flush();
  await p.loadBase('2026-03'); await flush();
  const hGets = seen.calls.filter((c) => c.name === 'importSalesBill' && c.params.action === 'revenue_get');
  const hPrevGet = hGets.filter((c) => c.params.month === '2026-02').length;
  const hPh = p.data.groups[0].items[0].ph || '';
  check('H-① 🔴 本月未存、上月(2026-02)已存 ⇒ baseMode=ref、ref 取数用 2026-02、灰字含 888',
    p.data.baseMode === 'ref' && hPrevGet === 1 && hPh.indexOf('888') >= 0,
    'mode=' + p.data.baseMode + ' prevGet=' + hPrevGet + ' ph=' + JSON.stringify(hPh));

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

  // M-1 删串月清空（回到串月坑：把上月数存成本月）
  await mut('M-1 删除换月清空',
    "      items: g.items.map((it) => Object.assign({}, it, { val: '', ph: '' })),",
    "      items: g.items.map((it) => Object.assign({}, it)),",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad(); await flush();
      q.onInput({ currentTarget: { dataset: { g: 0, i: 0 } }, detail: { value: '500' } });
      q.onMonthChange({ detail: { value: '2026-03' } });
      await flush();
      return { degraded: q.data.groups[0].items[0].val !== '', detail: 'A-① 换月后现金框 val 竟残留=' + JSON.stringify(q.data.groups[0].items[0].val) };
    });

  // M-2 删空保存拦截（回到空记录坑）
  await mut('M-2 删除空保存拦截',
    "    if (!Object.keys(fields).length) {\n      wx.showModal({ title: T.title, content: T.emptyTip, showCancel: false });\n      return;\n    }\n",
    '',
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad(); await flush();
      await q.onSave(); await flush();
      const c = seen.calls.filter((x) => x.name === 'importSalesBill' && x.params.action === 'revenue_save_manual').length;
      return { degraded: c >= 1, detail: 'B-① 空 fields 竟调 save_manual=' + c };
    });

  // M-3 删重入保护（回到连点双发坑）
  await mut('M-3 删除重入保护',
    "    if (this.data.saving) return;\n",
    '',
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad(); await flush();
      q.data.groups[0].items[0].val = '100';
      q.data.saving = true;
      await q.onSave(); await flush();
      const c = seen.calls.filter((x) => x.name === 'importSalesBill' && x.params.action === 'revenue_save_manual').length;
      return { degraded: c >= 1, detail: 'C-① saving=true 竟仍调 save_manual=' + c };
    });

  // M-4 collect 去 isFinite（回到 NaN 落库坑）
  await mut('M-4 collect 去掉 isFinite 过滤',
    "        if (raw !== '' && isFinite(Number(raw))) fields[it.key] = Number(raw);",
    "        if (raw !== '') fields[it.key] = Number(raw);",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad(); await flush();
      q.data.groups[0].items[0].val = '123';
      q.data.groups[0].items[1].val = '';
      q.data.groups[1].items[0].val = 'abc';
      const f = q.collect();
      return { degraded: f.waimaiMeituan !== undefined, detail: 'D-① 非有限数竟被收进 waimaiMeituan=' + JSON.stringify(f.waimaiMeituan) };
    });

  // M-5 need_confirm 漏 return（回到穿透到「已保存」坑）
  await mut('M-5 need_confirm 漏 return',
    "        this.confirmOverwrite(df, fields);\n        return;\n",
    "        this.confirmOverwrite(df, fields);\n",
    () => { reset(); saveResponse = { need_confirm: true, diff: { oldTotalYuan: 100, newTotalYuan: 200, totalDeltaYuan: 100 } }; },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad(); await flush();
      q.data.groups[0].items[0].val = '100';
      await q.onSave(); await flush();
      const saved = (seen.modals || []).filter((m) => m.title === TERMS.revenueManual.savedTitle).length;
      return { degraded: saved >= 1, detail: 'E-① need_confirm 竟穿透弹 savedTitle=' + saved };
    });

  // M-6 recommit 漏 confirm:true（回到确认死循环坑）
  await mut('M-6 recommit 漏 confirm',
    "        input: { month: this.data.month, fields, confirm: true },",
    "        input: { month: this.data.month, fields },",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad(); await flush();
      await q.recommit({ cash: 123 }); await flush();
      const f = seen.calls.filter((x) => x.name === 'importSalesBill' && x.params.action === 'revenue_save_manual');
      const ok = f.length === 1 && f[0].params.input && f[0].params.input.confirm === true;
      return { degraded: !ok, detail: 'F-① recommit 竟漏 confirm=' + (f[0] ? JSON.stringify(f[0].params.input) : '无') };
    });

  // M-7 prevMonth 朴素写法（回到 1 月→去年 12 月 边界坑）
  await mut('M-7 prevMonth 朴素写法',
    "  const d = new Date(y, mo - 2, 1);",
    "  const d = new Date(y, mo - 1, 1);",
    () => { reset(); storedMap = { '2026-02': { cash: 999 }, '2025-12': { cash: 888 } }; },
    async (mc) => {
      const q = fresh(mc);
      await q.loadBase('2026-01'); await flush();
      const refGet = seen.calls.filter((x) => x.name === 'importSalesBill' && x.params.action === 'revenue_get' && x.params.month === '2025-12').length;
      return { degraded: !(q.data.baseMode === 'ref' && refGet === 1), detail: 'H-① 2026-01 上月应取 2025-12；baseMode=' + q.data.baseMode + ' refGet=' + refGet };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e && (e.stack || e.message)); process.exit(2); });
