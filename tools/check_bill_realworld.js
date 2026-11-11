// tools/_r695_bill_realworld.js —— R695：用「豆包生成的真实风格账单」实测 M3 识别能力
//
// 与现有 selftest_bill_parse 的区别（互补，不替代）：
//   现有测试用的是**手写黄金样本** + 精确断言（156 行 / 3779.65 元）——它证明"算得对"；
//   本脚本用的是**外部生成的真实排版**——它回答"真实账单喂进来认不认得出"。
//   前者防回归，后者找盲区。
//
// 数据来源：豆包按「美团外卖商家后台导出」的样式生成，混入了真实账单里必然出现的
//   广告推广行 / 商家保险行 / 已退款行 —— 这三类正是"筛错就全错"的关键。
const fs = require('fs');
const path = require('path');
const BP = require(path.join(__dirname, '../utils/billParse.js'));

// R695：样本已固化进仓（不再依赖 .dsh 临时文件）—— 否则远端/WSL 复现不出这条测试。
const SRC = process.env.BILL_SRC
  || path.join(__dirname, '..', 'review', 'evidence', 'r695_realworld', 'meituan_doubao.txt');
const raw = fs.readFileSync(SRC, 'utf8');

// 只取表格部分（到第一个非表格行/答案行之前）
const lines = raw.split(/\r?\n/).filter((l) => l.trim() && l.indexOf('CORRECT_') < 0 && l.indexOf('WRONG_') < 0);
const matrix = lines.map((l) => l.split('\t'));
// 🔴 关键：parseBillMatrix 吃的是**多 sheet 结构**（模拟从 Excel 读进来的样子），
//   不是裸二维数组。首版我直接传了数组 ⇒ `matrix.sheets` 为 undefined ⇒ allRows=[] ⇒
//   全 0，我还以为解析器筛不出行。**是测试方式错，不是产品错。**
const book = { sheets: { [BP.PLATFORM_PROFILE.meituan.sheet]: { rows: matrix } } };


let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
};

// 「输入」段也要有断言（R66：段标题下零断言会被判"静默未跑"）
ok('样本文件存在且行数合理（含表头 > 5 行）', matrix.length > 5, '行数=' + matrix.length);
ok('表头含美团签名列「商家应收款」', (matrix[0] || []).indexOf('商家应收款') >= 0, JSON.stringify(matrix[0]));

console.log('\n===== ① 平台能不能认出来 =====');
const p1 = BP.detectPlatform(matrix[0]);
ok('按列名识别出平台 = meituan', p1 === 'meituan', 'got ' + String(p1));

const p2 = BP.detectPlatformInMatrix ? BP.detectPlatformInMatrix(book) : null;
// ⚠️ 首版这里拿字符串比，跑出来是红的 —— 但它返回的是对象 {platform, headerRow, sheet}，
//    功能正常、是我的断言类型写错（今天第 N 次同类：断言比实现更容易写错）。
ok('整表自动判定也能认出（detectPlatformInMatrix 返回 {platform,headerRow,sheet}）',
  !!(p2 && p2.platform === 'meituan'), 'got ' + JSON.stringify(p2));

console.log('\n===== ② 数字认不认得出 =====');
const r = BP.parseBillMatrix(book, { platform: 'meituan' });
console.log('  解析结果:', JSON.stringify({ amountFen: r.totals.amountFen, qty: r.totals.qty, rowCount: r.totals.rowCount, months: r.months }));

// 豆包给的答案 + 我手工复核过：328.30 元 / 13 单
ok('外卖收入 = 328.30 元（32830 分）', r.totals.amountFen === 32830, 'got ' + r.totals.amountFen);
ok('有效订单数 = 13（不含 2 笔已退款）', r.totals.qty === 13, 'got ' + r.totals.qty);
ok('归月含 2026-08', (r.months || []).indexOf('2026-08') >= 0, JSON.stringify(r.months));

console.log('\n===== ③ 关键：非外卖行有没有被混进来 =====');
// 这是最要命的错法：把广告/保险一起加进去 ⇒ 220.80（少收 107.50）
ok('没有把广告推广/商家保险算进收入（金额 ≠ 22080 分）', r.totals.amountFen !== 22080,
  '全部相加会是 22080；实际 ' + r.totals.amountFen);
ok('没有把已退款订单算成有效单（qty ≠ 15）', r.totals.qty !== 15, 'got ' + r.totals.qty);

console.log(`\n==== 真实账单实测：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
