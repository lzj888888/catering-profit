#!/usr/bin/env node
// tools/check_shop_setting_stub.js —— R1-8（台账）店铺设置页行为守卫
//
// 为什么需要它：`subpkg/tools/shop/setting.js` 是改店名/备注的唯一入口，此前零桩。
//   页面只有 71 行，但有一处**跨页互踩**的雷：
//
//   🔴 2026-09-20 把「库存 / 摊销」两个核算开关**迁出**了本页，改到「月度录入」页就地选。
//      本页 `onSave` 因此**必须只传 name / remark，绝不能传 switches**。
//      `saveShopSetting` 的语义是「未传字段 = 不动库」⇒ 一旦有人图省事把 `switches` 一起传上来
//      （哪怕是 `{}` 或从 globalData 读来的旧值），就会把老板在月度录入页刚选的核算方式**静默冲掉**，
//      而界面会正常提示「已保存」——零报错、跨页症状、极难归因。
//
//   另外两条常见失效：
//   · 保存后**不重拉上下文** ⇒ 返回上一页（首页/月度页）仍显示旧店名，老板以为没存上；
//   · `onShow` 改成读缓存 ⇒ 在别处改了店名，回到本页看到旧值。
//
// 取证层级：L2 页面桩（Page/wx/getApp/api/ui 全桩，真跑页面源码）。
//   ⚠️ 不替代真机：验的是「读回什么 / 提交什么载荷」，不验输入框体验。
//
// 运行：node tools/check_shop_setting_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/tools/shop/setting.js');
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
let ctxResp = {};
let ctxThrows = false;
let saveThrows = false;
let appStub = null;

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls = (seen.calls || []).concat({ name, params });
    if (name === 'getShopContext') { if (ctxThrows) throw new Error('stub: 上下文失败'); return ctxResp; }
    if (name === 'saveShopSetting') { if (saveThrows) throw new Error('stub: 保存失败'); return {}; }
    return {};
  },
  toastError: () => { seen.toastError = (seen.toastError || 0) + 1; },
};
const mockUi = { setTitle: () => {} };

global.Page = (c) => { cfg = c; };
global.wx = {
  showToast: (o) => { seen.toast = o; },
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
  appStub = { globalData: {}, ctx: null, setShopContext(c) { this.ctx = c; } };
  global.getApp = () => appStub;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：shop/setting.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() { seen = {}; ctxResp = {}; ctxThrows = false; saveThrows = false; }

(async () => {
  console.log('[R1-8] 店铺设置页行为守卫（回填 / 保存载荷 / 不碰 switches / 重拉）');

  const SRC = fs.readFileSync(PAGE, 'utf8');
  loadCfg();

  // =====================================================
  // A · 读回
  // =====================================================
  sec('A · load 回填');

  reset();
  ctxResp = { shop_id: 's1', shop_name: '观音桥店', shop_remark: '主店' };
  let p = fresh(cfg);
  await p.load();
  check('A-① 店名/备注从服务端回填，并同步进全局上下文',
    p.data.shopName === '观音桥店' && p.data.remark === '主店'
    && appStub.ctx && appStub.ctx.shop_name === '观音桥店',
    'name=' + p.data.shopName + ' remark=' + p.data.remark);
  check('A-② 成功后 loading 收起', p.data.loading === false);

  reset();
  ctxResp = {};
  p = fresh(cfg);
  await p.load();
  check('A-③ 字段缺失 ⇒ 空串（不渲染 undefined）',
    p.data.shopName === '' && p.data.remark === '',
    JSON.stringify([p.data.shopName, p.data.remark]));

  reset();
  ctxThrows = true;
  p = fresh(cfg);
  let aErr = null;
  try { await p.load(); } catch (e) { aErr = e; }
  check('A-④ 接口失败 ⇒ 不崩、loading 收起、有提示',
    aErr === null && p.data.loading === false && seen.toastError === 1,
    aErr ? (aErr.message || String(aErr)) : 'toastError=' + seen.toastError);

  // =====================================================
  // B · 保存（本页最关键：绝不能碰 switches）
  // =====================================================
  sec('B · 保存载荷（不传 switches 是硬约束）');

  reset();
  ctxResp = { shop_id: 's1', shop_name: '观音桥店' };
  p = fresh(cfg);
  await p.load();
  reset();
  ctxResp = { shop_id: 's1', shop_name: '解放碑店', shop_remark: '新备注' };
  p.data.shopName = '解放碑店';
  p.data.remark = '新备注';
  await p.onSave();
  const save = (seen.calls || []).filter((c) => c.name === 'saveShopSetting')[0];
  check('B-① 🔴 载荷**不含 switches**（传了就会把月度录入页刚选的核算方式静默冲掉，且提示「已保存」）',
    !!save && save.params.switches === undefined,
    save ? 'keys=' + Object.keys(save.params).join(',') : '未调用');
  check('B-② 载荷带 name + remark 且值正确',
    !!save && save.params.name === '解放碑店' && save.params.remark === '新备注',
    save ? JSON.stringify({ name: save.params.name, remark: save.params.remark }) : '未调用');
  check('B-③ 幂等键 ss_*',
    !!save && /^ss_\d+$/.test(String(save.params.client_request_id)),
    save ? save.params.client_request_id : '未调用');
  check('B-④ 🔴 保存后重拉上下文并同步全局（否则返回上一页还是旧店名，老板以为没存上）',
    (seen.calls || []).filter((c) => c.name === 'getShopContext').length === 1
    && appStub.ctx && appStub.ctx.shop_name === '解放碑店',
    'getShopContext 次数=' + (seen.calls || []).filter((c) => c.name === 'getShopContext').length);
  check('B-⑤ 成功提示走 terms（不是硬编码）',
    !!seen.toast && seen.toast.title === TERMS.settings.saved,
    seen.toast ? seen.toast.title : '(无 toast)');

  reset();
  ctxResp = { shop_name: '旧名' };
  p = fresh(cfg);
  await p.load();
  reset();
  saveThrows = true;
  p.data.shopName = '新名';
  await p.onSave();
  check('B-⑥ 保存失败 ⇒ 只报错、**不弹成功提示**（否则老板以为存上了）',
    seen.toastError === 1 && !seen.toast, 'toastError=' + seen.toastError + ' toast=' + JSON.stringify(seen.toast));

  // =====================================================
  // C · 生命周期
  // =====================================================
  sec('C · 生命周期');

  reset();
  ctxResp = { shop_name: 'x' };
  p = fresh(cfg);
  p.onShow();
  await new Promise((r) => setTimeout(r, 5));
  check('C-① onShow 每次都重拉（不读缓存）—— 在别处改完店名回来必须看到新值',
    (seen.calls || []).some((c) => c.name === 'getShopContext'),
    '调用=' + (seen.calls || []).map((c) => c.name).join(','));

  reset();
  ctxResp = {};
  p = fresh(cfg);
  p.onPullDownRefresh();
  await new Promise((r) => setTimeout(r, 10));
  check('C-② 下拉刷新真停转圈', seen.stopped === true);

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

  await mut('M-1 顺带把 switches 传上去', "        remark: this.data.remark,", "        remark: this.data.remark,\n        switches: (getApp().globalData || {}).switches || {},",
    'B-① 不碰 switches', async (mc) => {
      reset(); ctxResp = { shop_name: 'A' };
      const mp = fresh(mc); await mp.load(); reset();
      mp.data.shopName = 'B'; await mp.onSave();
      const s = (seen.calls || []).filter((c) => c.name === 'saveShopSetting')[0];
      return { degraded: !!s && s.params.switches !== undefined, detail: s ? 'keys=' + Object.keys(s.params).join(',') : '未调用' };
    });

  await mut('M-2 保存后不重拉上下文', "      const ctx = await api.call('getShopContext', {});\n      app.setShopContext(ctx);\n      wx.showToast({ title: TERMS.settings.saved, icon: 'success' });",
    "      wx.showToast({ title: TERMS.settings.saved, icon: 'success' });",
    'B-④ 保存后重拉', async (mc) => {
      reset(); ctxResp = { shop_name: 'A' };
      const mp = fresh(mc); await mp.load(); reset();
      mp.data.shopName = 'B'; await mp.onSave();
      return { degraded: (seen.calls || []).filter((c) => c.name === 'getShopContext').length === 0, detail: 'getShopContext 次数=' + (seen.calls || []).filter((c) => c.name === 'getShopContext').length };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
