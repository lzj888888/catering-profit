#!/usr/bin/env node
// tools/check_grade_gate_dual.js —— R232 · gradeGate 双副本等价守卫（落地 v1.6 §12 的 R231-4）
// 运行：node tools/check_grade_gate_dual.js   （由 verify_all.js 的 [grade-gate-dual] 套件调用）
//
// ===== 为什么需要它（真缺口，非纸面演练）=====
//   `utils/gradeGate.js`（前端单源，自测用）与 `cloudfunctions/importSalesBill/service.js`（云端**内联副本**）
//   各自持有一份 `SALES_SCHEMA` 与 `checkGradeA`。云函数独立打包、不能 require 小程序侧 utils/，
//   所以「内联」本身是允许的（规范已登记）；**但两份之间当前零守卫**。
//   ⇒ 后果：改 `platform` enum（v1.6 批次即将加 `'pos'` 堂食渠道）时**改一处漏一处 = 一侧放行、另一侧拒收，
//     且全程静默**（自测只 require `utils/` 那份 ⇒ 永远绿）。
//   本守卫把这个缺口变成机器判据：**按值/按行为**比对两份，而不是比字面（等价改写也应变绿）。
//
// ===== 判据（全部 fail-closed：读不到 / 加载不到 / 解析不到即判红）=====
//   S 扫描面    两份副本文件存在非空 + 各自可加载且导出 checkGradeA(function) / SALES_SCHEMA(object)
//               （云端副本依赖外部包 `xlsx`，本地未安装 ⇒ 仅对 `require('xlsx')` 注入空桩，
//                 并在 S-③ 的 detail 里**明示**用的是桩还是真依赖，避免"偷偷替换被测物"）
//   A 结构等价  `SALES_SCHEMA` 字段名集合相等 + 逐字段逐属性值相等（pattern 归一化为 source+flags，
//               不写字面比较）+ 关键锚点在场（防"两份都是空壳"⇒ 恒绿）
//   B 行为等价  同一批**组合电池**输入喂两份 `checkGradeA`，逐组比对 `{pass, level, failures}`；
//               并自证电池有分辨力（必须同时产出过 pass=true 与 pass=false）
//   C 自失效   电池样本数下界 + schema 字段数下界 + **两组影子反例**（证明比较器不是恒空的假判据）
//
// 🔴 已登记差异（不在判据内，见 v1.6 §12 R231-4 备注）：当调用方传入**畸形 schema**
//   （`fields.biz_date` 存在但缺 `pattern`）时，前端那份会 `undefined.test` 抛错、云端那份回落默认正则。
//   该路径**生产不可达**（两个调用点都只传 `SALES_SCHEMA`：`importSalesBill/index.js` 与自测），
//   故不入电池；若将来出现第三方 schema 调用点，必须两侧同时改成 `(fields.biz_date && fields.biz_date.pattern) || DEF`。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONT_REL = 'utils/gradeGate.js';
const CLOUD_REL = 'cloudfunctions/importSalesBill/service.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');
const readOr = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; } };

// ============ S 扫描面：两份副本可加载 ============
sec('S · 扫描面（两份副本存在且可加载）');

const frontSrc = readOr(FRONT_REL);
const cloudSrc = readOr(CLOUD_REL);
check('S-① 两份副本文件存在且非空',
  !!frontSrc && frontSrc.length > 800 && !!cloudSrc && cloudSrc.length > 800,
  (frontSrc ? FRONT_REL + ' ' + frontSrc.length + 'B' : FRONT_REL + ' 读不到') + ' / '
  + (cloudSrc ? CLOUD_REL + ' ' + cloudSrc.length + 'B' : CLOUD_REL + ' 读不到'));

let front = null;
try { front = require(path.join(ROOT, FRONT_REL)); } catch (e) { front = null; }
check('S-② 前端单源可加载且导出 checkGradeA(function) / SALES_SCHEMA(object)',
  !!front && typeof front.checkGradeA === 'function' && !!front.SALES_SCHEMA
    && typeof front.SALES_SCHEMA === 'object',
  front ? 'front keys=' + Object.keys(front).join(',') : 'require 失败');

// 云端副本顶部 `const XLSX = require('xlsx')`；该外部包只在云函数部署时装（本地无 node_modules）
// ⇒ 仅对 xlsx 注入空桩；`checkGradeA` / `SALES_SCHEMA` 完全不使用它（纯逻辑）。
// 🔴 绝不静默替换被测物：是否用了桩会在 S-③ 的 detail 里点名。
let cloud = null, cloudStub = false, cloudErr = '';
try {
  cloud = require(path.join(ROOT, CLOUD_REL));
} catch (e) {
  cloudErr = String(e.message || '');
  if (!/xlsx/.test(cloudErr)) { cloud = null; }
  else {
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (req) {
      if (req === 'xlsx') return {};
      return origLoad.apply(this, arguments);
    };
    try { cloud = require(path.join(ROOT, CLOUD_REL)); cloudStub = true; }
    catch (e2) { cloud = null; cloudErr = String(e2.message || ''); }
    finally { Module._load = origLoad; }
  }
}
check('S-③ 云函数副本可加载且导出 checkGradeA(function) / SALES_SCHEMA(object)',
  !!cloud && typeof cloud.checkGradeA === 'function' && !!cloud.SALES_SCHEMA
    && typeof cloud.SALES_SCHEMA === 'object',
  cloud ? 'cloud keys=' + Object.keys(cloud).join(',')
    + '（xlsx 依赖：' + (cloudStub ? '本地未装，已注入空桩（checkGradeA 不用它）' : '真依赖加载成功') + '）'
    : 'require 失败：' + cloudErr.slice(0, 120));

if (!front || !cloud) {
  console.log('\n===== gradeGate 双副本等价守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(1);
}

// ============ 归一化与比较器 ============
function normVal(v) {
  if (v instanceof RegExp) return { __re: v.source, flags: v.flags };
  if (Array.isArray(v)) return v.map(normVal);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach((k) => { o[k] = normVal(v[k]); });
    return o;
  }
  return v;
}

/** 忠实克隆（**保留 RegExp 实例**）。🔴 不可用 JSON.parse(JSON.stringify()) —— 那会把 pattern 正则
 *  退化成普通对象 ⇒ 克隆体一跑就 `pattern.test is not a function`，影子反例会"红在无关原因上"
 *  （= 影子太弱/方向不对，与 §10.6 同族）。 */
function deepClone(v) {
  if (v instanceof RegExp) return v;
  if (Array.isArray(v)) return v.map(deepClone);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = deepClone(v[k]); });
    return o;
  }
  return v;
}

/** 结构差异（按值；等价改写不报）。返回差异描述数组，空 = 等价。 */
function schemaDiff(sa, sb) {
  const A = normVal(sa), B = normVal(sb);
  const out = [];
  if (!!A !== !!B) return ['一侧 schema 缺失'];
  const topKeys = Array.from(new Set(Object.keys(A).concat(Object.keys(B)))).sort();
  topKeys.forEach((k) => {
    const ja = JSON.stringify(A[k]), jb = JSON.stringify(B[k]);
    if (ja !== jb) out.push('顶层键 ' + k + ' 不等');
  });
  const fa = A.fields || {}, fb = B.fields || {};
  const fk = Array.from(new Set(Object.keys(fa).concat(Object.keys(fb)))).sort();
  fk.forEach((f) => {
    const ja = JSON.stringify(fa[f]), jb = JSON.stringify(fb[f]);
    if (ja !== jb) out.push('fields.' + f + ' 不等：' + ja + ' vs ' + jb);
  });
  return out;
}

/** 行为差异：逐组样本比对出参（含"一侧抛错、另一侧不抛"）。返回差异描述数组。 */
function behaviorDiff(modA, modB, inputs) {
  const out = [];
  inputs.forEach((s, i) => {
    let ra = null, rb = null, ea = null, eb = null;
    const callA = () => (s.mode === 'self' ? modA.checkGradeA(s.input, modA.SALES_SCHEMA)
      : s.mode === 'empty' ? modA.checkGradeA(s.input, {}) : modA.checkGradeA(s.input));
    const callB = () => (s.mode === 'self' ? modB.checkGradeA(s.input, modB.SALES_SCHEMA)
      : s.mode === 'empty' ? modB.checkGradeA(s.input, {}) : modB.checkGradeA(s.input));
    try { ra = JSON.stringify(callA()); } catch (e) { ea = String(e.message); }
    try { rb = JSON.stringify(callB()); } catch (e) { eb = String(e.message); }
    if (ea !== null || eb !== null) {
      if (ea !== eb) out.push('#' + i + ' 抛差异：A=' + ea + ' / B=' + eb);
      return;
    }
    if (ra !== rb) out.push('#' + i + ' 出参不等：' + ra + ' vs ' + rb);
  });
  return out;
}

// ============ A 结构等价（SALES_SCHEMA 逐字段值）============
sec('A · SALES_SCHEMA 逐字段值等价 + 关键锚点在场');
{
  const F = front.SALES_SCHEMA, C = cloud.SALES_SCHEMA;
  const fk = Object.keys((F && F.fields) || {});
  const ck = Object.keys((C && C.fields) || {});
  const miss = fk.filter((k) => ck.indexOf(k) < 0);
  const extra = ck.filter((k) => fk.indexOf(k) < 0);
  check('A-① 字段名集合相等（缺 / 多都红）', miss.length === 0 && extra.length === 0,
    (miss.length || extra.length) ? '缺：' + miss.join(',') + ' 多：' + extra.join(',') : fk.length + ' 个字段两端一致');

  const diffs = schemaDiff(F, C);
  check('A-② 逐字段逐属性值等价（pattern 归一化 source+flags；enum 逐值）', diffs.length === 0,
    diffs.length ? diffs.join(' | ') : fk.length + ' 字段 × 全部属性值相等');

  // 关键锚点：证明两份都是"真 gradeGate"，不是被换成了空壳（防"两边一起空 ⇒ 恒绿"）
  const penum = (F && F.fields && F.fields.platform && F.fields.platform.enum) || [];
  const anchors = ['taobao', 'meituan', 'eleme', 'other'];
  const lost = anchors.filter((p) => penum.indexOf(p) < 0);
  check('A-③ platform.enum 含 taobao/meituan/eleme/other 且 qty.integer=true（非空壳）',
    lost.length === 0 && penum.length >= 4 && !!(F.fields.qty && F.fields.qty.integer === true)
      && !!(C.fields.qty && C.fields.qty.integer === true),
    'enum=[' + penum.join(',') + ']');
}

// ============ B 行为等价（组合电池）============
sec('B · checkGradeA 行为等价（组合电池逐组比对出参）');
const PLATFORMS = ['taobao', 'meituan', 'eleme', 'other', 'pos', 'xxx', ''];
const ROWS = [
  [{ bizDate: '2026-08-01', qty: 3, amountFen: 10000 }],
  [{ bizDate: '2026/08/01', qty: 3, amountFen: 10000 }],
  [{ bizDate: '2026-08-01', qty: 3, amountFen: 12.5 }],
  [{ bizDate: '2026-08-01', qty: -1, amountFen: 10000 }],
  [{ bizDate: '2026-08-01', qty: 0, amountFen: 100 }],
  [{ bizDate: '2026-08-01', qty: 3.5, amountFen: 100 }],
  [{ bizDate: '', qty: 3, amountFen: 10000 }],
  [null],
  [],
];
const TOTALS = [{ amountFen: 10000, qty: 3, rowCount: 1 }, {}, { amountFen: NaN }, null];
const SHOPIDS = ['s1', '', null];

const battery = [];
PLATFORMS.forEach((p) => ROWS.forEach((rows) => TOTALS.forEach((totals) => SHOPIDS.forEach((shopId) => {
  battery.push({ mode: 'default', input: { platform: p, shopId: shopId, header: ['a'], rows: rows, totals: totals } });
}))));
// 生产调用形态：显式传 SALES_SCHEMA（`importSalesBill/index.js` 即此形态）+ 空 schema 边界
PLATFORMS.forEach((p) => ROWS.forEach((rows) => {
  const input = { platform: p, shopId: 's1', header: ['a'], rows: rows, totals: TOTALS[0] };
  battery.push({ mode: 'self', input: input });
  battery.push({ mode: 'empty', input: input });
}));

const bdiffs = behaviorDiff(front, cloud, battery);
check('B-① 组合电池逐组出参全等（{pass, level, failures} 序列化比对）', bdiffs.length === 0,
  bdiffs.length ? bdiffs.slice(0, 3).join(' | ') + (bdiffs.length > 3 ? ' … 共 ' + bdiffs.length + ' 组' : '')
    : battery.length + ' 组全等');

// 电池有分辨力：必须同时产出过 pass=true 与 pass=false（否则"两份都恒 true"也会全等 ⇒ 假绿）
{
  let nPass = 0, nFail = 0;
  battery.forEach((s) => {
    let r = null;
    try { r = front.checkGradeA(s.input, s.mode === 'self' ? front.SALES_SCHEMA
      : s.mode === 'empty' ? {} : undefined); } catch (e) { r = null; }
    if (r && r.pass === true) nPass++;
    if (r && r.pass === false) nFail++;
  });
  check('B-② 电池有分辨力（同时产出过 pass=true 与 pass=false）', nPass >= 1 && nFail >= 5,
    'pass=true ' + nPass + ' 组 / pass=false ' + nFail + ' 组');
}

// ============ C 自失效护栏（防"扫空 / 判据恒空 ⇒ 恒绿"）============
sec('C · 自失效护栏（样本下界 + 影子反例）');
check('C-① 电池样本数 ≥ 800（防组合嵌套被改小 ⇒ 覆盖面悄悄缩水）', battery.length >= 800,
  battery.length + ' 组（实测 882）');
check('C-② schema 字段数 ≥ 9（防"两份一起被削成小 schema"仍判绿）',
  Object.keys((front.SALES_SCHEMA && front.SALES_SCHEMA.fields) || {}).length >= 9,
  Object.keys((front.SALES_SCHEMA && front.SALES_SCHEMA.fields) || {}).length + ' 个字段');

// 影子反例 1：结构面 —— 把副本 platform.enum 削掉一项，schemaDiff **必须**报差异
{
  const clone = deepClone(cloud.SALES_SCHEMA);
  clone.fields.platform.enum = ['taobao', 'meituan', 'eleme'];   // 少 other（= 只改了一侧的典型形态）
  const d = schemaDiff(front.SALES_SCHEMA, clone);
  // 🔴 不仅"有差异"，还要**差异出在 platform 那格**（否则可能因为别的无关原因报差异 ⇒ 影子无效）
  const hit = d.filter((x) => /platform/.test(x));
  check('C-③ 影子：副本 enum 少一项 ⇒ 结构比较器报差异且落在 platform 字段（证明非恒空）',
    d.length >= 1 && hit.length >= 1,
    d.length ? '报 ' + d.length + ' 处，其中 platform ' + hit.length + ' 处' : '⚠️ 未报差异 ⇒ 比较器失效');
}

// 影子反例 2：行为面 —— 造一个"一侧 enum 少一项"的漂移副本，behaviorDiff **必须**报差异
// ⚠️ 2026-10-06（R232 收口）**本块修订** —— 原实现用 `enum.concat(['pos'])` 造漂移，
//   前提是「两侧都还没有 'pos'」。而 v1.6 批次**已正式**给两侧加上 `'pos'`（§5.4 目标态）⇒
//   再 concat 就变成**重复项**（['…','pos','other','pos']），两份行为**完全一致** ⇒ d=[] ⇒
//   本判据转红。这属于「**反向伤害二型**」：把**正确的**实现当成漂移样本 ⇒ 改对反红。
//   🔴 修订原则 —— 漂移样本**必须与当前基线无关**：改为**从现有 enum 里删掉一项**（任何合法 enum
//   删一项都是真实漂移形态，无论基线含不含 'pos'）；被删项**动态取**（优先 'pos'，缺失则取末项），
//   并**断言被删项确实存在于基线**（防"删了个不存在的项 ⇒ 两份都没变 ⇒ 恒绿"的假判据）。
{
  const baseEnum = (front.SALES_SCHEMA.fields.platform.enum || []).slice();
  // 动态挑一个**确实存在**的项来删（优先 'pos'：它正是本批新加的渠道，最具代表性）
  const dropIdx = baseEnum.indexOf('pos') >= 0 ? baseEnum.indexOf('pos') : baseEnum.length - 1;
  const dropped = baseEnum[dropIdx];
  const clone = deepClone(front.SALES_SCHEMA);
  clone.fields.platform.enum = baseEnum.filter((_, i) => i !== dropIdx);
  const drifted = {
    SALES_SCHEMA: clone,
    checkGradeA: (input, s) => front.checkGradeA(input, s || clone),
  };
  const d = behaviorDiff(front, drifted, battery);
  // 🔴 差异必须**全部**是 SCHEMA_PLATFORM 那一支（证明确实抓到"渠道放行不一致"，而非抛错/无关差异）
  const onPlatform = d.filter((x) => /SCHEMA_PLATFORM/.test(x));
  // 自失效护栏：被删项必须真的在基线里（否则影子样本无效 ⇒ 判据恒真）
  const sampleValid = dropped !== undefined && baseEnum.indexOf(dropped) >= 0
    && clone.fields.platform.enum.length === baseEnum.length - 1;
  check('C-④a 影子样本有效（被删枚举项确实存在于基线，且影子 enum 恰好少 1 项）',
    sampleValid,
    '基线 enum=' + JSON.stringify(baseEnum) + '，删「' + dropped + '」⇒ 影子 ' + clone.fields.platform.enum.length + ' 项');
  check('C-④ 影子：一侧 enum 少一项（另一侧没少）⇒ 行为比较器必须报且只报 platform 判别差异（真实漂移形态）',
    d.length >= 1 && onPlatform.length === d.length,
    d.length ? '报 ' + d.length + ' 组（其中 platform 判别 ' + onPlatform.length + ' 组）' : '⚠️ 未报差异 ⇒ 行为判据失效（改一处漏一处将静默）');
}

console.log('\n===== gradeGate 双副本等价守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
