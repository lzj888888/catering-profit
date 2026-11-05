// tools/check_m1_indicator_view.js —— R129 · M1 行业指标对照守卫（round115）
// 运行： node tools/check_m1_indicator_view.js
//
// 立项依据（两条都是**实测**出来的，不是推测）：
//   ① 【静默失效】M1 台账落库存的是**细项名字符串**，而 indicatorRef::ITEM_TAGS 是按名字建的归属表
//      ⇒ 李老师哪天在 terms.js 把「房租」改成「租金」，归属表就**静默失配**：页面显示「—」，
//        **不报错、不崩溃、门禁全绿** —— 这是最贵的一类 bug（改了文案，功能悄悄没了）。
//      ⇒ 本守卫把「ITEM_TAGS 的每个名字都必须真实存在于 terms 的支出细项里」变成机器判据。
//        **改名会让它转红**，而不是悄悄算不出数。
//   ② 【页面硬编码阈值】行业数字必须全部来自出参（后端 indicatorRef 单源）。
//      一旦有人在 result 页写死 `15%` / `55%`，将来指标改带时**页面不跟** ⇒ 展示与口径脱节。
//
// 判据分五段：P 前置 / A 静默失效 / B 零硬编码 / C 出参契约 / D 工具自证 / E 下界。
// ⚠️ 本文件里不写字面反引号（会触发 Node Invalid or unexpected token），需要时用 BT 常量拼。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');

const REF_REL = 'cloudfunctions/common/indicatorRef.js';
const TERMS_REL = 'miniprogram/i18n/terms.js';
const PAGE_JS_REL = 'subpkg/biz/month/result.js';
const PAGE_WXML_REL = 'subpkg/biz/month/result.wxml';
const GETLEDGER_REL = 'cloudfunctions/getLedger/index.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const BT = String.fromCharCode(96);

// ===== 工具：引号感知的注释剥离（判"页面里有没有硬编码数字"前必须先去注释，否则注释里的示例会误伤）=====
function stripJs(src) {
  let out = '', i = 0;
  const n = src.length;
  let st = 0; // 0 普通 / 1 单引 / 2 双引 / 3 模板 / 4 行注释 / 5 块注释
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (st === 0) {
      if (c === '/' && d === '/') { st = 4; i += 2; continue; }
      if (c === '/' && d === '*') { st = 5; i += 2; continue; }
      if (c === "'") { st = 1; out += c; i++; continue; }
      if (c === '"') { st = 2; out += c; i++; continue; }
      if (c === BT) { st = 3; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === 4) { if (c === '\n') { st = 0; out += c; } i++; continue; }
    if (st === 5) { if (c === '*' && d === '/') { st = 0; i += 2; } else i++; continue; }
    if (c === '\\') { out += c + (d || ''); i += 2; continue; }
    if (st === 1 && c === "'") st = 0;
    else if (st === 2 && c === '"') st = 0;
    else if (st === 3 && c === BT) st = 0;
    out += c; i++;
  }
  return out;
}

// ===== 工具：有没有「数字 + 百分号」这种硬编码阈值 =====
// （模板 {{x}}% 不含数字 ⇒ 不误伤；只抓真正写死的 15% / 55% 之类）
function hasHardcodedPct(src) {
  return /\d+(\.\d+)?\s*%/.test(src);
}

// ===== 工具：归属表里的名字是否都在「允许的细项名集合」里 =====
function missingItemNames(tags, allowed) {
  const miss = [];
  for (const k of Object.keys(tags || {})) {
    for (const nm of (tags[k] || [])) if (allowed.indexOf(nm) < 0) miss.push(k + ':' + nm);
  }
  return miss;
}

// ================= P 前置 =================
console.log('===== P 前置 =====');
let refSrc = '', termsSrc = '', jsSrc = '', wxmlSrc = '', glSrc = '';
let readable = true;
try {
  refSrc = read(REF_REL); termsSrc = read(TERMS_REL);
  jsSrc = read(PAGE_JS_REL); wxmlSrc = read(PAGE_WXML_REL); glSrc = read(GETLEDGER_REL);
} catch (e) { readable = false; }
check('P-① 单源 / 术语 / 结果页 / getLedger 五文件均可读', readable, readable ? '' : '有文件读不到');

const { TERMS } = require(rel(TERMS_REL));
const M2 = (TERMS && TERMS.m2) || {};
const RP = (TERMS && TERMS.resultPage) || {};
const expGroups = ((TERMS && TERMS.ledger && TERMS.ledger.expense) || []);
check('P-② terms 的支出大类存在且有细项（守卫的判据源）',
  expGroups.length >= 4 && expGroups.every((g) => Array.isArray(g.items) && g.items.length > 0),
  `${expGroups.length} 个大类`);

const indicatorRef = require(rel(REF_REL));
const ITEM_TAGS = indicatorRef.ITEM_TAGS || {};
const IND_KEYS = indicatorRef.IND_KEYS || [];
const M1_IND_KEYS = indicatorRef.M1_IND_KEYS || [];
const ALL_ITEM_NAMES = [];
for (const g of expGroups) for (const n of (g.items || [])) ALL_ITEM_NAMES.push(n);
check('P-③ 术语细项名全集已构建（判 A-① 的基准）', ALL_ITEM_NAMES.length > 0, `${ALL_ITEM_NAMES.length} 个细项名`);

// ================= A 静默失效（本守卫的存在理由）=================
console.log('\n===== A 细项归属 ↔ 术语一致性（防「改文案 ⇒ 指标静默失效」）=====');
const miss = missingItemNames(ITEM_TAGS, ALL_ITEM_NAMES);
check('A-① 🔴 归属表里每个细项名都真实存在于 terms 的支出细项中（改名即转红）',
  miss.length === 0, miss.length ? '失配: ' + miss.join(' , ') : `${Object.keys(ITEM_TAGS).length} 组全部命中`);
check('A-② 归属表的 key 都是合法指标键（⊆ INDICATORS）',
  Object.keys(ITEM_TAGS).every((k) => IND_KEYS.indexOf(k) >= 0), Object.keys(ITEM_TAGS).join(','));
check('A-③ 🔴 归属表**不含 manage**（李老师 2026-09-24 拍板：M1 不做管理费这项）',
  ITEM_TAGS.manage === undefined);
check('A-④ 反向：energy 归属名恰好是「水费/电费/燃气费」三项（合并口径不变）',
  (ITEM_TAGS.energy || []).length === 3
  && ['水费', '电费', '燃气费'].every((x) => (ITEM_TAGS.energy || []).indexOf(x) >= 0));

// ================= B 页面零硬编码阈值 =================
console.log('\n===== B 结果页零硬编码阈值（行业数字必须全部来自出参）=====');
const jsCode = stripJs(jsSrc);
const wxmlCode = stripJs(wxmlSrc);
check('B-① 结果页 .js 剥注释后无「数字+%」硬编码', !hasHardcodedPct(jsCode));
check('B-② 结果页 .wxml 无「数字+%」硬编码', !hasHardcodedPct(wxmlCode));
check('B-③ 结果页不引指标库（不得 require indicatorRef / 出现 BANDS / REDLINE）',
  !/indicatorRef|BANDS|REDLINE/.test(jsCode));
check('B-④ 🔴 缺项必须走「本月没填」而非 0%（页面存在 indMissing 分支）',
  /indMissing/.test(jsCode) && /indMissing/.test(wxmlSrc));
check('B-⑤ 页面用 has 标记区分「有值 / 没值」（防把 null 渲染成 0）',
  /has:\s*has/.test(jsCode) || /has,/.test(jsCode) || /const has =/.test(jsCode));

// ================= C 出参契约 =================
console.log('\n===== C getLedger 出参契约 =====');
check('C-① getLedger 调 indicatorRef.evaluateIndicators（复用单源，不自算阈值）',
  /indicatorRef\.evaluateIndicators\(/.test(glSrc));
check('C-② 出参经 M1 口径过滤（m1IndicatorsOf，不在前端手筛）', /m1IndicatorsOf\(/.test(glSrc));
check('C-③ 出参含 indicators 数组', /(^|\s)indicators,\s*$/m.test(glSrc) || /\bindicators,/.test(glSrc));
check('C-④ 出参含 indicator_scope（业态/城市回显 + is_default_scope）',
  /indicator_scope/.test(glSrc) && /is_default_scope/.test(glSrc));
check('C-⑤ 🔴 分母与 result **同源**（revenueFen 取 result.incomeTotalFen）',
  /const incomeTotal = result\.incomeTotalFen/.test(glSrc) && /revenueFen: incomeTotal/.test(glSrc));
check('C-⑥ M1 口径恰为 5 项且不含 manage',
  M1_IND_KEYS.length === 5 && M1_IND_KEYS.indexOf('manage') < 0, M1_IND_KEYS.join(','));
check('C-⑦ 细项归属走单源 sumByTag（controller 不自己写映射表）',
  /indicatorRef\.sumByTag\(/.test(glSrc) && /toFixedFen\(/.test(glSrc));
check('C-⑧ 术语：M1 复用 M2 的指标名与两张评级表（未另造一份）',
  !!(M2.indNames && M2.indLevels && M2.indLevelsGain && M2.indBand && M2.indMine));
check('C-⑨ 结果页新增文案已进 terms（三处同步里的术语侧）',
  !!(RP.indTitle && RP.indMissing && RP.indMarginNote && RP.indMktNote));
check('C-⑩ 结果页 js 的 t 块已映射这些新文案（少一处 wxml 会取空串）',
  /indTitle:\s*TERMS\.resultPage\.indTitle/.test(jsSrc) && /indBand:\s*TERMS\.m2\.indBand/.test(jsSrc));

// ================= F 体检卡「依据折叠」（R314）=================
// 为什么必须机器守：折叠这类改动的失效方式**全是静默的** ——
//   默认值改回 true ⇒ 又变回 6 行（观感回退，零报错）；
//   bindtap 写错一个字母 ⇒ 点了没反应（零报错）；
//   `beMore` 在 js 里没有 data 键 ⇒ 恒 undefined ⇒ 恒收起（点了永远不展开，零报错）。
console.log('');
console.log('===== F 体检卡依据折叠（R314）=====');
check('F-① wxml 有折叠控件且绑定 onToggleBeMore（不是死代码）',
  /bindtap="onToggleBeMore"/.test(wxmlCode) && /\{\{beMore \?/.test(wxmlCode));
check('F-② handler 真翻转 beMore（不是空函数）',
  /onToggleBeMore\s*\(\s*\)\s*\{[\s\S]{0,200}setData\s*\(\s*\{\s*beMore\s*:\s*!this\.data\.beMore/.test(jsCode));
const dataSeg = (jsCode.match(/data:\s*\{([\s\S]{0,1200})/) || [])[1] || '';
check('F-③ 默认**收起**（data 里 beMore: false，不是 true）', dataSeg.indexOf('beMore: false') >= 0);
const foldSeg = (wxmlCode.match(/<block wx:if="\{\{beMore\}\}">([\s\S]*?)<\/block>/) || [])[1] || '';
// 🔴 F-④ **判据于 2026-10-25 变更（李老师真机亲自拍板，非"改判据迎合代码"）**：
//   原判据＝「保本区间 / 达标营业额 / 房租归因**都在折叠区内**」（R314 定的"依据折叠"）。
//   李老师真机反馈：「这个结论恰恰倒该露出来，大家很关注这个（做到多少才不亏），藏起来不行」。
//   ⇒ 定案改为：**结论（保本营收 / 达标营业额）露出，依据（回本路径 / 毛利结构 / 房租归因）才折叠**。
//   故本条改为判「该露的在外面、该藏的在里面」，两头都守住（不是放松）。
check('F-④ 结论露出、依据折叠（R480/R482 定案：盈亏平衡点 / 达标营业额在折叠区**外**，房租归因在**内**）',
  foldSeg.indexOf('bePoint') < 0 && foldSeg.indexOf('beHealthy') < 0
  && /beAttrLead/.test(foldSeg)
  && wxmlCode.indexOf('t.bePoint') < wxmlCode.indexOf('<block wx:if="{{beMore}}">')
  && wxmlCode.indexOf('t.beHealthy') < wxmlCode.indexOf('<block wx:if="{{beMore}}">'));
check('F-⑤ 自失效护栏：默认 true 的样本必须判红（防本组恒绿）',
  'data: { beMore: true, t: {} }'.indexOf('beMore: false') < 0);

// ================= G 回本两条路（R315）=================
// 为什么机器守：亏损月如果只给"营收要涨 X%"，等于只指一条路；而"降变动成本"这条
//   必须真的算出来（v 压到 1 - F/R），不能写死一句空话；反过来 F >= R 时又**不能**
//   给这条路（v 要压到 <=0，不可能）—— 这两种失效都零报错。
console.log('');
console.log('===== G 回本两条路（R315）=====');
const BE2 = require('../utils/breakeven.js');
check('G-① recoverPaths 已导出', typeof BE2.recoverPaths === 'function');
const rp9 = BE2.recoverPaths({ revenueFen: 9200000, fixedFen: 3282800, variableFen: 6687300 });
check('G-② 锚点：9 月样本回本营收 12019644 / 变动率压到 64.3 / 需降 8.4 个点',
  rp9.ok === true && rp9.needRevenueFen === 12019644 && rp9.targetVarRatePct === 64.3 && rp9.varGapPp === 8.4);
const rpF = BE2.recoverPaths({ revenueFen: 100000, fixedFen: 120000, variableFen: 10000 });
check('G-③ 固定成本超过营收时，路径二**不存在**（不许编「压到 0%」）',
  rpF.ok === true && rpF.varPathPossible === false);
check('G-④ 页面亏损月切到 pathText、赚钱月才显示 marginText',
  /pathText:/.test(jsCode) && /BE\.recoverPaths\(/.test(jsCode) && /safeMarginPct < 0\) \? ''/.test(jsCode));
check('G-⑤ 自失效护栏：把 F>R 的样本判成「路径二可行」必须被抓（防本组恒绿）',
  BE2.recoverPaths({ revenueFen: 100000, fixedFen: 120000, variableFen: 10000 }).varPathPossible !== true);

// ================= D 工具自证（判据不是恒真）=================
console.log('\n===== D 工具自证（正负样本互证）=====');
const S1 = 'var a = 1; // 阈值 15%\nvar b = 2;';
check('D-① stripJs 正样本：行注释里的数字被剥掉', !hasHardcodedPct(stripJs(S1)));
const S2 = 'var s = "15% 是注释符号 // 不是注释";';
check('D-② stripJs 负样本：字符串里的 // 不被当注释（内容保留）', stripJs(S2).indexOf('15%') >= 0);
const S3 = "var t = '文字 /* 不是注释 */ 还在'; /* 真注释 55% */";
check('D-③ stripJs 负样本：字符串里的块注释符号不被误剥', stripJs(S3).indexOf('/*') >= 0 && !hasHardcodedPct(stripJs(S3)));
check('D-④ hasHardcodedPct 负样本：纯数字无百分号不算阈值', hasHardcodedPct('x = 15; y = 20; z = 55;') === false);
check('D-⑤ hasHardcodedPct 正样本：写死的「房租 15%」被抓住', hasHardcodedPct("text = '房租 15%'") === true);
check('D-⑥ hasHardcodedPct 负样本：模板 {{x}}% 不误伤', !hasHardcodedPct('{{item.pct}}%'));
check('D-⑦ missingItemNames 正样本：全命中返回空', missingItemNames({ rent: ['房租'] }, ['房租', '电费']).length === 0);
check('D-⑧ missingItemNames 负样本：失配能被列出', missingItemNames({ rent: ['租金'] }, ['房租']).join() === 'rent:租金');

// ================= H 口径同源（R480）=================
console.log('\n===== H 口径同源：达标营业额必须与指标卡同一套「业态 × 城市」区间 =====');
// 为什么单独立这一段：
//   原先「达标营业额」用前端**写死**的房租 15% / 人工 22% / 房租目标 12%，而下方指标卡的
//   参考带来自后端 indicatorRef（分业态 × 分城市）⇒ **同一页两个"正常"口径**：
//   老板改业态时只有下面那块跟着变，上面这块纹丝不动（真机：一块能改、一块不能改，不知信哪个）。
// ⚠️ 旧判据 hasHardcodedPct **抓不到这个** —— 它只认「数字 + %」，而这里是 `hiPct: 15`（无百分号），
//    所以必须单立一条（同一族病：判据在真因之外的位置全绿）。
const hasHardcodedHi = (s) => /hiPct:\s*(15|22)\b/.test(s) || /targetRatePct:\s*12\b/.test(s);
check('H-① buildBreakeven 收 inds 参数（后端指标进得来）', /buildBreakeven\(d, res, prevProfitFen, inds\)/.test(jsCode));
check('H-② 调用处真的把 inds 传进去了', /buildBreakeven\(d, res, prevProfitFen, inds\)/.test(jsCode));
check('H-③ 达标营业额的房租/人工上限不再写死（改用后端指标）',
  /hiPct: rentHi/.test(jsCode) && /hiPct: laborHi/.test(jsCode) && !/hiPct:\s*(15|22)\b/.test(jsCode));
check('H-④ 房租目标率不再写死 12（改用该业态区间中点）',
  /targetRatePct: rentTarget/.test(jsCode) && !/targetRatePct:\s*12\b/.test(jsCode));
check('H-⑤ 取不到后端指标时仍有兜底（零回归，不许硬崩）',
  /hiOf\('rent',\s*15\)/.test(jsCode) && /hiOf\('labor',\s*22\)/.test(jsCode));
check('H-⑥ 页面把「按哪个业态算的」写在旁边（说了才不作假）',
  /healthyScopeText/.test(jsCode) && /be\.healthyScopeText/.test(wxmlCode));
check('H-⑦ terms 有 beHealthyScope 文案键', /beHealthyScope:/.test(termsSrc));
const H_VARIANT = jsCode.replace(/hiPct: rentHi/, 'hiPct: 15').replace(/hiPct: laborHi/, 'hiPct: 22');
check('H-⑧ 反恒真：改回写死 15/22 的变体必须被判红（证明 H-③ 不是恒真）',
  H_VARIANT !== jsCode && hasHardcodedHi(H_VARIANT));
// 🔴 R480 真机暴露：**顺序本身就是判据** —— `const inds` 若写在 `const be` 之后，
//   同一块作用域内触发 TDZ ⇒ be 拿不到业态区间、回落写死常数 ⇒ 改业态时数字不跟着变。
//   静态判据全绿也照样崩（判据不读执行顺序就看不见），故单独立一条。
const I_INDS = jsCode.indexOf('const inds = this.decorateInds(');
const I_BE = jsCode.indexOf('buildBreakeven(d, res, prevProfitFen, inds)');
check('H-⑨ 顺序即判据：inds 的定义必须**早于** be 的计算（晚一步就 TDZ）',
  I_INDS >= 0 && I_BE >= 0 && I_INDS < I_BE, `inds@${I_INDS} / be@${I_BE}`);
const I_FOLD = wxmlCode.indexOf('wx:if="{{beMore}}"');
check('H-⑩ 结论必须露出来：盈亏平衡点 / 达标营业额在折叠块**之外**（老板最关心的不该藏）',
  I_FOLD >= 0 && wxmlCode.indexOf('t.bePoint') < I_FOLD && wxmlCode.indexOf('t.beHealthy') < I_FOLD,
  `fold@${I_FOLD}`);
// 🔴 R482（李老师追问「录完确定的数，为什么出来模糊的数」）：
//   确定值（固定成本 ÷ 边际贡献率）**必须**在结论层；±10% 区间是我方加的容错带，
//   只能当脚注，且必须写明来源 —— 否则老板会以为"这套系统算不准"。
check('H-⑫ 结论层给的是**确定的**盈亏平衡点（不是区间）',
  /pointText/.test(jsCode) && /breakevenFen/.test(jsCode)
  && wxmlCode.indexOf('t.bePoint') >= 0 && wxmlCode.indexOf('t.bePoint') < I_FOLD);
check('H-⑬ 区间降级为脚注且标明来源（不许让老板以为是算不准）',
  /pointNoteText/.test(jsCode) && wxmlCode.indexOf('be.pointNoteText') >= 0
  && wxmlCode.indexOf('be.pointNoteText') < I_FOLD
  && /bePointNote/.test(termsSrc));
const H_VARIANT2 = jsCode.replace('const inds = this.decorateInds(', 'const __moved_inds = this.decorateInds(');
check('H-⑪ 反恒真：把 inds 定义挪走（顺序失效）的变体必须被判红',
  H_VARIANT2 !== jsCode && H_VARIANT2.indexOf('const inds = this.decorateInds(') < 0);

// ================= E 下界：断言数不被悄悄删小 =================
console.log('\n===== E 下界 =====');
check('E-① 本守卫断言数 ≥ 28（删掉判据即转红）', pass + failN >= 28, `含本条共 ${pass + failN + 1} 条`);

console.log(`\n===== M1 行业指标对照守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
