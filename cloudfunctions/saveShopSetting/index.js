// cloudfunctions/saveShopSetting/index.js —— 批次 4 · 店铺设置（Controller 层 · 写）
//
// 更新：店铺名称/备注（shop）+ 库存开关 / 摊销开关（shop_switch，服务端权威）。
// 鉴权中间件（批次 0）→ 校验（shop_id + assertShopOwner）→ 写 shop + upsert shop_switch。
// ⚠️ 开关以本服务端写库值为准，前端后续读回即同步。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { SWITCH_KEYS } = require('./service'); // 开关键常量（与 getShopContext 一致，防漂移）
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

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  const da = makeAdapter(db);
  const now = nowUtc();

  // ===== 3. 更新店铺名称/备注（存在 shop_id 字段的文档）=====
  const shopDoc = await da.get('shop', shopId);
  if (shopDoc) {
    const patch = { updated_at: now };
    // 🔴 只有「调用方真的传了」才写：undefined = 不动库（防只改开关却把店铺名/备注写空）。
    //    显式 '' 仍需生效（= 清空），故用 !== undefined 判定，不可用真假值判定。
    if (v.name !== undefined && Array.isArray(v.name) === false) patch.name = v.name;
    if (v.remark !== undefined && Array.isArray(v.remark) === false) patch.remark = v.remark;
    await db.collection('shop').doc(shopDoc.id || shopId).update({ data: patch });
  }

  // ===== 4. upsert 开关（shop_switch，唯一键 shop_id+switch_key）=====
  const keysToSet = [];
  if (v.switches.inventory !== null) keysToSet.push({ key: SWITCH_KEYS.inventory, enabled: v.switches.inventory });
  if (v.switches.amortize !== null) keysToSet.push({ key: SWITCH_KEYS.amortize, enabled: v.switches.amortize });
  for (const kv of keysToSet) {
    const existRes = await da.list('shop_switch', { shop_id: shopId, switch_key: kv.key });
    const row = (existRes && existRes.data && existRes.data[0]) || null;
    if (row) {
      try {
        await db.collection('shop_switch').doc(row._id || row.id).update({ data: { enabled: kv.enabled, updated_at: now } });
      } catch (e) {
        await db.collection('shop_switch').add({ data: { shop_id: shopId, switch_key: kv.key, enabled: kv.enabled, updated_at: now } });
      }
    } else {
      await da.insert('shop_switch', { shop_id: shopId, switch_key: kv.key, enabled: kv.enabled });
    }
  }

  return ok({
    shop_id: shopId,
    name: v.name || (shopDoc ? shopDoc.name : ''),
    remark: v.remark,
    switches: { inventory: v.switches.inventory !== null ? v.switches.inventory : undefined, amortize: v.switches.amortize !== null ? v.switches.amortize : undefined },
    client_request_id: v.input.client_request_id || '',
  });
};