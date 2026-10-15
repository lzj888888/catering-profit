#!/usr/bin/env node
/**
 * M2 矩阵/对比改造守卫（R 批次 · 2026-10-11）
 *   ＋ M2 页面完整性（R297 第四轮「M2 整体功能审计」· 2026-10-15）
 *
 * 背景（第 1~3 节）：M2 G1 场景矩阵（calcSandbox 新增 matrix action）+ G4 免费导出（exportData m2_matrix scope）
 *   是本次改造的核心新增面。两者都不能靠"肉眼"守住（引擎 service.js 不准改、付费墙红线不准绕过），
 *   故用静态契约检查把"该有的分支都在"钉死：
 *   ① calcSandbox 必须有 matrix action，且确实循环调 calcSandbox（引擎零改、批量复用）；
 *   ② exportData 必须有 m2_matrix scope，且对免费导出**显式跳过**付费墙判定（isM2FreeExport）；
 *   ③ matrix 术语块在两份 terms 副本里都存在且关键键齐全（单源双副本一致）。
 *
 * 第 4 节（R297 第四轮新增）：把该轮审计在**页面层**抓到的真 BUG 逐条钉住，防复发：
 *   B1  `list.js` 画布必须**在交互前预热**（原 initCanvas 恒同步返回 null ⇒ 首次点导出必失败）
 *   B2  `compare.js` 必须读 `snapshot.reverse`（原只读顶层 ⇒ 反推方案两个页面两个数）
 *   B3  `index.js` 两条 payload 都必须带 `valid_days`（原主测算漏传 ⇒ 与敏感度/保存不同源）
 *   B4  `compare.js` 结论文案必须走术语单源（原硬编码中文）
 *   B5  对比表的 `wx:key` 不得用可重名的 `name`（须用唯一 id）
 *   B7  矩阵"算不出的档位"必须在表内可见（invalid 有渲染）
 *   B9/B14 页面硬编码中文走 **ratchet**（只许降不许升，且逐项登记）
 *   B10 `onPreset` 不得无条件覆盖用户手填的单桌座位数
 *   B11 【开始测算】按钮不得把事件对象当 isFirst（原致整页重绘）
 *   B12 结果区锚点 `#m2result` 必须**恰好一处**且无条件存在
 *
 * 纯静态（fs + 正则），不 require 任何云 SDK，可在普通 node 下被 verify_all 串联运行。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
let pass = 0;
const ok = () => { pass += 1; };
const fail = (m) => problems.push(m);
const chk = (cond, msg) => { if (cond) ok(); else fail(msg); };

const read = (p) => {
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp)) { fail('缺少文件：' + p); return ''; }
  return fs.readFileSync(fp, 'utf8');
};

// ⚠️ 凡是"**不得出现**某段代码"的判据，一律扫**去注释**源码 ——
//   否则守卫会被自己的注释误伤（R297 第四轮实测：B11/B12 两条判据正是被解释性注释里的
//   引文 `bindtap="onCalc"` / `id="m2result"` 判红）。判据必须与人写的注释解耦。
const CJK = /[\u4e00-\u9fa5]/;
const stripSrc = (src, ext) => {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (ext === '.wxml') s = s.replace(/<!--[\s\S]*?-->/g, '');
  return s;
};
const countCjkStrings = (src, ext) => {
  let n = 0;
  for (const ln of stripSrc(src, ext).split('\n')) {
    const re = /(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g;
    let m;
    while ((m = re.exec(ln)) !== null) if (CJK.test(m[2])) n += 1;
  }
  return n;
};

// ===== 1. calcSandbox matrix action =====
const calcIdx = read('cloudfunctions/calcSandbox/index.js');
chk(/event\.action\s*===\s*['"]matrix['"]/.test(calcIdx), 'calcSandbox 缺少 matrix action 分支');
// 🔴 R297 第二轮：原判据硬钉字面量 `arr.map((c) => calcSandbox`（实现细节）。
//   修「矩阵分支零校验 ⇒ 越界值静默产数」必须在调用引擎**之前**插逐行校验，
//   回调签名必然从 `(c)` 变成 `(c, i)` ⇒ 字面量判据把"修这个 bug"直接判红。
//   ⇒ 改为**判语义**（仍是批量 map 复用引擎，不多不少），并**加严一条**：必须逐行过 validateClean。
const mx = calcIdx.slice(calcIdx.indexOf("action === 'matrix'"));
const mxBody = mx.slice(0, mx.indexOf('const shopId') > 0 ? mx.indexOf('const shopId') : mx.length);
chk(/arr\.map\(/.test(mxBody), 'matrix 未用 arr.map 批量调用（引擎零改、批量复用）');
chk(/calcSandbox\(/.test(mxBody), 'matrix 分支未调用 calcSandbox（引擎零改、批量复用）');
chk(/validateClean\(/.test(mxBody),
  'matrix 分支未做逐行入参校验（R297：零校验 ⇒ 毛利率 150 / 负房租静默产数，方向是保本偏低）');

// ===== 2. exportData m2_matrix 免费分支 =====
const exp = read('cloudfunctions/exportData/index.js');
chk(/scope\s*===\s*'m2_matrix'/.test(exp), 'exportData 缺少 m2_matrix scope');
chk(/isM2FreeExport/.test(exp), 'exportData 缺少 M2 免费导出豁免标记 isM2FreeExport');
chk(/if\s*\(\s*!isM2FreeExport\s*\)\s*\{[\s\S]*hasFeature/.test(exp),
  'exportData 未对 m2_matrix 显式跳过付费墙判定（hasFeature 必须包在 if(!isM2FreeExport) 内）');

// ===== 3. 术语双副本一致 =====
const t1 = read('miniprogram/i18n/terms.js');
const t2 = read('specs/dev-specs/i18n/terms.js');
const needKeys = ['matrix:', 'exportXlsx', 'colBreakMonthly', 'cmpTitle', 'cmpDoCompare', 'toCompare'];
for (const k of needKeys) {
  chk(t1.includes(k), 'miniprogram/i18n/terms.js 缺「' + k + '」');
  chk(t2.includes(k), 'specs/dev-specs/i18n/terms.js 缺「' + k + '」');
}

// ============================================================
// 4. M2 页面完整性（R297 第四轮整体审计）
// ============================================================
const idxJs = read('pages/sandbox/index.js');
const idxWxml = read('pages/sandbox/index.wxml');
const listJs = read('pages/sandbox/list.js');
const listWxml = read('pages/sandbox/list.wxml');
const cmpJs = read('pages/sandbox/compare.js');
const cmpWxml = read('pages/sandbox/compare.wxml');
const mtxJs = read('pages/sandbox/matrix.js');
const mtxWxml = read('pages/sandbox/matrix.wxml');
const mtxWxss = read('pages/sandbox/matrix.wxss');
// 去注释副本（凡"不得出现"类判据一律扫它，见文件上方说明）
const idxWxmlS = stripSrc(idxWxml, '.wxml');
const cmpJsS = stripSrc(cmpJs, '.js');

// --- B1：画布必须交互前就绪 ---
chk(/onReady\s*\(\s*\)\s*\{[^}]*this\.initCanvas\(\)/.test(listJs),
  'list.js 缺 onReady 预热画布（B1：initCanvas 异步、同步恒返回 null ⇒ 首次点【导出图片】必失败）');
chk(/onReady\s*\(\s*\)\s*\{/.test(listJs), 'list.js 缺 onReady 钩子');

// --- B2：compare.js 必须读 reverse 块 ---
chk(/s\.reverse\s*&&\s*s\.reverse\.target_monthly_fen/.test(cmpJs),
  'compare.js 未读 snapshot.reverse.target_monthly_fen（B2：反推方案会显示正向口径的目标月营收，与 list.js 不一致）');

// --- B3：两条 payload 都带 valid_days ---
{
  const n = (idxJs.match(/valid_days:\s*p\.valid_days/g) || []).length;
  chk(n >= 2, 'index.js 只有 ' + n + ' 处 `valid_days: p.valid_days`（B3：主测算 payload 漏传 ⇒ 与敏感度/保存不同源，应为 2 处）');
}

// --- B4：结论文案走术语单源 ---
chk(!/保本月营收最低（/.test(cmpJsS), 'compare.js 仍含硬编码结论文案（B4）');
chk(/cmpVerdictBest/.test(t1) && /cmpVerdictBest/.test(t2),
  'terms 双副本缺 cmpVerdictBest（B4）');
chk(/this\.data\.t\.verdictBest/.test(cmpJs), 'compare.js 未使用术语 verdictBest（B4）');

// --- B5：wx:key 不得用可重名的 name ---
chk(!/wx:key\s*=\s*"name"/.test(cmpWxml), 'compare.wxml 仍用 wx:key="name"（B5：方案名可重名 ⇒ 撞键）');
chk(!/wx:key\s*=\s*"name"/.test(listWxml), 'list.wxml 仍用 wx:key="name"（B5）');
chk(/id:\s*it\.sandbox_id/.test(listJs), 'list.js 的对比列未带唯一 id（B5）');
chk(/id:\s*p\.sandbox_id/.test(cmpJs), 'compare.js 的对比行未带唯一 id（B5）');

// --- B7：矩阵"算不出的档位"表内可见 ---
//   ⚠️ 判据必须钉在**行的 class 绑定**上（而不是"文件里出现过 item.invalid"）——
//      后者会被同一行第二个绑定（首列 ⚠ 标记）满足 ⇒ 变异回灌实测抓不到（弱判据）。
chk(/class="tr [^"]*item\.invalid/.test(mtxWxml), 'matrix.wxml 的行 class 未绑定 item.invalid（B7：被拒档位在表里无从定位）');
chk(/\.tr\.invalid/.test(mtxWxss), 'matrix.wxss 缺 .tr.invalid 样式（B7）');

// --- B10：onPreset 不得无条件覆盖手填的单桌座位数 ---
{
  const guarded = /if\s*\(\s*!this\.data\.fieldTouched\.seatsPerTable\s*\)\s*\{[\s\S]{0,200}?seatsPerTableNum/.test(idxJs);
  chk(guarded, 'index.js onPreset 仍无条件覆盖 seatsPerTableNum（B10：用户手填值被业态切换静默重置）');
  chk(/seatsPerTable:\s*false/.test(idxJs), 'index.js fieldTouched 缺 seatsPerTable 键（B10）');
  chk(/'fieldTouched\.seatsPerTable':\s*true/.test(idxJs), 'index.js onSeatsPerTable 未标记手填（B10）');
}

// --- B11：【开始测算】按钮不得传事件对象当 isFirst ---
chk(!/bindtap\s*=\s*"onCalc"/.test(idxWxmlS),
  'index.wxml 仍 `bindtap="onCalc"`（B11：事件对象恒真 ⇒ 每次点按钮整页重绘、丢滚动位置）');
chk(/bindtap\s*=\s*"onCalcBtn"/.test(idxWxmlS), 'index.wxml 的【开始测算】未改走 onCalcBtn（B11）');
chk(/onCalcBtn\s*\(\s*\)\s*\{\s*return this\.onCalc\(false\)/.test(idxJs), 'index.js 缺 onCalcBtn 包装（B11）');
chk(/isFirst\s*===\s*true/.test(idxJs), 'index.js onCalc 未把 isFirst 收紧为 `=== true`（B11）');

// --- B12：结果区锚点恰好一处 ---
{
  const n = (idxWxmlS.match(/id="m2result"/g) || []).length;
  chk(n === 1, 'index.wxml 里 id="m2result" 出现 ' + n + ' 次（B12：必须恰好 1 次且无条件存在，否则吸底条点击静默失效）');
  chk(/<view id="m2result"><\/view>/.test(idxWxmlS), 'index.wxml 的结果区锚点不是无条件空锚点（B12）');
}

// --- B9/B14：页面硬编码中文 ratchet（只许降不许升） ---
//   基线 = 2026-10-15 审计当时实测值（去注释后的引号内 CJK 串计数）。
//   说明：`index.js::badParamOf` / `matrix.js::badDimOf` 的"人话"是 R297 二/三轮**刻意**加的
//   （云端 fail 的 msg 会被 utils/api.js 覆盖，R271）⇒ 本期**显式豁免**、计入基线而不下沉 terms。
//   wxml 侧同理：`元`/`%`/`天` 等**裸文本节点**不在本判据的引号扫描面内，属已登记豁免。
const CJK_BASELINE = {
  'pages/sandbox/index.js': 11,
  'pages/sandbox/index.wxml': 0,
  'pages/sandbox/matrix.js': 9,
  'pages/sandbox/matrix.wxml': 2,
  'pages/sandbox/compare.js': 1,
  'pages/sandbox/compare.wxml': 0,
  'pages/sandbox/list.js': 0,
  'pages/sandbox/list.wxml': 0,
};
let cjkTotal = 0;
for (const rel of Object.keys(CJK_BASELINE)) {
  const cur = countCjkStrings(read(rel), path.extname(rel));
  cjkTotal += cur;
  chk(cur <= CJK_BASELINE[rel],
    '硬编码中文回升：' + rel + ' 现有 ' + cur + ' 处 > 基线 ' + CJK_BASELINE[rel] + '（B9/B14：新文案请进 terms.js）');
}

if (problems.length) {
  console.log('❌ M2 矩阵/对比 + 页面完整性守卫失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('M2 矩阵/对比 + 页面完整性守卫结果：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ M2 矩阵/对比改造守卫通过（matrix action 批量复用引擎 + m2_matrix 免费导出豁免 + 术语双副本一致）');
console.log('✅ M2 页面完整性守卫通过（B1 画布预热 / B2 反推口径 / B3 valid_days 同源 / B4 术语单源 / B5 wx:key /'
  + ' B7 invalid 可见 / B10 手填不覆盖 / B11 按钮不重绘 / B12 锚点唯一 / B9+B14 硬编码中文 ' + cjkTotal + ' 处 ≤ 基线）');
console.log('M2 矩阵/对比 + 页面完整性守卫结果：' + pass + ' 通过 / 0 失败');
