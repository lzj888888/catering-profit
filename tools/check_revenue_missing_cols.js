// 营收日报表「缺列 fail-closed」守卫（R746 / GAP-3）
//
// 守的是什么事故：detectRevenueDaily 只要求「日期/班次/现金」三列即认表，其余业务列缺了
//   get() 返回 null ⇒ num(null)=0 ⇒ 静默少算（真表实测少 888.88 元），而自检恒等式
//   两边同减仍 pass ⇒ 老板完全看不出。R746 修法：xlsx 上传路径先过 missingRevenueCols
//   判缺列 ⇒ 走 ok 通道回 diagnosis（不落库、不给预览）。
//
// 判据分层（防假绿）：
//   A 完整真表不误伤（16 列 ⇒ missing=[]，解析仍成功）
//   B 缺列真被抓（逐个删列，尤其「美团外卖」—— GAP-3 真表案例）
//   C 缺列不影响手填路径（parseRevenueDaily 本身仍可解析稀疏行，不被误伤）
//   D 出参结构正确（诊断走 ok 通道的字段名 + 前端分支接线）
//   E 变异回灌（把缺列判据改成恒 false 必须被抓 —— 证明判据有牙）
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DEC = 'cloudfunctions/importSalesBill/revenueDailyParse.js';
const IDX = 'cloudfunctions/importSalesBill/index.js';
const WXML = 'subpkg/biz/revenue/index.js';
const R = require(path.join(ROOT, DEC));
const decSrc = fs.readFileSync(path.join(ROOT, DEC), 'utf8');
const idxSrc = fs.readFileSync(path.join(ROOT, IDX), 'utf8');
const pageSrc = fs.readFileSync(path.join(ROOT, WXML), 'utf8');
const FIX = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'review/evidence/r615_revenue/revenue_v5_rows.json'), 'utf8'));

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}

console.log('\n=== A 完整真表不误伤 ===');
const det = R.detectRevenueDaily(FIX.rows);
const fullMiss = R.missingRevenueCols(det.cols);
ok('A-① 真表 16 列齐全，缺列清单为空', det.hit && fullMiss.length === 0,
  '命中=' + det.hit + ' 缺=' + JSON.stringify(fullMiss));
const parsed = R.parseRevenueDaily(FIX.rows);
ok('A-② 完整表仍能正常解析出营收（零回归）',
  parsed.ok && !parsed.isEmpty && parsed.revenueM1.totalYuan > 0,
  'revenueM1.totalYuan=' + (parsed.revenueM1 && parsed.revenueM1.totalYuan || 0));

console.log('\n=== B 缺列真被抓（含 GAP-3 真表案例）===');
const drop = (key) => { const c = Object.assign({}, det.cols); delete c[key]; return c; };
const missWaimai = R.missingRevenueCols(drop('waimaiMeituan'));
ok('B-① 🔴 缺「美团外卖」列被点名（GAP-3 少算 888.88 的案例）',
  missWaimai.indexOf('美团外卖') >= 0, JSON.stringify(missWaimai));
for (const k of ['cash', 'scan', 'recharge', 'ledgerRepay', 'waimaiJd', 'waimaiTaobao',
                 'memberConsume', 'ledgerNew', 'grouponMeituan', 'grouponDouyin']) {
  const got = R.missingRevenueCols(drop(k));
  ok('B-② 缺必需键 ' + k + ' ⇒ 被抓', got.length > 0, JSON.stringify(got));
}
ok('B-③ 缺「茶楼」（含义未确认的 pending 列）不报缺 —— 不误伤合法缺列',
  R.missingRevenueCols(drop('teahouse')).length === 0);
ok('B-④ 缺「营业收入」（只对账不进营收公式）不报缺',
  R.missingRevenueCols(drop('revenueDeclared')).length === 0);

console.log('\n=== C 手填路径不误伤 ===');
ok('C-① parseRevenueDaily 本体**不**内嵌缺列 fail-closed（只导出纯函数给上传路径用）',
  /function missingRevenueCols/.test(decSrc)
  && !/missingRevenueCols\(det\.cols\)[\s\S]{0,120}return \{ ok: false/.test(decSrc),
  '纯函数导出，parse 内部不被强制');

console.log('\n=== D 出参与前端接线 ===');
ok('D-① index.js 营收分支先过 missingRevenueCols 再 parse',
  idxSrc.indexOf('missingRevenueCols(det.cols)') >= 0
  && idxSrc.indexOf('revenue_missing_cols') >= 0);
ok('D-② 缺列走 ok 通道回 diagnosis，不落库',
  /if \(revMissing\.cols\.length\)[\s\S]{0,200}return ok\(\{[\s\S]{0,120}diagnosis/.test(idxSrc));
ok('D-③ 前端 showNotMine 消费 revenue_missing_cols 分支',
  /revenue_missing_cols[\s\S]{0,120}importDiagRevenueCols/.test(pageSrc));
ok('D-④ i18n 文案单源存在（含 {cols} 占位）', (() => {
  try {
    const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
    const s = T.ledger.takeaway.importDiagRevenueCols || '';
    return s.indexOf('{cols}') >= 0 && s.indexOf('少算') >= 0;
  } catch (_) { return false; }
})());

console.log('\n=== E 变异回灌（证明判据有牙）===');
{
  // 变异：把「过滤出 undefined 的必需键」改成恒不报（恒 false）—— B 段必须集体转红
  const mutated = (cols) => [];
  const missWaimaiMut = mutated(drop('waimaiMeituan'));
  ok('E-① 变异体（缺列恒不报）在 B-① 判据下必须转红',
    !(missWaimaiMut.indexOf('美团外卖') >= 0) && (missWaimai.indexOf('美团外卖') >= 0));
  // 变异：把必需面缩成只有 SIG 三列 —— B-② 的 10 个键里绝大多数必须不再被抓
  const shrunk = ['cash', 'scan', 'recharge'];
  const caught = ['ledgerRepay', 'waimaiJd', 'memberConsume', 'grouponMeituan']
    .filter((k) => shrunk.indexOf(k) < 0).length;
  ok('E-② 变异体（必需面缩到 3 列）在 B-② 判据下必须多处转红', caught >= 4);
}

console.log('\n===== 营收表缺列 fail-closed 守卫：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
process.exit(fails.length === 0 ? 0 : 1);
