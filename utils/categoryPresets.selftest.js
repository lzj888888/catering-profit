// utils/categoryPresets.selftest.js —— P0-2 品类默认模板数据守卫（纯 node 直跑）
// 运行： node utils/categoryPresets.selftest.js
const { CATEGORY_PRESETS, getCategoryPreset, validatePresets, CONDIMENT_NAME } = require('./categoryPresets.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

check('品类数量 = 11', CATEGORY_PRESETS.length === 11, '=' + CATEGORY_PRESETS.length);
check('数据自检零错误', validatePresets().length === 0, validatePresets().join('; '));

const hot = getCategoryPreset('hot_meat');
check('取热炒荤菜：出净率 85%', hot && hot.yield_rate === 85, hot && String(hot.yield_rate));
check('取热炒荤菜：损耗 2%', hot && hot.loss_rate === 2);
check('取热炒荤菜：调料(含油盐酱醋) 50分(0.5元)', hot && hot.condiment_fen === 50);
check('取热炒荤菜：示例主料含猪肉150克', hot && hot.sample_lines[0].name === '猪肉' && hot.sample_lines[0].qty === 150);
check('取热炒荤菜：燃气燃料默认不进卡(energy_fen=0)', hot && hot.energy_fen === 0);
const bbq = getCategoryPreset('bbq_fry');
check('烧烤炸物含燃气燃料建议值(energy_fen>0)', bbq && bbq.energy_fen > 0);

const drink = getCategoryPreset('drink');
check('取饮品奶茶：出净率 98%', drink && drink.yield_rate === 98);
check('取饮品奶茶：单位合法(毫升)', drink && drink.sample_lines[0].unit === '毫升');

check('未知 key 返回 null', getCategoryPreset('nope') === null);
check('调料固定名 = 调料(含油盐酱醋)', CONDIMENT_NAME === '调料(含油盐酱醋)');

console.log('\n==== 品类默认模板自测结果：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
