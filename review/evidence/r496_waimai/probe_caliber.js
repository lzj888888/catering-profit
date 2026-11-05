/**
 * R496 · 外卖口径真值代入探针（只跑本仓真实函数，不重写算法）
 *
 * 目的：证明「补贴被加进收入」会让利润虚高，且**偏差恒等于补贴额**；并验证修复后命中真值。
 *
 * 真值锚点（review/evidence/r161_waimai · 2026-08 实测账单）：
 *   美团：商品总价(优惠前)3041.20 / 打包125.00 / 商家承担补贴806.29 / 平台服务费533.27 / 到手1826.64
 *   淘宝：优惠前总额(商品+打包)6585.08 / 商家承担补贴2069.70 / 佣金158.71 / 配送577.02 / 到手3779.65
 *
 * 🔴 修复后本探针直接跑**生产函数**（subtotalOf + expectedReceivable），不再手抄公式。
 */
const tw = require('../../../utils/takeaway.js');

const CASES = [
  { name: '美团 2026-08', goods: 3041.20, pack: 125.00, subsidy: 806.29, commission: 533.27, deliveryFee: 0, deliverySubsidy: 0, truth: 1826.64 },
  { name: '淘宝 2026-08', goods: 6585.08, pack: 0, subsidy: 2069.70, commission: 158.71, deliveryFee: 577.02, deliverySubsidy: 0, truth: 3779.65 },
];

console.log('===== A · 修复后（当前生产代码）：收入 = 商品总价 + 打包费，补贴不进收入 =====');
for (const c of CASES) {
  const inc = Number(tw.subtotalOf(String(c.goods), String(c.pack)));
  const net = tw.expectedReceivable(inc, c.subsidy, c.commission, c.deliveryFee, c.deliverySubsidy);
  console.log(`${c.name}: 收入(生产 subtotalOf)=${inc.toFixed(2)}  净额=${net.toFixed(2)}  真实到手=${c.truth}  偏差=${(net - c.truth).toFixed(2)}`);
}

console.log('\n===== B · 修复前（旧利润链复现）：收入含补贴 ⇒ 一加一减抵消，补贴等于没扣 =====');
for (const c of CASES) {
  const incOld = c.goods + c.pack + c.subsidy;                                        // 旧 subtotalOf 三项相加
  const netOld = incOld - c.subsidy - c.commission - c.deliveryFee - c.deliverySubsidy; // 费用侧扣一次补贴
  const bias = netOld - c.truth;
  console.log(`${c.name}: 旧收入=${incOld.toFixed(2)}  旧净额=${netOld.toFixed(2)}  真实到手=${c.truth}  虚高=${bias.toFixed(2)}`
    + `  ← 与补贴额 ${c.subsidy} 相等？ ${Math.abs(bias - c.subsidy) < 0.01}`);
}

console.log('\n===== 结论 =====');
console.log('修复后偏差应为 0.00（命中真值）；修复前虚高应恰等于各自的「商家承担补贴」额。');
console.log('👉 病灶不在配平式（R164 后配平本就自洽），而在**利润链**：收入加了一次补贴、费用又扣一次 ⇒ 抵消。');
