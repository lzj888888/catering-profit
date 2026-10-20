// cloudfunctions/getAiConsent/index.js —— AI 授权（读 · 本店当前授权状态）
//
// 分层（对齐既有先例）：Controller 只做「鉴权 → 归属校验 → 校验 → 取一条 → 交给纯函数判定」。
// 所有状态判定都在 `service.js`（可单测、无 IO），本文件不写一个 if 判断状态。
//
// 🔴 三条前提：
//   ① **「没授权」是正常状态，不是错误** ⇒ 无记录也回 `ok`（`state:'none'`）。
//      回 `fail` 会让首次进授权页的老板看到一个报错弹窗，而他的状态完全正常。
//   ② **懒过期**：不跑定时器、不落"已过期"标记，读的那一刻用 `now` 判（设计稿 §4）。
//      读取时写库会把读变成写，并发下产生无意义写竞争，且过期是时间函数，固化它没有收益。
//   ③ **不写审计**：页面每次打开都会调本函数，写审计会把 `audit_log` 冲成噪声，
//      真正要留痕的是"授权/撤回"这两个动作（写侧已记）。读侧只在库层面留 `updated_at`。
//
// ⚠️ 出参**不含 `user_id`**：读侧只服务本店，前端不需要授权人 id；
//   少回一个敏感字段就少一个外泄面，将来要"授权给店员"再单独设计。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { validateInput } = require('./validate');
const { buildState } = require('./service');

const COLL = 'shop_ai_consent';

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权 + 归属校验 =====
  //   归属校验不能省：授权记录里带 `scope`（授权了哪些能力），
  //   能读别人店的授权 = 能探测"这家店有没有开 AI 功能"。
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. 取记录（一店一份，唯一索引保证最多一条）=====
  const da = makeAdapter(db);
  const found = await da.list(COLL, { user_id: userId, shop_id: v.shop_id });
  const row = (found && found.data && found.data[0]) || null;

  // ===== 4. 纯函数判定（四态 + 条款一致性 + 实际可用能力）=====
  return ok(buildState(row, v.shop_id, nowUtc()));
};
