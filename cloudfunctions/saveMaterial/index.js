// cloudfunctions/saveMaterial/index.js —— 批次 3 · POC2 原料档案新增/编辑（Controller 层 · 写）
//
// 分层归属：
//   Controller：鉴权中间件（批次 0）→ 校验/清洗 → Service 计算净料单位成本 →
//               DataAdapter.read 校验目标存在（软删视为不存在，禁止复活软删）→ INSERT / UPDATE。
//   Service   ：saveMaterial/service.js，仅算净料单位成本（万分整数）。
//
// ⚠️ 快照隔离语义：改价**只改** shop_material 的 purchase_price / net_unit_cost 等字段；
//   已保存成本卡（shop_cost_card_line）的明细行快照**不受影响** —— 旧卡成本永远保留保存时数值。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { netUnitCostWan } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 参数校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. 幂等预检（契约 §10：saveMaterial = user+shop+幂等）=====
  // 🔒 R73：新增分支每次 genId('mat_') 后 INSERT ⇒ 天然**非**幂等；重复提交会产生**重复原料档案**，
  //   此后在其中一条改价，成本卡按 id 取到的价与另一条不一致（同一原料两个价）。
  //   命中即返回首次结果、不再落库。空 client_request_id ⇒ 单源返回 null ⇒ 不做约束（守卫已登记在案）。
  const clientRequestId = v.input.client_request_id;
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  // ===== 4. Service 计算净料单位成本（万分整数，4 位精度）=====
  const m = v.material;
  const netCostWan = netUnitCostWan(m.purchase_price_fen, m.convert_factor, m.yield_rate);

  const da = makeAdapter(db);
  const now = nowUtc();

  let out;
  if (m.id) {
    // ===== 编辑既有原料 =====
    const exist = await da.get('shop_material', m.id);
    if (!exist) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `原料 ${m.id} 不存在或已软删`);
    if (exist.is_virtual && !m.is_virtual) {
      // 虚拟半成品不可手动改回普通原料（M3：虚拟原料不可手动编辑基本资料）—— 保留 is_virtual
    }
    await db.collection('shop_material').doc(m.id).update({
      data: {
        name: m.name,
        brand_spec: m.brand_spec,
        purchase_unit: m.purchase_unit,
        purchase_price: m.purchase_price_fen,
        convert_factor: m.convert_factor,
        yield_rate: m.yield_rate,
        net_unit_cost: netCostWan,
        updated_at: now,
        is_deleted: false,
      },
    });
    out = { shop_id: shopId, id: m.id, client_request_id: clientRequestId || '' };
  } else {
    // ===== 新增原料 =====
    const id = common.genId('mat_');
    await da.insert('shop_material', {
      material_id: id,
      id: id,
      shop_id: shopId,
      name: m.name,
      brand_spec: m.brand_spec,
      purchase_unit: m.purchase_unit,
      purchase_price: m.purchase_price_fen,
      convert_factor: m.convert_factor,
      yield_rate: m.yield_rate,
      net_unit_cost: netCostWan,
      is_virtual: m.is_virtual,
    });
    out = { shop_id: shopId, id, client_request_id: clientRequestId || '' };
  }

  // ===== 5. 幂等登记（键与上面查重键**同源**，一律走单源 shopKey）=====
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'SAVE_MATERIAL',
        operator_type: 'user',
        operator_id: userId,
        shop_id: shopId,
        after_data: out,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }
  return ok(out);
};