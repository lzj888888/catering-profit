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

// ===== R260：批量关联（规范 v1.9 §0 D26~D28）=====
// 🔴 为什么上限只有 20（不是 200、也不是 1000）：
//   云端**新部署的 timeout 默认 3s，且只有云开发控制台能改**（`config.json` 不生效）——
//   这是本仓实测过的硬约束。单批要串行写 ≤20 个文档 + 1 次全量读（`listAll`），
//   每次约 10~30ms ⇒ 单批 1s 上下，留足余量。**分块的责任在前端**（⌈N/20⌉ 次调用）。
//   ⚠️ 上限只在这一个地方定义，前端必须 require 同源（不得自己抄一个数）；
//      `tools/check_dish_mapping_write.js` D-② 钉死这一点。
const MAX_BATCH = 20;

// 批内冲突：同一 (platform, dish_key) 出现两次以上
//   🔴 为什么必须整批拒而不是"后面的覆盖前面的"：
//      两条 item 写同一个键 ⇒ 第一条 insert、第二条 update ⇒ **两次都返回成功**，
//      而用户看到的是"51 条都挂上了"，实际只有 50 个键、且某一个值是后写的那次
//      ⇒ 静默丢一条，且没有任何报错。
//   ⚠️ 判重用**同一把键函数**（buildMapKey）—— 否则"空 platform"与"显式 platform"会被
//      当成两个不同键（前者落到 '|菜'、后者落到 'taobao|菜'），而读侧两者都会命中同一条兜底
//      ⇒ 语义上确实是两个不同的行，可各存一条；但**同一 (platform, dish_key) 重复**才判冲突。
//      ⇒ 判重键 = buildMapKey(platform, dishKey)，与写库唯一键同源。
function findBatchConflicts(items) {
  const seen = new Map();
  const dups = [];
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i] || {};
    const k = buildMapKey(it.platform, it.dish_key);
    if (seen.has(k)) {
      dups.push({ index: i, platform: normKeyPart(it.platform), dish_key: normKeyPart(it.dish_key), first_index: seen.get(k) });
    } else {
      seen.set(k, i);
    }
  }
  return dups;
}

// 批量动作规划：给定**既有映射行**与 items，逐项算出动作
//   ⚠️ 关键：批内新插入的行**不在** `rows` 里（rows 是写库前的一次性快照）。
//      ⇒ 若两个 item 指向同一键，第二个会看到"无既有行"⇒ 也判 created ⇒ 两条 insert
//      ⇒ 撞唯一索引或被覆盖。所以**必须先跑 findBatchConflicts**，冲突则整批不写。
//      本函数假定调用方已去重（index.js 的调用顺序：冲突检查 → 卡校验 → planBatchActions）。
function planBatchActions(rows, items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((it, i) => {
    const item = it || {};
    const platform = normKeyPart(item.platform);
    const dishKey = normKeyPart(item.dish_key);
    const cardCode = normKeyPart(item.card_code);
    const row = pickMappingRow(rows, platform, dishKey);
    return {
      index: i,
      platform,
      dish_key: dishKey,
      card_code: cardCode,
      _id: row ? row._id : '',   // 🔴 字段名就叫 _id：写库主键必须用 _id（守卫 A-⑯ 逐 .doc() 实参核对）
      action: judgeMappingAction(row, cardCode),
    };
  });
}

// 汇总动作计数（出参用）
function countActions(plans) {
  const c = { created: 0, updated: 0, cleared: 0, noop: 0, total: 0 };
  (Array.isArray(plans) ? plans : []).forEach((p) => {
    if (c[p.action] !== undefined) c[p.action] += 1;
    c.total += 1;
  });
  return c;
}

module.exports = {
  buildMapKey,
  pickMappingRow,
  judgeMappingAction,
  normKeyPart,
  MAP_KEY_SEP,
  MAX_BATCH,
  findBatchConflicts,
  planBatchActions,
  countActions,
};
