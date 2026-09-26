// tools/check_spec_derive.js —— R132：M3.14 组件分类 + M3.15 多规格**派生层**守卫
//
// 依据：`specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.14 / §M3.15 / §M3.26。
//
// 事故模型（本守卫要防的**形态缺陷**）：
//   ① **系数写进两份**：页面里抄一张 `{main:0.5, aux:0.7}` + 服务端再写一张 ⇒ 改一处必漏一处，
//      且漏掉的那份"看起来完全正常"（成本只是悄悄不对）。
//   ② **派生被内联进引擎**：把缩放逻辑塞进某一份 `service.js` ⇒ 5 份引擎副本立刻分叉
//      （本仓 `check_m3_engine_parity` 只能发现"行为不等价"，发现不了"某一份多了一段"）。
//   ③ **规格成本污染 total_cost**：把半份成本当主成本落库 ⇒ 8/9 家店的招牌菜成本凭空少一半，
//      而界面每一处都"算得出来"。
//   ④ **缩放的依据丢了**：`line_kind` 在入参清洗时被"洗掉"（本仓真实发生过同类：
//      `calcBom/validate.js` 原先把行洗成 `{quantity, net_unit_cost}` 两项）⇒ 「调料不减半」静默退化成"全部减半"。
//   ⑤ **键名漂移**：前端 `terms.js` 的组件键与后端 `LINE_KINDS` 拼写不同 ⇒ 系数查不到、全部按 1 走，
//      即"规格试算永远等于全份"，而页面一切正常。
//
// 判据（纯函数化 + 正负互证 + 反查真实单源 + 解析器/样本钉死）：
//   L1 单源在场（specDerive.js 导出齐备 / 聚合入口导出齐备 / 扁平副本 ≡ 单源）
//   L2 引擎不被污染（无 `function deriveSpec` 内联 / 引擎副本源码零命中 line_kind·spec_key）
//   L3 恒等与锚点（**真跑生产件**：全 1 ⇒ 逐字节恒等 + 975/876；半份 ⇒ 用量/辅料/567/1253/68.85）
//   L4 契约落点（calcBom 保留 line_kind 且返回 spec_results / saveCostCard 落 specs_json 且 total_cost 不被污染
//                / getCostCard 回填不丢字段）
//   L5 键集一致（terms.lineKind ≡ LINE_KINDS；terms.specLabel ≡ SPEC_PRESETS；页面不抄系数）
//   S1~S2 自失效护栏（扫描面下界 / 断言数下界）
//   C1~C3 反恒真（三类影子派生喂给同一条判据，必须判否）
//
// ⚠️ 输出纪律：中间行不得出现「N 通过 / M 失败」字样（否则套件断言数解析器会抓错行）。
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
const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n');

// ---------- 受管面（顶层声明：多段共用同一份读入结果，避免"各段各读一次"的漂移） ----------
const SD_REL = 'cloudfunctions/common/specDerive.js';
const FLAT_FUNCS = ['calcBom', 'saveCostCard', 'getCostCard'];
const SERVICE_GLOB_DIRS = null; // 由 listServiceFiles() 动态枚举（不写死清单：写了就没人补）

function listServiceFiles() {
  const out = [];
  const base = path.join(ROOT, 'cloudfunctions');
  let ents = [];
  try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const p = path.join(base, e.name, 'service.js');
    if (fs.existsSync(p)) out.push('cloudfunctions/' + e.name + '/service.js');
  }
  return out;
}
// 引擎副本 = 含 calcCostCard 具名函数的 service.js（本仓 5 份；下界 3 由 S1 守）
function isEngineCopy(rel) {
  const s = read(rel);
  return !!s && /function\s+calcCostCard\s*\(/.test(s);
}

console.log('===== R132 · M3.14/M3.15 派生层守卫（组件分类 + 多规格）=====');

// ===================== L1 单源在场 =====================
const SRC = read(SD_REL);
if (!SRC) {
  bad('L1-① ' + SD_REL + ' 不存在（多规格派生没有单源）');
} else {
  const need = ['LINE_KINDS', 'LINE_KIND_DEFAULT', 'SPEC_PRESETS', 'findPreset', 'kindOf', 'coefOf',
    'isIdentityCoef', 'unitCoef', 'deriveSpec', 'sanitizeCoef', 'sanitizeSpecs', 'specsToJson', 'specsFromJson'];
  const exp = (SRC.match(/module\.exports\s*=\s*\{[\s\S]*?\n\};/) || [''])[0];
  const missing = need.filter((k) => exp.indexOf(k) < 0);
  if (missing.length) bad('L1-① specDerive 缺导出：' + missing.join(' / '));
  else ok('L1-① specDerive 导出齐全（' + need.length + ' 个符号，派生层单源在位）');
}

const IDX = read('cloudfunctions/common/index.js') || '';
{
  const need = ['specDerive', 'LINE_KINDS', 'SPEC_PRESETS', 'deriveSpec', 'kindOf', 'specsToJson', 'specsFromJson', 'sanitizeSpecs'];
  const missing = need.filter((k) => !new RegExp('\\b' + k + '\\s*:').test(IDX));
  if (missing.length) bad('L1-② 聚合入口 common/index.js 漏导：' + missing.join(' / ') + '（真云 `const { X } = common` 会 TypeError）');
  else ok('L1-② 聚合入口导出齐备（' + need.length + ' 个符号，与 genId 教训同款护栏）');
}
{
  const miss = [];
  for (const fn of FLAT_FUNCS) {
    const flat = read('cloudfunctions/' + fn + '/cx_specDerive.js');
    if (!flat) { miss.push(fn + '（无扁平副本）'); continue; }
    if (norm(flat) !== norm(SRC)) miss.push(fn + '（副本 ≠ 单源）');
  }
  if (miss.length) bad('L1-③ 扁平副本 ≠ 单源：' + miss.join('；') + '（跑 node tools/sync_common.js）');
  else ok('L1-③ ' + FLAT_FUNCS.length + ' 个受管函数的 cx_specDerive.js ≡ 单源（逐字节）');
}

// ===================== L2 引擎不被污染 =====================
const services = listServiceFiles();
const engineCopies = services.filter(isEngineCopy);
{
  const inlined = services.filter((f) => /function\s+deriveSpec\s*\(/.test(read(f) || ''));
  if (inlined.length) bad('L2-① 派生被内联进 service：' + inlined.join(' / ') + '（规范 M3.15 硬约束①：5 份引擎副本都不碰）');
  else ok('L2-① 全仓 service.js 零内联 deriveSpec（引擎段干净）');
}
{
  const polluted = engineCopies.filter((f) => {
    const s = read(f) || '';
    return /line_kind/.test(s) || /spec_key/.test(s);
  });
  if (polluted.length) bad('L2-② 引擎副本出现 line_kind/spec_key：' + polluted.join(' / ') + '（引擎只该认 quantity / net_unit_cost）');
  else ok('L2-② ' + engineCopies.length + ' 份引擎副本源码零命中 line_kind/spec_key（规格是入参变换，不是引擎能力）');
}

// ===================== L3 恒等与锚点（真跑生产件） =====================
// 锚点输入与 `review/evidence/m3v11_anchor_recalc.txt` 同参（**用生产引擎算，不手抄结果**）
let SD = null, ENG = null, loadErr = '';
try {
  SD = require(path.join(ROOT, SD_REL));
  ENG = require(path.join(ROOT, 'cloudfunctions/calcBom/service.js'));
} catch (e) { loadErr = (e && e.message) || String(e); }

const M = {
  ji: { priceFen: 1500, cf: 500, y: 90, kind: 'main' },
  hua: { priceFen: 1000, cf: 500, y: 100, kind: 'aux' },
  gan: { priceFen: 2000, cf: 500, y: 100, kind: 'season' },
  cong: { priceFen: 500, cf: 500, y: 100, kind: 'aux' },
  you: { priceFen: 1000, cf: 500, y: 100, kind: 'season' },
};
const ANCHOR_LINES = M && ENG ? Object.keys(M).map((k) => ({
  material_id: k,
  quantity: { ji: 200, hua: 50, gan: 10, cong: 30, you: 20 }[k],
  net_unit_cost: ENG.netUnitCostWan(M[k].priceFen, M[k].cf, M[k].y),
  line_kind: M[k].kind,
})) : [];
const AUX = 50, LOSS = 5, PRICE = 2800;

// 恒等**压力样本**：恒等必须对**任意**入参成立，不能只对"锚点恰好是整数"成立 ——
//   否则"一律 round 到 1e-6"这类实现会假绿（整数乘 1 再 round 还是它自己）。
const IDENTITY_LINES = ANCHOR_LINES.concat([
  { material_id: 'stress_frac', quantity: 0.123456789, net_unit_cost: 123, line_kind: 'aux' },
  { material_id: 'stress_long', quantity: 1.0000000000000002, net_unit_cost: 7, line_kind: 'pack' },
  { material_id: 'stress_int', quantity: 7, net_unit_cost: 100, line_kind: 'main' },
]);

// —— 判据（纯函数，可被 C1~C3 影子样本直接调用）——
// 恒等判据（三条腿）：
//   ① 系数全 1 ⇒ 逐字节相同
//   ② **空系数表** ⇒ 逐字节相同（缺配的组件类按 1 走，不许按 0 —— 漏配一类不该让成本归零）
//   ③ 压力样本下同样逐字节相同（不许有任何 round 损耗）
function judgeIdentity(deriveFn) {
  if (typeof deriveFn !== 'function') return { ok: false, why: 'derive 不是函数' };
  const r1 = cmpIdentical(deriveFn, ANCHOR_LINES, SD.unitCoef());
  if (!r1.ok) return { ok: false, why: '全 1 系数下 ' + r1.why };
  const r2 = cmpIdentical(deriveFn, IDENTITY_LINES, SD.unitCoef());
  if (!r2.ok) return { ok: false, why: '压力样本下 ' + r2.why };
  const r3 = cmpIdentical(deriveFn, ANCHOR_LINES, {});
  if (!r3.ok) return { ok: false, why: '空系数表下 ' + r3.why + '（缺配须按 1）' };
  return { ok: true, why: '逐字节恒等（全 1 / 压力样本 / 空系数表 三条腿全中）' };
}
function cmpIdentical(deriveFn, lines, coef) {
  const d = deriveFn(lines, AUX, coef);
  if (!d || !Array.isArray(d.lines)) return { ok: false, why: 'derive 没返回 lines 数组' };
  if (JSON.stringify(d.lines) !== JSON.stringify(lines)) return { ok: false, why: 'lines 与原入参不逐字节相同' };
  if (d.auxFen !== AUX) return { ok: false, why: 'auxFen 与原值不等（' + d.auxFen + ' ≠ ' + AUX + '）' };
  return { ok: true, why: '逐字节恒等' };
}
// 半份锚点判据：用量 / 辅料桶 / 成本 / 定价后毛利与毛利率
function judgeHalf(deriveFn) {
  if (typeof deriveFn !== 'function') return { ok: false, why: 'derive 不是函数' };
  const preset = SD.findPreset('half');
  if (!preset) return { ok: false, why: '内置半份规格不在场' };
  const d = deriveFn(ANCHOR_LINES, AUX, preset.coef);
  const qty = d.lines.map((l) => l.quantity);
  if (JSON.stringify(qty) !== JSON.stringify([100, 35, 10, 21, 20])) return { ok: false, why: '缩放后用量 = ' + JSON.stringify(qty) };
  if (d.auxFen !== 35) return { ok: false, why: "辅料桶 = " + d.auxFen };
  const r = ENG.calcCostCard({ lines: d.lines, auxFen: d.auxFen, lossPct: LOSS, mode: 'A', priceFen: 0 });
  if (r.unit_cost_fen !== 567) return { ok: false, why: '半份成本 = ' + r.unit_cost_fen };
  const rp = ENG.calcCostCard({ lines: d.lines, auxFen: d.auxFen, lossPct: LOSS, mode: 'A', priceFen: 1820 });
  if (rp.gross_profit_fen !== 1253) return { ok: false, why: '半份毛利 = ' + rp.gross_profit_fen };
  if (rp.gross_margin_pct !== 68.85) return { ok: false, why: '半份毛利率 = ' + rp.gross_margin_pct };
  return { ok: true, why: '用量/辅料/567/1253/68.85 五项全中' };
}

if (!SD || !ENG) {
  bad('L3 生产件加载失败（fail-closed）：' + loadErr);
} else {
  const base = ENG.calcCostCard({ lines: ANCHOR_LINES, auxFen: AUX, lossPct: LOSS, mode: 'A', priceFen: PRICE });
  if (base.unit_cost_fen !== 975 || base.material_total_fen !== 876) {
    bad('L3-① 旧锚点已漂（基础份 ' + base.material_total_fen + '/' + base.unit_cost_fen + '，应 876/975）');
  } else ok('L3-① 旧锚点未漂：基础份 material_total_fen 876 / unit_cost_fen 975（规格改动没碰主口径）');

  const j1 = judgeIdentity(SD.deriveSpec);
  if (j1.ok) ok('L3-② A-d 恒等：系数全 1 ⇒ 派生结果与原入参逐字节相同 —— ' + j1.why);
  else bad('L3-② A-d 恒等失败 —— ' + j1.why);

  const dIdn = SD.deriveSpec(ANCHOR_LINES, AUX, SD.unitCoef());
  const rIdn = ENG.calcCostCard({ lines: dIdn.lines, auxFen: dIdn.auxFen, lossPct: LOSS, mode: 'A', priceFen: PRICE });
  if (rIdn.unit_cost_fen === base.unit_cost_fen && rIdn.material_total_fen === base.material_total_fen) {
    ok('L3-③ A-d 恒等（引擎侧）：全 1 派生喂引擎 ⇒ ' + rIdn.unit_cost_fen + '/' + rIdn.material_total_fen + ' 与原值逐项相等');
  } else bad('L3-③ A-d 恒等（引擎侧）失败：' + rIdn.unit_cost_fen + '/' + rIdn.material_total_fen);

  const j2 = judgeHalf(SD.deriveSpec);
  if (j2.ok) ok('L3-④ A-e 半份锚点：' + j2.why);
  else bad('L3-④ A-e 半份锚点失败 —— ' + j2.why);

  // 反例：按 50% 定价（老板的直觉）⇒ 毛利率必须**低于**全份（证明"固定成本不减半"不是文案）
  const half = SD.deriveSpec(ANCHOR_LINES, AUX, SD.findPreset('half').coef);
  const r50 = ENG.calcCostCard({ lines: half.lines, auxFen: half.auxFen, lossPct: LOSS, mode: 'A', priceFen: 1400 });
  if (r50.gross_margin_pct === 59.5 && r50.gross_margin_pct < base.gross_margin_pct) {
    ok('L3-⑤ 反例坐实「半份按 50% 定价会掉毛利」：' + r50.gross_margin_pct + '% < 全份 ' + base.gross_margin_pct + '%（65% 定价才是正的）');
  } else bad('L3-⑤ 反例不符：50% 定价毛利率 = ' + r50.gross_margin_pct + '（应 59.5）');
}

// ===================== L4 契约落点 =====================
{
  const V = read('cloudfunctions/calcBom/validate.js') || '';
  if (!/line_kind/.test(V)) bad('L4-① calcBom/validate 把 line_kind 洗掉了（半份会退化成"全部减半"）');
  else if (!/cLines\.push\(\{[^}]*line_kind/.test(V)) bad('L4-① calcBom/validate 提到 line_kind 但没进清洗后的行（等于没保留）');
  else ok('L4-① calcBom/validate 保留 line_kind 并落入清洗后的行');
}
{
  const I = read('cloudfunctions/calcBom/index.js') || '';
  const calls = /common\.deriveSpec\s*\(/.test(I);
  const out = /spec_results/.test(I);
  const base = /unit_cost_fen:\s*r\.unit_cost_fen/.test(I);
  if (!calls) bad('L4-② calcBom/index 没有调用 common.deriveSpec（规格试算没走单源）');
  else if (!out) bad('L4-② calcBom/index 没有返回 spec_results');
  else if (!base) bad('L4-② calcBom/index 的 unit_cost_fen 不再来自基础份结果（基础口径被污染）');
  else ok('L4-② calcBom/index 走单源派生 + 返回 spec_results + 基础 unit_cost_fen 仍取基础份');
}
{
  const S = read('cloudfunctions/saveCostCard/index.js') || '';
  const writes = /specs_json/.test(S) && /specsToJson/.test(S);
  const total = /total_cost:\s*result\.unit_cost_fen/.test(S);
  const noDerive = !/deriveSpec\s*\(/.test(S);
  if (!writes) bad('L4-③ saveCostCard 未落 specs_json（规格挂不上，改版本即丢）');
  else if (!total) bad('L4-③ saveCostCard 的 total_cost 不再取 result.unit_cost_fen（规格成本可能被写进主成本）');
  else if (!noDerive) bad('L4-③ saveCostCard 在保存路径上做了规格派生（规格成本不得进 total_cost —— 硬约束②）');
  else ok('L4-③ saveCostCard 落 specs_json 快照 且 total_cost 仍 = 基础份算法结果（规格成本零污染）');
}
{
  const G = read('cloudfunctions/getCostCard/service.js') || '';
  const hasSpecs = /specs:\s*specsFromJson\(/.test(G);
  const hasKind = /line_kind:\s*doc\.line_kind/.test(G);
  if (!hasSpecs) bad('L4-④ getCostCard 出参缺 specs（编辑页回填拿不到规格 ⇒ 一保存规格就丢）');
  else if (!hasKind) bad('L4-④ getCostCard 出参缺 line_kind（编辑页回填拿不到组件类型 ⇒ 规缩放悄悄变全 main）');
  else ok('L4-④ getCostCard 出参带 specs + line_kind（编辑-保存往返不丢字段）');
}

// ===================== L5 键集一致（前端 ≡ 后端单源） =====================
function termsOf(rel) {
  const s = read(rel);
  if (!s) return null;
  const grab = (key) => {
    const i = s.indexOf(key + ':');
    if (i < 0) return null;
    const a = s.indexOf('{', i);
    const b = s.indexOf('}', a);
    if (a < 0 || b < 0) return null;
    return s.slice(a + 1, b);
  };
  const keysOf = (body) => (body == null ? null : (body.match(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g) || []).map((x) => x.replace(/\s*:$/, '')));
  const lk = keysOf(grab('lineKind'));
  const sl = keysOf(grab('specLabel'));
  return { lineKind: lk, specLabel: sl };
}
const T1 = termsOf('miniprogram/i18n/terms.js');
const T2 = termsOf('specs/dev-specs/i18n/terms.js');
const wantKinds = SD ? SD.LINE_KINDS.slice().sort() : [];
const wantSpecs = SD ? SD.SPEC_PRESETS.map((p) => p.spec_key).sort() : [];
{
  const bads = [];
  for (const [name, T] of [['miniprogram', T1], ['specs 副本', T2]]) {
    if (!T || !T.lineKind) { bads.push(name + '：没有 lineKind 块'); continue; }
    const got = T.lineKind.slice().sort();
    if (JSON.stringify(got) !== JSON.stringify(wantKinds)) bads.push(name + '：' + JSON.stringify(got) + ' ≠ LINE_KINDS ' + JSON.stringify(wantKinds));
  }
  if (bads.length) bad('L5-① 组件键集 ≠ 后端 LINE_KINDS：' + bads.join('；') + '（键名漂了 ⇒ 系数查不到、规格试算恒等于全份）');
  else ok('L5-① 双副本 terms.lineKind 键集 ≡ 后端 LINE_KINDS（' + wantKinds.length + ' 键：' + wantKinds.join('/') + '）');
}
{
  const bads = [];
  for (const [name, T] of [['miniprogram', T1], ['specs 副本', T2]]) {
    if (!T || !T.specLabel) { bads.push(name + '：没有 specLabel 块'); continue; }
    const got = T.specLabel.slice().sort();
    if (JSON.stringify(got) !== JSON.stringify(wantSpecs)) bads.push(name + '：' + JSON.stringify(got) + ' ≠ SPEC_PRESETS ' + JSON.stringify(wantSpecs));
  }
  if (bads.length) bad('L5-② 规格键集 ≠ 后端 SPEC_PRESETS：' + bads.join('；'));
  else ok('L5-② 双副本 terms.specLabel 键集 ≡ 后端 SPEC_PRESETS（' + wantSpecs.join('/') + '，页面只送键不送系数）');
}
{
  // 页面**不得**自抄系数表：出现「half/small + 0.5/0.7」同行的形态即红（注释行不算）
  const pageFiles = ['pages/card/edit.js', 'pages/card/edit.wxml', 'pages/card/edit.wxss'];
  const hits = [];
  for (const f of pageFiles) {
    const s = read(f);
    if (!s) continue;
    for (const ln of s.split(/\r?\n/)) {
      if (/^\s*\/\//.test(ln) || /<!--/.test(ln)) continue;
      if (/['"]?(half|small)['"]?\s*:\s*\{?[^}]*0?\.\d/.test(ln)) hits.push(f + '：' + ln.trim().slice(0, 70));
    }
  }
  if (hits.length) bad('L5-③ 页面自抄规格系数：\n     ' + hits.join('\n     '));
  else ok('L5-③ 三个页面文件均未自抄规格系数（' + pageFiles.length + ' 个文件，系数只有服务端一份）');
}

// ===================== S1~S2 自失效护栏 =====================
if (engineCopies.length >= 3) ok('S1-① 引擎副本 ' + engineCopies.length + ' 份 ≥ 3（扫描面被改小即转红）');
else bad('S1-① 引擎副本仅 ' + engineCopies.length + ' 份（< 3，L2-② 的扫描面被写窄）');
{
  const pages = ['pages/card/edit.js', 'pages/card/edit.wxml', 'pages/card/edit.wxss'].filter((f) => read(f) != null).length;
  if (pages >= 3) ok('S1-② 页面扫描面完整（' + pages + '/3 个文件在位）');
  else bad('S1-② 页面扫描面缺失：仅 ' + pages + '/3');
}
if (pass >= 18) ok('S2 断言数下界：本轮通过 ' + pass + ' 条 ≥ 18（删掉整段判据会跌破下界）');
else bad('S2 断言数仅 ' + pass + ' 条（< 18，判据面被写窄）');

// ===================== C1~C3 反恒真 =====================
// 影子①：不考虑系数为 1、一律 round 到 1e-6 —— 对"带小数的原值"会改数 ⇒ 恒等判据必须判否
const SHADOW_ROUND = (lines, auxFen, coef) => ({
  lines: (lines || []).map((l) => Object.assign({}, l, {
    quantity: Math.round((Number(l.quantity) || 0) * SD.coefOf(coef, SD.kindOf(l)) * 1e6) / 1e6,
  })),
  auxFen: Math.round((Number(auxFen) || 0) * SD.coefOf(coef, 'aux')),
});
// 影子②：忽略 line_kind、全部按 main 缩 —— 「调料不减半」退化成"全部减半" ⇒ 半份锚点判据必须判否
const SHADOW_IGNORE_KIND = (lines, auxFen, coef) => ({
  lines: (lines || []).map((l) => Object.assign({}, l, { quantity: (Number(l.quantity) || 0) * SD.coefOf(coef, 'main') })),
  auxFen: Math.round((Number(auxFen) || 0) * SD.coefOf(coef, 'aux')),
});
// 影子③：系数缺省按 0（而不是 1）—— 漏配一类就把那一类成本抹掉 ⇒ 恒等判据必须判否
const SHADOW_ZERO_DEFAULT = (lines, auxFen, coef) => {
  const c = (k) => (coef && typeof coef[k] === 'number' ? coef[k] : 0);
  return { lines: (lines || []).map((l) => Object.assign({}, l, { quantity: (Number(l.quantity) || 0) * c(SD.kindOf(l)) })), auxFen: Math.round((Number(auxFen) || 0) * c('aux')) };
};

if (!SD || !ENG) {
  bad('C 段无法执行（生产件未加载）');
} else {
  const c1 = judgeIdentity(SHADOW_ROUND);
  if (c1.ok) bad('C1 影子「一律 round」被判恒等 ⇒ 恒等判据无分辨力（假绿）');
  else ok('C1 影子「一律 round」被判否（恒等判据有分辨力）—— ' + c1.why);

  const c2 = judgeHalf(SHADOW_IGNORE_KIND);
  if (c2.ok) bad('C2 影子「忽略 line_kind」被判半份通过 ⇒ 「调料不减半」无人守（假绿）');
  else ok('C2 影子「忽略 line_kind」被判否（半份锚点有分辨力）—— ' + c2.why);

  const c3 = judgeIdentity(SHADOW_ZERO_DEFAULT);
  if (c3.ok) bad('C3 影子「系数缺省 0」被判恒等 ⇒ 漏配一类的成本会归零而无人知（假绿）');
  else ok('C3 影子「系数缺省 0」被判否 —— ' + c3.why);

  // 正样本互证：真派生必须同时通过两条判据（否则上面的"判否"可能只是判据恒假）
  const p1 = judgeIdentity(SD.deriveSpec), p2 = judgeHalf(SD.deriveSpec);
  if (p1.ok && p2.ok) ok('C4 正样本互证：真派生同时通过恒等与半份两条判据（判据不恒假）');
  else bad('C4 正样本互证失败：恒等 ' + p1.ok + ' / 半份 ' + p2.ok + ' —— ' + p1.why + ' | ' + p2.why);
}

console.log('');
console.log('===== 多规格派生层守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
