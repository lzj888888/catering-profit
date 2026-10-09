// review/evidence/r251_dishreview/_r251_verify.js
// R251 真调验证：把**真云回包**（probe_r251.txt）喂给**页面真实的 load()**，看它算出来的东西。
//
// 🔴 为什么不能只读源码：本轮的缺陷就是「后端算好了、前端不读」——
//   只 grep 源码字面（`item.totals` 出现了吗）会被**注释里的同名词**骗过（假绿）。
//   唯一可信的判据是**真调页面函数、看 setData 之后的 data**。
//
// 做法：require hook 把页面依赖的 `utils/api.js` / `ui.js` / `paywall.js` 换成桩，
//   `global.Page` 捕获页面对象，注入 `setData`，然后真跑 `load()`。
//
// 跑法：node review/evidence/r251_dishreview/_r251_verify.js
const fs = require('fs');
const path = require('path');
const Module = require('module');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PAGE = path.join(REPO, 'pages/m3/dishreview/index.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ---- 1. 真云回包（**已脱敏**的纯 JSON；真实菜品名不入库，原文在 _probe_tmp/r251_raw/）----
const probe = JSON.parse(fs.readFileSync(path.join(__dirname, 'payload_r251.json'), 'utf8'));
const PAYLOAD = probe.review_raw.data;
console.log('真云回包：dine_in=%d · by_platform=%s · totals=%s',
  (PAYLOAD.dine_in || []).length, Object.keys(PAYLOAD.takeaway.by_platform).join(','),
  JSON.stringify(PAYLOAD.totals));

// ---- 2. require hook：桩掉页面依赖 ----
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (/utils[\\/]api\.js$/.test(request)) {
    return {
      ensureShop: async () => true,
      call: async () => PAYLOAD,          // ← 把真云回包原样喂进去
      toastError: () => {},
    };
  }
  if (/utils[\\/]ui\.js$/.test(request)) return { setTitle: () => {}, nowMonth: () => '2026-10' };
  if (/utils[\\/]paywall\.js$/.test(request)) return { openPaywall: () => {} };
  return origLoad.apply(this, arguments);
};

let pageObj = null;
global.Page = (o) => { pageObj = o; };
global.getApp = () => ({ globalData: { shop_id: 'shop_mu6j87v1itrs' } });
global.wx = { navigateTo: () => {} };

require(PAGE);
Module._load = origLoad;

// ---- 3. 页面实例（注入 setData）----
const inst = Object.assign({}, pageObj);
inst.data = JSON.parse(JSON.stringify(pageObj.data));
inst.setData = function (o) { Object.assign(this.data, o); };

(async () => {
  console.log('\n===== A. 真跑 load() =====');
  await inst.load();
  const D = inst.data;
  check('A-① load() 后 loading=false', D.loading === false);

  console.log('\n===== B. 外卖平台块（R251 修复点）=====');
  check('B-① takeaway 非空且含两个平台块', Array.isArray(D.takeaway) && D.takeaway.length === 2,
    D.takeaway ? D.takeaway.map((b) => b.platform).join(',') : 'null');
  const taobao = (D.takeaway || []).find((b) => b.platform === 'taobao');
  const jd = (D.takeaway || []).find((b) => b.platform === 'jd_order');
  check('B-② 淘宝块：unmatchedCount=51（后端口径带出来了）', taobao && taobao.unmatchedCount === 51,
    taobao && String(taobao.unmatchedCount));
  check('B-③ 淘宝块：totals 真的被带出（qty=118 / ¥1823.08）',
    taobao && taobao.totals && taobao.totals.qty === 118 && taobao.totals.revenueText === '1823.08',
    taobao && JSON.stringify(taobao.totals));
  check('B-④ 🔴 淘宝空榜成因 = 「全未匹配」（不是账单级）',
    taobao && taobao.emptyReason === inst.data.t.reviewPlatformAllUnmatched
    || (taobao && /未匹配到成本卡/.test(taobao.emptyReason)) ,
    taobao && taobao.emptyReason);
  check('B-⑤ 🔴 京东块：成因 = 「只有账单合计、无菜品明细」（修复前这里是空字符串 ⇒ 光标题）',
    jd && /账单合计/.test(jd.emptyReason), jd && JSON.stringify(jd.emptyReason));
  check('B-⑥ 京东块：unmatchedCount=0 且 ranked 空（与成因自洽）',
    jd && jd.unmatchedCount === 0 && jd.ranked.length === 0);
  check('B-⑦ 自失效护栏：两块的成因**互不相同**（否则说明判据退化成常量）',
    taobao && jd && taobao.emptyReason !== jd.emptyReason);

  console.log('\n===== C. 未匹配菜品（平台标签 + 口味询问标记）=====');
  check('C-① 未匹配 51 条（与真云一致）', D.unmatched.length === 51, String(D.unmatched.length));
  const first = D.unmatched[0];
  check('C-② 首行带来源平台标签 = 淘宝闪购', first && /淘宝闪购/.test(first.platformText || ''),
    first && first.platformText);
  // ⚠️ 用**份数**定位而不是菜名 —— probe_r251.txt 已**脱敏**（菜品名 → 菜品NN），
  // 真名留在 `_probe_tmp/r251_raw/`（仓外忽略目录，不进 git）。判据本身不依赖真名。
  const spicy = D.unmatched.find((x) => x.qty === 43);
  check('C-③ 43 份 / 0 元那条被标为口味询问类（v1.7 C-5）',
    spicy && spicy.zeroAmount === true && spicy.amountText === '0.00', spicy && JSON.stringify(spicy));
  check('C-④ 非 0 元行**不得**被误标（取 qty=2 的常规行）',
    (D.unmatched.find((x) => x.qty === 2) || {}).zeroAmount === false);
  check('C-⑤ 自失效护栏：51 条里被标 zeroAmount 的恰为 1 条（43 份那条）',
    D.unmatched.filter((x) => x.zeroAmount).length === 1,
    '标了 ' + D.unmatched.filter((x) => x.zeroAmount).length + ' 条');

  console.log('\n===== D. 回归：既有的堂食/合计口径没被动到 =====');
  // ⚠️ 我第一版把这里写成「totals 应为 null」——**是我判据错**：`d.totals` 是**对象**
  //   （`{qty:0,…}` 恒真）⇒ `fmtTotals` 照常返回对象 ⇒ 截图里那张「总份数 0」卡就是这么来的。
  //   按本仓纪律「守卫红先怀疑自己」订正为「对象在场且 qty=0」。
  check('D-① 堂食合计卡仍在场（对象，qty=0 —— 与真机截图一致）',
    D.totals && typeof D.totals === 'object' && D.totals.qty === 0, JSON.stringify(D.totals));
  check('D-①b 堂食合计卡字段齐全（营收/成本/毛利三行都要有）',
    D.totals && D.totals.revenueText === '0.00' && D.totals.costText === '0.00' && D.totals.grossText === '0.00');
  check('D-② dineIn 仍为空数组', Array.isArray(D.dineIn) && D.dineIn.length === 0);
  check('D-③ empty 判据仍为 false（有外卖块 ⇒ 非空态）', D.empty === false);

  // 人话预览
  console.log('\n===== 页面将渲染出（人话预览）=====');
  (D.takeaway || []).forEach((b) => {
    console.log('  【外卖 · %s】', b.platformName);
    if (b.emptyReason) console.log('     说明：%s', b.emptyReason);
    console.log('     份数 %s · 营收 ¥%s%s', b.totals.qty, b.totals.revenueText,
      b.unmatchedCount ? ' · 未匹配 ' + b.unmatchedCount + ' 项' : '');
  });
  console.log('  【未匹配菜品】%d 条，例：', D.unmatched.length);
  D.unmatched.slice(0, 3).forEach((x) => console.log('     %s（%s）%s 份 ¥%s',
    x.name, x.platformText, x.qty, x.amountText));

  console.log('\n===== R251 页面行为验证结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
