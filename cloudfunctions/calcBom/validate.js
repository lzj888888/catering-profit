// cloudfunctions/calcBom/validate.js —— 入参校验（纯函数，无云依赖，可单测）。
// 契约（core/10 §3 M3）：calcBom 入参 { nodes:[{id,type,children[],qty,loss_pct,...}] }。
// 本实现接受扁平化「成本卡 + 素材快照」形态，语义对齐核心公式（M3 §3.5）：
//   event.card { lines:[{quantity,net_unit_cost}], auxYuan, loss_pct, mode, batch_output, priceYuan, target_margin_pct }
//   （辅料/售价以「元」入参，Service 内部统一转「分」；或直接以「分」传入 *_fen——两种都收，保证灵活）
// 金额铁律（R27）：所有 *_fen 必须是 JSON number（整数）；字符串一律 INVALID_PARAM 点名。

const { ERROR_CODES, LINE_KINDS } = require('./common');

// line.net_unit_cost 合法形状：非负有限数（可为小数，表示万分/每克快照）
function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');

  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const lines = src.lines || [];
  if (!Array.isArray(lines)) return err('lines 必须是数组');
  const cLines = [];
  for (const ln of lines) {
    if (!isFiniteNum(ln.quantity) || ln.quantity < 0) return err('明细行 quantity 必须是非负 number（克或份）');
    if (!isFiniteNum(ln.net_unit_cost) || ln.net_unit_cost < 0) {
      return err('明细行 net_unit_cost 必须是非负 number（净料单位成本快照）');
    }
    // M3.14（R150）：组件类型 —— **必须原样保留**，它是多规格缩放的唯一依据。
    //   ⚠️ 这里曾经把行"洗成" {quantity, net_unit_cost} 两项；那样一洗，半份的「调料不减半」
    //      会静默退化成"全部减半"（成本算错而界面毫无异常）⇒ 加入白名单并**校验非法值**。
    const rawKind = (ln.line_kind === undefined || ln.line_kind === null) ? '' : String(ln.line_kind);
    if (rawKind && LINE_KINDS.indexOf(rawKind) < 0) {
      return err(`明细行 line_kind 非法（当前值：${JSON.stringify(rawKind)}；合法值：${LINE_KINDS.join('/')}）`);
    }
    cLines.push({ quantity: ln.quantity, net_unit_cost: ln.net_unit_cost, line_kind: rawKind || 'main' });
  }

  // 辅料 / 售价：支持「元」或「分」，内部统一转分。优先 *_fen（分），否则 *_yuan（元）。
  const fenOrYuan = (pv) => {
    if (typeof pv === 'number') return pv; // 已是分
    return -1; // 缺失/非法 → 上层回落 yuan
  };
  // 🔴 R298（B2）：**十进制安全** —— 原式 `Math.round(<元> * 100)` 在半步（真值恰为 x.xx5）会
  //   **少进 1 分**（实测 qty=0.1 × 净料 14500 万分之元 ⇒ 真值 14.5 分，原式取 14）。根因与
  //   `money.yuanToFen` 同一处浮点：`toFixed(10)` 只消 1e-13 量级噪声、不动真实半步。
  //   成本引擎三副本（calcBom / saveCostCard / syncCostCard）**必须同源同口径**。
  const auxFen = isFiniteNum(src.aux_fen) ? src.aux_fen : (isFiniteNum(src.auxYuan) ? Math.round(Number((src.auxYuan * 100).toFixed(10))) : 0);
  const priceFen = isFiniteNum(src.price_fen) ? src.price_fen : (isFiniteNum(src.priceYuan) ? Math.round(Number((src.priceYuan * 100).toFixed(10))) : 0);
  if (!Number.isInteger(auxFen) || auxFen < 0) return err('辅料分摊必须是非负整数分');
  if (!Number.isInteger(priceFen) || priceFen < 0) return err('建议售价必须是非负整数分');

  // R81：mode 白名单（与 saveCostCard/validate.js 同口径）—— 非法值响亮拒，禁止静默兜底 A。
  // 兜底会让「预览成本」按 A 算而「保存」按 B 存（或反之）⇒ 页面预览与落库结果不一致。
  if (src.mode !== 'A' && src.mode !== 'B') {
    return err('card.mode 必须是 "A" 或 "B"（当前值：' + JSON.stringify(src.mode === undefined ? null : src.mode) + '）');
  }
  const mode = src.mode;
  const batchOutput = (mode === 'B' && Number.isInteger(src.batch_output) && src.batch_output > 0) ? src.batch_output : 0;
  if (mode === 'B' && !(batchOutput > 0)) return err('模式 B 必须提供 batch_output（>0 的整数份数）');

  const lossPct = isFiniteNum(src.loss_pct) ? src.loss_pct : 0;
  if (lossPct < 0 || lossPct >= 100) return err('制作损耗率 loss_pct 必须 ∈ [0,100)（%）');

  const targetMarginPct = isFiniteNum(src.target_margin_pct) ? src.target_margin_pct : 0;

  // M3.15（R150）多规格试算（**可选**）：`spec_keys` = 要试算的规格机器键数组；
  //   `spec_prices` = { spec_key: 该规格售价(整数分) }（可选，缺省按 0 ⇒ 只出成本与建议价）。
  //   ⚠️ 契约：**不给 spec_keys ⇒ 出参与原契约逐字节相同**（既有调用方零感知）。
  const SPEC_PRESETS = require('./common').SPEC_PRESETS;
  let specKeys = [];
  if (src.spec_keys !== undefined && src.spec_keys !== null) {
    if (!Array.isArray(src.spec_keys)) return err('spec_keys 必须是数组');
    for (const k of src.spec_keys) {
      if (typeof k !== 'string' || !k.trim()) return err('spec_keys 里的每一项都必须是非空字符串');
      const key = k.trim();
      if (!SPEC_PRESETS.some((p) => p.spec_key === key)) {
        return err(`未知规格 spec_key：${JSON.stringify(key)}（内置规格：${SPEC_PRESETS.map((p) => p.spec_key).join('/')}）`);
      }
      if (specKeys.indexOf(key) < 0) specKeys.push(key);
    }
    if (specKeys.length > SPEC_PRESETS.length) return err('spec_keys 条数超出内置规格数');
  }
  const specPrices = {};
  const rawPrices = src.spec_prices;
  if (rawPrices !== undefined && rawPrices !== null) {
    if (typeof rawPrices !== 'object' || Array.isArray(rawPrices)) return err('spec_prices 必须是对象');
    for (const k of Object.keys(rawPrices)) {
      const pv = rawPrices[k];
      if (!isFiniteNum(pv) || !Number.isInteger(pv) || pv < 0) return err(`spec_prices.${k} 必须是非负整数分`);
      specPrices[k] = pv;
    }
  }
  // 🔴 R547（M1）：`spec_portions` = { spec_key: 这一份多少克 }。**只有 per100g 用得上**。
  //   为什么必须由入参送、不能从卡里读：本函数是**纯计算**，卡数据由调用方（页面）own；
  //   而克重是"这张卡这一份多重"的用户事实，不是引擎常量。
  //   ⚠️ 只认 `spec_keys` 里请求过的键（多余的静默忽略，与 spec_prices 同律）；
  //     值非法（≤0 / 非数）**直接报错**而不是静默按整份算 —— 静默按整份就是本缺陷的原样。
  const specPortions = {};
  const rawPortions = src.spec_portions;
  if (rawPortions !== undefined && rawPortions !== null) {
    if (typeof rawPortions !== 'object' || Array.isArray(rawPortions)) return err('spec_portions 必须是对象');
    for (const k of Object.keys(rawPortions)) {
      if (specKeys.indexOf(k) < 0) continue;
      const gv = rawPortions[k];
      if (!isFiniteNum(gv) || !(gv > 0)) return err(`spec_portions.${k} 必须是大于 0 的克数`);
      specPortions[k] = gv;
    }
  }

  return {
    error: null,
    shop_id: src.shop_id,
    card: {
      mode,
      lines: cLines,
      auxFen,
      lossPct,
      batchOutput,
      priceFen,
      targetMarginPct,
    },
    spec_keys: specKeys,
    spec_prices: specPrices,
    spec_portions: specPortions,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };