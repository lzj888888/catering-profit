// tools/check_promo_two_stage.js —— R759 活动测算「两段分离」长期守卫
// 病根：旧版把「相当于几折」藏在结果区、还被「毛利率为空就 return」卡住 ⇒ 主次颠倒。
// 守卫用**页面桩真跑** promo/index.js 的 recalc（不靠源码字面量、不依赖 IDE），机器验证：
//   A 换算独立：不填毛利率，买2送1 → 6.67折 + 推导式，back=null
//   B 回本对拍：填 50%/8000/200 → 毛利25%/流水16000/单量40→120/客流+200%
//   C 两段联动：换活动形式（满100减30）→ 折扣与回本都跟着变
//   D 反恒真：坏规则必须判红，且不能污染旧结果
const fs = require('fs');
const path = require('path');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ---- 页面桩：加载 promo/index.js，捕获 Page(cfg) ----
let cfg = null;
global.Page = (c) => { cfg = c; };
global.wx = {};
const PAGE = path.join(__dirname, '..', 'subpkg/tools/promo/index.js');
try {
  require(PAGE);
} catch (e) {
  console.log('❌ 页面加载失败: ' + e.message);
  process.exit(1);
}
check('A-① 页面可加载且暴露 recalc', !!(cfg && typeof cfg.recalc === 'function'));

function newPage() {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  p.onLoad();
  return p;
}

// ---- A 换算独立于毛利率（纠偏核心）----
const p1 = newPage();
p1.data.kind = 'bogo';
p1.data.show = { buy: true, free: true };
p1.data.rule = { buy: '2', free: '1' };
p1.data.marginPct = '';
p1.recalc();
const c1 = p1.data.conv;
check('A-② 🔴 毛利率为空，换算区仍出折扣（不被 return 卡住）',
  !!(c1 && c1.ok && String(c1.discountText).indexOf('6.67') >= 0), c1 && c1.discountText);
check('A-③ 推导式在场（中间数值看得见）', c1 && c1.formula === '2÷(2+1)', c1 && c1.formula);
check('A-④ 毛利率空 ⇒ 回本区 back=null（不显示假数）', p1.data.back === null);

// ---- B 回本对拍（Node 直推基准）----
p1.data.marginPct = '50';
p1.data.revenueYuan = '8000';
p1.data.avgPriceYuan = '200';
p1.recalc();
const b1 = p1.data.back;
check('B-① 回本区出数（有毛利率）', !!(b1 && b1.ok));
check('B-② 活动后毛利率 = 25%', b1 && b1.newMarginPct === 25, b1 && String(b1.newMarginPct));
check('B-③ 流水 = 16000 元', b1 && b1.revenueNeededYuan === 16000, b1 && String(b1.revenueNeededYuan));
check('B-④ 单量 40 → 120', b1 && b1.ordersNow === 40 && b1.ordersNeeded === 120,
  b1 && (b1.ordersNow + '→' + b1.ordersNeeded));
// R764：折扣不再先取整到 4 位，6.67 折的客流压力恢复到精确 +200%（原 199.94% 是舍入误差）
check('B-⑤ 客流压力 +200%（R764 精度修正，原 199.94 为舍入误差）',
  b1 && Math.abs(b1.trafficUpliftPct - 200) < 0.01,
  b1 && String(b1.trafficUpliftPct));

// ---- C 两段联动：换成满100减30 ----
p1.data.kind = 'threshold';
p1.data.show = { threshold: true, cut: true };
p1.data.rule = { threshold: '100', cut: '30' };
p1.recalc();
const c2 = p1.data.conv, b2 = p1.data.back;
check('C-① 换活动后折扣变 7 折', !!(c2 && c2.ok && String(c2.discountText).indexOf('7折') >= 0),
  c2 && c2.discountText);
check('C-② 推导式 = (100−30)÷100', c2 && c2.formula === '(100−30)÷100', c2 && c2.formula);
check('C-③ 回本跟着变：毛利 28.57%', b2 && Math.abs(b2.newMarginPct - 28.57) < 0.01,
  b2 && String(b2.newMarginPct));

// ---- D 反恒真：坏规则判红，且不污染旧结果 ----
p1.data.rule = { buy: '0', free: '1' };
p1.data.kind = 'bogo';
p1.recalc();
check('D-① 🔴 反恒真：买0送1 换算判红', p1.data.conv && p1.data.conv.ok === false);
check('D-② 坏规则时回本区清空（不沿用旧值）', p1.data.back === null);

console.log('\n==== 两段分离守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
