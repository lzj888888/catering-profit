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
//
// 🔴 R724c（台账 R3-4）：**深度诊断的付费/额度闸门尚未接线** —— 这是当前阶段的明确决定，不是遗漏。
//   `common/diagnosisEntitlement.js::canRunDiagnosis` 已完整实现（24h 缓存去重 / 限流 /
//   订阅期内不限次 / 单次额度 / 读失败 fail-closed），但本入口一次都没调用它。
//   原因：`common/payFlags.js` 的 FREE_ACCESS = true（提审期、未接虚拟支付），语义是
//   「不把用户挡在功能外」，与 M1/M2/M3 的既有付费墙共用同一个开关。
//   ⇒ 什么时候必须接：把 FREE_ACCESS 改成 false **之前**必须先接线，并同时落
//     `shop_diagnosis_report`（canRunDiagnosis 的 24h 去重与限流都依赖这张表）。
//   ⇒ 谁来盯：`tools/check_diag_entitlement.js` 的 W-② 会在 FREE_ACCESS 翻成 false 的
//     那一刻判红（现在绿是因为本段说明在场）；翻开关时没人能「忘了接」。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
// 🔴 R641（本仓最贵的一类错误）：频控器必须**在 common 的 require 之后**创建。
//   上一版把它插在 `const db = cloud.database()` 紧跟的下一行 —— 那时 `common` 还在 TDZ，
//   模块加载直接抛 `Cannot access 'common' before initialization` ⇒ **整个云函数起不来**
//   （导入 / 诊断 / 导出三个功能全部不可用，而静态判据只看'有没有声明'，看不出来）。
//   同时仍须是**模块级单例**：写在 exports.main 里等于每次调用新建，频控无效。
const rlCheck = common.rateLimit.makeDbRateLimiter(db);
const { resolveAuth, assertShopOwner, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { validateInput } = require('./validate');
const { assemble } = require('./assemble');
const { buildActions } = require('./actions');   // R615 处方层（纯函数，零 IO）

exports.main = async (event) => {
  const ctx = cloud.getWXContext();
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;
  // R634：诊断：读多表 + 跑引擎，限 10/分 + 30/天
  const _rl = await rlCheck(userId, 'diagnose');
  if (_rl.limited) return fail(_rl.code);

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  try {
    const t0 = Date.now();
    const da = makeAdapter(db);
    // 🔴 R614（2026-11-06）：**不再重复查 shop**。
    //   `assertShopOwner` 内部已经把 shop 文档读出来并校验了归属，返回在 `owner.data` 里；
    //   这里原先又 `da.get('shop', shopId)` 查了一遍 —— 纯多余的 1~3 次库往返
    //   （assertShopOwner 走快路径是 1 次，走兼容兜底最多 3 次）。
    //   云函数超时只有 3 秒（控制台改不了，见队列 #129），省掉这一轮往返是唯一能拿到的确定性收益。
    const shop = owner.data;
    if (!shop) return fail(common.ERROR_CODES.NOT_FOUND, '店铺不存在');

    // 读全部月份账（诊断要看趋势，必须历史）。分页上限由 dataAdapter 负责；本店月数天然有界。
    const res = await da.list('shop_monthly_account', { shop_id: shopId });
    const accounts = (res && res.data) || [];

    const out = assemble({ shop, accounts });

    // 🔴 R615 处方层：把智库「动作」列接进结论。纯函数、零 IO、零新增录入字段。
    //   `out.input` 含账面现金等敏感原值，**只在服务端用于填空，绝不回传**；
    //   回传的只有预设规则表里的动作句（数字已填好）。
    const plan = buildActions({ diagnosis: out.diagnosis, derived: out.derived, input: out.input });

    // 只回传**展示用**的非敏感摘要（含账面现金的 input 原始值一律不回传，见下）
    const df = (shop.diag_facts && typeof shop.diag_facts === 'object') ? shop.diag_facts : {};
    const mrRaw = df.member_ratio_pct;
    const mrPct = (mrRaw === null || mrRaw === undefined || mrRaw === '') ? null : Number(mrRaw);
    const mrOk = Number.isFinite(mrPct) ? mrPct : null;

    return ok({
      shop_id: shopId,
      client_request_id: v.input.client_request_id || '',
      // 引擎结论（等级/分数/覆盖/红线/短板/缺项）
      diagnosis: out.diagnosis,
      // 派生量：让前端能解释"这个结论是按哪几个月算的"
      derived: out.derived,
      basis: out.basis,
      // 🔴 R615：下一步怎么做（分档说明 + 最多 3 条带数动作 + 业态边界 + 智库 ruleId）。
      //   数据不足时 actions 为空，前端需显示「先补账再看动作」，不给半本账开药方。
      plan,
      // 🔴 R614：会员销售占比的**展示用**摘要（不进评分，引擎不消费它）。
      //   为什么单独回传：老板在补录页填了这个数，就必须在结论页看到它，否则等于白填。
      //   判级复用 indicatorRef.memberRatioOf（阈值单源 <20% warn / <40% ok / ≥40% good）。
      display: {
        memberRatioPct: mrOk,
        memberRatioLevel: (common.indicatorRef.memberRatioOf(mrOk) || {}).level || 'na',
      },
      // 🔴 R614：本函数**服务端耗时**（毫秒）。用途只有一个 —— 判断 3 秒超时够不够。
      //   前端在开发/预览版（envVersion !== 'release'）会把它显示在诊断页底部，
      //   正式版不显示（老板不需要知道这个数）。冷启动 ≈ 1.5~2.5s，热启动 ≈ 0.2~0.5s。
      elapsedMs: Date.now() - t0,
      // 🔴 不回传 input 原始值：里面含账面现金等敏感数，前端要展示时走 diag_facts 回显即可，避免重复口径。
    });
  } catch (e) {
    return fail(common.ERROR_CODES.SYSTEM_ERROR, '诊断计算失败：' + e.message);
  }
};
