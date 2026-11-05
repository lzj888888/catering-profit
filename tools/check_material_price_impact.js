#!/usr/bin/env node
// tools/check_material_price_impact.js —— 原料改价「成本卡不会自己跟着变」告知守卫（R406 · 队列 #19）
//
// 为什么必须机器守（这条是「文案与机制不一致」的典型，链路通 / 门禁绿都证明不了它是对的）：
//   O5 原计划照豆包写的加一句「所有用该原料的菜成本已自动更新」。但本仓成本卡是**快照隔离**：
//   改原料价后旧卡成本不变，只有手动走 `syncCostCard` 才生成新版本
//   （`cloudfunctions/syncCostCard/index.js:4-5` 明写「旧卡成本不变（快照隔离）」）。
//   ⇒ 落那句原文 = 承诺一件没发生的事 ⇒ 老板按没变的成本去定价 = **静默算错**。
//   这类回归的失败方式全是静默的：
//     · 删掉「三要素比对」⇒ 要么只改别名也弹（骚扰），要么改价不弹（漏告知）；
//     · 删掉 `origCostKey: costKeyOf(...)` 的**赋值**，只留判据 ⇒ 基线恒 '' ⇒ 恒判"改了"
//       （R298Y「写了读取方却没产出」同型：判据在、数据没有，照绿）；
//     · 把跳转目标改成别的页 ⇒ 老板点「看影响面」看到不相干的页面；
//     · 把文案改回「已自动更新」⇒ 退回假承诺。
//
// 判据（六条腿，方向不同、缺一不可）：
//   ① **真基线**：`origCostKey` 必须真的被赋值（否则比对恒真）。
//   ② **真比对 + 真调用**：`onSave` **函数体内**既有三要素键比对，又有 `this.tellPriceImpact(` 调用。
//      ⚠️ 两种恒真本仓都踩过：全文 grep 词出现（注释喂绿）、锚到调用点（同文件别处有同名模式）
//      ⇒ 一律在**剥注释后**的源码上、锚到**函数定义体**。
//   ③ **真告知**：`tellPriceImpact` 函数体内有 `wx.showModal(`、有 `dry_run` 探测、且跳 `/subpkg/tools/metrics/impact`。
//   ④ **无假承诺**：话术不得出现「已自动更新」类字样；且必须含「旧价」（说清卡里还是旧价才算告知，
//      只问"要看影响吗"而不说现状 = 半个告知，老板仍以为已经变了）。
//   ⑤ **按钮合规**：modal 两个按钮 ≤4 字符（平台硬限制）。用变量引用时 `check_modal_button_len`
//      抓不到字面量 ⇒ 这里自己守。
//   ⑥ **反恒真**：喂合成样本证明判据本身不成立（删基线 / 删比对 / 删调用 / 改跳转 / 改文案 各判否）。
//
// ⚠️ 本文件**不用正则、不写反斜杠字面量**（本机环境会把反斜杠转成斜杠，落盘即语法错）——
//    反斜杠一律用 String.fromCharCode(92)。
//
// 运行：node tools/check_material_price_impact.js   （由 verify_all.js 的 [material-price-impact] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EDIT = 'subpkg/biz/material/edit.js';
const IMPACT = 'subpkg/tools/metrics/impact.js';
const TERMS_SPEC = 'specs/dev-specs/i18n/terms.js';
const TERMS_MP = 'miniprogram/i18n/terms.js';

const BS = String.fromCharCode(92);   // 反斜杠（禁字面量，见头注）

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); return true; }
  problems.push(name + (detail ? '：' + detail : ''));
  console.log('❌ ' + name + (detail ? '：' + detail : ''));
  return false;
}

function read(p) {
  try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; }
}

// ================= 基础工具（全部 indexOf / 切片，无正则） =================

/** 去掉 `//` 与块注释，**保留字符串内容**（注释必须剥掉，否则注释里写一句就喂绿）。 */
function stripComments(src) {
  const s = String(src == null ? '' : src);
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charAt(i);
    const c2 = i + 1 < n ? s.charAt(i + 1) : '';
    if (c === '/' && c2 === '/') {
      while (i < n && s.charAt(i) !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(s.charAt(i) === '*' && s.charAt(i + 1) === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const d = s.charAt(i);
        out += d;
        i++;
        if (d === BS) { if (i < n) { out += s.charAt(i); i++; } continue; }
        if (d === quote) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 从 `openIdx`（必须指向 `{`）起做花括号配平，返回含首尾括号的整块；失败 ⇒ ''。 */
function bracesFrom(s, openIdx) {
  if (openIdx < 0) return '';
  let i = openIdx;
  let depth = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < s.length) {
        const d = s.charAt(i);
        if (d === BS) { i += 2; continue; }
        i++;
        if (d === quote) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(openIdx, i + 1); }
    i++;
  }
  return '';
}

/**
 * 取**函数定义体**：只认 `name(` 且前一个字符不是 `.`（排除 `this.name(` 这类调用），
 * 并且 `{` 必须出现在下一个 `;` 之前。
 * 🔴 R299 实测教训：只按 `name(` 找首个出现位置会锚到**调用点**，窗口整段错位 ⇒ 判据全假。
 */
function defBodyOf(src, name) {
  const s = String(src || '');
  let i = 0;
  while (i < s.length) {
    const k = s.indexOf(name + '(', i);
    if (k < 0) return '';
    const prev = k > 0 ? s.charAt(k - 1) : '';
    if (prev !== '.') {
      const brace = s.indexOf('{', k);
      const semi = s.indexOf(';', k);
      if (brace >= 0 && (semi < 0 || brace < semi)) return bracesFrom(s, brace);
    }
    i = k + name.length;
  }
  return '';
}

/** 取 `key:` 后面的第一个字符串/模板字面量值（支持 ' " ` 三种引号）。找不到 ⇒ ''。 */
function literalOf(src, key) {
  const s = String(src || '');
  const k = s.indexOf(key);
  if (k < 0) return '';
  let q = -1;
  for (let i = k + key.length; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "'" || c === '`' || c === '"') { q = i; break; }
    if (c === '\n') break;   // 跨行不算（防抽到下一个键的值）
  }
  if (q < 0) return '';
  const quote = s.charAt(q);
  let out = '';
  let i = q + 1;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === BS) { out += s.charAt(i + 1) || ''; i += 2; continue; }
    if (c === quote) break;
    out += c;
    i++;
  }
  return out;
}

// ================= 判据核心（纯函数 —— 反恒真靠喂合成样本） =================

/** 假承诺词表：承诺"已经自动更新了"的说法一律禁（本仓旧卡成本不变）。 */
const BANNED = ['已自动更新', '已自动跟着变', '已跟随更新', '成本已更新', '自动同步完成'];

/**
 * @param {string} editSrc   subpkg/biz/material/edit.js 源码
 * @param {string} termsSrc  terms.js 源码（任一副本）
 * @returns {string[]} 失败项（空数组 = 通过）
 */
function analyze(editSrc, termsSrc) {
  const fails = [];
  const code = stripComments(editSrc);
  const terms = stripComments(termsSrc);

  // ① 真基线
  if (code.indexOf('origCostKey: costKeyOf(') < 0) {
    fails.push('A1 origCostKey 基线从未被赋值（比对会恒真 ⇒ 每次保存都弹）');
  }
  if (code.indexOf('origCostKey') < 0) {
    fails.push('A2 源码里没有 origCostKey（读取方与赋值方都不存在）');
  }

  // ② 真比对 + 真调用（锚到 onSave 函数体）
  const onSave = defBodyOf(code, 'onSave');
  if (!onSave) {
    fails.push('A3 取不到 onSave 函数体');
  } else {
    if (onSave.indexOf('newCostKey !== origCostKey') < 0) {
      fails.push('A4 onSave 函数体内没有「成本三要素」比对');
    }
    if (onSave.indexOf('this.tellPriceImpact(') < 0) {
      fails.push('A5 onSave 函数体内没有真调用 this.tellPriceImpact(');
    }
  }

  // ③ 真告知（锚到 tellPriceImpact 函数体）
  const tell = defBodyOf(code, 'tellPriceImpact');
  if (!tell) {
    fails.push('B1 取不到 tellPriceImpact 函数体');
  } else {
    if (tell.indexOf('wx.showModal(') < 0) fails.push('B2 tellPriceImpact 内没有 wx.showModal(');
    if (tell.indexOf('dry_run') < 0) fails.push('B3 没做 dry_run 影响数探测（会退化成对每个原料都弹）');
    if (tell.indexOf('/subpkg/tools/metrics/impact') < 0) fails.push('B4 告知后没有跳到影响面页');
  }

  // ④ 无假承诺 + 必须说清现状
  const askN = literalOf(terms, 'matImpactAsk:');
  const askU = literalOf(terms, 'matImpactAskUnknown:');
  if (!askN) fails.push('C1 terms 缺 matImpactAsk 文案');
  if (!askU) fails.push('C2 terms 缺 matImpactAskUnknown 文案');
  [askN, askU].forEach((txt, idx) => {
    if (!txt) return;
    BANNED.forEach((w) => {
      if (txt.indexOf(w) >= 0) fails.push('C3 话术含假承诺「' + w + '」（第 ' + (idx + 1) + ' 句）');
    });
  });
  if (askN && askN.indexOf('旧价') < 0) fails.push('C4 matImpactAsk 没点明「卡里还是旧价」');
  if (askU && askU.indexOf('旧价') < 0) fails.push('C5 matImpactAskUnknown 没点明「卡里还是旧价」');

  // ⑤ 按钮合规（平台硬限制 ≤4 字）
  const go = literalOf(terms, 'matImpactGo:');
  const skip = literalOf(terms, 'matImpactSkip:');
  if (!go) fails.push('D1 terms 缺 matImpactGo 按钮文案');
  else if (go.length > 4) fails.push('D2 matImpactGo 超 4 字符（平台会 fail）：' + go);
  if (!skip) fails.push('D3 terms 缺 matImpactSkip 按钮文案');
  else if (skip.length > 4) fails.push('D4 matImpactSkip 超 4 字符（平台会 fail）：' + skip);

  return fails;
}

// ================= 主流程 =================
const editSrc = read(EDIT);
const impactSrc = read(IMPACT);
const termsSpec = read(TERMS_SPEC);
const termsMp = read(TERMS_MP);

ok('S1 扫描面齐全（edit / impact / terms 双副本）',
  !!editSrc && !!impactSrc && !!termsSpec && !!termsMp,
  [EDIT, IMPACT, TERMS_SPEC, TERMS_MP].filter((p) => !read(p)).join(' '));

// 双副本必须**逐字节一致**（本仓术语单一源，改一处必须同步）
ok('S2 terms 双副本逐字节一致', termsSpec.length > 0 && termsSpec === termsMp,
  'specs ' + termsSpec.length + ' 字符 / miniprogram ' + termsMp.length + ' 字符');

// impact 页真实存在（防路径笔误）
ok('S3 影响面页存在（跳转目标不是空路径）', !!impactSrc);

// 判据主体
const fails = analyze(editSrc, termsSpec);
ok('S4 判据主体全过', fails.length === 0, fails.join('；'));

// 逐条单列（便于定位，也让断言数可数）
const code = stripComments(editSrc);
const onSave = defBodyOf(code, 'onSave');
const tell = defBodyOf(code, 'tellPriceImpact');
ok('① origCostKey 被真赋值（基线不是空壳）', code.indexOf('origCostKey: costKeyOf(') >= 0);
ok('② onSave 体内真比对三要素', !!onSave && onSave.indexOf('newCostKey !== origCostKey') >= 0);
ok('③ onSave 体内真调用告知流程', !!onSave && onSave.indexOf('this.tellPriceImpact(') >= 0);
ok('④ 告知流程真的弹窗', !!tell && tell.indexOf('wx.showModal(') >= 0);
ok('⑤ 告知流程先探影响数（dry_run）', !!tell && tell.indexOf('dry_run') >= 0);
ok('⑥ 告知流程跳到影响面页', !!tell && tell.indexOf('/subpkg/tools/metrics/impact') >= 0);
ok('⑦ 话术不说"已自动更新"', BANNED.every((w) => literalOf(termsSpec, 'matImpactAsk:').indexOf(w) < 0
  && literalOf(termsSpec, 'matImpactAskUnknown:').indexOf(w) < 0));
ok('⑧ 话术点明"卡里还是旧价"', literalOf(termsSpec, 'matImpactAsk:').indexOf('旧价') >= 0
  && literalOf(termsSpec, 'matImpactAskUnknown:').indexOf('旧价') >= 0);
ok('⑨ 两个按钮都 ≤4 字符',
  literalOf(termsSpec, 'matImpactGo:').length > 0 && literalOf(termsSpec, 'matImpactGo:').length <= 4
  && literalOf(termsSpec, 'matImpactSkip:').length > 0 && literalOf(termsSpec, 'matImpactSkip:').length <= 4);

// ================= ⑥ 反恒真：合成样本（证明判据本身不成立） =================
// 正样本：一份"正确实现"的最小骨架 —— 必须先证明它能判过，否则后面的反样本没有意义。
const GOOD_EDIT = ''
  + 'function costKeyOf(a, b, c) { return [a, b, c].join("|"); }\n'
  + 'Page({\n'
  + '  data: { origCostKey: "" },\n'
  + '  load() { this.setData({ origCostKey: costKeyOf(1, 2, 3) }); },\n'
  + '  async onSave() {\n'
  + '    const newCostKey = costKeyOf(1, 2, 3);\n'
  + '    const origCostKey = this.data.origCostKey;\n'
  + '    if (newCostKey !== origCostKey) { await this.tellPriceImpact(); }\n'
  + '  },\n'
  + '  async tellPriceImpact() {\n'
  + '    await api.call("syncCostCard", { dry_run: true });\n'
  + '    wx.showModal({ success: (r) => { wx.redirectTo({ url: "/subpkg/tools/metrics/impact?x=1" }); } });\n'
  + '  },\n'
  + '});\n';
const GOOD_TERMS = ''
  + 'card: {\n'
  + '  matImpactAsk: (n) => `用到这个原料的 ${n} 道菜，成本卡里还是旧价。要看影响吗？`,\n'
  + '  matImpactAskUnknown: "用这个原料的菜，成本卡里还是旧价。要看影响面吗？",\n'
  + '  matImpactGo: "看影响面",\n'
  + '  matImpactSkip: "先算了",\n'
  + '}\n';

ok('R1 正样本判过（判据不恒假）', analyze(GOOD_EDIT, GOOD_TERMS).length === 0,
  analyze(GOOD_EDIT, GOOD_TERMS).join('；'));

// 反样本 1：删掉基线赋值 ⇒ 必须判否（这是 R298Y「写了读取方却没产出」的同型）
const BAD_A = GOOD_EDIT.replace('origCostKey: costKeyOf(1, 2, 3)', 'origCostKey: ""');
ok('R2 反样本·删基线赋值 ⇒ 判否', analyze(BAD_A, GOOD_TERMS).length > 0
  && analyze(BAD_A, GOOD_TERMS).some((f) => f.indexOf('A1') === 0));

// 反样本 2：把比对注释掉（剥注释后等于没有）⇒ 必须判否
const BAD_B = GOOD_EDIT.replace('if (newCostKey !== origCostKey)',
  '// if (newCostKey !== origCostKey)\n    if (false)');
ok('R3 反样本·比对被注释 ⇒ 判否', analyze(BAD_B, GOOD_TERMS).length > 0
  && analyze(BAD_B, GOOD_TERMS).some((f) => f.indexOf('A4') === 0));

// 反样本 3：删掉真调用 ⇒ 必须判否（"写了函数但没人调"正是 R399 之前的实况）
const BAD_C = GOOD_EDIT.replace('await this.tellPriceImpact();', '/* await this.tellPriceImpact(); */');
ok('R4 反样本·删真调用 ⇒ 判否', analyze(BAD_C, GOOD_TERMS).length > 0
  && analyze(BAD_C, GOOD_TERMS).some((f) => f.indexOf('A5') === 0));

// 反样本 4：跳转目标改错页 ⇒ 必须判否
const BAD_D = GOOD_EDIT.replace('/subpkg/tools/metrics/impact?x=1', '/subpkg/biz/card/index');
ok('R5 反样本·跳错页 ⇒ 判否', analyze(BAD_D, GOOD_TERMS).length > 0
  && analyze(BAD_D, GOOD_TERMS).some((f) => f.indexOf('B4') === 0));

// 反样本 5：文案改回豆包原文（假承诺）⇒ 必须判否
const BAD_TERMS = GOOD_TERMS.replace(
  '(n) => `用到这个原料的 ${n} 道菜，成本卡里还是旧价。要看影响吗？`',
  '(n) => `所有用该原料的 ${n} 道菜成本已自动更新`');
const badE = analyze(GOOD_EDIT, BAD_TERMS);
ok('R6 反样本·文案写成"已自动更新" ⇒ 判否',
  badE.length > 0 && badE.some((f) => f.indexOf('C3') === 0));

// 反样本 6：按钮超 4 字 ⇒ 必须判否（真机 2026-09-26 就是这么挂的）
const BAD_BTN = GOOD_TERMS.replace('matImpactGo: "看影响面"', 'matImpactGo: "去看看影响面"');
const badF = analyze(GOOD_EDIT, BAD_BTN);
ok('R7 反样本·按钮超 4 字 ⇒ 判否', badF.length > 0 && badF.some((f) => f.indexOf('D2') === 0));

// ================= 扫描面自失效护栏 =================
ok('S5 断言数下界（≥20）', pass + problems.length >= 20, String(pass + problems.length));

// ================= 结论 =================
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 原料改价告知校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ 原料改价告知校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 原料改价告知校验通过（改价 → 如实告知成本卡未更新 → 直达只读影响面；话术无假承诺）');
console.log('✅ 原料改价告知校验：' + total + ' 通过 / 0 失败');
