#!/usr/bin/env node
// tools/check_asset_edit_stub.js —— R1-8（台账）资产编辑页行为守卫
//
// 为什么需要它：`subpkg/biz/month/assetEdit.js` 是「一次性投入 / 分期摊销」的**唯一录入入口**，
//   落库的东西直接进台账、进双利润引擎；此前零桩。它管三种模式：
//     · new    新建
//     · edit   改已有（一次算清的清单项 / 摊销资产）
//     · append 同一资产再投一笔（沿用组名，起摊月各自独立）
//
// 这页最容易出的四类静默错误：
//   ① **金额读不成数字被静默按 0 存**（#549）：`api.yuanToFen` 对「12,000」这类带千分位的
//      输入是 fail-soft 返回 0（被 check_money_precision 钉住不能改）⇒ 资产值 0 分进台账
//      ⇒ 一次性/摊销金额全错，**零报错**。本页必须在保存前硬拦。
//   ② **校验顺序错**：名称 → 金额可读 → 金额>0 → 起始月 → 月数。顺序换了会给误导性提示
//      （金额都读不出来，却先报「必须大于 0」）。
//   ③ **lump 没强制 1 个月**：一次算清 = 全部算进当月，`total_months` 必须被强制为 1；
//      跟随老板填的值 ⇒ 一次算清被摊成多个月，当月利润虚高。
//   ④ **删除键文案整块覆盖 `t`**：onLoad 用 `setData({'t.fDelete': ...})` 路径写法，
//      写成 `setData({t:{...}})` 会把 t 里其它十几个词条全丢掉 ⇒ 界面一片空白。
//
// 取证层级：L2 页面桩（Page/wx/getApp/api/ui 全桩，真跑页面源码）。
//   ⚠️ 不替代真机：验的是「输入 → 校验 → 落库载荷」，不验键盘/滚动体验。
//
// 运行：node tools/check_asset_edit_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/month/assetEdit.js');
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

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls = (seen.calls || []).concat({ name, params });
    if (name === 'getAmortSchedule') { if (scheduleThrows) throw new Error('stub: 排期读失败'); return schedule; }
    if (name === 'saveAsset') { if (saveThrows) throw new Error('stub: 保存失败'); return {}; }
    return {};
  },
  fenToYuan: (v, n) => (Number(v || 0) / 100).toFixed(n == null ? 2 : n),
  yuanToFen: (v) => {
    // 与真身一致的 fail-soft：带千分位/空格 ⇒ 0
    const s = String(v == null ? '' : v).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return 0;
    return Math.round(Number(s) * 100);
  },
  toastError: () => { seen.toastError = (seen.toastError || 0) + 1; },
};
const mockUi = { setTitle: () => {}, nowMonth: () => '2026-11' };

global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: {} });
global.wx = {
  showToast: (o) => { seen.toast = o; },
  showModal: (o) => { seen.modal = o; if (seen.autoConfirm && o.success) o.success({ confirm: true }); },
  navigateBack: () => { seen.back = (seen.back || 0) + 1; },
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
  if (!cfg) throw new Error('Page() 未被调用：month/assetEdit.js');
  return cfg;
}
function applyPath(obj, key, val) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) {
    Object.keys(o).forEach((k) => {
      if (k.indexOf('.') >= 0) applyPath(this.data, k, o[k]);
      else this.data[k] = o[k];
    });
  };
  return p;
}
function reset() { seen = {}; schedule = null; scheduleThrows = false; saveThrows = false; }

function SCHED(o) {
  return Object.assign({
    month: '2026-11', is_archive: false,
    lumps: [{ item_id: 'l1', name: '一次性装修', amount_fen: 60000, month: '2026-11' }],
    assets: [
      { asset_id: 'a1', name: '门面转让费', value_fen: 300000, start_month: '2026-09', total_months: 10, asset_kind: 'franchise', group_id: '' },
      { asset_id: 'a2', name: '设备', value_fen: 100000, start_month: '2026-10', total_months: 12, asset_kind: 'equipment', group_id: 'g1', batch_seq: 1 },
      { asset_id: 'a3', name: '设备', value_fen: 200000, start_month: '2026-11', total_months: 12, asset_kind: 'equipment', group_id: 'g1', batch_seq: 2 },
    ],
  }, o || {});
}

(async () => {
  console.log('[R1-8] 资产编辑页行为守卫（模式判定 / 回填 / 校验顺序 / 载荷组装）');

  const SRC = fs.readFileSync(PAGE, 'utf8');
  loadCfg();

  // =====================================================
  // A · onLoad 模式判定与默认值
  // =====================================================
  sec('A · onLoad（mode 判定 / 默认值 / 删除文案分流）');

  reset();
  schedule = SCHED();
  let p = fresh(cfg);
  p.onLoad({ kind: 'amort', month: '2026-11', asset_id: 'a1' });
  check('A-① 带 asset_id ⇒ mode=edit',
    p.data.mode === 'edit' && p.data.assetId === 'a1', 'mode=' + p.data.mode);

  reset();
  schedule = SCHED();
  p = fresh(cfg);
  p.onLoad({ kind: 'amort', month: '2026-11', group: 'g1' });
  check('A-② 带 group 但无 asset_id ⇒ mode=append',
    p.data.mode === 'append' && p.data.groupKey === 'g1', 'mode=' + p.data.mode);

  reset();
  schedule = SCHED();
  p = fresh(cfg);
  p.onLoad({ kind: 'lump', month: '2026-11' });
  check('A-③ 都没有 ⇒ mode=new', p.data.mode === 'new');

  check('A-④ 一次算清默认摊 1 个月；摊销月数留空让老板填',
    (function () {
      const a = fresh(cfg); reset(); a.onLoad({ kind: 'lump', month: '2026-11' });
      const lumpMonths = a.data.totalMonths;
      const b = fresh(cfg); b.onLoad({ kind: 'amort', month: '2026-11' });
      return lumpMonths === '1' && b.data.totalMonths === '';
    })(), '见断言');

  reset();
  p = fresh(cfg);
  p.onLoad({ kind: 'amort', month: '2026-03' });
  check('A-⑤ 起摊月默认取传入月份', p.data.startMonth === '2026-03', p.data.startMonth);

  check('A-⑥ 🔴 删除文案按 kind 分流，且**其它 t 词条没被整块覆盖**（路径写法）',
    (function () {
      const a = fresh(cfg); a.onLoad({ kind: 'lump', month: '2026-11' });
      const b = fresh(cfg); b.onLoad({ kind: 'amort', month: '2026-11' });
      const tA = a.data.t, tB = b.data.t;
      const keysIntact = Object.keys(cfg.data.t).every((k) => tA[k] !== undefined && tB[k] !== undefined);
      return keysIntact && tA.fDelete !== tB.fDelete && !!tA.fName && !!tB.fAmount;
    })());

  // =====================================================
  // B · load 回填
  // =====================================================
  sec('B · load 回填（回源后端，不靠 URL 传对象）');

  reset();
  schedule = SCHED();
  p = fresh(cfg);
  p.onLoad({ kind: 'lump', month: '2026-11', asset_id: 'l1' });
  await new Promise((r) => setTimeout(r, 0));
  check('B-① edit + lump：从清单按 item_id 回填名称/金额',
    p.data.name === '一次性装修' && p.data.amountYuan === '600.00',
    p.data.name + ' / ' + p.data.amountYuan);

  reset();
  schedule = SCHED();
  p = fresh(cfg);
  p.onLoad({ kind: 'amort', month: '2026-11', asset_id: 'a1' });
  await new Promise((r) => setTimeout(r, 0));
  check('B-② edit + amort：回填名称/金额/起摊月/月数/类别',
    p.data.name === '门面转让费' && p.data.amountYuan === '3000.00'
    && p.data.startMonth === '2026-09' && p.data.totalMonths === '10'
    && p.data.assetKind === 'franchise',
    p.data.name + ' ' + p.data.amountYuan + ' ' + p.data.startMonth + ' ' + p.data.totalMonths);

  check('B-③ 🔴 类别回填时 kindIdx 也跟上（否则选择器显示第一个，老板以为选错了）',
    (function () {
      const list = cfg.data.assetKinds || [];
      const want = list.findIndex((k) => k.key === 'franchise');
      return p.data.kindIdx === want && want >= 0;
    })(), 'kindIdx=' + p.data.kindIdx);

  reset();
  schedule = SCHED();
  p = fresh(cfg);
  p.onLoad({ kind: 'amort', month: '2026-11', group: 'g1' });
  await new Promise((r) => setTimeout(r, 0));
  check('B-④ 🔴 append：沿用同组名称，batchSeq = 同组笔数 + 1（这里 2 笔 ⇒ 3）',
    p.data.name === '设备' && p.data.batchSeq === 3,
    'name=' + p.data.name + ' batchSeq=' + p.data.batchSeq);

  reset();
  schedule = SCHED({ is_archive: true });
  p = fresh(cfg);
  p.onLoad({ kind: 'amort', month: '2026-11' });
  await new Promise((r) => setTimeout(r, 0));
  check('B-⑤ 归档月 ⇒ readOnly=true（页面据此禁用编辑）', p.data.readOnly === true);

  reset();
  schedule = SCHED();
  p = fresh(cfg);
  p.onLoad({ kind: 'amort', month: '2026-11', asset_id: '不存在' });
  await new Promise((r) => setTimeout(r, 0));
  check('B-⑥ 找不到对应记录 ⇒ 不崩（保持空白表单）',
    p.data.loading === false && p.data.name === '', 'name=' + JSON.stringify(p.data.name));

  reset();
  scheduleThrows = true;
  p = fresh(cfg);
  p.onLoad({ kind: 'lump', month: '2026-11' });
  await new Promise((r) => setTimeout(r, 0));
  check('B-⑦ 接口失败 ⇒ loading 收起 + 提示', p.data.loading === false && seen.toastError === 1);

  // =====================================================
  // C · 校验顺序（算钱相关）
  // =====================================================
  sec('C · 保存前校验（顺序 + 金额可读性硬拦）');

  async function ready(amount, o) {
    reset();
    schedule = SCHED();
    const mp = fresh(cfg);
    mp.onLoad(Object.assign({ kind: 'lump', month: '2026-11' }, o || {}));
    await new Promise((r) => setTimeout(r, 0));
    reset();   // 清掉 load 的调用记录
    mp.data.name = '装修款';
    mp.data.amountYuan = amount;
    return mp;
  }

  let mp = await ready('100');
  mp.data.name = '   ';
  mp.onSave();
  check('C-① 名称空 ⇒ 拦下、不发请求',
    !!seen.toast && (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0,
    'toast=' + (seen.toast && seen.toast.title));

  mp = await ready('12,000');
  mp.onSave();
  check('C-② 🔴 金额带千分位（「12,000」读不成数字）⇒ **弹窗硬拦**，绝不静默按 0 存',
    !!seen.modal && (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0,
    'modal=' + (seen.modal && seen.modal.title));

  mp = await ready('12 000');
  mp.onSave();
  check('C-③ 金额带空格 ⇒ 同样硬拦',
    !!seen.modal && (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0);

  mp = await ready('abc');
  mp.onSave();
  check('C-④ 金额是文字 ⇒ 同样硬拦',
    !!seen.modal && (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0);

  mp = await ready('0');
  mp.onSave();
  check('C-⑤ 金额 0 ⇒ 提示「必须大于 0」（可读但不合法）',
    !!seen.toast && !seen.modal && (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0,
    'toast=' + (seen.toast && seen.toast.title));

  mp = await ready('-5');
  mp.onSave();
  check('C-⑥ 负数 ⇒ 拦（不产生负资产）',
    (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0);

  mp = await ready('100');
  mp.data.startMonth = '2026-13';
  mp.onSave();
  check('C-⑦ 起始月格式非法（13 月）⇒ 拦',
    !!seen.toast && (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0,
    'toast=' + (seen.toast && seen.toast.title));

  reset();
  schedule = SCHED();
  mp = fresh(cfg);
  mp.onLoad({ kind: 'amort', month: '2026-11' });
  await new Promise((r) => setTimeout(r, 0));
  reset();
  mp.data.name = '设备'; mp.data.amountYuan = '100'; mp.data.startMonth = '2026-11'; mp.data.totalMonths = '0';
  mp.onSave();
  check('C-⑧ 摊销月数 0 ⇒ 拦（否则摊不满、剩余恒为正）',
    !!seen.toast && (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0,
    'toast=' + (seen.toast && seen.toast.title));

  mp = await ready('12,000');
  mp.data.name = '   ';
  mp.onSave();
  check('C-⑨ 🔴 校验顺序：名称空时先报名称，不会先去报金额（两种错同时存在也只提示第一层）',
    !!seen.toast && !seen.modal, 'toast=' + (seen.toast && seen.toast.title) + ' modal=' + !!seen.modal);

  // =====================================================
  // D · 载荷组装
  // =====================================================
  sec('D · saveAsset 载荷（lump 强制 1 个月 / edit 带 id / append 带组）');

  const realST = global.setTimeout;

  mp = await ready('3000');
  global.setTimeout = (fn) => { fn(); return 0; };
  global.setTimeout = realST;   // 先恢复，测试里不用它
  mp.onSave();
  await new Promise((r) => setTimeout(r, 5));
  let save = (seen.calls || []).filter((c) => c.name === 'saveAsset')[0];
  check('D-① 🔴 一次算清：total_months 强制 1、mode=lump（不跟随老板填的值）',
    !!save && save.params.asset.total_months === 1 && save.params.asset.mode === 'lump',
    save ? JSON.stringify({ m: save.params.asset.mode, months: save.params.asset.total_months }) : '未调用');
  check('D-② 金额按分落库（3000 元 ⇒ 300000 分）',
    !!save && save.params.asset.value_fen === 300000, save ? String(save.params.asset.value_fen) : '未调用');
  check('D-③ 幂等键 as_*',
    !!save && /^as_\d+$/.test(String(save.params.client_request_id)),
    save ? save.params.client_request_id : '未调用');
  check('D-④ 类别随资产落库（未选则为空串，不影响金额）',
    !!save && typeof save.params.asset.asset_kind === 'string',
    save ? JSON.stringify(save.params.asset.asset_kind) : '未调用');

  reset();
  schedule = SCHED();
  mp = fresh(cfg);
  mp.onLoad({ kind: 'amort', month: '2026-11', asset_id: 'a1' });
  await new Promise((r) => setTimeout(r, 0));
  reset();
  mp.data.name = '门面转让费'; mp.data.amountYuan = '3000'; mp.data.startMonth = '2026-09'; mp.data.totalMonths = '10';
  mp.onSave();
  await new Promise((r) => setTimeout(r, 5));
  save = (seen.calls || []).filter((c) => c.name === 'saveAsset')[0];
  check('D-⑤ 摊销编辑：带 asset_id、mode=amort、月数用填的值',
    !!save && save.params.asset.asset_id === 'a1' && save.params.asset.mode === 'amort'
    && save.params.asset.total_months === 10,
    save ? JSON.stringify(save.params.asset) : '未调用');

  reset();
  schedule = SCHED();
  mp = fresh(cfg);
  mp.onLoad({ kind: 'amort', month: '2026-11', group: 'g1' });
  await new Promise((r) => setTimeout(r, 0));
  reset();
  mp.data.name = '设备'; mp.data.amountYuan = '2000'; mp.data.startMonth = '2026-11'; mp.data.totalMonths = '12';
  mp.onSave();
  await new Promise((r) => setTimeout(r, 5));
  save = (seen.calls || []).filter((c) => c.name === 'saveAsset')[0];
  check('D-⑥ 🔴 再投一笔：带 group_id + batch_seq（不带 asset_id，否则会覆盖上一笔）',
    !!save && save.params.asset.group_id === 'g1' && save.params.asset.batch_seq === 3
    && save.params.asset.asset_id === undefined,
    save ? JSON.stringify({ g: save.params.asset.group_id, seq: save.params.asset.batch_seq, id: save.params.asset.asset_id }) : '未调用');

  mp = await ready('100');
  mp.data.saving = true;
  mp.onSave();
  check('D-⑦ saving 时重入不再发请求（防连点重复建资产）',
    (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0);

  reset();
  schedule = SCHED();
  saveThrows = true;
  mp = fresh(cfg);
  mp.onLoad({ kind: 'lump', month: '2026-11' });
  await new Promise((r) => setTimeout(r, 0));
  reset(); saveThrows = true;
  mp.data.name = '装修款'; mp.data.amountYuan = '100'; mp.data.startMonth = '2026-11';
  mp.onSave();
  await new Promise((r) => setTimeout(r, 5));
  check('D-⑧ 保存失败 ⇒ saving 复位（按钮不能永久灰）+ 提示',
    mp.data.saving === false && seen.toastError === 1,
    'saving=' + mp.data.saving + ' toastError=' + seen.toastError);

  // =====================================================
  // E · 删除
  // =====================================================
  sec('E · 删除（只有 edit 模式可删；软删 + 触觉）');

  reset();
  schedule = SCHED();
  p = fresh(cfg);
  p.onLoad({ kind: 'lump', month: '2026-11' });
  await new Promise((r) => setTimeout(r, 0));
  reset();
  p.onDelete();
  check('E-① 新建模式 ⇒ 不弹确认、不发请求', !seen.modal && (seen.calls || []).length === 0);

  reset();
  schedule = SCHED();
  p = fresh(cfg);
  p.onLoad({ kind: 'lump', month: '2026-11', asset_id: 'l1' });
  await new Promise((r) => setTimeout(r, 0));
  reset();
  p.onDelete();
  check('E-② edit 模式未确认 ⇒ 不发请求',
    (seen.calls || []).filter((c) => c.name === 'saveAsset').length === 0);

  reset();
  schedule = SCHED();
  seen.autoConfirm = true;
  p = fresh(cfg);
  p.onLoad({ kind: 'amort', month: '2026-11', asset_id: 'a1' });
  await new Promise((r) => setTimeout(r, 0));
  reset(); seen.autoConfirm = true;
  p.onDelete();
  await new Promise((r) => setTimeout(r, 10));
  const del = (seen.calls || []).filter((c) => c.name === 'saveAsset')[0];
  check('E-③ 确认 ⇒ 软删（delete:true）+ 幂等键 ad_* + 触觉',
    !!del && del.params.asset.delete === true && del.params.asset.asset_id === 'a1'
    && /^ad_\d+$/.test(String(del.params.client_request_id)) && seen.vibrated === 1,
    del ? JSON.stringify(del.params) : '未调用');

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

  // M-1 去掉金额可读硬拦。⚠️ 这里有个容易测错的点：去掉后**请求仍被第二道 fen>0 拦住**，
  //   所以「有没有发请求」测不出退化。真正的退化是**提示原因降级** —— 从「弹窗指名金额读不成」
  //   退成泛泛的「请填金额」。⇒ 判据必须断言「弹窗还在不在」，而不是「有没有拦住」。
  await mut('M-1 去掉金额可读硬拦', 'if (!AmountInput.classifyAmount(this.data.amountYuan).readable) {', 'if (false) {',
    'C-② 千分位指名提示（拦住≠给对原因）', async (mc) => {
      reset(); schedule = SCHED();
      const mp2 = fresh(mc); mp2.onLoad({ kind: 'lump', month: '2026-11' });
      await new Promise((r) => setTimeout(r, 0));
      reset(); mp2.data.name = '装修款'; mp2.data.amountYuan = '12,000'; mp2.data.startMonth = '2026-11';
      mp2.onSave();
      await new Promise((r) => setTimeout(r, 5));
      return { degraded: !seen.modal, detail: 'modal=' + !!seen.modal + ' toast=' + (seen.toast && seen.toast.title) };
    });

  await mut('M-2 lump 不强制 1 个月', "total_months: isLump ? 1 : Number(this.data.totalMonths),", 'total_months: Number(this.data.totalMonths),',
    'D-① lump 强制 1', async (mc) => {
      reset(); schedule = SCHED();
      const mp2 = fresh(mc); mp2.onLoad({ kind: 'lump', month: '2026-11' });
      await new Promise((r) => setTimeout(r, 0));
      reset(); mp2.data.name = '装修款'; mp2.data.amountYuan = '100'; mp2.data.startMonth = '2026-11'; mp2.data.totalMonths = '6';
      mp2.onSave();
      await new Promise((r) => setTimeout(r, 5));
      const s = (seen.calls || []).filter((c) => c.name === 'saveAsset')[0];
      return { degraded: !!s && s.params.asset.total_months !== 1, detail: s ? 'months=' + s.params.asset.total_months : '未调用' };
    });

  await mut('M-3 mode 判定不看 asset_id', "const mode = assetId ? 'edit' : (groupKey ? 'append' : 'new');", "const mode = 'new';",
    'A-① edit 判定', async (mc) => {
      reset(); schedule = SCHED();
      const mp2 = fresh(mc); mp2.onLoad({ kind: 'amort', month: '2026-11', asset_id: 'a1' });
      return { degraded: mp2.data.mode !== 'edit', detail: 'mode=' + mp2.data.mode };
    });

  await mut('M-4 删除文案整块覆盖 t', "'t.fDelete': kind === 'lump' ? T.lumpDelete : T.amortDelete,", 't: {},',
    'A-⑥ t 词条被整块覆盖', async (mc) => {
      reset(); schedule = SCHED();
      const mp2 = fresh(mc); mp2.onLoad({ kind: 'lump', month: '2026-11' });
      const lost = Object.keys(cfg.data.t).filter((k) => mp2.data.t[k] === undefined);
      return { degraded: lost.length > 0, detail: '丢键=' + lost.slice(0, 4).join(',') + '（共 ' + lost.length + '）' };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
