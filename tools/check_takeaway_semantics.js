// tools/check_takeaway_semantics.js —— R715 · 外卖页「词不达意 / 填不了 / 改不回」守卫
//
// 李老师（2026-11-12）：「各个语义这个解释，你看看词不达意的地方有没有…有没有让大家
// 觉得很模糊、不知怎么填数字、数字不知怎么往里入…包括入错了数字怎么办，表格导错了
// 这个时候我们怎么纠正」。
//
// 审下来三条真问题，全在 subpkg/biz/takeaway/index 这一页：
//
// ① **同一样东西两个名字、方向相反**：`包材`（成本）vs `打包费`（收入）、
//    `配送服务费`（商家付）vs `配送费·顾客承担`（顾客付）。
//    老板语言里"包材"和"打包费"就是同一个餐盒 ⇒ 两处都填一次，利润被算成两倍，
//    而且两个数单看都"对"，没有任何一处报错。
// ② **「顾客支付」用成本卡售价算，页面从没说过**。外卖普遍加价、还有满减，
//    实收几乎总不等于这个数。老板会以为系统算错，或照它定价。
//    （对照：团购页有「团购价（顾客实付）」输入框 + `如 88` 例子占位，做对了。）
// ③ **同一份销量数据两个导入入口，清除入口只在一个页面**：`clearSalesBills` 的
//    UI 在 `pages/m3/dishreview`，而本页 import tab 也能导 —— 从本页导错的人
//    找不到任何回头路，本页也不说数据清在哪。
//
// ⚠️ 判据为什么是"语义"而不是"字面比对"：
//    字面比对（`assert txt === '打包费·顾客付（元）'`）会把合法改写也判红，
//    久而久之没人敢动文案，守卫就退化成橡皮章。这里判的是**方向词是否存在**
//    （成本侧必须自述"成本/你买"，收入侧必须自述"顾客"），
//    换一种说法只要还说清了方向就仍然通过。
//
// 运行：node tools/check_takeaway_semantics.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
const TK = TERMS.ledger.takeaway;

const PAGE_JS = path.join(ROOT, 'subpkg/biz/takeaway/index.js');
const PAGE_WXML = path.join(ROOT, 'subpkg/biz/takeaway/index.wxml');
const HINT_TOOL = path.join(ROOT, 'tools/check_hint_fold.js');
const SRC = fs.readFileSync(PAGE_JS, 'utf8');
const W = fs.readFileSync(PAGE_WXML, 'utf8');
const HINT_SRC = fs.readFileSync(HINT_TOOL, 'utf8');
const WXSS_SRC = fs.readFileSync(path.join(ROOT, 'subpkg/biz/takeaway/index.wxss'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// 剥掉注释再判 —— 注释里写着"打包费·顾客付"不算数（本仓 R708 踩过：
// 判据把注释里的 `lean: true` 数了进去，看着全绿实际代码没改）。
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

// 方向词表：不写死整句，只要求"说得清方向"
const COST_WORDS = ['成本', '你买', '你花', '支出'];
const REVENUE_WORDS = ['顾客付', '顾客承担', '顾客另付'];

function hasAny(txt, words) {
  const s = String(txt || '');
  return words.some((w) => s.indexOf(w) >= 0);
}

console.log('\n== A · 同物异名、方向相反的两组 ==');
console.log('   （判据：成本侧必须自述"成本/你买"，收入侧必须自述"顾客付"）');

ok('A-① `packTitle`（成本）自述了成本方向',
  hasAny(TK.packTitle, COST_WORDS), TK.packTitle);
ok('A-② `packFee`（收入）自述了顾客付',
  hasAny(TK.packFee, REVENUE_WORDS), TK.packFee);
ok('A-③ `deliveryFee`（商家付）自述了商家方向',
  hasAny(TK.deliveryFee, ['商家付', '你付']), TK.deliveryFee);
ok('A-④ `deliveryCustomer`（顾客付）自述了顾客方向',
  hasAny(TK.deliveryCustomer, REVENUE_WORDS), TK.deliveryCustomer);

// 这两个词是老板最容易混的一对：去掉方向词之后必须仍然可区分
ok('A-⑤ `包材` 与 `打包费` 去掉括注后不是同一个词（否则等于没改）',
  TK.packTitle.replace(/[（(].*?[）)]/g, '') !== TK.packFee.replace(/[（(].*?[）)]/g, ''),
  TK.packTitle + ' / ' + TK.packFee);

// 跨区指路：包材区与打包费隔了几屏，成本侧必须指向收入侧
ok('A-⑥ `packNote` 明确把「打包费」指到「平台参数」区（跨区，必须指路）',
  !!TK.packNote && TK.packNote.indexOf('打包费') >= 0 && TK.packNote.indexOf('平台参数') >= 0,
  TK.packNote);
ok('A-⑦ `packNote` 真的渲染到页面上（不是只写在 terms 里）',
  W.indexOf('{{t.packNote}}') >= 0);

console.log('\n== B · 「顾客支付」的售价来源 ==');

ok('B-① `dishPriceNote` 存在且非空', !!TK.dishPriceNote, (TK.dishPriceNote || '').slice(0, 30) + '…');
ok('B-② 说清了是「成本卡售价」算的（不是实收）',
  !!TK.dishPriceNote && TK.dishPriceNote.indexOf('成本卡') >= 0,
  TK.dishPriceNote);
ok('B-③ 说清了外卖加价/满减会让它对不上',
  !!TK.dishPriceNote && (TK.dishPriceNote.indexOf('加价') >= 0 || TK.dishPriceNote.indexOf('满减') >= 0));
ok('B-④ 渲染在「本单菜品」标题之后、份数输入之前（老板填份数前就看到）', (function () {
  const sec = W.indexOf('{{t.dishTitle}}');
  const note = W.indexOf('{{t.dishPriceNote}}');
  const firstInput = W.indexOf('bindinput="onItemQty"');
  return sec >= 0 && note > sec && firstInput > note;
})());

console.log('\n== C · 例子占位（不知填 15 还是 0.15）==');
['commissionRatePh', 'commissionMinPh', 'packFeePh', 'deliveryCustomerPh'].forEach((k, i) => {
  ok('C-' + '①②③④'[i] + ' `' + k + '` 有值且已挂到 input',
    !!TK[k] && W.indexOf('{{t.' + k + '}}') >= 0, TK[k]);
});

console.log('\n== D · 导错了怎么改（清除入口在别的页面，必须指路）==');

ok('D-① `importClearFixTitle` / `Body` 存在', !!TK.importClearFixTitle && !!TK.importClearFixBody,
  TK.importClearFixTitle);
ok('D-② 正文点名了清除在哪个页面（否则等于让他自己找）',
  !!TK.importClearFixBody && TK.importClearFixBody.indexOf('排行榜') >= 0);
ok('D-③ 正文说清了「可以撤销、删掉重导」',
  !!TK.importClearFixBody && (TK.importClearFixBody.indexOf('撤销') >= 0 || TK.importClearFixBody.indexOf('删') >= 0));
ok('D-④ 有可点的跳转按钮，且方法真的存在',
  W.indexOf('bindtap="goDishReview"') >= 0 && /goDishReview\s*\(\s*\)\s*\{/.test(SRC),
  'bindtap + 方法体');
ok('D-⑤ 跳转目标就是清除入口所在的页',
  /goDishReview\s*\(\s*\)\s*\{\s*wx\.navigateTo\(\{\s*url:\s*'\/pages\/m3\/dishreview\/index'/.test(SRC.replace(/\s+/g, ' ')) ||
  (SRC.indexOf('goDishReview()') >= 0 && SRC.indexOf('/pages/m3/dishreview/index') >= 0));
ok('D-⑥ 折叠块 key `tkFixHint` 已登记进 check_hint_fold 的 takeaway.keys（否则 F2 判红）',
  /name:\s*'takeaway'[\s\S]{0,400}?keys:\s*\[[^\]]*'tkFixHint'/.test(HINT_SRC));
ok('D-⑦ wxml 里确实用了 tkFixHint 且 data-key 无重复',
  (W.match(/data-key="tkFixHint"/g) || []).length === 1);

console.log('\n== E · 页面 t:{} 登记齐全（漏登记 = 真机静默空白，本仓红线）==');
['packNote', 'dishPriceNote', 'commissionRatePh', 'commissionMinPh', 'commissionFixedPh',
  'packFeePh', 'deliveryCustomerPh', 'importClearFixTitle', 'importClearFixBody', 'goClearBills']
  .forEach((k) => {
    ok('E · t.' + k + ' 在页面 t:{} 里登记且取到非空串',
      new RegExp('\\b' + k + ':\\s*TK\\.' + k).test(SRC) && typeof TK[k] === 'string' && TK[k].length > 0);
  });

console.log('\n== X · 反恒真（证明上面这些判据抓得住回退）==');

// X-① 把收入侧改回旧的「打包费（元）」，A-② 必须判红
const oldPackFee = '打包费（元）';
ok('X-① 若 `packFee` 退回旧文案「打包费（元）」⇒ A-② 会判红（无顾客方向词）',
  !hasAny(oldPackFee, REVENUE_WORDS), oldPackFee);

// X-② 把成本侧改回旧的「包材」，A-① 必须判红
ok('X-② 若 `packTitle` 退回旧文案「包材」⇒ A-① 会判红（无成本方向词）',
  !hasAny('包材', COST_WORDS), '包材');

// X-③ 同一句但只在注释里出现 ⇒ 剥注释后应判空（防止靠注释骗过）
const fakeSrc = '// packFee: \'打包费·顾客付（元）\'\nconst x = 1;';
ok('X-③ 只在注释里写方向词不会被判绿（剥注释后取不到）',
  stripComments(fakeSrc).indexOf('顾客付') < 0);

// X-④ 若删掉 wxml 里的渲染，A-⑦ / B-④ 必须判红
ok('X-④ 删掉 wxml 的 `{{t.packNote}}` ⇒ A-⑦ 会判红',
  W.replace('{{t.packNote}}', '').indexOf('{{t.packNote}}') < 0);

// ===== R724j（台账 R2-6）：口径说明块**视觉重量**守卫 =====
// 背景：首屏有 4 个 `.base-note`（佣金基数 / 顾客支付口径 / 包材说明 / 实收说明）。
//   原来每个都是「浅黄底 + 整块 padding + 圆角」⇒ 连成一片色块墙，老板扫一眼就整段跳过
//   （李老师真机反馈同型问题：「一眼看上去全是字，就不看了」）。
//   改法是**只降视觉重量、不动一个字、不动位置**：去底色、去圆角，留左侧竖线当「这是说明」的标记。
//   ⚠️ 为什么用样式而不是删文案：`dishPriceNote` 必须留在填份数**之前**（B-④ 位置断言，
//      那是 R715 花一轮定下来的），合并/下移都会破坏语义；真正压人的是色块密度。
//   ⚠️ 为什么守它：样式最容易被「后来者觉得不好看」改回色块，而改回去**不会有任何报错**，
//      只会让老板重新整段跳过 —— 属典型「静默回退」。
const mBaseNote = /\.base-note\s*\{([^}]*)\}/.exec(WXSS_SRC);
const baseNoteRule = mBaseNote ? mBaseNote[1] : '';
ok('S-① `.base-note` 规则可解析（解析不出 = 判据失效，宁红不猜）', !!mBaseNote,
  mBaseNote ? baseNoteRule.replace(/\s+/g, ' ').slice(0, 60) + '…' : '未找到');
const mBg = /background\s*:\s*([^;]+)/.exec(baseNoteRule);
const bgVal = mBg ? mBg[1].trim() : '';
// ⚠️ 不用 `(?!transparent)` 前瞻：`\s*` 会回溯到空格前，前瞻就落在空格上 ⇒ 误判
//    （我第一版就是这么写的，`background: transparent` 被判成色块）。
const opaqueBg = !!bgVal && bgVal !== 'transparent' && bgVal !== 'none' && bgVal !== 'initial';
ok('S-② 🔴 不得回退成不透明色块（4 个连成一片正是老板整段跳过的原因）',
  !!baseNoteRule && !opaqueBg, bgVal || '(无 background)');
ok('S-③ 必须保留「这是说明」的视觉标记（左侧竖线），纯裸文字会和正文混在一起',
  /border-left\s*:\s*\d+rpx\s+solid/.test(baseNoteRule),
  (baseNoteRule.match(/border-left\s*:\s*[^;]+/) || ['(无 border-left)'])[0]);
const mFs = /font-size\s*:\s*(\d+)rpx/.exec(baseNoteRule);
ok('S-④ 字号 ≥28rpx（AD 红线下限，说明文字也不能变小来省地方）',
  !!mFs && Number(mFs[1]) >= 28, mFs ? mFs[1] + 'rpx' : '未声明');

console.log('\n============================================================');
const total = pass + fail;
// ⚠️ 末行必须是 `N 通过 / M 失败` 形态：verify_all 的 R69 只认**最后 1 个非空非分隔行**
//    里的 `数字 通过`。补一句「✅ 全部 N 条通过」会把汇总行挤出窗口 ⇒ 判「未走完收尾」。
if (fail > 0) {
  console.log('===== 外卖页语义守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  console.log('❌ 有 ' + fail + ' 条判据未通过');
  process.exit(1);
}
console.log('===== 外卖页语义守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(0);
