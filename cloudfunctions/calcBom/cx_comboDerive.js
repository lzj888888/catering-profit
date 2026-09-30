// cloudfunctions/common/comboDerive.js —— M3.16 套餐（引用型成本卡）派生层**单源**
//
// 依据：`specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.16。
//
// 🔴 红线（三条，与同目录 specDerive.js 同族）：
//   ① 本文件**不得被内联进任何一份 `service.js`** —— 只此一份 + 由 `tools/sync_common.js`
//      派生的扁平副本（`<func>/cx_comboDerive.js`）。**5 份引擎副本一个都不碰。**
//   ② **本文件不返回要落库的套餐成本** —— `buildComboLines` 只做「子卡成本分 → 万分尺度」的
//      入参变换（喂给 `calcCostCard` 引擎算成本）；`comboInsight` 只返回**展示信息**
//      （顾客省 / 我少赚 / 成本占比），三者都不含套餐 `total_cost`。套餐成本由引擎产出、Controller 落库。
//   ③ **纯函数、无 IO** —— 不碰 DB、不碰 wx-server-sdk、不碰前端请求。
//
// 为什么「套餐」唯一允许的实现形式是**入参变换**：
//   套餐行在引擎眼里与原料行**形状相同**（引擎只读 `quantity` + `net_unit_cost`）。
//   把「子卡单份成本(分) × 100」当作 `net_unit_cost`（万分整数，1 分 = 100 万分）、
//   `quantity` = 份数，喂**同一个** `calcCostCard` ⇒ 引擎一行不改、BOM 仍是两层、
//   套餐站在 BOM 之外（不被任何卡引用，禁套餐含套餐）。

// 子卡单份成本（分）→ 万分整数（net_unit_cost 尺度）。1 分 = 100 万分。
function fenToWan(unitCostFen) {
  return Math.round((Number(unitCostFen) || 0) * 100);
}

/**
 * 把子卡列表变换成「引擎可吃的明细行」（入参变换，不计算成本）。
 * @param {Array<{card_code?:string, sub_card_ref?:string, name?:string, unit_cost_fen:number, quantity:number, version?:number}>} subCards
 *   每项 = 一个被引用的子卡：unit_cost_fen = 子卡**锁定版本**的单份成本（整数分）；
 *   quantity = 份数；version = 锁定的版本号（sub_version）。
 * @returns {Array} lines —— 每行 { quantity, net_unit_cost, material_id:'', material_name, line_type:2, sub_card_ref, sub_version }
 *   引擎只读 quantity + net_unit_cost，其余字段供 Controller 落快照。
 */
function buildComboLines(subCards) {
  return (Array.isArray(subCards) ? subCards : []).map((sc) => {
    const ref = String((sc && (sc.sub_card_ref || sc.card_code)) || '');
    return {
      quantity: Number(sc && sc.quantity) || 0,
      net_unit_cost: fenToWan(sc && sc.unit_cost_fen),
      material_id: '',                                  // 子卡行无原料 id（引用型）
      material_name: String((sc && sc.name) || ''),
      line_type: 2,                                     // 2 = 子卡行（1 = 原料行）
      sub_card_ref: ref,                                // 被引用卡逻辑卡号（实现字段名 card_code）
      sub_version: Number(sc && sc.version) || 0,       // 锁定版本号（D5 锁版本）
    };
  });
}

/**
 * 套餐三个展示信息（顾客省 / 我少赚 / 成本结构）。纯函数、只读展示，不落库。
 * @param {Array<{name?:string, unit_cost_fen:number, price_fen:number, quantity:number}>} subCards
 *   每项：unit_cost_fen = 子卡单份成本（分）；price_fen = 子菜单点挂牌价（分）；quantity = 份数。
 * @param {number} comboPriceFen 套餐售价（整数分）
 * @param {number} [comboCostFen] 套餐真实成本（整数分，含辅料/损耗后的 total_cost）。
 *   缺省时用 Σ(unit_cost_fen × quantity)（纯明细口径 —— 套餐无辅料损耗时二者相等）。
 * @returns {{customerSaveFen:number, merchantLoseFen:number, costShare:Array}}
 *   customerSaveFen  = Σ 子菜单点挂牌价 − 套餐售价（正数 = 顾客省了）
 *   merchantLoseFen  = 套餐毛利 − Σ 子菜单点毛利（**负数 = 套餐在拉低毛利**，前端红字提示）
 *   costShare[]      = 各子菜贡献的成本占比（share_pct 基于套餐真实成本）
 */
function comboInsight(subCards, comboPriceFen, comboCostFen) {
  const priceFen = Number(comboPriceFen) || 0;
  const list = (Array.isArray(subCards) ? subCards : []).map((sc) => ({
    name: String((sc && sc.name) || ''),
    unit_cost_fen: Number((sc && sc.unit_cost_fen)) || 0,
    price_fen: Number((sc && sc.price_fen)) || 0,
    quantity: Number((sc && sc.quantity)) || 0,
  }));

  // 明细成本（Σ 子卡成本 × 份数）—— 无辅料损耗口径；调用方可传真实 total_cost 覆盖
  const detailCostFen = list.reduce((s, x) => s + x.unit_cost_fen * x.quantity, 0);
  const costFen = (comboCostFen !== undefined && Number.isFinite(Number(comboCostFen)))
    ? Number(comboCostFen)
    : detailCostFen;

  // 顾客省 = Σ 单点挂牌价 − 套餐售价
  const alaCarteSumFen = list.reduce((s, x) => s + x.price_fen * x.quantity, 0);
  const customerSaveFen = Math.round(alaCarteSumFen - priceFen);

  // 单点毛利合计 = Σ(挂牌价 − 单份成本) × 份数
  const alaCarteProfitFen = list.reduce((s, x) => s + (x.price_fen - x.unit_cost_fen) * x.quantity, 0);
  // 套餐毛利 = 售价 − 套餐真实成本
  const comboProfitFen = priceFen - costFen;
  // 我少赚 = 套餐毛利 − 单点毛利合计（负数 = 拉低毛利）
  const merchantLoseFen = Math.round(comboProfitFen - alaCarteProfitFen);

  // 成本结构 = 各子菜成本占比（基于套餐真实成本）
  const costShare = list.map((x) => ({
    name: x.name,
    unit_cost_fen: x.unit_cost_fen,
    quantity: x.quantity,
    line_cost_fen: Math.round(x.unit_cost_fen * x.quantity),
    share_pct: costFen > 0 ? Math.round((x.unit_cost_fen * x.quantity / costFen) * 10000) / 100 : 0,
  }));

  return { customerSaveFen, merchantLoseFen, costShare };
}

/**
 * 子卡引用校验（纯函数，Controller 读子卡 doc 后调用；不碰 DB）。
 * @param {object} subCard 套餐明细里的子卡引用（含 sub_card_ref）
 * @param {object|null} resolvedCard 已解析的子卡 doc（含 card_type / is_deleted / shop_id）
 * @returns {{ok:true, card:object}|{ok:false, code:string}}
 *   code = 'COMBO_NEST_NOT_ALLOWED'（子卡是套餐 = 引套餐 / 被套餐引）
 *        | 'SUB_CARD_VERSION_INVALID'（版本不存在 / 已软删 / 非本店）
 */
function judgeComboRef(subCard, resolvedCard) {
  if (!resolvedCard) return { ok: false, code: 'SUB_CARD_VERSION_INVALID' };
  if (resolvedCard.is_deleted) return { ok: false, code: 'SUB_CARD_VERSION_INVALID' };
  if (resolvedCard.card_type === 3) return { ok: false, code: 'COMBO_NEST_NOT_ALLOWED' };
  return { ok: true, card: resolvedCard };
}

module.exports = {
  fenToWan,
  buildComboLines,
  comboInsight,
  judgeComboRef,
};
