// 用【真 xlsx 0.18.5】跑端到端（守卫里是桩，这里补真库证据）
// 运行：NODE_PATH=<装了 xlsx 的目录> node review/evidence/r615_encoding/probe_with_real_xlsx.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const S = require(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'));

function show(tag, file) {
  const buf = fs.readFileSync(file);
  const dec = S.decodeTextBuffer(buf);
  const mtx = S.bufferToMatrix(buf);
  const name = Object.keys(mtx.sheets)[0];
  const det = S.detectDishMatrix(mtx);
  console.log('\n[' + tag + '] ' + path.basename(file));
  console.log('  编码嗅探   =', dec ? dec.encoding : 'binary(xlsx/xls)');
  console.log('  sheet      =', JSON.stringify(Object.keys(mtx.sheets)));
  console.log('  R1 前 6 列 =', JSON.stringify((mtx.sheets[name].rows[0] || []).slice(0, 6)));
  console.log('  形态       =', det.shape === null ? 'null（→ 账单路径）' : det.shape);
  return { mtx, det, name };
}

// 1) 真 GBK 美团商品表
const mt = show('美团商品表 GBK', path.join(ROOT, 'review/evidence/r242_mt_goods/mt_goods_20260907_20260913.csv'));
if (mt.det.shape === S.DISH_SHAPES.C) {
  const out = S.parseDishSalesC(mt.mtx.sheets[mt.name].rows, {});
  const g = out.groups || [];
  const rows = g.reduce((s, x) => s + x.rows.length, 0);
  const qty = g.reduce((s, x) => s + x.rows.reduce((a, r) => a + r.qty, 0), 0);
  const amt = g.reduce((s, x) => s + x.rows.reduce((a, r) => a + r.amountFen, 0), 0);
  console.log('  解析       = ' + g.length + ' 组 / ' + rows + ' 行 / qty ' + qty + ' / ' + (amt / 100).toFixed(2) + ' 元');
  console.log('  日期组     = ' + g.map((x) => x.bizDate).join(', '));
  console.log('  0 元商品   = ' + JSON.stringify(out.zeroAmountQty || []));
}

// 2) 回归：淘宝 xlsx 商品表
const tb = show('淘宝商品表 xlsx', path.join(ROOT, '_probe_tmp/taobao_goods.xlsx'));
// 3) 回归：收银菜品表 xlsx
show('收银菜品销售统计 xlsx', 'C:/Users/lzj/Desktop/tangshi.xlsx');
// 4) 回归：京东对账单 xlsx
show('京东结算对账单 xlsx', path.join(ROOT, '_probe_tmp/jd_order.xlsx'));
