#!/usr/bin/env node
// tools/check_pay_flow_contract.js —— 订单流水「跨函数字段/状态契约」守卫（2026-11-24 · R1 修复配套）
//
// ============ 为什么要有这条（真实缺陷，不是假想）============
// 下单侧 `payCreateOrder` 写的是 `{ amount: <分>, status: 'pending' }`（小写）；
// 发货侧 `xpayNotify` 原先读 `order.amount_fen`、并按 `status: 'PENDING'`（大写）做 CAS 条件。
//   ⇒ 真回调第一笔：Number(undefined)=NaN ⇒ 恒 PLAN_MISMATCH（付了钱发不出货）；
//   ⇒ 就算补上金额，`'pending' ≠ 'PENDING'` ⇒ CAS 命中不了 ⇒ 状态机跨态报错，
//     而权益已在发权益步骤给过 ⇒ 每次重试再发一次（最多放大 15 倍）。
// 而 `xpayNotify/selftest.js` 41 条**全绿**——因为夹具自己写死 `amount_fen` / `'PENDING'`，
//   等于自己给自己出标准答案。同族病：**两端各测各的，没人把「写进去的词」和「读出来的词」摆一起比**。
//
// ============ 判据（每条都配反恒真坏样本）============
//   S1 四个扫描面文件存在且非空（防改路径后判据恒真）
//   C1 发货侧读金额必须 `amount` 与 `amount_fen` 两种都认（下单侧写的是前者）
//   C2 发货侧比较状态前必须归一化（normStatus / toUpperCase）
//   C3 Controller 写 DB 的状态必须过 toDbStatus（不许把大写常量直接写进 update）
//   C4 前端订单页 statusText 必须认得 'delivered'（否则真付费用户显示「手动开通」）
//
// 运行：node tools/check_pay_flow_contract.js   （EXIT 0 = 全绿）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; } };

const F_PAY_CREATE = 'cloudfunctions/payCreateOrder/index.js';   // 写订单（字段真相源）
const F_PAY_CREATE_SVC = 'cloudfunctions/payCreateOrder/service.js'; // 订单对象的生成处（状态字面量在此）
const F_SERVICE = 'cloudfunctions/xpayNotify/service.js';        // 发货内核（读订单）
const F_CTRL = 'cloudfunctions/xpayNotify/index.js';             // 发货 Controller（写 DB）
const F_ORDERS = 'subpkg/tools/pay/orders.js';                   // 前端订单页（展示状态）

const src = {
  payCreate: read(F_PAY_CREATE),
  payCreateSvc: read(F_PAY_CREATE_SVC),
  service: read(F_SERVICE),
  ctrl: read(F_CTRL),
  orders: read(F_ORDERS),
};

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); } else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('===== 订单流水跨函数契约守卫（R1）=====');

// ---------- 判据函数（抽出来，便于对坏样本反恒真）----------
// C1：金额读取必须两种字段都认
const c1Ok = (svc) => /order\.amount_fen/.test(svc) && /order\.amount\b/.test(svc);
// C2：状态比较前归一化
const c2Ok = (svc) => /function\s+normStatus|const\s+normStatus\s*=/.test(svc) && /normStatus\s*\(\s*order\.status\s*\)/.test(svc);
// C3：写库过 toDbStatus（两处写点都要）
const c3Ok = (ctrl) => /casMarkPaid[\s\S]{0,800}?toDbStatus\s*\(/.test(ctrl) && /markDelivered[\s\S]{0,400}?toDbStatus\s*\(/.test(ctrl);
// C4：前端认 delivered
const c4Ok = (orders) => /['"]delivered['"]/.test(orders);

// ---------- S1 扫描面 ----------
const surfaces = [[F_PAY_CREATE, src.payCreate], [F_SERVICE, src.service], [F_CTRL, src.ctrl], [F_ORDERS, src.orders]];
const missing = surfaces.filter(([, s]) => !s || s.length < 50).map(([f]) => f);
ok('S1 四个扫描面文件存在且非空（下界 50 字符）', missing.length === 0, missing.join(','));

// ---------- C1 金额字段 ----------
const wm = src.payCreate.match(/^\s*amount(_fen)?:/m);
const writeField = wm ? ('amount' + (wm[1] || '')) : '';
ok('C1 下单侧写的金额字段（' + (writeField || '未解析') + '）必须被发货侧兼容读取（amount + amount_fen 都认）',
  !!writeField && c1Ok(src.service),
  !writeField ? '未能从 ' + F_PAY_CREATE + ' 解析出 amount: 字段' : (!c1Ok(src.service) ? '发货侧只认一种字段名 ⇒ 另一端读成 undefined' : ''));

// ---------- C2 状态归一化 ----------
ok('C2 发货侧比较状态前必须归一化（normStatus(order.status)）', c2Ok(src.service),
  '缺少 normStatus —— DB 存小写、内核用大写，直接 === 比会永不命中');

// ---------- C3 落库转换 ----------
ok('C3 Controller 的 casMarkPaid / markDelivered 写 DB 必须过 toDbStatus（不许把大写常量直接写进 update）',
  c3Ok(src.ctrl), '有写点绕过了 toDbStatus ⇒ DB 里会混入大写状态，旧读侧不认');

// ---------- C4 前端展示 ----------
ok('C4 前端订单页 statusText 必须认得 delivered（否则真付费单显示「手动开通」）', c4Ok(src.orders),
  'orders.js 未处理 delivered');

// ---------- 反恒真：坏样本必须被判据判红 ----------
const BAD_SERVICE = 'if (Number(p.amountFen) !== Number(order.amount_fen)) { throw e; } const st = order.status === "DELIVERED";';
const BAD_CTRL = 'casMarkPaid: async () => db.collection("x").where({status: ORDER_STATUS.PENDING}).update({data:{status: ORDER_STATUS.PAID}}), markDelivered: async () => db.update({status: ORDER_STATUS.DELIVERED})';
const BAD_ORDERS = 'statusText(s){ if(s==="paid")return 1; if(s==="pending")return 2; return 3; }';
ok('C-① 反恒真：旧发货内核（只读 amount_fen + 直接 === 大写）必须被 C1/C2 判红',
  c1Ok(BAD_SERVICE) === false && c2Ok(BAD_SERVICE) === false);
ok('C-② 反恒真：旧 Controller（大写直写 DB）必须被 C3 判红',
  c3Ok(BAD_CTRL) === false);
ok('C-③ 反恒真：旧前端（只认 paid/pending）必须被 C4 判红',
  c4Ok(BAD_ORDERS) === false);

// ---------- 交叉印证：下单侧状态值必须是小写（发货侧归一化才成立）----------
// ⚠️ 字面量在 service.js（`status: 'pending'`），index.js 只是透传 order.status —— 别在 index.js 找。
const stM = src.payCreateSvc.match(/status:\s*'([a-zA-Z_]+)'/);
const stVal = stM ? stM[1] : '';
ok('C5 下单侧写入的初始状态值应为小写（与 DB 既有约定一致；发货侧归一化后仍可处理大写）',
  !!stVal && stVal === stVal.toLowerCase(), '下单侧状态值=' + (stVal || '未从 payCreateOrder/service.js 解析到'));

if (fails.length) console.log('失败项：' + fails.join(' | '));
console.log(fails.length === 0
  ? '\n✅ 订单流水两端字段/状态契约一致（金额 amount 兼容 + 状态归一化 + 落库小写 + 前端认 delivered）。'
  : '\n❌ 订单流水两端契约已漂移 —— 见上方失败项。');
console.log('\n===== 订单流水契约守卫结果：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
process.exit(fails.length === 0 ? 0 : 1);
