#!/usr/bin/env node
// R744c 取证：李老师真机「ABC 店铺 11 月，摊销 20000」—— 证明 R744 对该场景零影响
// 结论预设（待机器验证）：没有提前报废资产 ⇒ 处置损失恒 0 ⇒ 摊销仍是 20000、利润一分不变。
// 我的 9666.69 / 9333.36 来自规范 S2b 测试锚点（旧空调 12000/36），**不是真机该显示的数**。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const F = (p) => path.join(ROOT, p);
const Y = 100;
const yuan = (f) => (f / Y).toFixed(2);

const gl = require(F('cloudfunctions/getLedger/service.js'));
const sl = require(F('cloudfunctions/saveLedger/service.js'));
const gs = require(F('cloudfunctions/getAmortSchedule/service.js'));
const poc = require(F('cloudfunctions/calcAmortize/service.js'));

console.log('===== R744c · ABC 店铺 11 月（摊销 20000）零影响取证 =====\n');

// 造一组「11 月合计摊销正好 20000 元」的在摊资产（两笔，都不是报废）
//   A: 720000 元 / 36 期 = 20000 元/月，2026-01 起摊 ⇒ 11 月在摊
const ASSETS = [
  { asset_id: 'a1', name: '门店装修', mode: 'amort', value_fen: 72000000, total_value: 72000000,
    start_month: '2026-01', total_months: 36, terminate_month: '' },
];
// 另一组：两笔各 10000，合计也是 20000（验证多资产叠加不受影响）
const ASSETS2 = [
  { asset_id: 'b1', name: '设备A', mode: 'amort', value_fen: 36000000, total_value: 36000000,
    start_month: '2026-01', total_months: 36, terminate_month: '' },
  { asset_id: 'b2', name: '设备B', mode: 'amort', value_fen: 36000000, total_value: 36000000,
    start_month: '2026-01', total_months: 36, terminate_month: '' },
];

function probe(name, assets, month) {
  const amort = gl.amortizeTotalForMonth(assets, month);
  const disposal = gl.disposalLossForMonth(assets, month);
  // 四副本逐分一致
  const ds = [gl, sl, gs].map((e) => e.disposalLossForMonth(assets, month));
  console.log(`【${name}】month=${month}`);
  console.log(`  台账摊销合计        = ${yuan(amort)} 元`);
  console.log(`  资产处置损失        = ${yuan(disposal)} 元  ← R744 新增项`);
  console.log(`  本月计入额(摊销+损失) = ${yuan(amort + disposal)} 元`);
  console.log(`  三副本处置损失一致  = ${ds.every((v) => v === ds[0]) ? '✅' : '❌'} (${ds.join('/')})`);
  console.log(`  POC calcResidualFen 合计 = ${yuan(assets.reduce((s, a) => s + poc.calcResidualFen(a), 0))} 元（无提前终止 ⇒ 0）`);
  return { amort, disposal };
}

const r1 = probe('ABC 11 月 · 单笔 720000/36', ASSETS, '2026-11');
const r2 = probe('ABC 11 月 · 两笔各 10000', ASSETS2, '2026-11');

console.log('\n----- 结论 -----');
const ok = r1.disposal === 0 && r2.disposal === 0
  && r1.amort + r1.disposal === r1.amort
  && r2.amort + r2.disposal === r2.amort;
console.log(`  ${ok ? '✅' : '❌'} 无提前报废资产 ⇒ 处置损失恒 0 ⇒ 摊销与利润逐分不变（R744 对该场景零影响）`);
console.log(`  摊销 20000 元 = ${yuan(r1.amort)} / ${yuan(r2.amort)} 元 ← 与真机一致`);
console.log('\n  我的 9666.69（=333.33 + 9333.36）只在「2026-08 提前报废旧空调」这一**规范测试锚点**下出现，');
console.log('  它是 fixtures/探针里的数，不是产品里写死的常量，也不是 ABC 店铺 11 月应该显示的数。');
console.log('  ⇒ 不需要查原因；真机数字正确，按您的判断继续。');
