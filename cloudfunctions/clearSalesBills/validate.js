// cloudfunctions/clearSalesBills/validate.js —— 入参校验（纯函数）。
// 契约（core/10）：clearSalesBills 入参
//   { shop_id, targets?:[{platform,biz_date,kind?}], all?:bool, confirm_all?:bool, client_request_id }
//
// 🔴 三道 fail-closed：
//   ① targets 与 all 二选一，**不许都空**（空 = 无事可做，静默成功是坏语义）；
//   ② `all:true` 必须 `confirm_all:true` 同现（全清是危险操作，防误触把整店销量清空）；
//   ③ targets 每项 platform + biz_date 必填且格式合规（否则删错目标 = 不可逆的脏数据）。
const { ERROR_CODES } = require('./common');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['bill', 'dish'];

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const all = src.all === true;
  const confirmAll = src.confirm_all === true;
  const rawTargets = Array.isArray(src.targets) ? src.targets : [];

  if (!all && rawTargets.length === 0) return err('请指定要清除的账单（targets）或选择全部清除（all）');
  if (all && !confirmAll) return err('全部清除需要二次确认（confirm_all）');
  if (all && rawTargets.length > 0) return err('targets 与 all 只能二选一');

  const targets = [];
  for (let i = 0; i < rawTargets.length; i++) {
    const t = rawTargets[i] || {};
    if (typeof t.platform !== 'string' || !t.platform) return err(`targets[${i}].platform 必填`);
    if (typeof t.biz_date !== 'string' || !DATE_RE.test(t.biz_date)) {
      return err(`targets[${i}].biz_date 必须是 YYYY-MM-DD`);
    }
    const kind = (typeof t.kind === 'string' && t.kind) ? t.kind : '';
    if (kind && KINDS.indexOf(kind) < 0) return err(`targets[${i}].kind 只能是 bill / dish`);
    targets.push({ platform: t.platform, biz_date: t.biz_date, kind });
  }

  return {
    error: null,
    shop_id: src.shop_id,
    all,
    confirm_all: confirmAll,
    targets,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES, DATE_RE, KINDS };
