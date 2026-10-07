#!/usr/bin/env node
// tools/check_hint_fold.js —— R234/J1+J2：月录入页「行内提示折叠」的行为判据
//
// 为什么必须立这条守卫（不是"改完就算"）：
//   本轮把行内长提示从「平铺」改成「折叠」（J1 九处 466 字 + J2 六处 177 字 = 15 处 643 字）。
//   这类改动**极易静默退化**：
//     · 改回 `<view class="hint">` ⇒ 界面照样正常，只是又变长 ⇒ **没有报错、没有红**；
//     · `data-key` 写错一个字母 ⇒ 点开的是**别人的**折叠块（或恒不开）⇒ 同样无报错；
//     · `hintFold` 初值改成 `true` ⇒ 默认全展开 ⇒ 白改。
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
//      ⇒ 另加「扫描面非退化」+「关键锚点在场」两道检查（S 组）。
//   ③ **负样本互证**：把旧写法当输入喂给同一份判据，必须判红（V 组）。
//      —— 否则证明不了判据不是恒绿。
//
// ⚠️ A4 必须容许**计算式映射**（R234/J2 实测）：本页 `mkPlatHint` 是
//   `(TERMS…mkPlatHintTpl||'').replace('{name}', 佣金行名)` —— 全站唯一需要模板替换的文案。
//   只认 `xxx: TERMS.` 直取写法会把它判红 = **反向伤害二型**（把正确实现当缺陷）。
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

    out.push({ key, guideVar, bodyVar, bodyCond, containerCond });
  }
  return out;
}

/** 取 `name(` 起的方法体（大括号配平；跳过字符串与注释）。锚在定义（行首缩进 + 可选 async）。 */
function bodyOf(src, name) {
  const s = String(src);
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
const shortHints = (wxml || '').match(/class="hint"/g) || [];
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

console.log('\n===== 行内提示折叠守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
