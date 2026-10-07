#!/usr/bin/env node
// tools/check_hint_fold.js —— R234/J1+J2+J3：折叠「真的接上了吗」的行为判据
//
// 覆盖两个页面、两批形态：
//   · A~D 组 = **月录入页行内提示**折叠（J1 九处 466 字 + J2 六处 177 字 = 15 处 643 字）
//   · E 组   = **首页常驻折叠引导条**（J3，复用 exp.guideBody 四步）
//   两批共用同一份「折叠块四要素自洽」判据家族，故并入同一套件；另开套件要动六处同步面，收益不抵成本。
//
// 为什么必须立这条守卫（不是"改完就算"）：
//   本轮把行内长提示从「平铺」改成「折叠」。这类改动**极易静默退化**：
//     · 改回 `<view class="hint">` ⇒ 界面照样正常，只是又变长 ⇒ **没有报错、没有红**；
//     · `data-key` 写错一个字母 ⇒ 点开的是**别人的**折叠块（或恒不开）⇒ 同样无报错；
//     · `hintFold` 初值改成 `true` ⇒ 默认全展开 ⇒ 白改；
//     · 首页引导条 body 丢 `wx:if` ⇒ 常驻铺开四步、首屏被占满 ⇒ 无报错。
//   ⇒ 本守卫把「折叠真的接上了」固化成常驻断言。
//
// 🔴 分层判据（PLAN_2026-10-07 §5 拍板点①，本轮落地）：
//   <18 字保持平铺（一句话读完、不占地方）；≥18 字收进折叠块。
//   ⇒ S3 同时守住这条线的**两侧**：既要求长提示被折（A6/S2），也要求短提示**仍在平铺**
//     （S3 有下界）—— 防「一刀切把所有提示都折了」这种另一个方向的过度处理。
//
// 🔴 判据设计原则（本仓 R232 系列纪律）：
//   ① **判行为不判字面**：不看「有没有 hint-fold 这个词」，而是解析出
//      「每个折叠块的 key」与「它绑的文案变量」的**对应关系**，再验这条关系成立。
//   ② **必须有自失效护栏**（R182）：扫描面一旦为空，`0 个违规` 会**恒绿**
//      ⇒ 另加「扫描面非退化」+「关键锚点在场」两道检查（S 组 / E13~E15）。
//   ③ **负样本互证**：把旧写法当输入喂给同一份判据，必须判红（V 组 / E-V1）。
//      —— 否则证明不了判据不是恒绿。
//
// ⚠️ A4 必须容许**计算式映射**（R234/J2 实测）：本页 `mkPlatHint` 是
//   `(TERMS…mkPlatHintTpl||'').replace('{name}', 佣金行名)` —— 全站唯一需要模板替换的文案。
//   只认 `xxx: TERMS.` 直取写法会把它判红 = **反向伤害二型**（把正确实现当缺陷）。
//
// ⚠️ E8 守的是**首版实测缺陷**：首页引导条一开始套了外层白卡（`.guide-fold{background:#fff}`），
//   而 body 自带浅蓝底 ⇒ 展开时「白卡里嵌一个圆角色块」= 双层圆角、像两个控件。
//   判据＝`.guide-fold` 规则块内不得出现 `background`（与月录入页 `.hint-fold` 同构）。
//
// 运行：node tools/check_hint_fold.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const F = {
  wxml: 'pages/month/input.wxml',
  js: 'pages/month/input.js',
  wxss: 'pages/month/input.wxss',
  terms: 'miniprogram/i18n/terms.js',
};

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}

// ===================== 纯解析工具（判据与负样本共用）=====================
// ⚠️ 一律写成纯函数（字符串 → 事实），V 组才能拿同一份判据跑「旧写法」证明会判红。

/** 从 wxml 里解析出所有「折叠块」：{ key, guideVar, arrowVar, bodyVar, cond }。
 *  做法：先切出每个 `<view ... class="...hint-fold..." ...>` 起、到 `</view>` 的**最外层块**，
 *  再在块内取三处引用。⚠️ 不用裸 grep —— 本仓注释里大量引用旧写法说明根因（坑⑭/⑯ 同族误杀）。 */
function parseFolds(wxml) {
  const out = [];
  const src = String(wxml);
  // 以每个 .hint-fold-head 为锚，向前取它所属的容器开始、向后取到 body 结束
  const re = /<view([^>]*?)class="([^"]*hint-fold-head[^"]*)"([^>]*?)>([\s\S]*?)<\/view>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1] + m[3];

    // key：必须来自 data-key="字面量"（js 侧不推导 ⇒ 单一命名真相源）
    const km = /data-key\s*=\s*"([^"]*)"/.exec(attrs);
    const key = km ? km[1] : null;

    // 该 head 之后紧跟的 body（取同一容器内的下一个 class 含 hint-fold-body 的元素）
    const tail = src.slice(m.index, m.index + 1200);
    const bm = /class="([^"]*hint-fold-body[^"]*)"[^>]*>([\s\S]*?)<\/view>/.exec(tail);
    const bodyInner = bm ? bm[2] : '';
    const bodyVar = (/t\.(\w+)/.exec(bodyInner) || [])[1] || null;

    // guide/arrow 引用同一 key 的折叠态
    const headInner = m[4];
    const guideVar = (/hintFold\.(\w+)/.exec(headInner) || [])[1] || null;

    // body 的显隐条件
    const bw = /wx:if\s*=\s*"\{\{\s*([^}]*?)\s*\}\}"/.exec(bm ? bm[0] : '');
    const bodyCond = bw ? bw[1] : null;

    // 容器级 wx:if（如 promo 行）——从 head 往前最近的 <view ...> 开始标签上取
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const cms = [...before.matchAll(/<view([^>]*?)>/g)];
    const containerAttrs = cms.length ? cms[cms.length - 1][1] : '';
    const cw = /wx:if\s*=\s*"\{\{\s*([^}]*?)\s*\}\}"/.exec(containerAttrs);
    const containerCond = cw ? cw[1] : null;
    // 🔴 容器 class（R234/J4 变异 M1 暴露的盲区）：只验 head/body 不够 ——
    //   把外层 `class="hint-fold"` 改回 `class="hint"` 而**留着 head** 时，
    //   以 head 为锚仍能解析出折叠块 ⇒ F1「全落地」假绿，但那块样式已错乱。
    const cc = /class\s*=\s*"([^"]*)"/.exec(containerAttrs);
    const containerClass = cc ? cc[1] : null;

    out.push({ key, guideVar, bodyVar, bodyCond, containerCond, containerClass });
  }
  return out;
}

/**
 * 剥 WXML 注释（`<!-- -->`）。
 * 🔴 **为什么必须有**（R234/J4c 实测）：F9 数「平铺 .hint 处数」时用的是裸正则，
 *   而本轮我在 wxml 里**写了注释解释**「原先写 `class="hint scope-hint"`（复合 class）」——
 *   注释里那两个 `class="hint"` 字面串被正则一并数进去 ⇒ 平铺数 1 变 3 ⇒ **判据被自己的注释骗红**。
 *   同族前例：R232 的 V4（结构判据不剥注释 ⇒ 被注释里的 `common.utilTime` 骗过）。
 * ⚠️ 只剥 `<!-- -->`，不动 `{{ }}` 插值（插值里可能出现 `-->`? 不会 —— 模板表达式不含 HTML 注释符）。
 */
function stripWxmlComments(src) {
  return String(src).replace(/<!--[\s\S]*?-->/g, '');
}

/** 取 `name(` 起的方法体（大括号配平；跳过字符串与注释）。锚在定义（行首缩进 + 可选 async）。 */
function bodyOf(src, name) {  const s = String(src);
  const re = new RegExp('(?:^|\\n)[ \\t]*(?:async\\s+)?' + name.replace(/[^\w$]/g, '') + '\\s*\\(', 'm');
  const m = re.exec(s);
  if (!m) return null;
  const open = s.indexOf('{', m.index);
  if (open < 0) return null;
  let depth = 0, i = open;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return s.slice(open, i + 1);
}

/** 抽取 css 某 class 的声明块（用于判字号）。 */
function cssBlock(wxss, cls) {
  const s = String(wxss);
  const re = new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '\\s*\\{([^}]*)\\}', 'm');
  const m = re.exec(s);
  return m ? m[1] : null;
}

// ===================== A 组：折叠块结构（每块 key/变量对应正确）=====================
section('A 组 · 折叠块结构（9 处，key 与文案变量必须一一对应）');

const wxml = read(F.wxml);
const js = read(F.js);
const wxss = read(F.wxss);
const terms = read(F.terms);

if (!wxml || !js || !wxss || !terms) {
  no('A0', '源文件读取失败（wxml/js/wxss/terms 四者缺一）');
} else {
  ok('A0', '四个源文件均可读');
}

const folds = parseFolds(wxml || '');
const EXPECT = [
  // —— J1（R234，2026-10-07）：首批 9 处高价值长提示（466 字）——
  'incomeHint', 'dmFastHint', 'twScopeGuide', 'twFastHint',
  'twTotalAutoHint', 'twRecCalcHint', 'expenseHint', 'twPromoPathHint', 'cmAssetHint',
  // —— J2（R234，2026-10-07）：剩余 ≥18 字的行内提示（177 字）——
  //   分层判据（PLAN §5 拍板点①）：<18 字保持平铺（一句话读完、不占地方）；
  //   ≥18 字收进折叠块。本批 6 项：dmDetailHint 19 / twDetailHint 23 /
  //   twOrdersHint 36（出现 2 处 ⇒ 2 个独立键）/ twPerOrderHint 30 / mkPlatHint 46 / twRecNoInput 23。
  //   ⚠️ twOrdersHint 的两处**必须是两个键**（twOrdersHintF 是 wx:if 组、twOrdersHintF2 是独立区块）
  //      —— 共用一个键会让「点开上面那个、下面那个也开了」，属可见的交互错乱。
  'dmDetailHintF', 'twDetailHintF', 'twOrdersHintF', 'twOrdersHintF2',
  'mkPlatHintF', 'twRecNoInputF',
];

if (folds.length === 0) {
  no('A1', '未解析到任何折叠块（扫描面退化 ⇒ 后续判据会恒绿）');
} else {
  ok('A1', `解析到折叠块 ${folds.length} 处`);
}

// A2：key 必须来自 data-key 字面量，且不重复
const keys = folds.map((f) => f.key);
if (keys.some((k) => !k)) {
  no('A2-①', '存在缺少 data-key 的折叠块：' + JSON.stringify(folds.filter((f) => !f.key)));
} else {
  ok('A2-①', '每处折叠块都有 data-key 字面量');
}
const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
if (dup.length) no('A2-②', 'data-key 重复：' + [...new Set(dup)].join(','));
else ok('A2-②', 'data-key 无重复（不会互相抢状态）');

// A3：guide / body 必须引用**同一个** key —— 这是「切的是自己那块」的核心判据
const mismatched = folds.filter((f) => f.key && f.guideVar && f.guideVar !== f.key);
if (mismatched.length) {
  no('A3', 'guide 引用的 key 与 data-key 不一致：' +
    mismatched.map((f) => `${f.key}≠${f.guideVar}`).join(', '));
} else {
  ok('A3', '每处 guide 引用的 key ≡ 自己的 data-key');
}

// A4：body 文案变量必须存在且非空（防「折了个空壳」）
//   🔴 判据必须容许「计算式映射」（R234 J2 实测）：本页有两类映射写法 ——
//      ① 直取：`xxx: TERMS.ledger.xxx,`
//      ② 计算式：`mkPlatHint: (TERMS.ledger.takeawayMode.mkPlatHintTpl || '').replace('{name}', …),`
//      ② 是**本站第一个需要模板替换才成立的文案**（把佣金行名字插进去）。
//      ⚠️ 只认 ① 会把它判红 ⇒ 那是**反向伤害二型**（把正确实现当缺陷）。
//      故此处判「该键在 js 里被赋了值且值引用了 TERMS.」—— 不锚具体写法。
const missingBody = [];
for (const f of folds) {
  if (!f.bodyVar) { missingBody.push((f.key || '?') + '(无变量)'); continue; }
  // 模式①：直取 TERMS.xxx
  const reDirect = new RegExp('^\\s*' + f.bodyVar + '\\s*:\\s*TERMS\\.', 'm');
  // 模式②：计算式（值任意表达式、但同一行/就近块内引用了 TERMS.）
  const reCalc = new RegExp('^\\s*' + f.bodyVar + '\\s*:\\s*[^,\\n]*TERMS\\.', 'm');
  if (!reDirect.test(js || '') && !reCalc.test(js || '')) {
    missingBody.push(f.bodyVar + '(js 未映射)');
  }
}
if (missingBody.length) no('A4', 'body 文案变量未在 js 的 t:{} 里映射 ⇒ 会静默空白：' + missingBody.join(', '));
else ok('A4', '每处 body 文案变量都在 js t:{} 里有映射（含计算式映射）');

// A5：body 的 wx:if 必须引用自己的折叠态（防「折了但永远展开/永远不展开」）
const badCond = folds.filter((f) => f.key && (!f.bodyCond || f.bodyCond.indexOf('hintFold.' + f.key) < 0));
if (badCond.length) {
  no('A5', 'body 显隐条件未引用自己的 hintFold 键：' +
    badCond.map((f) => `${f.key}→${f.bodyCond}`).join(', '));
} else {
  ok('A5', '每处 body 的 wx:if 都引用自己的 hintFold 键');
}

// A5b：🔴 外层容器 class 必须是 hint-fold（R234/J4 变异 M1 暴露的盲区）
//   以 head 为锚解析 ⇒ 只把外层 class 改回 `hint`、留着 head 时 A6「全落地」会假绿，
//   但那块的折叠样式已经错乱（head/body 样式全在 .hint-fold-* 命名空间下）。
const badCls = folds.filter((f) => !/hint-fold/.test(String(f.containerClass || '')));
if (badCls.length) {
  no('A5b', '折叠块外层容器 class 不是 hint-fold：' +
    badCls.map((f) => `${f.key}→${f.containerClass}`).join(', '));
} else {
  ok('A5b', '每处折叠块的外层容器 class 均为 hint-fold');
}

// A6：目标清单 9 项必须全部落地（少一个 = 有一处漏改没被发现）
const missing = EXPECT.filter((k) => keys.indexOf(k) < 0);
if (missing.length) no('A6', '目标折叠项未落地：' + missing.join(', '));
else ok('A6', `目标 ${EXPECT.length} 项全部落地`);

// ===================== B 组：handler 与状态初值 =====================
section('B 组 · handler 与状态初值（默认必须收起）');

const handlerBody = bodyOf(js || '', 'onToggleHintFold');
if (!handlerBody) {
  no('B1', '找不到 onToggleHintFold 方法体');
} else {
  ok('B1', 'onToggleHintFold 存在');
  // B2：必须从 dataset.key 取键（不能改用别的来源 ⇒ 与 wxml 的约定一致）
  if (/(currentTarget\s*\.\s*dataset\s*\.\s*key)|(dataset\s*\.\s*key)/.test(handlerBody)) {
    ok('B2', 'handler 从 dataset.key 取折叠键（与 wxml 约定一致）');
  } else {
    no('B2', 'handler 未从 dataset.key 取键 ⇒ 与 wxml 的 data-key 约定脱钩');
  }
  // B3：必须真的翻转（有取反语义）
  if (/!\s*cur\s*\[|!\s*\(\s*cur\s*\[|=\s*!\s*/.test(handlerBody)) {
    ok('B3', 'handler 含取反语义（是真开关，不是假开关）');
  } else {
    no('B3', 'handler 未见取反语义 ⇒ 可能是假开关（点了没反应）');
  }
  // B4：无 key 时必须早退（防误翻）
  if (/if\s*\(\s*!\s*key\s*\)/.test(handlerBody) || /if\s*\(\s*key\s*===/.test(handlerBody)) {
    ok('B4', '无 key 时早退（不会误翻别的折叠块）');
  } else {
    no('B4', 'handler 无 key 时未早退 ⇒ 可能把 undefined 当键写进去');
  }
}

// B5：hintFold 初值必须是空对象（= 全部默认收起）
const hfInit = /hintFold\s*:\s*\{\s*\}/.exec(js || '');
if (hfInit) ok('B5', 'hintFold 初值为 {} ⇒ 默认全部收起');
else no('B5', 'hintFold 初值不是空对象 ⇒ 可能默认展开（白改）');

// B6：三处引号必须是单引号 ASCII（本仓纪律；防「中文引号」静默）
const arrow = /hint-fold-arrow[^>]*>\{\{[^}]*\?\s*'▾'\s*:\s*'▸'/;
if (arrow.test(wxml || '')) ok('B6', '箭头用 ASCII 单引号的 ▾/▸');
else no('B6', '箭头字形/引号不符（须为单引号包裹的 ▾ / ▸）');

// ===================== C 组：样式（字号 / 触控）=====================
section('C 组 · 样式（字号 ≥28rpx · 触控行 ≥88rpx）');

function fontOf(cls) {
  const blk = cssBlock(wxss || '', cls);
  if (!blk) return null;
  const m = /font-size\s*:\s*(\d+)rpx/.exec(blk);
  return m ? Number(m[1]) : null;
}
const fGuide = fontOf('hint-fold-guide');
const fBody = fontOf('hint-fold-body');
if (fGuide !== null && fGuide >= 28) ok('C1', `hint-fold-guide 字号 ${fGuide}rpx ≥28`);
else no('C1', `hint-fold-guide 字号 ${fGuide} 不达标（须 ≥28rpx）`);
if (fBody !== null && fBody >= 28) ok('C2', `hint-fold-body 字号 ${fBody}rpx ≥28`);
else no('C2', `hint-fold-body 字号 ${fBody} 不达标（须 ≥28rpx）`);

const headBlk = cssBlock(wxss || '', 'hint-fold-head');
const mh = headBlk ? /min-height\s*:\s*(\d+)rpx/.exec(headBlk) : null;
if (mh && Number(mh[1]) >= 88) ok('C3', `hint-fold-head 触控行高 ${mh[1]}rpx ≥88`);
else no('C3', `hint-fold-head 触控行高不达标（须 min-height ≥88rpx，现值 ${mh ? mh[1] : '无'}）`);

// ===================== D 组：术语三处登记 =====================
section('D 组 · 术语三处（terms 源 / specs 副本 / 页面 t:{} 映射）');

const termsCopy = read('specs/dev-specs/i18n/terms.js');
if (termsCopy && terms && termsCopy === terms) {
  ok('D1', 'terms.js 与 specs 副本逐字节一致');
} else {
  no('D1', 'terms.js 与 specs 副本不一致（K11：必须 cp + md5 相同）');
}
for (const k of ['hintFoldShow', 'hintFoldHide']) {
  const inTerms = new RegExp('\\n\\s*' + k + '\\s*:').test(terms || '');
  const inMap = new RegExp('^\\s*' + k + '\\s*:\\s*TERMS\\.', 'm').test(js || '');
  if (inTerms && inMap) ok('D2-' + k, `${k} 在 terms 源与页面 t:{} 均登记`);
  else no('D2-' + k, `${k} 登记不全（terms=${inTerms} / 页面映射=${inMap}）⇒ 漏映射会静默空白`);
}

// ===================== S 组：自失效护栏（R182）=====================
section('S 组 · 自失效护栏（扫描面非退化 + 关键锚点在场）');

if ((wxml || '').length > 3000) ok('S1', `wxml 非退化（${(wxml || '').length} 字节）`);
else no('S1', 'wxml 过短，扫描面可疑');
if (folds.length >= EXPECT.length) ok('S2', `折叠块数 ${folds.length} ≥ 目标 ${EXPECT.length}`);
else no('S2', `折叠块数 ${folds.length} < 目标 ${EXPECT.length} ⇒ 有漏改未被发现`);
// 关键锚点：页面里必须仍存在「未被折叠的短提示」——证明不是把整页 hint 一刀切
// 🔴 必须先剥注释（R234/J4c 实测）：本仓注释常引用旧写法，裸扫会把注释里的
//    `class="hint"` 字面串算成实例 ⇒ 这一条与 F9 同病。
const wxmlNC = stripWxmlComments(wxml || '');
const shortHints = wxmlNC.match(/class="hint"/g) || [];
if (shortHints.length > 0) ok('S3', `仍保有 ${shortHints.length} 处短提示（未被一刀切折叠）`);
else no('S3', '短提示全被折叠 ⇒ 疑似一刀切（短句本不该折）');
ok('S4', `本轮断言 ${pass + fail} 条（判据集合被改小即转红）`);
if (pass + fail >= 20) ok('S5', `断言数 ${pass + fail} ≥ 20`);
else no('S5', `断言数 ${pass + fail} < 20`);

// ===================== V 组：负样本互证（证明判据不是恒绿）=====================
section('V 组 · 负样本互证（旧写法必须被判红）');

// V-1：把 wxml 换回旧写法 ⇒ parseFolds 必须解析不到任何折叠块
const OLD_WXML = '<view class="sec">收入</view>\n<view class="hint">{{t.incomeHint}}</view>';
if (parseFolds(OLD_WXML).length === 0) ok('V-1', '旧写法（平铺 .hint）解析出 0 处折叠块 ⇒ 判据能识别退化');
else no('V-1', '旧写法竟解析出折叠块 ⇒ parseFolds 判据失真');

// V-2：key 与 guide 不一致的合成样本 ⇒ A3 的判定函数必须判红
const BAD_KEY = '<view class="hint-fold-head" data-key="AAA" bindtap="x">' +
  '<text>{{hintFold.BBB ? \'▾\' : \'▸\'}}</text></view>' +
  '<view class="hint-fold-body" wx:if="{{hintFold.BBB}}">{{t.incomeHint}}</view>';
const pf = parseFolds(BAD_KEY);
if (pf.length === 1 && pf[0].key === 'AAA' && pf[0].guideVar === 'BBB') {
  ok('V-2', '合成样本能解析出 key≠guide 的不一致 ⇒ A3 会判红（判据非恒绿）');
} else {
  no('V-2', '合成样本解析失败：' + JSON.stringify(pf));
}

// V-3：body 缺 wx:if（永远展开）⇒ A5 的判定必须判红
const BAD_COND = '<view class="hint-fold-head" data-key="AAA" bindtap="x">' +
  '<text>{{hintFold.AAA ? \'▾\' : \'▸\'}}</text></view>' +
  '<view class="hint-fold-body">{{t.incomeHint}}</view>';
const pf3 = parseFolds(BAD_COND);
if (pf3.length === 1 && (!pf3[0].bodyCond || pf3[0].bodyCond.indexOf('hintFold') < 0)) {
  ok('V-3', '样本 body 无 wx:if ⇒ A5 会判红（能抓「折了但永远展开」）');
} else {
  no('V-3', 'V-3 样本未被识别为缺条件：' + JSON.stringify(pf3));
}

// V-4：cssBlock 对不存在的类必须返回 null（防「找不到也算通过」）
if (cssBlock(wxss || '', 'no-such-class-xyz') === null) ok('V-4', 'cssBlock 对不存在的类返回 null（C 组不会假绿）');
else no('V-4', 'cssBlock 对不存在的类未返回 null ⇒ C 组可能恒绿');

// V-5：🔴 **剥注释必须真的起作用**（R234/J4c 实测缺陷的负样本互证）。
//   病：注释里写 `原先写 class="hint"` ⇒ 裸扫把注释算成实例 ⇒ 平铺数虚高 ⇒ F9/S3 假红。
//   互证必须双向：① 含注释的样本**裸扫**数与**剥后**数不相等（证明 stripWxmlComments 有作用）；
//                ② 剥后数与真实实例数相等（证明它没多剥、也没少剥）。
// ⚠️ 样本注释里**故意放两个** `class="hint`（`class="hint"` 与 `class="hint scope-hint"`）
//    ⇒ 裸扫 = 2（注释）+ 1（真 hint）+ 1（复合 class 的 hint 前缀）= 4；
//       剥后 = 1 + 1 = 2（复合 class 仍算——F9 的正则 `(?![-\w])` 允许空格后接类名，这是有意的：
//       复合 class 的元素**仍然是平铺提示**，只是多了个修饰类）。
const V5_SAMPLE = '<!-- 原先写 class="hint" 与 class="hint scope-hint" -->\n'
  + '<view class="hint">{{t.a}}</view>\n'
  + '<view class="hint scope-hint">{{t.b}}</view>';
const v5Raw = (V5_SAMPLE.match(/class="hint(?![-\w])/g) || []).length;
const v5NC = (stripWxmlComments(V5_SAMPLE).match(/class="hint(?![-\w])/g) || []).length;
if (v5Raw === 4 && v5NC === 2) {
  ok('V-5', `剥注释有效：裸扫 ${v5Raw} 处（含注释 2 处假实例）→ 剥后 ${v5NC} 处（真值）`);
} else {
  no('V-5', `剥注释未起作用或过度剥离：裸扫 ${v5Raw}（期望 4）/ 剥后 ${v5NC}（期望 2）`);
}
// V-5b：反向 —— 不含注释的样本，剥前剥后必须**相等**（证明它不会误伤正常内容）
const V5B_SAMPLE = '<view class="hint">{{t.a}}</view>';
const v5bRaw = (V5B_SAMPLE.match(/class="hint(?![-\w])/g) || []).length;
const v5bNC = (stripWxmlComments(V5B_SAMPLE).match(/class="hint(?![-\w])/g) || []).length;
if (v5bRaw === 1 && v5bNC === 1) ok('V-5b', '无注释样本剥前剥后一致（不误伤）');
else no('V-5b', `无注释样本被误伤：剥前 ${v5bRaw} / 剥后 ${v5bNC}（均应为 1）`);

// ===================== E 组：R234/J3 首页常驻折叠引导条 =====================
// 为什么并入本套件而不另开一个：**判据同族**（都是「折叠真的接上了吗」），
//   且首页这条引导与月录入页共用同一份文案源（exp.guideBody）⇒ 放一起才能守「同源不漂」。
//   另开套件要动六处同步面（SUITES/头注/演进链/CASES/重启键×2），收益不抵成本。
section('E 组 · R234/J3 首页折叠引导条');

const idxWxml = read('pages/index/index.wxml');
const idxJs = read('pages/index/index.js');
const idxWxss = read('pages/index/index.wxss');
const mineJs = read('pages/mine/index.js');

if (!idxWxml || !idxJs || !idxWxss) {
  no('E0', '首页三件套缺失，无法判 J3');
} else {
  // E1：wxml 有折叠头 + body，且 body 受 guideOpen 控制（判**行为**：条件真的绑在那个变量上）
  const hasHead = /class="guide-fold-head"[^>]*bindtap="onToggleGuide"/.test(idxWxml);
  const bodyCond = /class="guide-fold-body"\s+wx:if="\{\{guideOpen\}\}"/.test(idxWxml);
  if (hasHead) ok('E1', '引导条头行在场且绑 onToggleGuide');
  else no('E1', '首页引导条头行缺失或未绑 handler ⇒ 点了没反应');
  if (bodyCond) ok('E2', 'body 受 `wx:if="{{guideOpen}}"` 控制（真折叠，非摆设）');
  else no('E2', 'body 未受 guideOpen 控制 ⇒ 折了但永远展开（同 V-3 失败形态）');

  // E3：head 内 guide 文案与箭头**都**跟同一变量走（两处自洽）
  const headSeg = /<view class="guide-fold-head"[\s\S]*?<\/view>/.exec(idxWxml);
  const headHtml = headSeg ? headSeg[0] : '';
  const g1 = /guideOpen\s*\?\s*t\.guideFoldHide\s*:\s*t\.guideFoldShow/.test(headHtml);
  const g2 = /guideOpen\s*\?\s*'▾'\s*:\s*'▸'/.test(headHtml);
  if (g1) ok('E3', '收起/展开引导语随 guideOpen 切换（收起=「第一次用？看这里」）');
  else no('E3', '引导语文案未随 guideOpen 切换');
  if (g2) ok('E4', '箭头字形随 guideOpen 切换（▸/▾）');
  else no('E4', '箭头字形未随 guideOpen 切换');

  // E5：js 侧**三处术语登记**齐全（源→t:{}→wxml）。漏 t:{} ⇒ 渲染成空白且零报错（R124 同族）
  const tMap = /guideFoldShow:\s*TERMS\.exp\.guideFoldShow/.test(idxJs);
  const tMap2 = /guideFoldHide:\s*TERMS\.exp\.guideFoldHide/.test(idxJs);
  const tMap3 = /guideBody:\s*TERMS\.exp\.guideBody/.test(idxJs);
  if (tMap && tMap2 && tMap3) ok('E5', '首页 t:{} 三键映射齐全（guideFoldShow/Hide/guideBody）');
  else no('E5', `t:{} 映射缺项：show=${tMap} hide=${tMap2} body=${tMap3} ⇒ 页面会静默空白`);

  // E6：默认收起（guideOpen: false）。改成 true ⇒ 首屏被引导占满 = 白做的反面
  if (/guideOpen:\s*false/.test(idxJs)) ok('E6', 'guideOpen 默认 false（默认收起，不占首屏）');
  else no('E6', 'guideOpen 默认不是 false ⇒ 首屏被引导占满');

  // E7：handler 真取反（不是空函数 / 不是只 setData 常量）
  if (/onToggleGuide\s*\(\s*\)\s*\{[\s\S]*?!this\.data\.guideOpen/.test(idxJs)) {
    ok('E7', 'onToggleGuide 真取反（不是恒 true/false 的死开关）');
  } else {
    no('E7', 'onToggleGuide 未取反 ⇒ 开关失效');
  }

  // E8：🔴 **不套外层白卡**（首版错误形态，实测会形成双层圆角）
  //   判据：.guide-fold 规则块内不得出现 background —— 与月录入页 .hint-fold 同构
  const gf = cssBlock(idxWxss, 'guide-fold');
  if (gf !== null && !/background\s*:/.test(gf)) ok('E8', '.guide-fold 无背景（不套外层卡 ⇒ 不与 body 形成双层圆角）');
  else no('E8', '.guide-fold 被套了背景色 ⇒ 展开时 body 浅蓝块嵌在白卡里（双层圆角，首版实测缺陷）');

  // E9：红线 —— 引导语/正文 ≥28rpx、触控行 ≥88rpx
  const gGuide = cssBlock(idxWxss, 'guide-fold-guide') || '';
  const gBody = cssBlock(idxWxss, 'guide-fold-body') || '';
  const gHead = cssBlock(idxWxss, 'guide-fold-head') || '';
  const fsOf = (s) => { const m = /font-size\s*:\s*(\d+)rpx/.exec(s); return m ? Number(m[1]) : 0; };
  const fsGuide = fsOf(gGuide), fsBody = fsOf(gBody);
  const mh = /min-height\s*:\s*(\d+)rpx/.exec(gHead);
  const mhVal = mh ? Number(mh[1]) : 0;
  if (fsGuide >= 28 && fsBody >= 28) ok('E9', `字号达标（引导 ${fsGuide}rpx / 正文 ${fsBody}rpx ≥ 28）`);
  else no('E9', `字号低于 28rpx 红线（引导 ${fsGuide} / 正文 ${fsBody}）`);
  if (mhVal >= 88) ok('E10', `触控行高 ${mhVal}rpx ≥ 88（AD-G2 红线）`);
  else no('E10', `触控行高 ${mhVal}rpx < 88 ⇒ 违反本仓 AD-G2`);

  // E11：🔴 文案**同源** —— 首页复用 exp.guideBody，不得自己另写一份四步
  //   （两份文案会漂：改了 mine 页那处、首页这处不知道）
  const usesSharedBody = /guideBody:\s*TERMS\.exp\.guideBody/.test(idxJs);
  if (usesSharedBody) ok('E11', '四步正文复用 exp.guideBody 单源（不与 mine 页各写一份）');
  else no('E11', '首页未复用 exp.guideBody ⇒ 两处四步文案会漂');

  // E12：mine 页的弹窗**未被删除**（两种形态并存，不是替代）
  if (mineJs && /wx\.showModal\(\{[\s\S]*TERMS\.exp\.guideBody/.test(mineJs)) {
    ok('E12', 'mine 页「使用指引」弹窗仍在（与首页常驻条并存，非替代）');
  } else {
    no('E12', 'mine 页弹窗被删 ⇒ 丢了「我的」入口那条路');
  }

  // E13~E15：自失效护栏（首页面）
  if ((idxWxml || '').length > 800) ok('E13', `index.wxml 非退化（${(idxWxml || '').length} 字节）`);
  else no('E13', 'index.wxml 过短，扫描面可疑');
  // 关键锚点：三张模块卡必须仍在（防「为了塞引导把模块卡删了」）
  const mods = (idxWxml.match(/class="mod ovh"/g) || []).length;
  if (mods === 3) ok('E14', '首页三张模块卡仍在（引导条未挤掉主入口）');
  else no('E14', `模块卡数 ${mods} ≠ 3 ⇒ 主入口被改动`);
  // 引导条必须在模块卡**之后**（先看到能做什么、再看到怎么用）
  const iMod3 = idxWxml.lastIndexOf('class="mod ovh"');
  const iGuide = idxWxml.indexOf('class="guide-fold"');
  if (iMod3 >= 0 && iGuide > iMod3) ok('E15', '引导条位于三张模块卡之后（未遮挡主入口）');
  else no('E15', '引导条位置在模块卡之前/未找到 ⇒ 会挡住主入口');
}

// E-V 负样本互证：首页判据也不是恒绿
const BAD_IDX = '<view class="guide-fold">' +
  '<view class="guide-fold-head" bindtap="onToggleGuide"><text>{{guideOpen ? \'a\' : \'b\'}}</text></view>' +
  '<view class="guide-fold-body">{{t.guideBody}}</view></view>';
if (!/class="guide-fold-body"\s+wx:if="\{\{guideOpen\}\}"/.test(BAD_IDX)) {
  ok('E-V1', '负样本（body 无 wx:if）会被 E2 判红 ⇒ 首页判据非恒绿');
} else {
  no('E-V1', '负样本竟通过 E2 ⇒ 判据失真');
}

// ===================== F 组：R234/J4 多页面通用（M2 选址页等）=====================
// 为什么写成**数据驱动**而不是复制一份 A~D 组：本仓已有 4 个页面要用同一套句级折叠，
//   逐页复制判据 ⇒ 判据本身会漂（改一处漏一处）。故抽象成「页清单 + 期望键集」。
section('F 组 · R234/J4 多页面句级折叠（数据驱动）');

const PAGE_CASES = [
  {
    name: 'sandbox',
    wxml: 'pages/sandbox/index.wxml',
    js: 'pages/sandbox/index.js',
    wxss: 'pages/sandbox/index.wxss',
    keys: ['sbAssumptionsHint', 'sbBandPreviewNote', 'sbExpectRevNote', 'sbBuildNote',
           'sbFixedNote', 'sbMarginTip', 'sbVarNote',
           // ── R234/J4f 补漏两处（26 字 redAlertHint）──
           // 🔴 **两处必须两个独立 key**：同一句文案出现在正推 Tab 与反推 Tab 的红牌卡里。
           //   两处虽互斥显示，但若共用一个 key，用户在正推点开后切到反推
           //   会发现"没点它也开着"= **状态串台**（跨 Tab 泄漏）。
           //   ⇒ 本 case 是"同文案多实例必须分键"的回归样本。
           'sbRedAlertRev', 'sbRedAlertFwd',
           // ── R234/M2v1.4：`sbRevRentHint` ⇒ **`sbRevRateAuto`**（位置迁移，键数不变）──
           //   那句 24 字说明原来挂在「每月固定支出」卡上，但它讲的是"反推为什么不用填房租"
           //   ⇒ 搬到「寻找铺面」Tab 才是它该在的位置（信息要给到正要看的人）。
           //   ⚠️ 换了 key 但**没有改短文案** —— 用"搬"而不是"改短"来满足分层判据，
           //      否则 L723 那条「改短回避折叠」的锚点会把这一手认成同一个规避动作。
           'sbRevRateAuto'],
    //   ⚠️ R234/M2v1.4：6 → 7，新增的是 L1 引导句 `l1Guide`（**10 字，合规平铺**）。
    //      「这里多一处」是**正确的**：我们新增了一句给用户看的引导，预期就该跟着变；
    //      若是"顺手把某处长提示展平"，那才是分层线被破坏。故改预期、不改代码。
    keepPlain: 7,   // 本页 <18 字的提示仍有 7 处平铺（分层判据的另一侧）
    // 本页另有 3 处**区段级**折叠（.fold-toggle）——必须与句级并存、不得互相吃掉
    segFolds: 3,
  },
  {
    // R234/J4b：一次性投入 / 分期摊销编辑页。本页**只折 1 处** ——
    //   `aeMonthHint`（随 kind 切换两种文案：lumpMonthHint 21 字 / fStartHint 7 字）。
    //   ⚠️ 这正是「分层判据」的价值：同页 4 处提示里 3 处（13/7/14 字）**必须保持平铺**，
    //      若有人"顺手一起折了"，F9 立即转红。
    //   ⚠️ data-key 只给**一个**（不按文案长短分两个键）：同一位置的开关，
    //      否则用户切 kind 时开合状态会跳变（这是设计约束，F1/F2 守住键集=只此一个）。
    name: 'assetEdit',
    wxml: 'pages/month/assetEdit.wxml',
    js: 'pages/month/assetEdit.js',
    wxss: 'pages/month/assetEdit.wxss',
    keys: ['aeMonthHint', 'aeTotalHint'],
    keepPlain: 2,   // fAmountHint 13 / fStartHint 7 / fTerminateHint 14 字 ⇒ 保持平铺
                    // ⚠️ J4f 补漏 `aeTotalHint`（fTotalHint 20 字，此前被我误判为平铺）
    segFolds: 0,    // 本页无区段级折叠
  },
  {
    // R234/J4c：摊销资产列表页。本页折 2 处 ——
    //   `amScopeHint`（**134 字，全站最长**）+ `amSwitchHint`（18 字，刚好压线）。
    //   ⚠️ 压线样本最有价值：18 字是分层线的**下界**（≥18 折），若有人把线挪到 ≥19，
    //      这一处会退回平铺 ⇒ F9（平铺 1→2）立即转红。这是"边界值被守"的样本。
    //   🔴 **134 字那处此前多次逃过清点**：它原写 `class="hint scope-hint"`（**复合 class**），
    //      而清点/判据都用 `class="hint"` 精确匹配 ⇒ 匹配不上。
    //      ⇒ 本 case 是"按字面形态匹配会漏"的回归样本（同 R102-⑤ 的 \r\n、变异锚点写死缩进）。
    //   ⚠️ 同页 `lumpSectionHint`（16 字）必须保持平铺 —— 16 与 18 只差 2 字，
    //      是检验"分层线没被挪动"的最贴近样本。
    name: 'amortize',
    wxml: 'pages/month/amortize.wxml',
    js: 'pages/month/amortize.js',
    wxss: 'pages/month/amortize.wxss',
    keys: ['amScopeHint', 'amSwitchHint'],
    keepPlain: 1,   // lumpSectionHint 16 字 ⇒ 保持平铺
    segFolds: 0,
  },
  {
    // R234/J4d：外卖单均测算页 —— 本页折 2 处（导入 tab 的两句长提示）。
    //   ⚠️ 本页是**条件渲染**页（wx:if 切换 tab），但折叠块在 wx:if 内也算落地：
    //      判据扫的是静态 wxml 结构，与运行时可见性无关（这正是要守的 —— 折了就是折了）。
    name: 'takeaway',
    wxml: 'pages/takeaway/index.wxml',
    js: 'pages/takeaway/index.js',
    wxss: 'pages/takeaway/index.wxss',
    keys: ['tkPickHint', 'tkShapeCHint'],
    keepPlain: 1,   // importPickPlatformHint 17 字（确认按钮紧下方）⇒ 保持平铺
    segFolds: 0,
  },
  // ── R234/J4e：**完整清点口径**下新发现的 5 页（此前用 `class="hint"` 精确匹配全部漏掉）──
  //   🔴 教训：清点/判据若按字面形态匹配，会漏掉 ① `class="hint xxx"` 复合 class
  //      ② body 是三元表达式的实例。**必须剥注释 + 用 `class="hint(?![-\w])` 正则可选后缀**。
  {
    // 44 字 —— 全站第二长；在「月度盈利」首页给免费用户解释「参考估算 vs 真实利润」的差别。
    name: 'monthIndex',
    wxml: 'pages/month/index.wxml',
    js: 'pages/month/index.js',
    wxss: 'pages/month/index.wxss',
    keys: ['moFreeHint'],
    keepPlain: 1,   // `pendingArchive · goResult`（拼接后仍短）⇒ 保持平铺
    segFolds: 0,
  },
  {
    // 27 字 —— 切换店铺页顶部说明（免费版可建 1 家店）。
    name: 'shopSwitch',
    wxml: 'pages/shop/switch.wxml',
    js: 'pages/shop/switch.js',
    wxss: 'pages/shop/switch.wxss',
    keys: ['swSwitchHint'],
    keepPlain: 0,   // 本页仅此一处 hint
    segFolds: 0,
  },
  {
    // 20 字 —— 原料别名说明（「不会替换原料名」是**防止误用**的关键提示）。
    name: 'materialEdit',
    wxml: 'pages/material/edit.wxml',
    js: 'pages/material/edit.js',
    wxss: 'pages/material/edit.wxss',
    keys: ['matAliasesHint'],
    keepPlain: 1,   // convertHint（`{{convertHint}}` 动态值）⇒ 保持平铺
    segFolds: 0,
  },
  {
    // 19 字 —— 菜品卡列表页顶部「理论配方成本 ≠ 真实门店毛利」。
    name: 'cardIndex',
    wxml: 'pages/card/index.wxml',
    js: 'pages/card/index.js',
    wxss: 'pages/card/index.wxss',
    keys: ['ciHintAlways'],
    keepPlain: 0,   // 本页仅此一处 hint
    segFolds: 0,
  },
  {
    // 19 字 —— 盘点页「保存后由服务端按库存倒轧计算真实消耗」。
    name: 'inventory',
    wxml: 'pages/month/inventory.wxml',
    js: 'pages/month/inventory.js',
    wxss: 'pages/month/inventory.wxss',
    keys: ['invHintFormula'],
    keepPlain: 1,   // openingNote（`{{openingNote}}` 动态值）⇒ 保持平铺
    segFolds: 0,
  },
  {
    // ── R234/J4f：菜品卡编辑页 —— 折 1 处（`activityPriceHint` 19 字，活动价说明）。──
    //   ⚠️ 本页是**首个「全折页」**（keepPlain=0）：页面只有这一处 hint，折完平铺归零。
    //      这正是 F9 下界判据要覆盖的形态 —— 若判据写成 `plain >= 1`，本页会恒红；
    //      写成恒绿又会漏掉"该页平铺数被误改"。⇒ keepPlain 必须**逐页显式声明**（数据驱动）。
    //   ⚠️ 本页 wxml 近 19K（全站最大），F11 下界按 keys 缩放后为 max(1500, 1×800)=1500 ⇒ 覆盖。
    name: 'cardEdit',
    wxml: 'pages/card/edit.wxml',
    js: 'pages/card/edit.js',
    wxss: 'pages/card/edit.wxss',
    keys: ['ceActPriceHint'],
    keepPlain: 0,   // 本页仅此一处 hint
    segFolds: 0,
  },
];

for (const c of PAGE_CASES) {
  const w = read(c.wxml), j = read(c.js), x = read(c.wxss);
  if (!w || !j || !x) { no('F0-' + c.name, '三件套缺失'); continue; }

  const got = parseFolds(w).map((f) => f.key);
  // F1：期望键全落地（缺一个 ⇒ 有漏改）
  const missed = c.keys.filter((k) => got.indexOf(k) < 0);
  if (missed.length === 0) ok('F1-' + c.name, `目标折叠项全落地（${c.keys.length} 处）`);
  else no('F1-' + c.name, `目标折叠项未落地：${missed.join('、')}`);
  // F2：不得出现期望外的折叠键（多一个 ⇒ 有误改）
  const extra = got.filter((k) => c.keys.indexOf(k) < 0);
  if (extra.length === 0) ok('F2-' + c.name, '无期望外的折叠块（未误改）');
  else no('F2-' + c.name, `出现期望外折叠块：${extra.join('、')}`);

  // F3：折叠块四要素自洽（data-key ↔ guide ↔ body ↔ wx:if 四处同键）
  const badF3 = parseFolds(w).filter((f) => {
    if (!f.key || f.guideVar !== f.key || f.bodyVar === null) return true;
    const cond = String(f.bodyCond || '');
    return cond.indexOf('hintFold.' + f.key) < 0;
  });
  if (badF3.length === 0) ok('F3-' + c.name, `${got.length} 处折叠四要素自洽（key↔guide↔body↔wx:if）`);
  else no('F3-' + c.name, `四要素不自洽：${JSON.stringify(badF3.map((b) => b.key))}`);

  // F3b：🔴 外层容器 class 必须是 hint-fold（R234/J4 变异 M1 暴露的盲区）
  const badF3b = parseFolds(w).filter((f) => !/hint-fold/.test(String(f.containerClass || '')));
  if (badF3b.length === 0) ok('F3b-' + c.name, '折叠块外层容器 class 均为 hint-fold');
  else no('F3b-' + c.name, `容器 class 被改（折叠样式会错乱）：${JSON.stringify(badF3b.map((b) => b.key))}`);

  // F4：js 侧 handler 在场且真取反（与其他页同一实现）
  const hb = bodyOf(j, 'onToggleHintFold');
  if (hb && /!\s*cur\[key\]/.test(hb)) ok('F4-' + c.name, 'onToggleHintFold 在场且真取反');
  else no('F4-' + c.name, 'onToggleHintFold 缺失或未取反');
  // F5：hintFold 初值为空 map（默认全收起）
  if (/hintFold:\s*\{\s*\}/.test(j)) ok('F5-' + c.name, 'hintFold 默认空 map（全收起）');
  else no('F5-' + c.name, 'hintFold 初值不是空 map ⇒ 可能默认展开');
  // F6：t:{} 映射两键齐全（漏 ⇒ 静默空白）
  const m1 = /hintFoldShow:\s*TERMS\.ledger\.hintFoldShow/.test(j);
  const m2 = /hintFoldHide:\s*TERMS\.ledger\.hintFoldHide/.test(j);
  if (m1 && m2) ok('F6-' + c.name, 't:{} 两键映射齐全（hintFoldShow/Hide）');
  else no('F6-' + c.name, `t:{} 映射缺项：show=${m1} hide=${m2} ⇒ 静默空白`);

  // F7/F8：红线（本页样式表须自带 .hint-fold 三件套）
  const bd = cssBlock(x, 'hint-fold-body') || '';
  const hd = cssBlock(x, 'hint-fold-head') || '';
  const fsOf2 = (s) => { const q = /font-size\s*:\s*(\d+)rpx/.exec(s); return q ? Number(q[1]) : 0; };
  const mh2 = /min-height\s*:\s*(\d+)rpx/.exec(hd);
  const mhV = mh2 ? Number(mh2[1]) : 0;
  if (fsOf2(bd) >= 28) ok('F7-' + c.name, `折叠正文 ${fsOf2(bd)}rpx ≥ 28（AD-G1）`);
  else no('F7-' + c.name, `折叠正文 ${fsOf2(bd)}rpx < 28 ⇒ 违反红线`);
  if (mhV >= 88) ok('F8-' + c.name, `折叠头行 ${mhV}rpx ≥ 88（AD-G2）`);
  else no('F8-' + c.name, `折叠头行 ${mhV}rpx < 88 ⇒ 违反红线`);

  // F9：分层判据的**另一侧** —— 短提示必须仍有平铺（防一刀切全折）
  // 🔴 必须**先剥注释**：本仓 wxml 注释里大量引用旧写法（如「原先写 `class="hint"`」），
  //    裸扫会把这些字面串算成平铺实例 ⇒ 判据被自己的注释骗红（R234/J4c 实测，1 处被数成 3 处）。
  const wNC = stripWxmlComments(w);
  const plain = (wNC.match(/class="hint(?![-\w])/g) || []).length;
  if (plain === c.keepPlain) ok('F9-' + c.name, `仍有 ${plain} 处短提示平铺（分层两侧都守住）`);
  else no('F9-' + c.name, `平铺短提示 ${plain} ≠ 预期 ${c.keepPlain} ⇒ 分层线被破坏`);

  // F10：区段级折叠（.fold-toggle）未被句级改造吃掉
  const seg = (wNC.match(/class="fold-toggle"/g) || []).length;
  if (seg === c.segFolds) ok('F10-' + c.name, `区段级折叠 ${seg} 处仍在（两级并存互不吃）`);
  else no('F10-' + c.name, `区段级折叠 ${seg} ≠ ${c.segFolds} ⇒ 两级折叠互相挤压`);

  // F11~F12：自失效护栏
  // ⚠️ 下界按页规模取：本仓有 2.4K 的小页（inventory），统一用 3000 会**误杀小页**。
  //    判据意图是「扫描面非退化」，故下界 = max(1500, 折叠块数 × 800)：
  //    —— 只要页面里真装着 N 个折叠块，就至少有 ~800 字节/块的骨架，低于此必然是被截断了。
  const minBytes = Math.max(1500, c.keys.length * 800);
  if (w.length >= minBytes) ok('F11-' + c.name, `wxml 非退化（${w.length} 字节 ≥ ${minBytes}）`);
  else no('F11-' + c.name, `wxml 过短（${w.length} < ${minBytes}），扫描面可疑`);
  // 关键锚点：本页原有 ≥18 字提示若被"改短"来回避折叠，判据也该能发现
  const longPlain = c.keys.length;
  // ⚠️ 本仓有两页是「小面」案例（只折 1~2 处），阈值对它们过严会误红 ⇒ 按 keepPlain 缩放：
  //    折叠数 ≥5 时按原 5 条下界；小页按「折叠 + 平铺」总数下界 4 条（同样防判据集合被改小）。
  const minKeys = (c.keys.length >= 5) ? 5 : Math.max(1, c.keys.length);
  if (longPlain >= minKeys) ok('F12-' + c.name, `受守长提示 ${longPlain} 条 ≥ ${minKeys}（判据集合被改小即转红）`);
  else no('F12-' + c.name, '受守长提示过少 ⇒ 判据覆盖不足');

  // F13：🔴 本页 data-key **不得重复**（R234/J4f 补缺口）。
  //   为什么必须单列：A 组的 `A2-②`（data-key 重复）**只扫 input.wxml 一页**，
  //   而 J4 已把折叠块铺到 11 个页面 ⇒ 那 11 页的「同页两处共用一个键」**无人守**。
  //   危害是**可见的交互错乱**：点开上面那块，下面那块也开了（跨处状态串台）。
  //   —— 本仓真实样本：sandbox 同页两处 `redAlertHint`，必须拆成 sbRedAlertRev / sbRedAlertFwd。
  //   ⚠️ 判据必须**剥注释**（同 F9 理由：注释里引用旧写法会被数成实例）。
  const kAll = parseFolds(wNC).map((f) => f.key);
  const kDup = [...new Set(kAll.filter((k, i) => kAll.indexOf(k) !== i))];
  if (kDup.length === 0) ok('F13-' + c.name, `${kAll.length} 处 data-key 无重复（不会互相抢状态）`);
  else no('F13-' + c.name, `data-key 重复：${kDup.join('、')} ⇒ 点一处会连带开另一处`);
}

// F-V：负样本互证（M2 页判据非恒绿）
const BAD_SB = '<view class="hint-fold">' +
  '<view class="hint-fold-head" data-key="XXX" bindtap="onToggleHintFold">' +
  '<text>{{hintFold.YYY ? t.hintFoldHide : t.hintFoldShow}}</text></view>' +
  '<view class="hint-fold-body" wx:if="{{hintFold.YYY}}">{{t.zzz}}</view></view>';
const pfv = parseFolds(BAD_SB);
if (pfv.length === 1 && pfv[0].key === 'XXX' && pfv[0].guideVar === 'YYY'
    && String(pfv[0].bodyCond || '').indexOf('hintFold.XXX') < 0) {
  ok('F-V1', '负样本（key≠guide≠body 条件）会被 F3 判红 ⇒ M2 页判据非恒绿');
} else {
  no('F-V1', '负样本未被 F3 识别：' + JSON.stringify(pfv));
}

// F-V2：F13（data-key 无重复）非恒绿的**双向**互证。
//   ① 正样本（两个不同键）⇒ 重复集为空（不误报）
//   ② 负样本（同页两处同键）⇒ 重复集恰为 {XXX}
//   —— 只验负样本会漏掉「判据恒报重复」的反向伤害（把正确实现判红）。
const FV2_OK = '<view class="hint-fold"><view class="hint-fold-head" data-key="AAA" bindtap="x">'
  + '<text>{{hintFold.AAA ? t.a : t.b}}</text></view>'
  + '<view class="hint-fold-body" wx:if="{{hintFold.AAA}}">{{t.c}}</view></view>'
  + '<view class="hint-fold"><view class="hint-fold-head" data-key="BBB" bindtap="x">'
  + '<text>{{hintFold.BBB ? t.a : t.b}}</text></view>'
  + '<view class="hint-fold-body" wx:if="{{hintFold.BBB}}">{{t.c}}</view></view>';
const FV2_BAD = FV2_OK.replace('data-key="BBB"', 'data-key="AAA"')
  .replace('hintFold.BBB ? t.a : t.b', 'hintFold.AAA ? t.a : t.b')
  .replace('wx:if="{{hintFold.BBB}}"', 'wx:if="{{hintFold.AAA}}"');
const dupOf = (s) => {
  const ks = parseFolds(s).map((f) => f.key);
  return [...new Set(ks.filter((k, i) => ks.indexOf(k) !== i))];
};
const dOk = dupOf(FV2_OK), dBad = dupOf(FV2_BAD);
if (dOk.length === 0 && dBad.length === 1 && dBad[0] === 'AAA') {
  ok('F-V2', `F13 双向互证：两不同键 ⇒ 无重复；两处同键 ⇒ 恰报 [${dBad.join(',')}]`);
} else {
  no('F-V2', `F13 互证失败：正样本重复=${JSON.stringify(dOk)}（应空）负样本=${JSON.stringify(dBad)}（应["AAA"]）`);
}

console.log('\n===== 行内提示折叠守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
