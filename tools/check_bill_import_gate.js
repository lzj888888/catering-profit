// tools/check_bill_import_gate.js —— 【R259】「外卖账单导入暂停展示」开关守卫
// 运行：node tools/check_bill_import_gate.js
//
// ===== 为什么需要它（失效方式是**静默**的，而且方向有两个）=====
// 李老师 2026-10-10 决定账单导入暂停展示（详见 `review/NOTE_2026-10-10_外卖账单导入_暂停展示衔接备忘.md`）。
// 这件事有一个**极易踩反**的点，本守卫的存在理由就是它：
//
//   🔴 `pages/takeaway` 那个 tab 是**一个统一导入器**，云函数按表头**自动判形态**：
//       · 形态 A `dish_sales`   = 堂食《菜品销售统计》（美团收银）  ⇒ **要保留**
//       · 形态 B `combo_detail` = 套餐销售明细（仅交叉校验、不入库）
//       · 形态 C `waimai_goods` = **外卖《商品销量》**（SKU 长表）    ⇒ **要保留**（外卖单品复盘的输入）
//       · 账单（无 shape）      = 订单级 / 日汇总                    ⇒ **要暂停**
//     而且 **形态 A 的确认按钮与账单渲染在**同一张 wxml 卡片（`wx:elif` 分支）——
//     因为云函数 `handleBillImport` **不回 `shape`** ⇒ 页面里 `importShape === ''`。
//     ⇒ 若按"卡片"整块关掉，会**连带关掉堂食单品复盘与外卖单品复盘的导入**，
//       也就是把本轮要重点做的两件事一起砍了 —— 而且**页面上看不出异常**（只是按钮不见了）。
//
// 两个失效方向都必须被抓住：
//   ① **关多了**：连形态 A/C 一起关 ⇒ 复盘没输入（本守卫 A-④ / A-⑨ / B-④）
//   ② **关少了**：开关改成 true 或 wxml 条件被去掉 ⇒ 账单又能落库（B-① / B-② / A-⑤）
//
// ===== 判据（四段，形态照 gate-suite-checklist §0）=====
//   S 扫描面（fail-closed）：五份目标文件在场；**"暂停"≠"删掉"** —— 云函数/读清函数/守卫/落库写入都必须在。
//   A 源码面：开关两处取值同源 + 页面真引用 + data 真取 + **暂停条件必须与"是不是账单"绑判** +
//             云函数兜底在写库之前 + 入口文案不再承诺账单 + tab 名已改。
//   B 行为面：真 require 两个开关（布尔且 false、且相等）；再按页面同款判据**真跑**三种形态
//             （账单=false / 形态 A=true / 形态 C=true）—— 这是"只关账单"的核心行为证据。
//   C 自失效 / 反恒真：影子样本（开关改 true / 丢掉 importShape 判据）必须判红。
//
// ⚠️ 诚实边界：A 段是源码形态（改措辞会转红）；B 段是行为（判语义）。两条路线互补。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = {
  flags: path.join(ROOT, 'utils', 'featureFlags.js'),
  pageJs: path.join(ROOT, 'pages', 'takeaway', 'index.js'),
  pageWxml: path.join(ROOT, 'pages', 'takeaway', 'index.wxml'),
  fnSvc: path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js'),
  fnIdx: path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'index.js'),
  terms: path.join(ROOT, 'miniprogram', 'i18n', 'terms.js'),
};
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };

const flags = read(P.flags);
const pageJs = read(P.pageJs);
const wxml = read(P.pageWxml);
const fnSvc = read(P.fnSvc);
const fnIdx = read(P.fnIdx);
const terms = read(P.terms);

console.log('===== S 扫描面（fail-closed：文件不在场 / 源为空 ⇒ 直接判红）=====');
check('S-① 六份目标文件都在场且非空',
  flags.length > 0 && pageJs.length > 0 && wxml.length > 0 && fnSvc.length > 0
  && fnIdx.length > 0 && terms.length > 0,
  `flags=${flags.length} pageJs=${pageJs.length} wxml=${wxml.length} fnSvc=${fnSvc.length} fnIdx=${fnIdx.length} terms=${terms.length}`);
// 🔴「暂停」不等于「删掉」：入口藏起来、代码与数据必须原样留着（备忘 §1 红线）
const dirs = ['importSalesBill', 'getSalesBills', 'clearSalesBills']
  .map((d) => fs.existsSync(path.join(ROOT, 'cloudfunctions', d, 'index.js')));
check('S-② 三个"账单"云函数**都还在**（暂停展示 ≠ 撤功能；删了将来要重写）',
  dirs.every(Boolean), JSON.stringify(dirs));
check('S-③ 落库写入仍在（唯一改的是"能不能走到这一步"，不是"能不能写"）',
  /db\.collection\('external_sales_daily'\)[\s\S]{0,40}\.set\(/.test(fnIdx));
const verifyAll = read(path.join(ROOT, 'verify_all.js'));
check('S-④ 原有守卫 check_salesbills 仍在 SUITES（隐藏入口 ≠ 拆守卫）',
  /check_salesbills\.js/.test(verifyAll));

console.log('\n===== A 源码面（只关账单，不误伤形态 A/C）=====');
const reFlags = /const BILL_IMPORT_ENABLED\s*=\s*(true|false)\s*;/;
const mFlags = reFlags.exec(flags);
const mSvc = reFlags.exec(fnSvc);
check('A-① 开关在两处各有唯一定义（前端 utils / 云函数 service —— 两个独立部署单元，注释已写明为何不能真单源）',
  !!mFlags && !!mSvc && (flags.match(/const BILL_IMPORT_ENABLED\s*=/g) || []).length === 1
  && (fnSvc.match(/const BILL_IMPORT_ENABLED\s*=/g) || []).length === 1,
  `前端=${mFlags ? mFlags[1] : 'n/a'} 云函数=${mSvc ? mSvc[1] : 'n/a'}`);
check('A-② 🔴 两处取值**同源一致**（否则前端藏了、云端还收；或反过来）',
  !!mFlags && !!mSvc && mFlags[1] === mSvc[1],
  `${mFlags ? mFlags[1] : '?'} vs ${mSvc ? mSvc[1] : '?'}`);
check('A-③ 页面真 require 了单源开关（不是自己另写个常量）',
  /require\('\.\.\/\.\.\/utils\/featureFlags\.js'\)/.test(pageJs));
check('A-④ 页面 data 的 billImportOn 取自开关（不写死）',
  /billImportOn:\s*FLAGS\.BILL_IMPORT_ENABLED/.test(pageJs));
// 🔴 本守卫的核心判据：凡是用 billImportOn 做 wx:if 的地方，必须**同时**判"是不是账单"
//    少判 `importShape` ⇒ 把形态 A（堂食菜品统计）一起关掉，而页面上只是"按钮不见了"
const gateConds = (wxml.match(/wx:if="\{\{([^}"]*billImportOn[^}"]*)\}\}"/g) || [])
  .map((s) => s.replace(/^wx:if="\{\{/, '').replace(/\}\}"$/, ''));
check('A-⑤ 🔴 每一处账单开关条件都必须与「是不是账单」绑判（缺 importShape = 连堂食形态 A 一起关）',
  gateConds.length >= 2 && gateConds.every((c) => c.indexOf('importShape') >= 0),
  gateConds.length ? gateConds.join('  |  ') : '未找到任何 billImportOn 条件（开关没接上）');
check('A-⑥ 「暂停」分支只在**真账单**上出现（无 shape ⇒ 是账单）',
  /wx:if="\{\{!billImportOn && !importShape\}\}"/.test(wxml));
check('A-⑦ 形态 C（外卖商品销量）卡**不受**账单开关影响（它的 wx:if 里不得出现 billImportOn）',
  /wx:if="\{\{importPreview && importShape === shapeC\}\}"/.test(wxml)
  && !/importPreview && importShape === shapeC[^"]*billImportOn/.test(wxml));
// 🔴 云函数兜底：必须拦在"确认落库"这一条路上，且**早于首个写库**
const iFlag = fnIdx.indexOf('if (!BILL_IMPORT_ENABLED)');
const iWrite = fnIdx.indexOf("db.collection('external_sales_daily').doc(_id).set(");
check('A-⑧ 🔴 云函数有同值兜底（条件-返回形态，不是只写了个常量）',
  /if \(!BILL_IMPORT_ENABLED\) \{\s*\n\s*return fail\(ERROR_CODES\.\w+,/.test(fnIdx),
  String(/if \(!BILL_IMPORT_ENABLED\)/.test(fnIdx)));
check('A-⑨ 🔴 兜底位置**早于首个写库**（晚了就等于"先写后拒"，数据已经脏了）',
  iFlag >= 0 && iWrite > iFlag, `开关@${iFlag} < 写库@${iWrite}`);
check('A-⑩ 云函数 service 真的导出了该开关（前端/守卫才能同源比对）',
  /BILL_IMPORT_ENABLED,/.test(fnSvc) && /^\s+BILL_IMPORT_ENABLED,/m.test(fnSvc));
// 入口文案不得再承诺账单：承诺了却导不进来 = 骗用户
// ⚠️ 判据不是"文案里不能出现『账单』二字"（那会把「账单导入正在打磨，暂不开放」这类
//   **正确的否定式说明**判红 = 反向伤害二型）。要判的是：**不再【承诺】能导入账单**。
//   ⇒ ① 不得再出现旧承诺原文「外卖账单」；② 必须出现"暂不开放/打磨/暂停"这类明示
const mHint = /importPickHint:\s*'([^']*)'/.exec(terms);
check('A-⑪ 入口文案不再**承诺**账单（不得出现旧承诺「外卖账单」，且须明示暂不开放）',
  !!mHint && !/外卖账单/.test(mHint[1]) && /(暂不开放|打磨|暂停)/.test(mHint[1]),
  mHint ? mHint[1] : 'n/a');
const mTab = /importTab:\s*'([^']*)'/.exec(terms);
check('A-⑫ tab 名不再叫「账单导入」（本 tab 主要承载商品销量导入）',
  !!mTab && mTab[1].indexOf('账单') < 0, mTab ? mTab[1] : 'n/a');
const mPaused = /importBillPaused:\s*'([^']*)'/.exec(terms);
check('A-⑬ 暂停态文案存在且说明"以前的数据还在"（否则用户以为白干了）',
  !!mPaused && terms.indexOf('importBillPausedHint') >= 0, mPaused ? mPaused[1] : 'n/a');
check('A-⑭ terms 两副本 md5 一致（改单副本 ⇒ 页面静默空白，本仓已踩过）',
  (() => {
    const a = read(path.join(ROOT, 'miniprogram', 'i18n', 'terms.js'));
    const b = read(path.join(ROOT, 'specs', 'dev-specs', 'i18n', 'terms.js'));
    return a.length > 0 && a === b;
  })());

console.log('\n===== B 行为面（真 require + 真跑页面同款判据）=====');
let FE = null, FNV = '', SN = null, SNV = '', stubbed = false;
try { FE = require(path.join(ROOT, 'utils', 'featureFlags.js')); } catch (e) { FNV = String(e && e.message || e); }
// service.js require 了 `xlsx`（本机 node 环境没装）⇒ 用空桩加载，只为读它导出的**常量**。
// 手法与 tools/check_formc_parse.js:34-46 同源（本仓既有做法，不另造）。
try {
  SN = require(path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js'));
} catch (e) {
  if (!/xlsx/.test(String((e && e.message) || ''))) { SNV = String(e && e.message || e); }
  else {
    const Module = require('module');
    const orig = Module._load;
    Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
    try { SN = require(path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js')); stubbed = true; }
    catch (e2) { SNV = String(e2 && e2.message || e2); }
    finally { Module._load = orig; }
  }
}
check('B-① 前端开关可加载且是布尔 false（暂停态）',
  !!FE && FE.BILL_IMPORT_ENABLED === false, FNV || String(FE && FE.BILL_IMPORT_ENABLED));
check('B-② 云函数开关可加载且是布尔 false（同值兜底生效）',
  !!SN && SN.BILL_IMPORT_ENABLED === false,
  SNV || (String(SN && SN.BILL_IMPORT_ENABLED) + (stubbed ? '（xlsx 空桩）' : '')));
check('B-③ 两处取值运行期相等（同源）',
  !!FE && !!SN && FE.BILL_IMPORT_ENABLED === SN.BILL_IMPORT_ENABLED);
check('B-④ 形态常量与页面一致（dish_sales / waimai_goods 是**机器值**，不是字母序号）',
  !!SN && SN.DISH_SHAPES && SN.DISH_SHAPES.A === 'dish_sales' && SN.DISH_SHAPES.C === 'waimai_goods',
  SN ? JSON.stringify(SN.DISH_SHAPES) : 'n/a');

// 🔴 把 wxml 的那两条条件搬运成行为判据 —— 这才是"只关账单"的真正证据（不是看字面）
//    页面语义：① 暂停分支 = !billImportOn && !importShape
//              ② 内容分支 = billImportOn || !!importShape
//    云函数语义：账单（handleBillImport）不回 shape ⇒ importShape 为空；形态 A/C 回机器值。
function pausedOf(shape, on) { return !on && !shape; }
function contentOf(shape, on) { return on || !!shape; }
const CASES = [
  { name: '真账单（云函数不回 shape ⇒ 空串）', shape: '', want: { paused: true, content: false } },
  { name: '形态 A 堂食《菜品销售统计》', shape: (SN && SN.DISH_SHAPES && SN.DISH_SHAPES.A) || 'dish_sales', want: { paused: false, content: true } },
  { name: '形态 C 外卖《商品销量》', shape: (SN && SN.DISH_SHAPES && SN.DISH_SHAPES.C) || 'waimai_goods', want: { paused: false, content: true } },
];
const off = FE ? FE.BILL_IMPORT_ENABLED : false;
const rows = CASES.map((c) => ({ n: c.name, p: pausedOf(c.shape, off), k: contentOf(c.shape, off), w: c.want }));
check('B-⑤ 🔴 开关关闭时：账单走暂停分支、形态 A/C 走内容分支（**真账单被关、复盘输入照常**）',
  rows.every((r) => r.p === r.w.paused && r.k === r.w.content),
  rows.map((r) => `${r.n}: 暂停=${r.p}/内容=${r.k}`).join('  ｜  '));
check('B-⑥ 反向自证：账单样本**不是**恒 false —— 把开关打开它就该走内容分支',
  contentOf('', true) === true && pausedOf('', true) === false,
  `on=true ⇒ 暂停=${pausedOf('', true)}/内容=${contentOf('', true)}`);

console.log('\n===== C 自失效 / 反恒真（影子样本必须判红）=====');
// 影子①：开关改成 true ⇒ B-①②（暂停态判据）必须失效
const fakeOn = 'const BILL_IMPORT_ENABLED = true;';
check('C-① 影子：开关被改成 true ⇒ B-① 的"必须是 false"判据会判红（证明判据有分辨力）',
  reFlags.exec(fakeOn)[1] === 'true' && reFlags.exec(fakeOn)[1] !== 'false',
  reFlags.exec(fakeOn)[1]);
// 影子②：丢掉 importShape 判据的 wxml（= 把整卡一起关掉，本轮最危险的错法）
const BAD_WXML = '<view class="card2" wx:elif="{{importPreview}}">\n'
  + '  <view wx:if="{{!billImportOn}}"><view class="warn">{{t.importBillPaused}}</view></view>\n'
  + '</view>';
const badConds = (BAD_WXML.match(/wx:if="\{\{([^}"]*billImportOn[^}"]*)\}\}"/g) || [])
  .map((s) => s.replace(/^wx:if="\{\{/, '').replace(/\}\}"$/, ''));
check('C-② 🔴 影子：丢掉 importShape 判据的写法在 A-⑤ 上必须判红（这正是"关多了"那个错法）',
  badConds.length >= 1 && badConds.every((c) => c.indexOf('importShape') < 0),
  badConds.join('  |  '));
// 影子③：把开关接成"恒真"的假实现 ⇒ B-⑤ 必须失效
const fakeAlwaysOff = () => true;
check('C-③ 影子：把「真账单也判成内容分支」的假实现 ⇒ 与真实现在账单样本上相反（样本有分辨力）',
  fakeAlwaysOff('') !== contentOf('', off), `假=${fakeAlwaysOff('')} 真=${contentOf('', off)}`);
check('C-④ 断言数下界 ≥ 20（防删段后恒绿）', (pass + failN) >= 20, `本段前累计 ${pass + failN} 条`);

console.log(`\n===== R259 账单导入开关守卫：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
