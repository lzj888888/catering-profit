// P0-3 自测：isEstimatedCard 判定逻辑（门禁套件，须符合 R66 形状约束）
const { isEstimatedCard } = require('./cardEst.js');

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}

console.log('== cardEst 自测 ==');

ok('空数组 → false', isEstimatedCard([]) === false);
ok('非数组 null → false', isEstimatedCard(null) === false);
ok('非数组 undefined → false', isEstimatedCard(undefined) === false);
ok('全非预设行 → false', isEstimatedCard([{ material_name: '猪肉' }, { isPreset: false }]) === false);
ok('含一个预设行 → true', isEstimatedCard([{ material_name: '猪肉' }, { isPreset: true }]) === true);
ok('首行即预设 → true', isEstimatedCard([{ isPreset: true }]) === true);
ok('isPreset 为非布尔真值字符串 → false（仅认布尔 true）', isEstimatedCard([{ isPreset: 'true' }]) === false);
ok('isPreset 为 0/空串/false → false', isEstimatedCard([{ isPreset: 0 }, { isPreset: '' }, { isPreset: false }]) === false);
ok('含 null 行不崩 → false', isEstimatedCard([null, { isPreset: false }]) === false);

console.log('');
console.log('==== cardEst 自测结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail === 0 ? 0 : 1);
