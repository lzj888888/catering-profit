#!/usr/bin/env node
// check_promo_three_stage.js —— R761 活动测算「三段分离」守卫（页面桩真跑 recalc，不依赖 IDE）
// 承 R759 的 check_promo_two_stage.js（两段），本守卫守第三段 + 代金券口径纠偏 + 限用提示。
// 纪律：机器真跑页面源码 + 反恒真，不靠肉眼看、不采信自述。
const fs = require('fs');

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---- 页面桩：加载 promo/index.js 的 Page 配置 ----
let cfg = null;
global.Page = (c) => { cfg = c; };
global.wx = {};
require('../subpkg/tools/promo/index.js');
const pw = fs.readFileSync('subpkg/tools/promo/index.wxml', 'utf8');

function makePage() {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { Object.assign(this.data, patch); };
  p.onLoad();
  return p;
}

sec('A 代金券口径纠偏（R761：face=实付，80代100=8折不是2折）');
{
  const p = makePage();
  p.data.kind = 'voucher';
  p.data.rule = { face: '80', threshold: '100', limit: '2' };
  p.recalc();
  const cv = p.data.conv;
  ok('A-① 80代100 ⇒ 8折（不是2折）', cv.ok && cv.discountText === '8折', cv.discountText);
  ok('A-② 推导式 80÷100', cv.formula === '80÷100', cv.formula);
  ok('A-③ 限用2张 ⇒ 提示满200（不改折扣）',
    cv.limitInfo && cv.limitInfo.count === 2 && cv.limitInfo.maxSpend === 200,
    JSON.stringify(cv.limitInfo));
  ok('A-④ 页面把 limitInfo 提示接上了', pw.indexOf('conv.limitInfo.maxSpend') >= 0);

  const p2 = makePage();
  p2.data.kind = 'voucher';
  p2.data.rule = { face: '70', threshold: '100' }; // 满100减30
  p2.recalc();
  ok('A-⑤ 实付70/抵额100 ⇒ 7折', p2.data.conv.ok && p2.data.conv.discountText === '7折',
    p2.data.conv.discountText);
}

sec('B 第三段：填活动后毛利率反算（李老师原话）');
{
  const p = makePage();
  p.data.marginPct = '50';
  p.data.targetMarginPct = '20';
  p.data.revenueYuan = '8000';
  p.data.avgPriceYuan = '200';
  p.recalc();
  const r = p.data.reverse;
  ok('B-① 50%→20% 反算 6.25折', r && r.ok && r.discountText === '6.25折', r && r.discountText);
  ok('B-② 流水×2.5 / 单量×4 / 流水20000 / 单量40→160',
    r && r.ok && Math.abs(r.revenueMultiple - 2.5) < 0.01 && Math.abs(r.trafficMultiple - 4) < 0.01
      && Math.abs(r.revenueNeededYuan - 20000) < 0.01 && r.ordersNow === 40 && r.ordersNeeded === 160,
    r && r.ok ? (r.revenueMultiple + '/' + r.trafficMultiple + '/' + r.revenueNeededYuan) : (r && r.reason));
  ok('B-③ 第三段结果接在页面上（折扣/流水/单量/客流）',
    pw.indexOf('reverse.discountText') >= 0 && pw.indexOf('reverse.revenueNeededYuan') >= 0
      && pw.indexOf('reverse.ordersNeeded') >= 0 && pw.indexOf('reverse.trafficUpliftPct') >= 0);
}

sec('C 三段彼此独立 + 反恒真');
{
  // 只填活动规则，不填毛利率 ⇒ 第一段有数、二三段为空（互不拖累）
  const p = makePage();
  p.data.kind = 'bogo';
  p.data.rule = { buy: '2', free: '1' };
  p.recalc();
  ok('C-① 只填活动 ⇒ 换算有数、back/reverse 都空（三段独立）',
    p.data.conv.ok && p.data.conv.discountText === '6.67折' && p.data.back === null && p.data.reverse === null,
    JSON.stringify({ conv: p.data.conv.ok, back: p.data.back, reverse: p.data.reverse }));

  // 只填两个毛利率，不填活动 ⇒ 第三段仍出数（不依赖活动规则）
  const p2 = makePage();
  p2.data.marginPct = '50';
  p2.data.targetMarginPct = '20';
  p2.recalc();
  ok('C-② 只填毛利率 ⇒ 第三段出数且不依赖活动规则',
    p2.data.reverse && p2.data.reverse.ok && p2.data.conv.ok === false,
    p2.data.reverse && (p2.data.reverse.ok ? 'ok' : p2.data.reverse.reason));

  // 反恒真：目标毛利率没降 ⇒ 第三段判红，不给假数
  const p3 = makePage();
  p3.data.marginPct = '50';
  p3.data.targetMarginPct = '50';
  p3.recalc();
  ok('C-③ 🔴 反恒真：活动后毛利率没降 ⇒ reverse.ok=false',
    p3.data.reverse && p3.data.reverse.ok === false,
    p3.data.reverse && p3.data.reverse.reason);

  // 反恒真：代金券实付>抵额 ⇒ 第一段判红
  const p4 = makePage();
  p4.data.kind = 'voucher';
  p4.data.rule = { face: '120', threshold: '100' };
  p4.recalc();
  ok('C-④ 🔴 反恒真：实付>抵额 ⇒ conv.ok=false', p4.data.conv.ok === false);
}

console.log('\n==== 三段分离守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
