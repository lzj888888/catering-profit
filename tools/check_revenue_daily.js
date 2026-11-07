// 营收日报表解析守卫（R615 · 队列 #141）
//
// 守的是什么事故：老板这张《营收日报表》是手记的 18 列表，「营业收入」这一列不是随便加的。
//   我从 24 个班次穷举 4096 种列组合，反推出唯一零误差解：
//       营业收入 = 现金 + 充值 + 扫码 + 挂账还款
//   这是「收付实现制」（充值即收入、会员消费不算、收回旧账算）。
//   🔴 危险点：如果哪天老板改了记账方式而我们照旧公式硬套，**利润会静默错掉**。
//   所以本守卫既验「现在算得对」，也验「口径一变必须报警」。
//
// 零依赖：真文件已转成 rows JSON（review/evidence/r615_revenue/revenue_v5_rows.json，
//   由 bufferToMatrix 真实输出 dump 而来），守卫直接读，不需要 xlsx 库。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const R = require(path.join(ROOT, 'utils/revenueDailyParse.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'utils/revenueDailyParse.js'), 'utf8');
const FIX = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'review/evidence/r615_revenue/revenue_v5_rows.json'), 'utf8'));

let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
const rows = FIX.rows;

// ===================== A 表型识别 =====================
console.log('\n=== A 组 表型识别 ===');
const det = R.detectRevenueDaily(rows);
ok('A-① 真营收日报表识别命中（headerRow=1，不是标题行）',
  det.hit && det.headerRow === 1, 'headerRow=' + det.headerRow);
ok('A-② 16 个业务列全部映射到位（含两个文本型挂账列）',
  Object.keys(det.cols).length === 16
  && det.cols.ledgerNew === 12 && det.cols.ledgerRepay === 13 && det.cols.revenueDeclared === 14,
  Object.keys(det.cols).length + ' 列');
ok('A-③ 别的表不误判（只有「日期/班次/现金」三列不齐就不认）',
  !R.detectRevenueDaily([['菜品名称', '销售数量', '销售额']]).hit
  && !R.detectRevenueDaily([]).hit
  && !R.detectRevenueDaily([['日期', '现金']]).hit);
ok('A-④ 列名顺序变了也认（按表头名匹配，不按下标硬编码）', (() => {
  const sw = rows.map((r) => { const c = r.slice(); const t = c[2]; c[2] = c[3]; c[3] = t; return c; });
  const d2 = R.detectRevenueDaily(sw);
  return d2.hit && d2.cols.cash === 3 && d2.cols.recharge === 2;
})());

// ===================== B 解析正确性 =====================
console.log('\n=== B 组 解析正确性（真 9 月数据）===');
const out = R.parseRevenueDaily(rows);
ok('B-① 24 个业务班次 / 13 天（另 2 行只填了「合计」，不算班次）', out.shifts.length === 24 && out.days.length === 13,
  out.shifts.length + ' 班次 / ' + out.days.length + ' 天');
ok('B-② 口径自检通过：24 行全部零误差',
  out.caliber.pass === true && out.caliber.checkedShifts === 24 && out.caliber.mismatches.length === 0,
  'pass=' + out.caliber.pass + ' checked=' + out.caliber.checkedShifts);
ok('B-③ 营业收入合计 59,700.80 元 = 5,970,080 分',
  out.totalsYuan.revenueDeclared === 59700.8 && out.totalsFen.revenueDeclared === 5970080,
  out.totalsYuan.revenueDeclared + ' 元 / ' + out.totalsFen.revenueDeclared + ' 分');
ok('B-④ 公式算出来的与表记完全相等（不是靠容差糊过去）',
  out.totalsYuan.revenueComputed === out.totalsYuan.revenueDeclared);
ok('B-⑤ 五个渠道合计对上（团购 2506/753.4，外卖 232.19/385.84/2078.35）',
  out.channelYuan.grouponMeituan === 2506 && out.channelYuan.grouponDouyin === 753.4
  && out.channelYuan.waimaiMeituan === 232.19 && out.channelYuan.waimaiJd === 385.84
  && out.channelYuan.waimaiTaobao === 2078.35,
  JSON.stringify(out.channelYuan));
ok('B-⑥ 茶楼 550 元单独留作未归类，不算进营业收入（不猜它是什么）',
  out.unclassified.teahouseYuan === 550
  && out.totalsYuan.revenueDeclared === 59700.8
  && out.caliber.formula.indexOf('茶楼') < 0,
  '茶楼=' + out.unclassified.teahouseYuan);
ok('B-⑦ 挂账文本能解析：「岳60」→60、「岳60/李30」→90、空→0、数字原样',
  R.parseLedgerText('岳60') === 60 && R.parseLedgerText('岳60/李30') === 90
  && R.parseLedgerText('') === 0 && R.parseLedgerText(60) === 60
  && R.parseLedgerText(null) === 0 && R.parseLedgerText('无') === 0,
  '岳60=' + R.parseLedgerText('岳60') + ' 岳60/李30=' + R.parseLedgerText('岳60/李30'));
ok('B-⑧ 日期归一：2026.9.1 → 2026-09-01（也认 - 与 / 分隔）',
  R.normDate('2026.9.1') === '2026-09-01' && R.normDate('2026-9-1') === '2026-09-01'
  && R.normDate('2026/09/01') === '2026-09-01');
ok('B-⑨ 按日合计 = 当天各班之和（9.1 = 2381 + 2158.5 = 4539.5）',
  out.days[0].date === '2026-09-01' && out.days[0].revenueYuan === 4539.5
  && out.days[0].shifts.length === 2,
  out.days[0].date + ' = ' + out.days[0].revenueYuan);
ok('B-⑩ 只填「合计」的空班次（9.7/9.10 早班）不当成 0 元班次，单独记进 summaryOnlyRows',
  out.shifts.filter((s) => s.date === '2026-09-07').length === 1
  && out.shifts.filter((s) => s.date === '2026-09-10').length === 1
  && (out.summaryOnlyRows || []).length === 2
  && out.summaryOnlyRows[0].date === '2026-09-07' && out.summaryOnlyRows[0].totalDeclared === 3628.9,
  'summaryOnly=' + JSON.stringify((out.summaryOnlyRows || []).map((x) => x.date + x.shift)));
ok('B-⑪ 24 个班次的营业收入仍是 59,700.80（剔掉空行不影响总额）',
  out.totalsYuan.revenueDeclared === 59700.8);

// ===================== C 口径一变必须报警（变异）=====================
console.log('\n=== C 组 变异：口径/数据一变必须报警 ===');
function mutate(fn) { const m = rows.map((r) => r.slice()); fn(m); return R.parseRevenueDaily(m); }

const c1 = mutate((m) => { m[2][det.cols.cash] = '221'; });   // 9.1 早班 121→221
ok('C-① 改一个现金数 ⇒ 自检必须不通过，且差额精确报出',
  c1.caliber.pass === false && c1.caliber.mismatches.length === 1
  && c1.caliber.mismatches[0].diff === -100,
  'diff=' + (c1.caliber.mismatches[0] || {}).diff);

const c2 = mutate((m) => {   // 9.6 晚班挂账还款 2067 → 0（模拟「漏了收回旧账」）
  for (let i = 0; i < m.length; i++) {
    if (String(m[i][det.cols.date] || '').indexOf('9.6') >= 0
      || (i > 0 && String(m[i - 1][det.cols.date] || '').indexOf('9.6') >= 0)) {
      if (String(m[i][det.cols.shift] || '').indexOf('晚') >= 0) { m[i][det.cols.ledgerRepay] = ''; break; }
    }
  }
});
ok('C-② 抹掉唯一那笔「挂账还款 2067」⇒ 精确报出 +2067（证明这项真的进公式）',
  c2.caliber.pass === false && c2.caliber.mismatches.length === 1
  && c2.caliber.mismatches[0].diff === 2067,
  'diff=' + (c2.caliber.mismatches[0] || {}).diff);

const c3 = mutate((m) => { m[2][det.cols.revenueDeclared] = '9999'; });  // 手改营业收入
ok('C-③ 手改「营业收入」列 ⇒ 立刻报错（不是照抄表里那个数）',
  c3.caliber.pass === false && c3.caliber.mismatches.length === 1
  && Math.abs(c3.caliber.mismatches[0].diff - (9999 - 2381)) < 0.005,
  'diff=' + (c3.caliber.mismatches[0] || {}).diff);

// ===================== D 源码防回潮 =====================
console.log('\n=== D 组 源码防回潮 ===');
ok('D-① num() 必须兼容字符串（bufferToMatrix 输出全是字符串，只认 number 会全变 0）',
  SRC.indexOf("String(v).replace") >= 0 && SRC.indexOf('Number(s)') >= 0
  && SRC.indexOf('typeof v === \'number\' && isFinite(v) ? v : 0') < 0,
  '有 String 归一=' + (SRC.indexOf('String(v).replace') >= 0));
ok('D-② 公式是单源常量（不是散在代码里写死的数字）',
  Array.isArray(R.REVENUE_FORMULA) && R.REVENUE_FORMULA.join(',') === 'cash,recharge,scan,ledgerRepay'
  && R.REVENUE_FORMULA_TEXT.indexOf('现金 + 充值 + 扫码 + 挂账还款') === 0);
ok('D-③ 代码里不得把合计硬编码（防有人图省事直接写 59700.8）',
  SRC.indexOf('59700') < 0 && SRC.indexOf('5970080') < 0);
ok('D-④ 会员消费不得进公式（进了就是双计：充值已算过一次）',
  R.REVENUE_FORMULA.indexOf('memberConsume') < 0);
ok('D-⑤ 新赊出的挂账不得进公式（只算收回旧账）',
  R.REVENUE_FORMULA.indexOf('ledgerNew') < 0 && R.REVENUE_FORMULA.indexOf('ledgerRepay') >= 0);

console.log('\n===== 营收日报表解析守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
