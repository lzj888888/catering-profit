// cloudfunctions/getShopContext/selftest.js —— 批次 4 · 店铺上下文（读）自测（R57 补齐）
// 运行： node cloudfunctions/getShopContext/selftest.js
//
// 背景：此前无 selftest。本函数是管理入口/月度/设置页共用的"店铺 + 服务端权威开关"读取口。
//   ① 入参面：**shop_id 可选**（缺省取用户默认店铺），提供了则必须非空
//   ② switchesFromRows：switch 行组 → { inventorySwitchOn, amortizeSwitchOn }（键精确匹配；缺行 = 关）
//   ③ 跨函数常量守卫：SWITCH_KEYS ≡ saveShopSetting（写侧）——两处注释都写"防漂移"，此处机器化
//   ④ 静态形状守卫：首店自动建档（服务端 genId）

const fs = require('fs');
const path = require('path');
const { validateInput } = require('./validate');
const { switchesFromRows, SWITCH_KEYS } = require('./service');
const writeSide = require('../saveShopSetting/service');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 1. 入参面（shop_id 可选）=====');
check('不传 shop_id → 放行且归一空串（取默认店铺）', validateInput({}).error === null && validateInput({}).shop_id === '');
check('event 为 null → 拒（event 必须是对象）', validateInput(null).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 传空串 → 归一空串（等同缺省）', validateInput({ shop_id: '' }).shop_id === '');
check('shop_id 非字符串 → 归一空串（不报错，按缺省处理）', validateInput({ shop_id: 123 }).shop_id === '');
check('shop_id 合法 → 原样回传', validateInput({ shop_id: 's1' }).shop_id === 's1');
check('client_request_id 回传', validateInput({ shop_id: 's1', client_request_id: 'c9' }).input.client_request_id === 'c9');
check('支持 { input: {...} } 包裹层', validateInput({ input: { shop_id: 's8' } }).shop_id === 's8');
check('错误码 = INVALID_PARAM（全局标准码）', ERROR_CODES.INVALID_PARAM === 'INVALID_PARAM');

console.log('===== 2. switchesFromRows（行组 → 开关布尔）=====');
const s0 = switchesFromRows([]);
check('空行组 → 两开关均 false（缺行即关）', s0.inventorySwitchOn === false && s0.amortizeSwitchOn === false);
check('undefined 行组 → 两开关均 false（不抛）', switchesFromRows(undefined).inventorySwitchOn === false && switchesFromRows(null).amortizeSwitchOn === false);
const s1 = switchesFromRows([{ switch_key: 'inventory_switch', enabled: true }, { switch_key: 'amortize_switch', enabled: true }]);
check('双开 → true/true', s1.inventorySwitchOn === true && s1.amortizeSwitchOn === true);
const s2 = switchesFromRows([{ switch_key: 'inventory_switch', enabled: false }, { switch_key: 'amortize_switch', enabled: true }]);
check('库存关/摊销开 → false/true（不串键）', s2.inventorySwitchOn === false && s2.amortizeSwitchOn === true);
const s3 = switchesFromRows([{ switch_key: 'inventory_switch', enabled: 1 }, { switch_key: 'amortize_switch' }]);
check('enabled 非布尔（1）→ truthy 化 true', s3.inventorySwitchOn === true);
check('行缺 enabled 字段 → false（不抛）', s3.amortizeSwitchOn === false);
const s4 = switchesFromRows([{ switch_key: 'unknown_switch', enabled: true }]);
check('未知 switch_key 不污染出参', s4.inventorySwitchOn === false && s4.amortizeSwitchOn === false);
check('出参仅两枚键（不多带行原文）', Object.keys(s0).length === 2 && Object.keys(s1).sort().join(',') === 'amortizeSwitchOn,inventorySwitchOn');

console.log('===== 3. 跨函数常量守卫（读侧 ≡ 写侧）=====');
check('inventory 键读≡写', SWITCH_KEYS.inventory === writeSide.SWITCH_KEYS.inventory);
check('amortize 键读≡写', SWITCH_KEYS.amortize === writeSide.SWITCH_KEYS.amortize);
check('键名 = inventory_switch', SWITCH_KEYS.inventory === 'inventory_switch');
check('键名 = amortize_switch', SWITCH_KEYS.amortize === 'amortize_switch');

console.log('===== 4. 静态形状守卫 =====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const body = src.slice(src.indexOf('exports.main'));
const at = (s) => body.indexOf(s);
check('顺序：resolveAuth → validateInput（本函数无 shop 越权判定，按 user_id 取店）', at('resolveAuth') < at('validateInput'));
check('按 user_id 取店（非按前端传入 shop_id 直读）', /da\.list\('shop',\s*\{\s*user_id:\s*userId\s*\}\)/.test(body));
// 🔴 A6b（2026-09-19 改）：首店自动建档**必须**用单源确定性 id，且**必须**容错回读。
//   旧断言断言的是 `genId('shop_')`（随机 id）—— 那正是 A6b 的病灶：
//   真云实测 `shop.idx_shop_user` **非** unique（同 user_id 连插两次都成功）
//   ⇒ 随机 id + 先查后建 = 并发下能建出两个店。
check('🔴 首店自动建档：复用单源 defaultShopId(userId)（确定性 _id，幂等由构造保证）',
  /defaultShopId\(userId\)/.test(body) && !/genId\('shop_'\)/.test(body));
check('🔴 建档落 user_id', /user_id:\s*userId/.test(body));
check('🔴 撞唯一键后必须回读（不得直接返回假 shop_id）',
  /isDuplicateKeyError\(/.test(body) && /again\s*=\s*await da\.list\('shop'/.test(body)
  && /回读为空/.test(body));
check('🔴 回读仍为空 ⇒ fail-closed（SYSTEM_ERROR，不猜）', /fail\(ERROR_CODES\.SYSTEM_ERROR,\s*'店铺初始化失败（并发冲突后回读为空）'\)/.test(body));
check('新建标记 is_new_shop 回传（前端可提示）', /is_new_shop:\s*created/.test(body));
check('开关行经 service 映射（不内联 find）', /switchesFromRows\(/.test(body));
check('出参不泄漏 user_id / openid', !/user_id:/.test(body.slice(body.indexOf('return ok'))) && !/openid/.test(body));

console.log(`\n==== getShopContext 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
