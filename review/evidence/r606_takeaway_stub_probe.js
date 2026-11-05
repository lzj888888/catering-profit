// 探针：页面桩真跑 subpkg/biz/month/input.js 的外卖录入 handler
// 目的：判定「填不进去」是 handler 逻辑问题还是结构/CSS 问题。
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const PAGE_DIR = path.join(ROOT, 'subpkg/biz/month');
const PAGE_FILE = path.join(PAGE_DIR, 'input.js');
const src = fs.readFileSync(PAGE_FILE, 'utf8');

// ---- 桩 ----
let cfg = null;
global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
const store = {};
global.wx = {
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  showToast: () => {}, showModal: () => ({}),
  cloud: { callFunction: () => ({}) },
  navigateTo: () => {},
};

function realReq(p) { return require(path.resolve(PAGE_DIR, p)); }
function fakeRequire(p) {
  if (/terms\.js$/.test(p)) return realReq(p);
  if (/takeaway\.js$/.test(p)) return realReq(p);
  if (/amountInput\.js$/.test(p)) return realReq(p);
  if (/dineChannels\.js$/.test(p)) return realReq(p);
  // IO / 副作用类：打空桩
  return {};
}

// ---- 加载页面源码（内存，不落盘） ----
const mod = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
  mod, mod.exports, fakeRequire, PAGE_DIR, PAGE_FILE
);
if (!cfg) { console.error('FAIL: Page() 未捕获配置'); process.exit(2); }

// ---- 构造实例 ----
const p = Object.assign({}, cfg);
p.data = JSON.parse(JSON.stringify(cfg.data));
function merge(patch) {
  for (const k in patch) {
    if (k.indexOf('.') >= 0) {
      const parts = k.split('.');
      let o = p.data;
      for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] = o[parts[i]] || {});
      o[parts[parts.length - 1]] = patch[k];
    } else {
      p.data[k] = patch[k];
    }
  }
}
p.setData = function (patch) { merge(patch); };

// 外卖组（net 默认）
p.data.incomeGroups = [{
  category: 'takeaway', label: '外卖收入', expanded: true, scope: '',
  rows: [
    { subItem: '美团', amountYuan: '', qty: '', subsidy: '' },
    { subItem: '饿了么', amountYuan: '', qty: '', subsidy: '' },
  ],
}];
p.data.takeoutMode = 'fast';
p.data.takeoutTrack = 'net';
p.data.takeoutDetailRows = [];
p.data.readOnly = false;

function ev(kind, gidx, ridx, field, idx, val) {
  const d = { kind, gidx: String(gidx), ridx: String(ridx), field, idx: String(idx) };
  return { currentTarget: { dataset: d }, detail: { value: val } };
}
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push('PASS ' + name);
  } catch (e) {
    results.push('THROW ' + name + ' :: ' + (e && e.stack ? e.stack.split('\n').slice(0,3).join(' | ') : e));
  }
}

// === net 模式 ===
test('net.onSubAmount 金额', () => {
  p.onSubAmount(ev('income', 0, 0, null, null, '123'));
  if (p.data.incomeGroups[0].rows[0].amountYuan !== '123') throw new Error('amountYuan 未回写=' + p.data.incomeGroups[0].rows[0].amountYuan);
});
test('net.onFastQty 单数', () => {
  p.onFastQty(ev('income', 0, 1, null, null, '5'));
  if (p.data.incomeGroups[0].rows[1].qty !== '5') throw new Error('qty 未回写=' + p.data.incomeGroups[0].rows[1].qty);
});

// === gross 模式 ===
p.data.takeoutTrack = 'gross';
p.data.takeoutMode = 'detail';
p.data.takeoutDetailRows = [{ platform: '美团', goods: '', pack: '', subsidy: '', qty: '' }];
test('gross.onTwDetail goods', () => {
  p.onTwDetail(ev(null, 0, 0, 'goods', 0, '100'));
  if (p.data.takeoutDetailRows[0].goods !== '100') throw new Error('goods 未回写=' + p.data.takeoutDetailRows[0].goods);
});
test('gross.onTwDetail pack', () => {
  p.onTwDetail(ev(null, 0, 0, 'pack', 0, '10'));
  if (p.data.takeoutDetailRows[0].pack !== '10') throw new Error('pack 未回写=' + p.data.takeoutDetailRows[0].pack);
});
test('gross.onTwDetail qty', () => {
  p.onTwDetail(ev(null, 0, 0, 'qty', 0, '7'));
  if (p.data.takeoutDetailRows[0].qty !== '7') throw new Error('qty 未回写=' + p.data.takeoutDetailRows[0].qty);
});
test('gross.onRecYuan 配平', () => {
  p.onRecYuan({ detail: { value: '90' } });
  if (p.data.twRecYuan !== '90') throw new Error('twRecYuan 未回写=' + p.data.twRecYuan);
});

console.log(results.join('\n'));
const failed = results.filter((r) => !r.startsWith('PASS'));

// === R606：行级稳定键 rid（防 wx:key="index" 导致的「下方框填不进」）===
test('R606 decorateRows 为外卖行注入唯一 rid', () => {
  const g = { category: 'takeaway', items: ['美团', '饿了么', '抖音'] };
  const rows = [
    { subItem: '美团', amountYuan: '', qty: '', subsidy: '' },
    { subItem: '饿了么', amountYuan: '', qty: '', subsidy: '' },
    { subItem: '抖音', amountYuan: '', qty: '', subsidy: '' },
  ];
  const dec = p.decorateRows(g, rows);
  const ids = dec.map((r) => r.rid);
  if (ids.some((x) => typeof x !== 'string' || !x)) throw new Error('存在缺失 rid: ' + JSON.stringify(ids));
  if (new Set(ids).size !== ids.length) throw new Error('rid 不唯一: ' + JSON.stringify(ids));
});
test('R606 重装饰保留已有 rid（稳定，不漂移）', () => {
  const g = { category: 'takeaway', items: ['美团', '饿了么'] };
  const rows = [
    { subItem: '美团', amountYuan: '10', qty: '1', subsidy: '' },
    { subItem: '饿了么', amountYuan: '20', qty: '2', subsidy: '' },
  ];
  const dec1 = p.decorateRows(g, rows);
  const rid0 = dec1[0].rid;
  // 模拟更新后再装饰（addRow / delRow / 切模式 等路径都会再过 decorateRows）
  const dec2 = p.decorateRows(g, dec1.map((r) => Object.assign({}, r)));
  if (dec2[0].rid !== rid0) throw new Error('重装饰后 rid 漂移: ' + rid0 + ' -> ' + dec2[0].rid);
});
test('R606 dine_in 渠道行也拿到稳定 rid', () => {
  const g = { category: 'dine_in', items: ['堂食', '外卖', '团购'] };
  const rows = [
    { subItem: '堂食', amountYuan: '100', fixed: true },
    { subItem: '团购', amountYuan: '', fixed: false, custom: true },
  ];
  const dec = p.decorateRows(g, rows);
  const ids = dec.map((r) => r.rid);
  if (ids.some((x) => typeof x !== 'string' || !x)) throw new Error('dine_in 缺失 rid: ' + JSON.stringify(ids));
  if (new Set(ids).size !== ids.length) throw new Error('dine_in rid 不唯一: ' + JSON.stringify(ids));
  // 预设行用「p:<渠道名>」应稳定可复现
  const dec2 = p.decorateRows(g, dec.map((r) => Object.assign({}, r)));
  if (dec2[0].rid !== dec[0].rid) throw new Error('dine_in 预设行 rid 不稳: ' + dec[0].rid + ' -> ' + dec2[0].rid);
});

const failed2 = results.filter((r) => !r.startsWith('PASS'));
console.log('\nR606 rid 回归: ' + (results.length - failed2.length) + '/' + results.length + ' PASS');
console.log('\nSUMMARY: ' + (results.length - failed2.length) + '/' + results.length + ' PASS');
process.exit(failed2.length ? 1 : 0);
