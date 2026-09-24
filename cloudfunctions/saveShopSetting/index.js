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
  // 🔴 round116 真云修复：原为 `if (shopDoc) {…}` —— 取不到文档就**整段静默跳过**，接口仍回 SUCCESS，
  //    前端表现为「点了没反应」。改为 fail-loud（assertShopOwner 已保证文档存在，走到这里为 null 即异常）。
  if (!shopDoc) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, '店铺不存在（shop_id=' + shopId + '）');

  // 🔴🔴 round116 真云缺陷修复（**本轮用户报的「行业选择没有变化」的根因**）：
  //   写库**必须用权威主键 `_id`**，不能用文档里的业务 `id` 字段。
  //   缘由：`dataAdapter.get()` 在 2026-09-19 修过「业务主键 ≠ `_id`」——**但只修了读**（加了按
  //   `id/material_id/asset_id/shop_id/account_id` 逐个兜底查），**写仍用业务键** ⇒ 读写不对称。
  //   `da.get()` 一旦走兜底命中，返回文档的 `id` 字段**未必等于它的 `_id`**（存量数据 id 为旧格式），
  //   而微信云开发 `doc(<不存在的 _id>).update()` 的行为是**静默返回 0 行、不抛异常**
  //   ⇒ 接口回 SUCCESS、库里一个字没改，**前端与复审双方都看不见任何错**。
  //   round116 真云实证（`_gui/_probe_r116.js proof`）：
  //     写 name='R116PROBE' + biz_type='cafe' → 返回 SUCCESS → 立刻回读仍是 '默认店铺' / ''。
  //   ⇒ 修法两条：① 用 `_id`；② 对 `stats.updated === 0` **fail-loud**（把"静默失败"永久消灭）。
  const shopRid = shopDoc._id || shopDoc.id || shopId;
  {
    const patch = { updated_at: now };
    // 🔴 只有「调用方真的传了」才写：undefined = 不动库（防只改开关却把店铺名/备注写空）。
    //    显式 '' 仍需生效（= 清空），故用 !== undefined 判定，不可用真假值判定。
    if (v.name !== undefined && Array.isArray(v.name) === false) patch.name = v.name;
    if (v.remark !== undefined && Array.isArray(v.remark) === false) patch.remark = v.remark;
    // round115：业态 / 城市层级（M1 结果页取「行业参考带」的输入）—— 同样只在「真的传了」时才写
    if (v.biz_type !== undefined) patch.biz_type = v.biz_type;
    if (v.city_tier !== undefined) patch.city_tier = v.city_tier;
    const upRes = await db.collection('shop').doc(shopRid).update({ data: patch });
    const updated = (upRes && upRes.stats && upRes.stats.updated) || 0;
    if (!updated) return fail(ERROR_CODES.SYSTEM_ERROR, '店铺设置未写入（target=' + shopRid + '）');
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
    // round115：回读当前值（未传时回库里的，供前端 picker 回显）
    biz_type: v.biz_type !== undefined ? v.biz_type : ((shopDoc && shopDoc.biz_type) || ''),
    city_tier: v.city_tier !== undefined ? v.city_tier : ((shopDoc && shopDoc.city_tier) || ''),
    switches: { inventory: v.switches.inventory !== null ? v.switches.inventory : undefined, amortize: v.switches.amortize !== null ? v.switches.amortize : undefined },
    client_request_id: v.input.client_request_id || '',
  });
};