// R737 第三轮：变异回灌 —— 证明第二轮的 32 条断言不是恒真。
// 不采信「全绿」：把实现逐条改坏，看断言会不会当场转红。抓不到 = 那条断言是假绿。
const path = require('path');
const fs = require('fs');
const Module = require('module');

const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    const dbStub = {
      command: { in: (x) => x, eq: (x) => x },
      serverDate: () => 0,
      collection: () => ({ where: () => ({ get: async () => ({ data: [] }) }) }),
    };
    return { init() {}, DYNAMIC_CURRENT_ENV: 'stub', database: () => dbStub };
  }
  return _origLoad.apply(this, arguments);
};

const ROOT = path.resolve(__dirname, '..', '..');
const ABS = path.join(ROOT, 'cloudfunctions/exportData/index.js');
const SRC = fs.readFileSync(ABS, 'utf8');
const { ASSETS, EXPECT_AMORT } = require('./r737_fixture');

let pass = 0, fail = 0;
function ck(id, ok, detail) {
  if (ok) pass++; else { fail++; console.log(`❌ ${id} — ${detail || ''}`); }
}
function rowFen(row) {
  if (!row) return NaN;
  for (let i = row.length - 1; i >= 0; i--) {
    const c = row[i];
    if (c === '' || c == null) continue;
    const n = Number(c);
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return NaN;
}
function findRow(rows, key) {
  return (rows || []).find((r) => (r || []).some(
    (c) => String(c == null ? '' : c).replace(/[\s　]/g, '').indexOf(key) >= 0));
}

// 把源码改一处，编译成内存模块（不落盘 ⇒ 不会污染工作区）
function mutant(from, to) {
  if (SRC.indexOf(from) < 0) return { err: '锚点未找到: ' + from };
  const m = new Module(ABS, module);
  m.filename = ABS;
  m.paths = Module._nodeModulePaths(path.dirname(ABS));
  m._compile(SRC.replace(from, to), ABS);
  return { exp: m.exports };
}

function mkRow(month, savedAmort, savedAmortOn) {
  const inc = 10000000, exp = 3000000, real = 2000000, lump = 5000000;
  const opRef = inc - exp - real - lump;
  return {
    month, income_items: [], expense_items: [],
    income_total_fen: inc, expense_total_fen: exp,
    direct_consume_fen: real, real_consume_fen: real,
    amortize_fen: savedAmort, lump_sum_fen: lump,
    operation_ref_profit_fen: opRef,
    total_factor_real_profit_fen: opRef - savedAmort,
    profit_diff_fen: savedAmort,
    gross_profit_fen: inc - real, gross_margin_pct: 80,
    ref_material_source: 'direct',
    switch_used: { inventorySwitchOn: false, amortizeSwitchOn: savedAmortOn },
  };
}
function build(exp, month, savedAmort, savedAmortOn) {
  return exp.buildMonthlySheets({
    shopName: '测试店', month, stamp: 0,
    row: mkRow(month, savedAmort, savedAmortOn), assets: ASSETS,
  });
}

// ===== M-1：摊销额退回念落库值 ⇒ A-1/A-3/A-4 应红 =====
{
  const mut = mutant(
    'const amort = (amortV2 && !isArchiveRow) ? amortLedger : nz(row.amortize_fen);',
    'const amort = nz(row.amortize_fen);');
  let caught = false, detail = mut.err || '';
  if (mut.exp) {
    const sh = build(mut.exp, '2026-11', 0, false);   // 部署前保存的月份
    const a = rowFen(findRow(sh.find((s) => s.name === '利润表').rows, '减：当月摊销'));
    caught = a === 0;                                  // 退回旧行为 ⇒ 摊销 0
    detail = '变异后摊销=' + a + ' 分（期望 0 = 已退回旧行为，说明 A-1 会红）';
  }
  ck('M-1 摊销额退回念落库值 ⇒ A-1 当场转红', caught, detail);
}

// ===== M-2：amOn 退回看快照 ⇒ A-5/A-6/A-7 应红 =====
{
  const mut = mutant(
    'const amOn = amortV2 ? true : !!sw.amortizeSwitchOn;',
    'const amOn = !!sw.amortizeSwitchOn;');
  let caught = false, detail = mut.err || '';
  if (mut.exp) {
    const sh = build(mut.exp, '2026-11', 0, false);
    const note = findRow(sh.find((s) => s.name === '利润表').rows, '减：当月摊销');
    const amRow = findRow(sh.find((s) => s.name === '口径说明').rows, '摊销开关');
    const hasDiff = !!findRow(sh.find((s) => s.name === '摊销来源').rows, '台账应收摊销');
    // 硬判据：v2 月份**只要出现差异行就是错** —— 那一行会让老板以为这 5,277.78 没进利润，
    //   而页面（getLedger 重算）明明扣了。备注/口径是软判据（措辞可以再改），差异行是硬事实。
    //   ⚠️ 口径说明那一行由 amortV2 决定、不依赖 amOn ⇒ 拿它当判据会恒绿（我第一版就这么写的，被抓）。
    caught = hasDiff === true && /旧口径/.test(String(note[2]));
    detail = '变异后有差异行=' + hasDiff + ' 备注=' + note[2];
  }
  ck('M-2 amOn 退回看快照 ⇒ A-5/A-6/A-7 三条同时转红', caught, detail);
}

// ===== M-3：尾差倒挤被去掉 ⇒ 36 期合计不再等于原值 =====
{
  const mut = mutant(
    'if (end === naturalEnd) return asset.total_value - base * (N - 1);',
    'if (end === naturalEnd) return base;');
  let caught = false, detail = mut.err || '';
  if (mut.exp) {
    // 末月（2029-08）应得 361115，退化成 base 361111 ⇒ 36 期合计 ≠ 原值
    const sh = build(mut.exp, '2029-08', 0, false);
    const a = rowFen(findRow(sh.find((s) => s.name === '利润表').rows, '减：当月摊销'));
    // 2029-08：装修末月 + 设备已摊完 ⇒ 应 = 361115
    caught = a !== 361115;
    detail = '变异后 2029-08 摊销=' + a + ' 分（期望 ≠361115，说明尾差被抹平）';
  }
  ck('M-3 去掉尾差倒挤 ⇒ D-1/D-5 转红', caught, detail);
}

// ===== M-4：真实利润退回读落库 ⇒ A-2 表内恒等式断裂 =====
{
  const mut = mutant(
    'const realP = (amortV2 && !isArchiveRow) ? Math.round(opRef - gapFen - amort) : nz(row.total_factor_real_profit_fen);',
    'const realP = nz(row.total_factor_real_profit_fen);');
  let caught = false, detail = mut.err || '';
  if (mut.exp) {
    const sh = build(mut.exp, '2026-11', 0, false);
    const rows = sh.find((s) => s.name === '利润表').rows;
    const realP = rowFen(findRow(rows, '全要素真实利润'));
    const opRef = rowFen(findRow(rows, '经营参考利润'));
    const amort = rowFen(findRow(rows, '减：当月摊销'));
    caught = realP !== (opRef - amort);   // 表内不平 ⇒ A-2 会红
    detail = `变异后 真实=${realP} 但 经营参考−摊销=${opRef - amort}（差 ${realP - (opRef - amort)} 分）`;
  }
  ck('M-4 真实利润退回读落库 ⇒ 表内恒等式断裂（A-2 转红）', caught, detail);
}

// ===== 自失效护栏：锚点必须都还在，否则上面四条都恒绿 =====
{
  const anchors = [
    'const amort = (amortV2 && !isArchiveRow) ? amortLedger : nz(row.amortize_fen);',
    'const amOn = amortV2 ? true : !!sw.amortizeSwitchOn;',
    'if (end === naturalEnd) return asset.total_value - base * (N - 1);',
    'const realP = (amortV2 && !isArchiveRow) ? Math.round(opRef - gapFen - amort) : nz(row.total_factor_real_profit_fen);',
  ];
  const missing = anchors.filter((a) => SRC.indexOf(a) < 0);
  ck('Z-1 四个变异锚点在当前源码中都存在（锚点漂移 = 上面四条假绿）',
    missing.length === 0, '缺失：' + missing.join(' | '));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
