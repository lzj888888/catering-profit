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
  const cardsRes = await da.list('shop_cost_card', { shop_id: shopId });

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
    client_request_id: v.input.client_request_id || '',
    list,
  });
};