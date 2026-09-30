// 独立复算 M3.16 三锚点（不采信 selftest_m3_combo.js 的断言，自己 require 生产引擎跑）
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const CD = require(path.join(ROOT, 'cloudfunctions/common/comboDerive.js'));
const ENG = require(path.join(ROOT, 'cloudfunctions/calcBom/service.js'));

const F = (x) => (x / 100).toFixed(2) + ' 元';
let bad = 0;
const chk = (name, got, want) => {
  const okv = JSON.stringify(got) === JSON.stringify(want);
  if (!okv) bad++;
  console.log(`${okv ? '✅' : '❌'} ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// ---------- A-a：套餐成本 1275 分 = 宫保975 + 米饭120 + 例汤180 ----------
const subs = [
  { sub_card_ref: 'cc_gongbao', name: '宫保鸡丁', unit_cost_fen: 975, quantity: 1, price_fen: 2200, version: 1 },
  { sub_card_ref: 'cc_rice',    name: '米饭',     unit_cost_fen: 120, quantity: 1, price_fen: 300,  version: 1 },
  { sub_card_ref: 'cc_soup',    name: '例汤',     unit_cost_fen: 180, quantity: 1, price_fen: 1200, version: 1 },
];
const lines = CD.buildComboLines(subs);
console.log('buildComboLines →', JSON.stringify(lines.map((l) => ({ q: l.quantity, wan: l.net_unit_cost }))));
// 引擎只读 quantity + net_unit_cost
const outA = ENG.calcCostCard({ mode: 'A', lossPct: 0, auxFen: 0, lines, priceFen: 2500 });
const costA = outA.unit_cost_fen;
console.log('calcCostCard A-a →', JSON.stringify({ unit_cost_fen: costA, gross_profit_fen: outA.gross_profit_fen, gross_margin_pct: outA.gross_margin_pct, lines: outA.lines.map(x=>x.line_net_cost_fen) }));
chk('A-a 套餐成本(分)', costA, 1275);

const priceFenA = 2500;                       // 售 25 元
const grossA = priceFenA - costA;
const rateA = Math.round((grossA / priceFenA) * 10000) / 100;
chk('A-a 毛利(分)', grossA, 1225);
chk('A-a 毛利率(%)', rateA, 49);

const insA = CD.comboInsight(subs, priceFenA, costA);
const alaSum = subs.reduce((s, x) => s + x.price_fen * x.quantity, 0);
console.log(`   挂牌单点合计 ${F(alaSum)} → comboInsight =`, JSON.stringify(insA));
chk('A-a 顾客省 = Σ挂牌 − 售价', insA.customerSaveFen, alaSum - priceFenA);
chk('A-a 我少赚 = 套餐毛利 − Σ单点毛利', insA.merchantLoseFen,
  grossA - subs.reduce((s, x) => s + (x.price_fen - x.unit_cost_fen) * x.quantity, 0));

// ---------- A-b：锁版本 —— 子卡涨价后套餐成本不变；同步到最新才变 ----------
const subsLocked = subs.map((s) => ({ ...s }));
subsLocked[0].unit_cost_fen = 1208;           // 宫保涨价 975 → 1208（但套餐锁版本 1）
const outLocked = ENG.calcCostCard({ mode: 'A', lossPct: 0, auxFen: 0, priceFen: 2500, lines: CD.buildComboLines([
  { ...subs[0], unit_cost_fen: 975, quantity: 1, version: 1 },   // 锁定版本仍用 975
  { ...subs[1], quantity: 1, version: 1 },
  { ...subs[2], quantity: 1, version: 1 },
]) });
chk('A-b 锁版本后套餐成本(分)', outLocked.unit_cost_fen, 1275);
const outSynced = ENG.calcCostCard({ mode: 'A', lossPct: 0, auxFen: 0, priceFen: 2500, lines: CD.buildComboLines([
  { ...subs[0], unit_cost_fen: 1208, quantity: 1, version: 2 },  // 同步到最新 ⇒ 1208
  { ...subs[1], quantity: 1, version: 1 },
  { ...subs[2], quantity: 1, version: 1 },
]) });
chk('A-b 同步至最新后套餐成本(分)', outSynced.unit_cost_fen, 1508);
const rateB = outSynced.gross_margin_pct;
chk('A-b 同步后毛利率(%)', rateB, 39.68);

// ---------- A-c：禁嵌套 / 版本无效 ----------
chk('A-c 套餐引套餐', CD.judgeComboRef({ sub_card_ref: 'cc_combo' }, { card_code: 'cc_combo', card_type: 3, is_deleted: false }),
  { ok: false, code: 'COMBO_NEST_NOT_ALLOWED' });
chk('A-c 版本不存在(null)', CD.judgeComboRef({ sub_card_ref: 'cc_x' }, null), { ok: false, code: 'SUB_CARD_VERSION_INVALID' });
chk('A-c 已软删', CD.judgeComboRef({ sub_card_ref: 'cc_x' }, { card_type: 1, is_deleted: true }), { ok: false, code: 'SUB_CARD_VERSION_INVALID' });
chk('A-c 正常单品', CD.judgeComboRef({ sub_card_ref: 'cc_gongbao' }, { card_type: 1, is_deleted: false }),
  { ok: true, card: { card_type: 1, is_deleted: false } });

console.log(bad === 0 ? '\n===> 独立复算：全部一致 ✅' : `\n===> 独立复算：${bad} 条不一致 ❌`);
process.exit(bad === 0 ? 0 : 1);
