#!/usr/bin/env node
// tools/check_m2_ref_not_prefill.js —— M2「参考值只作提示 · 绝不自动填值」守卫（R128 · round114）
//
// 为什么需要它（round114 落地「预计月营业额锚点」时暴露的护栏缺口）：
//   round114 给 M2 加了锚点：用户填一个预计月营业额 ⇒ 云端按各指标参考带的**中值**反算
//   各项参考**金额**，显示成输入框的**灰字起点**（placeholder）+ 参考区间卡上的「参考 ¥X」。
//   这条设计的**边界**（李老师 round114 场景的直接推论）是：
//     🔴 **参考值只当提示，绝不替你填。**
//   因为 M2 是"开店前的前瞻沙盘"，参考值来自**行业平均**；一旦自动填进 `yuan`，用户不核对就
//   直接得到一份"全绿、保本点很健康"的结论，而他的真实租约/人工可能完全是另一个量级
//   ⇒ 结论从"参考"变成"误导"，**比不给还坏**（等于替用户自证合理）。
//
//   ⚠️ 而这条边界在 round114 落地时**是零守卫的** —— 由本轮变异回灌 A10/A11 实测证明：
//     · A10 在 `applyRefAmount` 里把参考金额写进 `yuan` ⇒ 跑遍全部相关套件，**0 条转红**；
//     · A11 把 wxml 输入框 `value` 绑成 `{{item.ph}}`（= 参考值）⇒ **0 条转红**。
//   同族病：**文档里写了「🔴 绝不」，却没有机器判据**（与 round111 的 A9「判据面写窄」同类）。
//
// 判据（P/A/B/C/D/E 六段，全部 fail-closed：读不到 / 解析不到即判红，不许静默放行）：
//   P 前置  两个面文件可读 / `applyRefAmount` **函数体可解析**（解析不到必须在此判红，
//           否则 A 段会因为"找不到函数"而静默变绿 = 守卫失灵）
//   A 主判据 `applyRefAmount` 函数体（剥注释后）**零 `yuan`** —— 只改 placeholder，不碰用户值
//   B 主判据 wxml 里**每一个** `<input>` 的 `value` 绑定必须在"用户值白名单"内
//            （白名单 = item.yuan / item.years / item.pct / targetYuan / expectYuan）
//   C 正向   `applyRefAmount` 必须**确实写 `ph`**（否则 A 的判据会因"函数被掏空"而恒真）
//            + 参考值必须仍有出口（terms 单源 `refAmtPh` 键**存在且值非空** / 页面 t 暴露 `refAmtCard`）
//   D 护栏   剥注释器 / `touchesYuan` / `bodyOf`（锚定义不锚调用）/ `inputValues`+白名单
//            四组**正负样本互证**（证明 A/B 不是恒真）
//   E 下界   断言数下界（防"删掉几条判据"无人知）
//
// 运行：node tools/check_m2_ref_not_prefill.js   （由 verify_all.js 的 [ref-not-prefill] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_JS = 'pages/sandbox/index.js';
const PAGE_WXML = 'pages/sandbox/index.wxml';
const TERMS_REL = 'miniprogram/i18n/terms.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============ 工具（每件都自带正负样本，见 D 段）============
// ⚠️ 反引号一律用 BT 常量，**不在源码里直接写该字符** —— round114 实测：直接写会触发
//    Node 解析异常（`Invalid or unexpected token`），而同族坑本仓已多次（shell 元字符/引号）。
const BT = String.fromCharCode(96);

// ⚠️ 本行原写成块注释，内容里带了「斜杠 + 星号」这两个字符 ⇒ 那个组合**提前闭合了本块注释**，
//    后面全被当代码解析（Node 报 `Invalid or unexpected token`，定位在几十行之后）。
//    同族第 2 次：第一次是 tools/apply_indexes.js（R122 抓到，自 09-17 起一直编译不过）。
// 引号感知剥注释：剥行注释与块注释，但**保留字符串字面量**（否则会切坏 'http://…'）。
function stripJs(s) {
  let out = '';
  let i = 0;
  let q = null;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === BT) { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

/** 取具名函数的**函数体**（花括号配平）。⚠️ 锚**定义**不锚调用 —— `this.name(` 不匹配（前缀是 `.`）。 */
function bodyOf(src, name) {
  const re = new RegExp('(^|[^\\w.$])' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const b = src.indexOf('{', m.index + m[0].length - 1);
  if (b < 0) return null;
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return null;
}

/** 函数体是否触碰用户输入值 `yuan`（= 自动填值 / 改写用户已填的迹象）。 */
function touchesYuan(body) { return /\byuan\b/.test(body); }

/** 取出 wxml 中所有 `<input>` 标签的 `value="…"` 绑定（无 value 属性记为 ''）。 */
function inputValues(wxml) {
  const out = [];
  const re = /<input\b[^>]*>/g;
  let m;
  while ((m = re.exec(wxml))) {
    const v = /value\s*=\s*"([^"]*)"/.exec(m[0]);
    out.push(v ? v[1] : '');
  }
  return out;
}

// 用户输入框 `value` 的**白名单**（只看用户自己填的字段）。
// 🔴 新增用户输入框时必须把它的绑定加进来 —— 这是刻意的：本判据要挡住"参考值悄悄进 value"，
//    白名单比黑名单更能 fail-closed（黑名单挡不住没预料到的新变量名）。
const OK_VALUE = /^\{\{(item\.(yuan|years|pct)|targetYuan|expectYuan)\}\}$/;

const pageJsRaw = readRel(PAGE_JS);
const pageWxmlRaw = readRel(PAGE_WXML);

// ============ P 前置 ============
sec('P 前置：两个面文件可读 / 关键函数体可解析');
const jsStripped = stripJs(pageJsRaw);
const refBody = bodyOf(jsStripped, 'applyRefAmount');
check('P-① 两个面文件可读且非空', pageJsRaw.length > 1000 && pageWxmlRaw.length > 1000,
  `index.js ${pageJsRaw.length} 字符 · index.wxml ${pageWxmlRaw.length} 字符`);
check('P-② `applyRefAmount` 函数体**可解析**（解析不到即判红 —— 否则 A 段会静默变绿）',
  !!refBody, refBody ? `函数体 ${refBody.length} 字符` : '未找到 applyRefAmount 定义');
// ⚠️ 下界 = **实测值**（6），不是「展开后的行数」：wxml 里 `wx:for` 只写一个 `<input>` 标签，
//    所以 3 行建店投入 / 4 行固定支出 都只各占 1 个标签。凭估会把自己判红（本轮实测踩过）。
check('P-③ wxml 里 `<input>` 数 ≥ 6（扫描面没有被写窄）',
  inputValues(pageWxmlRaw).length >= 6, `${inputValues(pageWxmlRaw).length} 个`);

// ============ A 主判据：不碰用户值 ============
sec('A 主判据：参考金额只改 placeholder，绝不写进用户输入值');
check('A-① `applyRefAmount` 函数体（剥注释后）**零 `yuan`**',
  !!refBody && !touchesYuan(refBody),
  refBody ? (touchesYuan(refBody) ? '🔴 函数体出现 yuan ⇒ 参考值可能被自动填值' : '零 yuan（只动 ph）')
    : '函数体未解析（见 P-②）');

// ============ B 主判据：wxml value 绑定白名单 ============
sec('B 主判据：wxml 输入框的 value 只能绑「用户自己填」的字段');
{
  const vals = inputValues(pageWxmlRaw);
  const bad = vals.filter((v) => !OK_VALUE.test(v));
  check('B-① 全部 input 的 value 绑定都在用户值白名单内（零越界）',
    bad.length === 0, bad.length ? '越界：' + bad.join(' | ') : `${vals.length} 个全部合规`);
  check('B-② 至少解析到 6 个 value 绑定（防提取器失效 ⇒ B-① 变恒真）',
    vals.length >= 6, `实际 ${vals.length} 个`);
}

// ============ C 正向要求 ============
sec('C 正向要求：参考值确实有出口，且仍是"只写 ph"');
check('C-① `applyRefAmount` 体内确实写 `ph`（防函数被掏空 ⇒ A-① 恒真）',
  !!refBody && /\bph\b/.test(refBody), refBody ? '含 ph' : '函数体未解析');
check('C-② 参考值仍有出口：terms 单源含 `refAmtPh` 键',
  /\brefAmtPh\s*:/.test(readRel(TERMS_REL)), 'miniprogram/i18n/terms.js::m2.refAmtPh');
// ⚠️ round114 变异 A14 实证：只查「键存在」挡不住「键被掏空」（`refAmtPh: ''`）——
//    键还在、参考值没了 ⇒ 输入框灰字变空白（功能**静默失效**），而 C-② 仍绿。
//    同族于 round111 A9「判据面写窄」：**查存在不等于查可用**。
check('C-③ `refAmtPh` 的**值非空**（挡"键在值空" —— A14 实证此处原本是缺口）',
  /\brefAmtPh\s*:\s*['"][^'"]+['"]/.test(readRel(TERMS_REL)), '值须为非空字符串字面量');
check('C-④ 页面已把参考值提示文案映射进 t（`refAmtCard`）',
  /\brefAmtCard\s*:/.test(pageJsRaw), 'pages/sandbox/index.js 的 t 块');

// ============ D 自失效护栏（正负样本互证）============
sec('D 自失效护栏：四件工具各带正负样本互证');
{
  const d1 = stripJs('const a = 1; // 注释里 yuan\nconst s = "http://x/yuan";');
  check('D-① 剥注释器：行注释被剥、字符串字面量被保留（URL 不得被切坏）',
    d1.indexOf('注释里') < 0 && d1.indexOf('http://x/yuan') >= 0 && d1.indexOf('const a = 1;') >= 0,
    d1.replace(/\n/g, '⏎'));
  const d2 = stripJs('/* 块注释 yuan */\nconst b = 2;');
  check('D-② 剥注释器：块注释被剥、代码保留',
    d2.indexOf('块注释') < 0 && d2.indexOf('const b = 2;') >= 0, d2.replace(/\n/g, '⏎'));
}
{
  const pos = '{ return rows.map((r) => Object.assign({}, r, { ph: x })); }';        // 正样本：只改 ph
  const neg = '{ return rows.map((r) => Object.assign({}, r, { yuan: y, ph: x })); }'; // 负样本：动了 yuan
  check('D-③ 判别器正负样本互证：只改 ph ⇒ 不命中 / 动 yuan ⇒ 命中',
    touchesYuan(pos) === false && touchesYuan(neg) === true,
    `正样本=${touchesYuan(pos)} 负样本=${touchesYuan(neg)}`);
}
{
  const sample = '  applyRefAmount(rows, amt) {\n    return rows;\n  },\n  q() { this.applyRefAmount(rows, amt); },\n';
  const b = bodyOf(sample, 'applyRefAmount');
  check('D-④ bodyOf 锚**定义**不锚调用（`this.applyRefAmount(` 不得被当成定义）',
    !!b && b.indexOf('return rows;') >= 0 && b.length < sample.length,
    b ? `取到 ${b.length} 字符（全文 ${sample.length}）` : 'null');
}
{
  const good = inputValues('<input value="{{item.yuan}}" /><input value="{{expectYuan}}" />');
  const bad = inputValues('<input value="{{item.ph}}" />');
  check('D-⑤ value 提取器 + 白名单正负样本互证（用户值 ⇒ 通过 / 参考值 ⇒ 越界）',
    good.length === 2 && good.every((v) => OK_VALUE.test(v)) && bad.length === 1 && !OK_VALUE.test(bad[0]),
    `用户值 ${good.length} 通过 · 参考值「${bad[0]}」越界=${!OK_VALUE.test(bad[0])}`);
}

// ============ E 下界 ============
sec('E 下界：断言数不被悄悄删小');
check('E-① 本守卫断言数 ≥ 13（删掉判据即转红）', pass + failN >= 13, `含本条共 ${pass + failN + 1} 条`);

console.log(`\n===== M2 参考值不预填守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
