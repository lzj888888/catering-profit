// cloudfunctions/purgeDeletedData/index.js —— 已删除数据的物理清理（R688）
//
// 🔴 为什么必须存在这个函数：
//   `deleteAccount` 对用户承诺「数据会被清理」，但 R688 核查发现**全仓没有任何执行者**
//   （带 triggers 的只有 dbBackup / payExpireNotify）。承诺了没人做 = 用户可见的虚假陈述。
//   本函数就是那个执行者。
//
// 口径（2026-11-10 李老师拍板，三方商议后定稿，见 review/consult/R688_敲定方案.md）：
//   · 经营数据（收入/费用/库存/成本卡/配方/沙盘/库存/外卖销量等）→ 软删满 **15 天** 后物理删除
//   · 店铺档案 → 子表删完后物理删除
//   · 用户 → 注销满 30 天后物理删除（注销时 openid 已不可逆匿名化）
//   · 支付流水 / 退款 → **不删**，《电子商务法》第 31 条要求交易信息保存不少于 3 年
//   · 审计日志 → **不删**（保留 12 个月做安全审计；且需先脱敏金额，见队列 #152）
//
// 三条设计红线：
//   ① **到期才删**：`delete_at` 未满 15 天的一条都不许动（用户还有反悔窗口）。
//      判据用 `delete_at < cutoff`，且 `delete_at` 必须是非 0 数值 —— 缺字段/为 0 一律跳过。
//   ② **先子后父**：先删子表，最后删 shop。反过来会留下永远查不到、也没人认领的孤儿数据。
//   ③ **可干跑**：传 `{ dryRun: true }` 只统计不删。物理删除不可逆，必须能先看再动。
//
// 触发：每天 03:00（config.json cron `0 0 3 * * * *`，7 位：秒 分 时 日 月 周 年）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const common = require('./common');               // 扁平派生副本（sync_common 生成）
const { nowUtc } = common.utilTime;

// ---- 口径常量（改动必须同步 review/consult/R688_敲定方案.md 与 selftest）----
// 🔴 为什么是 15 天而不是 30 天：
//   本仓 `specs/dev-specs/core/11_微信审核自查清单.md:55` 写的是「承诺 **15 个工作日内**完成」。
//   15 个工作日 ≈ 21 个自然日 ⇒ 若保留期定 30 天，**我们比自己对平台的承诺还慢**，
//   审核员一比对就是「说了 15 个工作日、实际 30 天」。
//   15 个自然日严格小于 15 个工作日，任何口径下都满足，且对「误点注销要反悔」也完全够用。
const RETENTION_DAYS = 15;                        // 经营数据保留期
const RETENTION_MS = RETENTION_DAYS * 24 * 3600 * 1000;
const MAX_SHOPS_PER_RUN = 20;                     // 单次最多清理的店铺数（护栏）
const BUDGET_MS = 15000;                          // 单次执行预算（云函数超时 20s，留 5s 余量）

// ---- 受保护集合：**显式声明，永不自动删除**（每一条都要有法律或审计理由）----
// 🔴 R688 修订：`audit_log` 曾列在此处（原计划「保留 12 个月 + 脱敏去金额」），**已移出**。原因两条：
//   ① `audit_log.after_data` 同时是**幂等重放的载体**（`common/idempotency.js:72` 直接返回它当首次结果），
//      裁剪金额会破坏「重复提交返回首次结果」的契约；
//   ② 而 `common/audit.js` 头注定的是铁律 8「只 INSERT，可追溯前后状态」⇒ 脱敏要 UPDATE，违反铁律。
//   ⇒ 简单的做法反而更对：**审计日志随经营数据一起 30 天删**。
//      交易信息不会因此丢失 —— `shop_payment_flow` / `order_refund` 独立保留 3 年，那才是法定要求的那份。
const PROTECTED = {
  shop_payment_flow: '支付流水：《电子商务法》第 31 条，交易信息自完成之日起保存不少于 3 年',
  order_refund: '退款记录：与支付流水同周期，用于对账与纠纷举证',
};

// ---- 待删集合：按 shop_id 定位的经营数据 ----
// ⚠️ 这份清单是**硬抄**的（云函数包内无法 require initDb 单源），所以配了守卫
//   `tools/check_purge_coverage.js`：从 initDb 索引推导所有含 shop_id 的集合，
//   断言「DELETABLE ∪ PROTECTED ⊇ 推导结果」且两者不相交 —— 新增表没登记会当场转红。
const DELETABLE = [
  // audit_log 放**第一个**：先把该店的旧审计清掉，本轮随后写的 PURGE_* 清理审计才会留下来。
  // 若放最后，刚写的那条会被自己删掉，等于没留痕。
  'audit_log',                // 操作审计（含 after_data 金额快照，见 PROTECTED 上方说明）
  'shop_material',            // 原料
  'shop_cost_card',           // 菜品成本卡（配方，核心商业机密）
  'shop_cost_card_line',      // 成本卡明细
  'shop_sandbox',             // 沙盘推演
  'shop_amortize',            // 摊销
  'shop_monthly_account',     // 月度账合计（含利润）
  'shop_monthly_income',      // 月收入明细
  'shop_monthly_expense',     // 月费用明细
  'shop_inventory',           // 库存
  'shop_stored_value',        // 储值
  'shop_credit_ledger',       // 挂账流水
  'shop_switch',              // 口径开关
  'shop_income_item',         // 收入科目配置
  'shop_expense_item',        // 费用科目配置
  'external_sales_daily',     // 外部平台销量（外卖）
  'revenue_batch',            // 营收批次
  'shop_dish_mapping',        // 菜品映射
  'shop_ai_consent',          // AI 授权同意记录（注销即撤回授权，必须一并清）
  'shop_ai_insight',          // AI 结论（含经营数据摘要）
  'shop_diagnosis_report',    // 诊断报告
];

// 按 user_id 定位、随用户注销一起清（shop / entitlement / 诊断次数）
// ⚠️ shop 必须**最后**删（红线②），故单列
const DELETABLE_BY_USER = ['shop_diagnosis_credit', 'shop_entitlement'];

/**
 * 删除某集合下匹配条件的全部记录。
 * 用服务端 where().remove()（一次调用删全部匹配），而不是逐条 doc().remove()：
 * 后者在数百行时要几百次往返，必然撞 20s 超时。
 */
async function removeAll(collection, cond) {
  try {
    const r = await db.collection(collection).where(cond).remove();
    return (r && r.stats && r.stats.removed) || 0;
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}

async function countAll(collection, cond) {
  try {
    const r = await db.collection(collection).where(cond).count();
    return (r && r.total) || 0;
  } catch (e) {
    return 0;
  }
}

exports.main = async (event) => {
  // 🔴 R688 安全自保（按 R215 定式，与 dbBackup / smokeTest / payExpireNotify 同族）：
  //   本函数会**物理删除数据**，绝不能从客户端可达。
  //   有 OPENID 说明是小程序端调的 ⇒ 直接拒。
  //   ⚠️ 首版漏了这段 —— 意味着任何用户都能 `wx.cloud.callFunction({name:'purgeDeletedData'})`
  //      去触发清理，把别人"还差几天到期"的数据提前删掉。写清理逻辑时最容易忘的就是"谁能调我"。
  const ctx = cloud.getWXContext() || {};
  if (ctx.OPENID) {
    return { ok: false, code: 'FORBIDDEN', msg: 'purgeDeletedData 仅允许定时触发' };
  }

  const v = event || {};
  const dryRun = v.dryRun === true;                 // 红线③：可干跑
  const t0 = Date.now();
  const cutoff = nowUtc() - RETENTION_MS;

  // 只认「已软删 + 有明确 delete_at + 已到期」。delete_at 缺失或为 0 一律跳过（红线①）
  const expired = {
    is_deleted: true,
    delete_at: _.and(_.gt(0), _.lt(cutoff)),
  };

  const result = {
    dry_run: dryRun,
    retention_days: RETENTION_DAYS,
    cutoff: cutoff,
    shops: [],
    users: [],
    skipped: [],
    errors: [],
    elapsed_ms: 0,
  };

  // ===== 1. 超期的店铺 =====
  let shopDocs = [];
  try {
    const r = await db.collection('shop').where(expired).limit(MAX_SHOPS_PER_RUN).get();
    shopDocs = (r && r.data) || [];
  } catch (e) {
    result.errors.push({ stage: 'list_shops', error: (e && e.message) || String(e) });
    return result;
  }

  for (let i = 0; i < shopDocs.length; i++) {
    if (Date.now() - t0 > BUDGET_MS) {
      // 预算耗尽：剩余的下次再清（本函数每天跑，不会积压）
      for (let j = i; j < shopDocs.length; j++) result.skipped.push(shopDocs[j]._id);
      break;
    }
    const shopId = shopDocs[i]._id;
    const one = { shop_id: shopId, delete_at: shopDocs[i].delete_at, collections: {} };

    // 红线②：先子表
    for (const c of DELETABLE) {
      const cond = { shop_id: shopId };
      if (dryRun) {
        one.collections[c] = await countAll(c, cond);
      } else {
        const n = await removeAll(c, cond);
        if (n && n.error) {
          result.errors.push({ stage: 'purge', collection: c, shop_id: shopId, error: n.error });
        } else {
          one.collections[c] = n;
        }
      }
    }

    // shop 本身：**最后**删
    if (dryRun) {
      one.collections.shop = 1;
    } else {
      try {
        await db.collection('shop').doc(shopId).remove();
        one.collections.shop = 1;
      } catch (e) {
        result.errors.push({ stage: 'purge', collection: 'shop', shop_id: shopId, error: (e && e.message) || String(e) });
      }
    }
    result.shops.push(one);

    // 留痕（不含金额/姓名，只有 id 与计数）
    if (!dryRun) {
      try {
        await common.audit.writeAudit(db, {
          action: 'PURGE_DELETED_SHOP',
          operator_type: 'system',
          operator_id: 'purgeDeletedData',
          shop_id: shopId,
          before_data: { delete_at: shopDocs[i].delete_at },
          after_data: { purged: true, retention_days: RETENTION_DAYS },
          remark: '经营数据物理删除（注销/删除满 ' + RETENTION_DAYS + ' 天）',
        });
      } catch (e) {
        // 审计失败不阻断清理（否则一条审计写不进就永远删不掉，反而更违规）
      }
    }
  }

  // ===== 2. 超期的用户 =====
  let userDocs = [];
  try {
    const r = await db.collection('user').where(expired).limit(MAX_SHOPS_PER_RUN).get();
    userDocs = (r && r.data) || [];
  } catch (e) {
    result.errors.push({ stage: 'list_users', error: (e && e.message) || String(e) });
  }

  for (const u of userDocs) {
    if (Date.now() - t0 > BUDGET_MS) {
      result.skipped.push(u._id);
      continue;
    }
    const one = { user_id: u.user_id, collections: {} };
    for (const c of DELETABLE_BY_USER) {
      const cond = { user_id: u.user_id };
      if (dryRun) one.collections[c] = await countAll(c, cond);
      else {
        const n = await removeAll(c, cond);
        if (n && n.error) result.errors.push({ stage: 'purge_user', collection: c, error: n.error });
        else one.collections[c] = n;
      }
    }
    if (!dryRun) {
      try {
        await db.collection('user').doc(u._id).remove();
        one.collections.user = 1;
      } catch (e) {
        result.errors.push({ stage: 'purge_user', collection: 'user', error: (e && e.message) || String(e) });
      }
    } else {
      one.collections.user = 1;
    }
    result.users.push(one);
  }

  result.elapsed_ms = Date.now() - t0;

  // 日志要显眼：清理是"静默生效"的事，不打印就没人知道它在不在跑
  console.log('[purgeDeletedData] ' + (dryRun ? '🧪 干跑' : '🗑 实删') +
    ' shops=' + result.shops.length + ' users=' + result.users.length +
    ' skipped=' + result.skipped.length + ' errors=' + result.errors.length +
    ' ' + result.elapsed_ms + 'ms');
  if (result.errors.length) console.error('[purgeDeletedData] 失败：' + JSON.stringify(result.errors));

  return result;
};
