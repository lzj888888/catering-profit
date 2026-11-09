// tools/check_save_feedback.js —— 保存过程反馈守卫（R651）
//
// 李老师原话：「点完保存，整个页面感觉也没有刷新那么一些感觉，瞬间就是零变化，
//   然后就突然这个点完保存这个页面就空了，人填东西时候就没一个反应过程。」
//
// 根因：`saving` 状态在 js 里一直有（setData 了），但 **wxml 完全没用它**
//   ⇒ 点了按钮毫无变化，等云端返回后页面突然清空。
//
// 本守卫盯两件事：
//   ① 保存中必须有可见反馈（按钮转圈 + 禁用，顺带防连击生成两个版本）
//   ② **保存失败必须复位** —— 否则按钮永远禁用，等于把老板锁在页面上

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const WXML = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.wxml'), 'utf8');
const EDIT = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.card;

console.log('\n===== F 保存中要有反应 =====');
ok('F-① 🔴 保存按钮真的绑了 loading（改前 saving 在 js 里有、wxml 没用 ⇒ 点了毫无变化）',
  /loading="\{\{saving\}\}"/.test(WXML));
ok('F-② 保存中禁用按钮（顺手防连击：连点会生成两个版本）',
  /disabled="\{\{saving\}\}"/.test(WXML));
ok('F-③ 保存中换了文案（不能一直写"保存"，老板不知道在等什么）',
  /saving \? t\.savingNow : t\.saveShort/.test(WXML) && !!T.savingNow, 'savingNow=' + T.savingNow);

console.log('\n===== F 保存失败必须复位（否则锁死页面）=====');
ok('F-④ 🔴 成功路径复位 saving', /saving: false/.test(EDIT));
ok('F-⑤ 🔴 失败路径（catch）也复位 —— 否则按钮永远禁用，老板被锁在页面上出不去',
  /catch \(e\) \{[\s\S]{0,300}saving: false/.test(EDIT));
ok('F-⑥ 重名确认被取消时也复位（这条最隐蔽：不点确认就永远转圈）',
  /confirmDupName[\s\S]{0,120}saving: false/.test(EDIT));

console.log('\n===== F 保存成功后要有回执（不是只剩一句"已保存"）=====');
ok('F-⑦ 成功后出现常驻保存条（savedName 驱动）', /savedName/.test(WXML) && /class="saved-bar"/.test(WXML));
ok('F-⑧ 保存条里带金额化（每卖一份亏/赚多少）', /moneyTip/.test(WXML));
ok('F-⑨ 保存条里带额度提示（还能建几张）', /quotaTip/.test(WXML));

console.log('\n===== F 真跑：状态机不会卡住 =====');
function loadPage() {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  global.wx = {
    getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
    showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
    // 弹窗必须回调，否则 await 会永远挂住（这不是产品 bug —— 实际 wx.showModal 保证回调；
    // 是测试桩偷懒。第一版就因为它把 F-⑩ 判成红，白查了一轮 confirmDupName）
    showModal: (o) => { if (o && o.success) o.success({ confirm: true, cancel: false }); },
    navigateTo: () => {}, navigateBack: () => {}, redirectTo: () => {}, switchTab: () => {},
    vibrateShort: () => {}, getSystemInfoSync: () => ({ windowWidth: 375 }),
    setNavigationBarTitle: () => {}, pageScrollTo: () => {},
    cloud: { callFunction: async () => ({ result: { code: 'SYSTEM_ERROR', msg: 'boom' } }) },
  };
  delete require.cache[require.resolve(path.join(ROOT, 'subpkg/biz/card/edit.js'))];
  require(path.join(ROOT, 'subpkg/biz/card/edit.js'));
  return cfg;
}
function mkPage() {
  const cfg = loadPage();
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  return p;
}

(async () => {
  // ⚠️ 只用一个实例：第一版开了两个页面实例并行 await，后者 mkPage() 会重置 global.wx
  //   ⇒ 前一个实例的回调打到新桩上，永远等不到 ⇒ F-⑩ 假红（查了一轮才发现是测试串扰）。
  const p2 = mkPage();
  p2.data.name = '测试菜2';
  p2.data.lines = [{ rid: 'y', input_type: 2, material_id: '', material_name: '料', qty: '100', qty_unit: '克', price_unit: '克', unit_price_yuan: '1', yield_rate: '100', line_kind: 'main' }];
  p2.data.priceYuan = '10';
  // ⚠️ 直接测 doSave：`onSave()` 里的 `this.doSave()` 是**不 await 的**，
  //   await onSave() 返回时 doSave 可能还没跑完 ⇒ 断言太早会假红（第二处测试陷阱）。
  // ⚠️ 千万别预设 saving:true —— doSave 开头有「连击保护 if (saving) return」，
  //   预设了等于自己把它挡在门外，saving 永远不复位（第三处测试陷阱，白查两轮）。
  try { await p2.doSave(); } catch (e) { /* 预期失败 */ }
  ok('F-⑩ 🔴 云端报错后 saving 必须回到 false（真跑一遍，不信"代码里有这句"）',
    p2.data.saving === false, 'saving=' + JSON.stringify(p2.data.saving));
  ok('F-⑪ 失败后页面内容**不丢**（名字还在，老板不用重填）',
    p2.data.name === '测试菜2', 'name=' + JSON.stringify(p2.data.name));

  console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(failN === 0 ? 0 : 1);
})();
