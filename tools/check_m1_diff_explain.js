// tools/check_m1_diff_explain.js —— R479 · M1「两口径差异」说明的**条件化**守卫
//
// ===== 为什么立这条 =====
// 老板真机问过「口径差异为什么等于食材成本？」，R477 修掉了根因（库存模式下参考口径
// 恒取 0、完全没扣食材，改回落倒轧）。但**修完引擎，说明文案还在说旧话**：
//
//   terms.js: profitDiffWhy = '= 经营参考估算 − 真实利润；差异来自「库存倒轧与直接填的差」+ 当月摊销'
//   exportData: ['两口径差额', …, '= 消耗差异 + 当月摊销'] 且 gapFen = real − direct
//
// R477 之后，「差异里有没有食材项」取决于**参考口径用了哪份消耗**（refMaterialSource）：
//   · reverse（库存开 + 没填）⇒ 参考已用倒轧 ⇒ 差异**只剩摊销**，没有食材项
//   · direct（库存关，或库存开且填了正数）⇒ 差异 =（真实 − 填的）+ 摊销
// ⇒ 固定文案在第一种情形下**指着"只剩摊销"的差异说"这里有食材差"** —— 那不是说不清，是说谎。
// 外审第二轮正是点名这条：「L1 原文不能直接上，必须按口径版本/模式条件解释实际差异」。
//
// ⚠️ 同族风险在**导出侧更狠**：页面走 getLedger **重算**，导出走**落库快照**不重算
//   （exportData 直读 row.profit_diff_fen）。若导出仍按 real − direct 算"消耗差异"，
//   同一个月会出现「页面说差异只剩摊销、导出说差异里有食材」—— 两边对不上账且都不报错。
//
// ===== 判据 =====
// A. 结果页：文案按 ref_material_source 分支（两条都在，且**值不同**，否则分支是假的）
//    + 中性兜底存在 + 两份 terms.js md5 全等。
// B. 导出侧：refMat 由 refSrc 决定 / gapFen 用 refMat 而非 direct / **旧账兜底**（缺字段 ⇒ 'direct'）
//    + 反向断言（不得再现旧的 `gapFen = real - direct`）。
// C. 反恒真：合成「固定文案版」与「旧 gapFen 版」两个变体，判据**必须判它们红** ——
//    否则本守卫只是两条恒真的存在性检查（同族病：只 grep 词出现 ⇒ 被注释喂成恒真）。
// D. 断言数下界。
// H. R493：`utils/profitLabel.js` 的**摊销三态 / 依据三态**（行为面判据，直接调纯函数）。
//    为什么单立一段：R492 修的正是「摊销开 + 本月 0 + 没盘点」这三种条件同时成立时
//    **少说一句**（老板分不清"摊销表空着"与"没扣"）。当时只改了实现、没有判据 ⇒
//    谁再动 `:125`/`:139` 那两行都不会转红。本段守三件事：
//      ① 摊销三态（关 ⇒ 不说 / 开且有额 ⇒ 报金额 / 开但为 0 ⇒ 明说没有）在**三个分支**
//         （库存关·库存开未盘点·已盘点）上**同一套说法**；
//      ② 依据三态（stocktake / purchase / direct）+ 没有期末数时**绝不**声称按期末倒轧，
//         也不许把 null 当 0 显示成 ¥0.00；
//      ③ 参考口径（ref）**永不说已扣摊销**（那个数本来不含摊销）。
//    🔴 判据跑在**真实现**上（`require` 生产模块 + 合成入参），不扫源码文字 ——
//       源码里的 `amortText:` 出现几次，与它到底在什么入参下说什么，是两件事（R298Y 教训）。
//    🔴 并自带四组反恒真样本：旧二态实现 / 永不说 / 假 stocktake / 真实实现零不通过。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const RESULT_JS = 'subpkg/biz/month/result.js';
const TERMS_A = 'specs/dev-specs/i18n/terms.js';
const TERMS_B = 'miniprogram/i18n/terms.js';
const EXPORT_JS = 'cloudfunctions/exportData/index.js';

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('✅ ' + m); };
const no = (m) => { fail++; console.log('❌ ' + m); };
const check = (m, c) => (c ? ok(m) : no(m));

// ===================== S. 自失效护栏：扫描面非空 =====================
console.log('===== S. 扫描面非退化 =====');
const FOUR = [RESULT_JS, TERMS_A, TERMS_B, EXPORT_JS];
const srcs = {};
for (const f of FOUR) {
  let s = '';
  try { s = R(f); } catch (e) { s = ''; }
  srcs[f] = s;
  check('S ' + f + ' 可读且非空（' + s.length + ' 字符）', s.length > 200);
}
const allRead = FOUR.every((f) => srcs[f].length > 200);

// ===================== A. 结果页：文案条件化 =====================
console.log('');
console.log('===== A. 结果页差异说明按来源分支 =====');

const rj = srcs[RESULT_JS];
check('A-① 结果页真读 ref_material_source（出参单源，不是自己猜）',
  /ref_material_source/.test(rj));
check('A-② 分支两条都在（reverse ⇒ 只剩摊销 / direct ⇒ 含食材差）',
  /profitDiffWhyAmort/.test(rj) && /profitDiffWhyConsume/.test(rj));
check('A-③ 参考口径注释也按来源分流（refNote 不再固定说「按直接填写」）',
  /refNoteReverse/.test(rj) && /refNoteDirect/.test(rj));
check('A-④ 取不到来源时有中性兜底（不点名食材，不硬猜）',
  /_src === 'reverse' \? _tp\.profitDiffWhyAmort[\s\S]{0,200}: _tp\.profitDiffWhy\s*\}/.test(rj)
  || /profitDiffWhyConsume : _tp\.profitDiffWhy/.test(rj));

// 文案值：两条必须**真的不同**（否则分支是形式上的，写两条一样的话等于没条件化）
function termsKey(src, key) {
  const re = new RegExp(key + ":\\s*'([^']*)'");
  const m = re.exec(src);
  return m ? m[1] : null;
}
if (allRead) {
  const ta = srcs[TERMS_A], tb = srcs[TERMS_B];
  const a1 = termsKey(ta, 'profitDiffWhyAmort');
  const a2 = termsKey(ta, 'profitDiffWhyConsume');
  const ab = termsKey(ta, 'profitDiffWhy');
  check('A-⑤ terms 三条文案键都在（Amort / Consume / 兜底）', !!a1 && !!a2 && !!ab);
  check('A-⑥ Amort 与 Consume **值不同**（同值 ⇒ 分支是假的）', !!a1 && !!a2 && a1 !== a2);
  check('A-⑦ Amort 文案不提"倒轧与直接填的差"（回落时根本没有这项）',
    !!a1 && !/倒轧与直接填的差/.test(a1));
  check('A-⑧ 中性兜底文案不点名食材（旧账取不到来源时用）', !!ab && !/食材/.test(ab));
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  check('A-⑨ 两份 terms.js md5 全等（双副本纪律）', md5(ta) === md5(tb));
}

// ===================== B. 导出侧：参考消耗与 gapFen 同源 =====================
console.log('');
console.log('===== B. 导出侧不重算 ⇒ 必须认得出口径来源 =====');

const ex = srcs[EXPORT_JS];
check('B-① 导出真读落库字段 ref_material_source（旧账没有该字段 ⇒ 有兜底）',
  /ref_material_source/.test(ex));
check('B-② refMat 由 refSrc 决定（reverse ⇒ 用倒轧 real；否则用填的 direct）',
  /refSrc === 'reverse' \? real : direct/.test(ex));
check('B-③ gapFen 用 refMat 算（不是旧的 real − direct）',
  /real - refMat/.test(ex));
check('B-④ 反向：不得再现旧写法 `gapFen = real - direct`（那会让等式对不上账）',
  !/gapFen\s*=\s*real\s*-\s*direct/.test(ex));
check('B-⑤ 旧账兜底：缺字段一律回落 direct（不许拿新口径解释旧数字）',
  /ref_material_source === 'reverse' \? 'reverse' : 'direct'/.test(ex));
check('B-⑥ 利润表那行文案随来源变（不再固定写「本月填写」）',
  /refSrc === 'reverse' \? '减：食材消耗（库存倒轧）'/.test(ex));
// 🔴 R490：B-⑥ 只守「减：食材消耗」那一行。同一个 sheet 里还有两处**公式说明**（利润表的
//   「＝ 经营参考利润」单元格、口径说明表「经营参考利润」行）此前无条件写「本月填写消耗」
//   ⇒ 库存模式（refSrc=reverse）下，上一行说「库存倒轧」、下一行说「本月填写」，导出件自相矛盾。
//   这两行是老板复核时的核对依据，必须一起条件化。
//   ⚠️ 判据不用正则（本环境会把反斜杠转成斜杠），改用 indexOf + 就近窗口：既判文案在场，
//   也判它确实挂在 `refSrc === 'reverse'` 分支上（否则一个从来不会被执行到的字符串也能骗过判据）。
const REV_ROW = "'= 收入 − 费用 − 倒轧消耗（期初 + 采购 − 期末） − 一次性投入";
const REV_NOTE = "'= 营业收入 − 费用合计 − 倒轧食材消耗（期初 + 采购 − 期末）";
const iRevRow = ex.indexOf(REV_ROW);
const iRevNote = ex.indexOf(REV_NOTE);
check('B-⑦ 利润表「＝ 经营参考利润」的公式说明随来源变（reverse 分支写倒轧）',
  iRevRow > 0 && ex.slice(Math.max(0, iRevRow - 300), iRevRow).indexOf("refSrc === 'reverse'") >= 0);
check('B-⑧ 口径说明表「经营参考利润」的公式随来源变（不是固定「本月填写」）',
  iRevNote > 0 && ex.slice(Math.max(0, iRevNote - 300), iRevNote).indexOf("refSrc === 'reverse'") >= 0);

// ===================== C. 反恒真：判据必须能分辨 =====================
console.log('');
console.log('===== C. 反恒真（合成变体必须被判红）=====');

// C-① 变体：把结果页分支改成「固定一条文案」⇒ 必须被 A-② 判红
const fixedVariant = rj
  .replace(/profitDiffWhy: _src === 'reverse' \? _tp\.profitDiffWhyAmort\s*:?\s*\(?_src === 'direct' \? _tp\.profitDiffWhyConsume : _tp\.profitDiffWhy\)?/,
    "profitDiffWhy: _tp.profitDiffWhy");
const c1 = /profitDiffWhyAmort/.test(fixedVariant) && /profitDiffWhyConsume/.test(fixedVariant);
check('C-① 变体「固定文案版」必须被判红（证明 A-② 不是恒真）',
  fixedVariant !== rj && !c1);

// C-② 变体：导出改回旧写法 gapFen = real - direct ⇒ 必须被 B-③/B-④ 判红
const oldExport = ex.replace(/const gapFen = real - refMat;/, 'const gapFen = real - direct;');
check('C-② 变体「旧 gapFen 版」必须被判红（证明 B-③/B-④ 不是恒真）',
  oldExport !== ex && /gapFen\s*=\s*real\s*-\s*direct/.test(oldExport)
  && !/real - refMat/.test(oldExport));

// C-④ 变体：两处公式说明改回固定「本月填写」⇒ 必须被 B-⑦/B-⑧ 判红（证明它们不是恒真）
const fixedFormula = ex.split(REV_ROW).join("'= 收入 − 费用 − 本月填写消耗 − 一次性投入")
  .split(REV_NOTE).join("'= 营业收入 − 费用合计 − 本月填写食材消耗 − 一次性投入");
check('C-④ 变体「公式说明退回固定版」必须被判红（证明 B-⑦/B-⑧ 不是恒真）',
  fixedFormula !== ex
  && fixedFormula.indexOf(REV_ROW) < 0 && fixedFormula.indexOf(REV_NOTE) < 0
  && ex.indexOf(REV_ROW) >= 0 && ex.indexOf(REV_NOTE) >= 0);

// C-③ 变体：两条文案写成一样 ⇒ 必须被 A-⑥ 判红
if (allRead) {
  const sameValue = srcs[TERMS_A].replace(
    /profitDiffWhyConsume:\s*'[^']*'/,
    "profitDiffWhyConsume: '" + (termsKey(srcs[TERMS_A], 'profitDiffWhyAmort') || '') + "'"
  );
  const v1 = termsKey(sameValue, 'profitDiffWhyAmort');
  const v2 = termsKey(sameValue, 'profitDiffWhyConsume');
  check('C-③ 变体「两条文案同值」必须被判红（证明 A-⑥ 不是恒真）',
    sameValue !== srcs[TERMS_A] && v1 === v2 && !!v1);
}

// ===================== G. R484：一个月只出一个数 =====================
console.log('');
console.log('===== G. R484：同页不再并列两个利润、不再有"两口径差异" =====');
// 为什么单立这一段：R484 定案后，结果页**必须**只出一个利润。若有人把旧的
// 「经营参考利润」卡或「差异」行加回去，老板又会回到"两个数不知信哪个"的状态。
// ⚠️ 本段临时引入 wxml 面（本文件原本只扫 .js 与 terms）
const wxmlSrc = R('subpkg/biz/month/result.wxml');
check('G-① 结果页**不再**并列展示经营参考利润（旧 refProfit 卡已删）',
  wxmlSrc.indexOf('r.refProfit') < 0);
check('G-② 结果页**不再**展示"两口径差异"那一行（同月一个消耗数 ⇒ 无差异）',
  wxmlSrc.indexOf('r.profitDiff') < 0 && wxmlSrc.indexOf('t.profitDiffWhy') < 0);
check('G-③ 唯一利润 = 会计利润（total_factor_real_profit_fen）',
  /trueProfit: fen\(res\.total_factor_real_profit_fen\)/.test(rj));
check('G-④ 没盘点时给提示（李老师：只给不盘点、填了采购入库额的人做个提示）',
  /noStockTakeTip/.test(rj) && wxmlSrc.indexOf('r.noStockTakeTip') >= 0
  && /noStockTakeTip/.test(srcs[TERMS_A]));
// 反恒真：把差异行加回去必须被判红
const G_VARIANT = wxmlSrc + '\n<view class="cell"><text class="lbl">{{t.profitDiff}}</text><text class="val">{{t.cur}}{{r.profitDiff}}</text></view>';
check('G-⑤ 反恒真：把"差异行"加回去的变体必须被判红（证明 G-② 不是恒真）',
  G_VARIANT !== wxmlSrc && G_VARIANT.indexOf('r.profitDiff') >= 0);
// 🔴 R485（李老师：这个板块就是算利润的，**"利润"二字不能丢**）：
//   只出一个数之后，若标题变成"本月盈亏/经营结果"之类，老板会以为这块不讲利润了。
//   ⇒ 守死：盘点⇒「本月利润」、不盘点⇒「估算利润」，两个标题**都必须带"利润"**。
const T_TERMS = srcs[TERMS_A];
const titleKeys = (() => {
  const g = (k) => { const m = new RegExp(k + ":\\s*'([^']*)'").exec(T_TERMS); return m ? m[1] : null; };
  return { stock: g('trueProfit'), estimate: g('profitEstimate') };
})();
check('G-⑥ 两个模式标题都带"利润"二字（盘点=本月利润 / 不盘点=估算利润）',
  !!titleKeys.stock && titleKeys.stock.indexOf('利润') >= 0
  && !!titleKeys.estimate && titleKeys.estimate.indexOf('利润') >= 0,
  JSON.stringify(titleKeys));
// 🔴 R488：标题/副标题的判断搬到了 utils/profitLabel.js（**单一来源**，首页/月首页/结果页共用）
//   ⇒ 锚点跟着搬家，但守的语义没变：①两个分支的文案都必须在；②必须真的赋给 note:（不是只出现在注释里）；
//   ③页面必须真上屏 r.profitTitle。若有人把某一种说法删掉，本条照样红。
const labelRel = 'utils/profitLabel.js';
const labelSrc = fs.existsSync(path.join(ROOT, labelRel)) ? R(labelRel) : '';
check('G-⑦ 页面真按模式选标题（r.profitTitle 上屏；两种说法在单一来源 utils/profitLabel.js 里真赋值）',
  /profitTitle:/.test(rj) && wxmlSrc.indexOf('r.profitTitle') >= 0
  && /note:\s*[^\n]*RP\.profitNoteStock\b/.test(labelSrc)
  && /note:\s*[^\n]*RP\.profitNotePurchase\b/.test(labelSrc));

// ===================== H. R493：摊销 / 依据 三态（行为面） =====================
console.log('');
console.log('===== H. R493：profitLabel 三态（真调纯函数，不扫文字）=====');

// 为什么要 require 生产模块而不是重写一份逻辑：重写会"测到我自己写的影子实现"，
// 实现被改成别的样子时判据照样绿（同族病：判据与被测对象分叉）。
let labelMod = null;
try { labelMod = require(path.join(ROOT, 'utils/profitLabel.js')); } catch (e) { labelMod = null; }
const haveLabel = !!labelMod && typeof labelMod.pickProfitLabel === 'function';
check('H-⓪a utils/profitLabel.js 可 require 且导出 pickProfitLabel（判据跑在真实现上）', haveLabel);

// 期望文案取自 terms 单源：判据不许自己写死'本月没有摊销'这类字面量，
// 否则改文案就成了"改判据"（#54 的教训）。
let TP = null;
try { TP = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.resultPage; } catch (e) { TP = null; }
const AMT_YUAN = '1234.00';
const AMT_FEN = 123400;
const CLOSING_FEN = 500000;
const AMT_TEXT = (TP && typeof TP.amortLine === 'function') ? TP.amortLine(AMT_YUAN) : '';
const NONE_TEXT = (TP && typeof TP.amortNone === 'string') ? TP.amortNone : '';
// 这两条文案是全部期望值的来源 ⇒ 缺了本段所有断言都会退化成"空字符串等于空字符串"（恒真）
check('H-⓪b 期望文案可用且可区分（amortLine 带金额 / amortNone 非空且与之不同）',
  !!AMT_TEXT && AMT_TEXT.indexOf(AMT_YUAN) >= 0 && !!NONE_TEXT && AMT_TEXT !== NONE_TEXT);

/** 合成 getLedger 出参。只造本判据读到的字段（switches / inventory.closing_fen / result.*） */
function mkLedger(o) {
  const led = {
    switches: { inventorySwitchOn: !!o.invOn, amortizeSwitchOn: !!o.amortOn },
    inventory: {},
    result: { effective_amortize_fen: o.fen == null ? 0 : o.fen },
    effective_lump_sum_fen: 0,
  };
  if (o.hasClosing) led.inventory.closing_fen = o.closing;
  if (o.refSrc) led.result.ref_material_source = o.refSrc;
  return led;
}
function pick(led, caliber) {
  if (!haveLabel) return null;
  try { return labelMod.pickProfitLabel(led, caliber); } catch (e) { return null; }
}
// 三个分支 = 老板真实会遇到的三类月（库存关 / 库存开但没盘点 / 真盘点过）。
// 三态必须在这三个分支上说法一致 —— R492 的缺口正是"只在其中两个分支说了"。
const BRANCH = {
  direct: (st) => mkLedger({ invOn: false, amortOn: st.on, fen: st.fen }),
  purchase: (st) => mkLedger({ invOn: true, hasClosing: true, closing: 0, amortOn: st.on, fen: st.fen }),
  stocktake: (st) => mkLedger({ invOn: true, hasClosing: true, closing: CLOSING_FEN, amortOn: st.on, fen: st.fen }),
};
function amortOf(st, b) { const r = pick(BRANCH[b](st), 'real'); return r ? r.amortText : '__NO_LABEL__'; }

// —— 三态之一：摊销关 ⇒ 一个字都不提（副标题已经说明"未计摊销"，再说一遍是噪音）——
//   注意入参故意给 fen=AMT_FEN：开关关掉时金额不该冒出来（证明判据看开关、不看金额）。
for (const b of ['direct', 'purchase', 'stocktake']) {
  check('H-① 摊销关 · ' + b + ' 分支 ⇒ 不提摊销（开关优先于金额）',
    amortOf({ on: false, fen: AMT_FEN }, b) === '');
}
// —— 三态之二：开关开且真扣了 ⇒ 报金额（三个分支都要报，不能只在盘点时报）——
for (const b of ['direct', 'purchase', 'stocktake']) {
  check('H-② 摊销开 + 有额 · ' + b + ' 分支 ⇒ 报金额 ' + AMT_YUAN,
    amortOf({ on: true, fen: AMT_FEN }, b) === AMT_TEXT);
}
// —— 三态之三：开关开但本月为 0 ⇒ 明说「没有」——
//   🔴 这条就是 R492 修的那一句：旧实现只在"扣了"时说，于是在"没盘点"分支上
//   同一个开关组合**少一句话**，老板分不清"摊销表空着"与"没扣"。
for (const b of ['direct', 'purchase', 'stocktake']) {
  check('H-③ 摊销开 + 本月 0 · ' + b + ' 分支 ⇒ 明说「' + NONE_TEXT + '」',
    amortOf({ on: true, fen: 0 }, b) === NONE_TEXT);
}

// —— 依据三态：basis 必须与「这个数是怎么来的」一致 ——
const rStock = pick(BRANCH.stocktake({ on: true, fen: AMT_FEN }), 'real');
check('H-④ 已盘点 ⇒ basis=stocktake 且 closingFen 原样带出（分，不做显示换算）',
  !!rStock && rStock.basis === 'stocktake' && rStock.closingFen === CLOSING_FEN);
const rPurch = pick(BRANCH.purchase({ on: true, fen: AMT_FEN }), 'real');
check('H-⑤ 库存开但没盘点 ⇒ basis=purchase 且 closingFen=null（不许当 ¥0.00）',
  !!rPurch && rPurch.basis === 'purchase' && rPurch.closingFen === null);
const rDirect = pick(BRANCH.direct({ on: true, fen: AMT_FEN }), 'real');
check('H-⑥ 库存关 ⇒ basis=direct 且 closingFen=null',
  !!rDirect && rDirect.basis === 'direct' && rDirect.closingFen === null);

// H-⑦ = 集合面判据（比逐条更狠）：凡 closingFen 为 null，一律不得声称 stocktake。
//   否则界面会出现「按期末库存倒轧」却没有那个数的自相矛盾（R489 立 `basis`/`closingFen`
//   本来就是为了把输入摆出来让老板自查，摆不出来还说按它算 = 白摆）。
const NO_CLOSING_SAMPLES = [
  mkLedger({ invOn: true, hasClosing: true, closing: 0, amortOn: true, fen: AMT_FEN }),
  mkLedger({ invOn: true, amortOn: true, fen: AMT_FEN }),          // 字段整条缺失
  mkLedger({ invOn: true, hasClosing: true, closing: null, amortOn: false }),
  mkLedger({ invOn: false, amortOn: true, fen: AMT_FEN }),
];
function judgeBasis(getLabel) {
  // 返回"不通过"的样本数：closingFen 必须为 null 且 basis 不得是 stocktake
  return NO_CLOSING_SAMPLES.filter((l) => {
    const r = getLabel(l);
    return !r || r.closingFen != null || r.basis === 'stocktake';
  }).length;
}
check('H-⑦ 会计口径：closingFen 为 null ⇒ 绝不声称按期末倒轧（4 组样本全过）',
  judgeBasis((l) => pick(l, 'real')) === 0);

// —— 参考口径（免费档月首页那个数）：本来就不含摊销 ⇒ 三态一律「不说」——
const rRefRev = pick(mkLedger({ invOn: true, hasClosing: true, closing: CLOSING_FEN, amortOn: true, fen: AMT_FEN, refSrc: 'reverse' }), 'ref');
check('H-⑧ ref + reverse ⇒ 不提摊销，且 basis=stocktake / closingFen 带出',
  !!rRefRev && rRefRev.amortText === '' && rRefRev.basis === 'stocktake' && rRefRev.closingFen === CLOSING_FEN);
const rRefDir = pick(mkLedger({ invOn: true, hasClosing: true, closing: CLOSING_FEN, amortOn: true, fen: AMT_FEN, refSrc: 'direct' }), 'ref');
check('H-⑨ ref + direct ⇒ 不提摊销，basis=direct / closingFen=null',
  !!rRefDir && rRefDir.amortText === '' && rRefDir.basis === 'direct' && rRefDir.closingFen === null);

// —— 反恒真：判据本身必须有分辨力（否则上面 9 条只是"存在性检查"的另一种写法）——
function judgeThreeStates(amortFn) {
  const S = [
    { on: false, fen: AMT_FEN, exp: '' },
    { on: true, fen: AMT_FEN, exp: AMT_TEXT },
    { on: true, fen: 0, exp: NONE_TEXT },
  ];
  return S.filter((st) => amortFn(st.on, st.fen) !== st.exp).length;
}
check('H-⑩ 真实现在三态判据上零不通过（判据对真实现成立，不是恒红）',
  judgeThreeStates((on, fen) => amortOf({ on, fen }, 'direct')) === 0);
check('H-⑪ 反恒真：旧二态实现（开且 0 不说）必须被判红 ⇒ 证明 H-③ 有分辨力',
  judgeThreeStates((on, fen) => (!on ? '' : (fen > 0 ? AMT_TEXT : ''))) === 1);
check('H-⑫ 反恒真：永不说摊销的实现必须被判红 ⇒ 证明 H-② 不是恒真',
  judgeThreeStates(() => '') === 2);
check('H-⑬ 反恒真：声称 stocktake 却无 closingFen 的假实现必须逐条判红 ⇒ 证明 H-⑦ 不是恒真',
  judgeBasis(() => ({ basis: 'stocktake', closingFen: null })) === NO_CLOSING_SAMPLES.length);

// ===================== I. R493：真实盘点落库链路（stock_take_done 五跳透传） =====================
console.log('');
console.log('===== I. R493：真实盘点落库链路（前端→validate→saveLedger→getLedger→标签）=====');
// 为什么立这段：库存页「本月已盘点」勾选要真正落到 shop_monthly_account.stock_take_done，
// 否则 profitLabel.hasStockTake 永远读不到勾选、清仓月（期末=0）会恒按"没盘点"算（标签回落估算利润）。
// 链路有五处，任何一处断了都是**静默**失效（页面不报错、只是标签错）：
//  ① 前端 inventory.js 必须把勾选 emit 成 stock_take_done（=== true，防偷偷传 truthy 非布尔）
//  ② validate.js 不能把该字段剥掉（它只白名单拷贝 inventory 三键）—— 必须显式透传
//  ③ saveLedger/index.js 必须写 doc.stock_take_done
//  ④ getLedger/index.js 必须把该字段回传给客户端
//  ⑤ profitLabel.hasStockTake 必须真读 ledger.stock_take_done（否则链路断了也没人发现）
const INV_JS_I = 'subpkg/biz/month/inventory.js';
const VALIDATE_JS_I = 'cloudfunctions/saveLedger/validate.js';
const SAVE_JS_I = 'cloudfunctions/saveLedger/index.js';
const GET_JS_I = 'cloudfunctions/getLedger/index.js';
const LABEL_JS_I = 'utils/profitLabel.js';
const invSrcI = fs.existsSync(path.join(ROOT, INV_JS_I)) ? R(INV_JS_I) : '';
const valSrcI = fs.existsSync(path.join(ROOT, VALIDATE_JS_I)) ? R(VALIDATE_JS_I) : '';
const saveSrcI = fs.existsSync(path.join(ROOT, SAVE_JS_I)) ? R(SAVE_JS_I) : '';
const getSrcI = fs.existsSync(path.join(ROOT, GET_JS_I)) ? R(GET_JS_I) : '';
const labelSrcI = fs.existsSync(path.join(ROOT, LABEL_JS_I)) ? R(LABEL_JS_I) : '';
check('I-① 前端 inventory.js 保存时 emit stock_take_done（=== true，非仅 truthy）',
  /stock_take_done:\s*this\.data\.stockTakeDone\s*===\s*true/.test(invSrcI),
  'inventory.js 没把勾选 emit 成 stock_take_done === true');
check('I-② saveLedger/validate.js 透传 stock_take_done（=== true → stockTakeDone，不被白名单剥掉）',
  /stockTakeDone:\s*src\.stock_take_done\s*===\s*true/.test(valSrcI),
  'validate.js 没透传 stock_take_done（会被白名单剥掉，落库拿不到）');
check('I-③ saveLedger/index.js 落库 doc.stock_take_done = v.stockTakeDone',
  /doc\.stock_take_done\s*=\s*v\.stockTakeDone/.test(saveSrcI),
  'saveLedger/index.js 没把 stock_take_done 落库');
check('I-④ getLedger/index.js 回传 stock_take_done 给客户端（!! 防 undefined 误判 false）',
  /stock_take_done:\s*!!\(acct\s*&&\s*acct\.stock_take_done\)/.test(getSrcI),
  'getLedger/index.js 没把 stock_take_done 回传给客户端');
const hasStockTakeReads = /function\s+hasStockTake[\s\S]{0,2000}?ledger\.stock_take_done/.test(labelSrcI);
check('I-⑤ profitLabel.hasStockTake 真读 ledger.stock_take_done（闭环标签逻辑）',
  hasStockTakeReads,
  'profitLabel.hasStockTake 没读 ledger.stock_take_done ⇒ 勾选落库了标签也用不上');
// 反恒真：合成一份"前端 emit 了、但后端三处全漏 + 标签不读"的断链变体，判据必须不全绿
const BROKEN = {
  inv: 'stock_take_done: this.data.stockTakeDone === true',
  val: 'shop_id: src.shop_id',        // 没透传 stockTakeDone
  save: 'doc.lump_sum_fen = 1',       // 没写 doc.stock_take_done
  get: 'inventory: inventoryOut',     // 没回传 stock_take_done
  label: 'function hasStockTake(l){ return false; }', // 没读 stock_take_done
};
const brokenAllPass =
  /stock_take_done:\s*this\.data\.stockTakeDone\s*===\s*true/.test(BROKEN.inv) &&
  /stockTakeDone:\s*src\.stock_take_done\s*===\s*true/.test(BROKEN.val) &&
  /doc\.stock_take_done\s*=\s*v\.stockTakeDone/.test(BROKEN.save) &&
  /stock_take_done:\s*!!\(acct\s*&&\s*acct\.stock_take_done\)/.test(BROKEN.get) &&
  /function\s+hasStockTake[\s\S]{0,400}?stock_take_done/.test(BROKEN.label);
check('I-⑥ 反恒真：后端三处任一漏传都必须判红（合成断链变体 ⇒ 不全绿）',
  brokenAllPass === false,
  '合成断链变体竟然全绿 ⇒ 上面的判据是恒真（被注释/字面量喂成真）');

// ===================== D. 断言数下界 =====================
console.log('');
console.log('===== D. 覆盖度 =====');
// 下界抬到 50：R493 加了 H 组 21 条，若有人整段删掉 H，`>= 14` 这种旧下界根本不痛不痒。
// 下界的作用是"整段被删要转红"，所以它必须贴着当前断言数（54）留一点余量。
check('D-① 断言数 ≥ 50', pass + fail >= 50);

console.log('');
console.log('==== R479 M1 差异说明条件化守卫：' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fail) {
  console.log('--- 违规要点 ---');
  console.log('  1) A 段红：文案又变成固定一条了 —— 回落后差异只剩摊销，固定文案会说谎。');
  console.log('  2) B 段红：导出没认出口径来源 —— 页面重算 vs 导出读快照，两边会对不上账。');
  process.exit(1);
}
