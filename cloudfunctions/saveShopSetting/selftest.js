// cloudfunctions/saveShopSetting/selftest.js —— 批次 4 · 店铺设置（**写操作**）自测（R57 补齐）
// 运行： node cloudfunctions/saveShopSetting/selftest.js
//
// 背景（round23 发现 R54 → 本侧登记为 R57）：此前无 selftest，写操作无机器断言。本套件覆盖：
//   ① 开关三态语义：**缺省 = null（不动库）**，显式 false 必须保留为 false（最易误写成"缺省即关"）
//   ② 入参面：switches.inventory 非 boolean 拒；name/remark 非字符串归一为 ''
//   ③ 跨函数常量守卫：SWITCH_KEYS ≡ getShopContext.SWITCH_KEYS（两处注释都写"防漂移"，此处机器化）
//   ④ 静态形状守卫：只对非 null 的开关写库（防"没传的开关被置 false"）

const fs = require('fs');
const path = require('path');
const { validateInput } = require('./validate');
const { SWITCH_KEYS } = require('./service');
const { ERROR_CODES } = require('./common');
const ctxService = require('../getShopContext/service');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 1. 开关三态语义（核心）=====');
const r0 = validateInput({ shop_id: 's1' });
check('不传 switches → 两开关均为 null（= 不动库）', r0.switches.inventory === null && r0.switches.amortize === null);
check('合法基线放行', r0.error === null && r0.shop_id === 's1');
const r1 = validateInput({ shop_id: 's1', switches: { inventory: true } });
check('inventory=true → true', r1.switches.inventory === true);
check('未传的 amortize 仍为 null（不被置 false）', r1.switches.amortize === null);
const r2 = validateInput({ shop_id: 's1', switches: { inventory: false } });
check('🔴 inventory=false → **false**（不是 null，必须真写库关闭）', r2.switches.inventory === false);
check('🔴 false 与 null 可区分（=== 断言，非真假值断言）', r2.switches.inventory !== null);
const r3 = validateInput({ shop_id: 's1', switches: { inventory: true, amortize: false } });
check('两开关同时给 → 各自保留', r3.switches.inventory === true && r3.switches.amortize === false);
check('switches 非对象（字符串）→ 归一为 null 两枚', validateInput({ shop_id: 's1', switches: 'x' }).switches.inventory === null);

console.log('===== 2. 入参面 =====');
check('switches.inventory 字符串 "true" → 拒', validateInput({ shop_id: 's1', switches: { inventory: 'true' } }).error === ERROR_CODES.INVALID_PARAM);
check('switches.inventory 数字 1 → 拒', validateInput({ shop_id: 's1', switches: { inventory: 1 } }).error === ERROR_CODES.INVALID_PARAM);
check('switches.amortize null → 拒（undefined 才是"不动"，null 是非法类型）', validateInput({ shop_id: 's1', switches: { amortize: null } }).error === ERROR_CODES.INVALID_PARAM);
check('name 非字符串 → 归一空串', validateInput({ shop_id: 's1', name: 123 }).name === '');
check('remark 非字符串 → 归一空串', validateInput({ shop_id: 's1', remark: {} }).remark === '');
check('name 合法回传', validateInput({ shop_id: 's1', name: '我的店' }).name === '我的店');
// 🔴 2026-09-20：只改核算口径（不传 name/remark）不得清空店铺名——旧实现正是把 '' 写回了库
check('🔴 不传 name → undefined（= 不动库，防只改开关却清空店铺名）', validateInput({ shop_id: 's1' }).name === undefined);
check('🔴 不传 remark → undefined（同上）', validateInput({ shop_id: 's1' }).remark === undefined);
check('🔴 undefined 与 "" 可区分（=== 断言，非真假值断言）', validateInput({ shop_id: 's1' }).name !== '');
check('name 显式 "" → ""（保留清空能力）', validateInput({ shop_id: 's1', name: '' }).name === '');
check('shop_id 缺失 → 拒', validateInput({ name: 'x' }).error === ERROR_CODES.INVALID_PARAM);
check('event 为 null → 拒', validateInput(null).error === ERROR_CODES.INVALID_PARAM);
check('支持 { input: {...} } 包裹层', validateInput({ input: { shop_id: 's7' } }).shop_id === 's7');
check('错误码 = INVALID_PARAM（全局标准码）', ERROR_CODES.INVALID_PARAM === 'INVALID_PARAM');

console.log('===== 3. 跨函数常量守卫（防漂移）=====');
check('saveShopSetting.SWITCH_KEYS.inventory === getShopContext 同名键', SWITCH_KEYS.inventory === ctxService.SWITCH_KEYS.inventory);
check('saveShopSetting.SWITCH_KEYS.amortize === getShopContext 同名键', SWITCH_KEYS.amortize === ctxService.SWITCH_KEYS.amortize);
check('键名 = inventory_switch（与 getLedger 读开关字面量一致）', SWITCH_KEYS.inventory === 'inventory_switch');
check('键名 = amortize_switch（与 getLedger 读开关字面量一致）', SWITCH_KEYS.amortize === 'amortize_switch');
const getLedgerSrc = fs.readFileSync(path.join(__dirname, '..', 'getLedger', 'index.js'), 'utf8');
check('getLedger 读开关用同一字面量（跨函数字面量同源）', getLedgerSrc.includes(`'${SWITCH_KEYS.inventory}'`) && getLedgerSrc.includes(`'${SWITCH_KEYS.amortize}'`));

console.log('===== 4. 静态形状守卫（写操作特有）=====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const body = src.slice(src.indexOf('exports.main'));
const at = (s) => body.indexOf(s);
check('顺序：resolveAuth → assertShopOwner → validateInput', at('resolveAuth') < at('assertShopOwner') && at('assertShopOwner') < at('validateInput'));
check('🔴 只对非 null 开关写库：`!== null` 判定存在（防未传开关被置 false）', /v\.switches\.inventory\s*!==\s*null/.test(body) && /v\.switches\.amortize\s*!==\s*null/.test(body));
check('开关 upsert 以 shop_id + switch_key 为定位键（唯一键契约）', /shop_id:\s*shopId,\s*switch_key:\s*kv\.key/.test(body));
check('upsert 冲突回退：update 失败 → add（防竞态丢写）', /catch[\s\S]{0,200}?\.add\(/.test(body));
check('店铺名/备注写 shop 表（存在才写）', /da\.get\('shop'/.test(body) && /db\.collection\('shop'\)\.doc/.test(body));
check('🔴 name 写库以 `!== undefined` 判定存在（防未传被写空）', /v\.name\s*!==\s*undefined/.test(body));
check('🔴 remark 写库同样以 `!== undefined` 判定存在', /v\.remark\s*!==\s*undefined/.test(body));
check('开关落库为服务端权威（返回体带 switches 供前端同步）', /switches:/.test(body) && /enabled:\s*kv\.enabled/.test(body));

console.log(`\n==== saveShopSetting 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
