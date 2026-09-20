// 批次 8 UI 走查修复 · 静态自测
// 运行： node pages/_selftest_ui_fix.js  （纯静态断言 + 少量模拟）
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ============ 修 1：result 三态 ============
console.log('===== 修 1 · result 三态（loading / 有结果 / 空态）=====');
const rw = read("pages/month/result.wxml");
check('存在 loading 独立分支 (wx:if={{loading}})', /wx:if="\{\{loading\}\}"/.test(rw));
check('存在结果分支 (wx:elif={{r}})', /wx:elif="\{\{r\}\}"/.test(rw));
check('存在空态分支 (wx:else) 且含 resultEmpty', /wx:else[\s\S]{0,400}resultEmpty/.test(rw));
check('空态分支不含「加载中」', !/wx:else[\s\S]{0,400}resultEmpty[\s\S]{0,200}加载中/.test(rw));
check('空态有去录入出口 (goInput + resultEmptyGoInput)', /resultEmptyGoInput/.test(rw) && /bindtap="goInput"/.test(rw));
const rj = read("pages/month/result.js");
check('result.js 有 goInput 方法跳 input', /goInput\(\) \{\s*wx\.navigateTo\(\{ url: '\/pages\/month\/input\?month='/.test(rj));
check('result.js 空态文案引用 uiFix.resultEmpty', /resultEmpty: TERMS\.uiFix\.resultEmpty/.test(rj));
check('旧 wx:else=加载中 已移除（无 !loading && r 写法）', !/!loading && r/.test(rw));

// ============ 修 2：amortize totalYuan 初值 ============
console.log('');
console.log('===== 修 2 · amortize totalYuan 初值 =====');
const aj = read("pages/month/amortize.js");
check('data 有 totalYuan: \'0.00\' 初值', /totalYuan: '0\.00'/.test(aj));
check('load() 成功路径仍赋值 totalYuan', /totalYuan: api\.fenToYuan\(d\.total_amount_fen \|\| 0, 2\)/.test(aj));
// 断言：即使 getAmortSchedule 失败（catch 只 loading:false），初值保证渲染 ¥0.00
check('catch 分支不改 totalYuan（保留初值 0.00）', /catch \(e\) \{\s*this\.setData\(\{ loading: false \}\)/.test(aj));

// ============ 修 3：month/index 月份占位 ============
console.log('');
console.log('===== 修 3 · month/index 月份空值占位 =====');
const mw = read("pages/month/index.wxml");
const mj = read("pages/month/index.js");
check('curMonth 空时显示 monthEmpty', /wx:if="\{\{curMonth\}\}"[\s\S]{0,200}wx:else>\{\{t\.monthEmpty\}\}/.test(mw));
check('monthEmpty 文案引用 uiFix.monthEmpty', /monthEmpty: TERMS\.uiFix\.monthEmpty/.test(mj));
check('monthEmpty 词条存在且无禁词', (() => {
  const t = read("miniprogram/i18n/terms.js");
  return /monthEmpty: '暂无账本'/.test(t);
})());

// ============ 修 4：input 两 key 拆分 ============
// 2026-09-20 更新：核算方式（库存/摊销）迁入录入页后，小节标题 = cmSecTitle，
// 字段标签 = cmConsumeDirectField。**守卫意图不变**：标题与字段标签必须是两个不同 key、
// 且文案不同（防"标题与字段名重复"的 UI 缺陷）；只是 key 从 uiFix 迁到 calcMethod。
console.log('');
console.log('===== 修 4 · input 小节标题 ≠ 字段标签 =====');
const iw = read("pages/month/input.wxml");
const ij = read("pages/month/input.js");
check('小节标题用独立 key（cmSecTitle）', /<view class="sec">\{\{t\.cmSecTitle\}\}<\/view>/.test(iw));
check('字段标签用独立 key（cmConsumeDirectField）', /<text class="lbl">\{\{t\.cmConsumeDirectField\}\}<\/text>/.test(iw));
check('两处文案不再相同（Sec ≠ Field）', (() => {
  const t = read("miniprogram/i18n/terms.js");
  const sec = /secTitle: '([^']+)'/.exec(t);
  const field = /consumeDirectField: '([^']+)'/.exec(t);
  return sec && field && sec[1] !== field[1];
})());
check('input.js 有 Sec/Field 映射', /cmSecTitle: TERMS\.calcMethod\.secTitle/.test(ij) && /cmConsumeDirectField: TERMS\.calcMethod\.consumeDirectField/.test(ij));
// 防回归：核算方式（库存倒轧 / 摊销）单源 = 月度录入页；设置页只保留「去向说明」，不得再出现任何选择入口。
// 🔴 2026-09-20 round59 加固：旧判据 !/inventorySwitch|amortizeSwitch/ **绑死旧 key 名** ⇒
//    换个新名（如 calcMethod.invMode）把开关放回设置页，它**不会红**（round55 实证、与 E1 同族病）。
//    现改**语义级**（沿用 round58 为 E1 跑通的加固模板）：
//      ① 锚点 fail-closed —— 单源在录入页 + 去向说明来自 TERMS.calcMethod.movedNote，均**不绑 key 名**；
//      ② 禁用框架 —— 控件/指令 + 受限字符窗，不裸扫关键词（正确文案里常含否定式提法）。
console.log('');
console.log('===== 修 4 防回归 · 核算方式单源（语义级，round59 加固）=====');
const swSrc = read("pages/shop/setting.wxml"), sjSrc = read("pages/shop/setting.js");
const stripCmt = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const swCode = stripCmt(swSrc), sjCode = stripCmt(sjSrc);
// ① 锚点 a：选择入口必须在月度录入页（不绑 handler 名，只看是否提供 inventory + amortize 两种二选一）
const cmKinds = [...iw.matchAll(/data-kind="(\w+)"/g)].map(m => m[1]);
check('🔴 核算方式选择入口在月度录入页（inventory+amortize 二选一）',
  cmKinds.includes('inventory') && cmKinds.includes('amortize') && /bindtap="\w+"/.test(iw),
  'kinds=' + [...new Set(cmKinds)].join('/'));
// ① 锚点 b：设置页去向说明必须来自单源 TERMS.calcMethod.movedNote 且真被渲染（不绑 key 名，fail-closed）
const movedKey = /(\w+):\s*TERMS\.calcMethod\.movedNote/.exec(sjCode);
check('🔴 设置页去向说明来自单源 calcMethod.movedNote 且已渲染',
  !!movedKey && new RegExp('\\{\\{t\\.' + movedKey[1] + '\\}\\}').test(swCode),
  movedKey ? 'key=' + movedKey[1] : 'MISS');
// ② 禁用 a：设置页**有效代码面**不得引用 movedNote 之外的任何 calcMethod 取值
const badCmRefs = [...(swCode + sjCode).matchAll(/calcMethod\.(\w+)/g)].map(m => m[1]).filter(v => v !== 'movedNote');
check('🔴 设置页无 movedNote 之外的 calcMethod 引用', badCmRefs.length === 0, badCmRefs.join(','));
// ② 禁用 b：设置页不得出现任何选择型入口或 switches 写入（与 key 名、与措辞无关）
const chooseHit = /<(picker|switch|radio-group|checkbox-group|slider)\b|data-kind="(?:inventory|amortize)"|switches\s*:|saveShopSetting[\s\S]{0,240}switches/.exec(swCode + sjCode);
check('🔴 设置页无核算方式选择入口 / switches 写入', !chooseHit, chooseHit ? chooseHit[0].slice(0, 40) : '');

// ============ 修 5：tabs 单 tab 不满宽 ============
console.log('');
console.log('===== 修 5 · 单 tab 不满宽 =====');
const mx = read("pages/month/index.wxss");
check('tabs 依 isPaid 加 single 类', /class="tabs \{\{isPaid \? '' : 'single'\}\}"/.test(mw));
check('wxss 有 .tabs.single 规则（flex 0 0 auto + min-width 220rpx）', /\.tabs\.single \{[^}]*display: inline-flex/.test(mx) && /\.tabs\.single \.tab \{[^}]*flex: 0 0 auto; min-width: 220rpx/.test(mx));
check('双 tab 时保持 .tab flex:1（未改默认）', /\.tab \{ flex: 1;/.test(mx));

// ============ 修 6：mine 注销按钮抽类 ============
console.log('');
console.log('===== 修 6 · mine 注销按钮抽类 =====');
const mnw = read("pages/mine/index.wxml");
const mnx = read("pages/mine/index.wxss");
check('按钮用 .btn.danger 类', /<button class="btn danger"/.test(mnw));
check('无内联 style（background:#e74c3c 已移除）', !/style="background:#e74c3c;color:#fff;"/.test(mnw));
check('wxss 定义 .btn.danger', /\.btn\.danger \{[^}]*background: #e74c3c; color: #fff/.test(mnx));

// ============ 硬编码中文检查（wxml 业务代码无硬编码，注释除外）============
console.log('');
console.log('===== 硬编码中文检查（6 个页面 wxml，排除注释与 {{}} 绑定）=====');
const pages = ["pages/month/result.wxml","pages/month/amortize.wxml","pages/month/index.wxml","pages/month/input.wxml","pages/mine/index.wxml"];
let hard = 0;
for (const p of pages) {
  let s = read(p).replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{[^}]*\}\}/g, "").replace(/<[^>]*>/g, " ");
  const m = s.match(/[\u4e00-\u9fa5]+/g);
  if (m) { hard++; console.log("WXML-HARDCODED", p, m.join(",")); }
}
check('6 页 wxml 无硬编码中文（除注释）', hard === 0);

// ============ i18n 双副本一致 ============
console.log('');
console.log('===== i18n 双副本一致（K11）=====');
const f1 = read("miniprogram/i18n/terms.js");
const f2 = read("specs/dev-specs/i18n/terms.js");
check('terms.js 双副本逐字节一致', f1 === f2);

// ============ 禁词检查（新增词条）============
console.log('');
console.log('===== 禁词检查（uiFix 词条）=====');
const t3 = read("miniprogram/i18n/terms.js");
const uiFixBlock = t3.slice(t3.indexOf("uiFix:"), t3.indexOf("};", t3.indexOf("uiFix:")));
check('uiFix 词条无禁词（投资回报/ROI/回本周期/会员/订阅/会员费）',
  !/(投资回报|ROI|回本周期|会员|订阅|会员费)/.test(uiFixBlock));

console.log(`\n==== 批次 8 UI 修复自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
