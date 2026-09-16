// cloudfunctions/calcBom/validate.js —— 入参校验（纯函数，无云依赖，可单测）。
// 契约（core/10 §3 M3）：calcBom 入参 { nodes:[{id,type,children[],qty,gross_loss_pct,...}] }。
// 本实现接受扁平化「成本卡 + 素材快照」形态，语义对齐核心公式（M3 §3.5）：
//   event.card { lines:[{quantity,net_unit_cost}], auxYuan, loss_pct, mode, batch_output, priceYuan, target_margin_pct }
//   （辅料/售价以「元」入参，Service 内部统一转「分」；或直接以「分」传入 *_fen——两种都收，保证灵活）
// 金额铁律（R27）：所有 *_fen 必须是 JSON number（整数）；字符串一律 INVALID_PARAM 点名。

const { ERROR_CODES } = require('./common');

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
    cLines.push({ quantity: ln.quantity, net_unit_cost: ln.net_unit_cost });
  }

  // 辅料 / 售价：支持「元」或「分」，内部统一转分。优先 *_fen（分），否则 *_yuan（元）。
  const fenOrYuan = (pv) => {
    if (typeof pv === 'number') return pv; // 已是分
    return -1; // 缺失/非法 → 上层回落 yuan
  };
  const auxFen = isFiniteNum(src.aux_fen) ? src.aux_fen : (isFiniteNum(src.auxYuan) ? Math.round(src.auxYuan * 100) : 0);
  const priceFen = isFiniteNum(src.price_fen) ? src.price_fen : (isFiniteNum(src.priceYuan) ? Math.round(src.priceYuan * 100) : 0);
  if (!Number.isInteger(auxFen) || auxFen < 0) return err('辅料分摊必须是非负整数分');
  if (!Number.isInteger(priceFen) || priceFen < 0) return err('建议售价必须是非负整数分');

  const mode = src.mode === 'B' ? 'B' : 'A';
  const batchOutput = (mode === 'B' && Number.isInteger(src.batch_output) && src.batch_output > 0) ? src.batch_output : 0;
  if (mode === 'B' && !(batchOutput > 0)) return err('模式 B 必须提供 batch_output（>0 的整数份数）');

  const lossPct = isFiniteNum(src.loss_pct) ? src.loss_pct : 0;
  if (lossPct < 0 || lossPct >= 100) return err('制作损耗率 loss_pct 必须 ∈ [0,100)（%）');

  const targetMarginPct = isFiniteNum(src.target_margin_pct) ? src.target_margin_pct : 0;

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
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };