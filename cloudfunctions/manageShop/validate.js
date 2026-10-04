// cloudfunctions/manageShop/validate.js —— 入参校验（纯函数，独立文件 R56 铁律）
//
// 入参 { op, name?, target_shop_id?, client_request_id? }
//   · op='create'：要 name（店铺名），不要 target（还没有店）
//   · op='rename'：要 target_shop_id + name
//   · op='delete'：要 target_shop_id
//   · R210 新增两个 op（都不需要 name；`reset` 是比 `delete` 轻得多的第二条出口）：
//     · op='stats'：只读清点（这家店有多少个月度账套），供确认框报后果量级
//     · op='reset'：清空这家店的月度账（店铺 / 菜品卡 / 原料**全部保留**）
// 🔴 为什么 target 不走 `shop_id` 字段名：前端 `utils/api.js::call()` 会**无条件注入**当前店的
//    `shop_id`（`Object.assign({shop_id}, payload)`）⇒ 用 `shop_id` 当"目标店"会被静默覆盖成当前店，
//    于是"重命名 A 店"变成"重命名当前店"。故本函数的目标店字段**必须另起名** `target_shop_id`。
const { ERROR_CODES } = require('./common');

const OPS = ['create', 'rename', 'delete', 'reset', 'stats'];
// 不需要店铺名的 op：删除 / 清空 / 清点（都已有目标店，不涉及命名）
const NAMELESS_OPS = ['delete', 'reset', 'stats'];
const NAME_MAX = 20;

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;

  const op = src.op;
  if (OPS.indexOf(op) < 0) return err('op 必须是 create / rename / delete / reset / stats 之一');

  const name = typeof src.name === 'string' ? src.name.trim() : '';
  const target = typeof src.target_shop_id === 'string' ? src.target_shop_id.trim() : '';

  if (NAMELESS_OPS.indexOf(op) < 0) {
    if (!name) return err('name 不能为空');
    if (name.length > NAME_MAX) return err('name 不能超过 ' + NAME_MAX + ' 个字');
  }
  if (op !== 'create' && !target) return err('target_shop_id 必须是非空字符串');

  return {
    error: null,
    op,
    name,
    target_shop_id: target,
    input: { client_request_id: typeof src.client_request_id === 'string' ? src.client_request_id : '' },
  };
}

module.exports = { validateInput, OPS, NAMELESS_OPS, NAME_MAX, ERROR_CODES };
