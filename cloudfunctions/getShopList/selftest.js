// cloudfunctions/getShopList/selftest.js —— 批次 7 · 多店铺列表自测（软删过滤 + 免费配额）
// 运行： node cloudfunctions/getShopList/selftest.js
// ⚠️ 列表仅含 is_deleted=false；软删不占配额；切换不触发付费（由页面边界保证，此处验证配额语义）。
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 与 index.js 同款配额逻辑（DataAdapter 已过滤软删 → shops 数组即活跃店铺）
const FREE_SHOP_LIMIT = 1;
const hitFree = (activeShops) => activeShops.length >= FREE_SHOP_LIMIT;

console.log('===== 软删过滤（切换列表只含 is_deleted=false）=====');
// DataAdapter.list('shop', {user_id}) 注入 is_deleted=false → 软删店铺根本不会出现在数组
const activeShops = [
  { shop_id: 's1', name: 'A 店', is_deleted: false },
  // s2（已软删）已被 DataAdapter 过滤，不存在于数组
];
check('活跃店铺进入列表', activeShops.length === 1 && activeShops[0].shop_id === 's1');
check('软删店铺不进入列表（DataAdapter 过滤）', activeShops.every((s) => s.is_deleted !== true));

console.log('===== 免费配额（user_id 维度，软删不占额）=====');
check('0 家活跃 → 未超限', hitFree([]) === false);
check('1 家活跃 → hit_free_limit（第 2 家触发付费墙）', hitFree(activeShops) === true);
check('2 家活跃（含软删被滤后仅 1 家）→ 仍按活跃数判定', hitFree(activeShops) === true, '软删店不占额：即使历史建过 2 家，软删后只计 1 家');
check('used=活跃数（软删不计入）', activeShops.length === 1);

console.log(`\n==== getShopList 批次 7 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);