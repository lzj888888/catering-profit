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

// ===================== D. 断言数下界 =====================
console.log('');
console.log('===== D. 覆盖度 =====');
check('D-① 断言数 ≥ 14', pass + fail >= 14);

console.log('');
console.log('==== R479 M1 差异说明条件化守卫：' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fail) {
  console.log('--- 违规要点 ---');
  console.log('  1) A 段红：文案又变成固定一条了 —— 回落后差异只剩摊销，固定文案会说谎。');
  console.log('  2) B 段红：导出没认出口径来源 —— 页面重算 vs 导出读快照，两边会对不上账。');
  process.exit(1);
}
