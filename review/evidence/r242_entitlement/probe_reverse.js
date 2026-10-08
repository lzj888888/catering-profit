// R242 · 用生产引擎算「建议挂牌价」对照表（只读，不写库）
// 引擎单源 = cloudfunctions/calcBom/service.js::calcReversePrice
const path = require('path');
const S = require(path.join(__dirname, '../../../cloudfunctions/calcBom/service.js'));

const cards = [
  { code: 'cc_muhz52um1mts', name: '鱼香肉丝', costFen: 1200 },
  { code: 'cc_muhznpgzd5ot', name: '炸鸡腿',   costFen: 2500 },
  { code: 'cc_muibc75r5q3j', name: '肥炸鸡腿', costFen: 48025 },
];
const margins = [50, 55, 60, 65];

console.log('引擎 = cloudfunctions/calcBom/service.js::calcReversePrice');
console.log('公式 = 成本 ÷ (1 − 目标毛利率/100)，round 到分（堂食口径，不含平台佣金）\n');

const line = '| 卡片 | 成本 | ' + margins.map(m => '毛利 ' + m + '%').join(' | ') + ' |';
console.log(line);
console.log('|' + '---|'.repeat(2 + margins.length));
for (const c of cards) {
  const cells = margins.map(m => {
    const fen = S.calcReversePrice(c.costFen, m);
    return (fen / 100).toFixed(2) + ' 元';
  });
  console.log('| ' + c.name + ' | ' + (c.costFen/100).toFixed(2) + ' 元 | ' + cells.join(' | ') + ' |');
}

console.log('\n--- 边界自检（证明引擎非恒真）---');
console.log('  毛利率 0   →', S.calcReversePrice(1200, 0), '(应 0 = 非法入参)');
console.log('  毛利率 100 →', S.calcReversePrice(1200, 100), '(应 0 = 非法入参)');
console.log('  成本 0     →', S.calcReversePrice(0, 60), '(应 0)');
console.log('  成本 1200/60% →', S.calcReversePrice(1200, 60), '(应 3000 = 30.00 元)');
