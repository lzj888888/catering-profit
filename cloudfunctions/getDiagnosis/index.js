// cloudfunctions/getDiagnosis/index.js —— 深度诊断（读侧 · 组装输入 → 引擎 → 结论）
//
// 角色：**引擎的唯一出口**。`common/diagnosisEngine.js` 是纯函数、零 IO，此前全仓零调用；
//   本函数负责把「店铺设置 + 历史上每月账 + 诊断补录项」拼成引擎输入，算完把结论回给前端。
//
// 为什么不在 getLedger 里顺手算：
//   ① 连亏要读最多 12 个月账，挂在结果页每次加载上会拖慢主路径；
//   ② 诊断是低频（一季一次）且要独立计费/缓存，不该和月度账耦合。
//
// 安全：与其它读接口一致 —— resolveAuth + assertShopOwner（越权读别家店铺一律拒）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { validateInput } = require('./validate');
const { assemble } = require('./assemble');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  try {
    const da = makeAdapter(db);
    const shop = await da.get('shop', shopId);
    if (!shop) return fail(common.ERROR_CODES.NOT_FOUND, '店铺不存在');

    // 读全部月份账（诊断要看趋势，必须历史）。分页上限由 dataAdapter 负责；本店月数天然有界。
    const res = await da.list('shop_monthly_account', { shop_id: shopId });
    const accounts = (res && res.data) || [];

    const out = assemble({ shop, accounts });

    return ok({
      shop_id: shopId,
      client_request_id: v.input.client_request_id || '',
      // 引擎结论（等级/分数/覆盖/红线/短板/缺项）
      diagnosis: out.diagnosis,
      // 派生量：让前端能解释"这个结论是按哪几个月算的"
      derived: out.derived,
      basis: out.basis,
      // 🔴 不回传 input 原始值：里面含账面现金等敏感数，前端要展示时走 diag_facts 回显即可，避免重复口径。
    });
  } catch (e) {
    return fail(common.ERROR_CODES.SYSTEM_ERROR, '诊断计算失败：' + e.message);
  }
};
