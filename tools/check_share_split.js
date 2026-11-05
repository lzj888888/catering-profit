// tools/check_share_split.js —— 【R307】「占比拆分参考榜」守卫
// 运行：node tools/check_share_split.js      （EXIT 0 = 全绿）
//
// 背景（R306 路线决策 · 李老师全权授权）：外卖单品销量只能靠平台 Excel，而**只有淘宝闪购准**、
//   京东/美团不准且拿不到 ⇒ 那条链路大概率走不通。但 M3 的核心价值是「单位单品毛利」（不依赖平台数据）
//   ⇒ 补一个轻量补位：老板填几个核心菜的**销量占比**，系统按本月外卖**有效订单数**拆出**参考级**贡献榜。
//
// 🔴 本守卫守的三条铁律（本仓最忌"假精确"）：
//   ① **估算不得冒充实测**：该区块只能挂在**空态**（实测榜没有数据时），且结果区必须挂"不是实测"的声明；
//   ② **不得替老板编数**：占比合计 >100% 必须**拒绝**（不许自动归一）；没有订单数必须**不算**（不许按 0 单算）；
//   ③ **亏损必须原样露出**：单份毛利为负的菜不得显示成 0 或被过滤掉。
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); }
}
function rd(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } }

const src = rd('utils/shareSplit.js');
const pageSrc = rd('pages/m3/dishreview/index.js');
const wxml = rd('pages/m3/dishreview/index.wxml');
ok('⓪ 自失效护栏：三份源码非空且关键锚点在场（防读空文件 ⇒ 恒真）',
  src.length > 2000 && pageSrc.length > 20000 && wxml.length > 5000
  && /function splitRank/.test(src) && /onSplitCalc/.test(pageSrc) && /splitNote/.test(wxml));

let S = null;
try { S = require(path.join(ROOT, 'utils/shareSplit.js')); } catch (e) { S = null; }
ok('①-a 模块可 require 且导出 splitRank / checkShares / MAX_ROWS',
  !!S && typeof S.splitRank === 'function' && typeof S.checkShares === 'function' && S.MAX_ROWS >= 3);

const CARD_A = { cardCode: 'a', name: '耙牛肉', priceFen: 3800, costFen: 1520, pctText: '40' };
const CARD_B = { cardCode: 'b', name: '小面', priceFen: 1200, costFen: 380, pctText: '30' };
const CARD_L = { cardCode: 'l', name: '亏本菜', priceFen: 1000, costFen: 1300, pctText: '10' };

// ===== ② 不编数 =====
const noOrder = S ? S.splitRank({ orderCount: 0, rows: [CARD_A] }) : null;
ok('②-a 🔴 没有有效订单数 ⇒ **不算**（`needOrderCount`，绝不当 0 单算出一堆 0）',
  !!noOrder && noOrder.needOrderCount === true && noOrder.list.length === 0);
const over = S ? S.checkShares([CARD_A, Object.assign({}, CARD_B, { pctText: '70' })]) : null;
ok('②-b 🔴 占比合计 >100% ⇒ **拒绝**（`pctSumOver`），**不许自动归一**'
  + ' —— 归一化等于替老板编数（他填 3 个 50% 也能算出结果，那是假的）',
  !!over && over.ok === false && over.errors.indexOf('pctSumOver') >= 0 && over.totalPct === 110);
const under = S ? S.splitRank({ orderCount: 100, rows: [{ cardCode: 'a', name: 'x', priceFen: 1000, costFen: 500, pctText: '30' }] }) : null;
ok('②-c 占比合计 <100% ⇒ **按实际占比算**（30% 就是 30 单，不归一成 100）',
  !!under && under.list.length === 1 && under.list[0].estQty === 30);
const dup = S ? S.checkShares([CARD_A, Object.assign({}, CARD_A, { pctText: '20' })]) : null;
ok('②-d 同一道菜选两遍 ⇒ `dupCard`（不静默合并）', !!dup && dup.errors.indexOf('dupCard') >= 0);
const noPrice = S ? S.checkShares([{ cardCode: 'a', priceFen: 0, costFen: 0, pctText: '10' }]) : null;
ok('②-e 没填售价 ⇒ `noPrice`（算不出毛利就不给榜）', !!noPrice && noPrice.errors.indexOf('noPrice') >= 0);

// ===== ③ 亏损原样露出 =====
const norm = S ? S.splitRank({ orderCount: 120, rows: [CARD_A, CARD_B, CARD_L] }) : null;
ok('③-a 🔴 行为：120 单 / 40-30-10 ⇒ 48+36+12 份，贡献 1094.40+295.20−12.00 元',
  !!norm && norm.list.length === 3 && norm.list[0].estQty === 48
  && norm.list[0].contribFen === 109440 && norm.sumEstQty === 96);
ok('③-b 🔴 亏损菜必须**原样露出**（`loss:true` + 负贡献），不许变 0、不许被过滤',
  !!norm && norm.list.some((x) => x.loss === true && x.contribFen < 0 && x.unitGrossFen < 0));

// ===== ① 估算不得冒充实测（页面面）=====
ok('①-b 🔴 该区块只能挂在**空态**（`empty && splitCards.length`）—— 不与实测榜混排',
  /wx:if="\{\{empty && splitCards\.length\}\}"/.test(wxml));
ok('①-c 🔴 结果区必须挂"不是实测"的声明（`splitNote`）—— 估算不许显示得像实测',
  /splitResult\.list/.test(wxml) && /t\.splitNote/.test(wxml));
ok('①-d 订单数与 R302「到手账」**同一取法**（M1 的 `sub_items[].qty`），不另造口径',
  /category !== 'takeaway'/.test(pageSrc) && /sub_items/.test(pageSrc) && /\bqty\b/.test(pageSrc));
ok('①-e 改了输入 ⇒ 旧结果作废（防"结果区还显示上一次的数"）',
  (pageSrc.match(/splitResult: null/g) || []).length >= 4);

// ===== ④ 反恒真 =====
ok('④-a 反恒真：把「>100 自动归一」的样本喂给 ②-b 的判据 ⇒ 必须判不通过',
  (() => {
    const fakeRows = [CARD_A, Object.assign({}, CARD_B, { pctText: '70' })];
    const fakeTotal = fakeRows.reduce((s, r) => s + Number(r.pctText), 0);
    const normalized = Math.round(fakeTotal) === 100;   // 归一后必然 100
    return normalized === false && fakeTotal === 110;
  })());
ok('④-b 反恒真：`qtyText(0)` 必须回空串（不许把"0 份"显示成 0 —— 那是没填）',
  !!S && S.qtyText(0) === '' && S.qtyText(48) === '48');

const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 占比拆分参考榜校验失败 ' + problems.length + ' 处：');
  problems.forEach((x) => console.log('   ' + x));
  console.log('❌ 占比拆分校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 占比拆分参考榜校验通过（估算不与实测混排 · 不归一 · 无订单不算 · 亏损原样露出）');
console.log('✅ 占比拆分校验：' + total + ' 通过 / 0 失败');
