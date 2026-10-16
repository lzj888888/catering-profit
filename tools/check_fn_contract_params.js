// tools/check_fn_contract_params.js —— 【R301】云函数「**契约入参 vs 实现**」守卫
// 运行：node tools/check_fn_contract_params.js      （EXIT 0 = 全绿）
//
// 为什么立它（真缺陷，R301 实测的**契约与实现分歧**）：
//   契约 `specs/dev-specs/core/10_云函数清单与接口契约.md` 的 `getDishReview` 一行**一直**声明
//   入参 `{ shop_id, biz_date_from, biz_date_to, ... }`、出参 `{ range{from,to}, ... }`，
//   而实现**从未读取过 `biz_date_from/to`** ⇒ 复盘榜把该店**历次导入的多个月份全部累加**
//   当成一份榜，页面却按"当前月"呈现 ⇒「这道菜这个月卖过」是**错的**（静默错数，真样本就是 7 天表）。
//
// ⚠️ 而**既有守卫一条都抓不到** —— 不是判据写错，是**压根没有这一层**：
//   · `check_fn_inventory`（R62）守「**函数清单 ≡ 契约文档**」⇒ 只比**函数名在不在**，`getDishReview` 在 ⇒ 绿；
//   · `check_data_contract`（R97）守**跨函数字段名 / 主键语义**（C1~C4），不读契约的入参声明；
//   · 各函数 selftest 直接构造入参，**不走契约**。
//   ⇒ 「契约声明的入参形状 vs 实现」这一层，本仓此前**零覆盖**。
//
// 判据（四组，全部 fail-closed）：
//   ① 契约表解析成功：行数 ≥40、参数总数 ≥120（防解析失效 ⇒ 零命中假绿）
//   ② 双向对拍：契约里每个入参名，必须在 `cloudfunctions/<fn>/**.js` 里**剥注释后**出现；
//      未出现者**要么**修实现、**要么**在 `EXEMPT` 里带 `why` 显式登记
//   ③ 登记表双向防腐：**无僵尸键**（登记的 fn 目录/参数已不在契约里）、**无空转键**（登记项其实已实现）
//   ④ 反恒真：判据本体喂一个「未实现」样本必须判红、喂「已实现」样本必须判绿
//
// 🔴 本文件**不使用段标题**（`===`/`---` 包裹）—— 本仓 R66 判据规定「段标题下 ✅==0 即判红」。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTRACT_REL = 'specs/dev-specs/core/10_云函数清单与接口契约.md';
const CF_DIR = 'cloudfunctions';

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); }
}
function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

// 🔴 剥注释：不剥的话，**契约原文被抄进实现文件的注释里**就会「喂饱」判据
//   （本仓 R298Y「被注释喂成恒真」同族，实测踩过）。等长空格替换、保留换行。
function stripComments(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// ============ ① 解析契约表 ============
let md = '';
try { md = fs.readFileSync(path.join(ROOT, CONTRACT_REL), 'utf8'); } catch (e) { md = ''; }
ok('①-a 契约文档可读且非空', md.length > 2000, md ? md.length + ' 字符' : '读不到');

const PARAM_NAME_RE = /^[a-z_][a-z0-9_]*$/;
// 🔴 函数名与参数名**必须用两个正则**（首版复用了参数名那条 ⇒ 大写字母被拒 ⇒ 解析到 **0 行**、
//   下界判红。判据自身写错时，"命中 0" 与 "判据坏了" 长得一样 —— 这就是下界要 fail-closed 的理由）。
const FN_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/**
 * 从契约的「入参」单元格里取出**顶层**入参名集合。
 * 🔴 必须**花括号配平 + 顶层逗号切分**，不能用 `/\{[^}]*\}/` 猜：
 *   实测契约里 `{ nodes:[{id,type,children[],qty,loss_pct,...}] }` 这种**嵌套**写法，
 *   正则版会把 `type` / `children` / `qty` / `loss_pct` 当成**入参名** ⇒ 对契约没声明的字段报警（假红）。
 */
function topLevelParamNames(cell) {
  const s = String(cell == null ? '' : cell).replace(/`/g, '');
  const out = new Set();
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) break;                                  // 配平失败 ⇒ 停（fail-closed）
    const inner = s.slice(i + 1, j);
    let d2 = 0;
    let cur = '';
    const parts = [];
    for (const ch of inner) {
      if (ch === '{' || ch === '[') d2++;
      else if (ch === '}' || ch === ']') d2--;
      if (ch === ',' && d2 === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    for (const p of parts) {
      const n = p.trim().replace(/\?$/, '').split(':')[0].trim();
      if (PARAM_NAME_RE.test(n)) out.add(n);
    }
    i = j;
  }
  return out;
}

const rows = [];
for (const line of md.split(/\r?\n/)) {
  if (!/^\|\s*`[A-Za-z]/.test(line)) continue;
  // 按**未转义**的 `|` 切列（契约里用 `\|` 表示字面竖线，naive split 会把列切错）
  const cells = line.split(/(?<!\\)\|/).map((s) => s.trim());
  if (cells.length < 6) continue;
  const fn = (cells[1] || '').replace(/`/g, '').trim();
  if (!FN_NAME_RE.test(fn)) continue;
  const names = topLevelParamNames(cells[3]);
  if (names.size) rows.push({ fn, params: Array.from(names) });
}
const totalParams = rows.reduce((s, r) => s + r.params.length, 0);
ok('①-b 扫描面下界：契约里带入参的函数行 ≥ 40', rows.length >= 40, '实 ' + rows.length);
ok('①-c 扫描面下界：契约入参总数 ≥ 120', totalParams >= 120, '实 ' + totalParams);

/** 判据本体：读某函数目录全部 .js（剥注释）拼成一份源码，判参数名在不在。与 ④ 的样本共用。 */
function fnSourceIsolated(fn) {
  const dir = path.join(ROOT, CF_DIR, fn);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')); } catch (e) { return null; }
  if (!files.length) return null;
  return stripComments(files.map((f) => {
    try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return ''; }
  }).join('\n'));
}
function implementedIn(src, param) {
  return !!src && new RegExp('\\b' + param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(src);
}

// ============ ② 双向对拍 ============
// 🔴 豁免登记（每条必须带 why）。这三条是 R301 全量对拍后**仅存**的分歧，逐条定性留痕：
//   · `calcBom.nodes` —— 契约该行**已过期**：实现走 `validateInput(event)` → `v.card`（卡结构），
//      不是契约写的 `nodes:[{id,type,...}]`。⇒ 属**待更正的契约缺陷**，不是"实现漏了"。
//   · `getPlan.include_deleted` —— 契约**声明了但没做**（"看已删方案"这个能力不存在）⇒ 软缺陷，
//      登记待排期（不影响正确性，只影响能力面）。
//   · `adminRevokeToken.client_request_id` —— 契约**权限列标 `adminAuth+超管`（无「+幂等」）**
//      ⇒ 该入参在契约里是**残留**，与本仓「标了 +幂等 才必须有 findPriorResult」的约定自洽。
const EXEMPT = {
  'calcBom.nodes': '契约该行已过期：实现走 validateInput(event) → v.card，入参名与契约不符（待更正契约）',
  'getPlan.include_deleted': '契约声明但未实现（"看已删方案"能力不存在）⇒ 登记待排期，不影响正确性',
  'adminRevokeToken.client_request_id': '契约权限列无「+幂等」⇒ 该入参为契约残留（见本仓幂等约定）',
};

const missing = [];
const presentCount = { n: 0 };
for (const r of rows) {
  const src = fnSourceIsolated(r.fn);
  if (src === null) continue;                       // 目录不存在/无 js ⇒ 交给 check_fn_inventory 管
  for (const p of r.params) {
    if (implementedIn(src, p)) { presentCount.n++; continue; }
    missing.push(r.fn + '.' + p);
  }
}
const unregistered = missing.filter((k) => !Object.prototype.hasOwnProperty.call(EXEMPT, k));
ok('②-a 🔴 契约里每个入参都被实现引用（或已显式登记 why）',
  unregistered.length === 0,
  unregistered.length ? '未实现且未登记：' + unregistered.join(' , ') : '已实现 ' + presentCount.n + ' 个 / 登记 ' + Object.keys(EXEMPT).length + ' 个');

// ============ ③ 登记表双向防腐 ============
const zombie = Object.keys(EXEMPT).filter((k) => {
  const [fn, p] = k.split('.');
  const r = rows.find((x) => x.fn === fn);
  return !r || r.params.indexOf(p) < 0 || fnSourceIsolated(fn) === null;
});
ok('③-a 🔴 EXEMPT 无僵尸键（登记的 fn/参数必须仍在契约里且有实现目录）—— 防契约更新后豁免悄悄失效',
  zombie.length === 0, zombie.length ? zombie.join(' , ') : '无');
const idle = Object.keys(EXEMPT).filter((k) => {
  const [fn, p] = k.split('.');
  return implementedIn(fnSourceIsolated(fn), p);
});
ok('③-b 🔴 EXEMPT 无空转键（登记项必须**真的**未实现）—— 防豁免表变成躲避修复的垃圾桶',
  idle.length === 0, idle.length ? idle.join(' , ') : '无');
ok('③-c 每条豁免都带 why（≥15 字）', Object.keys(EXEMPT).every((k) => String(EXEMPT[k]).length >= 15),
  Object.keys(EXEMPT).length + ' 条');

// ============ ④ 反恒真 ============
const SAMPLE_EMPTY = stripComments('// 只提到 biz_date_from 的注释\nconst x = 1;');
const SAMPLE_OK = stripComments('const a = event.biz_date_from;\nconst b = v.input.biz_date_to;');
ok('④-a 反恒真：未实现样本（参数名只出现在**注释**里）必须判未实现'
  + ' —— 证明判据没被注释喂成恒真',
  !implementedIn(SAMPLE_EMPTY, 'biz_date_from') && !implementedIn(SAMPLE_EMPTY, 'biz_date_to'));
ok('④-b 正样本：真读了参数的样本必须判已实现',
  implementedIn(SAMPLE_OK, 'biz_date_from') && implementedIn(SAMPLE_OK, 'biz_date_to'));
ok('④-c 正样本：本轮修的 getDishReview 确有 biz_date_from / biz_date_to',
  implementedIn(fnSourceIsolated('getDishReview'), 'biz_date_from')
  && implementedIn(fnSourceIsolated('getDishReview'), 'biz_date_to'));
ok('④-d 反恒真：解析器对「转义竖线」的契约行不得切错列（用一行真契约行验形状）',
  (() => {
    const line = md.split(/\r?\n/).find((l) => l.indexOf('`clearSalesBills`') === 0
      || /^\|\s*`clearSalesBills`/.test(l));
    if (!line) return false;
    const cells = line.split(/(?<!\\)\|/).map((s) => s.trim().replace(/`/g, ''));
    return /^\{\s*shop_id/.test(cells[3] || '') && cells[4].indexOf('cleared_rows') >= 0;
  })());

// ============ 结论 ============
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 契约入参 vs 实现 校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ 契约入参 vs 实现 校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 契约入参 vs 实现 校验通过（契约 ' + rows.length + ' 行 / 入参 ' + totalParams
  + ' 个 / 已实现 ' + presentCount.n + ' / 登记 ' + Object.keys(EXEMPT).length + '）');
console.log('✅ 契约入参 vs 实现 校验：' + total + ' 通过 / 0 失败');
