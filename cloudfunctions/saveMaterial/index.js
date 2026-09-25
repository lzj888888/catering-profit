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
  const da = makeAdapter(db);

  // ===== 4.5. M3.2（批次 P0）软删分支：虚拟原料不可删；普通原料软删（is_deleted=true）=====
  if (m._delete) {
    const exist = await da.get('shop_material', m.id);
    if (!exist) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `原料 ${m.id} 不存在或已软删`);
    if (exist.is_virtual) return fail(ERROR_CODES.INVALID_PARAM, '虚拟原料不可手动删除');
    await da.softDelete('shop_material', exist._id || m.id, userId);
    return ok({ shop_id: shopId, id: m.id, deleted: true, client_request_id: clientRequestId || '' });
  }

  const netCostWan = netUnitCostWan(m.purchase_price_fen, m.convert_factor, m.yield_rate);

  const now = nowUtc();

  let out;
  if (m.id) {
    // ===== 编辑既有原料 =====
    const exist = await da.get('shop_material', m.id);
    if (!exist) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `原料 ${m.id} 不存在或已软删`);
    if (exist.is_virtual && !m.is_virtual) {
      // 虚拟半成品不可手动改回普通原料（M3：虚拟原料不可手动编辑基本资料）—— 保留 is_virtual
    }
    // 🔴 round116 同族修复：写库必须用权威主键 `_id`，不得用业务 id。
    //   `da.get()` 有业务主键兜底（2026-09-19 只修了**读**）⇒ 命中时文档的 `_id` 未必
    //   等于业务 id；而 `doc(<不存在的 _id>).update()` 在真云上**静默 0 行、不抛异常**
    //   ⇒ 接口回 SUCCESS 但库里没改（round116 真云实证，详见 saveShopSetting/index.js 注）。
    await db.collection('shop_material').doc(exist._id || m.id).update({
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
        // M3.30（批次 P0）：三可选字段（category/aliases/remark）一并 update
        category: m.category,
        aliases: m.aliases,
        remark: m.remark,
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
      // M3.30（批次 P0）：三可选字段（category/aliases/remark）
      category: m.category,
      aliases: m.aliases,
      remark: m.remark,
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