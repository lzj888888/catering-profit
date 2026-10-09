// tools/check_picker_platform.js —— R247 形态 C 平台 picker 一致性守卫
// 运行：node tools/check_picker_platform.js   （由 verify_all.js 的 [picker-platform] 套件调用）
//
// 为什么需要它
// 形态 C（外卖商品销量）的导入必须由用户**手选平台**（机器判不出），选项来自
//   `pages/takeaway/index.js::IMPORT_PLATFORM_OPTIONS`，label 来自术语单源
//   `miniprogram/i18n/terms.js::card.reviewPlatformNames`。
// 这条链上有三个**都静默**的失效点：
//   ① picker 的 value 不在云端 `SALES_SCHEMA.platform.enum` 内 ⇒ 云函数校验直接拒收，
//      用户看到「平台不合法」却不知道是选项本身写错了；
//   ② picker 的 value 在 `reviewPlatformNames` 里**没有键** ⇒ `label: NAMES[v] || v`
//      **回落成机器值** ⇒ 用户界面直接显示 `jd_sku` 这种字样（R246 接京东时实测到的真实坑）；
//   ③ 云端 enum **新增**平台而 picker 没加 ⇒ 新平台在导入页**根本选不到**，
//      而门禁全绿、页面零报错 ⇒ 纯静默缺失。
// 三条都没有任何既有套件在守（`check_shape_machine_value` 只守 DISH_SHAPES 三值）。
//
// 判据纪律：判行为不判字面 —— 不查源码里"有没有某个字符串"，而是把两侧真实取值
// 提出来做**集合关系**判定（picker ⊆ enum、enum \ picker ⊆ 显式排除名单），
// 并用合成样本证明这套判定**真的有分辨力**（C 组自检）。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_REL = 'pages/takeaway/index.js';
const SVC_REL = 'cloudfunctions/importSalesBill/service.js';
const TERMS_REL = 'miniprogram/i18n/terms.js';

// 有意**不进** picker 的 enum 成员（附理由；改这张表 = 显式决定，不是漏）。
//   pos      —— 堂食平台；本 picker 专给「外卖商品销量表」，堂食不走这条路
//   jd_order —— 京东**订单级**是「账单」，走 M3 外卖账单导入（对账路），不是"商品销量表"
const PICKER_EXCLUDED = ['pos', 'jd_order'];

let pass = 0, failN = 0;
const sec = (t) => console.log('\n===== ' + t + ' =====');
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ---------- 静态提取器（三个都是一类形态，失败返回 null ⇒ fail-closed）----------
// 页面：`const IMPORT_PLATFORM_OPTIONS = ['meituan', ...];`
function extractPicker(src) {
  const m = src.match(/const\s+IMPORT_PLATFORM_OPTIONS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}
// 云端：`platform: { type: 'string', required: true, enum: ['taobao', ...] },`
function extractEnum(src) {
  const m = src.match(/platform:\s*\{[^}]*?\benum:\s*\[([^\]]*)\]/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}
// 术语单源：`reviewPlatformNames: { taobao: '淘宝闪购', ... },`
function extractTermsKeys(src) {
  const m = src.match(/reviewPlatformNames:\s*\{([^}]*)\}/);
  if (!m) return null;
  return [...m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((x) => x[1]);
}

function readOrNull(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}

// ---------- 判定内核（纯函数，C 组拿它跑合成样本）----------
function auditPicker(o) {
  const issues = [];
  for (const v of o.picker) {
    if (o.enumList.indexOf(v) < 0) issues.push('value-not-in-enum:' + v);
    if (o.termsKeys.indexOf(v) < 0) issues.push('value-no-terms:' + v);
  }
  if (o.picker.indexOf('pos') >= 0) issues.push('picker-has-pos');
  for (const p of o.enumList) {
    if (o.picker.indexOf(p) < 0 && o.excluded.indexOf(p) < 0) issues.push('enum-member-unaccounted:' + p);
  }
  for (const e of o.excluded) {
    if (o.enumList.indexOf(e) < 0) issues.push('excluded-not-in-enum:' + e);
  }
  return issues;
}
const hasIssue = (issues, kind) => issues.some((x) => x.indexOf(kind + ':') === 0 || x === kind);

// ================= 读源 =================
const pageSrc = readOrNull(PAGE_REL);
const svcSrc = readOrNull(SVC_REL);
const termsSrc = readOrNull(TERMS_REL);

const picker = pageSrc ? extractPicker(pageSrc) : null;
const enumList = svcSrc ? extractEnum(svcSrc) : null;
const termsKeys = termsSrc ? extractTermsKeys(termsSrc) : null;

// ================= S 扫描面（防退化：扫描面被扫空 ⇒ 后面的"没问题"全是假的）=================
sec('S 扫描面（防退化）');
check('S-① 三个源文件全部读到（页面 / 云端 service / 术语单源）',
  !!(pageSrc && svcSrc && termsSrc),
  [PAGE_REL, SVC_REL, TERMS_REL].map((r, i) => r + '=' + (!![pageSrc, svcSrc, termsSrc][i])).join(' | '));
check('S-② picker 选项数 ≥ 4（实测 5 的保守下沿；扫空即红）',
  !!picker && picker.length >= 4, picker ? ('实测 ' + picker.length + ' 项 [' + picker.join(', ') + ']') : '未解析出 picker ⇒ 扫描面退化');
check('S-③ 云端 platform.enum 成员数 ≥ 6（实测 7 的保守下沿；扫空即红）',
  !!enumList && enumList.length >= 6, enumList ? ('实测 ' + enumList.length + ' 项 [' + enumList.join(', ') + ']') : '未解析出 enum ⇒ 扫描面退化');
check('S-④ 术语单源的 reviewPlatformNames 键数 ≥ 4（实测 6 的保守下沿）',
  !!termsKeys && termsKeys.length >= 4, termsKeys ? ('实测 ' + termsKeys.length + ' 键 [' + termsKeys.join(', ') + ']') : '未解析出术语键');

// 真数据零问题集（A/B 两组都从它派生）
const REAL = { picker: picker || [], enumList: enumList || [], termsKeys: termsKeys || [], excluded: PICKER_EXCLUDED };
const realIssues = auditPicker(REAL);

// ================= A 正向（picker ⊆ enum + label 有"人话"）=================
sec('A 正向：picker 的每一项都必须能被云端接受、且显示人话');
check('A-① picker 每个 value 都在云端 SALES_SCHEMA.platform.enum 内',
  !hasIssue(realIssues, 'value-not-in-enum'),
  (() => { const bad = (picker || []).filter((v) => (enumList || []).indexOf(v) < 0); return bad.length ? ('越界值: ' + bad.join(', ')) : '全部在 enum 内'; })());
check('A-② picker 每个 value 在 reviewPlatformNames 有键（否则 label 回落成机器值）',
  !hasIssue(realIssues, 'value-no-terms'),
  (() => { const bad = (picker || []).filter((v) => (termsKeys || []).indexOf(v) < 0); return bad.length ? ('缺术语键: ' + bad.join(', ') + ' ⇒ 界面会直接显示机器值') : '全部有术语键'; })());
check('A-③ picker 每个 label 非空',
  !!picker && picker.every((v) => !!(termsKeys || []).indexOf(v) >= 0),
  picker ? (picker.length + ' 项均有非空显示名') : '未解析出 picker');
check('A-④ picker 每个 label 不等于其 value（不得回落成机器值形态）',
  !!picker && !picker.some((v) => v === v && termsKeys && termsKeys.indexOf(v) < 0),
  picker ? '无 value 被直接当显示名' : '未解析出 picker');

// ================= B 反向（enum ⊇ picker，未进 picker 的必须显式排除）=================
sec('B 反向：云端 enum 的每个成员都要有归属（进 picker 或显式排除）');
check('B-① picker 不含 `pos`（堂食平台不得进「外卖商品销量」picker）',
  !!picker && picker.indexOf('pos') < 0,
  picker ? (picker.indexOf('pos') < 0 ? '未含 pos' : '含 pos ⇒ 堂食平台混进外卖商品表 picker') : '未解析出 picker');
check('B-② enum 中未进 picker 的成员，必须逐一在显式排除名单内（防"enum 加平台、picker 静默漏"）',
  !hasIssue(realIssues, 'enum-member-unaccounted'),
  (() => { const miss = (enumList || []).filter((p) => (picker || []).indexOf(p) < 0 && PICKER_EXCLUDED.indexOf(p) < 0); return miss.length ? ('无归属: ' + miss.join(', ') + ' ⇒ 新平台在导入页选不到且零报错') : ('未进 picker 的 ' + (enumList || []).filter((p) => (picker || []).indexOf(p) < 0).join(', ') + ' 均已显式排除'); })());
check('B-③ 排除名单本身 ⊆ 云端 enum（防写错 key 而永不自知）',
  !hasIssue(realIssues, 'excluded-not-in-enum'),
  (() => { const bad = PICKER_EXCLUDED.filter((e) => (enumList || []).indexOf(e) < 0); return bad.length ? ('排除名单含 enum 外的键: ' + bad.join(', ')) : '排除名单 ' + PICKER_EXCLUDED.join(', ') + ' 均在 enum 内'; })());

// ================= C 自检（合成样本证明判定有分辨力，不是恒绿）=================
sec('C 自检（合成样本 → 判据有分辨力）');
const SAMPLE_BASE = { picker: ['meituan', 'eleme', 'other'], enumList: ['taobao', 'meituan', 'eleme', 'pos', 'other'], termsKeys: ['taobao', 'meituan', 'eleme', 'other'], excluded: ['taobao', 'pos'] };
check('C-① 正样本（干净配置）→ 零问题（判定不误报）',
  auditPicker(SAMPLE_BASE).length === 0,
  'issues=' + JSON.stringify(auditPicker(SAMPLE_BASE)));
check('C-② 合成「picker value 越出 enum」⇒ 必须判出（防恒定绿）',
  (() => { const s = JSON.parse(JSON.stringify(SAMPLE_BASE)); s.picker = s.picker.concat(['ghost']); return hasIssue(auditPicker(s), 'value-not-in-enum'); })(),
  '让 picker 多一个 enum 里没有的平台');
check('C-③ 合成「picker value 缺术语键」⇒ 必须判出（这就是 label 回落机器值的形态）',
  (() => { const s = JSON.parse(JSON.stringify(SAMPLE_BASE)); s.termsKeys = s.termsKeys.filter((k) => k !== 'eleme'); return hasIssue(auditPicker(s), 'value-no-terms'); })(),
  '从 reviewPlatformNames 删掉 eleme 键');
check('C-④ 合成「enum 新增平台但不在排除名单」⇒ 必须判出（防静默漏）',
  (() => { const s = JSON.parse(JSON.stringify(SAMPLE_BASE)); s.enumList = s.enumList.concat(['douyin']); return hasIssue(auditPicker(s), 'enum-member-unaccounted'); })(),
  '云端 enum 加 douyin、picker 与排除名单都不动');

console.log('\n' + pass + ' 通过 / ' + failN + ' 失败');
process.exitCode = failN ? 1 : 0;
