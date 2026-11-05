// review/evidence/r298_m1_audit/probe_empty_state_reachability.js
//
// R298 · M1 审计 · 探针①：月结果页「空态」分支的**可达性**证明
//
// ===== 为什么要写这条探针 =====
// 「存在性判据」抓不到「可达性缺陷」。tools/selftest_ui_fix.js 的「修 1 · result 三态」
// 五条断言全是「分支在场 / 文案 key 被引用」——**没有一条问**「这个空态分支到底会不会被渲染」。
// 而该文件自述的意图是「三态拆分 —— 空态（**无账本**或接口异常）」，判据却用 `{{r}}` 表达「无账本」。
//
// 本探针把「意图」与「判据」的错配**做成四步可机器复核的推导**：
//   L1  getLedger 对**无账记录**的月也**无条件**返回 result 对象（默认空账）
//   L2  result.js 无条件把 r 赋成对象（不在任何条件里）
//   L3  result.wxml 空态分支 = loading 与「r 为真」的**补集**
//   L4  ⇒ 由 L2/L3 得：loading===false 时 r 恒真 ⇒ **空态分支不可达**（死分支）
//   ⇒ 后果：未建档月份渲染 ¥0.00，且 trueFen=0 ⇒ bandClass='red' ⇒ 顶部挂**红带「亏损」**
//
// ===== 反恒真设计（本探针自己会不会恒真？）=====
// 影子样本 S1/S2/S3 用**同一份判定函数**跑，必须给出**不同**结论：
//   S1 = 真实现 ⇒ 判「空态不可达」（缺陷）
//   S2 = 只把模板判据换成含账本信号 ⇒ 判「可达」（无缺陷）
//   S3 = 只把 js 的 r 赋值加上条件 ⇒ 判「可达」（无缺陷）
// 若三条同结论 ⇒ 判定函数失效（探针自身坏）⇒ 响亮红。
//
// ===== 用法 =====
//   node review/evidence/r298_m1_audit/probe_empty_state_reachability.js          # 审计模式：打印结论，exit 0
//   node review/evidence/r298_m1_audit/probe_empty_state_reachability.js --gate   # 门禁模式：缺陷在场 ⇒ exit 1
//
// 范围：只读。不改任何业务源码。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const GATE = process.argv.indexOf('--gate') >= 0;

const P = {
  getLedger: path.join(ROOT, 'cloudfunctions', 'getLedger', 'index.js'),
  resultJs: path.join(ROOT, 'pages', 'month', 'result.js'),
  resultWxml: path.join(ROOT, 'pages', 'month', 'result.wxml'),
  monthIndexJs: path.join(ROOT, 'pages', 'month', 'index.js'),
  monthIndexWxml: path.join(ROOT, 'pages', 'month', 'index.wxml'),
  uiFixGuard: path.join(ROOT, 'tools', 'selftest_ui_fix.js'),
  homeJs: path.join(ROOT, 'pages', 'index', 'index.js'),
};

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const no = (m) => { fail++; console.log('  ❌ ' + m); };
const check = (m, c) => (c ? ok(m) : no(m));

function readOrNull(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

// 剥注释（等长空白、保留换行），避免把说明性注释当代码
function stripJs(src) {
  let out = '', i = 0, n = src.length, q = null;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += (src[i + 1] || ''); i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && c2 === '*') { while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++; } if (i < n) { out += '  '; i += 2; } continue; }
    out += c; i++;
  }
  return out;
}
const stripHtml = (s) => String(s || '').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

// ===================== 判定函数（纯函数：喂字符串 ⇒ 出结论）=====================
// 🔴 键名兼容：调用方可能用 `getLedger`（P 的键）或 `getLedgerSrc`（本函数早期的键）。
//    首版只认 `*Src` ⇒ S1（真实现）全 MISS、S2（我手工传了 *Src）却命中 —— **同一份判定函数给出两种行为**，
//    正是「探测器坏了与命中 0 长得一样」。此处显式兼容两种键名，并把该坑写进注释。
const pick = (o, a, b) => (o[a] !== undefined && o[a] !== null ? o[a] : (o[b] !== undefined ? o[b] : ''));

// 判「某字段的赋值是否无条件」：取「该字段名之前、最近一个结构分隔符（{ , ( ;）之后」的片段，
// 看它有没有 `?`（三元）。⚠️ 不能用固定宽窗 —— 相邻字段的三元会把本字段误判成有条件。
function isUnconditional(code, fieldIdx) {
  if (fieldIdx < 0) return false;
  const before = code.slice(0, fieldIdx);
  let cut = -1;
  for (const ch of ['{', ',', '(', ';']) {
    const k = before.lastIndexOf(ch);
    if (k > cut) cut = k;
  }
  const prefix = before.slice(cut + 1);
  return !/\?/.test(prefix);
}

function analyzeEmptyStateReachability(src) {
  const g = stripJs(pick(src, 'getLedger', 'getLedgerSrc'));
  const j = stripJs(pick(src, 'resultJs', 'resultJsSrc'));
  const w = stripHtml(pick(src, 'resultWxml', 'resultWxmlSrc'));

  // L1：getLedger 的 return ok({...}) 里 result 是否**无条件**
  const uncondResult = isUnconditional(g, g.indexOf('result: {'));

  // L2：result.js 的 setData 里 `r:` 赋值是否无条件
  const uncondR = isUnconditional(j, j.indexOf('r: {'));

  // L3：wxml 空态分支的判据表达式（wx:else = 补集；取 wx:else 之前最近的 wx:elif 表达式）
  const mElif = /wx:elif="\{\{([^}]*)\}\}"/.exec(w);
  const elifExpr = mElif ? mElif[1].trim() : '';
  const elifHasLedgerSignal = /account|hasLedger/i.test(elifExpr);

  // L4：空态可达 ⟺ 存在输入使 (loading===false && 空态条件成立)
  const reachable = !(uncondR === true && elifHasLedgerSignal === false);

  return { uncondResult, uncondR, elifExpr, elifHasLedgerSignal, reachable };
}

// ===================== S：扫描面（fail-closed，防自失效）=====================
console.log('===== S. 扫描面与锚点在场 =====');
const src = {};
for (const [k, p] of Object.entries(P)) {
  const s = readOrNull(p);
  src[k] = s;
  check('S·文件在位且非空：' + path.relative(ROOT, p).replace(/\\/g, '/') + '（' + (s ? s.length : 0) + ' 字符）', !!s && s.length > 200);
}
if (fail) { console.log('\n🔴 扫描面退化 —— 探针自失效，结论不可采信。'); process.exit(2); }

// 锚点：必须真扫到关键代码，否则"0 命中"与"探测器坏了"长得一样
const gCode = stripJs(src.getLedger);
const rjCode = stripJs(src.resultJs);
check('S·锚点①：getLedger 里有 `result: {`', gCode.indexOf('result: {') >= 0);
check('S·锚点②：result.js 里有 `r: {`', rjCode.indexOf('r: {') >= 0);
check('S·锚点③：result.wxml 里有空态分支 wx:else', /wx:else/.test(stripHtml(src.resultWxml)));
check('S·锚点④：getLedger 有 `account_id:` 出参（账本存在性信号确实可得）', /account_id:/.test(gCode));

// ===================== L：四步推导 =====================
console.log('');
console.log('===== L. 四步推导（意图 vs 判据）=====');
const A = analyzeEmptyStateReachability(src);
check('L1 getLedger 对无账记录月**仍无条件**返回 result 对象（默认空账）', A.uncondResult === true);
check('L2 result.js **无条件**把 r 赋成对象（不在任何条件里）', A.uncondR === true);
check('L3 result.wxml 空态分支 = loading 与「' + (A.elifExpr || '<未取到>') + '」的补集', A.elifExpr === 'r');
check('L4 ⇒ 空态分支**不可达**（loading===false 时 r 恒真）', A.reachable === false);
console.log('     · 判据表达式 = ' + (A.elifExpr || '<MISS>') + ' —— 「含账本存在性信号」= ' + A.elifHasLedgerSignal);

// ===================== C：后果（老板视角）=====================
console.log('');
console.log('===== C. 后果：未建档月份渲染成什么 =====');
check('C1 结果页红黄绿带判据 `trueFen <= 0 ⇒ red` 在场（空账 trueFen=0 ⇒ 命中）',
  /trueFen\s*<=\s*0/.test(rjCode) && /bandClass\s*=\s*'red'/.test(rjCode));
check('C2 空账下 `showPer100 = incomeFen > 0` = false ⇒ 故事线卡已自隐（未误报）',
  /showPer100:\s*incomeFen\s*>\s*0/.test(rjCode));
check('C3 导出按钮不在任何"有账本"条件内（空月也能导出）',
  /<button class="btn ghost" bindtap="onExport">/.test(stripHtml(src.resultWxml)));
// 行业对照：后端 pct=null ⇒ 前端 has=false ⇒ 显示「本月没填」（这条处理是对的，登记为非缺陷）
check('C4 行业对照对 pct=null 有正确降级（`has` 判据在场）—— 登记为非缺陷',
  /const has = it\.pct !== null && it\.pct !== undefined/.test(rjCode));

// ===================== M：月度首页同族 =====================
console.log('');
console.log('===== M. 月度首页（pages/month/index）同族检查 =====');
const mj = stripJs(src.monthIndexJs);
const mw = stripHtml(src.monthIndexWxml);
check('M1 index.js `const r = d.result || null` ⇒ d.result 恒为对象 ⇒ r 恒真',
  /const r = d\.result \|\| null/.test(mj));
check('M2 index.js `result: r ? {` ⇒ 恒走真分支', /result:\s*r\s*\?/.test(mj));
check('M3 index.wxml `wx:if="{{result}}"` 恒成立', /wx:if="\{\{result\}\}"/.test(mw));
check('M4 index.wxml **无**空态分支（无 resultEmpty / 无 account_id 判据）',
  !/resultEmpty/.test(mw) && !/account/i.test(mw));
console.log('     · ⇒ 月度首页同族：未建档月渲染全 0（无红带，但同样把「从没录过」显示成 ¥0.00）');

// ===================== G：既有守卫的判据盲区 =====================
console.log('');
console.log('===== G. 既有守卫为什么没拦住（判据盲区取证）=====');
// ⚠️ 段边界标记写在**注释**里，而 stripJs 会剥注释 ⇒ 段切分必须用**原始源**；
//    断言名取自 check('…') 的字符串字面量（stripJs 保留字符串，故用剥过的源取名字更干净）。
const guRaw = src.uiFixGuard;
const gu = stripJs(src.uiFixGuard);
const segStart = guRaw.indexOf('修 1');
const segEnd = guRaw.indexOf('修 2');
const seg = (segStart >= 0 && segEnd > segStart) ? guRaw.slice(segStart, segEnd) : '';
const asserts = [...seg.matchAll(/check\(\s*'([^']*)'/g)].map((m) => m[1]);
check('G1 取到「修 1」段的断言清单（≥5 条）', asserts.length >= 5, 'n=' + asserts.length);
check('G2 🔴 该段断言的**每一条都不含**账本存在性信号（account）—— 全是形态/存在性判据',
  asserts.length > 0 && asserts.every((a) => !/account/i.test(a)));
check('G3 该段确实断言了「空态分支存在」（证明守卫验证的是**在不在**，不是**到不到**）',
  asserts.some((a) => /空态分支/.test(a)));
console.log('     · 断言清单：');
for (const a of asserts) console.log('       - ' + a);

// ===================== H：同族先例（C-① 已拍板的正确判据）=====================
console.log('');
console.log('===== H. 同族先例：首页 hero 的正确判据（C-①）=====');
const hj = stripJs(src.homeJs);
check('H1 pages/index/index.js 用 `d.account_id` 作「有数据」判据（单源判据在这里）',
  /if \(d && d\.account_id && typeof fen === 'number'/.test(hj));
console.log('     · ⇒ 同族病：同一条判据在**首页**写了，在**结果页/月度首页**两条平行入口没写');

// ===================== 影子样本（防本探针恒真）=====================
console.log('');
console.log('===== F. 影子样本：判定函数必须有分辨力 =====');
// S1 真实现 ⇒ 不可达
const S1 = analyzeEmptyStateReachability(src);
// S2 只把模板判据换成含账本信号（⚠️ 覆盖必须用 P 的**同一键名**，否则 pick() 会优先取原值 ⇒ 影子样本变成复制真品）
const S2wxml = src.resultWxml.replace('wx:elif="{{r}}"', 'wx:elif="{{hasAccount}}"');
const S2 = analyzeEmptyStateReachability(Object.assign({}, src, { resultWxml: S2wxml }));
// S3 只把 js 的 r 赋值加上条件
const S3js = src.resultJs.replace(/r:\s*\{/, 'r: hasAccount ? {');
const S3 = analyzeEmptyStateReachability(Object.assign({}, src, { resultJs: S3js }));
check('F0 影子样本的替换**真的生效**（S2/S3 源与真品不同）',
  S2wxml !== src.resultWxml && S3js !== src.resultJs);
check('F1 影子 S1（真实现）⇒ 空态**不可达**', S1.reachable === false);
check('F2 影子 S2（模板判据加账本信号）⇒ 空态**可达**', S2.reachable === true);
check('F3 影子 S3（js 的 r 赋值加条件）⇒ 空态**可达**', S3.reachable === true);
check('F4 🔴 三条影子样本结论**不全同**（判定函数确有分辨力，非同义反复）',
  !(S1.reachable === S2.reachable && S2.reachable === S3.reachable));
check('F5 影子 S2/S3 确实改到了判据（防"替换没生效 ⇒ 看似通过"）',
  S2.elifExpr === 'hasAccount' && S3.uncondR === false);

// ===================== 结论 =====================
const total = pass + fail;
console.log('');
console.log('==== R298·M1 探针① 空态可达性：' + pass + ' 通过 / ' + fail + ' 失败（共 ' + total + '）====');
const DEFECT = (S1.reachable === false) && (S2.reachable === true);
if (DEFECT) {
  console.log('🔴 缺陷成立：M1 月结果页「空态」分支不可达 ⇒ 未建档月份显示红带「亏损」+ ¥0.00；月度首页同族（全 0）。');
  console.log('   建议修法（待拍板）：判据由 `r` 改为「有账本记录」—— 复用 C-① 的单源判据 `account_id` 非空。');
} else {
  console.log('✅ 未复现：空态判据已含账本存在性信号（或 r 已条件化）⇒ 该缺陷不存在。');
}
if (fail) process.exit(1);
if (GATE && DEFECT) process.exit(1);
process.exit(0);
