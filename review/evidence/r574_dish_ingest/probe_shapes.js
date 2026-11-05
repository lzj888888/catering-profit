/**
 * R574 · 菜品明细采集通道实测（用真样例跑现有解析器，不看注释）
 *
 * 打擂方式：加载 `cloudfunctions/importSalesBill/service.js`（真实生产解析器），
 * 把 xlsx 转出的矩阵喂进去 —— 「能不能认、能出几行」由返回值裁定，不是由文档裁定。
 * ⚠️ `xlsx` 是 Electron/GUI 侧依赖，在纯 node 里没有 ⇒ 打桩（本脚本不解析 xlsx，
 *   矩阵由 `xlsx_to_matrix.py` 产出，那条路径不经过 xlsx 模块）。
 */
const Module = require('module');
const orig = Module._load;
Module._load = function (req) {
  if (req === 'xlsx') return { read: () => { throw new Error('stub'); }, utils: {} };
  return orig.apply(this, arguments);
};

const fs = require('fs');
const path = require('path');
const S = require(path.resolve(__dirname, '../../../cloudfunctions/importSalesBill/service.js'));

const MATRIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'matrix.json'), 'utf8'));

// 形态 → 对应的解析函数（与 index.js 的落库分流保持一致）
const PARSER = {
  dish_sales: 'parseDishSales',
  waimai_goods: 'parseDishSalesC',
  jd_order_export: 'parseDishSalesD',
  combo_detail: null, // 🔴 形态 B 主动不解析（index.js:206 直接 fail），故无对应函数
};

function rowsOfShape(data, shape) {
  // detectDishMatrix 需要 { sheets: { name: { rows } } } 形态
  const sheets = {};
  for (const nm of Object.keys(data.sheets)) {
    const sh = data.sheets[nm];
    if (!sh.rows) continue;
    sheets[nm] = { rows: sh.rows };
  }
  const fnName = PARSER[shape];
  if (!fnName) return { rows: [], skipped: true, reason: '该形态无解析函数（设计上不入库）' };
  const rows = sheets[Object.keys(sheets)[0]].rows;
  try {
    const out = S[fnName](rows, {});
    return {
      rows: (out && out.rows) || [],
      totals: (out && out.totals) || {},
      groups: (out && out.groups) || [],
      shapeTag: (out && out.shape) || '',
    };
  } catch (e) {
    return { rows: [], error: String(e.message).split('\n')[0] };
  }
}

function pickSheetFor(data, shape) {
  // 逐 sheet 试，找出**第一个**能判成该形态的 sheet（跟 detectDishMatrix 一致）
  for (const nm of Object.keys(data.sheets)) {
    const sh = data.sheets[nm];
    if (!sh.rows) continue;
    if (S.detectDishShape(sh.rows) === shape) return nm;
  }
  return '';
}

console.log('='.repeat(74));
console.log('R574 · 菜品明细通道实测（%s）', new Date().toISOString().slice(0, 10));
console.log('='.repeat(74));

for (const tag of Object.keys(MATRIX)) {
  const data = MATRIX[tag];
  if (data.error) { console.log('\n%-12s ❌ %s' % 0 ? 0 : tag, data.error); continue; }
  console.log('\n【%s】%s', tag, path.basename(data.path));
  const sheets = {};
  for (const nm of Object.keys(data.sheets)) {
    if (data.sheets[nm].rows) sheets[nm] = { rows: data.sheets[nm].rows };
  }
  const det = S.detectDishMatrix({ sheets });
  if (!det.shape) {
    console.log('   判定：❌ 未识别为任何菜品形态（shape=null）');
    continue;
  }
  const sheetNm = pickSheetFor(data, det.shape);
  const sh = sheets[sheetNm] || { rows: [] };
  let out;
  const fnName = PARSER[det.shape];
  if (!fnName) {
    out = { rows: [], skipped: true };
  } else {
    try {
      const r = S[fnName](sh.rows, {});
      out = { rows: r.rows || [], totals: r.totals || {}, groups: r.groups || [] };
    } catch (e) {
      out = { rows: [], error: String(e.message).split('\n')[0] };
    }
  }
  console.log('   判定形态：%s   sheet=%s', det.shape, sheetNm || '(无)');
  if (out.skipped) {
    console.log('   解析结果：⚠️ 无解析函数 —— 生产代码对该形态直接 fail 拒收（不入库）');
  } else if (out.error) {
    console.log('   解析结果：❌ 抛错 %s', out.error);
  } else {
    const t = out.totals || {};
    console.log('   解析结果：✅ 出 %d 行  Σ销量=%s  Σ金额(分)=%s  分组(天)=%d',
      out.rows.length, t.qty, t.amountFen, (out.groups || []).length);
    if (out.rows.length) {
      const r0 = out.rows[0];
      console.log('   首行：%s', JSON.stringify({
        bizDate: r0.bizDate, name: r0.name, dishKey: r0.dishKey, qty: r0.qty, amountFen: r0.amountFen,
      }));
    }
  }
}
