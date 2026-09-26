// tools/check_unit_convert.js —— R149：单位换算守卫（采购单位 / 用量单位）
//
// 事故模型（本轮要防的**形态缺陷**）：产品要求「同一原料买用不同单位」（参考图：采购单位 × / 用量单位 ×
//   各自可选 克/千克/毫升/升）。最容易写坏的一格是——**只换标签、不换数**：
//     qty 从 1000「克」切成「千克」，输入框仍显示 1000 ⇒ 成本当场差 **1000 倍**，而页面看起来"完全正常"。
//   这不是假想：单位类改动里这是最常见的错法，且**任何界面走查都看不出来**（数字是个合法数字）。
//
// 另一格是**倍率抄两份**：页面里写一张 `{千克:1000}` 表、utils 里再写一张 ⇒ 改一处必漏一处。
//
// 判据（纯函数化 + 正负互证 + 反查真实单源 + 解析器钉死样本）：
//   L1 倍率单源在场：utils/units.js 导出 QTY_FACTOR/QTY_UNITS/PURCHASE_UNITS/toBase/convertQtyText
//   L2 倍率**行为**正确（require 真源码实跑，不比字面量副本）：克1 / 千克1000 / 毫升1 / 升1000
//   L3 页面**不自抄**倍率表：pages/ 下不得出现「千克…1000」这类同行搭配
//   L4 换单位必换数：onQtyUnit 函数体内必须同时出现 qty_unit 赋值 + convertQtyText 调用
//   L5 提交前归一：buildCalcLines / doSave 内必须走 units.toBase()，且不得把 Number(l.qty) 直接当数量
//   L6 换算关系要露出来：明细行有 spec_hint、specHintOf 存在（老板看得见"36 元/斤 ⇒ 0.0783 元/克"）
//   L7 采购单位可选：原料档案页有 data-unit chips + pickUnit 且走 units.suggestConvert
//   S1~S3 自失效护栏（扫描面/命中数/断言数下界，防"扫了空集所以全绿"）
//   C1~C2 反恒真：把「只换标签不换数」的假源码喂给同一条判据 ⇒ 必须判红；真写法 ⇒ 判绿
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
// 取具名函数的函数体（花括号配平；找不到返回 null）。钉死样本见 C2。
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
// 判据 L4：换单位是否真的换了数
// ⚠️ 判「行为」不判「文本」：`convertQtyText(...)` 与「自己乘 factorOf(...)」都算换了数，
//   否则语义等价的改写会被判红（假红）—— 见 C2b 影子样本。
function judgeUnitSwitch(body) {
  if (!body) return { ok: false, why: '函数体解析不到（fail-closed）' };
  const writesUnit = /qty_unit\s*:/.test(body);
  const converts = /convertQtyText\s*\(/.test(body) || /factorOf\s*\(/.test(body);
  if (!writesUnit) return { ok: false, why: '函数体里没有 qty_unit 赋值（换单位没落到数据上）' };
  if (!converts) return { ok: false, why: '函数体里既没有 convertQtyText(...) 也没有 factorOf(...) ⇒ 只换标签不换数，成本会差倍率' };
  return { ok: true, why: '换标签 + 换数' };
}
// 判据 L5：提交前是否归一为基准单位
function judgeBaseNormalize(body) {
  if (!body) return { ok: false, why: '函数体解析不到（fail-closed）' };
  if (!/toBase\s*\(/.test(body)) return { ok: false, why: '没有调用 toBase(...) ⇒ 送引擎的数量可能带着非基准单位' };
  if (/(?:quantity|qty)\s*:\s*Number\s*\(\s*l\.qty\s*\)/.test(body)) {
    return { ok: false, why: '仍把 Number(l.qty) 直接当数量（绕过了单位换算）' };
  }
  return { ok: true, why: '统一走 toBase() 归一' };
}
// 判据 L3：页面里有没有自抄倍率表
function pageHasOwnFactorTable(src) {
  if (!src) return { own: false, why: '文件不存在' };
  const lines = src.split(/\r?\n/);
  for (const ln of lines) {
    if (/^\s*\/\//.test(ln)) continue;                 // 注释行不算（本仓注释里会举例说明）
    if (/千克[^\n]*1000|1000[^\n]*千克/.test(ln)) return { own: true, why: '同行出现「千克…1000」：疑似在页面里自抄倍率表', line: ln.trim().slice(0, 80) };
    if (/['"]升['"][^\n]*:\s*1000/.test(ln)) return { own: true, why: '页面里出现 {升:1000} 形态的倍率表', line: ln.trim().slice(0, 80) };
  }
  return { own: false, why: '页面未自抄倍率表' };
}

// 本轮受管页面源码（顶层声明：L2 枚举一致性与 L3/L4/L5/L7 共用同一份读入结果）
const CARDJS = read('pages/card/edit.js') || '';
const CARDWXML = read('pages/card/edit.wxml') || '';
const MATE = read('pages/material/edit.js') || '';

console.log('===== R149 · 单位换算守卫（采购单位 / 用量单位）=====');

// ---------- L1 倍率单源在场 ----------
const UNITS = read('utils/units.js');
if (!UNITS) {
  bad('L1 utils/units.js 不存在（单位倍率没有单源）');
} else {
  const need = ['PURCHASE_UNITS', 'CONVERT_SUGGEST', 'QTY_UNITS', 'QTY_FACTOR', 'BASE_UNIT', 'factorOf', 'toBase', 'suggestConvert', 'convertQtyText'];
  const exportsLine = (UNITS.match(/module\.exports\s*=\s*\{[\s\S]*?\}/) || [''])[0];
  const missing = need.filter((k) => exportsLine.indexOf(k) < 0);
  if (missing.length) bad('L1 utils/units.js 缺导出：' + missing.join(' / '));
  else ok('L1 utils/units.js 导出齐全（' + need.length + ' 个符号，倍率单源在位）');
}

// ---------- L2 倍率行为正确（实跑真源码，不比字面量） ----------
let U = null;
let reqErr = '';
try { U = require(path.join(ROOT, 'utils/units.js')); } catch (e) { U = null; reqErr = (e && e.message) || String(e); }
if (!U) {
  bad('L2 utils/units.js require 失败（fail-closed）：' + reqErr);
} else {
  const cases = [
    ['1 克 → 克', U.toBase('1', '克'), 1],
    ['1 千克 → 克', U.toBase('1', '千克'), 1000],
    ['0.7 千克 → 克', U.toBase('0.7', '千克'), 700],       // IEEE754 毛刺回归（0.7*1000=700.0000000000001）
    ['1 毫升 → 基准', U.toBase('1', '毫升'), 1],
    ['1 升 → 基准', U.toBase('1', '升'), 1000],
    ['2.5 千克 → 克', U.toBase('2.5', '千克'), 2500],
    ['未知单位按 1（fail-soft 不当成 1000）', U.toBase('3', '打'), 3],
    ['空值 → 0', U.toBase('', '克'), 0],
  ];
  let bad2 = cases.filter((c) => c[1] !== c[2]);
  if (bad2.length) bad('L2 倍率行为断言不符：' + bad2.map((c) => c[0] + ' 期望' + c[2] + ' 实际' + c[1]).join('；'));
  else ok('L2 倍率行为正确（' + cases.length + ' 例含 0.7 千克浮点回归）');

  const ct = [
    ['1000 克 → 千克', U.convertQtyText('1000', '克', '千克'), '1'],
    ['1 千克 → 克', U.convertQtyText('1', '千克', '克'), '1000'],
    ['250 克 → 克（同单位不变）', U.convertQtyText('250', '克', '克'), '250'],
    ['空串不炸', U.convertQtyText('', '克', '千克'), ''],
    ['0 不炸', U.convertQtyText('0', '克', '千克'), '0'],
  ];
  let bad3 = ct.filter((c) => c[1] !== c[2]);
  if (bad3.length) bad('L2 换单位换算不符：' + bad3.map((c) => c[0] + ' 期望' + c[2] + ' 实际' + c[1]).join('；'));
  else ok('L2 换单位换算正确（' + ct.length + ' 例，含空值/零值不炸）');

  // 采购单位 → 建议换算系数：**这一格同样会被改错**（M4 首轮变异就打在它身上没被抓到）
  //   —— 它决定「点一下"千克"自动带出多少」，错了老板会拿错价的 10 倍去算成本。
  const sc = [
    ['斤', 500], ['千克', 1000], ['公斤', 1000], ['克', 1], ['毫升', 1], ['升', 1000],
  ];
  let badSc = sc.filter((c) => U.suggestConvert(c[0]) !== c[1]);
  if (badSc.length) bad('L2 采购单位建议换算系数不符：' + badSc.map((c) => c[0] + ' 期望' + c[1] + ' 实际' + U.suggestConvert(c[0])).join('；'));
  else ok('L2 采购单位建议换算系数正确（' + sc.length + ' 例）');
  // 「箱/桶」这类没有通用换算 ⇒ 必须返回 null（判 null 而不是判某个数字：返回 1 或 5000 都是瞎猜）
  const noSug = ['箱', '桶', '件', '提', '打'];
  const wrongSug = noSug.filter((u) => U.suggestConvert(u) !== null);
  if (wrongSug.length) bad('L2 无通用换算的单位不得给建议值（否则页面会替老板瞎猜）：' + wrongSug.join('/'));
  else ok('L2 无通用换算的单位返回 null（' + noSug.length + ' 例：不替老板瞎猜）');

  // 枚举一致性：picker 用的枚举必须就是单源那份（不许页面自己另写一份）
  if (!/qtyUnits\s*:\s*units\.QTY_UNITS/.test(CARDJS)) bad('L2 明细行单位枚举未取自 units.QTY_UNITS（页面自抄枚举）');
  else ok('L2 明细行单位枚举取自单源 units.QTY_UNITS');
  if (MATE && !/unitChips\s*:\s*units\.PURCHASE_UNITS/.test(MATE)) bad('L2 采购单位建议池未取自 units.PURCHASE_UNITS（页面自抄枚举）');
  else ok('L2 采购单位建议池取自单源 units.PURCHASE_UNITS');
}

// ---------- L3 页面不自抄倍率表 ----------
const pageFiles = ['pages/card/edit.js', 'pages/card/edit.wxml', 'pages/material/edit.js', 'pages/material/edit.wxml', 'pages/material/index.js'];
let own = [];
for (const f of pageFiles) {
  const r = pageHasOwnFactorTable(read(f));
  if (r.own) own.push(f + '：' + r.why + '（' + r.line + '）');
}
if (own.length) bad('L3 页面自抄倍率表：\n     ' + own.join('\n     '));
else ok('L3 五个页面文件均未自抄倍率表（L3 扫描面 ' + pageFiles.length + ' 个文件）');

// ---------- L4/L5 用真源码跑判据 ----------
const r4 = judgeUnitSwitch(fnBody(CARDJS, 'onQtyUnit'));
if (r4.ok) ok('L4 onQtyUnit 换单位时确实换数 —— ' + r4.why);
else bad('L4 onQtyUnit 换单位未换数 —— ' + r4.why);

for (const fn of ['buildCalcLines', 'doSave']) {
  const r5 = judgeBaseNormalize(fnBody(CARDJS, fn));
  if (r5.ok) ok('L5 ' + fn + ' 提交前归一为基准单位(克) —— ' + r5.why);
  else bad('L5 ' + fn + ' 未归一 —— ' + r5.why);
}

// ---------- L6 换算关系露在明细行 ----------
// 光有占位不算 —— 必须「定义 + 被调用」两者齐备（只留占位会渲染成空行，看起来像没做）
const hasSpecDef = /specHintOf\s*\(\s*m\s*\)\s*\{/.test(CARDJS);
const hasSpecCall = /\.specHintOf\s*\(/.test(CARDJS);
if (!/spec_hint/.test(CARDWXML)) bad('L6 明细行没有 spec_hint（老板看不到"采购价 → 净料元/克"的换算）');
else if (!hasSpecDef) bad('L6 明细行有 spec_hint 占位，但 edit.js 里没有 specHintOf(m) 的定义（占位会渲染成空行）');
else if (!hasSpecCall) bad('L6 specHintOf 定义了却没人调用（换算说明永远出不来）');
else ok('L6 明细行露出换算关系（spec_hint 占位 + specHintOf 定义 + 调用三者齐备）');

// ---------- L7 采购单位可选（chips + 建议换算系数） ----------
if (!/data-unit=/.test(read('pages/material/edit.wxml') || '')) bad('L7 原料档案页没有采购单位 chips（data-unit）');
else if (!/suggestConvert\s*\(/.test(MATE)) bad('L7 pickUnit 没走 units.suggestConvert（选了单位不会带出换算系数）');
else ok('L7 原料档案页可点选采购单位并自动带出建议换算系数');

// ---------- S1~S3 自失效护栏 ----------
const scanned = pageFiles.filter((f) => read(f) != null).length;
if (scanned >= pageFiles.length) ok('S1 扫描面完整（' + scanned + '/' + pageFiles.length + ' 个页内文件在位，改小扫描面即转红）');
else bad('S1 扫描面缺失：仅 ' + scanned + '/' + pageFiles.length + ' 个文件可读');
const toBaseHits = (CARDJS.match(/toBase\s*\(/g) || []).length;
if (toBaseHits >= 2) ok('S2 归一调用命中 ' + toBaseHits + ' 处 ≥ 2（防判据被删光后"扫了空集"）');
else bad('S2 归一调用仅 ' + toBaseHits + ' 处（< 2，判据面被写窄）');

// ---------- C1~C2 反恒真（同一条判据喂正负样本） ----------
const SHADOW_BAD = 'onQtyUnit(e){ const idx=Number(e.currentTarget.dataset.idx); const lines=this.data.lines.slice(); lines[idx]=Object.assign({},lines[idx],{qty_unit:next}); this.setData({lines}); }';
const SHADOW_GOOD = 'onQtyUnit(e){ const lines=this.data.lines.slice(); lines[idx]=Object.assign({},lines[idx],{qty_unit:next, qty: units.convertQtyText(cur.qty, from, next)}); }';
const SHADOW_EQ = 'onQtyUnit(e){ const idx=Number(e.currentTarget.dataset.idx); const lines=this.data.lines.slice(); const c=lines[idx]; const b=Number(c.qty)*units.factorOf(c.qty_unit||"克"); lines[idx]=Object.assign({},c,{qty_unit:next, qty:String(b/units.factorOf(next))}); }';
const c1 = judgeUnitSwitch(SHADOW_BAD);
const c2 = judgeUnitSwitch(SHADOW_GOOD);
const c2b = judgeUnitSwitch(SHADOW_EQ);
if (c1.ok) bad('C1 影子样本「只换标签不换数」被判绿 ⇒ 判据无分辨力（假绿）');
else ok('C1 影子样本「只换标签不换数」被判红（判据有分辨力）—— ' + c1.why);
if (!c2.ok) bad('C2 影子样本「换标签 + 换数」被判红 ⇒ 判据过严（假红）—— ' + c2.why);
else ok('C2 影子样本「换标签 + 换数」被判绿（不假红）');
if (!c2b.ok) bad('C2b 语义等价改写（自己乘 factorOf，不走 convertQtyText）被判红 ⇒ 判据在判文本而非判行为 —— ' + c2b.why);
else ok('C2b 语义等价改写（走 factorOf）保持判绿 ⇒ 判据判**行为**不判文本');
// 解析器自带钉死样本：fnBody 必须能从真实源码里切出 onQtyUnit 的函数体
const sample = fnBody(CARDJS, 'onQtyUnit');
if (!sample || sample.length < 40) bad('C3 函数体切分失效（fnBody 拿不到 onQtyUnit 主体）⇒ 上面 L4 会是空跑');
else ok('C3 函数体切分器自检通过（onQtyUnit 主体 ' + sample.length + ' 字符）');

console.log('');
console.log('===== 单位换算守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
