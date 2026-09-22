// tools/check_archive_grace.js —— 【R118】归档补录宽限期口径穿透守卫（计算常量 ≡ 服务端文案 ≡ 前端 i18n ≡ 决策声明）
// 运行：node tools/check_archive_grace.js
//
// 为什么需要它（**同族病第 22 例**，2026-09-22 round89 反向扫描发现）：
//   「归档后 7 天内可补录、超过 7 天硬锁」是 `core/13 §3` **已锁死决策**（李老师拍板），
//   且同时是**用户可见承诺**与**写操作拦截边界**。实扫（round89，回源实扫、不采信任何自述）却发现有
//   **四类互不引用的落点**，任何一类改了另外三类都不会报警：
//     ① **计算常量**（唯一真正决定放不放行的点）
//        `cloudfunctions/saveLedger/index.js:25` `const GRACE_DAYS_MS = 7 * 24 * 3600 * 1000;`
//     ② **服务端错误文案**（用户被拒时看到的话，硬编码字面、不引用常量）
//        `cloudfunctions/saveLedger/index.js:63` 「归档月份为只读，仅归档后 7 天内可补录（需二次确认）」
//     ③ **前端 i18n 四条文案**（归档弹窗 + 补录确认弹窗，双副本）
//        `miniprogram/i18n/terms.js:153/154/557/559` 与 `specs/dev-specs/i18n/terms.js` 同四行
//     ④ **决策文档声明** `core/13 §3` 「补录（7 天宽限）…超过 7 天硬锁」
//
//   实扫证据：
//   ① `grep -rn "GRACE_DAYS_MS" tools/ specs/dev-specs/prototype/ verify_all.js` ⇒ **零命中** ⇒ 零守卫；
//   ② `grep -rn "GRACE_DAYS_MS" specs/` ⇒ **零命中** ⇒ 连文档都没记这个常量名；
//   ③ 「7 天」在本仓**高度多义**（token TTL 7 天 / 云开发回档仅 7 天 / 导出文件 7 天过期 /
//      到期前 7 天提醒 / 投喂包批次 7）⇒ **裸扫「7 天」必误杀一大批**（坑⑭ 第九次印证）
//      ⇒ 只能走「语义标记单源 + 就近锚点」，不裸扫。
//
//   ⇒ 后果（比第 21 例更硬，因为它同时是承诺与拦截）：
//     · ①改成 3 天：用户按弹窗「7 天内仍可补录」在第 5 天操作 ⇒ **被硬拒**，
//       而 `core/13` 决策仍写 7 天 ⇒ 李老师按决策验收通过，实际 3 天就锁（**业务真的挡住了补录**）；
//     · ①改成 14 天：第 10 天补录**能成功**，但两处弹窗仍承诺「7 天内」⇒ 承诺与实现不符；
//     · 只改 ② 或 ③：文案说的天数与真实拦截边界分叉 ⇒ 用户被误导，门禁全绿无人报警。
//   ⇒ **「缺守卫」与「已违规」分开上报**（round55 纪律）：实扫当前四类**同值 7、零漂移**，
//     本守卫做的是**防复发**（当前无错误数据）。
//
// 判据（穿透五条腿 + 前提 + 弱面，缺一不可）：
//   B1 扫描面 fail-closed：五份目标文件存在且非空（路径写错 = 扫空 ⇒ 红，不许 catch 静默跳过）。
//   B2 单源可解析（fail-closed）+ **算术求值**（`7 * 24 * 3600 * 1000` 与 `604800000` 等价 ⇒ 换写法不错杀）。
//   B3 唯一声明处 ≡ 实算，且**标记词在扫描面出现且仅出现 1 次**（单源不扩散）。
//   B4 服务端错误文案 ≡ 实算（用户被拒时看到的天数必须就是真实边界）。
//   B5 前端 i18n 四条文案 ≡ 实算（**双副本**都要对；双副本这四条取值也要相等）。
//   B6 前提守卫：目标文件确在扫描面内 + md 扫描面达下界（排除面没打错）。
//   W  弱面：明示「N 天」的其它合法口径（只打印不判红）——证明本守卫不能裸扫。
//
// ⚠️ 明写边界：本守卫**不校验** `REFRESH_WINDOW_MS`（admin token 刷新窗口 24h）——
//    该常量实扫 `specs/` 零提及（无声明面可守），属「先立声明再谈守卫」，已登记 round89 待办。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_REL = 'cloudfunctions/saveLedger/index.js';          // ① 计算常量 + ② 服务端文案都在这一份
const I18N_REL = 'miniprogram/i18n/terms.js';                   // ③ 前端文案主副本
const I18N_MIRROR_REL = 'specs/dev-specs/i18n/terms.js';        // ③ 前端文案派生副本
const DECL_REL = 'specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md'; // ④ 唯一声明处
const SPEC_MD_DIR = path.join(ROOT, 'specs');

const MIN_BYTES = 200;
const MD_FLOOR = 25;                       // 坑㉛：下界取实测保守值（round89 实测 specs 全树 .md = 30）
// ③ 前端四条文案的 key（round89 实扫定位：153/154/557/559）
const I18N_KEYS = ['graceArchive', 'confirmArchive', 'graceNote', 'confirmGraceSave'];
// ④ 语义标记（坑⑮：标记词只许出现在唯一声明处，NOTE/演进链一律换普通措辞）
const MARK = '归档宽限口径（唯一声明处）';

const GRACE_RE = /const\s+GRACE_DAYS_MS\s*=\s*([0-9\s*+/().-]+?)\s*;/;
const MSG_RE = /仅归档后\s*(\d+)\s*天内可补录/;
const DECL_RE = new RegExp('🔢\\s*' + MARK.replace(/[()（）]/g, (m) => '\\' + m) + '[^\\n]*');
// ⚠️ 允许 `**7** 天` 加粗写法（`[*\s]{0,2}`）⇒ 声明处换排版风格不错杀（round58「正确实现换写法须仍绿」）
const DAY_RE = /(\d+)[*\s]{0,4}天/g;

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}

function readRel(rel) {
  try {
    const p = path.join(ROOT, rel);
    const st = fs.statSync(p);
    return { text: fs.readFileSync(p, 'utf8'), bytes: st.size, ok: true };
  } catch (_) {
    return { text: '', bytes: 0, ok: false };
  }
}

/** 工作树递归（坑⑱：不用 git ls-files，那只扫 index） */
function walk(dir, exts, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === 'miniprogram_npm' || e.name === '.git') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(abs);
  }
  return out;
}

/** 算术求值（round82 配方：只收白名单字符 ⇒ `7 * 24 * 3600 * 1000` 与 `604800000` 等价） */
function evalExpr(expr) {
  if (!/^[0-9\s*+/().-]+$/.test(expr)) return null;
  try {
    const v = Function(`"use strict"; return (${expr});`)();
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch (_) { return null; }
}

const src = readRel(SRC_REL);
const i18n = readRel(I18N_REL);
const i18nM = readRel(I18N_MIRROR_REL);
const decl = readRel(DECL_REL);
const mdFiles = walk(SPEC_MD_DIR, ['.md'], []);

// ⚠️ banner **不能用 `=====`**：R66 的 `SECTION_HEAD` 会把 `===== x =====` 当成段标题并做「零断言即判红」，
//    而本守卫在 banner 后立刻开 B1 子段 ⇒ banner 段零断言 ⇒ 假红（round88 坑㉟ 实证）⇒ 用纯文本。
console.log(`单源 ${SRC_REL} / i18n ${I18N_REL}（+镜像）/ 声明 ${DECL_REL} / md 扫描面 ${mdFiles.length} 份`);
console.log('R118 · 归档补录宽限期口径穿透守卫（计算常量 ≡ 服务端文案 ≡ 前端 i18n ≡ 决策声明）');

// —— B1 扫描面 fail-closed
console.log('\n===== B1 扫描面 fail-closed =====');
check('B1-① 单源文件（常量 + 服务端文案）存在且非空', src.ok && src.bytes >= MIN_BYTES, `${src.bytes}B`);
check('B1-② 前端 i18n 主副本存在且非空', i18n.ok && i18n.bytes >= MIN_BYTES, `${i18n.bytes}B`);
check('B1-③ 前端 i18n 派生副本存在且非空', i18nM.ok && i18nM.bytes >= MIN_BYTES, `${i18nM.bytes}B`);
check('B1-④ 唯一声明处文件存在且非空', decl.ok && decl.bytes >= MIN_BYTES, `${decl.bytes}B`);
check(`B1-⑤ md 扫描面达下界（坑㉛：路径写错即红）`, mdFiles.length >= MD_FLOOR, `${mdFiles.length}/${MD_FLOOR}`);

// —— B2 单源可解析（fail-closed + 算术求值）
console.log('\n===== B2 单源可解析（fail-closed + 算术求值）=====');
const gM = src.text.match(GRACE_RE);
const gVal = gM ? evalExpr(gM[1]) : null;
check('B2-① GRACE_DAYS_MS 声明可解析（删掉即红）', gVal !== null, gM ? `${gM[1].trim()} = ${gVal}` : '未匹配');
const N = gVal === null ? null : Math.round(gVal / 86400000);
check('B2-② 取值为正整数天（整天，可折算）',
  gVal !== null && gVal > 0 && gVal % 86400000 === 0, gVal === null ? 'n/a' : `${gVal}ms = ${N} 天`);
check('B2-③ 关键：单源确被归档守卫使用（不是死常量）',
  /withinGrace\s*=\s*\(now\s*-\s*archivedAt\)\s*<\s*GRACE_DAYS_MS/.test(src.text),
  /GRACE_DAYS_MS/.test(src.text) ? 'GRACE_DAYS_MS 在归档守卫表达式内' : '已无引用');

// —— B3 唯一声明处 ≡ 实算（+ 单源不扩散）
console.log('\n===== B3 唯一声明处 ≡ 实算（单源不扩散）=====');
const declLine = decl.text.split(/\r?\n/).find((l) => l.includes(MARK)) || null;
check('B3-① 声明行存在（fail-closed，删掉即红）', declLine !== null, declLine ? declLine.trim().slice(0, 60) + '…' : '未找到');
const declDays = declLine ? [...declLine.matchAll(DAY_RE)].map((m) => Number(m[1])) : [];
check(`B3-② 声明行内每个「N 天」≡ 实算 ${N} 天（含「超过 N 天硬锁」）`,
  declDays.length > 0 && declDays.every((d) => d === N), `命中 ${declDays.join(',')} vs ${N}`);
const markHits = mdFiles.filter((f) => {
  try { return fs.readFileSync(f, 'utf8').includes(MARK); } catch (_) { return false; }
}).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
check(`B3-③ 标记词在 md 扫描面出现且仅 1 次（单源不扩散，坑⑮）`,
  markHits.length === 1, markHits.length ? markHits.join(' | ') : '零命中 ⇒ 声明面写错');

// —— B4 服务端错误文案 ≡ 实算
console.log('\n===== B4 服务端错误文案 ≡ 实算（用户被拒时看到的天数）=====');
const msgM = src.text.match(MSG_RE);
const msgDay = msgM ? Number(msgM[1]) : null;
check('B4-① 服务端文案「仅归档后 N 天内可补录」可解析（fail-closed）', msgM !== null,
  msgM ? `文案 ${msgDay} 天` : '未匹配（文案被改写/删除）');
check(`B4-② 文案天数 ${msgDay} ≡ 实算 ${N}`, msgDay !== null && msgDay === N, `${msgDay} vs ${N}`);

// —— B5 前端 i18n 四条文案 ≡ 实算（双副本）
console.log('\n===== B5 前端 i18n 四条文案 ≡ 实算（双副本）=====');
function keyDays(text, key) {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_$])${key}\\s*:\\s*'([^']*)'`);
  const m = text.match(re);
  if (!m) return null;
  return [...m[1].matchAll(DAY_RE)].map((x) => Number(x[1]));
}
let b5ok = 0;
for (const k of I18N_KEYS) {
  const days = keyDays(i18n.text, k);
  const good = days !== null && days.length > 0 && days.every((d) => d === N);
  if (good) b5ok++;
  check(`B5-${k} 主副本≡实算 ${N} 天`, good, days === null ? 'key 缺失' : `命中 ${days.join(',')}`);
}
let mirBad = [];
for (const k of I18N_KEYS) {
  const days = keyDays(i18nM.text, k);
  if (!(days !== null && days.length > 0 && days.every((d) => d === N))) mirBad.push(k);
}
check(`B5-⑤ 派生副本四条 ≡ 实算 ${N} 天`, mirBad.length === 0, mirBad.length ? mirBad.join(' | ') : '四条全对');
const eqBad = I18N_KEYS.filter((k) => {
  const a = keyDays(i18n.text, k), b = keyDays(i18nM.text, k);
  return JSON.stringify(a) !== JSON.stringify(b);
});
check('B5-⑥ 双副本四条取值逐条相等（不重复 K11 全文件，只守本口径）',
  eqBad.length === 0, eqBad.length ? eqBad.join(' | ') : '四条一致');

// —— B6 前提守卫
console.log('\n===== B6 前提守卫 =====');
check('B6-① 前提：四份目标文件都在扫描面内（路径没写错）',
  src.ok && i18n.ok && i18nM.ok && decl.ok, `${SRC_REL} / ${I18N_REL} / ${I18N_MIRROR_REL} / ${DECL_REL}`);
check('B6-② 前提：md 扫描面确含唯一声明处（排除面没打错）',
  mdFiles.some((f) => f.replace(/\\/g, '/').endsWith('core/13_上线前查缺补漏_决策与待办总览.md')), 'core/13 在内');

// —— W 弱面（只明示不判红）
console.log('\n===== W 弱面（只明示不判红）=====');
const otherDays = [];
for (const f of mdFiles) {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  t.split(/\r?\n/).forEach((l, i) => {
    if (l.includes('补录')) return;                       // 本口径，已由 B3/B4/B5 硬判
    const m = [...l.matchAll(DAY_RE)];
    if (m.length) otherDays.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1} ${m.map((x) => x[1] + '天').join('/')}`);
  });
}
console.log(`  ⚠️ 「N 天」的其它合法口径（token TTL / 云回档 / 导出过期 / 到期提醒…）—— 证明本守卫不能裸扫：`);
console.log(`     ${otherDays.length} 处，例：${otherDays.slice(0, 3).join(' | ') || '（无）'}`);
check(`W-① 弱面已打印（坑⑭：裸扫「7 天」必误杀 ${otherDays.length} 处）`, otherDays.length >= 1, `${otherDays.length} 处`);

console.log(`\n===== 归档补录宽限期口径穿透守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
