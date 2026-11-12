#!/usr/bin/env node
// tools/check_amortize_page_stub.js —— R1-8（台账）摊销页行为守卫
//
// 为什么需要它：`subpkg/biz/month/amortize.js` 是**直接进利润**的一页（摊销额是费用），
//   却从没有任何一处真跑页面代码（零桩）。它管的钱有两类：
//     · 一次算清（lump）：全算进当月，不跨月摊
//     · 分期摊销（amort）：按月摊开，可多笔、可再投一笔
//   两类**互不排斥**（老板一月里既有一笔摊销又有几笔小额一次算清，都能记）。
//
// 这页最容易出的四类静默错误：
//   ① **开关乐观更新不回滚**：先本地翻开关、再发请求，失败却没回滚 ⇒ 页面显示「已开」
//      但服务端没存 ⇒ 老板以为摊销计入了、利润其实没变。**这是本页最贵的一条**：
//      它不会报错，只会让老板对着一份少算了摊销的利润做决定。
//   ② **归档期没拦住**：已归档月份还能改摊销 ⇒ 已经出过的报表被悄悄改写。
//      `go()` 与 `onToggleAmortize()` 两条入口都要拦，且开关要重新 load 拉回原值。
//   ③ **分组聚合错**：同一资产再投一笔（group_id 相同）必须合成一组、按 batch_seq 排序、
//      给「合计剩余未摊」；漏了聚合 ⇒ 老板看到同一资产两行、以为记重了。
//   ④ **goHome 只会 navigateBack**：直接进入本页时栈里只有自己，navigateBack 失败 ⇒
//      「回首页」点了没反应（正是李老师反复报的「点不动」同型）。
//
// 取证层级：L2 页面桩（Page/wx/getApp/api/ui/getCurrentPages 全桩，真跑页面源码）。
//   ⚠️ 不替代真机：验的是「数据怎么变成列表与开关状态」，不验视觉。
//
// 运行：node tools/check_amortize_page_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/month/amortize.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 桩 ----------
let cfg = null;
let seen = {};
let schedule = null;
let scheduleThrows = false;
let saveThrows = false;
let pagesStub = [{}, {}];

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls = (seen.calls || []).concat({ name, params });
    if (name === 'getAmortSchedule') { if (scheduleThrows) throw new Error('stub: 排期读失败'); return schedule; }
    if (name === 'saveShopSetting') { if (saveThrows) throw new Error('stub: 保存失败'); return {}; }
    if (name === 'saveAsset') { if (saveThrows) throw new Error('stub: 保存失败'); return {}; }
    return {};
  },
  fenToYuan: (v, n) => (Number(v || 0) / 100).toFixed(n == null ? 2 : n),
  yuanToFen: (v) => Math.round(Number(v || 0) * 100),
  toastError: () => { seen.toastError = (seen.toastError || 0) + 1; },
};
const mockUi = { setTitle: () => {}, nowMonth: () => '2026-11' };

global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: {} });
global.getCurrentPages = () => pagesStub;
global.wx = {
  showToast: (o) => { seen.toast = o; },
  showModal: (o) => { seen.modal = o; if (seen.autoConfirm && o.success) o.success({ confirm: true }); },
  navigateTo: (o) => { seen.navigateTo = (seen.navigateTo || []).concat(o.url); },
  redirectTo: (o) => { seen.redirectTo = (seen.redirectTo || []).concat(o.url); },
  navigateBack: () => { seen.back = (seen.back || 0) + 1; },
  stopPullDownRefresh: () => { seen.stopped = true; },
  vibrateShort: () => { seen.vibrated = (seen.vibrated || 0) + 1; },
  getStorageSync: () => '', setStorageSync: () => {},
};

const MOCKS = { '../../../utils/api.js': mockApi, '../../../utils/ui.js': mockUi };
function makeRequire(baseDir) {
  return function (req) {
    if (MOCKS[req]) return MOCKS[req];
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
  if (!cfg) throw new Error('Page() 未被调用：month/amortize.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() {
  seen = {}; schedule = null; scheduleThrows = false; saveThrows = false; pagesStub = [{}, {}];
}

function S(o) {
  return Object.assign({
    month: '2026-11',
    total_amount_fen: 316000,
    lump_total_fen: 60000,
    amortize_switch_on: true,
    is_archive: false,
    lumps: [{ item_id: 'l1', name: '一次性装修', amount_fen: 60000, month: '2026-11' }],
    assets: [
      { asset_id: 'a1', name: '门面转让费', value_fen: 300000, start_month: '2026-09', total_months: 10, paid_months: 3, total_periods: 10, remaining_fen: 210000, end_month: '2027-06', asset_kind: 'renovation' },
    ],
    details: [{ asset_id: 'a1', amount_fen: 30000 }],
  }, o || {});
}

(async () => {
  console.log('[R1-8] 摊销页行为守卫（装配 / 分组 / 开关回滚 / 归档只读 / 出口）');

  const SRC = fs.readFileSync(PAGE, 'utf8');
  loadCfg();

  // =====================================================
  // A · 装配
  // =====================================================
  sec('A · load 装配（金额全部取后端出参，前端不重算）');

  reset();
  schedule = S();
  let p = fresh(cfg);
  p.data.month = '2026-11';
  await p.load();
  check('A-① 合计/一次算清合计按分转元展示',
    p.data.totalYuan === '3160.00' && p.data.lumpTotalYuan === '600.00',
    'total=' + p.data.totalYuan + ' lump=' + p.data.lumpTotalYuan);
  check('A-② 一个 lump 一笔、一个 asset 一条',
    p.data.lumps.length === 1 && p.data.assets.length === 1,
    'lumps=' + p.data.lumps.length + ' assets=' + p.data.assets.length);
  check('A-③ 🔴 当月摊销额取自 details（300.00），不是前端自己算的',
    p.data.assets[0].amountYuan === '300.00', p.data.assets[0].amountYuan);
  check('A-④ 留存字段（已摊期数/剩余/结束月）原样透传',
    p.data.assets[0].paid_months === 3 && p.data.assets[0].remaining_fen === 210000 && p.data.assets[0].end_month === '2027-06',
    'paid=' + p.data.assets[0].paid_months + ' remain=' + p.data.assets[0].remaining_fen);

  reset();
  schedule = S({ details: [] });
  p = fresh(cfg);
  p.data.month = '2026-11';
  await p.load();
  check('A-⑤ details 里没有该资产 ⇒ 当月摊销 0.00（不是 undefined/NaN）',
    p.data.assets[0].amountYuan === '0.00', p.data.assets[0].amountYuan);

  reset();
  schedule = S({ amortize_switch_on: true });
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.data.amortizeOn = false;
  await p.load();
  check('A-⑥ 🔴 开关只认本次出参（不读 globalData 缓存）—— 否则保存后重拉会「自己弹回」',
    p.data.amortizeOn === true, 'amortizeOn=' + p.data.amortizeOn);

  reset();
  scheduleThrows = true;
  p = fresh(cfg);
  p.data.month = '2026-11';
  let aErr = null;
  try { await p.load(); } catch (e) { aErr = e; }
  check('A-⑦ 接口失败 ⇒ 不崩、loading 收起、给出提示',
    aErr === null && p.data.loading === false && seen.toastError === 1,
    aErr ? (aErr.message || String(aErr)) : 'toastError=' + seen.toastError);

  // =====================================================
  // B · 分组聚合（同一资产多笔投入）
  // =====================================================
  sec('B · buildGroups（同组合并 / 批序 / 无组自成一组）');

  const rows2 = [
    { asset_id: 'a2', group_id: 'g1', batch_seq: 2, name: '设备', value_fen: 100000, amount_fen: 10000, remaining_fen: 90000, end_month: '2027-08', progressNote: 'P2', endNote: 'E2' },
    { asset_id: 'a1', group_id: 'g1', batch_seq: 1, name: '设备', value_fen: 200000, amount_fen: 20000, remaining_fen: 180000, end_month: '2027-05', progressNote: 'P1', endNote: 'E1' },
  ];
  reset();
  p = fresh(cfg);
  const g1 = p.buildGroups(rows2);
  check('B-① 🔴 同 group_id 两笔合成一组（不是两行），count=2/multi=true',
    g1.length === 1 && g1[0].count === 2 && g1[0].multi === true,
    '组数=' + g1.length + ' count=' + (g1[0] && g1[0].count));
  check('B-② 组内按 batch_seq 升序（先投的在前）',
    g1[0].batches[0].batch_seq === 1 && g1[0].batches[1].batch_seq === 2,
    g1[0].batches.map((b) => b.batch_seq).join(','));
  check('B-③ 组金额是两笔累加（3000.00 / 300.00）',
    g1[0].valueYuan === '3000.00' && g1[0].monthYuan === '300.00',
    'value=' + g1[0].valueYuan + ' month=' + g1[0].monthYuan);
  check('B-④ 🔴 多笔组给「合计剩余未摊」（270000 分 = 2700.00 出现在文案里）',
    /2,?700\.00/.test(String(g1[0].progressNote)), g1[0].progressNote);
  check('B-⑤ 多笔组末月取最晚那笔（2027-08）',
    /2027-08/.test(String(g1[0].endNote)), g1[0].endNote);

  const rows3 = [
    { asset_id: 'x1', name: '押金', value_fen: 50000, amount_fen: 5000, remaining_fen: 45000, progressNote: 'PX', endNote: 'EX' },
    { asset_id: 'x2', name: '加盟费', value_fen: 80000, amount_fen: 8000, remaining_fen: 72000, progressNote: 'PY', endNote: 'EY' },
  ];
  const g3 = p.buildGroups(rows3);
  check('B-⑥ 无 group_id ⇒ 各成一组（老数据行为不变）',
    g3.length === 2 && g3.every((g) => g.multi === false),
    '组数=' + g3.length);
  check('B-⑦ 单笔组沿用该笔自己的文案（不套多笔模板）',
    g3[0].progressNote === 'PX' && g3[0].endNote === 'EX', g3[0].progressNote);

  // =====================================================
  // C · 小工具
  // =====================================================
  sec('C · 类别名 / 当月额查找 / 进度文案');

  check('C-① 已知类别 key 有中文名、未知 key 返回空串（不渲染 undefined）',
    p.kindNameOf('renovation') !== '' && p.kindNameOf('__nope__') === '',
    '已知=' + p.kindNameOf('renovation') + ' 未知=' + JSON.stringify(p.kindNameOf('__nope__')));
  check('C-② findMonthAmount 命中取该值、未命中取 0',
    p.findMonthAmount([{ asset_id: 'a1', amount_fen: 12345 }], 'a1') === 12345
    && p.findMonthAmount([{ asset_id: 'zz', amount_fen: 1 }], 'a1') === 0
    && p.findMonthAmount(null, 'a1') === 0);

  // =====================================================
  // D · 摊销开关（本页最贵：失败必须回滚）
  // =====================================================
  sec('D · 摊销开关（乐观更新 + 失败回滚 + 归档只读）');

  reset();
  saveThrows = true;
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.data.amortizeOn = true;
  await p.onToggleAmortize({ detail: { value: false } });
  check('D-① 🔴 保存失败 ⇒ 开关必须回滚到原值（否则页面说已关、后端还开着，利润口径错）',
    p.data.amortizeOn === true && seen.toastError === 1,
    'amortizeOn=' + p.data.amortizeOn + ' toastError=' + seen.toastError);

  reset();
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.data.amortizeOn = true;
  await p.onToggleAmortize({ detail: { value: true } });
  check('D-② 值没变 ⇒ 不发请求（避免无意义的写库与幂等键消耗）',
    (seen.calls || []).length === 0, '调用数=' + (seen.calls || []).length);

  reset();
  schedule = S({ amortize_switch_on: true });
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.data.amortizeOn = false;
  await p.onToggleAmortize({ detail: { value: true } });
  const saveCall = (seen.calls || []).filter((c) => c.name === 'saveShopSetting')[0];
  check('D-③ 成功 ⇒ 调 saveShopSetting 带 switches.amortize + 幂等键',
    !!saveCall && saveCall.params.switches && saveCall.params.switches.amortize === true
    && /^am_\d+$/.test(String(saveCall.params.client_request_id)),
    saveCall ? JSON.stringify(saveCall.params) : '未调用');

  reset();
  schedule = S({ is_archive: true, amortize_switch_on: false });
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.data.isArchive = true;
  await p.onToggleAmortize({ detail: { value: true } });
  check('D-④ 🔴 归档期 ⇒ 弹「已锁定」且**不发保存请求**（已出报表不许被悄悄改写）',
    !!seen.modal && (seen.calls || []).filter((c) => c.name === 'saveShopSetting').length === 0,
    'modal=' + (seen.modal && seen.modal.title));

  // =====================================================
  // E · 只读拦截 / 出口
  // =====================================================
  sec('E · 归档拦截与出口（「点了没反应」的高发区）');

  reset();
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.data.isArchive = true;
  p.onAddAmort();
  check('E-① 归档期点「新增摊销」⇒ 弹窗且不跳转',
    !!seen.modal && !seen.navigateTo, 'navigateTo=' + JSON.stringify(seen.navigateTo));

  reset();
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.data.isArchive = false;
  p.onAddAmort();
  check('E-② 非归档 ⇒ 真跳到 assetEdit 且带 kind=amort + month',
    (seen.navigateTo || []).length === 1
    && seen.navigateTo[0].indexOf('assetEdit?kind=amort') >= 0
    && seen.navigateTo[0].indexOf('month=2026-11') >= 0,
    JSON.stringify(seen.navigateTo));

  reset();
  pagesStub = [{}, {}];
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.goHome();
  check('E-③ 栈里有上一页 ⇒ navigateBack', seen.back === 1 && !seen.redirectTo,
    'back=' + seen.back);

  reset();
  pagesStub = [{}];
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.goHome();
  check('E-④ 🔴 栈里只有自己（直接进入本页）⇒ 必须 redirectTo 兜底，navigateBack 会失败',
    !seen.back && (seen.redirectTo || []).length === 1
    && seen.redirectTo[0].indexOf('month/index') >= 0,
    'back=' + seen.back + ' redirect=' + JSON.stringify(seen.redirectTo));

  reset();
  schedule = S();
  p = fresh(cfg);
  p.data.month = '2026-11';
  p._shown = false;
  p.onShow();
  check('E-⑤ 首次 onShow 跳过 load（紧跟 onLoad，省一次云调用）',
    (seen.calls || []).length === 0, '调用数=' + (seen.calls || []).length);

  reset();
  schedule = S();
  p = fresh(cfg);
  p.data.month = '2026-11';
  p._shown = true;
  p.onShow();
  await new Promise((r) => setTimeout(r, 0));
  check('E-⑥ 🔴 非首次 onShow 必须重拉（改完一笔回来数字要变）',
    (seen.calls || []).some((c) => c.name === 'getAmortSchedule'),
    '调用=' + (seen.calls || []).map((c) => c.name).join(','));

  // =====================================================
  // F · 提前报废（不可逆）
  // =====================================================
  sec('F · 提前报废（二次确认 + 只废这一笔 + 触觉）');

  const ASSET = { asset_id: 'a1', name: '门面转让费', value: '3000.00', start_month: '2026-09', total_months: 10, group_id: 'g1', batch_seq: 2 };

  reset();
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.onTerminate({ currentTarget: { dataset: { asset: ASSET } } });
  check('F-① 未确认 ⇒ 不发任何写请求（不可逆操作必须先问）',
    (seen.calls || []).length === 0, '调用数=' + (seen.calls || []).length);

  reset();
  seen.autoConfirm = true;
  schedule = S();
  p = fresh(cfg);
  p.data.month = '2026-11';
  p.onTerminate({ currentTarget: { dataset: { asset: ASSET } } });
  await new Promise((r) => setTimeout(r, 10));
  const saveAsset = (seen.calls || []).filter((c) => c.name === 'saveAsset')[0];
  check('F-② 确认 ⇒ 调 saveAsset，terminate_month=当前月、mode=amort',
    !!saveAsset && saveAsset.params.asset.terminate_month === '2026-11' && saveAsset.params.asset.mode === 'amort',
    saveAsset ? JSON.stringify(saveAsset.params.asset) : '未调用');
  check('F-③ 🔴 多笔资产只废这一笔：带 group_id + batch_seq（其它笔不受影响）',
    !!saveAsset && saveAsset.params.asset.group_id === 'g1' && saveAsset.params.asset.batch_seq === 2,
    saveAsset ? 'group=' + saveAsset.params.asset.group_id + ' seq=' + saveAsset.params.asset.batch_seq : '未调用');
  check('F-④ 不可逆操作有触觉反馈', seen.vibrated === 1, 'vibrated=' + seen.vibrated);

  // =====================================================
  // M · 变异回灌
  // =====================================================
  sec('M · 变异回灌');

  async function mut(label, from, to, expect, runFn) {
    if (SRC.indexOf(from) < 0) { console.log('  ❌ ' + label + ' 锚点漂移：' + from); failN++; return; }
    const mutated = SRC.replace(from, to);
    if (mutated === SRC) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let mc = null;
    try { mc = loadCfg(mutated); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return; }
    let degraded = false, detail = '';
    try { const r = await runFn(mc); degraded = !!r.degraded; detail = r.detail || ''; }
    catch (e) { degraded = true; detail = '变异后抛错：' + ((e && e.message) || e); }
    check(label + ' ⇒ 检出「' + expect + '」退化', degraded, detail);
    loadCfg();
  }

  await mut('M-1 失败不回滚', "this.setData({ amortizeOn: prev });       // 服务端才是权威 → 回滚", '',
    'D-① 失败回滚', async (mc) => {
      reset(); saveThrows = true;
      const mp = fresh(mc); mp.data.month = '2026-11'; mp.data.amortizeOn = true;
      await mp.onToggleAmortize({ detail: { value: false } });
      return { degraded: mp.data.amortizeOn === false, detail: 'amortizeOn=' + mp.data.amortizeOn };
    });

  await mut('M-2 分组不聚合（每笔独立）', 'const key = r.group_id || r.asset_id;', 'const key = r.asset_id;',
    'B-① 同组合并', async (mc) => {
      reset();
      const mp = fresh(mc);
      const g = mp.buildGroups([
        { asset_id: 'a2', group_id: 'g1', batch_seq: 2, name: '设备', value_fen: 1, amount_fen: 1 },
        { asset_id: 'a1', group_id: 'g1', batch_seq: 1, name: '设备', value_fen: 1, amount_fen: 1 },
      ]);
      return { degraded: g.length === 2, detail: '组数=' + g.length };
    });

  await mut('M-3 归档期不拦 go', 'if (this.data.isArchive) {', 'if (false) {',
    'E-① 归档只读', async (mc) => {
      reset();
      const mp = fresh(mc); mp.data.month = '2026-11'; mp.data.isArchive = true;
      mp.onAddAmort();
      return { degraded: (seen.navigateTo || []).length > 0, detail: 'navigateTo=' + JSON.stringify(seen.navigateTo) };
    });

  await mut('M-4 出口恒 navigateBack', 'if (pages.length > 1) wx.navigateBack();', 'if (pages.length >= 1) wx.navigateBack();',
    'E-④ 栈底 redirect 兜底', async (mc) => {
      reset(); pagesStub = [{}];
      const mp = fresh(mc); mp.data.month = '2026-11';
      mp.goHome();
      return { degraded: (seen.redirectTo || []).length === 0, detail: 'redirect=' + JSON.stringify(seen.redirectTo) + ' back=' + seen.back };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
