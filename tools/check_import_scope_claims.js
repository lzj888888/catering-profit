// tools/check_import_scope_claims.js —— 【R303】导入「承诺面 + 平台范围 + 一级校验」守卫
// 运行：node tools/check_import_scope_claims.js      （EXIT 0 = 全绿）
//
// 背景（R300 §5.5 定案）：李老师 2026-10-17 口供「**京东、美团提供的表不准确**」，且现在**拿不到**了；
//   外部调研亦证：老板只在平台 App 看汇总，极少下载表格对账。
//   ⇒ 三件事：① picker **只列有真实准确样本证据的平台**；② **撤回**对"美团外卖"的确定性承诺；
//   ③ 加**一级校验**（零外部依赖：表内自洽的错，导之前就报）。
//
// 🔴 本守卫要防的**真危害**是「静默错账」：对一个**已知不准**的平台做确定性承诺
//   ⇒ 老板导进来、毛利榜照常出数并显示得很确定。**警示不足以防范，所以连"承诺"都要收掉**。
//
// 判据（四组）：
//   ① 平台范围：picker 只含"已验"清单；**历史显示名键必须全留**（否则历史榜单漏机器值，R271 老坑）
//   ② 承诺面：未验平台名**不得**出现在两段引导文案里（真值从 terms 单源取，不硬编码中文）
//   ③ 一级校验：模块存在 + 四条行为真跑（跨月 / 均价异常 / 全 0 金额 / 无日期）+ **合法表零假红**
//   ④ 反恒真与自失效护栏
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); }
}
function rd(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } }

const pageSrc = rd('subpkg/biz/takeaway/index.js');
const sanitySrc = rd('utils/importSanity.js');
const TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
const TK = TERMS.ledger.takeaway;

ok('⓪ 自失效护栏：三份源码非空且关键锚点在场（防读空文件 ⇒ 恒真）',
  pageSrc.length > 20000 && sanitySrc.length > 1500
  && /IMPORT_PLATFORM_OPTIONS/.test(pageSrc) && /function checkImportShape/.test(sanitySrc));

// ===== ① 平台范围 =====
const PICKER_OK = ['taobao', 'other'];   // 已验（淘宝闪购有实测样本）+ 兜底（保住 Excel 自救路径）
const m = pageSrc.match(/const IMPORT_PLATFORM_OPTIONS = \[([^\]]*)\]/);
const pickerVals = m ? m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter((s) => !!s) : [];
ok('①-a 🔴 picker **只列已验平台**（' + PICKER_OK.join(' / ') + '）—— 军规「先补验再窄范围承诺」：'
  + '列在 picker 里＝我们承诺他能导',
  m !== null && pickerVals.length === PICKER_OK.length
  && pickerVals.every((v) => PICKER_OK.indexOf(v) >= 0),
  pickerVals.length ? '实为 [' + pickerVals.join(', ') + ']' : '解析失败');
ok('①-b 🔴 `other` 必须在 picker 里 —— 导入区已明文承诺「自己用 Excel 列 3 列一样能导入」，'
  + '删了它等于**打断这条不依赖任何平台的自救路径**',
  pickerVals.indexOf('other') >= 0
  && /自己用 Excel 列这 3 列/.test(String(TK.importColsBody || '')));
const names = TERMS.card.reviewPlatformNames || {};
ok('①-c 🔴 历史平台显示名键**一个都不能少**（meituan/eleme/jd_order/jd_sku/taobao/other）'
  + ' —— 已落库的历史数据显示名靠它，删了会让历史榜单**漏出机器值**（R271 老坑）',
  ['taobao', 'meituan', 'eleme', 'jd_order', 'jd_sku', 'other'].every((k) => !!names[k]),
  Object.keys(names).length + ' 键');

// ===== ② 承诺面 =====
// 真值从 terms 单源取（**不硬编码中文**）。
// 🔴 判据必须**收窄到"外卖语境"**：首版查"名字出现即红" ⇒ 把 `美团收银`（**堂食 POS 产品名**，
//   在 `importWhereBody` 里是**合法**引用）也判红了 —— 假红。⇒ 改为「平台名与"外卖"**邻近**」才判红，
//   这正好命中要撤回的那两种写法（`美团外卖：找…` / `（美团外卖、淘宝闪购等）`），而不误伤 POS 产品名。
const UNVERIFIED = ['meituan', 'eleme', 'jd_sku', 'jd_order'];
const unverifiedNames = UNVERIFIED.map((k) => names[k]).filter((v) => !!v);
const claims = [String(TK.importPickHint || ''), String(TK.importWhereBody || '')].join('\n');
const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEAR_TAKEAWAY = (name) => new RegExp(ESC(name) + '\\s*外卖|外卖[^。；]{0,8}' + ESC(name));
const leaked = unverifiedNames.filter((n) => NEAR_TAKEAWAY(n).test(claims));
ok('②-a 🔴 未验平台名**不得与"外卖"邻近**地出现在导入引导文案里'
  + '（对已知不准的平台做确定性承诺 ＝ 静默错账的入口）—— 真值取自 terms 单源，非硬编码；'
  + '⚠️ 判据必须限定"外卖语境"：`美团收银` 是堂食 POS 产品名，是合法引用（首版判据在此假红过）',
  leaked.length === 0 && unverifiedNames.length >= 3,
  leaked.length ? '泄漏：' + leaked.join(' / ') : unverifiedNames.length + ' 个未验平台名均不在外卖语境出现');
ok('②-b 有原生样本证据的入口名必须**保留**（堂食《菜品销售统计》/ 淘宝闪购「商品下载」）',
  /菜品销售统计/.test(claims) && /商品下载/.test(claims));

// ===== ③ 一级校验（行为真跑）=====
let S = null;
try { S = require(path.join(ROOT, 'utils/importSanity.js')); } catch (e) { S = null; }
ok('③-a 模块可 require 且导出 checkImportShape / coveredDates',
  !!S && typeof S.checkImportShape === 'function' && typeof S.coveredDates === 'function');
const codes = (r) => r.map((x) => x.code).sort().join(',');
const rCross = S ? S.checkImportShape({ groupDates: ['2026-09-28', '2026-10-01'], totalQty: 51, totalAmountFen: 182300 }) : [];
const rOdd = S ? S.checkImportShape({ groupDates: ['2026-10-01'], totalQty: 355, totalAmountFen: 5100 }) : [];
const rZero = S ? S.checkImportShape({ groupDates: ['2026-10-01'], totalQty: 5, totalAmountFen: 0 }) : [];
const rNone = S ? S.checkImportShape({ groupDates: [], totalQty: 0, totalAmountFen: 0 }) : [];
const rGood = S ? S.checkImportShape({ groupDates: ['2026-10-01', '2026-10-02'], totalQty: 20, totalAmountFen: 60000 }) : null;
ok('③-b 行为：跨月 → `crossMonth`；均价异常（355 份 / ¥51 ⇒ 0.14 元）→ `oddAvgPrice`',
  codes(rCross) === 'crossMonth' && codes(rOdd) === 'oddAvgPrice',
  '跨月=' + codes(rCross) + ' 量级=' + codes(rOdd));
ok('③-c 行为：有销量但金额全 0 → `zeroTotal`；无日期 → `noDays`',
  codes(rZero) === 'zeroTotal' && codes(rNone) === 'noDays',
  '全0=' + codes(rZero) + ' 无日期=' + codes(rNone));
ok('③-d 🔴 行为：**合法表必须零假红**（整月正常数据 ⇒ 空数组）—— 假红会训练老板忽略提示',
  !!rGood && rGood.length === 0, rGood ? rGood.length + ' 条' : '未跑');
ok('③-e 🔴 **故意不做**「只覆盖 N 天不是整月」—— 导入是**按日**落库的，导一段本就合法；'
  + '这件事该在**复盘时**讲（R301 已用 `range.days` + 期间标注做掉）',
  !/partialPeriod|offMonth/.test(sanitySrc) && /故意不做/.test(sanitySrc));
ok('③-f 结论落到页面且**空串不渲染**（不假报"一切正常"）',
  /importSanityText: sanityText/.test(pageSrc) && /buildSanityText/.test(pageSrc)
  && /if \(!list\.length\) return ''/.test(pageSrc)
  && /importSanityText\}\}/.test(rd('subpkg/biz/takeaway/index.wxml')));

// ===== ④ 反恒真 =====
ok('④-a 反恒真：把「平台名与外卖邻近」的**旧文案**喂给 ②-a 的判据 ⇒ 必须判红；真文案必须判绿'
  + '（正负互证用同一段逻辑）',
  unverifiedNames.length > 0
  && leaked.length === 0
  && unverifiedNames.every((n) => NEAR_TAKEAWAY(n).test('（' + n + '外卖、淘宝闪购等）') && NEAR_TAKEAWAY(n).test(n + '外卖：找带商品名、销量、销售额的销量报表。')));
ok('④-a2 反恒真：`美团收银` 这类**堂食 POS 产品名**不得被判红（判据收窄的正面自证）',
  unverifiedNames.every((n) => !NEAR_TAKEAWAY(n).test('堂食：进收银系统后台（' + n + '收银／银豹／客如云等）')));
ok('④-b 反恒真：把「5 项旧 picker」喂给 ①-a 的判据 ⇒ 必须判不通过',
  !(['meituan', 'eleme', 'taobao', 'jd_sku', 'other'].length === PICKER_OK.length
    && ['meituan', 'eleme', 'taobao', 'jd_sku', 'other'].every((v) => PICKER_OK.indexOf(v) >= 0)));

const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 导入承诺面/范围/一级校验 校验失败 ' + problems.length + ' 处：');
  problems.forEach((x) => console.log('   ' + x));
  console.log('❌ 导入范围校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 导入承诺面/平台范围/一级校验 校验通过（picker [' + pickerVals.join(', ') + '] · 未验平台名零泄漏）');
console.log('✅ 导入范围校验：' + total + ' 通过 / 0 失败');
