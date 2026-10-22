#!/usr/bin/env node
/**
 * 导入失败「缺哪几列」诊断守卫（R286 · 2026-10-13）
 *
 * 背景（同族病：写了人话 ≠ 用户看得见）：
 *   `importSalesBill` 认不出表形态时，原实现 `fail(INVALID_PARAM, '无法识别账单平台（请确认是…）')`。
 *   而 `utils/api.js:47` 会把 `r.msg` **整条覆盖**成 `msgOf(code)` 的通用文案（原始 msg 只落 console.warn）
 *   ⇒ 老板看到的只有「参数有误」，不知道**该补哪一列**，只能反复换文件（R283 实测痛点）。
 *   ⇒ R286 改为走 **ok 的 data 通道**回结构化诊断，文案由前端按 i18n/terms.js 拼。
 *
 * 本守卫钉死四件事：
 *   ① 通道：认不出 ⇒ 必须 `ok({ diagnosis })`，**不得**再用 fail（回到被覆盖的老路）；
 *   ② 自洽：**列齐时不得报「缺列」**（`reason` 必须是 cols_ok_but_excluded / empty_table 之一），
 *      否则老板会照着回执去补一列根本不缺的列（比不说更坏）；
 *   ③ 三处文案：terms 双副本 + 页面 `t:{}` 都要有 importDiag*（漏第三处 = 静默空白）；
 *   ④ 自失效护栏：源文件一个都读不到 ⇒ **判红**（不许扫空恒绿）。
 *   ⑤ （R434 · 队列 #44）**混装列 ≠ 缺列**：表里有一列装着「商品名,单价,数量」时，
 *      必须回 `mixed_goods_column` 并**指名那一列**，不得退回「缺：商品名称/销量/销售额」
 *      —— 后者会让老板以为是自己导错了表（R431 实测的误导线）。
 *      判据要同时守住两个方向的误判：真缺列不得被说成混装列（B-⑩）、
 *      `商品编号`/`商品条码` 这类**正常列**不得被子串匹配当成混装列（B-⑪）。
 *
 * 运行：node tools/check_import_diagnosis.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = {
  svc: path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js'),
  idx: path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'index.js'),
  page: path.join(ROOT, 'subpkg', 'biz', 'takeaway', 'index.js'),
  wxml: path.join(ROOT, 'subpkg', 'biz', 'takeaway', 'index.wxml'),
  terms: path.join(ROOT, 'miniprogram', 'i18n', 'terms.js'),
  termsSpec: path.join(ROOT, 'specs', 'dev-specs', 'i18n', 'terms.js'),
};

const problems = [];
const warns = [];
function fail(m) { problems.push(m); }
function readUtf8(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}
// 🔴 「键被启用」判据：**排除注释行**。
//   变异回灌实测：把 `importDiagBody:` 注释掉后，裸 `indexOf('importDiagBody:')` 仍能命中注释文本
//   ⇒ 守卫恒绿（假绿）。判行为不判字面：**生效的键**才算数，注释掉的不算。
function hasActiveKey(txt, k) {
  return String(txt || '').split('\n')
    .some((l) => l.indexOf(k + ':') >= 0 && l.trim().indexOf('//') !== 0);
}

let scanned = 0;
const src = {};
for (const k of Object.keys(P)) {
  src[k] = readUtf8(P[k]);
  if (src[k] == null) fail(`源文件读不到（守卫形同虚设）：${P[k]}`);
  else scanned++;
}

// ===== A 静态面：通道 + 三处文案 + 前端真的处理 =====
if (src.svc) {
  if (!/diagnoseColumns/.test(src.svc)) fail('A-① service.js 未定义 diagnoseColumns（认不出表就没有诊断可回）');
  // 🔴 判据必须**逐行且排除注释行**：变异回灌实测「把导出行注释掉」时，
  //    裸正则仍能在注释文本里匹配到 diagnoseColumns 字样 ⇒ 守卫恒绿（假绿，分辨力为零）。
  const expBlock = (src.svc.match(/module\.exports\s*=\s*\{[\s\S]*?\n\};/m) || [''])[0];
  const expLine = expBlock.split('\n').find((l) => l.indexOf('diagnoseColumns') >= 0 && l.trim().indexOf('//') !== 0);
  if (!expBlock || !expLine) {
    fail('A-② service.js 的 module.exports 里没有**非注释**的 diagnoseColumns 导出（守卫/上层拿不到 ⇒ 判据存在但不可执行）');
  }
  if (!/const DIAG_REQUIRED/.test(src.svc)) fail('A-③ service.js 缺 DIAG_REQUIRED（必填列清单会散落成魔法字符串）');
  // ===== R434（队列 #44）：混装列 ≠ 缺列 —— 判「分支真在」，不判词出现过 =====
  //   为什么单独一段：R431 只在文案里加了「若挤在同一格请先分列」这句**兜底猜测**，
  //   它不区分场景 ⇒ 真缺列的老板也被劝去分列，混装列的老板也读不到"是哪一列挤着"。
  //   判据排除注释行：头注里本来就会写 mixed_goods_column 这个词（注释喂成恒真 = 假绿）。
  const svcActive = String(src.svc || '').split('\n').filter((l) => l.trim().indexOf('//') !== 0);
  if (!svcActive.some((l) => l.indexOf("reason = 'mixed_goods_column'") >= 0)) {
    fail('A-⑯ service.js 未把 mixed_goods_column 赋给 reason（混装列会退回「缺三列」的误导文案）');
  }
  if (!svcActive.some((l) => l.indexOf('const MIXED_GOODS_COLS') >= 0)) {
    fail('A-⑰ service.js 缺 MIXED_GOODS_COLS 列名清单（混装列判据会散落成魔法字符串）');
  }
}
if (src.idx) {
  // 通道：认不出分支必须是 ok({ diagnosis ... })
  if (!/diagnosis:\s*diagnoseColumns\(matrix\)/.test(src.idx)) {
    fail('A-④ index.js 认不出表时未走 ok 的 diagnosis 通道（fail 的 msg 会被 api.js:47 覆盖 ⇒ 老板看不见）');
  }
  // ⚠️ 顺序：`diagnoseColumns` 出现在**解构列表里**，即位于 `require('./service')` 之前（不是之后）。
  if (!/diagnoseColumns[\s\S]{0,800}require\('\.\/service'\)/.test(src.idx)) {
    fail('A-⑤ index.js 未从 ./service 引入 diagnoseColumns');
  }
  // 反向：认不出分支**不得**再 fail（留着就是老路复活）
  const block = (src.idx.match(/if \(!platform \|\| !pickSheet\([\s\S]{0,600}?\n  \}/) || [''])[0];
  if (block && /return fail\(/.test(block)) {
    fail('A-⑥ 认不出分支里仍保留 return fail（与 A-④ 的 ok 通道冲突 ⇒ 二选一，禁并存）');
  }
}
// 三处文案（漏页面 t:{} 那一处 = 静默空白，零报错）
const KEYS = ['importDiagTitle', 'importDiagBody', 'importDiagFound', 'importDiagExcluded', 'importDiagEmpty', 'importDiagMixed'];
if (src.terms && src.termsSpec) {
  for (const k of KEYS) {
    if (!hasActiveKey(src.terms, k)) fail(`A-⑦ miniprogram/i18n/terms.js 缺（或被注释）${k}`);
    if (!hasActiveKey(src.termsSpec, k)) fail(`A-⑧ specs/dev-specs/i18n/terms.js 缺（或被注释）${k}（双副本不同步）`);
  }
  if (src.terms !== src.termsSpec) fail('A-⑨ terms 双副本内容不一致（改后必须 cp + md5 校验）');
}
if (src.page) {
  for (const k of KEYS) {
    if (!hasActiveKey(src.page, k)) fail(`A-⑩ 页面 subpkg/biz/takeaway/index.js 未登记（或被注释）${k}（第三处缺失 ⇒ 渲染成空白且零报错）`);
  }
  // 🔴 必须匹配**分支头**而不是裸 `d.diagnosis`：变异回灌实测把 `if (d && d.diagnosis) {`
  //    改成 `if (false) {` 后，源码里 `const dg = d.diagnosis;` 仍在 ⇒ 裸子串判据**假绿**。
  //    判行为不判字面：要看的是「有没有这条分支」，不是「这个词出现过没有」。
  if (!/if\s*\(\s*d\s*&&\s*d\.diagnosis\s*\)\s*\{/.test(src.page)) {
    fail('A-⑪ 页面没有 d.diagnosis 处理分支（后端回了也没人显示 ⇒ 功能等于没做；判据看分支头，不认裸字面量）');
  }
  if (!/importDiagText:/.test(src.page)) fail('A-⑫ 页面未把 importDiagText 写进 setData（有分支不落 data ⇒ wxml 收不到）');
  if (!/importDiagText/.test(src.page)) fail('A-⑬ 页面 data/渲染缺 importDiagText 承载字段');
  // 🔴 R434：新文案必须**真接到分支里** —— 只加 key 不接线，老板看到的仍是"缺三列"。
  //   判据必须锚在分支内（`importDiagMixed` 出现在文件别处也不算），否则改回旧文案仍然绿。
  const pg = String(src.page || '');
  const iMix = pg.indexOf("dg.reason === 'mixed_goods_column'");
  if (iMix < 0) {
    fail('A-⑱ 页面没有 mixed_goods_column 分支（后端回了专因也没人用 ⇒ 仍是同一句「缺列」）');
  } else {
    const iUse = pg.indexOf('importDiagMixed', iMix);
    if (iUse < 0 || iUse - iMix > 400) {
      fail('A-⑲ mixed_goods_column 分支内没有引用 importDiagMixed（判据锚在分支内，不认全文出现）');
    }
  }
}
if (src.wxml) {
  if (!/importDiagText/.test(src.wxml)) fail('A-⑭ wxml 未渲染 importDiagText');
  // 诊断块必须**独立**于预览区（挂进 preview 的 wx:if 里 ⇒ 诊断态下永远不显示）
  const card = (src.wxml.match(/<view class="card2" wx:if="\{\{importDiagText\}\}">/) || [''])[0];
  if (!card) fail('A-⑮ wxml 缺独立的 importDiagText 卡片（必须自带 wx:if，不能挂在 preview 的 wx:if 里）');
}

// ===== B 行为面：真 require + 真跑（xlsx 走空桩，只为取纯函数）=====
let SVC = null;
let stubbed = false;
if (src.svc) {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  try { SVC = require(P.svc); stubbed = true; } catch (e) {
    fail('B-⓪ require service.js 失败：' + String((e && e.message) || e));
  } finally { Module._load = orig; }
}

if (SVC && typeof SVC.diagnoseColumns === 'function') {
  const M = (sheets) => ({ sheets });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // B-① 缺列：只给两列 ⇒ 报缺「销售额」（且 nearest 指向 C）
  const r1 = SVC.diagnoseColumns(M({ s1: { rows: [['商品名', '商品销量'], ['a', 3]] } }));
  if (r1.reason !== 'missing_cols') fail(`B-① 缺列场景 reason 应为 missing_cols，实为 ${r1.reason}`);
  if (!eq(r1.missing.C, ['销售额'])) fail(`B-① 缺列清单应为 ['销售额']，实为 ${JSON.stringify(r1.missing.C)}`);
  if (r1.nearest !== 'C') fail(`B-① nearest 应为 C（外卖销量表是本页目标形态），实为 ${r1.nearest}`);

  // B-② 别名：美团「商品名/商品销量/商品销售额」⇒ 归一下一列为不缺（判得出就必须取得到）
  const r2 = SVC.diagnoseColumns(M({ s1: { rows: [['商品名', '商品销量', '商品销售额'], ['a', 3, 30]] } }));
  if (r2.missing.C.length !== 0) fail(`B-② 别名表应识别为不缺列，实为缺 ${JSON.stringify(r2.missing.C)}`);

  // B-③ 自洽：列齐**不得**报缺列（否则老板照着回执去补不存在的列）
  if (r2.missing.C.length === 0 && r2.reason === 'missing_cols') {
    fail('B-③ 自洽性破坏：三列齐却 reason=missing_cols（缺列清单为空 ⇒ 必须归因为 cols_ok_but_excluded/empty_table）');
  }
  if (r2.reason !== 'cols_ok_but_excluded') fail(`B-③ 列齐场景 reason 应为 cols_ok_but_excluded，实为 ${r2.reason}`);

  // B-④ 负向条件：含「费用类型」⇒ 这是订单/结算账单（已暂停），必须指名原因
  const r3 = SVC.diagnoseColumns(M({ s1: { rows: [['商品名称', '销量', '销售额', '费用类型'], ['a', 3, 30, 'x']] } }));
  if (r3.excludedBy !== '费用类型') fail(`B-④ 含费用类型的表应 excludedBy='费用类型'，实为 '${r3.excludedBy}'`);

  // B-⑤ 空表：不猜表头，reason=empty_table
  const r4 = SVC.diagnoseColumns(M({}));
  if (r4.reason !== 'empty_table') fail(`B-⑤ 空表 reason 应为 empty_table，实为 ${r4.reason}`);
  if (r4.headerRow !== -1) fail(`B-⑤ 空表 headerRow 应为 -1（不猜），实为 ${r4.headerRow}`);

  // B-⑥ 回显上限：一张 60 列的宽表不得把回执撑爆
  const wide = [];
  for (let i = 0; i < 60; i++) wide.push('c' + i);
  const r5 = SVC.diagnoseColumns(M({ s1: { rows: [wide] } }));
  const cap = typeof SVC.DIAG_MAX_COLS === 'number' ? SVC.DIAG_MAX_COLS : 30;
  if (r5.foundCols.length > cap) fail(`B-⑥ foundCols ${r5.foundCols.length} 条 > 上限 ${cap}（宽表会把回执撑爆）`);

  // B-⑦ 幂等：同一输入两次调用结果必须一致（回执不能每次都不一样）
  if (JSON.stringify(SVC.diagnoseColumns(M({ s1: { rows: [['商品名', '商品销量']] } }))) !==
      JSON.stringify(SVC.diagnoseColumns(M({ s1: { rows: [['商品名', '商品销量']] } })))) {
    fail('B-⑦ 同一输入两次诊断结果不一致（非幂等 ⇒ 老板刷新一次看到的说法就变了）');
  }

  // ===== R434（队列 #44）：混装列 vs 真缺列，行为面各判一条 =====
  // B-⑨ 混装列：有「商品信息」但没有京东签名（顾客实付/订单编号）⇒ 专因，且**指名**是哪一列
  const r6 = SVC.diagnoseColumns(M({ s1: { rows: [['商品信息', '实付金额'], ['耙牛肉,38,2/米饭,2,1', 76]] } }));
  if (r6.reason !== 'mixed_goods_column') fail(`B-⑨ 商品混装列 reason 应为 mixed_goods_column，实为 ${r6.reason}`);
  if (r6.mixedCol !== '商品信息') fail(`B-⑨ mixedCol 应指名 '商品信息'，实为 '${r6.mixedCol}'`);

  // B-⑩ 真缺列**不得**报混装列（否则把该去补列的人引去分列一张结构正常的表）
  if (r1.reason === 'mixed_goods_column' || r1.mixedCol) {
    fail(`B-⑩ 真缺列被误判成混装列（reason=${r1.reason} mixedCol='${r1.mixedCol}'）`);
  }

  // B-⑪ 精确等名：`商品编号`/`商品条码` 含「商品」二字，但它们是**正常列**，不是混装列
  const r7 = SVC.diagnoseColumns(M({ s1: { rows: [['商品编号', '商品条码', '商品销量'], ['a', 'b', 1]] } }));
  if (r7.mixedCol) fail(`B-⑪ 子串误判：商品编号/商品条码 被当成混装列（mixedCol='${r7.mixedCol}'）`);
  if (r7.reason !== 'missing_cols') fail(`B-⑪ 该场景 reason 应为 missing_cols，实为 ${r7.reason}`);

  // B-⑫ 优先级：列齐但被负向条件挡 ⇒ 仍报排除原因，不报混装列
  //   （把人引去"给一张本就不该导的表分列"，比不说更坏）
  const r8 = SVC.diagnoseColumns(M({ s1: { rows: [['商品名称', '销量', '销售额', '费用类型', '商品信息'], ['a', 3, 30, 'x', 'y']] } }));
  if (r8.reason !== 'cols_ok_but_excluded') fail(`B-⑫ 列齐场景应保持 cols_ok_but_excluded，实为 ${r8.reason}`);
} else {
  fail('B-⑧ 拿不到 diagnoseColumns 函数 ⇒ 行为面无法验证（不许静默跳过）');
}

// ===== C 自失效护栏：源文件一个都没扫到 ⇒ 判红 =====
if (scanned === 0) {
  fail('C-① 六个源文件全部读不到 ⇒ 本守卫扫空恒绿（假绿），请检查路径');
}

if (warns.length) warns.forEach((m) => console.log('⚠️ [import-diagnosis] ' + m));

if (problems.length) {
  console.log('❌ 导入诊断守卫失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  process.exit(1);
}
console.log(`✅ 导入诊断守卫通过（A 通道+三处文案 / B 行为 ${stubbed ? 'xlsx 空桩' : '直连'} 7 例 / C 扫空护栏，已探 ${scanned} 个源文件）`);
console.log('导入诊断守卫结果：1 通过 / 0 失败');
