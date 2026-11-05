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
const rw = read("subpkg/biz/month/result.wxml");
check('存在 loading 独立分支 (wx:if={{loading}})', /wx:if="\{\{loading\}\}"/.test(rw));
// 🔴 R298·C1：本段由「存在性判据」升为「**可达性判据**」（判语义，不钉字面量）。
//   旧断言钉死 `wx:elif="{{r}}"` —— 而那正是缺陷本身：getLedger 对无账本记录月返回「默认空账」
//   ⇒ r 在成功路径恒真 ⇒ 空态分支只在 catch（接口异常）路径可达 ⇒ 「无账本」这个正常态走不到
//   ⇒ 未建档月份挂红带「亏损」。教训：「分支在不在」绿了，没人问「分支到不到」。
const mElif = rw.match(/wx:elif="\{\{(.+?)\}\}"/);
const elifExpr = mElif ? mElif[1].trim() : '';
check('结果分支判据存在（fail-closed：无 wx:elif 即红）', mElif !== null, elifExpr ? `判据 = ${elifExpr}` : '未匹配');
check('🔴 结果分支判据 = 账本存在性信号（不得是 r/result 这类恒真量）',
  /hasLedger|account/i.test(elifExpr), `判据 = ${elifExpr || 'n/a'}`);
const rj = read("subpkg/biz/month/result.js");
check('🔴 result.js 该信号由 d.account_id 派生（与 getLedger:177 出参同源）',
  /hasLedger\s*:\s*!!\(\s*d\s*&&\s*d\.account_id\s*\)/.test(rj));
check('存在空态分支 (wx:else) 且含 resultEmpty', /wx:else[\s\S]{0,400}resultEmpty/.test(rw));
check('空态分支不含「加载中」', !/wx:else[\s\S]{0,400}resultEmpty[\s\S]{0,200}加载中/.test(rw));
check('空态有去录入出口 (goInput + resultEmptyGoInput)', /resultEmptyGoInput/.test(rw) && /bindtap="goInput"/.test(rw));
check('result.js 有 goInput 方法跳 input', /goInput\(\) \{\s*wx\.navigateTo\(\{ url: '\/(?:pages\/month|subpkg\/biz\/month)\/input\?month='/.test(rj));
check('result.js 空态文案引用 uiFix.resultEmpty', /resultEmpty: TERMS\.uiFix\.resultEmpty/.test(rj));
check('旧 wx:else=加载中 已移除（无 !loading && r 写法）', !/!loading && r/.test(rw));
// —— 影子样本：证明上面的「可达性」断言**真有分辨力**（不然它可能恒真 = 假绿），且替换确实生效
const shadowWxml = rw.replace(/wx:elif="\{\{(.+?)\}\}"/, 'wx:elif="{{r}}"');
const shadowExprM = shadowWxml.match(/wx:elif="\{\{(.+?)\}\}"/);
const shadowExpr = shadowExprM ? shadowExprM[1].trim() : '';
check('影子 W：判据换回 {{r}}（缺陷原样）⇒ 可达性断言必须判红',
  shadowExpr === 'r' && !/hasLedger|account/i.test(shadowExpr), `替换后判据 = ${shadowExpr || 'n/a'}`);
const shadowJs = rj.replace(/hasLedger\s*:\s*!!\(.+?\)/, 'hasLedger: true');
check('影子 J：js 侧判据改成恒真 ⇒ 「由 account_id 派生」断言必须判红',
  !/hasLedger\s*:\s*!!\(\s*d\s*&&\s*d\.account_id\s*\)/.test(shadowJs));

// ============ 修 2：amortize totalYuan 初值 ============
console.log('');
console.log('===== 修 2 · amortize totalYuan 初值 =====');
const aj = read("subpkg/biz/month/amortize.js");
check('data 有 totalYuan: \'0.00\' 初值', /totalYuan: '0\.00'/.test(aj));
check('load() 成功路径仍赋值 totalYuan', /totalYuan: api\.fenToYuan\(d\.total_amount_fen \|\| 0, 2\)/.test(aj));
// 断言：即使 getAmortSchedule 失败（catch 只 loading:false），初值保证渲染 ¥0.00
check('catch 分支不改 totalYuan（保留初值 0.00）', /catch \(e\) \{\s*this\.setData\(\{ loading: false \}\)/.test(aj));

// ============ 修 3：month/index 月份占位 ============
console.log('');
console.log('===== 修 3 · month/index 月份空值占位 =====');
const mw = read("subpkg/biz/month/index.wxml");
const mj = read("subpkg/biz/month/index.js");
check('curMonth 空时显示 monthEmpty', /wx:if="\{\{curMonth\}\}"[\s\S]{0,200}wx:else>\{\{t\.monthEmpty\}\}/.test(mw));
check('monthEmpty 文案引用 uiFix.monthEmpty', /monthEmpty: TERMS\.uiFix\.monthEmpty/.test(mj));
check('monthEmpty 词条存在且无禁词', (() => {
  const t = read("miniprogram/i18n/terms.js");
  return /monthEmpty: '暂无账本'/.test(t);
})());

// ============ 修 7：月份下拉必须自带滚动窗口 ============
// 缺陷本体（2026-09-21 李老师真机反馈「月份选择 只有两个月份」）：months 只由
// getMonthList（= 已建档月份）∪ 当月 组成 ⇒ 新店首次只剩当月，补录往月无从下手。
// ⚠️ 判据一律**不绑函数名**（round55/59 同族病：绑字面名 ⇒ 换个新名就漏判或误杀）：
//    窗口函数靠**行为**识别 —— 无参调用返回 ≥12 个连续月份、首项=当月、格式 YYYY-MM。
console.log('');
console.log('===== 修 7 · 月份下拉滚动窗口（round75）=====');
const UI2 = require(path.join(ROOT, "utils/ui.js"));
const winFn = Object.keys(UI2).find((k) => {
  if (typeof UI2[k] !== 'function') return false;
  try {
    const r = UI2[k]();
    return Array.isArray(r) && r.length >= 12 && r[0] === UI2.nowMonth()
      && r.every((x) => /^\d{4}-(0[1-9]|1[0-2])$/.test(x));
  } catch (e) { return false; }
});
check('🔴 utils/ui.js 存在「滚动窗口」函数（行为判据，不绑函数名）', !!winFn, 'fn=' + (winFn || 'MISS'));
const wv = winFn ? UI2[winFn]() : [];
check('🔴 月度首页真的调用它（不绑函数名）',
  !!winFn && new RegExp('ui\\.' + winFn + '\\(').test(mj));
check('🔴 月份集合 = 滚动窗口 ∪ 已建档 ∪ 当月（语义判据：并入已建档 + 调窗口函数 + 去重，均不认具体写法）', (() => {
  // 🔴 round77 加固：原判据绑死字面写法 `Array.from(new Set(` ⇒ 正确实现改用 `[...new Set(...)]`
  //    或 `.filter(indexOf)` 去重会被**误杀**（round55/59 同族病：绑字面 ⇒ 换个写法就错判）。
  //    改语义三条腿：① 并入已建档月份 ② 真的调用窗口函数（不绑函数名）③ 有去重动作（写法随意）。
  const m = mj.match(/(?:const|let|var)\s+months\s*=\s*([\s\S]{0,240}?)\.sort\(\)\.reverse\(\)/);
  if (!m) return false;                                       // 拿不到赋值块 ⇒ fail-closed
  const blk = m[1];
  // \u53bb\u91cd\u5fc5\u987b\u662f\u201c\u771f\u53bb\u91cd\u201d\uff1a`new Set(` \u6216 \u201cfilter/reduce + indexOf|includes\u201d\u2014\u2014 \u5355\u7eaf `.filter(Boolean)` \u53ea\u662f\u53bb\u7a7a\uff0c\u4e0d\u7b97\uff08round77 A8 \u5b9e\u8bc1\uff09\u3002
  const dedupe = /new Set\(/.test(blk)
    || ((/\.filter\(|\.reduce\(/.test(blk)) && /indexOf|includes\(/.test(blk));
  const win = !!winFn && new RegExp('ui\\.' + winFn + '\\(').test(blk);
  return /ml\.list|getMonthList/.test(blk) && win && dedupe && /\bcur\b/.test(blk);
})());
check('反向：月份不得写死为固定数组', !/months:\s*\[\s*'\d{4}-\d{2}'/.test(mj));
check('运行时：窗口含当月 + 倒序 + 格式合法',
  wv.length >= 12 && wv[0] === UI2.nowMonth()
  && JSON.stringify([...wv].sort().reverse()) === JSON.stringify(wv));
check('运行时：逐月连续无跳月/重月（含跨年）', (() => {
  for (let i = 1; i < wv.length; i++) {
    const [y1, m1] = wv[i - 1].split('-').map(Number);
    const [y2, m2] = wv[i].split('-').map(Number);
    if ((y1 * 12 + m1) - (y2 * 12 + m2) !== 1) return false;
  }
  return true;
})());
check('运行时：支持传参取 n 个月；非法入参回落（不返回空数组）',
  !!winFn && UI2[winFn](6).length === 6 && UI2[winFn]('x').length >= 12 && UI2[winFn](0).length >= 12);

// ============ 修 4：input 两 key 拆分 ============
// 2026-09-20 更新：核算方式（库存/摊销）迁入录入页后，小节标题 = cmSecTitle，
// 字段标签 = cmConsumeDirectField。**守卫意图不变**：标题与字段标签必须是两个不同 key、
// 且文案不同（防"标题与字段名重复"的 UI 缺陷）；只是 key 从 uiFix 迁到 calcMethod。
console.log('');
console.log('===== 修 4 · input 小节标题 ≠ 字段标签 =====');
const iw = read("subpkg/biz/month/input.wxml");
const ij = read("subpkg/biz/month/input.js");
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
const swSrc = read("subpkg/tools/shop/setting.wxml"), sjSrc = read("subpkg/tools/shop/setting.js");
const stripCmt = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const swCode = stripCmt(swSrc), sjCode = stripCmt(sjSrc);
// ① 锚点 a：食材口径的选择入口必须在月度录入页；且录入页要有一处去「一次性投入」页的入口。
//   🔴 round107 **重定（语义级）** —— 旧判据要求 `data-kind` 里同时出现 inventory + amortize。
//      那对选项写的是 **shop 级** `amortize_switch`，结构上把「本月一笔摊销 + 几笔小额一次算清」
//      变成互斥 —— 李老师真机反馈否决了它，现已拆成「逐笔登记」（见 subpkg/biz/month/assetEdit）。
//      ⇒ 判据改为**不绑 handler 名、不绑 data-kind 取值**：
//         ① `data-kind="inventory"` 二选一仍在录入页（食材口径单源没搬走）；
//         ② `iw` 里某个 bindtap 的 handler，其方法体内跳向 /subpkg/biz/month/amortize（= 去投入页的入口）。
//      本条的**真正意图**（防开关挪回设置页）由下面 `chooseHit` 独立守，未放宽（round59 加固不撤）。
const cmKinds = [...iw.matchAll(/data-kind="(\w+)"/g)].map(m => m[1]);
const cmTapNames = [...iw.matchAll(/bindtap="(\w+)"/g)].map(m => m[1]);
//   🔴 R423 分包化：跳转目标现在可能是 /subpkg/biz/month/... ⇒ 正则兼容两种（不绑死包位置）。
const cmGoesAsset = cmTapNames.some((n) => new RegExp(n + '\\s*\\(\\)\\s*\\{[^}]*\\/(?:pages\\/month|subpkg\\/biz\\/month)\\/amortize').test(ij));
check('🔴 食材口径选择入口在月度录入页 + 录入页有一处去「一次性投入」页的入口',
  cmKinds.includes('inventory') && cmGoesAsset && /bindtap="\w+"/.test(iw),
  'kinds=' + [...new Set(cmKinds)].join('/') + ' / 去投入页=' + (cmGoesAsset ? '有' : '无'));
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

// ============ 修 5：首页单数字摘要卡（去掉双 tab 切换） ============
console.log('');
console.log('===== 修 5 · 首页单数字摘要卡 =====');
const mx = read("subpkg/biz/month/index.wxss");
check('首页结果卡不再有双 tab 切换（wxml 无 class="tabs"）', !/class="tabs/.test(mw));
check('首页只显一个利润数：按 isPaid 取 true_profit / ref_profit', /isPaid \? result\.true_profit : result\.ref_profit/.test(mw));
check('wxss 已移除 .tabs / .tabs.single 规则', !/\.tabs\s*\{/.test(mx) && !/\.tabs\.single/.test(mx));
check('免费用户仍渲染 moFreeHint 升级提示（hint-fold 守卫不破）', /data-key="moFreeHint"/.test(mw) && /t\.freeHint/.test(mw));

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
const pages = ["subpkg/biz/month/result.wxml","subpkg/biz/month/amortize.wxml","subpkg/biz/month/index.wxml","subpkg/biz/month/input.wxml","pages/mine/index.wxml"];
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
