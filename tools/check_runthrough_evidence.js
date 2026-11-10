// tools/check_runthrough_evidence.js —— 跑通证据守卫（R686 · 队列 #121 的 B2）
// 运行：node tools/check_runthrough_evidence.js   （EXIT 0 = 全绿）
//
// 为什么要有这一条：
//   `CHECKLIST_跑通最小闭环_R611.md` 的判据是「含至少一个可复算的数字」。
//   但**判据靠人抄、结论靠我点头** —— 只要我在回填文件里写下「利润 9000」，
//   这套流程就永远绿，哪怕引擎早就算出别的数。本仓已经栽过同族的坑：
//   · R92「索引已建 ≠ 生效」· round53「判据存在 ≠ 被自动执行」· R298Y「读到了 ≠ 送出去了」
//   本守卫补的是同一族的第四环：**判据被抄写了 ≠ 判据被校验了**。
//
// 判据（A 结构面 + B 数值面 + C 变异自证）：
//   A-① 回填文件存在（`review/evidence/r611_runthrough/回填_*.md`），且至少 1 份
//   A-② 回填表 1~8 行齐全，每行判定列必须是 ✅/❌/⚪ 之一（留空 = 静默算过，判红）
//   A-③ 结论段必须显式写「7 ✅ / 1 ⚪ / 0 ❌」这类统计，或写明逐项统计（防含混过关）
//   B-① **数值对账**：从源码现算 30000/10000/5000/6000 的利润与三项刚性，
//        与回填文件里**抄下来的数字**逐项比对；不一致 ⇒ 红（这是本守卫的核心）
//   B-② 第 4/5 条判 ✅ 时，必须存在「独立重算」章节 + 脚本路径，且脚本文件真实存在
//   C-① 变异：把回填里的利润改成 9001 ⇒ 必须判红（证明对账有分辨力）
//   C-② 变异：把某行判定列清空 ⇒ 必须判红（证明空判定不算过）
//
// ⚠️ 本守卫**不连数据库、不跑云函数**，只 require 纯计算模块
//    （`calcMonthlyProfit/service.js` / `common/indicatorRef.js`）—— 与生产同源同一份文件。
// ⚠️ 数值一律从**源码现算**，绝不在本文件里写死 9000 / 70.0（写死就等于抄了一份，还是自述）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EVID_DIR = path.join(ROOT, 'review/evidence/r611_runthrough');
const RECALC_REL = 'review/evidence/r611_runthrough/recalc_30000_10000_5000_6000.js';

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

// ===== 1. 从生产源码现算（唯一真值来源）=====
function computeTruth() {
  const { calcMonthlyProfit } = require(path.join(ROOT, 'cloudfunctions/calcMonthlyProfit/service.js'));
  const indicatorRef = require(path.join(ROOT, 'cloudfunctions/common/indicatorRef.js'));
  const Y = (yuan) => yuan * 100;
  const r = calcMonthlyProfit({
    incomeItems: [{ amountFen: Y(30000) }],
    expenseItems: [{ amountFen: Y(5000) }, { amountFen: Y(6000) }],
    directConsumeFen: Y(10000),
    amortizeFen: 0, amortizeSwitchOn: false, lumpSumFen: 0,
    inventorySwitchOn: false,
    inventory: { openingFen: 0, purchaseFen: 0, closingFen: 0 },
    pendingSettlementFen: 0,
  });
  const indicators = indicatorRef.m1IndicatorsOf(indicatorRef.evaluateIndicators({
    bizKey: 'dining', cityKey: 't2',
    revenueFen: r.incomeTotalFen,
    fixedFen: indicatorRef.toFixedFen({ rent: Y(5000), labor: Y(6000) }),
    grossMarginPct: r.incomeTotalFen > 0 ? r.grossMarginRatePctDisplay : null,
    platformPct: null,
  }));
  const byKey = {};
  indicators.forEach((x) => { byKey[x.key] = x; });
  const threeCost = indicatorRef.threeCostOf('dining', {
    grossMarginPct: byKey.grossMargin ? byKey.grossMargin.pct : null,
    rentPct: byKey.rent ? byKey.rent.pct : null,
    laborPct: byKey.labor ? byKey.labor.pct : null,
  });
  return {
    profitYuan: r.operationRefProfitFen / 100,
    realProfitYuan: r.totalFactorRealProfitFen / 100,
    grossMarginPct: r.grossMarginRatePctDisplay,
    threeCostPct: threeCost.pct,
  };
}

// ===== 2. 核心判据：把回填文本与真值对账（纯函数，便于变异）=====
/**
 * @param {string} md 回填文件全文
 * @param {object} truth computeTruth() 的产物
 * @returns {string[]} 失败列表（空 = 通过）
 */
function judge(md, truth) {
  const errs = [];
  const txt = String(md || '');

  // A-② 8 行齐全 + 判定列有效
  for (let i = 1; i <= 8; i++) {
    const re = new RegExp('^\\|\\s*' + i + '\\s*\\|([^\\n]*)$', 'm');
    const m = txt.match(re);
    if (!m) { errs.push('A-② 回填表缺第 ' + i + ' 行'); continue; }
    const cols = m[1].split('|');
    // 结构：| 序号 | 口述 | 判定 | 备注 | ⇒ m[1] 已去掉序号列 ⇒ cols = [口述, 判定, 备注, '']
    const verdict = (cols[1] || '').trim();
    if (!/[✅❌⚪]/.test(verdict)) errs.push('A-② 第 ' + i + ' 行判定列为空或无效（"' + verdict + '"）⇒ 留空等于静默算过');
  }

  // B-① 数值对账 —— 只在第 4/5 条判 ✅ 时要求（未测就该是 ⚪/❌，不许既没测又抄数）
  const row = (i) => {
    const m = txt.match(new RegExp('^\\|\\s*' + i + '\\s*\\|([^\\n]*)$', 'm'));
    return m ? m[1] : '';
  };
  const row4 = row(4), row5 = row(5);
  const pass4 = /✅/.test((row4.split('|')[1] || ''));
  const pass5 = /✅/.test((row5.split('|')[1] || ''));

  if (pass4) {
    // 从第 4 行抄回的数字里取「利润 X」
    const mProfit = row4.match(/利润\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!mProfit) errs.push('B-① 第 4 条判 ✅ 但行内没有「利润 <数字>」⇒ 无数字即无效通过');
    else {
      const claimed = Number(mProfit[1]);
      if (Math.abs(claimed - truth.profitYuan) > 1) {
        errs.push('B-① 第 4 条抄的利润 ' + claimed + ' 元 ≠ 源码现算 ' + truth.profitYuan
          + ' 元（容差 1 元）⇒ 回填数字与引擎不符');
      }
    }
  }
  if (pass5) {
    const mPct = row5.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
    if (!mPct) errs.push('B-① 第 5 条判 ✅ 但行内没有百分比 ⇒ 无数字即无效通过');
    else {
      const claimed = Number(mPct[1]);
      if (Math.abs(claimed - truth.threeCostPct) > 0.1) {
        errs.push('B-① 第 5 条抄的三项刚性 ' + claimed + '% ≠ 源码现算 ' + truth.threeCostPct
          + '%（容差 0.1）⇒ 回填数字与引擎不符');
      }
    }
  }

  // B-② 判 ✅ 的数字行必须指向「独立重算」，且脚本真实存在
  if (pass4 || pass5) {
    if (!/独立重算/.test(txt)) errs.push('B-② 判了 ✅ 却没有「独立重算」章节 ⇒ 等于只有自述');
    if (txt.indexOf('recalc_30000_10000_5000_6000.js') < 0) {
      errs.push('B-② 未指明重算脚本 recalc_30000_10000_5000_6000.js');
    }
  }

  // A-③ 结论段要有可核的统计（防「已通过」这种含混结论）
  if (!/[0-9]+\s*✅[^\n]*[0-9]+\s*⚪[^\n]*[0-9]+\s*❌/.test(txt)
    && !/7\s*✅\s*\/\s*1\s*⚪\s*\/\s*0\s*❌/.test(txt)) {
    errs.push('A-③ 缺「N ✅ / N ⚪ / N ❌」统计行 ⇒ 结论含混，无法核');
  }
  return errs;
}

// ===== 3. A-① 找文件 =====
section('A 结构面');
let files = [];
try {
  files = fs.readdirSync(EVID_DIR).filter((n) => /^回填_.*\.md$/.test(n));
} catch (e) { /* 目录不存在 */ }
if (files.length === 0) no('A-①', 'review/evidence/r611_runthrough/ 下没有 回填_*.md ⇒ 跑通无证据');
else ok('A-①', '回填文件 ' + files.length + ' 份：' + files.join(', '));

// ===== 4. 真值 + 逐份对账 =====
const truth = computeTruth();
section('B 数值对账（真值来自源码现算，非写死）');
console.log('  源码现算：利润 ' + truth.profitYuan + ' 元（真实口径 ' + truth.realProfitYuan
  + ' 元）· 毛利率 ' + truth.grossMarginPct + '% · 三项刚性 ' + truth.threeCostPct + '%');

let totalErrs = [];
for (const f of files) {
  const md = fs.readFileSync(path.join(EVID_DIR, f), 'utf8');
  const errs = judge(md, truth);
  if (errs.length === 0) ok('B-' + f, '结构 + 数字全部对得上');
  else { no('B-' + f, errs.length + ' 处不合格'); errs.forEach((e) => console.log('       · ' + e)); totalErrs = totalErrs.concat(errs); }
}

// 重算脚本必须在场（否则 B-② 指向空气）
if (fs.existsSync(path.join(ROOT, RECALC_REL))) ok('B-脚本', RECALC_REL + ' 在场');
else no('B-脚本', '重算脚本缺失：' + RECALC_REL + ' ⇒ 「独立重算」无法复现');

// ===== 5. 变异自证 =====
section('C 变异自证（对账有分辨力吗）');
const base = files.length ? fs.readFileSync(path.join(EVID_DIR, files[0]), 'utf8') : '';

// C-① 把第 4 行抄下来的利润改坏 → 必须被抓
//   ⚠️ 变异值要**超出 1 元容差**（改成 9001 仅差 1 元，按清单容差本就该放行，
//      拿它做变异体会得到"判据无效"的错误结论 —— 首版就踩了这个假红）。
const mutatedProfit = base.replace(/^(\|\s*4\s*\|[^\n]*?利润\s*)([0-9]+(?:\.[0-9]+)?)/m,
  (s0, p1) => p1 + '9100');
const hit1 = judge(mutatedProfit, truth).some((e) => /B-① 第 4 条抄的利润/.test(e));
if (hit1) ok('C-①', '变异体「第 4 行利润 9100」被抓到 ⇒ 对账不是恒真');
else no('C-①', '变异体未被抓到 ⇒ 判据恒真，本守卫无效（回填写什么都会绿）');

// C-② 把第 4 行判定列清空 → 必须被抓
const mutatedBlank = base.replace(/^(\|\s*4\s*\|[^|]*\|)\s*[^|]*\|/m, '$1 |');
const hit2 = judge(mutatedBlank, truth).length > 0;
if (hit2) ok('C-②', '变异体「第 4 行判定留空」被抓到 ⇒ 留空不算过');
else no('C-②', '判定留空也被放行 ⇒ 「静默算过」这条堵不住');

// C-③ 三项刚性改掉 → 必须被抓（第 5 条独立于第 4 条，别只守一条）
const mutatedPct = base.replace(/(\|\s*5\s*\|[^\n]*?)([0-9]+(?:\.[0-9]+)?)\s*%/, (s0, p1) => p1 + '55.5%');
const hit3 = judge(mutatedPct, truth).some((e) => /B-① 第 5 条/.test(e));
if (hit3) ok('C-③', '变异体「三项刚性 55.5%」被抓到 ⇒ 两条数字各自独立受判');
else no('C-③', '第 5 条变异未被抓到 ⇒ 只守了利润一条');

console.log('\n==== 跑通证据守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (totalErrs.length) console.log('（对账失败共 ' + totalErrs.length + ' 处，见上）');
process.exit(fail === 0 ? 0 : 1);
