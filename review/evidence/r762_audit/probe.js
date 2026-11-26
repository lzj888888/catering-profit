#!/usr/bin/env node
// R762 专项审计探针：独立重算，不复用被测模块的内部结论。
// 运行：node review/evidence/r762_audit/probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const PC = require(path.join(ROOT, 'utils/promoCalc.js'));

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  OK  ' + name + '  [' + detail + ']'); }
  else { fail++; console.log('  NG  ' + name + '  [' + detail + ']'); }
}
const sec = (s) => console.log('\n=== ' + s + ' ===');

// ---------- 1. 独立重算（审计方自己写公式，只与被测输出比对） ----------
sec('1 独立重算：G1 / 流水倍数 / 客流倍数 / 反算折扣');
{
  const g0 = 50, d = 0.625, rev = 8000, price = 200;
  const discPct = (1 - d) * 100;                 // 37.5? 不：1-0.625=0.375 → 37.5%
  // 正确口径：G1 = (G0 - 折扣率)/d = (50-37.5)/0.625 = 20
  const g1 = (g0 - discPct) / d;
  const revMul = g0 / g1;                        // 2.5
  const trafMul = g0 / (g0 - discPct);           // 50/12.5 = 4
  const r = PC.promoCalc({ marginPct: g0, discount: d, revenueYuan: rev, avgPriceYuan: price });
  chk('1-① 活动后毛利率 =20%', r.ok && Math.abs(r.newMarginPct - g1) < 0.02, '独立=' + g1 + ' 模块=' + r.newMarginPct);
  chk('1-② 流水倍数 =2.5（8000→20000）', Math.abs(r.revenueMultiple - revMul) < 0.02 && Math.abs(r.revenueNeededYuan - 20000) < 1,
    '独立=' + revMul + ' 模块=' + r.revenueMultiple + ' / ' + r.revenueNeededYuan);
  chk('1-③ 客流倍数 =4（40→160单）', Math.abs(r.trafficMultiple - trafMul) < 0.02 && r.ordersNeeded === 160,
    '独立=' + trafMul + ' 模块=' + r.trafficMultiple + ' / ' + r.ordersNeeded);
  // 反算：d=(100-G0)/(100-G1)，独立算 50/80=0.625
  const dIndep = (100 - 50) / (100 - 20);
  const rv = PC.reverseFromMargin({ marginPct: 50, targetMarginPct: 20, revenueYuan: rev, avgPriceYuan: price });
  chk('1-④ 反算折扣 =0.625（6.25折）', rv.ok && Math.abs(rv.discount - dIndep) < 1e-6,
    '独立=' + dIndep + ' 模块=' + rv.discount);
  chk('1-⑤ 反算与正算闭环（流水/单量一致）',
    rv.ok && Math.abs(rv.revenueNeededYuan - r.revenueNeededYuan) < 0.01 && rv.ordersNeeded === r.ordersNeeded,
    '反=' + rv.revenueNeededYuan + '/' + rv.ordersNeeded + ' 正=' + r.revenueNeededYuan + '/' + r.ordersNeeded);
}

// ---------- 2. 满 X 减 Y 的客单价缺口（页面是否填得到 avgPrice） ----------
sec('2 满减：等效折扣依赖客单价，页面能否填进去？');
{
  const wxml = fs.readFileSync(path.join(ROOT, 'subpkg/tools/promo/index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'subpkg/tools/promo/index.js'), 'utf8');
  const hasInput = /data-f="avgPrice"/.test(wxml);
  const showBlock = /threshold:\s*\{[^}]*\}/.exec(js);
  chk('2-① 页面存在客单价输入 data-f="avgPrice"', hasInput, hasInput ? '有' : '没有');
  chk('2-② showOf(threshold) 暴露 avgPrice 输入', !!showBlock && /avgPrice/.test(showBlock[0]), (showBlock && showBlock[0]) || '未解析到');
  // 页面实际传参形态：rule 里没有 avgPrice ⇒ 恒按门槛算
  let cfg = null;
  global.Page = (c) => { cfg = c; }; global.wx = {};
  require(path.join(ROOT, 'subpkg/tools/promo/index.js'));
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { Object.assign(this.data, patch); };
  p.onLoad();
  p.data.kind = 'threshold';
  p.data.rule = { threshold: '100', cut: '30' };   // 老板只能填这两个
  p.recalc();
  const got = p.data.conv.discountText;
  const indep150 = 1 - 30 / 150;                    // 客单 150 的真实等效折扣 = 0.8
  chk('2-③ 页面算出的折扣 = 客单150时应有的8折', got === '8折', '页面=' + got + ' / 客单150独立算=' + (indep150 * 10) + '折');
  const withAvg = PC.discountOf('threshold', { threshold: 100, cut: 30, avgPrice: 150 });
  chk('2-④ 引擎支持 avgPrice（差异在页面未接线，不在算法）', Math.abs(withAvg.d - 0.8) < 1e-6, '引擎传150时=' + withAvg.d);
  const note = PC.discountOf('threshold', { threshold: 100, cut: 30, avgPrice: 80 }).note;
  chk('2-⑤ below_threshold 提示在页面可达（rule 里能出现 avgPrice）',
    note === 'below_threshold' && /avgPrice/.test(JSON.stringify(cfg.data.rule)),
    '引擎note=' + note + ' / 页面rule字段=' + Object.keys(cfg.data.rule).join(','));
}

// ---------- 3. 精度：买2送1 的展示 ----------
sec('3 精度：round4 折扣经 round2 折扣率后的累计误差');
{
  const cv = PC.promoConvert('bogo', { buy: 2, free: 1 });
  const r = PC.promoCalc({ marginPct: 50, discount: cv.discount });
  const dExact = 2 / 3;
  const g1True = (50 - (1 - dExact) * 100) / dExact;   // =25
  const upliftTrue = (50 / (50 - (1 - dExact) * 100) - 1) * 100; // =200%
  chk('3-① 买2送1 活动后毛利率精确值 25%，模块值接近', Math.abs(r.newMarginPct - g1True) < 0.05,
    '精确=' + g1True + ' 模块=' + r.newMarginPct);
  chk('3-② 买2送1 客流增幅精确 +200%，模块误差 <0.5pp', Math.abs(r.trafficUpliftPct - upliftTrue) < 0.5,
    '精确=' + upliftTrue + '% 模块=' + r.trafficUpliftPct + '%');
}

// ---------- 4. 底色对比度独立重算（R760 换底后旧注释是否仍成立） ----------
sec('4 底色对比度：R760 换 #F7F2E6 后逐个重算');
{
  function lum(hex) {
    const v = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255)
      .map((c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function ratio(a, b) {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  const oldBg = '#F6F3EC', newBg = '#F7F2E6', card = '#FFFDF8';
  for (const fg of ['#9a5c06', '#b45309', '#a16207']) {
    const ro = ratio(fg, oldBg), rn = ratio(fg, newBg), rc = ratio(fg, card);
    console.log('  ' + fg + ' 旧底=' + ro.toFixed(2) + ' 新底=' + rn.toFixed(2) + ' 卡面=' + rc.toFixed(2));
  }
  const rn = ratio('#9a5c06', newBg);
  chk('4-① 换底后 #9a5c06 仍在页面底过 WCAG AA 4.5', rn >= 4.5, '新底=' + rn.toFixed(3));
  // 注释里写的 4.85:1 是针对旧底；新底值是否仍然准确登记？
  const note = fs.readFileSync(path.join(ROOT, 'subpkg/biz/takeaway/index.wxss'), 'utf8');
  chk('4-② 注释已更新到新底色口径', !note.includes('#F6F3EC'), note.includes('#F6F3EC') ? '仍写旧底 #F6F3EC' : '已更新');
}

console.log('\n==== R762 独立探针：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail === 0 ? 0 : 1);
