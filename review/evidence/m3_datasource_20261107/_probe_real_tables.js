// 真跑生产解析器：三张真表分别被判成什么形态、什么渠道、多少量。
const fs = require('fs');
// 桩掉 xlsx（本地未装；本探针只用 JSON 行，不走文件解析）
const Module = require('module');
const _load = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'xlsx') return { read: () => ({}), utils: { sheet_to_json: () => [] } };
  return _load.call(this, req, parent, isMain);
};

const S = require('C:/Users/lzj/WorkBuddy/Claw/catering-profit/cloudfunctions/importSalesBill/service.js');

function load(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
const yuan = (fen) => (fen == null ? '-' : (fen / 100).toFixed(2));

function report(tag, rows, extra) {
  console.log('\n' + '='.repeat(78));
  console.log('[' + tag + '] 行数=' + rows.length + ' 列数=' + (rows[0] || []).length);
  const shape = S.detectDishShape(rows);
  console.log('  形态判定 =', shape === null ? 'null（→ 账单暂停路径）' : shape);
  if (extra) console.log('  平台判定 =', extra);
  let out = null;
  try {
    if (shape === S.DISH_SHAPES.A) out = S.parseDishSales(rows);
    else if (shape === S.DISH_SHAPES.C) out = S.parseDishSalesC(rows);
    else if (shape === S.DISH_SHAPES.D) out = S.parseDishSalesD(rows);
  } catch (e) {
    console.log('  解析异常 =', e.message);
  }
  if (!out) { console.log('  解析 = 未产出'); return; }
  const items = out.items || out.rows || out;
  console.log('  bizDate =', out.bizDate, '| periodFrom =', out.periodFrom,
    '| periodTo =', out.periodTo, '| granularity =', out.granularity);
  if (Array.isArray(items)) {
    const qty = items.reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const amt = items.reduce((s, x) => s + (Number(x.amountFen) || 0), 0);
    console.log('  产出 ' + items.length + ' 行 | qty 合计=' + Math.round(qty) + ' | amount 合计=' + yuan(amt) + ' 元');
    console.log('  首行 =', JSON.stringify(items[0] || null));
  }
  return out;
}

// 1) 收银后台《菜品销售统计》（订单分类=全部）
const tangshi = load('C:/Users/lzj/WorkBuddy/Claw/catering-profit/_probe_tmp/_tangshi.json');
console.log('【顶部参数行 R2】', String(tangshi[1][0]).slice(0, 200));
report('收银·菜品销售统计 tangshi.xlsx', tangshi);

// 2) 淘宝闪购·商品下载（形态 C 真样例）
const taobao = load('C:/Users/lzj/WorkBuddy/Claw/catering-profit/_probe_tmp/_taobaogoods.json');
report('淘宝闪购·商品下载 taobao_goods.xlsx', taobao);

// 3) 京东秒送·结算对账单（82 列）
const jd = load('C:/Users/lzj/WorkBuddy/Claw/catering-profit/_probe_tmp/_jdk.json');
report('京东·结算对账单 jd_order.xlsx', jd);
