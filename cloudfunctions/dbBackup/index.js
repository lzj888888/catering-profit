// cloudfunctions/dbBackup/index.js —— 数据库定时备份（R652）
//
// 为什么必须做：李老师的店算里存的是**他自己的经营数据**（月度账、成本卡、原料库）。
//   云开发虽然有控制台手动备份，但那是"想起来才点"——一个月忘一次，丢的就是一个月账。
//
// 触发：每月 1 日 10:00（config.json 的 cron `0 0 10 1 * *`）。
//
// 🔴 三条设计红线：
//   ① **时间预算**：云函数最长 60s。每备一个集合检查一次预算，超了就停，
//      把剩下的记进 `pending` 并回报，**宁可只备一半也不许整体超时失败**
//      （整体失败 = 这个月一份都没备，比备一半糟得多）。
//   ② **单个集合失败不拖垮整体**：某张表读失败就记 `failed` 继续下一张。
//   ③ **只读不改**：备份绝不写业务集合，唯一写入是云存储。
//
// 存储布局：`backup/<YYYY-MM>/<collection>.json`
//   每个集合一个文件（不打包成一坨）—— 单文件过大时 uploadFile 会失败，
//   而分文件还能"哪张坏了单独重备"。
'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 备份面：业务数据全备；配置类也备（很小，但丢了重建很麻烦）。
// ⚠️ 排除 `rate_limit_counter`：那是分钟级过期的计数器，备它毫无意义、还天天变。
const SKIP = new Set(['rate_limit_counter']);
const COLLECTIONS = [
  'shop', 'shop_entitlement', 'shop_subscription', 'shop_payment_flow',
  'shop_monthly_account', 'shop_monthly_income', 'shop_monthly_expense',
  'shop_inventory', 'shop_cost_card', 'shop_cost_card_line', 'shop_material',
  'shop_sandbox', 'shop_amortize', 'shop_switch', 'shop_income_item',
  'shop_expense_item', 'shop_stored_value', 'shop_credit_ledger',
  'shop_dish_mapping', 'shop_ai_consent', 'shop_ai_insight',
  'shop_diagnosis_report', 'shop_diagnosis_credit',
  'feature_permissions', 'anomaly_baseline', 'industry_band',
  'audit_log', 'anomaly_config', 'feedback', 'app_config', 'region_config',
  // 🔴 R652：以下 7 个是**首跑守卫当场抓出来的漏备**（B-④ 从建库单源动态比对）。
  //   其中 external_sales_daily（外卖销量）与 revenue_batch（营收批次）是**真实业务数据**，
  //   user / admin_user / admin_login_log / subscription_plan / order_refund 也不能丢。
  //   ⇒ 这就是为什么 B-④ 不从本文件硬抄清单、而是读 initDb 单源：
  //     硬抄的清单会漂，而"少备一张表"平时一点都看不出来，只有灾难那天才知道。
  'user', 'order_refund', 'admin_user', 'admin_login_log',
  'subscription_plan', 'external_sales_daily', 'revenue_batch',
];

const PAGE = 100;        // 单次拉取条数（云开发上限 100）
const MAX_PAGES = 200;   // 单集合最多 2 万行，超了记 truncated（不静默截断）
const BUDGET_MS = 40000; // 40s 预算：留 20s 给收尾和网络抖动

/** 读一个集合的全部行（分页）。返回 {rows, truncated} */
async function readAll(coll) {
  const rows = [];
  let truncated = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await db.collection(coll).skip(p * PAGE).limit(PAGE).get();
    const batch = (res && res.data) || [];
    rows.push.apply(rows, batch);
    if (batch.length < PAGE) break;
    if (p === MAX_PAGES - 1) truncated = true;   // 还有更多但没读完 ⇒ 显式标记
  }
  return { rows, truncated };
}

function stampOf(d) {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  return y + '-' + m;
}

exports.main = async (event) => {
  // 🔴 R652 安全自保（R215 定式）：本函数只允许**定时触发器**调。
  //   有 OPENID 说明是从小程序端（用户）来的 ⇒ 直接拒。
  //   为什么必须自保：备份会写云存储，放开就等于让任何人替我们刷存储账单。
  const ctx = cloud.getWXContext() || {};
  if (ctx.OPENID) {
    return { ok: false, code: 'FORBIDDEN', msg: 'dbBackup 仅允许定时触发' };
  }

  // 允许手动指定月份（补备/演练用），默认当前月
  const now = new Date();
  const stamp = (event && event.month) || stampOf(now);
  const t0 = Date.now();

  const done = [];
  const failed = [];
  const pending = [];
  let totalRows = 0;

  for (let i = 0; i < COLLECTIONS.length; i++) {
    const c = COLLECTIONS[i];
    if (SKIP.has(c)) continue;

    // 🔴 红线①：预算检查必须在**每次开始前** —— 事中检查等于已经卡住了
    if (Date.now() - t0 > BUDGET_MS) {
      pending.push.apply(pending, COLLECTIONS.slice(i).filter((x) => !SKIP.has(x)));
      break;
    }

    try {
      const { rows, truncated } = await readAll(c);
      const payload = JSON.stringify({
        collection: c,
        stamp: stamp,
        row_count: rows.length,
        truncated: truncated,
        backed_up_at: now.getTime(),
        rows: rows,
      });
      const up = await cloud.uploadFile({
        cloudPath: 'backup/' + stamp + '/' + c + '.json',
        fileContent: Buffer.from(payload, 'utf8'),
      });
      done.push({ collection: c, rows: rows.length, file_id: up.fileID, truncated: truncated });
      totalRows += rows.length;
    } catch (e) {
      // 🔴 红线②：单表失败不拖垮整体
      failed.push({ collection: c, error: (e && e.message) || String(e) });
    }
  }

  const ok = failed.length === 0 && pending.length === 0;
  const summary = {
    stamp: stamp,
    ok: ok,
    done: done.length,
    failed: failed.length,
    pending: pending.length,
    total_rows: totalRows,
    elapsed_ms: Date.now() - t0,
    detail: { done: done, failed: failed, pending: pending },
  };

  // 失败/未完成要在函数日志里**极其显眼**（否则"备份跑了"会一直看起来是绿的）
  console.log('[dbBackup] ' + (ok ? '✅' : '🔴') + ' ' + stamp +
    ' done=' + done.length + ' failed=' + failed.length + ' pending=' + pending.length +
    ' rows=' + totalRows + ' ' + (Date.now() - t0) + 'ms');
  if (failed.length) console.error('[dbBackup] 失败集合：' + JSON.stringify(failed));
  if (pending.length) console.error('[dbBackup] 未完成（预算耗尽）：' + JSON.stringify(pending));

  return summary;
};
