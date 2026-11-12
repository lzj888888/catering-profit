#!/usr/bin/env node
// tools/check_material_pages_stub.js —— R1-4（台账 P1）原料两页行为守卫
//
// 为什么需要它：`subpkg/biz/material/batch`（批量录入）与 `.../pick`（选原料）
//   此前只有**静态形状守卫**（check_material_batch.js 判的是「有没有这个按钮 / 有没有调纯函数」），
//   **没有一处真跑页面代码**。形状对不等于分支到得了：
//     · batch 的「整表拦截 / 全坏态 / 脏行默认不勾 / 重解析清旧提示」四个分支，
//       静态判据只能看到字符串在不在，看不到走没走到；
//     · batch 的 onSave 分批并发 + 单条失败不拖累其它 + 幂等键每组唯一，
//       这三件事只有真跑才验得出来；
//     · pick 的置顶顺序（严格按老板点选先后）+ 置顶项不在分类组重复出现，
//       是「筛选逻辑对不对」不是「代码写没写」。
//
// 本轮实测补到的真实风险点（不是猜测，是桩跑出来的）：
//   batch 的 `onToggleRow` 对脏行是 `if (!row || !row.ok) return;` —— 若哪天有人把
//   `!row.ok` 去掉，脏行可以被勾上并被 onSave 发出去（saveMaterial 会拒，但老板看到的是
//   「明明勾了却没导进去」）。静态守卫对这条零感知。
//
// 取证层级：L2 页面桩（Page/wx/getApp/api/ui 全桩，真跑页面源码，不复制判断逻辑）。
//   ⚠️ 不替代真机：验的是「数据怎么变成可操作的行 / 组」，不验视觉。
//
// 运行：node tools/check_material_pages_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BATCH = path.join(ROOT, 'subpkg/biz/material/batch.js');
const PICK = path.join(ROOT, 'subpkg/biz/material/pick.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 桩 ----------
let cfg = null;
let calls = [];
let seen = {};            // 记录 wx 调用
let saveFailNames = [];   // 这些名字的 saveMaterial 会失败
let materialList = [];
let shopContext = {};
let shopContextThrows = false;
let globalData = {};

const mockApi = {
  call: async (name, params) => {
    calls.push({ name: name, params: params });
    if (name === 'getMaterial') return { list: materialList };
    if (name === 'getShopContext') { if (shopContextThrows) throw new Error('stub: 偏好读失败'); return shopContext; }
    if (name === 'saveMaterial') {
      const nm = (params && params.material && params.material.name) || '';
      if (saveFailNames.indexOf(nm) >= 0) throw new Error('stub: save fail');
      return { ok: true };
    }
    return {};
  },
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  fenToYuan: (v, n) => (Number(v || 0) / 100).toFixed(n == null ? 2 : n),
  toastError: () => {},
};
const mockUi = { setTitle: (t) => { seen.title = t; } };

global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData });
global.wx = {
  showToast: (o) => { seen.toast = o; },
  showLoading: () => { seen.loading = true; },
  hideLoading: () => { seen.loading = false; },
  setNavigationBarTitle: () => {},
  navigateBack: () => { seen.back = (seen.back || 0) + 1; },
  pageScrollTo: (o) => { seen.scrollTo = o; },
  stopPullDownRefresh: () => {},
  getStorageSync: () => '', setStorageSync: () => {},
};

const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
};
function makeRequire(baseDir) {
  return function (req) {
    if (MOCKS[req]) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}
function loadCfg(file, srcOverride) {
  const src = srcOverride || fs.readFileSync(file, 'utf8');
  cfg = null;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(file)), path.dirname(file), file);
  if (!cfg) throw new Error('Page() 未被调用：' + path.basename(file));
  return cfg;
}
// setData 必须支持 'rows[0].checked' 这种路径写法（batch 里就是这么写的）
function applyPath(obj, key, val) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null) cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') >= 0 || k.indexOf('[') >= 0) applyPath(this.data, k, patch[k]);
      else this.data[k] = patch[k];
    });
  };
  return p;
}
function reset() { calls = []; seen = {}; saveFailNames = []; shopContextThrows = false; globalData = {}; }

(async () => {
  console.log('[R1-4] 原料两页行为守卫（batch 批量录入 / pick 选原料）');

  const BATCH_SRC = fs.readFileSync(BATCH, 'utf8');
  const PICK_SRC = fs.readFileSync(PICK, 'utf8');

  // =====================================================
  // 一、batch（批量录入）
  // =====================================================
  sec('B · 批量录入：粘贴 → 解析 → 预览 → 勾选 → 导入');
  loadCfg(BATCH);

  const MIXED = '名称,采购单价\n炸鸡腿,18.5\n坏行,,斤,abc\n牛腩,42';

  reset();
  let p = fresh(cfg);
  p.data.text = MIXED;
  p.onParse();
  const rows = p.data.rows || [];
  check('B-① 三行解析：2 条合格 / 1 条脏行，计数文案同步',
    rows.length === 3 && p.data.okCount === 2 && p.data.badCount === 1,
    'rows=' + rows.length + ' ok=' + p.data.okCount + ' bad=' + p.data.badCount);
  check('B-② 🔴 脏行默认不勾，合格行默认勾（fail-closed：脏数据不许混进去）',
    rows.length === 3 && rows[0].checked === true && rows[1].checked === false && rows[2].checked === true,
    rows.map((r) => r.ok + '/' + r.checked).join(' '));

  // 脏行即使被点也不许勾
  let before = rows[1].checked;
  p.onToggleRow({ currentTarget: { dataset: { i: 1 } } });
  check('B-③ 🔴 脏行点了也不许勾（否则老板以为勾上了、保存却静默失败）',
    p.data.rows[1].checked === before && before === false,
    'click 后=' + p.data.rows[1].checked);

  p.onToggleRow({ currentTarget: { dataset: { i: 0 } } });
  check('B-④ 🔴 第一行能切换（data-i 是 wx:for 的 0 起索引，`0 || -1` 会把第一行吞成 -1 ⇒ 点不动）',
    p.data.rows[0].checked === false && p.data.checkedCount === 1,
    'checked=' + p.data.rows[0].checked + ' count=' + p.data.checkedCount);

  p.onSelectAll();
  check('B-⑤ 全选只勾合格行（脏行永远不勾），选中数=合格数',
    p.data.rows[1].checked === false && p.data.checkedCount === 2,
    'count=' + p.data.checkedCount);

  p.onUnselect();
  check('B-⑥ 全不选：一个不剩', p.data.checkedCount === 0 && p.data.rows.every((r) => !r.checked));

  // 整表拦截：把菜品销售表当原料表粘了
  reset();
  p = fresh(cfg);
  p.data.text = '重庆小面\t堂食\t12\t216\n卤牛肉\t堂食\t3\t135';
  p.onParse();
  check('B-⑦ 🔴 整表拦截（销售表）：不产红行、blocked=true、把读到的第一行摆给老板看',
    p.data.blocked === true && (p.data.rows || []).length === 0 && !!p.data.blockSample && p.data.okCount === 0,
    'blocked=' + p.data.blocked + ' rows=' + (p.data.rows || []).length + ' sample=' + p.data.blockSample);

  // 全坏态：表是对的，但一条可导行都没有
  reset();
  p = fresh(cfg);
  p.data.text = '名称,采购单价\n甲,,斤,abc\n乙,,斤,xyz';
  p.onParse();
  check('B-⑧ 全坏态：rows 有内容但 okCount=0 ⇒ 给一句「为什么全灰」的说明',
    (p.data.rows || []).length === 2 && p.data.okCount === 0 && !!p.data.allBadTitle,
    'rows=' + (p.data.rows || []).length + ' allBadTitle=' + p.data.allBadTitle);

  // 改对了再解析：旧提示必须清掉
  p.data.text = '名称,采购单价\n甲,12.5';
  p.onParse();
  check('B-⑨ 🔴 改对后再解析，必须清掉上次的 blocked / allBadTitle（否则改对了还挂着旧提示）',
    p.data.blocked === false && p.data.allBadTitle === '' && p.data.okCount === 1,
    'blocked=' + p.data.blocked + ' allBadTitle=' + (p.data.allBadTitle || '(空)'));

  // 空文本
  reset();
  p = fresh(cfg);
  p.data.text = '   ';
  p.onParse();
  check('B-⑩ 空粘贴 ⇒ 只提示、不进入预览态', p.data.parsed !== true && !!seen.toast,
    'parsed=' + p.data.parsed + ' toast=' + (seen.toast && seen.toast.title));

  // 保存：只发勾选的合格行
  reset();
  p = fresh(cfg);
  p.data.text = '名称,采购单价\n炸鸡腿,18.5\n坏行,,斤,abc\n牛腩,42';
  p.onParse();
  await p.onSave();
  const saves = calls.filter((c) => c.name === 'saveMaterial');
  check('B-⑪ 只发「已勾 且 合格」的行（脏行绝不上行）',
    saves.length === 2 && saves.every((c) => c.params.material.name !== '坏行'),
    '发出=' + saves.map((c) => c.params.material.name).join(','));
  const ids = saves.map((c) => c.params.client_request_id);
  check('B-⑫ 🔴 幂等键每条唯一（同批内重复会互相顶掉）',
    ids.length === 2 && ids[0] !== ids[1] && ids.every((x) => /^matb_\d+_\d+$/.test(x)),
    ids.join(' | '));
  check('B-⑬ 成功回执说清条数', !!p.data.doneText && p.data.failText === '' && !seen.loading,
    'done=' + p.data.doneText);

  // 单条失败不拖累其它
  reset();
  p = fresh(cfg);
  p.data.text = '名称,采购单价\n炸鸡腿,18.5\n牛腩,42';
  p.onParse();
  saveFailNames = ['牛腩'];
  await p.onSave();
  check('B-⑭ 🔴 单条失败不拖累其它：成功 1 条 + 失败名单点名',
    /1/.test(p.data.doneText) && /牛腩/.test(p.data.failText),
    'done=' + p.data.doneText + ' fail=' + p.data.failText);

  // 重入
  reset();
  p = fresh(cfg);
  p.data.text = '名称,采购单价\n炸鸡腿,18.5';
  p.onParse();
  p.data.saving = true;
  await p.onSave();
  check('B-⑮ saving 时重入不再发请求（防连点重复导入）',
    calls.filter((c) => c.name === 'saveMaterial').length === 0,
    '发出=' + calls.filter((c) => c.name === 'saveMaterial').length);

  // 一个都没勾
  reset();
  p = fresh(cfg);
  p.data.text = '名称,采购单价\n炸鸡腿,18.5';
  p.onParse();
  p.onUnselect();
  await p.onSave();
  check('B-⑯ 一个都没勾 ⇒ 不发请求、不弹 loading',
    calls.filter((c) => c.name === 'saveMaterial').length === 0 && !seen.loading);

  // 回顶部（R705 的回头路）
  reset();
  p = fresh(cfg);
  p.onBackTop();
  check('B-⑰ 「回顶部改」真有动作（不是个死按钮）', !!seen.scrollTo && seen.scrollTo.scrollTop === 0,
    JSON.stringify(seen.scrollTo));

  // =====================================================
  // 二、pick（选原料）
  // =====================================================
  sec('P · 选原料：分组 / 置顶顺序 / 搜索 / 回传哨兵');
  loadCfg(PICK);

  materialList = [
    { id: 'm1', name: '牛腩', category: 'meat', purchase_unit: '斤', purchase_price_fen: 4200, net_unit_cost: 4200, aliases: '["牛腩肉","beef"]' },
    { id: 'm2', name: '土豆', category: 'veg', purchase_unit: '斤', purchase_price_fen: 300, net_unit_cost: 300, aliases: '[]' },
    { id: 'm3', name: '八角', category: 'season', purchase_unit: '克', purchase_price_fen: 0, net_unit_cost: 0, aliases: '[]' },
    { id: 'm4', name: '打包盒', category: 'pack', purchase_unit: '个', purchase_price_fen: 50, net_unit_cost: 50, aliases: '[]' },
  ];
  shopContext = { pinned_materials: ['m3', 'm1'] };

  reset();
  let q = fresh(cfg);
  q.onLoad({ idx: '2' });
  await q.load();
  check('P-① 物料映射：价格>0 显示元、=0 显示破折号；净成本 4 位小数',
    q.data.all.length === 4 && q.data.all[0].purchase_price === '42.00' && q.data.all[2].purchase_price === '—'
    && q.data.all[0].net_cost === '0.4200' && q.data.all[2].net_cost === '0.0000',
    q.data.all.map((x) => x.name + ':' + x.purchase_price + '/' + x.net_cost).join(' '));
  check('P-② 分类标签走词表（不是英文 key）',
    q.data.all[0].category_label === TERMS.card.catMeat && q.data.all[2].category_label === TERMS.card.catSeason,
    q.data.all.map((x) => x.category_label).join(','));

  const pinGroup = (q.data.groups || []).find((g) => g.key === '__pin__');
  check('P-③ 🔴 置顶组顺序严格按老板点选先后（m3 在前、m1 在后），不按名称/分类重排',
    !!pinGroup && pinGroup.items.length === 2 && pinGroup.items[0].id === 'm3' && pinGroup.items[1].id === 'm1',
    pinGroup ? pinGroup.items.map((x) => x.name).join('→') : '无置顶组');

  const inCats = (q.data.groups || []).filter((g) => g.key !== '__pin__')
    .reduce((acc, g) => acc.concat(g.items.map((x) => x.id)), []);
  check('P-④ 🔴 置顶项不在分类组重复出现（否则同一原料出现两次）',
    pinGroup && inCats.indexOf('m1') < 0 && inCats.indexOf('m3') < 0,
    '分类组里=' + inCats.join(','));

  const catOrder = (q.data.groups || []).filter((g) => g.key !== '__pin__').map((g) => g.key);
  check('P-⑤ 分类组顺序＝采购动线（肉→菜→干货→调料→包材→其他）',
    catOrder.join(',') === 'veg,pack', '实际=' + catOrder.join(','));

  // 搜索：名称
  q.data.keyword = '土豆';
  q.buildGroups();
  check('P-⑥ 按名称搜索命中', (q.data.groups || []).some((g) => g.items.some((x) => x.id === 'm2'))
    && !(q.data.groups || []).some((g) => g.items.some((x) => x.id === 'm1')),
    JSON.stringify((q.data.groups || []).map((g) => g.key + ':' + g.items.map((i) => i.name).join('/'))));

  // 搜索：别名
  q.data.keyword = 'beef';
  q.buildGroups();
  check('P-⑦ 🔴 按别名搜索命中（老板记不住自己起的别名就白存了）',
    (q.data.groups || []).some((g) => g.items.some((x) => x.id === 'm1')));

  // 搜索：大小写
  q.data.keyword = 'BEEF';
  q.buildGroups();
  check('P-⑧ 搜索大小写不敏感',
    (q.data.groups || []).some((g) => g.items.some((x) => x.id === 'm1')));

  // 无命中
  q.data.keyword = '不存在的东西xyz';
  q.buildGroups();
  check('P-⑨ 无命中 ⇒ 组为空（不是把全部倒出来）', (q.data.groups || []).length === 0,
    '组数=' + (q.data.groups || []).length);

  // 偏好读失败不阻断
  shopContextThrows = true;
  reset();
  q = fresh(cfg);
  q.onLoad({ idx: '' });
  let pErr = null;
  try { await q.load(); } catch (e) { pErr = e; }
  check('P-⑩ 🔴 置顶偏好读失败不阻断选原料（它只是排序偏好，不是数据）',
    pErr === null && q.data.all.length === 4 && q.data.loading === false && (q.data.groups || []).length > 0,
    pErr ? (pErr.message || String(pErr)) : 'all=' + q.data.all.length + ' 组=' + (q.data.groups || []).length);

  // 回传：globalData + 哨兵
  shopContext = { pinned_materials: [] };
  reset();
  q = fresh(cfg);
  q.onLoad({ idx: '3' });
  await q.load();
  const t0 = Date.now();
  q.onPick({ currentTarget: { dataset: { m: { id: 'm1', name: '牛腩' } } } });
  const pm = globalData.pickMaterial;
  check('P-⑪ 🔴 选中写 globalData.pickMaterial：带 id/name/idx + at 哨兵（防「没选就返回」被误当选中）',
    !!pm && pm.id === 'm1' && pm.name === '牛腩' && pm.idx === '3' && typeof pm.at === 'number' && pm.at >= t0,
    JSON.stringify(pm));
  check('P-⑫ 选中后返回上一页', seen.back === 1, 'back=' + seen.back);

  reset();
  q = fresh(cfg);
  q.onPick({ currentTarget: { dataset: {} } });
  check('P-⑬ 点到空数据不写脏值、也不跳走',
    globalData.pickMaterial === undefined && !seen.back, JSON.stringify(globalData));

  // 别名是坏 JSON 不崩
  materialList = [{ id: 'mx', name: 'X', category: 'other', aliases: '不是JSON' }];
  shopContext = {};
  reset();
  q = fresh(cfg);
  q.onLoad({});
  let aErr = null;
  try { await q.load(); } catch (e) { aErr = e; }
  check('P-⑭ 别名不是合法 JSON ⇒ 不崩，当空别名处理',
    aErr === null && q.data.all.length === 1 && Array.isArray(q.data.all[0].aliases) && q.data.all[0].aliases.length === 0,
    aErr ? (aErr.message || String(aErr)) : JSON.stringify(q.data.all[0] && q.data.all[0].aliases));

  // =====================================================
  // 三、变异回灌
  // =====================================================
  sec('D · 变异回灌（把关键判据改坏，对应断言必须真的转红）');

  async function mut(label, file, src, from, to, expect, runFn) {
    if (src.indexOf(from) < 0) {
      console.log('  ❌ ' + label + ' 变异锚点漂移：' + from); failN++; return;
    }
    const mutated = src.replace(from, to);
    if (mutated === src) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let mc = null;
    try { mc = loadCfg(file, mutated); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return; }
    let degraded = false, detail = '';
    try {
      const r = await runFn(mc);
      degraded = !!r.degraded; detail = r.detail || '';
    } catch (e) { degraded = true; detail = '变异后抛错：' + ((e && e.message) || e); }
    check(label + ' ⇒ 检出「' + expect + '」退化', degraded, detail);
    loadCfg(file);
  }

  // D-1 脏行默认勾选
  await mut('D-1 脏行默认也勾', BATCH, BATCH_SRC, 'checked: x.ok,', 'checked: true,',
    'B-② 脏行默认不勾', async (mc) => {
      reset();
      const mp = fresh(mc);
      mp.data.text = '名称,采购单价\n炸鸡腿,18.5\n坏行,,斤,abc';
      mp.onParse();
      return { degraded: mp.data.rows[1].checked === true, detail: '脏行 checked=' + mp.data.rows[1].checked };
    });

  // D-2 去掉脏行禁勾
  await mut('D-2 去掉脏行禁勾', BATCH, BATCH_SRC, 'if (!row || !row.ok) return;', 'if (!row) return;',
    'B-③ 脏行点了不许勾', async (mc) => {
      reset();
      const mp = fresh(mc);
      mp.data.text = '名称,采购单价\n炸鸡腿,18.5\n坏行,,斤,abc';
      mp.onParse();
      mp.onToggleRow({ currentTarget: { dataset: { i: 1 } } });
      return { degraded: mp.data.rows[1].checked === true, detail: '脏行 checked=' + mp.data.rows[1].checked };
    });

  // D-3 去掉整表拦截
  await mut('D-3 去掉整表拦截', BATCH, BATCH_SRC, "if (r.blocked === 'sales_table') {", 'if (false) {',
    'B-⑦ 销售表整表拦截', async (mc) => {
      reset();
      const mp = fresh(mc);
      mp.data.text = '重庆小面\t堂食\t12\t216';
      mp.onParse();
      return { degraded: mp.data.blocked !== true, detail: 'blocked=' + mp.data.blocked + ' rows=' + (mp.data.rows || []).length };
    });

  // D-4 置顶顺序反转
  await mut('D-4 置顶顺序反转', PICK, PICK_SRC, 'for (const id of pinnedIds) {', 'for (const id of pinnedIds.slice().reverse()) {',
    'P-③ 置顶严格按点选先后', async (mc) => {
      materialList = [
        { id: 'm1', name: '牛腩', category: 'meat', aliases: '[]' },
        { id: 'm3', name: '八角', category: 'season', aliases: '[]' },
      ];
      shopContext = { pinned_materials: ['m3', 'm1'] };
      reset();
      const mq = fresh(mc);
      mq.onLoad({});
      await mq.load();
      const g = (mq.data.groups || []).find((x) => x.key === '__pin__');
      return { degraded: !!g && g.items[0].id !== 'm3', detail: g ? g.items.map((x) => x.id).join('→') : '无置顶组' };
    });

  // D-5 置顶项在分类组重复
  await mut('D-5 置顶项重复出现', PICK, PICK_SRC, 'matched.filter((m) => m.category === c && !isPinned(m.id))', 'matched.filter((m) => m.category === c)',
    'P-④ 置顶不重复', async (mc) => {
      materialList = [
        { id: 'm1', name: '牛腩', category: 'meat', aliases: '[]' },
        { id: 'm3', name: '八角', category: 'season', aliases: '[]' },
      ];
      shopContext = { pinned_materials: ['m1'] };
      reset();
      const mq = fresh(mc);
      mq.onLoad({});
      await mq.load();
      const inCats = (mq.data.groups || []).filter((g) => g.key !== '__pin__')
        .reduce((a, g) => a.concat(g.items.map((x) => x.id)), []);
      return { degraded: inCats.indexOf('m1') >= 0, detail: '分类组=' + inCats.join(',') };
    });

  // D-6 保存不筛合格行
  await mut('D-6 保存不筛合格行', BATCH, BATCH_SRC, 'this.data.rows.filter((x) => x.checked && x.ok);', 'this.data.rows.filter((x) => x.checked);',
    'B-⑪ 只发勾选且合格的行', async (mc) => {
      reset();
      const mp = fresh(mc);
      mp.data.text = '名称,采购单价\n炸鸡腿,18.5\n坏行,,斤,abc';
      mp.onParse();
      mp.data.rows[1].checked = true;   // 强行勾上脏行
      await mp.onSave();
      const n = calls.filter((c) => c.name === 'saveMaterial' && c.params.material.name === '坏行').length;
      return { degraded: n > 0, detail: '脏行发出=' + n };
    });

  // D-7 🔴 R724 实锤缺陷回灌：把 i 解析改回「0 被 || 当假值」⇒ 第一行必须点不动
  await mut('D-7 第一行索引被 0||-1 吞掉', BATCH, BATCH_SRC, 'if (!Number.isInteger(i) || i < 0) return;', 'if (!i || i < 0) return;',
    'B-④ 第一行能切换', async (mc) => {
      reset();
      const mp = fresh(mc);
      mp.data.text = '名称,采购单价\n炸鸡腿,18.5\n牛腩,42';
      mp.onParse();
      mp.onToggleRow({ currentTarget: { dataset: { i: 0 } } });
      return { degraded: mp.data.rows[0].checked === true, detail: '第一行 checked=' + mp.data.rows[0].checked };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
