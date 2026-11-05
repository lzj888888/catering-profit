// cloudfunctions/getCostCard/resolve.js —— 纯函数：成本卡「生效卡」解析（M3 优化 P0-0 护栏）
//
// 为什么单独成文件（不放 index.js / service.js）：
//   1) 纯函数、node 直跑、可被 selftest 覆盖（不放 index 是因为那里 require 了 wx-server-sdk，本机跑不起）；
//   2) 连锁后期（P2）只在此处加 merge（总部标准卡 → 门店覆盖层），所有消费方
//      （getCostCard / syncCostCard / P1 毛利告警 / 破线联动）零改动即可获得连锁能力。
//
// 🔴 红线（双顾问 Round-6 硬约束，2026-10-29 质证结论）：
//   (a) fail-closed 必须落在此入口，绝不落在存卡层。缺原料/缺参数/非法 ⇒ 返回 trustworthy:false + missing 明细，
//       禁止用 0 / 默认值 / 旧缓存凑数算毛利（否则产 0 成本假数据，比没告警坑更大）。
//   (b) 任何成本计算不得绕过本入口直接读原始卡（门禁断言：改任一处计算必须仍经 resolveEffectiveCards 取卡）。
//
// 🔧 扩展位（现在不做连锁也要现在留，避免后期改返回形状牵连消费方）：
//   - shopId 从第一天就显式传入；连锁后期按此维度做 merge，调用方不变。
//   - resolveEffectiveCards 返回 Map<card_code, doc>；连锁后期在 doc 内追加 standard_cost_fen / diff_reason（单店期填空）。
//   - opts.chainMerge 预留注入点（{ standardByCode, overridesByCode }），单店期不传。

// 按 card_code 取版本最大者（版本自然数递增，只 INSERT 不 UPDATE）。
function pickLatestByCode(cardDocs) {
  const latestByCode = new Map();
  for (const c of (cardDocs || [])) {
    const cc = c && c.card_code;
    if (!cc) continue; // 缺 card_code 的行丢弃（与 groupLinesByCard 孤儿行处理一致）
    const cur = latestByCode.get(cc);
    if (!cur || (c.version || 0) > (cur.version || 0)) latestByCode.set(cc, c);
  }
  return latestByCode;
}

// 解析某店全部生效卡。
// shopId：必填（连锁后期按此维度 merge），当前仅作上下文/扩展位占位。
// opts（预留）：{ chainMerge: { standardByCode, overridesByCode } } 连锁后期注入，单店期不传。
function resolveEffectiveCards(cardDocs, shopId, opts) {
  const base = pickLatestByCode(cardDocs);
  if (opts && opts.chainMerge) {
    // TODO(P2 连锁)：在此合并 standardByCode / overridesByCode，
    // 对 base 中每个 doc 追加 standard_cost_fen、diff_reason（与本店实际成本对比）。
    // 调用方（getCostCard / 告警 / 破线）读取此二字段即可，无需改自身逻辑。
  }
  return base;
}

// 取单张生效卡（详情模式）。
function resolveEffectiveCard(cardDocs, shopId, cardCode, opts) {
  const byCode = resolveEffectiveCards(cardDocs, shopId, opts);
  return cardCode ? (byCode.get(cardCode) || null) : null;
}

// fail-closed 资产：评估一张卡的成本「可信度」。
// 入参 cardDoc 来自 resolveEffectiveCards，lineDocs 来自 groupLinesByCard（同一张卡的行数组）。
// 返回 { trustworthy, missing:[...] }：
//   - 无任何明细行 ⇒ 不可信，缺 '明细行'；
//   - 明细行全为「用量空/0/负 或 净料单位成本为 0」⇒ 不可信，缺对应原料用量/成本（与 P0-3 容错一致）。
// 消费方（毛利告警 / 破线联动 / 首屏）见到 trustworthy:false 必须显「--」或「待完善」，禁止凑数。
function assessCardTrust(cardDoc, lineDocs) {
  const missing = [];
  const lines = Array.isArray(lineDocs) ? lineDocs : [];
  if (lines.length === 0) missing.push('明细行');
  let hasValidLine = false;
  for (const ln of lines) {
    const qty = Number(ln && ln.quantity) || 0;
    const wan = Number(ln && ln.net_unit_cost) || 0;
    if (qty > 0 && wan > 0) { hasValidLine = true; break; }
  }
  if (lines.length > 0 && !hasValidLine) missing.push('有效用量/成本');
  return { trustworthy: missing.length === 0, missing };
}

module.exports = {
  pickLatestByCode,
  resolveEffectiveCards,
  resolveEffectiveCard,
  assessCardTrust,
};
