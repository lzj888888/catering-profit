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
const { comboInsight } = common.comboDerive;         // M3.16 套餐（派生层单源）
const { cardToOutput, groupLinesByCard } = require('./service');
const { validateInput } = require('./validate');

// 🔴 R547（M6）：原来这里是 `loadLines` 的**逐卡**版本（在 for 循环里 await），N 张卡 = N 次串行查询
//   ⇒ 20 张卡要 21 次库往返（本函数还要 listAll 全部版本行，本身就慢），手机端首屏肉眼可见地卡。
//   改为**一次取全店明细行 + 内存按 `cost_card_row_id` 分组**（纯函数 `groupLinesByCard` 在 service.js，
//   那条才是能被 node 自测覆盖的地方 —— 放这里 require 了 wx-server-sdk，本机根本跑不起来）。
//   三点必须同时成立才算修好：
//     ① 每张卡仍只拿自己的行（分组键 = 行的 `cost_card_row_id`，与卡 `_id` 对齐）；
//     ② 行**顺序不变**（按库返回顺序 append，不排序 —— 排序属于展示层）；
//     ③ 取全用 `listAll`（短页判据确认到底）而非 `list`（单页 1000）⇒ 顺带消掉「单卡明细 >1000 行静默截断」；
//        且 `truncated` 必须透传到出参（达到 2 万行护栏时仍然显式降级，绝不静默少给）。
//   判据不是"少了几次 await"，而是**行为不变**：`getCostCard/selftest.js` 的 G 组对拍同一份数据。

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

  // M3.16（批次 C）：全版本映射（card_code#version → card），套餐装配子卡版本用。
  const byVersion = new Map();
  for (const c of ((cardsRes && cardsRes.data) || [])) {
    if (!c.card_code) continue;
    byVersion.set(String(c.card_code) + '#' + (c.version || 0), c);
  }

  // 🔴 R547（M6）：**一次**取全店明细行（见 groupLinesByCard 头注）。空店也要能过（返回空 Map）。
  const linesRes = await da.listAll('shop_cost_card_line', { shop_id: shopId });
  const linesByRow = groupLinesByCard((linesRes && linesRes.data) || []);

  const list = [];
  for (const card of targets) {
    const out = cardToOutput(card);
    // 🔴 R309：成本变动提醒 —— 同一 card_code 的**上一个版本**的单份成本。
    //   为什么在这里算：`shop_cost_card` 只 INSERT 不 UPDATE（版本模型），本函数手里已有**全部版本**
    //   （`da.listAll` 取全）⇒ 顺手带出去，前端不用再逐张查 `getCardVersions`（N 次调用）。
    //   版本号可能**不连续**（1,2,5）⇒ 取「version 小于当前的最大者」，不能死算 version-1。
    //   没有上一版 ⇒ `null`（**不是 0**：0 会被读成"上版成本是 0"，等于虚报涨幅）。
    let prevCost = null;
    for (const [k, v] of byVersion) {
      const m = /^(.*)#(\d+)$/.exec(k);
      if (!m || m[1] !== String(card.card_code)) continue;
      const ver = Number(m[2]);
      if (ver >= (Number(card.version) || 1)) continue;
      if (prevCost === null || ver > prevCost.ver) {
        prevCost = { ver, cost: v.total_cost != null ? v.total_cost : null };
      }
    }
    out.prev_total_cost_fen = prevCost && prevCost.cost != null ? prevCost.cost : null;
    out.lines = linesByRow.get(card._id) || [];
    // M3.16 套餐：装配三个显示信息（顾客省 / 我少赚 / 成本结构）。
    //   子卡单份成本与挂牌价取**锁定版本**（sub_version）的子卡 doc；子卡已软删 ⇒ 回退明细行快照。
    if (out.card_type === 3) {
      const subCards = out.lines
        .filter((l) => l.line_type === 2 && l.sub_card_ref)
        .map((l) => {
          const sub = byVersion.get(String(l.sub_card_ref) + '#' + (l.sub_version || 0));
          return {
            name: (sub && sub.name) || (l.material_name || ''),
            unit_cost_fen: (sub && sub.total_cost != null) ? sub.total_cost : Math.round((l.net_unit_cost || 0) / 100),
            price_fen: (sub && sub.price_list != null) ? sub.price_list : 0,
            quantity: l.quantity,
          };
        });
      out.combo = comboInsight(subCards, out.price_fen, out.total_cost_fen);
    }
    list.push(out);
  }

  return ok({
    shop_id: shopId,
    // R157：可见降级标记 —— 达到 LIST_TOTAL_CAP（2 万行）仍有剩余时为 true。
    //   正常店铺恒为 false；一旦为 true，说明该店数据量已触护栏 ⇒ 前端可据此提示，
    //   而不是像以前那样"看着少了几张卡"却无从判断。
    //   🔴 R547（M6）：成本卡与**明细行**两条读取都可能触护栏 ⇒ 两个 truncated 取或，缺一条就会
    //   "卡齐了、行少了"而页面显示一切正常（静默少料 = 成本偏低）。
    truncated: !!cardsRes.truncated || !!(linesRes && linesRes.truncated),
    client_request_id: v.input.client_request_id || '',
    list,
  });
};