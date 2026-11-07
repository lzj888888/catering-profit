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

// ===================== E 双口径与 M1 权责制对齐（2026-11-07 李老师裁决）=====================
//   🔴 这是本轮最重要的一组：李老师原话「充值的不能算作营业收入」「营收算法理论上要和 M1 看齐统一」
//   ⇒ 营收必须用 M1 权责制口径；充值一律不计；两套口径的差额必须能被四组互换完全解释（无第五项）。
console.log('\n=== E 组 双口径：营收取 M1 权责制，充值不计入 ===');

ok('E-① 输出的营收是 M1 口径（revenueM1.totalYuan ≠ 表里营业收入，证明没混用）',
  typeof out.revenueM1.totalYuan === 'number'
  && Math.abs(out.revenueM1.totalYuan - out.cashInflow.declaredYuan) > 0.01,
  'revenueM1=' + out.revenueM1.totalYuan + ' / declared=' + out.cashInflow.declaredYuan);

ok('E-② 营收 = 堂食 + 外卖（分项加得上，无暗项）',
  Math.abs((out.revenueM1.dineInYuan + out.revenueM1.takeawayYuan) - out.revenueM1.totalYuan) < 0.01,
  out.revenueM1.dineInYuan + '+' + out.revenueM1.takeawayYuan + ' vs ' + out.revenueM1.totalYuan);

ok('E-③ 营收 64,547.08 元 / 6,454,708 分（真数据锚点）',
  out.revenueM1.totalYuan === 64547.08 && out.revenueM1.totalFen === 6454708,
  '元=' + out.revenueM1.totalYuan + ' 分=' + out.revenueM1.totalFen);

// 🔴 差分测试：把「充值」改大 10 倍，营收必须纹丝不动；现金流入必须跟着变。
//   这比看源码强 —— 它直接证明「充值没进营收」这个行为，而不只是「代码里没写」。
(() => {
  const rows2 = FIX.rows.map((r) => r.slice());
  const ci = out.cols.recharge;
  let touched = 0;
  for (let i = out.headerRow + 1; i < rows2.length; i++) {
    const v = Number(String(rows2[i][ci] == null ? '' : rows2[i][ci]).replace(/,/g, '')) || 0;
    if (v > 0) { rows2[i][ci] = String(v * 10); touched++; }
  }
  const out2 = R.parseRevenueDaily(rows2);
  const revSame = Math.abs(out2.revenueM1.totalYuan - out.revenueM1.totalYuan) < 0.01;
  const cashGrew = out2.cashInflow.totalYuan - out.cashInflow.totalYuan;
  ok('E-④ 【差分】充值放大 10 倍 ⇒ 营收一分不变、现金流入跟着涨（证明充值没进营收）',
    touched > 0 && revSame && cashGrew > 0,
    '改了 ' + touched + ' 行 | 营收 ' + out2.revenueM1.totalYuan + '(应不变) | 现金流入 +' + Math.round(cashGrew));
})();

ok('E-⑤ 差额桥恒等式成立：(M1多算 − 老板多算) == M1营收 − 现金流入（无第五项）',
  out.bridge.identityOk === true
  && Math.abs(out.bridge.identityDiffYuan - out.bridge.diffYuan) < 0.01,
  'identity=' + out.bridge.identityDiffYuan + ' diff=' + out.bridge.diffYuan);

ok('E-⑥ 差额 4,846.28 元 / 8.12%（真数据锚点；老板多算 24,740 − M1 多算 29,586.28）',
  out.bridge.diffYuan === 4846.28 && out.bridge.bossOverSum === 24740
  && out.bridge.m1OverSum === 29586.28,
  'diff=' + out.bridge.diffYuan + ' bossOver=' + out.bridge.bossOverSum + ' m1Over=' + out.bridge.m1OverSum);

ok('E-⑦ 现金流入口径自带用途标签 purpose=cash_reconciliation（防上层误当营收）',
  out.cashInflow.purpose === 'cash_reconciliation'
  && String(out.cashInflow.note).indexOf('不是经营收入') >= 0);

ok('E-⑧ 未确认含义的「茶楼」不计入营收，单列 pendingOther（不猜）',
  out.revenueM1.pendingOtherYuan === 550
  && out.revenueM1.pendingOtherKeys.join(',') === 'teahouse'
  && out.revenueM1.totalYuan === Math.round((out.revenueM1.dineInYuan + out.revenueM1.takeawayYuan) * 100) / 100);

ok('E-⑨ 源码级：M1 营收公式必须含 储值卡消费/挂账消费/团购/外卖，禁含 充值/挂账还款',
  (() => {
    const d = R.M1_DINEIN_KEYS, t = R.M1_TAKEAWAY_KEYS;
    return d.indexOf('memberConsume') >= 0 && d.indexOf('ledgerNew') >= 0
      && d.indexOf('grouponMeituan') >= 0 && d.indexOf('grouponDouyin') >= 0
      && t.length === 3
      && d.indexOf('recharge') < 0 && d.indexOf('ledgerRepay') < 0;
  })(),
  'dineIn=' + R.M1_DINEIN_KEYS.join(',') + ' | takeaway=' + R.M1_TAKEAWAY_KEYS.join(','));

ok('E-⑩ 每班次同时带两套口径（revenueM1Yuan / cashInflowYuan），M1 可直接按班取用',
  out.shifts.length > 0 && out.shifts.every((s) => typeof s.revenueM1Yuan === 'number'
    && typeof s.cashInflowYuan === 'number'));

ok('E-⑪ 按日聚合也带 M1 口径（days[].revenueM1Yuan），且逐日加总 == 月度营收',
  (() => {
    const sum = Math.round(out.days.reduce((s, d) => s + (d.revenueM1Yuan || 0), 0) * 100) / 100;
    return out.days.every((d) => typeof d.revenueM1Yuan === 'number')
      && Math.abs(sum - out.revenueM1.totalYuan) < 0.01;
  })());

// ===================== F 与 M1 记账页类目同源（防口径漂移）=====================
//   为什么这组最值钱：M1 的 `TERMS.ledger.income` 才是收入类目的**权威表**。
//   我们 M3 的营收公式若与它漂移，就会出现「同一个店，M1 算出 A、M3 算出 B」。
//   ⇒ 不靠「口径说明写在文档里」，而是**机器对齐两张表**。
console.log('\n=== F 组 与 M1 收入类目同源（TERMS.ledger.income 为权威）===');

const TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
const M1_INCOME = TERMS.ledger.income;
const m1Cat = (c) => (M1_INCOME.find((x) => x.category === c) || {});
const m1DineItems = (m1Cat('dine_in').items) || [];
const m1TakeItems = (m1Cat('takeaway').items) || [];
const m1OtherItems = (m1Cat('other').items) || [];

ok('F-① M1 堂食类目里必须有「储值卡消费 / 挂账消费 / 团购核销」（我们的营收靠这三项才不漏）',
  m1DineItems.indexOf('储值卡消费') >= 0
  && m1DineItems.some((x) => x.indexOf('挂账') >= 0)
  && m1DineItems.some((x) => x.indexOf('团购') >= 0),
  m1DineItems.join('/'));

ok('F-② 🔴 M1 堂食类目里**不得出现「充值」**（M1 自己都不收充值，M3 更不能收）',
  m1DineItems.every((x) => x.indexOf('充值') < 0)
  && m1TakeItems.every((x) => x.indexOf('充值') < 0)
  && m1OtherItems.every((x) => x.indexOf('充值') < 0));

ok('F-③ 我们的堂食映射表**覆盖 M1 堂食全部细项**，一个不漏（防 M1 加项后我们没跟）',
  (() => {
    const mapped = R.M1_DINEIN_MAP.map((x) => x.m1);
    const miss = m1DineItems.filter((x) => mapped.indexOf(x) < 0);
    return miss.length === 0;
  })(),
  '未映射=' + m1DineItems.filter((x) => R.M1_DINEIN_MAP.map((y) => y.m1).indexOf(x) < 0).join(',') || '无');

ok('F-④ 映射表里每个 m1 项都必须真存在于 M1 堂食类目（防我们编出不存在的类目）',
  R.M1_DINEIN_MAP.every((x) => m1DineItems.indexOf(x.m1) >= 0),
  R.M1_DINEIN_MAP.map((x) => x.m1).join(','));

ok('F-⑤ 外卖映射覆盖 M1 前三项，且「其他外卖」作为显式缺口被记录（不假装覆盖）',
  m1TakeItems.filter((x) => R.M1_TAKEAWAY_MAP.map((y) => y.m1).indexOf(x) >= 0).length === 3
  && R.M1_TAKEAWAY_MISSING.indexOf('其他外卖') >= 0
  && m1TakeItems.indexOf('其他外卖') >= 0,
  'M1 外卖=' + m1TakeItems.join('/') + ' | 缺口=' + R.M1_TAKEAWAY_MISSING.join(','));

ok('F-⑥ 茶楼不在 M1「其他业务收入」类目里 ⇒ 不计入营收的处理正确（不猜）',
  m1OtherItems.indexOf('茶楼') < 0,
  'M1 其他业务收入=' + m1OtherItems.join('/'));

ok('F-⑦ keys 从映射表派生（单源）：改映射即改公式，不存在两处维护',
  (() => {
    const expect = [];
    for (const x of R.M1_DINEIN_MAP) for (const k of x.keys) if (expect.indexOf(k) < 0) expect.push(k);
    return R.M1_DINEIN_KEYS.join(',') === expect.join(',');
  })(),
  'derived=' + R.M1_DINEIN_KEYS.join(','));

ok('F-⑧ M1 记账页那条红线还在（「首页营业收入别直接抄」「充值不算收入」）——'
  + '它是我们两套口径的依据，删了就等于失去立论',
  (() => {
    const fh = (TERMS.ledger.dineMode || {}).fastHint || '';
    return fh.indexOf('别直接抄') >= 0
      && fh.indexOf('顾客充值的钱不算收入') >= 0
      && fh.indexOf('按消费那天算') >= 0;
  })());

ok('F-⑨ 解析器头注必须指向 M1 依据（防后人删了依据只留公式）',
  SRC.indexOf('TERMS.ledger.income') >= 0 || SRC.indexOf('terms.js') >= 0,
  '头注指路=' + (SRC.indexOf('terms.js') >= 0));

console.log('\n===== 营收日报表解析守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
