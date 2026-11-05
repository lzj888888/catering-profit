#!/usr/bin/env node
// review/evidence/r585_dsi_e2e/probe_real_xlsx.js —— R585
//
// 用**云函数真实的 xlsx 解析链**（service.js::bufferToMatrix → SheetJS）验证仓库里的样例文件。
//
// 为什么必须有这一步：
//   门禁 D4 用的是 python 读回的行数组（因为它读不了 xlsx），
//   而线上走的是 SheetJS。**两条读取路径可能给出不同的值** ——
//   实测就发现 SheetJS 把数字 cell 读成**字符串**（"12" 而不是 12）。
//   只有真走 bufferToMatrix，才知道"云函数眼里的这份表"长什么样。
//
// 运行（需要 xlsx 包，它只在云函数目录声明、根目录没装）：
//   mkdir -p /tmp/xlsxprobe && cd /tmp/xlsxprobe && npm i xlsx@0.18.5
//   NODE_PATH=/tmp/xlsxprobe/node_modules node review/evidence/r585_dsi_e2e/probe_real_xlsx.js
//
// 期望输出（2026-10-31 实测）：
//   S1 → dsi1_standard · 8 行 · 2 天 · 3 商品 · 952.00 元 · 小数 1 · 退款 1
//        分渠道 堂食 711.00 | 美团 184.00 | 淘宝闪购 57.00
//   S2 → dsi1_summary（**认得但不受理**，见 v1 契约 §S2）

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');

const S = require(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'));
const D = require(path.join(ROOT, 'cloudfunctions/importSalesBill/dsi1.js'));

let bad = 0;
for (const f of ['dsi1_s1_example.xlsx', 'dsi1_s2_example.xlsx']) {
  const p = path.join(ROOT, 'specs/dev-specs/core/examples', f);
  const m = S.bufferToMatrix(fs.readFileSync(p));
  const sn = Object.keys(m.sheets)[0];
  const rows = m.sheets[sn].rows;
  console.log('\n=== ' + f + ' | sheet=' + sn + ' | 行数 ' + rows.length);
  console.log('  首行: ' + JSON.stringify(rows[0]));
  console.log('  次行: ' + JSON.stringify(rows[1]));
  const shape = S.detectDishShape(rows);
  console.log('  shape = ' + JSON.stringify(shape));

  if (shape === 'dsi1_standard') {
    const r = D.parse(rows);
    if (!r.ok) { console.log('  ❌ parse 失败: ' + r.error); bad++; continue; }
    const s = r.summary;
    console.log('  ✅ 行 ' + s.rowCount + ' | 天 ' + s.dayCount + ' (' + s.dayFrom + '~' + s.dayTo + ') | 商品 ' + s.dishCount);
    console.log('     合计 ' + (s.totalAmountFen / 100).toFixed(2) + ' 元 | 小数行 ' + s.nonInt.length + ' | 退款行 ' + s.refunds.length);
    console.log('     分渠道 ' + Object.keys(s.byChannel).map((k) => k + '=' + (s.byChannel[k].amountFen / 100).toFixed(2)).join(' | '));
    if (s.rowCount !== 8 || s.totalAmountFen !== 95200) { console.log('  ❌ 数字与预期不符'); bad++; }
  } else if (shape === 'dsi1_summary') {
    console.log('  ✅ 认得 S2（v1 不受理，分发处会回人话理由）');
  } else {
    console.log('  ❌ 未识别'); bad++;
  }
}
console.log('\n' + (bad ? '❌ 失败 ' + bad + ' 项' : '✅ 全部符合预期'));
process.exit(bad ? 1 : 0);
