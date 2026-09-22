// cloudfunctions/saveAsset/validate.js —— 入参校验（纯函数）。
// 入参 { shop_id, asset:{asset_id?,name,value_fen,start_month,total_months,terminate_month?,group_id?,batch_seq?}, terminate?:bool, client_request_id }。
// ⚠️ H1（批次 8c）：同一资产多次采购 —— 「追加采购」= 另起一行资产（独立起摊），用 group_id 归到同一组、
//   batch_seq 标记是该资产第几笔。摊销引擎（calcAmortize / saveLedger）**零改动**：每笔各自是一行资产，
//   现有「逐行独立尾差倒挤」规则天然满足「新增采购也单独摊」。
const { ERROR_CODES } = require('./common');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const a = src.asset;
  if (!a || typeof a !== 'object') return err('asset 必须是对象');

  // round107：**删除分支**（一次性投入记错了要能删）。只认 asset_id + delete:true，
  //   **不要求**其余字段 —— 删除请求里没有 name/value_fen/start_month，
  //   若先走下面的字段校验必然被误拒。
  if (a.delete === true) {
    if (typeof a.asset_id !== 'string' || !a.asset_id) return err('删除时必须带 asset_id');
    return {
      error: null, shop_id: src.shop_id, remove: true,
      asset: { asset_id: a.asset_id, mode: '' },
      input: { client_request_id: src.client_request_id || '' },
    };
  }
  if (typeof a.name !== 'string' || !a.name.trim()) return err('asset.name 必须是非空字符串');
  if (typeof a.value_fen !== 'number' || !Number.isInteger(a.value_fen) || a.value_fen <= 0) {
    return err('asset.value_fen 必须是正整数分（JSON number；不接受字符串、0 与负数）');
  }
  if (typeof a.start_month !== 'string' || !MONTH_RE.test(a.start_month)) return err('asset.start_month 必须是 YYYY-MM');
  if (typeof a.total_months !== 'number' || !Number.isInteger(a.total_months) || a.total_months < 1) {
    return err('asset.total_months 必须是 ≥1 的整数');
  }
  const terminate_month = (typeof a.terminate_month === 'string' && a.terminate_month) ? a.terminate_month : '';
  if (terminate_month && !MONTH_RE.test(terminate_month)) return err('asset.terminate_month 必须是 YYYY-MM 或留空');

  // H1：分组字段（可选）。group_id 是「同一资产的多次采购」归组键；batch_seq 是该组内第几笔（≥1 整数）。
  //   缺省时：group_id = ''（独立资产，前端把自身 asset_id 当作组键）、batch_seq = 1。
  const group_id = (typeof a.group_id === 'string' && a.group_id.trim()) ? a.group_id.trim() : '';
  let batch_seq = 1;
  if (a.batch_seq !== undefined && a.batch_seq !== null) {
    if (typeof a.batch_seq !== 'number' || !Number.isInteger(a.batch_seq) || a.batch_seq < 1) {
      return err('asset.batch_seq 必须是 ≥1 的整数（JSON number；不接受字符串与 0）');
    }
    batch_seq = a.batch_seq;
  }
  // round107：`mode` —— 这笔投入**怎么进利润表**，唯一真相在这一行（不由店铺级开关决定）：
  //   'amort'（缺省；老数据没有这个字段，一律按它处理）= 分期摊销，按 total_months 摊开；
  //   'lump'  = 一次算清，只在 start_month 那一个月全额进当月费用。
  //   两类**可以同时存在**（李老师真机反馈：一个月既有一笔摊销、又有几笔小额一次算清）。
  const mode = (a.mode === 'lump') ? 'lump' : 'amort';

  // 自指组键（group_id === 自己）无意义且会让前端分组自相矛盾 → 拒，迫使前端传真实父键
  if (group_id && group_id === a.asset_id) return err('asset.group_id 不能等于自身 asset_id');

  return {
    error: null,
    shop_id: src.shop_id,
    asset: {
      asset_id: (typeof a.asset_id === 'string' && a.asset_id) ? a.asset_id : '',
      name: a.name.trim(),
      value_fen: a.value_fen,
      start_month: a.start_month,
      total_months: a.total_months,
      terminate_month,
      group_id,
      batch_seq,
      mode,
    },
    input: { client_request_id: src.client_request_id || '' },
  };
}
module.exports = { validateInput, MONTH_RE, ERROR_CODES };