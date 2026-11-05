// _audit_m1_sanity.js —— 只读取证：M1「老板看得懂」样例的数值量级回归
// 引擎用真实模块（cloudfunctions/calcMonthlyProfit/service.js + utils/breakeven.js）；
// 体检卡的装配逻辑按 subpkg/biz/month/result.js:412-547 逐行等价复刻（该页是 Page 对象，无法直接 require）。
const path = require('path');
const ROOT = (() => { const fs = require('fs'); const p = require('path');
  let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(p.join(d, 'app.json'))) return d; d = p.dirname(d); }
  return __dirname; })();  // R529：归档到 review/evidence/ 后仍能定位仓根（原来写死 __dirname）

const { calcMonthlyProfit } = require(path.join(ROOT, 'cloudfunctions/calcMonthlyProfit/service.js'));
const BE = require(path.join(ROOT, 'utils/breakeven.js'));
const { indicatorRef } = require(path.join(ROOT, 'cloudfunctions/common/index.js'));

const Y = 100;
const fen = (yuan) => Math.round(yuan * Y);
const wan = (f) => (Math.round((f / 100 / 10000) * 10) / 10) + '万';
const yuan2 = (f) => (f / 100).toFixed(2);

// —— 复刻 result.js:562-566 ——
function sumByName(rows, kw) {
  let n = 0;
  for (const r of (rows || [])) if (r && String(r.name || '').indexOf(kw) >= 0) n += Number(r.amountFen) || 0;
  return n;
}

// —— 复刻 result.js:412-546（buildBreakeven）——
function buildBreakeven(expenseCats, res, inds) {
  const rows = [];
  for (const it of expenseCats) {
    const subs = it.sub_items;
    if (subs && subs.length) {
      for (const si of subs) rows.push({ name: si.sub_item || it.name || '', amountFen: si.amount_fen || 0 });
    } else if (it.amount_fen) rows.push({ name: it.name || '', amountFen: it.amount_fen });
  }
  const revFen = res.incomeTotalFen || 0;
  const matFen = res.materialCostFen || 0;
  const sp = BE.splitFixedVariable(rows, { materialCostFen: matFen });
  const bk = BE.breakeven({ revenueFen: revFen, fixedFen: sp.fixedFen, variableFen: sp.variableFen });
  if (!bk.ok) return { ok: false, reason: bk.reason };
  const rentFen = sumByName(rows, '房租');
  const laborFen = sumByName(rows, '工资') + sumByName(rows, '社保');
  const indOf = (k) => (inds || []).find((x) => x && x.key === k) || null;
  const hiOf = (k, fb) => { const it = indOf(k); return (it && typeof it.hi === 'number') ? it.hi : fb; };
  const rentHi = hiOf('rent', 15), laborHi = hiOf('labor', 22);
  const rentIt = indOf('rent');
  const rentTarget = (rentIt && rentIt.lo != null && rentIt.hi != null) ? (rentIt.lo + rentIt.hi) / 2 : 12;
  const healthyFen = BE.healthyRevenue([{ amountFen: rentFen, hiPct: rentHi }, { amountFen: laborFen, hiPct: laborHi }]);
  const at = BE.attribution({ revenueFen: revFen, itemFen: rentFen, targetRatePct: rentTarget, targetRevenueFen: healthyFen });
  const rp = BE.recoverPaths({ revenueFen: revFen, fixedFen: sp.fixedFen, variableFen: sp.variableFen });
  return {
    ok: true, revFen, fixedFen: sp.fixedFen, variableFen: sp.variableFen,
    breakevenFen: bk.breakevenFen, lowFen: bk.lowFen, highFen: bk.highFen,
    safeMarginPct: bk.safeMarginPct, rentFen, laborFen, healthyFen,
    rentPct: revFen ? (rentFen / revFen) * 100 : 0,
    laborPct: revFen ? (laborFen / revFen) * 100 : 0,
    attr: at, rp, diag: BE.diagnose(healthyFen, bk.breakevenFen),
    unknown: sp.unknown, detail: sp.detail,
  };
}

function run(name, cfg) {
  const incomeItems = cfg.income.map((x) => ({ amountFen: fen(x.a) }));
  const expenseItems = cfg.expense.map((g) => ({ category: g.category || '', name: g.name, amount_fen: 0, sub_items: g.subs.map((s) => ({ sub_item: s.n, amount_fen: fen(s.a) })) }));
  const res = calcMonthlyProfit({
    incomeItems,
    expenseItems: expenseItems.map((g) => ({ amountFen: g.sub_items.reduce((s, x) => s + x.amount_fen, 0) })),
    directConsumeFen: fen(cfg.material),
    amortizeFen: fen(cfg.amort || 0),
    amortizeSwitchOn: !!cfg.amort,
    inventorySwitchOn: false,
    inventory: {},
    lumpSumFen: 0,
  });
  // 指标带（正餐 dining × 二三线）
  const __dbg = expenseItems.map((g) => ({ category: g.category, name: g.name, amountFen: 0, subItems: g.sub_items.map((s) => ({ subItem: s.n, amountFen: s.amount_fen })) }));
  console.log('[DBG0] ' + JSON.stringify(cfg.expense[0].subs[0]) + ' keys=' + JSON.stringify(Object.keys(cfg.expense[0].subs[0])));
  const byInd = indicatorRef.sumByTag(expenseItems.map((g) => ({
    category: g.category, name: g.name, amountFen: 0,
    subItems: g.sub_items.map((s) => ({ subItem: s.sub_item, amountFen: s.amount_fen })),
  })));
  const inds = indicatorRef.m1IndicatorsOf(indicatorRef.evaluateIndicators({
    bizKey: 'dining', cityKey: 'tier23', revenueFen: res.incomeTotalFen,
    fixedFen: indicatorRef.toFixedFen(byInd),
    grossMarginPct: res.grossMarginRatePctDisplay,
    platformPct: (byInd.mkt != null && res.incomeTotalFen > 0) ? (byInd.mkt / res.incomeTotalFen) * 100 : null,
  }));
  const be = buildBreakeven(expenseItems, res, inds);

  console.log('\n================ ' + name + ' ================');
  console.log('营收 ' + yuan2(res.incomeTotalFen) + ' ｜ 费用 ' + yuan2(res.expenseTotalFen)
    + ' ｜ 食材 ' + yuan2(res.materialCostFen) + ' ｜ 毛利率 ' + res.grossMarginRatePctDisplay + '%');
  console.log('参考利润 ' + yuan2(res.operationRefProfitFen) + ' ｜ 会计利润 ' + yuan2(res.totalFactorRealProfitFen)
    + ' ｜ 差额 ' + yuan2(res.profitDiffFen) + '（ref_source=' + res.refMaterialSource + '）');
  console.log('每卖 100 元落袋 ' + (res.incomeTotalFen > 0 ? Math.round((res.totalFactorRealProfitFen / res.incomeTotalFen) * 100) : 0) + ' 元');
  if (!be.ok) { console.log('体检：算不出（' + be.reason + '）'); return; }
  console.log('固定 ' + yuan2(be.fixedFen) + ' ｜ 变动 ' + yuan2(be.variableFen)
    + ' ｜ 固定+变动 = ' + yuan2(be.fixedFen + be.variableFen)
    + '（应 = 费用+食材 = ' + yuan2(res.expenseTotalFen + res.materialCostFen) + '）');
  console.log('保本营收 ' + wan(be.breakevenFen) + '（区间 ' + wan(be.lowFen) + ' ~ ' + wan(be.highFen) + '）｜ 安全边际 ' + be.safeMarginPct + '%');
  console.log('达标营业额 ' + wan(be.healthyFen) + '（房租上限 ' + (inds.find((x) => x.key === 'rent') || {}).hi
    + '% / 人工上限 ' + (inds.find((x) => x.key === 'labor') || {}).hi + '%）｜ 结构诊断 ' + be.diag);
  console.log('房租(按名字) ' + yuan2(be.rentFen) + ' = ' + be.rentPct.toFixed(1) + '% ｜ 人工(工资+社保) ' + yuan2(be.laborFen) + ' = ' + be.laborPct.toFixed(1) + '%');
  console.log('指标侧 sumByTag：' + JSON.stringify(byInd));
  console.log('回本：营收需提到 ' + wan(be.rp.needRevenueFen ? be.rp.needRevenueFen : 0)
    + '（+' + (be.rp.revenueGapPct || 0) + '%）｜ 变动率压到 ' + be.rp.targetVarRatePct + '%（当前 ' + be.rp.curVarRatePct + '%）'
    + '｜ 路径二可行 ' + be.rp.varPathPossible);
  console.log('未被识别（按固定处理）的费用行：' + (be.unknown.length ? be.unknown.join(' / ') : '（无）'));
}

run('样例1 · 正餐小店（营收10万/房租8千/人工2万/食材率35%）', {
  income: [{ a: 100000 }],
  expense: [
    { name: '运营费用', category: 'operation', subs: [{ n: '房租', a: 8000 }, { n: '物业费', a: 500 }, { n: '水费', a: 300 }, { n: '电费', a: 2200 }, { n: '燃气费', a: 500 }, { n: '垃圾清运费', a: 100 }, { n: '宽带网费', a: 100 }] },
    { name: '人工费用', category: 'labor', subs: [{ n: '工资绩效', a: 18000 }, { n: '社保', a: 2000 }] },
    { name: '其他费用', category: 'other', subs: [{ n: '代账费', a: 1000 }] },
  ],
  material: 35000,
});

run('样例2 · 亏损店（营收10万/房租3万/人工4万/食材率40%）', {
  income: [{ a: 100000 }],
  expense: [
    { name: '运营费用', category: 'operation', subs: [{ n: '房租', a: 30000 }, { n: '水费', a: 800 }, { n: '电费', a: 5200 }, { n: '燃气费', a: 2000 }] },
    { name: '人工费用', category: 'labor', subs: [{ n: '工资绩效', a: 36000 }, { n: '社保', a: 4000 }] },
    { name: '其他费用', category: 'other', subs: [{ n: '代账费', a: 5000 }] },
  ],
  material: 40000,
  amort: 3000,
});

run('样例3 · 外卖为主（营收8万/堂食2万+外卖6万/佣金9千/配送4千）', {
  income: [{ a: 80000 }],
  expense: [
    { name: '运营费用', category: 'operation', subs: [{ n: '房租', a: 6000 }, { n: '水费', a: 300 }, { n: '电费', a: 2200 }, { n: '燃气费', a: 500 }] },
    { name: '人工费用', category: 'labor', subs: [{ n: '工资绩效', a: 13000 }, { n: '社保', a: 2000 }] },
    { name: '营销费用', category: 'marketing', subs: [{ n: '外卖平台佣金', a: 9000 }, { n: '外卖配送服务费', a: 4000 }] },
  ],
  material: 32000,
});

run('样例4 · 极端：食材率压到 0（老板没填消耗 · 库存关）', {
  income: [{ a: 100000 }],
  expense: [
    { name: '运营费用', category: 'operation', subs: [{ n: '房租', a: 8000 }] },
    { name: '人工费用', category: 'labor', subs: [{ n: '工资绩效', a: 20000 }] },
  ],
  material: 0,
});
