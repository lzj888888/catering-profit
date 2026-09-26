// tools/check_modal_button_len.js —— R145 · wx.showModal 按钮文案长度守卫
//
// ===== 为什么立这条（真机事故 2026-09-26，李老师反馈）=====
// 「新增菜品」点了弹不出付费墙，toast 出 `showmodal:fail confirm text length should …`。
// 真因：**微信 wx.showModal 的 confirmText / cancelText 最多 4 个字符**，
//   而 `TERMS.paywall.*.primary` / `TERMS.buttons.unlockPro` 是「开通真实利润」= 6 字，
//   弹窗**直接 fail**（paywall.js 的 fail 兜底把 errMsg toast 出来，所以用户看到的是一串英文）。
// 同一事故还波及**启动隐私弹窗**：`TERMS.exp.privacyAgree`「同意并继续」= 5 字 ⇒ 弹窗 fail，
//   且它的 fail 是**静默**的（直接按「不同意」resolve），比付费墙更难发现。
//
// 🔴 这类缺陷的形态是「**平台限制 + 文案单源**撞车」：
//    · 文案走 terms.js 单源（铁律），改文案的人不知道它会被塞进 showModal；
//    · 门禁此前 104 个套件**没有任何一条**管按钮长度 ⇒ 全绿也照样上线翻车。
//   ⇒ 形态类缺陷必须立用例表单源，否则同样的事故会以别的文案重现。
//
// ===== 判据 =====
// A. 解析器自带**钉死样本**（先证明解析器真的会解析，再看真实扫描结果）：
//    · 单键表达式解析出 1 条 1 个候选
//    · `||` 多候选表达式全部解析出来（含别名展开）
//    · 非按钮行不误抓
// B. 真实扫描 pages/ utils/ app.js 的 confirmText / cancelText，逐个候选解析成 TERMS 实际值
//    ⇒ 判 **字符长度 ≤ 4**（`Array.from(v).length`，中文按字不按字节）
// C. **反恒真**：
//    ① 影子用例：把「开通真实利润」（6 字）喂给同一判据 ⇒ **必须判红**（证明真有分辨力）
//    ② 合规样本「知道了」（3 字）⇒ **必须判绿**
//    ③ 别名表防腐化：押 `utils/paywall.js` 里 `const def = TERMS.paywall…` / `const buttons = TERMS.buttons`
//       仍在（写法变了 ⇒ 转红提醒更新别名表，而不是悄悄漏判）
//    ④ 防空跑：扫描到的按钮引用条数有下界（引用被删光 ⇒ 转红，而不是 0 条通过）
// D. 断言数下界（防后人删断言）。

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const TERMS = (function () {
  const m = require(path.join(REPO, 'miniprogram/i18n/terms.js'));
  return m && m.TERMS ? m.TERMS : m;
})();

const LIMIT = 4;

// 局部别名 → TERMS 键路径（def = TERMS.paywall[type]，type 两类都要判）
const ALIASES = {
  'def.primary': ['paywall.saveLimit.primary', 'paywall.export.primary'],
  'def.secondary': ['paywall.saveLimit.secondary', 'paywall.export.secondary'],
  'buttons.cancel': ['buttons.cancel'],
  'buttons.gotIt': ['buttons.gotIt'],
  'buttons.thinkAgain': ['buttons.thinkAgain'],
  'buttons.unlockPro': ['buttons.unlockPro'],
};

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('✅ ' + m); };
const no = (m) => { fail++; console.log('❌ ' + m); };
const check = (m, c) => (c ? ok(m) : no(m));

const len = (s) => Array.from(String(s == null ? '' : s)).length;
function getByPath(p) {
  let v = TERMS;
  for (const seg of p.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[seg];
  }
  return typeof v === 'string' ? v : undefined;
}

/* ===================== 解析器（纯函数，自带钉死样本） ===================== */
function parseButtons(src, tag) {
  const out = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^[ \t]*(confirmText|cancelText)[ \t]*:[ \t]*(.+?),?[ \t]*$/);
    if (!m) return;
    out.push({ tag, line: i + 1, prop: m[1], expr: m[2].replace(/,[ \t]*$/, '') });
  });
  return out;
}

// 返回 { cands: [{kind:'terms'|'lit', key|value}], unknown: [片段] }
function candidatesOf(expr) {
  const cands = [], unknown = [];
  for (const rawPart of String(expr).split('||')) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.indexOf('TERMS.') === 0) {
      cands.push({ kind: 'terms', key: part.slice('TERMS.'.length) });
    } else if (ALIASES[part]) {
      for (const k of ALIASES[part]) cands.push({ kind: 'terms', key: k });
    } else if (/^'[^']*'$/.test(part) || /^"[^"]*"$/.test(part)) {
      cands.push({ kind: 'lit', value: part.slice(1, -1) });
    } else {
      unknown.push(part);
    }
  }
  return { cands, unknown };
}

// 判据：一组候选是否全部合规（影子用例也走它 ⇒ 正负互证用的是同一段逻辑）
function judge(cands) {
  const bad = [];
  for (const c of cands) {
    const v = c.kind === 'lit' ? c.value : getByPath(c.key);
    if (v === undefined) { bad.push((c.kind === 'lit' ? c.value : c.key) + '（键不存在）'); continue; }
    if (len(v) > LIMIT) bad.push(c.key || c.value ? (c.kind === 'lit' ? "'" + v + "'" : c.key) + '=' + v + '(' + len(v) + '字)' : '');
  }
  return bad;
}

console.log('===== A. 解析器钉死样本（先证明解析器有效）=====');
const s1 = parseButtons("    confirmText: TERMS.buttons.gotIt,", 'sample1');
check('A-① 单键表达式解析出 1 条', s1.length === 1);
check('A-② 单键候选数 = 1 且键名正确', s1.length === 1 && candidatesOf(s1[0].expr).cands.length === 1
  && candidatesOf(s1[0].expr).cands[0].key === 'buttons.gotIt');

const s2 = parseButtons("    confirmText: TERMS.paywall.ctaShort || def.primary,", 'sample2');
const c2 = s2.length === 1 ? candidatesOf(s2[0].expr) : { cands: [], unknown: [] };
check('A-③ `||` 表达式候选数 = 3（ctaShort + def.primary 展开两类）', c2.cands.length === 3);
check('A-④ 别名 def.primary 被展开为 saveLimit/export 两个键',
  c2.cands.filter((c) => c.key === 'paywall.saveLimit.primary').length === 1 &&
  c2.cands.filter((c) => c.key === 'paywall.export.primary').length === 1);

const s3 = parseButtons("    title: TERMS.exp.privacyTitle,\n    content: TERMS.exp.privacyDesc,", 'sample3');
check('A-⑤ 非按钮行不误抓', s3.length === 0);

/* ===================== B. 真实扫描 ===================== */
console.log('\n===== B. 真实扫描（pages/ utils/ app.js）=====');
const SKIP = new Set(['node_modules', 'review', 'cloudfunctions', 'tools', '.git', 'miniprogram', 'specs', 'admin-h5']);
function walk(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
let targets = [];
for (const d of ['pages', 'utils']) targets = targets.concat(walk(path.join(REPO, d), []));
const appJs = path.join(REPO, 'app.js');
if (fs.existsSync(appJs)) targets.push(appJs);

let refs = [], unknownAll = [];
for (const f of targets) {
  const src = fs.readFileSync(f, 'utf8');
  for (const r of parseButtons(src, path.relative(REPO, f))) {
    const c = candidatesOf(r.expr);
    refs.push(Object.assign({}, r, { cands: c.cands }));
    if (c.unknown.length) unknownAll.push(r.tag + ':' + r.line + ' ' + r.prop + ' → ' + c.unknown.join(' | '));
  }
}
console.log('   扫描文件 ' + targets.length + ' 个，命中按钮引用 ' + refs.length + ' 条，候选 ' +
  refs.reduce((n, r) => n + r.cands.length, 0) + ' 个');
refs.forEach((r) => console.log('   · ' + r.tag + ':' + r.line + ' ' + r.prop + ' = ' + r.expr));

check('B-① 按钮引用条数下界 ≥ 6（防引用被删光导致空跑）', refs.length >= 6);
check('B-② 所有按钮表达式均可解析（无无法识别的片段）', unknownAll.length === 0);
if (unknownAll.length) unknownAll.forEach((u) => console.log('    ↳ 无法解析：' + u));

let badRefs = 0;
for (const r of refs) {
  const bad = judge(r.cands);
  if (bad.length) {
    badRefs++;
    no('B 超长：' + r.tag + ':' + r.line + ' ' + r.prop + ' → ' + bad.join('、') + '（上限 ' + LIMIT + ' 字）');
  }
}
check('B-③ 全部按钮文案 ≤ ' + LIMIT + ' 字（实际检查 ' + refs.length + ' 条引用）', badRefs === 0);

/* ===================== C. 反恒真 ===================== */
console.log('\n===== C. 反恒真（同一判据的正负互证）=====');
const longCands = [{ kind: 'lit', value: '开通真实利润' }, { kind: 'lit', value: '同意并继续' }];
const shortCands = [{ kind: 'lit', value: '知道了' }, { kind: 'lit', value: '去开通' }];
check('C-① 影子：6 字 / 5 字文案必须判红（证明有分辨力）', judge(longCands).length === 2);
check('C-② 影子：3 字 / 3 字文案必须判绿', judge(shortCands).length === 0);
check('C-③ 影子：真实超长键 paywall.saveLimit.primary 若回到 6 字会被判红（用同长度字面量代理）',
  judge([{ kind: 'lit', value: '开通真实利益' }]).length === 1);

const pw = path.join(REPO, 'utils/paywall.js');
const pwSrc = fs.existsSync(pw) ? fs.readFileSync(pw, 'utf8') : '';
check('C-④ 别名表防腐化：paywall.js 内 def 仍来自 TERMS.paywall', /const\s+def\s*=\s*TERMS\.paywall/.test(pwSrc));
check('C-⑤ 别名表防腐化：paywall.js 内 buttons 仍来自 TERMS.buttons', /const\s+buttons\s*=\s*TERMS\.buttons/.test(pwSrc));

/* ===================== D. 断言数下界 ===================== */
console.log('\n===== D. 断言数下界（防后人删断言）=====');
// ⚠️ 文案里不能出现「N 通过 / M 失败」字样：check_suite_assert_counts.js 抓的是
//    stdout 里**第一个**该模式（作为套件通过数口径），这里的中间态会被误当成总口径。
check('D-① 断言数 ≥ 12（累计 ✅ ' + pass + ' 条 / ❌ ' + fail + ' 条）', pass >= 12);

// 标准总结行（套件通过数口径的唯一来源，必须带「N 通过 / M 失败」）
console.log('\n==== R145 showModal 按钮文案长度守卫：' + pass + ' 通过 / ' + fail + ' 失败 ====');
console.log((fail === 0
  ? '✅ R145 通过：' + pass + ' 条断言全绿，' + refs.length + ' 条按钮引用文案均 ≤ ' + LIMIT + ' 字'
  : '❌ R145 失败：' + fail + ' 条'));
process.exit(fail === 0 ? 0 : 1);
