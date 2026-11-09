// tools/check_money_hint.js —— 金额化守卫（R644 · 会审 R637）
//
// 会审原话：「把『毛利率 18%』变成『这道菜每卖一份亏 1.2 元 / 本月少赚约 1,080 元』。
//   需要老板填一个数：这菜一天大概卖几份。**没有销量就只给单份金额，绝不编总数。**」
//
// 本守卫盯两件事：
//   ① 单份金额算得对、该说的时候说、不该说的时候闭嘴（不打扰也是产品力）
//   ② **没销量时绝不产出总额** —— 拿行业均值替老板编数是最恶劣的做法

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const { moneyHint, moneyTotal } = require(path.join(ROOT, 'utils/moneyHint.js'));

console.log('\n===== M 金额化·单份 =====');
// M-① 亏损：会审点名的那句
const loss = moneyHint(3000, 1800);
ok('M-① 亏损 ⇒ 「每卖一份亏 12.00 元」', loss.kind === 'loss' && loss.text === '每卖一份亏 12.00 元', loss.text);

// M-② 保本
const even = moneyHint(2000, 2000);
ok('M-② 保本 ⇒ 明说「一分不赚」（不说「毛利率 0%」这种会计话）',
  even.kind === 'loss' && even.text.indexOf('保本') >= 0, even.text);

// M-③ 薄利：只在**老板自己设过目标**且实际低于目标时才提醒
const thin = moneyHint(3000, 3800, 60);
ok('M-③ 低于老板自设目标毛利率 ⇒ 给单份金额 + 点明低于目标',
  thin.kind === 'thin' && thin.text.indexOf('8.00') >= 0 && thin.text.indexOf('60') >= 0, thin.text);

// M-④ 健康：不打扰
const fine = moneyHint(3000, 9000, 60);
ok('M-④ 达标 ⇒ 一句都不说（不打扰）', fine.kind === '' && fine.text === '');

// M-⑤ 没设目标 ⇒ 不替他判定"多少算低"
const noT = moneyHint(3000, 3800);
ok('M-⑤ 老板没设目标毛利率 ⇒ 不擅自判定「偏低」', noT.kind === '', 'kind=' + noT.kind);

// M-⑥ 数据不全 ⇒ 不编话
ok('M-⑥ 缺成本或售价 ⇒ 一个字都不说（绝不拿半个数编）',
  moneyHint(0, 3800).text === '' && moneyHint(3000, 0).text === '');

console.log('\n===== M 金额化·总额（会审硬约束）=====');
ok('M-⑦ 🔴 没填销量 ⇒ moneyTotal 返回 null（绝不推算月总额）', moneyTotal(-1200, 0) === null);
ok('M-⑦b 🔴 销量非法/负数 ⇒ 同样 null', moneyTotal(-1200, -5) === null && moneyTotal(-1200, '') === null);
const tot = moneyTotal(-1200, 50);
ok('M-⑦c 填了销量 ⇒ 日/月都按**老板填的数**算', !!tot && tot.day.indexOf('600.00') >= 0 && tot.month.indexOf('18000.00') >= 0,
  tot ? tot.day + ' / ' + tot.month : 'null');

console.log('\n===== M 接入（页面真的显示）=====');
function loadPage() {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  global.wx = {
    getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
    showToast: () => {}, showModal: () => {}, showLoading: () => {}, hideLoading: () => {},
    navigateTo: () => {}, navigateBack: () => {}, redirectTo: () => {}, switchTab: () => {},
    vibrateShort: () => {}, getSystemInfoSync: () => ({ windowWidth: 375 }),
    setNavigationBarTitle: () => {}, pageScrollTo: () => {},
    cloud: { callFunction: async () => ({ result: { code: 'SUCCESS', data: {} } }) },
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

const p1 = mkPage();
p1.afterSaved('亏本菜', null, '每卖一份亏 12.00 元');
ok('M-⑧ 真跑 afterSaved ⇒ 保存条拿到金额文案', p1.data.moneyTip === '每卖一份亏 12.00 元', p1.data.moneyTip);

const p2 = mkPage();
p2.afterSaved('正常菜', null, '');
ok('M-⑨ 没有金额可报时不显示（不塞空话）', p2.data.moneyTip === '');

const WXML = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.wxml'), 'utf8');
ok('M-⑩ wxml 真的渲染 moneyTip（写了不接＝白写）',
  /class="money-tip"[^>]*wx:if="\{\{moneyTip\}\}"[^>]*>\{\{moneyTip\}\}/.test(WXML));

const EDIT = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
ok('M-⑪ 金额化走单源 utils/moneyHint.js（页面不许自己拼「亏 X 元」）',
  /require\('\.\.\/\.\.\/\.\.\/utils\/moneyHint\.js'\)/.test(EDIT) && /moneyHint\(cFen, cFen \+ gFen/.test(EDIT));
ok('M-⑫ 🔴 用的是**单份**成本口径（total_cost_fen 实为单份），不是整卡总额',
  /const cFen = Number\(oc\.total_cost_fen\)/.test(EDIT));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
