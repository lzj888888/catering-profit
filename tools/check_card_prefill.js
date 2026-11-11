// tools/check_card_prefill.js —— R692（易填性）建卡预填守卫
//
// 判据对象：`pages/m3/dishreview/index.js::goNewCard` 拼出来的跳转 URL
//
// 为什么必须有：这段代码在**拼一个 URL**，而 URL 拼错的后果全都是**静默的**：
//   ① 菜名不编码 ⇒ 带括号/加号/空格的菜名被截断或 `+` 变空格 ⇒ 到了建卡页名字是错的，
//      建出来的卡挂不上任何销量（白建一张，且用户以为建好了）；
//   ② 售价算错（除反了 / 没除 / qty=0 时除）⇒ 预填一个离谱的价，用户不改就直接算错毛利；
//   ③ 没数据时硬塞一个 0 元售价 ⇒ 用户以为系统知道价格，实际是编的（比不填坏）。
//   三种都不会报错，只有断言能拦。
const path = require('path');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// ===== stub 页面，捕获 navigateTo 的 url =====
let captured = null;
let lastUrl = '';
global.Page = (c) => { captured = c; };
global.getApp = () => ({ globalData: {} });
global.wx = {
  getStorageSync: () => '', setStorageSync() {},
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showModal() {}, showToast() {},
  navigateTo: (o) => { lastUrl = (o && o.url) || ''; },
};

require(path.join(__dirname, '../pages/m3/dishreview/index.js'));
if (!captured || typeof captured.goNewCard !== 'function') {
  console.log('❌ 取不到 goNewCard');
  process.exit(1);
}

// 造一个点击事件：dataset 来自 wxml 的 data-name / data-amt / data-qty
const tap = (name, amtFen, qty) => {
  lastUrl = '';
  captured.goNewCard({ currentTarget: { dataset: { name, amt: amtFen, qty } } });
  return lastUrl;
};

console.log('===== A · 均价预填 =====');
// 43 份卖了 1234.00 元 ⇒ 均价 28.6977… ⇒ 28.70
const u1 = tap('红烧肉', 123400, 43);
check('A-① 算出均价 28.70 并带进 URL', /[?&]price=28\.70(&|$)/.test(u1), u1);
check('A-② 菜名也在 URL 里（encodeURIComponent 后）', u1.indexOf('dish_name=') > 0);
check('A-③ 空 card_code（新建而非编辑）', /card_code=(&|$)/.test(u1), u1);

// 100 份 3000 元 ⇒ 30.00
check('A-④ 整除时也给两位小数（30.00 不是 30）',
  /[?&]price=30\.00(&|$)/.test(tap('A', 300000, 100)));

console.log('\n===== B · 不能算的时候不许编 =====');
check('B-① qty=0 ⇒ 不带 price（除零）',
  tap('零销量', 123400, 0).indexOf('price=') < 0, tap('零销量', 123400, 0));
check('B-② 金额缺失 ⇒ 不带 price',
  tap('缺金额', 0, 43).indexOf('price=') < 0);
check('B-③ 金额 undefined ⇒ 不带 price',
  tap('缺字段', undefined, 43).indexOf('price=') < 0);
check('B-④ 均价不足 0.01 元（数据脏）⇒ 不带 price（不去编一个 0.00）',
  tap('脏数据', 10, 5000).indexOf('price=') < 0, tap('脏数据', 10, 5000));

console.log('\n===== C · 菜名编码 =====');
const u2 = tap('肥牛(大)', 100000, 50);
// ⚠️ 首版这里断言「括号必须被编码」，跑出来是红的 —— 但**代码是对的、断言是错的**：
//    encodeURIComponent 按标准**不编码** ()  （它们属 unreserved marks），而 () 在 URL 里
//    完全合法、不会截断。真正会截断的是 & # ? 空格。所以正确的判据是「price 参数不被菜名吃掉」。
check('C-① 菜名含括号时其他参数不受影响（括号本身合法，不编码也没事）',
  /[?&]price=20\.00(&|$)/.test(u2), u2.slice(0, 100));
const uAmp = tap('A&B 双拼', 100000, 50);
check('C-①b 菜名含 & 时 price 参数仍能解析出来（& 必须被编码，否则参数被截断）',
  /[?&]price=20\.00(&|$)/.test(uAmp) && uAmp.indexOf('%26') > 0, uAmp.slice(0, 110));
check('C-② 解码后与原名一致',
  decodeURIComponent((u2.match(/dish_name=([^&]*)/) || [])[1] || '') === '肥牛(大)');
const u3 = tap('A+B 套餐', 100000, 50);
check('C-③ 加号不会变成空格（encodeURIComponent 会转成 %2B）',
  decodeURIComponent((u3.match(/dish_name=([^&]*)/) || [])[1] || '') === 'A+B 套餐',
  decodeURIComponent((u3.match(/dish_name=([^&]*)/) || [])[1] || ''));
check('C-④ 空格被编码成 %20（不会被解成别的）',
  tap('宫保 鸡丁', 100000, 50).indexOf('%20') > 0);

console.log('\n===== D · 变异自证 =====');
check('D-① 若漏了 /qty（直接拿金额当价）会得到 1234.00 而不是 28.70 ⇒ A-① 有分辨力',
  (123400 / 100).toFixed(2) === '1234.00' && (123400 / 100 / 43).toFixed(2) === '28.70');
check('D-② 若 qty=0 时硬算，会得到 Infinity ⇒ B-① 有分辨力',
  !Number.isFinite(123400 / 100 / 0));

console.log(`\n==== 建卡预填守卫结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
