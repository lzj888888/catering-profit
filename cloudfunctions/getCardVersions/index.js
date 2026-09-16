// cloudfunctions/getCardVersions/index.js —— 批次 4 · M3 成本卡版本历史（Controller 层 · 读）
//
// 返回指定 card_code 的**全部历史版本**（倒序，版本号大者在前），每版含总成本 + 明细行快照。
// ⚠️ 只读、只 INSERT 不 UPDATE 的版本模型下，历史版本永不改写，天然符合"SNAPSHOT_IMMUTABLE"语义。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { cardToOut, lineToOut } = require('./service');
const { validateInput } = require('./validate');

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

  const da = makeAdapter(db);
  const cardsRes = await da.list('shop_cost_card', { shop_id: shopId, card_code: v.card_code });
  const rows = ((cardsRes && cardsRes.data) || []).sort((a, b) => (b.version || 0) - (a.version || 0));

  const list = [];
  for (const card of rows) {
    const lineRes = await da.list('shop_cost_card_line', { shop_id: shopId, cost_card_row_id: card._id });
    const out = cardToOut(card);
    out.lines = ((lineRes && lineRes.data) || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(lineToOut);
    list.push(out);
  }

  return ok({
    shop_id: shopId,
    card_code: v.card_code,
    list,
    client_request_id: v.input.client_request_id || '',
  });
};

exports.ER = ERROR_CODES;