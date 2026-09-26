// tools/check_unit_family.js —— R151：单位池 / 计量族 / 单价单位守卫
//
// 起因（李老师 2026-09-26 真机反馈三问 + 参考产品键鼠实测）：
//   ① 「换算系数一定是 g 吗？应该也是可选择吧」
//   ② 「采购单位和用量单位那里不是应该带下拉箭头自由选择吗？」
//   ③ 「临时手工录入那里 单价还是元/克，这个不是可以选择吗？」
//
// 事故模型（本轮要防的**形态缺陷**）：
//   F1 **单位池漂移**：用量单位池与采购单位池是两份手写清单 ⇒ 一边加了「斤/两」，另一边没加，
//      老板「按斤买、按斤用」时**选不出来**（改前就是 4 项 vs 13 项）。
//   F2 **族表缺失 ⇒ 静默兜底**：某单位不在 UNIT_FAMILY 里，`familyOf` 兜底返回 weight
//      ⇒ 选「箱」当用量单位时被当重量单位算，成本错得无声无息。
//   F3 **基准词写死**：换算系数标签恒为「→克」⇒ 按「个/箱」采购的老板看到的字面量没有对应含义。
//   F4 **单价单位不折算**：手工行单价恒读作「元/克」⇒ 老板填「6」（元/斤）会被算成 6 元/克，
//      成本**差 500 倍**，而界面完全正常。
//   F5 **跨族无提示**：采购「个」× 用量「千克」按 1:1 硬算 —— 这不是假想，参考产品实测就是
//      界面直接跳出 ¥6,000,000.00 且**一个字都不提示**。
//
// round152 追加（李老师扫 R151 码真机实测反馈，同一形态病）：
//   F6 **chips 常驻展开**：R151 把池从 4 项扩到 14 项 ⇒ chips 由 1 行涨到 2~3 行，把下方
//      「换算系数 / 出成率」顶下去（扩池带出来的**自伤回归**）。
//   F7 **选完不收起**：选了单位还要再点一次 ▾（多余的一步）。
//   F8 **手改值被冲掉**：手改 480 → 再点单位「斤」⇒ 被建议值 500 覆盖，表现为"改了存不住"。
//   F9 **缺可改信号**：「可再手改」写在采购单位那行的 hint 里，离换算系数太远 ⇒ 没人看见。
//
// 判据（纯函数化 + 正负互证 + 反查真实单源 + 解析器自带钉死样本）：
//   L1 单源在场：units.js 导出 UNIT_FAMILY/FAMILY_BASE_WORD/familyOf/baseWordOf/isCrossFamily/priceToBase
//   L2 行为正确（require 真源码实跑，不比字面量副本）：族判定 / 基准词 / 跨族真值表 / 单价折算
//   L3 单源自洽：两池逐项同源、倍率表全覆盖、族表全覆盖、重量族倍率自洽
//   L4 落点：页面用单源、不自抄口径（反查写死「克」与旧折算写法）；
//      ⑩~⑬ 为 round152 追加（chips 默认收起 / 选完自动收起 / 手改保护 / 可手改可见信号）
//   S1~S2 自失效护栏（扫描面完整 / 命中数下界，防"扫了空集所以全绿"）
//   C1~C12 反恒真：把坏样本喂给同一条判据 ⇒ 必须判红；好样本 ⇒ 判绿
//
// ⚠️ 输出纪律（R145 教训）：中间行不得出现「N 通过 / M 失败」字样，
//   否则 check_suite_assert_counts 会把第一条中间文案当成套件总口径。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass++; };
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}
// 取具名函数的函数体（花括号配平；找不到返回 null）。解析器自带钉死样本见 C6。
function fnBody(src, name) {
  if (!src) return null;
  const re = new RegExp('(?:^|[\\s,{])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length - 1;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

// ===================== 判据（纯函数，可被反恒真样本直接调用） =====================
// 判据 F1：两个单位池是否逐项同源
function judgePoolParity(qty, pur) {
  if (!Array.isArray(qty) || !Array.isArray(pur)) return { ok: false, why: '单位池不是数组（fail-closed）' };
  if (qty.length !== pur.length) return { ok: false, why: '两池长度不等：用量 ' + qty.length + ' / 采购 ' + pur.length };
  const diff = qty.filter((u, i) => u !== pur[i]);
  if (diff.length) return { ok: false, why: '两池逐项不等：' + diff.slice(0, 4).join(' / ') };
  return { ok: true, why: '两池逐项一致（' + qty.length + ' 项）' };
}
// 判据 F2：某张表是否覆盖了单位池的每一项
function judgeCoverage(list, table, label) {
  if (!Array.isArray(list) || !table || typeof table !== 'object') return { ok: false, why: label + ' 单源缺失（fail-closed）' };
  const miss = list.filter((u) => !(u in table));
  if (miss.length) return { ok: false, why: label + ' 缺 ' + miss.join(' / ') + ' ⇒ 这些单位会静默走兜底值' };
  return { ok: true, why: label + ' 覆盖全部 ' + list.length + ' 项' };
}
// 判据 F3：spec_line 的基准单位词是否来自单源（而不是写死的「克」）
function judgeSpecLineBaseWord(src) {
  if (!src) return { ok: false, why: '源码读不到（fail-closed）' };
  const lines = src.split(/\r?\n/).filter((l) => /spec_line\s*:/.test(l) && !/^\s*\/\//.test(l));
  if (!lines.length) return { ok: false, why: '找不到 spec_line 定义（判据面被写窄）' };
  if (!lines.some((l) => /baseWordOf\s*\(/.test(l))) {
    return { ok: false, why: 'spec_line 的基准单位词不来自 units.baseWordOf ⇒ 页面自写了一份口径' };
  }
  const literal = lines.find((l) => /['"]\s*克\s*['"]/.test(l));
  if (literal) return { ok: false, why: '行内仍写死「克」字面量（自抄口径）', line: literal.trim().slice(0, 90) };
  return { ok: true, why: '基准单位词来自 units.baseWordOf，无写死「克」' };
}
// 判据 F4：手工行单价是否先折算到基准单位
function judgePriceBase(body) {
  if (!body) return { ok: false, why: '函数体解析不到（fail-closed）' };
  if (!/priceToBase\s*\(/.test(body)) {
    return { ok: false, why: '没有走 units.priceToBase ⇒ 非「元/克」的单价会被当成元/克，成本差倍率' };
  }
  if (/Number\s*\(\s*unitPriceYuan\s*\)/.test(body)) {
    return { ok: false, why: '仍在直接 Number(unitPriceYuan) 当元/克（绕过了折算）' };
  }
  return { ok: true, why: '单价先折算到基准单位再进公式' };
}
// 判据 F5：跨族判据是否取自单源
function judgeCrossWarn(body) {
  if (!body) return { ok: false, why: '函数体解析不到（fail-closed）' };
  if (!/isCrossFamily\s*\(/.test(body)) {
    return { ok: false, why: '跨族判据没走 units.isCrossFamily ⇒ 页面自写族表会与单源漂移' };
  }
  return { ok: true, why: '跨族判据取自单源 units.isCrossFamily' };
}

// ---- round152 追加：单位 chips 收放 + 换算系数手改（李老师真机实测反馈） ----
// 事故模型：
//   F6 **chips 常驻展开**：round151 把池从 4 项扩到 14 项 ⇒ chips 由 1 行涨到 2~3 行，
//      把下方「换算系数 / 出成率」顶下去，老板以为换算系数是系统算出的死值。
//   F7 **选完不收起**：选了单位还要再点一次 ▾ 才收起（多余的一步）。
//   F8 **手改值被冲掉**：手改换算系数 480 → 再点单位「斤」 ⇒ 被建议值 500 覆盖，
//      表现为"改了存不住"（与「不许静默改掉老板敲的数」同一条纪律）。
//   F9 **缺可改信号**：「可再手改」写在采购单位那行的 hint 里，离换算系数太远 ⇒ 没人看见。

// 判据 F6：chips 默认是否收起
function judgeChipsDefault(src) {
  if (!src) return { ok: false, why: '取不到原料档案页源码（fail-closed）' };
  if (/unitChipsOpen\s*:\s*true/.test(src)) return { ok: false, why: '出现 unitChipsOpen: true ⇒ 14 项 chips 会展开占屏' };
  if (!/unitChipsOpen\s*:\s*false/.test(src)) return { ok: false, why: '找不到 unitChipsOpen 初始化（字段被删）' };
  return { ok: true, why: 'chips 默认收起（不占屏，▾ 可随时展开）' };
}

// 判据 F7：选完单位是否自动收起
function judgePickUnitCollapse(body) {
  if (!body) return { ok: false, why: '取不到 pickUnit 函数体（fail-closed）' };
  if (!/unitChipsOpen\s*:\s*false/.test(body)) return { ok: false, why: 'pickUnit 选完不收起 chips（要用户再点一次 ▾）' };
  return { ok: true, why: 'pickUnit 选完自动收起 chips' };
}

// 判据 F8：手改过的换算系数会不会被建议值冲掉
function judgeConvertTouched(body) {
  if (!body) return { ok: false, why: '取不到 pickUnit 函数体（fail-closed）' };
  const lines = body.split('\n');
  const assign = lines.filter((l) => /convert_factor\s*=/.test(l));
  if (!assign.length) return { ok: false, why: 'pickUnit 里没有 convert_factor 赋值（建议系数带不出来）' };
  const unguarded = assign.filter((l) => !/convertTouched/.test(l));
  if (unguarded.length) return { ok: false, why: 'convert_factor 赋值未受 convertTouched 保护 ⇒ 手改值会被建议值冲掉' };
  return { ok: true, why: '手改保护在位（convertTouched 守着 convert_factor 赋值）' };
}

// 判据 F9：换算系数那行有没有「可手改」的可见信号
function judgeConvertHintEditable(src) {
  if (!src) return { ok: false, why: '取不到术语表（fail-closed）' };
  const m = /matConvertHintOf\s*:\s*\([^)]*\)\s*=>\s*`([^`]*)`/.exec(src);
  if (!m) return { ok: false, why: '取不到 matConvertHintOf 模板（fail-closed）' };
  if (!/手改/.test(m[1])) return { ok: false, why: '换算系数提示缺「可手改」信号 ⇒ 老板以为那是系统死值' };
  return { ok: true, why: '换算系数提示带「可手改」可见信号' };
}

// 本轮受管源码
const UNITS_SRC = read('utils/units.js') || '';
const CARDJS = read('pages/card/edit.js') || '';
const CARDWXML = read('pages/card/edit.wxml') || '';
const MATEJS = read('pages/material/edit.js') || '';
const MATEWXML = read('pages/material/edit.wxml') || '';
const MATIDX = read('pages/material/index.js') || '';
const TERMS_A = read('miniprogram/i18n/terms.js') || '';
const TERMS_B = read('specs/dev-specs/i18n/terms.js') || '';

console.log('===== R151/R152 · 单位池 / 计量族 / 单价单位 / chips 收放与手改 守卫 =====');

// ---------- L1 单源在场 ----------
const L1_NEED = ['UNIT_FAMILY', 'FAMILY_BASE_WORD', 'familyOf', 'baseWordOf', 'isCrossFamily', 'priceToBase'];
if (!UNITS_SRC) {
  bad('L1 utils/units.js 不存在（单位口径没有单源）');
} else {
  const exportsLine = (UNITS_SRC.match(/module\.exports\s*=\s*\{[\s\S]*?\}/) || [''])[0];
  const missing = L1_NEED.filter((k) => exportsLine.indexOf(k) < 0);
  if (missing.length) bad('L1 utils/units.js 缺导出：' + missing.join(' / '));
  else ok('L1 计量族单源导出齐全（' + L1_NEED.length + ' 个符号）');
}

let U = null;
let reqErr = '';
try { U = require(path.join(ROOT, 'utils/units.js')); } catch (e) { U = null; reqErr = (e && e.message) || String(e); }
if (!U) {
  bad('L1 utils/units.js require 失败（fail-closed）：' + reqErr);
} else {
  const words = U.FAMILY_BASE_WORD || {};
  const need = ['weight', 'volume', 'count'];
  const missW = need.filter((k) => typeof words[k] !== 'string' || !words[k]);
  if (missW.length) bad('L1 三族基准词缺失：' + missW.join(' / '));
  else ok('L1 三族基准词齐备（' + need.map((k) => k + '→' + words[k]).join('，') + '）');
}

// ---------- L2 行为正确（实跑真源码） ----------
if (!U) {
  bad('L2 行为判据无法执行：units.js 未加载（fail-closed）');
  bad('L2 折算判据无法执行：units.js 未加载（fail-closed）');
} else {
  const fam = [
    ['斤', 'weight'], ['两', 'weight'], ['千克', 'weight'], ['克', 'weight'], ['公斤', 'weight'],
    ['毫升', 'volume'], ['升', 'volume'],
    ['个', 'count'], ['箱', 'count'], ['瓶', 'count'],
    ['打（未知单位兜底 weight）', 'weight'],
    ['', 'weight'],
  ];
  const badFam = fam.filter((c) => U.familyOf(c[0]) !== c[1]);
  if (badFam.length) bad('L2 familyOf 判定不符：' + badFam.map((c) => c[0] + ' 期望' + c[1] + ' 实际' + U.familyOf(c[0])).join('；'));
  else ok('L2 familyOf 判定正确（' + fam.length + ' 例含未知单位兜底）');

  const bw = [['斤', '克'], ['升', '毫升'], ['个', '个'], ['箱', '个']];
  const badBw = bw.filter((c) => U.baseWordOf(c[0]) !== c[1]);
  if (badBw.length) bad('L2 baseWordOf 不符：' + badBw.map((c) => c[0] + ' 期望' + c[1] + ' 实际' + U.baseWordOf(c[0])).join('；'));
  else ok('L2 baseWordOf 三族返回正确词（' + bw.length + ' 例）');

  // 跨族真值表：**重量↔体积不算跨族**（既有 1 毫升≈1 克口径，水油通用）—— 这条判错会把正常用法报成警告
  const cross = [
    ['个', '千克', true], ['箱', '克', true], ['斤', '个', true], ['个', '箱', false],
    ['斤', '克', false], ['克', '千克', false], ['升', '毫升', false], ['升', '克', false],
  ];
  const badCross = cross.filter((c) => U.isCrossFamily(c[0], c[1]) !== c[2]);
  if (badCross.length) bad('L2 isCrossFamily 真值表不符：' + badCross.map((c) => c[0] + '×' + c[1] + ' 期望' + c[2] + ' 实际' + U.isCrossFamily(c[0], c[1])).join('；'));
  else ok('L2 isCrossFamily 真值表正确（' + cross.length + ' 例，重量↔体积不计跨族）');

  const pb = [
    ['6 元/斤 → 元/克', U.priceToBase('6', '斤'), 0.012],
    ['60 元/千克 → 元/克', U.priceToBase('60', '千克'), 0.06],
    ['1.2 元/个 → 元/个', U.priceToBase('1.2', '个'), 1.2],
    ['0 → 0', U.priceToBase('0', '斤'), 0],
    ['负数 → 0（不产负成本）', U.priceToBase('-3', '斤'), 0],
    ['空值 → 0', U.priceToBase('', '斤'), 0],
  ];
  const badPb = pb.filter((c) => Math.abs(c[1] - c[2]) > 1e-12);
  if (badPb.length) bad('L2 priceToBase 折算不符：' + badPb.map((c) => c[0] + ' 期望' + c[2] + ' 实际' + c[1]).join('；'));
  else ok('L2 priceToBase 折算正确（' + pb.length + ' 例含零/负/空值）');
}

// ---------- L3 单源自洽 ----------
if (U) {
  const r1 = judgePoolParity(U.QTY_UNITS, U.PURCHASE_UNITS);
  if (r1.ok) ok('L3 ' + r1.why + '（用量池 ≡ 采购池，构造上不可能漂移）');
  else bad('L3 单位池漂移 —— ' + r1.why);

  const r2 = judgeCoverage(U.QTY_UNITS, U.QTY_FACTOR, '倍率表 QTY_FACTOR');
  if (r2.ok) ok('L3 ' + r2.why);
  else bad('L3 ' + r2.why);

  const r3 = judgeCoverage(U.QTY_UNITS, U.UNIT_FAMILY, '族表 UNIT_FAMILY');
  if (r3.ok) ok('L3 ' + r3.why);
  else bad('L3 ' + r3.why);

  const wf = [['斤', 500], ['两', 50], ['千克', 1000], ['公斤', 1000], ['克', 1], ['毫升', 1], ['升', 1000]];
  const badWf = wf.filter((c) => U.QTY_FACTOR[c[0]] !== c[1]);
  if (badWf.length) bad('L3 重量/体积族倍率不符：' + badWf.map((c) => c[0] + ' 期望' + c[1] + ' 实际' + U.QTY_FACTOR[c[0]]).join('；'));
  else ok('L3 重量/体积族倍率自洽（' + wf.length + ' 例：斤500 两50）');
} else {
  bad('L3 单源自洽判据无法执行：units.js 未加载（fail-closed）');
  bad('L3 倍率表覆盖判据无法执行：units.js 未加载（fail-closed）');
  bad('L3 族表覆盖判据无法执行：units.js 未加载（fail-closed）');
  bad('L3 族倍率判据无法执行：units.js 未加载（fail-closed）');
}

// ---------- L4 落点（页面用单源、不自抄口径） ----------
// ① 原料档案页：换算系数标签的基准词来自 units.baseWordOf
if (!/baseWordOf\s*\(/.test(MATEJS)) bad('L4 原料档案页未用 units.baseWordOf（换算系数标签的基准词仍是写死的）');
else if (!/matConvertOf\s*\(/.test(MATEJS)) bad('L4 原料档案页没有调 TERMS.card.matConvertOf（标签不会随单位变）');
else ok('L4 原料档案页换算系数基准词取自单源（baseWordOf + matConvertOf）');

// ② 原料档案页 wxml 用动态标签
if (!/convertLabel/.test(MATEWXML)) bad('L4 原料档案页 wxml 未使用动态 convertLabel（标签写死）');
else ok('L4 原料档案页 wxml 使用动态换算系数标签');

// ③ 原料列表页 spec_line 的基准词（纯函数判据，反恒真样本见 C1/C2）
const rSl = judgeSpecLineBaseWord(MATIDX);
if (rSl.ok) ok('L4 原料列表页 spec_line —— ' + rSl.why);
else bad('L4 原料列表页 spec_line —— ' + rSl.why + (rSl.line ? '（' + rSl.line + '）' : ''));

// ④ 手工行单价折算（纯函数判据，反恒真样本见 C4）
const rPb = judgePriceBase(fnBody(CARDJS, 'manualNetUnitWan'));
if (rPb.ok) ok('L4 手工行净料成本 —— ' + rPb.why);
else bad('L4 手工行净料成本 —— ' + rPb.why);

// ⑤ 手工行单价单位（字段 + handler + 枚举）
if (!/price_unit/.test(CARDJS)) bad('L4 手工行没有 price_unit 字段（单价单位无处落）');
else if (!/onManualPriceUnit\s*\(/.test(CARDJS)) bad('L4 手工行没有 onManualPriceUnit（单价单位改了不落数据）');
else if (!/priceUnits\s*:\s*units\.QTY_UNITS/.test(CARDJS)) bad('L4 单价单位枚举未取自 units.QTY_UNITS（页面自抄枚举）');
else ok('L4 手工行单价单位齐备（price_unit + onManualPriceUnit + 枚举取自单源）');

// ⑥ 手工行 wxml 单价单位 picker
if (!/bindchange="onManualPriceUnit"/.test(CARDWXML)) bad('L4 手工行 wxml 没有单价单位 picker');
else ok('L4 手工行 wxml 有单价单位 picker（可自由选 元/斤、元/个…）');

// ⑦ 跨族提示判据取自单源（纯函数判据，反恒真样本见 C5）
const rCw = judgeCrossWarn(fnBody(CARDJS, 'unitWarnOf'));
if (rCw.ok) ok('L4 ' + rCw.why);
else bad('L4 ' + rCw.why);

// ⑧ 跨族提示落到界面
if (!/unit_warn/.test(CARDWXML)) bad('L4 wxml 没有 unit_warn 占位（提示算出来也没处显示）');
else if (!/unitWarnOf\s*\(/.test(CARDJS)) bad('L4 unitWarnOf 定义了但没人调用（提示永远出不来）');
else ok('L4 跨族提示落到界面（unit_warn 占位 + unitWarnOf 调用齐备）');

// ⑨ 文案层不再写死「→克」，且动态标签函数在位
if (/matConvert\s*:\s*'换算系数（→克）'/.test(TERMS_A)) bad('L4 术语表 matConvert 仍写死「（→克）」');
else if (!/matConvertOf\s*:/.test(TERMS_A)) bad('L4 术语表缺 matConvertOf（动态标签函数）');
else if (!/matConvertHintOf\s*:\s*\(\s*u\s*,\s*f\s*,\s*w\s*\)/.test(TERMS_A)) bad('L4 matConvertHintOf 未接第三参 w（基准词进不去）');
else if (!/unitCrossWarn\s*:/.test(TERMS_A)) bad('L4 术语表缺 unitCrossWarn（跨族提示文案）');
else ok('L4 术语表口径已中性化（matConvert + matConvertOf + matConvertHintOf(u,f,w) + unitCrossWarn）');

// ⑩ chips 默认收起（round152：R151 扩池到 14 项后的占屏回归，反恒真样本见 C7）
const rCd = judgeChipsDefault(MATEJS);
if (rCd.ok) ok('L4 ' + rCd.why); else bad('L4 ' + rCd.why);

// ⑪ 选完单位自动收起（反恒真样本见 C8）
const PU_BODY = fnBody(MATEJS, 'pickUnit');
const rPu = judgePickUnitCollapse(PU_BODY);
if (rPu.ok) ok('L4 ' + rPu.why); else bad('L4 ' + rPu.why);

// ⑫ 换算系数手改保护（反恒真样本见 C9/C10）
const rCt = judgeConvertTouched(PU_BODY);
if (rCt.ok) ok('L4 ' + rCt.why); else bad('L4 ' + rCt.why);

// ⑬ 换算系数「可手改」可见信号 —— 术语**双副本**都要有（只改一份 ⇒ 一边绿一边红）
const rHeA = judgeConvertHintEditable(TERMS_A);
const rHeB = judgeConvertHintEditable(TERMS_B);
if (rHeA.ok && rHeB.ok) ok('L4 ' + rHeA.why + '（术语双副本一致）');
else bad('L4 ' + (rHeA.ok ? '' : 'A 副本：' + rHeA.why + '；') + (rHeB.ok ? '' : 'B 副本：' + rHeB.why));

// ---------- S1~S2 自失效护栏 ----------
const scanFiles = ['utils/units.js', 'pages/card/edit.js', 'pages/card/edit.wxml', 'pages/material/edit.js', 'pages/material/edit.wxml', 'pages/material/index.js', 'miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js'];
const scanned = scanFiles.filter((f) => read(f) != null).length;
if (scanned >= scanFiles.length) ok('S1 扫描面完整（' + scanned + '/' + scanFiles.length + ' 个文件在位，改小扫描面即转红）');
else bad('S1 扫描面缺失：仅 ' + scanned + '/' + scanFiles.length + ' 个文件可读');

const baseWordHits = (MATEJS.match(/baseWordOf\s*\(/g) || []).length + (MATIDX.match(/baseWordOf\s*\(/g) || []).length;
if (baseWordHits >= 2) ok('S2 baseWordOf 调用命中 ' + baseWordHits + ' 处 ≥ 2（防判据被删光后"扫了空集"）');
else bad('S2 baseWordOf 调用仅 ' + baseWordHits + ' 处（< 2，判据面被写窄）');

// ---------- C1~C5 反恒真（同一条判据喂正负样本） ----------
const SL_BAD = "        spec_line: '1 ' + (m.purchase_unit || '斤') + ' = ' + (m.convert_factor || 0) + ' 克'";
const SL_GOOD = "        spec_line: '1 ' + (m.purchase_unit || '斤') + ' = ' + (m.convert_factor || 0) + ' ' + units.baseWordOf(m.purchase_unit || '斤')";
const c1 = judgeSpecLineBaseWord(SL_BAD);
const c2 = judgeSpecLineBaseWord(SL_GOOD);
if (c1.ok) bad('C1 影子样本「spec_line 写死克」被判绿 ⇒ 判据无分辨力（假绿）');
else ok('C1 影子样本「spec_line 写死克」被判红（判据有分辨力）—— ' + c1.why);
if (!c2.ok) bad('C2 影子样本「走 baseWordOf」被判红 ⇒ 判据过严（假红）—— ' + c2.why);
else ok('C2 影子样本「走 baseWordOf」被判绿（不假红）');

const c3 = judgePoolParity(['克', '千克'], ['克', '千克', '斤']);
if (c3.ok) bad('C3 影子样本「两池长度不等」被判绿 ⇒ 池漂移抓不到');
else ok('C3 影子样本「两池长度不等」被判红 —— ' + c3.why);

const PRICE_BAD = 'function manualNetUnitWan(unitPriceYuan, yieldRate) { const p = Number(unitPriceYuan) || 0; const y = Number(yieldRate) || 100; if (p <= 0) return 0; return Math.round((p * 10000) / (y / 100)); }';
const c4 = judgePriceBase(PRICE_BAD);
if (c4.ok) bad('C4 影子样本「单价不折算」被判绿 ⇒ 静默差倍率抓不到');
else ok('C4 影子样本「单价不折算」被判红 —— ' + c4.why);

const CROSS_BAD = 'unitWarnOf(m, l) { const pu = m.purchase_unit; const qu = l.qty_unit; return pu === qu ? "" : TERMS.card.unitCrossWarn(pu, qu); }';
const c5 = judgeCrossWarn(CROSS_BAD);
if (c5.ok) bad('C5 影子样本「页面自写族判据」被判绿 ⇒ 族表漂移抓不到');
else ok('C5 影子样本「页面自写族判据」被判红 —— ' + c5.why);

// 解析器自带钉死样本（防"函数体切不出来 ⇒ 上面 L4 全是空跑"）
const sampleBody = fnBody(CARDJS, 'manualNetUnitWan');
if (!sampleBody || sampleBody.length < 40) bad('C6 函数体切分失效（fnBody 拿不到 manualNetUnitWan 主体）⇒ L4-④ 会是空跑');
else ok('C6 函数体切分器自检通过（manualNetUnitWan 主体 ' + sampleBody.length + ' 字符）');

// ---- round152 反恒真：把坏样本喂给同一条判据 ⇒ 必须判红 ----
const CHIPS_BAD = 'unitChipsOpen: true,';
const c7 = judgeChipsDefault(CHIPS_BAD);
if (c7.ok) bad('C7 影子样本「chips 默认展开」被判绿 ⇒ 判据无分辨力（假绿）');
else ok('C7 影子样本「chips 默认展开」被判红 —— ' + c7.why);

const PU_BAD = 'pickUnit(e) { const u = e.currentTarget.dataset.unit; const sug = units.suggestConvert(u); const patch = { purchase_unit: u }; if (sug != null) patch.convert_factor = String(sug); this.setData(patch); }';
const c8 = judgePickUnitCollapse(PU_BAD);
if (c8.ok) bad('C8 影子样本「选完不收起」被判绿 ⇒ 假绿');
else ok('C8 影子样本「选完不收起」被判红 —— ' + c8.why);

const c9 = judgeConvertTouched(PU_BAD);
if (c9.ok) bad('C9 影子样本「手改值会被冲掉」被判绿 ⇒ 假绿');
else ok('C9 影子样本「手改值会被冲掉」被判红 —— ' + c9.why);

const PU_GOOD = 'pickUnit(e) { const u = e.currentTarget.dataset.unit; const sug = units.suggestConvert(u); const patch = { purchase_unit: u, unitChipsOpen: false }; if (sug != null && !this.data.convertTouched) patch.convert_factor = String(sug); this.setData(patch); }';
const c10 = judgeConvertTouched(PU_GOOD);
if (!c10.ok) bad('C10 影子样本「带手改保护」被判红 ⇒ 判据过严（假红）—— ' + c10.why);
else ok('C10 影子样本「带手改保护」被判绿（不假红）');

const HINT_BAD = 'matConvertHintOf: (u, f, w) => `1 ${u} = ${f} ${w}（净料口径）`';
const c11 = judgeConvertHintEditable(HINT_BAD);
if (c11.ok) bad('C11 影子样本「提示无手改信号」被判绿 ⇒ 假绿');
else ok('C11 影子样本「提示无手改信号」被判红 —— ' + c11.why);

// 解析器钉死样本：pickUnit 主体切不出来 ⇒ L4-⑪⑫ 会变成空跑
if (!PU_BODY || PU_BODY.length < 40) bad('C12 函数体切分失效（fnBody 拿不到 pickUnit 主体）⇒ L4-⑪⑫ 会是空跑');
else ok('C12 函数体切分器自检通过（pickUnit 主体 ' + PU_BODY.length + ' 字符）');

console.log('');
console.log('===== 单位池 / 计量族 / 单价单位守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
