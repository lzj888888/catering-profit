#!/usr/bin/env node
// tools/check_material_index_stub.js —— R1-8（台账）原料库列表页行为守卫
//
// 为什么需要它：`subpkg/biz/material/index.js` 是原料库的**总入口**，老板查价、改价、
//   删档、看影响面都从这里进；此前零桩（只有静态形状守卫）。
//
// 这页最容易出的五类静默错误：
//   ① **置顶乐观更新失败不回滚**：点击立刻有反馈是对的，但失败不回滚 ⇒ 界面停在
//      「看起来成功」的状态，实际店铺偏好没存 ⇒ 换手机后顺序又变了，老板以为是系统抽风。
//   ② **虚拟原料被当成普通原料**：`is_virtual` 的原料只读（由半成品卡级联产生），
//      编辑/删除本就不可做。不拦 ⇒ 点了报错，或者更糟：删掉一条本该由卡片管理的记录。
//      菜单项数量也必须分叉：虚拟只有「置顶」一项。
//   ③ **换算单位写死**：round151 修过一次真误导 —— 按「箱/个」采购的原料被显示成
//      「1 箱 = 24 克」。正确做法是基准单位随计量族走（箱→个 / 斤→克 / 瓶→个）。
//   ④ **排序丢了置顶顺序**：置顶在前且**按老板点选先后**（不是字母序）；其余按最近编辑。
//      顺序错了老板会以为自己的置顶没生效。
//   ⑤ **pinned 标记没打在数据上**：WXML 表达式**不支持方法调用**（`pinned.indexOf(...)` 无效），
//      标记必须在 JS 里算好写进每条记录。
//
// 取证层级：L2 页面桩（Page/wx/getApp/api/ui 全桩，真跑页面源码）。
//   ⚠️ 不替代真机：验的是「数据怎么变成列表与菜单」，不验视觉。
//
// 运行：node tools/check_material_index_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/material/index.js');
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
let mats = [];
let shopCtx = { pinned_materials: [] };
let shopCtxThrows = false;
let savePinnedThrows = false;
let deleteThrows = false;

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls = (seen.calls || []).concat({ name, params });
    if (name === 'getMaterial') return { list: mats };
    if (name === 'getShopContext') { if (shopCtxThrows) throw new Error('stub: 偏好读失败'); return shopCtx; }
    if (name === 'saveShopSetting') { if (savePinnedThrows) throw new Error('stub: 偏好写失败'); return {}; }
    if (name === 'saveMaterial') { if (deleteThrows) throw new Error('stub: 删除失败'); return {}; }
    return {};
  },
  fenToYuan: (v, n) => (Number(v || 0) / 100).toFixed(n == null ? 2 : n),
  toastError: () => { seen.toastError = (seen.toastError || 0) + 1; },
};
const mockUi = { setTitle: () => {} };

global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: {} });
global.wx = {
  showToast: (o) => { seen.toast = o; },
  showModal: (o) => { seen.modal = o; if (seen.autoConfirm && o.success) o.success({ confirm: true }); },
  showActionSheet: (o) => { seen.sheet = o; if (seen.tapIndex != null && o.success) o.success({ tapIndex: seen.tapIndex }); },
  navigateTo: (o) => { seen.navigateTo = (seen.navigateTo || []).concat(o.url); },
  stopPullDownRefresh: () => { seen.stopped = true; },
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
  if (!cfg) throw new Error('Page() 未被调用：material/index.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() {
  seen = {}; mats = []; shopCtx = { pinned_materials: [] };
  shopCtxThrows = false; savePinnedThrows = false; deleteThrows = false;
}

function M(o) {
  return Object.assign({
    id: 'm1', name: '牛腩', brand_spec: '', purchase_unit: '斤', purchase_price_fen: 4200,
    convert_factor: 500, yield_rate: 95, net_unit_cost: 4200, is_virtual: false,
    category: 'meat', updated_at: 100, aliases: '["牛腩肉","beef"]',
  }, o || {});
}

(async () => {
  console.log('[R1-8] 原料库列表页行为守卫（装配 / 过滤排序 / 置顶 / 虚拟只读 / 删除）');

  const SRC = fs.readFileSync(PAGE, 'utf8');
  loadCfg();

  // =====================================================
  // A · 装配
  // =====================================================
  sec('A · load 装配（价格/成本/换算/分类选项）');

  reset();
  mats = [
    M({ id: 'm1', name: '牛腩', purchase_price_fen: 4200, net_unit_cost: 4200 }),
    M({ id: 'm2', name: '八角', category: 'season', purchase_unit: '克', convert_factor: 1, purchase_price_fen: 0, net_unit_cost: 0, yield_rate: 0 }),
  ];
  let p = fresh(cfg);
  await p.load();
  check('A-① 价格 >0 显示元、=0 显示破折号',
    p.data.all[0].purchase_price === '42.00' && p.data.all[1].purchase_price === '—',
    p.data.all.map((x) => x.purchase_price).join(' | '));
  check('A-② 净成本 >0 四位小数、=0 显示 0.0000',
    p.data.all[0].net_cost === '0.4200' && p.data.all[1].net_cost === '0.0000',
    p.data.all.map((x) => x.net_cost).join(' | '));
  check('A-③ 🔴 换算行基准单位随计量族（斤→克 / 克→克），不是写死「克」',
    p.data.all[0].spec_line.indexOf('1 斤 = 500 克') === 0 && p.data.all[1].spec_line.indexOf('1 克 = 1 克') === 0,
    p.data.all.map((x) => x.spec_line).join(' ; '));

  reset();
  mats = [M({ id: 'm3', name: '打包盒', purchase_unit: '箱', convert_factor: 24, category: 'pack', yield_rate: 0 })];
  p = fresh(cfg);
  await p.load();
  check('A-④ 🔴 计数族「箱」的基准是「个」—— 曾显示成「1 箱 = 24 克」（round151 真误导线）',
    p.data.all[0].spec_line.indexOf('1 箱 = 24 个') === 0, p.data.all[0].spec_line);

  reset();
  mats = [M({ id: 'm1', name: '牛腩', yield_rate: 95 }), M({ id: 'm4', name: '无出成率', yield_rate: 0 })];
  p = fresh(cfg);
  await p.load();
  check('A-⑤ 出成率 >0 才拼进换算行（0 不显示「出成率 0%」）',
    /95%/.test(p.data.all[0].spec_line) && !/0%/.test(p.data.all[1].spec_line),
    p.data.all.map((x) => x.spec_line).join(' ; '));

  reset();
  mats = [
    M({ id: 'm1', category: 'meat' }), M({ id: 'm2', category: 'meat' }),
    M({ id: 'm3', category: 'veg' }), M({ id: 'm5', category: '' }),
  ];
  p = fresh(cfg);
  await p.load();
  check('A-⑥ 分类选项去重且「全部」在首位（只列实际出现的分类）',
    p.data.catOptions[0].value === '' && p.data.catOptions.length === 4
    && p.data.catOptions.filter((o) => o.value === 'meat').length === 1,
    JSON.stringify(p.data.catOptions.map((o) => o.value)));

  reset();
  mats = [M({ id: 'm6', aliases: '不是JSON' })];
  p = fresh(cfg);
  let aErr = null;
  try { await p.load(); } catch (e) { aErr = e; }
  check('A-⑦ 别名不是合法 JSON ⇒ 不崩，当空别名',
    aErr === null && Array.isArray(p.data.all[0].aliases) && p.data.all[0].aliases.length === 0,
    aErr ? (aErr.message || String(aErr)) : 'ok');

  reset();
  mats = [M({ id: 'm1' })];
  shopCtxThrows = true;
  p = fresh(cfg);
  let bErr = null;
  try { await p.load(); } catch (e) { bErr = e; }
  check('A-⑧ 🔴 置顶偏好读失败不阻断列表（它只是排序偏好，不是数据）',
    bErr === null && p.data.all.length === 1 && p.data.pinned.length === 0 && p.data.loading === false,
    bErr ? (bErr.message || String(bErr)) : 'all=' + p.data.all.length);

  reset();
  mats = [M({ id: 'm1' })];
  const boom = { get list() { throw new Error('stub: 列表炸了'); } };
  const savedCall = mockApi.call;
  mockApi.call = async (name) => { if (name === 'getMaterial') return boom; return {}; };
  p = fresh(cfg);
  let cErr = null;
  try { await p.load(); } catch (e) { cErr = e; }
  mockApi.call = savedCall;
  check('A-⑨ 列表接口失败 ⇒ 不崩、loading 收起、有提示',
    cErr === null && p.data.loading === false && seen.toastError === 1,
    cErr ? (cErr.message || String(cErr)) : 'toastError=' + seen.toastError);

  // =====================================================
  // B · 过滤与排序
  // =====================================================
  sec('B · 搜索 / 分类 / 排序（置顶顺序是老板点选先后，不是字母序）');

  reset();
  mats = [
    M({ id: 'm1', name: '牛腩', category: 'meat', updated_at: 300, aliases: '["beef"]' }),
    M({ id: 'm2', name: '土豆', category: 'veg', updated_at: 200, aliases: '[]' }),
    M({ id: 'm3', name: '牛肉丸', category: 'meat', updated_at: 100, aliases: '["牛肉丸子"]' }),
  ];
  shopCtx = { pinned_materials: ['m3', 'm1'] };
  p = fresh(cfg);
  await p.load();

  check('B-① 置顶在前且**按点选先后**（m3 先于 m1），其余按最近编辑（m2）',
    p.data.list.map((x) => x.id).join(',') === 'm3,m1,m2',
    p.data.list.map((x) => x.id).join(','));

  check('B-② 🔴 pinned 标记已打在每条数据上（WXML 不支持方法调用）',
    p.data.list.every((x) => typeof x.pinned === 'boolean'),
    p.data.list.map((x) => x.id + ':' + x.pinned).join(' '));

  check('B-③ 置顶项标记为 true、非置顶为 false',
    p.data.list.find((x) => x.id === 'm3').pinned === true
    && p.data.list.find((x) => x.id === 'm2').pinned === false);

  p.onKeyword({ detail: { value: '牛' } });
  check('B-④ 名称搜索命中（牛腩 + 牛肉丸，不含土豆）',
    p.data.list.map((x) => x.id).sort().join(',') === 'm1,m3',
    p.data.list.map((x) => x.id).join(','));

  p.onKeyword({ detail: { value: 'beef' } });
  check('B-⑤ 🔴 别名搜索命中（只搜别名「beef」也找得到牛腩）',
    p.data.list.length === 1 && p.data.list[0].id === 'm1',
    p.data.list.map((x) => x.id).join(','));

  p.onKeyword({ detail: { value: 'BEEF' } });
  check('B-⑥ 搜索大小写不敏感', p.data.list.length === 1 && p.data.list[0].id === 'm1');

  p.onKeyword({ detail: { value: '' } });
  const vegIdx = p.data.catOptions.findIndex((o) => o.value === 'veg');
  p.onCatFilter({ detail: { value: String(vegIdx) } });
  check('B-⑦ 分类过滤只留该类',
    p.data.list.length === 1 && p.data.list[0].id === 'm2',
    p.data.list.map((x) => x.id).join(','));

  p.onKeyword({ detail: { value: '牛' } });
  check('B-⑧ 搜索 + 分类叠加（veg 里没有「牛」⇒ 空）', p.data.list.length === 0,
    'list=' + p.data.list.length);

  p.onKeyword({ detail: { value: '不存在xyz' } });
  check('B-⑨ 无命中 ⇒ 空列表（不是把全部倒出来）', p.data.list.length === 0);

  // =====================================================
  // C · 置顶（乐观更新必须能回滚）
  // =====================================================
  sec('C · 置顶（乐观更新 + 失败回滚）');

  reset();
  mats = [M({ id: 'm1' }), M({ id: 'm2' })];
  shopCtx = { pinned_materials: [] };
  p = fresh(cfg);
  await p.load();
  await p.onPin({ currentTarget: { dataset: { id: 'm2' } } });
  check('C-① 置顶 ⇒ 插到 pinned 最前 + 发 saveShopSetting 带 pinned_materials',
    p.data.pinned[0] === 'm2'
    && (seen.calls || []).some((c) => c.name === 'saveShopSetting' && Array.isArray(c.params.pinned_materials)),
    'pinned=' + JSON.stringify(p.data.pinned));

  reset();
  mats = [M({ id: 'm1' }), M({ id: 'm2' })];
  shopCtx = { pinned_materials: ['m1', 'm2'] };
  p = fresh(cfg);
  await p.load();
  await p.onPin({ currentTarget: { dataset: { id: 'm1' } } });
  check('C-② 取消置顶 ⇒ 从 pinned 移除（顺序保留其余）',
    p.data.pinned.join(',') === 'm2', JSON.stringify(p.data.pinned));

  reset();
  mats = [M({ id: 'm1' }), M({ id: 'm2' })];
  shopCtx = { pinned_materials: [] };
  savePinnedThrows = true;
  p = fresh(cfg);
  await p.load();
  await p.onPin({ currentTarget: { dataset: { id: 'm2' } } });
  check('C-③ 🔴 保存失败 ⇒ 置顶必须回滚到原状态（界面不能停在「看起来成功」）',
    p.data.pinned.length === 0 && seen.toastError === 1,
    'pinned=' + JSON.stringify(p.data.pinned) + ' toastError=' + seen.toastError);

  reset();
  mats = [M({ id: 'm1' })];
  p = fresh(cfg);
  await p.load();
  await p.onPin({ currentTarget: { dataset: { id: 'm1' } } });
  const pinCall = (seen.calls || []).filter((c) => c.name === 'saveShopSetting')[0];
  check('C-④ 置顶写库带幂等键 pm_*',
    !!pinCall && /^pm_\d+$/.test(String(pinCall.params.client_request_id)),
    pinCall ? pinCall.params.client_request_id : '未调用');

  // =====================================================
  // D · 虚拟原料只读
  // =====================================================
  sec('D · 虚拟原料只读（菜单项分叉 / 编辑删除都要拦）');

  reset();
  p = fresh(cfg);
  const VM = { id: 'v1', name: '半成品·红油', is_virtual: true, pinned: false };
  p.onMore({ currentTarget: { dataset: { m: VM } } });
  check('D-① 🔴 虚拟原料的菜单**只有一项**（置顶）—— 编辑/删除本就不可做',
    !!seen.sheet && seen.sheet.itemList.length === 1,
    seen.sheet ? JSON.stringify(seen.sheet.itemList) : '无菜单');

  reset();
  p = fresh(cfg);
  const NM = { id: 'm1', name: '牛腩', is_virtual: false, pinned: false };
  p.onMore({ currentTarget: { dataset: { m: NM } } });
  check('D-② 普通原料菜单三项（置顶/编辑/删除）—— 影响面已在卡片常驻，不重复',
    !!seen.sheet && seen.sheet.itemList.length === 3,
    seen.sheet ? JSON.stringify(seen.sheet.itemList) : '无菜单');

  reset();
  p = fresh(cfg);
  p.goEdit({ currentTarget: { dataset: { m: VM } } });
  check('D-③ 🔴 虚拟原料不能编辑：只提示、不跳转',
    !!seen.toast && !seen.navigateTo, 'navigateTo=' + JSON.stringify(seen.navigateTo));

  reset();
  p = fresh(cfg);
  p.onDelete({ currentTarget: { dataset: { m: VM } } });
  check('D-④ 🔴 虚拟原料不能删除：只提示、不弹确认、不发请求',
    !!seen.toast && !seen.modal && (seen.calls || []).length === 0,
    'modal=' + !!seen.modal + ' calls=' + (seen.calls || []).length);

  reset();
  p = fresh(cfg);
  p.goEdit({ currentTarget: { dataset: { m: NM } } });
  check('D-⑤ 普通原料可编辑：跳到 edit?id=',
    (seen.navigateTo || []).length === 1 && seen.navigateTo[0].indexOf('material/edit?id=m1') >= 0,
    JSON.stringify(seen.navigateTo));

  // =====================================================
  // E · 删除（软删 + 二次确认）
  // =====================================================
  sec('E · 删除（软删 / 二次确认 / 成功后重拉）');

  reset();
  mats = [M({ id: 'm1' })];
  p = fresh(cfg);
  await p.load();
  p.onDelete({ currentTarget: { dataset: { m: NM } } });
  check('E-① 未确认 ⇒ 不发请求',
    (seen.calls || []).filter((c) => c.name === 'saveMaterial').length === 0);

  reset();
  mats = [M({ id: 'm1' })];
  seen.autoConfirm = true;
  p = fresh(cfg);
  await p.load();
  p.onDelete({ currentTarget: { dataset: { m: NM } } });
  await new Promise((r) => setTimeout(r, 10));
  const del = (seen.calls || []).filter((c) => c.name === 'saveMaterial')[0];
  check('E-② 确认 ⇒ 软删（_delete:true）+ 幂等键 md_*',
    !!del && del.params.material.id === 'm1' && del.params.material._delete === true
    && /^md_\d+$/.test(String(del.params.client_request_id)),
    del ? JSON.stringify(del.params) : '未调用');
  check('E-③ 删除成功后重拉列表（不能留着已删的那条）',
    (seen.calls || []).filter((c) => c.name === 'getMaterial').length >= 2,
    'getMaterial 次数=' + (seen.calls || []).filter((c) => c.name === 'getMaterial').length);

  // =====================================================
  // F · 导航
  // =====================================================
  sec('F · 入口跳转');

  reset();
  p = fresh(cfg);
  p.goAdd(); p.goBatch(); p.goImpact({ currentTarget: { dataset: { m: { id: 'm1', name: '牛 腩' } } } });
  const navs = seen.navigateTo || [];
  check('F-① 新增 / 批量录入 / 影响面三个入口都跳对',
    navs.length === 3
    && navs.some((u) => u.indexOf('material/edit?id=') >= 0)
    && navs.some((u) => u.indexOf('material/batch') >= 0)
    && navs.some((u) => u.indexOf('metrics/impact?material_id=m1') >= 0),
    JSON.stringify(navs));
  check('F-② 🔴 影响面 URL 里的名称做了 encodeURIComponent（带空格/中文不截断）',
    navs.some((u) => u.indexOf('name=%E7%89%9B%20%E8%85%A9') >= 0),
    navs.find((u) => u.indexOf('impact') >= 0));

  reset();
  mats = [M({ id: 'm1' })];
  p = fresh(cfg);
  p.onPullDownRefresh();
  await new Promise((r) => setTimeout(r, 10));
  check('F-③ 下拉刷新真停转圈', seen.stopped === true);

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

  await mut('M-1 置顶失败不回滚', "this.setData({ pinned: backup });", '', 'C-③ 失败回滚', async (mc) => {
    reset(); mats = [M({ id: 'm1' }), M({ id: 'm2' })]; shopCtx = { pinned_materials: [] }; savePinnedThrows = true;
    const mp = fresh(mc); await mp.load();
    await mp.onPin({ currentTarget: { dataset: { id: 'm2' } } });
    return { degraded: mp.data.pinned.length > 0, detail: 'pinned=' + JSON.stringify(mp.data.pinned) };
  });

  await mut('M-2 换算基准写死「克」', "units.baseWordOf(m.purchase_unit || TERMS.card.matUnitDefault)", "'克'",
    'A-④ 箱→个', async (mc) => {
      reset(); mats = [M({ id: 'm3', purchase_unit: '箱', convert_factor: 24, yield_rate: 0 })];
      const mp = fresh(mc); await mp.load();
      return { degraded: mp.data.all[0].spec_line.indexOf('24 个') < 0, detail: mp.data.all[0].spec_line };
    });

  await mut('M-3 虚拟原料不拦编辑', "if (m.is_virtual) { wx.showToast({ title: TERMS.card.matVirtual, icon: 'none' }); return; } // 虚拟只读",
    '', 'D-③ 虚拟只读', async (mc) => {
      reset();
      const mp = fresh(mc);
      mp.goEdit({ currentTarget: { dataset: { m: { id: 'v1', name: '半成品', is_virtual: true } } } });
      return { degraded: (seen.navigateTo || []).length > 0, detail: 'navigateTo=' + JSON.stringify(seen.navigateTo) };
    });

  await mut('M-4 排序忽略置顶', 'const ra = rank(a), rb = rank(b);', 'const ra = 0, rb = 0;',
    'B-① 置顶顺序', async (mc) => {
      reset();
      mats = [M({ id: 'm1', updated_at: 300 }), M({ id: 'm2', updated_at: 200 }), M({ id: 'm3', updated_at: 100 })];
      shopCtx = { pinned_materials: ['m3', 'm1'] };
      const mp = fresh(mc); await mp.load();
      return { degraded: mp.data.list[0].id !== 'm3', detail: 'list=' + mp.data.list.map((x) => x.id).join(',') };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
