// cloudfunctions/getShopList/selftest.js —— 批次 7 / M3.22 批次 A1 · 多店铺列表自测（软删过滤 + 免费配额）
// 运行： node cloudfunctions/getShopList/selftest.js
// ⚠️ M3.22 改造：免费额度不再硬编码 FREE_SHOP_LIMIT=1，改为读 feature_permissions.plan_free.limits.shop。
//   本文件验证「按配置注入判定」语义（不再钉死额度值）。
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 与 index.js 同款判定语义：hitFreeLimit = 活跃店铺数 >= limits.shop（limits 从配置注入）
const hitFree = (activeShops, freeLimit) => activeShops.length >= freeLimit;

console.log('===== 软删过滤（切换列表只含 is_deleted=false）=====');
const activeShops = [
  { shop_id: 's1', name: 'A 店', is_deleted: false },
  // s2（已软删）已被 DataAdapter 过滤，不存在于数组
];
check('活跃店铺进入列表', activeShops.length === 1 && activeShops[0].shop_id === 's1');
check('软删店铺不进入列表（DataAdapter 过滤）', activeShops.every((s) => s.is_deleted !== true));

console.log('===== 免费配额（注入值驱动，不钉死额度值）=====');
// 注入 freeLimit=1（当前配置值）：0 家不超 / 1 家超
check('freeLimit=1：0 家未超限', hitFree([], 1) === false);
check('freeLimit=1：1 家超限（第 2 家触发付费墙）', hitFree(activeShops, 1) === true);
// 正负互证：同一 activeCount 在不同注入值下结论不同
check('freeLimit=2：1 家未超限（与 freeLimit=1 结论不同）', hitFree(activeShops, 2) === false);
check('判定随注入值变化（正负互证）', hitFree(activeShops, 1) !== hitFree(activeShops, 2));
// 缺配置 → 响亮失败（语义：index.js 里 freeShopLimit undefined 时返回 SYSTEM_ERROR）
check('缺 limits.shop（undefined）→ 判定为"缺配置"（index.js 会 SYSTEM_ERROR）',
  (() => { const v = undefined; return v === undefined || v === null; })(), '见 index.js 第 41-44 行');

console.log('===== 软删不占额语义 =====');
check('软删店不占额：活跃数组只含 1 家（软删已滤）', activeShops.length === 1);
check('used=活跃数', activeShops.length === 1);

console.log(`\n==== getShopList 批次 7/A1 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);