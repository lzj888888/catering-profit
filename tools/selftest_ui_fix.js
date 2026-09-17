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
console.log('');
console.log('===== 修 4 · input 食材消耗两 key =====');
const iw = read("pages/month/input.wxml");
const ij = read("pages/month/input.js");
check('小节标题用 directConsumeSec', /<view class="sec">\{\{t\.directConsumeSec\}\}<\/view>/.test(iw));
check('字段标签用 directConsumeField', /<text class="lbl">\{\{t\.directConsumeField\}\}<\/text>/.test(iw));
check('两处文案不再相同（Sec=食材消耗 / Field=食材消耗合计（元））', (() => {
  const t = read("miniprogram/i18n/terms.js");
  const sec = /directConsumeSec: '([^']+)'/.exec(t);
  const field = /directConsumeField: '([^']+)'/.exec(t);
  return sec && field && sec[1] !== field[1];
})());
check('input.js 有 Sec/Field 映射', /directConsumeSec: TERMS\.uiFix\.directConsumeSec/.test(ij) && /directConsumeField: TERMS\.uiFix\.directConsumeField/.test(ij));

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
