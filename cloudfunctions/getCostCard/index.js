// cloudfunctions/getCostCard/index.js —— 批次 3 · POC2 成本卡查询（Controller 层 · 读）
//
// 鉴权中间件（批次 0）→ 校验 → 默认返回「各 card_code 下版本号最大者（最新版本）」；
//   指定 card_code 时返回该卡最新版本详情 + 全部明细行（含净料单位成本快照）。
// 版本只 INSERT 不 UPDATE，最新 = version 最大（无需 is_latest 翻转）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { cardToOutput, lineToOutput } = require('./service');
const { validateInput } = require('./validate');

async function loadLines(da, shopId, card) {
  const res = await da.list('shop_cost_card_line', { shop_id: shopId, cost_card_row_id: card._id });
  return ((res && res.data) || []).map(lineToOutput);
}

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

  // ===== 3. 读该店成本卡（软删自动过滤）=====
  const da = makeAdapter(db);
  // R157：**必须是 listAll（分页取全）** —— `shop_cost_card` 是版本模型（只 INSERT 不 UPDATE），
  //   行数 = Σ(各 card_code 的版本数)。用 list() 时一旦总行数 > 1000（免费档 20 卡 × 50 版即满），
  //   后面的卡会被**静默丢掉**，而列表无排序 ⇒ 丢哪张随机、老板以为数据没了。
  const cardsRes = await da.listAll('shop_cost_card', { shop_id: shopId });

  // 按 card_code 分组，etake version 最大者
  const latestByCode = new Map();
  for (const c of ((cardsRes && cardsRes.data) || [])) {
    const cc = c.card_code;
    if (!cc) continue;
    const cur = latestByCode.get(cc);
    if (!cur || (c.version || 0) > (cur.version || 0)) latestByCode.set(cc, c);
  }

  let targets;
  if (v.card_code) {
    const c = latestByCode.get(v.card_code);
    targets = c ? [c] : [];
  } else {
    targets = Array.from(latestByCode.values());
  }

  const list = [];
  for (const card of targets) {
    const out = cardToOutput(card);
    out.lines = await loadLines(da, shopId, card);
    list.push(out);
  }

  return ok({
    shop_id: shopId,
    // R157：可见降级标记 —— 达到 LIST_TOTAL_CAP（2 万行）仍有剩余时为 true。
    //   正常店铺恒为 false；一旦为 true，说明该店数据量已触护栏 ⇒ 前端可据此提示，
    //   而不是像以前那样"看着少了几张卡"却无从判断。
    truncated: !!cardsRes.truncated,
    client_request_id: v.input.client_request_id || '',
    list,
  });
};