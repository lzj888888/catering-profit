// cloudfunctions/saveDishMapping/service.js —— 菜名映射写侧 · 纯函数层（R255）
//
// 🔴🔴 键口径（与读侧 `cloudfunctions/getDishReview/index.js::lookupCardCode` **逐字对齐**；
//    错位即"死输入" —— 用户挂了映射、读侧永远查不到，比报错更坏）：
//
//    读侧（R253 已落地，本轮一字不动）：
//      mapIndex.set(platform + '|' + external_ref_id, card_code)
//      查：mapIndex.get(p + '|' + k) || mapIndex.get('|' + k) || ''      ← 有「无 platform」兜底
//      ⇒ 键 = platform + '|' + dish_key，两端都 trim。
//
//    本侧三条决定（与方案 §二 一致）：
//      ① external_ref_id 存【原始 dish_key】（平台导入菜名），**绝不归一** ——
//         读侧查的是 rankReview 聚合 key = 销量行 dish_key 原样；若这里先 normalizeDishName，
//         「★发鱿鱼」会落成「发鱿鱼」⇒ 读侧永远查不到 ⇒ 挂了等于没挂（静默失效）。
//      ② platform **可空**；为空 ⇒ 跨所有平台生效（读侧有 mapIndex.get('|' + k) 兜底）。
//         同一道菜在淘宝/京东都叫「【招牌】耙牛肉(小份)」，这个对应关系是**菜本身的属性**，
//         与平台无关；一次挂钩全平台生效也最符合用户直觉。
//      ③ 两端都 trim 后比较（读侧 trim 了，写侧必须同样 trim，否则前后空格导致失配）。
//
// ⚠️ 字段名沿用规范 v1.4 §6.2 的 `external_ref_id`（原义「平台侧菜品 ID」），
//    本仓实操语义 = **原始 dish_key**（与 R253 读侧一致）。字段名不改（改要动索引与规范），
//    语义在此注释与守卫里钉死 —— 新人最容易在这里写错（拿销量行的 external_ref_id 来查，
//    那个带日期 'DISH:<platform>:<biz_date>:<dish_key>'，必然天天失配）。

const MAP_KEY_SEP = '|';

function normKeyPart(x) {
  if (x === null || x === undefined) return '';
  return String(x).trim();
}

// 键 = platform + '|' + dish_key —— 与读侧 mapIndex 的键**同形**（改这里必须同步改读侧）
function buildMapKey(platform, dishKey) {
  return normKeyPart(platform) + MAP_KEY_SEP + normKeyPart(dishKey);
}

// 在映射行里挑出目标行（platform + dish_key 双命中；软删行跳过）
//   ⚠️ 读侧经 DataAdapter 已过滤 is_deleted=false，这里的显式判空是**双保险**：
//      即使将来有人绕过 da 直读，也不会把已软删的旧挂钩当成现役。
function pickMappingRow(rows, platform, dishKey) {
  const want = buildMapKey(platform, dishKey);
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r) continue;
    if (r.is_deleted === true) continue;
    if (buildMapKey(r.platform, r.external_ref_id) !== want) continue;
    return r;
  }
  return null;
}

// 判定本次动作：
//   created —— 无既有行，且给了 card_code ⇒ 新增
//   updated —— 有既有行，card_code 变了 ⇒ 改（走 _id）
//   cleared —— 有既有行，card_code 传空 ⇒ 解除（软删，可逆）
//   noop    —— 无事可做（无行且未给卡 / 有行且卡没变）⇒ 不写库，仍返回成功（幂等友好）
function judgeMappingAction(row, nextCardCode) {
  const cc = normKeyPart(nextCardCode);
  if (!cc) return row ? 'cleared' : 'noop';
  if (!row) return 'created';
  if (normKeyPart(row.card_code) === cc) return 'noop';
  return 'updated';
}

module.exports = {
  buildMapKey,
  pickMappingRow,
  judgeMappingAction,
  normKeyPart,
  MAP_KEY_SEP,
};
