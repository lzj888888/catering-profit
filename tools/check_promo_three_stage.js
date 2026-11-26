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

sec('D R763 满减客单价接线（R762 审计 P0：页面曾恒显示 7 折）');
{
  const p = makePage();
  p.data.kind = 'threshold';
  p.data.rule = { threshold: '100', cut: '30', avgPrice: '150' };
  p.recalc();
  ok('D-① 满100减30 + 客单150 ⇒ 8折（不是页面旧行为恒7折）',
    p.data.conv.ok && p.data.conv.discountText === '8折', p.data.conv.discountText);
  ok('D-② 推导式分母随客单价变：(150−30)÷150',
    p.data.conv.formula === '(150−30)÷150', p.data.conv.formula);

  const p2 = makePage();
  p2.data.kind = 'threshold';
  p2.data.rule = { threshold: '100', cut: '30', avgPrice: '200' };
  p2.recalc();
  ok('D-③ 客单200 ⇒ 8.5折（误差随客单漂移，必须跟输入走）',
    p2.data.conv.ok && p2.data.conv.discountText === '8.5折', p2.data.conv.discountText);

  const p3 = makePage();
  p3.data.kind = 'threshold';
  p3.data.rule = { threshold: '100', cut: '30' };
  p3.recalc();
  ok('D-④ 不填客单 ⇒ 7折 + 提示按门槛100元估算（不冒充真实折扣）',
    p3.data.conv.ok && p3.data.conv.discountText === '7折'
      && /按门槛/.test(p3.data.conv.noteText) && /100/.test(p3.data.conv.noteText),
    JSON.stringify({ d: p3.data.conv.discountText, n: p3.data.conv.noteText }));

  const p4 = makePage();
  p4.data.kind = 'threshold';
  p4.data.rule = { threshold: '100', cut: '30', avgPrice: '80' };
  p4.recalc();
  ok('D-⑤ 客单80<门槛 ⇒ 7折 + 低于门槛提示在页面路径真可达',
    p4.data.conv.ok && p4.data.conv.discountText === '7折'
      && /没到门槛/.test(p4.data.conv.noteText), p4.data.conv.noteText);

  // 两段独立：第二段的 avgPriceYuan 不许串味到第一段（填错位置不能假准）
  const p5 = makePage();
  p5.data.kind = 'threshold';
  p5.data.rule = { threshold: '100', cut: '30' };
  p5.data.avgPriceYuan = '150';
  p5.recalc();
  ok('D-⑥ 第二段客单不串味到第一段',
    p5.data.conv.discountText === '7折' && /未填客单价/.test(p5.data.conv.noteText),
    p5.data.conv.discountText + '/' + p5.data.conv.noteText);

  ok('D-⑦ wxml 真有手填客单价框 + 口径提示上屏（引擎支持不算接线）',
    pw.indexOf('data-f="avgPrice"') >= 0 && pw.indexOf('conv.noteText') >= 0);
}

sec('E R759 丢数形态防回潮（R762 变异 M5：两次 setData 原守卫抓不到）');
{
  const src = fs.readFileSync('subpkg/tools/promo/index.js', 'utf8');
  const m = /recalc\(\)\s*\{([\s\S]*?)\n  \},/.exec(src);
  const body = m ? m[1] : '';
  const calls = (body.match(/this\.setData\s*\(/g) || []).length;
  ok('E-① recalc 内仅一次 setData（R759 真机丢数形态不许回潮）', calls === 1, '实际 ' + calls + ' 次');
  ok('E-② 这一次 setData 同时落 conv/back/reverse（三段同帧，不许拆回调）',
    /setData\s*\(\s*\{[\s\S]*?conv:[\s\S]*?back:[\s\S]*?reverse:/.test(body), body.slice(-160));
}

console.log('\n==== 三段分离守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
