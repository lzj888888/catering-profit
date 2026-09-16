// cloudfunctions/getMonthList/selftest.js —— 批次 4 · M1 历史月份列表（读）自测（R57 补齐）
// 运行： node cloudfunctions/getMonthList/selftest.js
//
// 背景：此前无 selftest；本函数薄（鉴权→校验→列表映射），可测面 = 入参校验 + 出参语义形状。
// ⚠️ 诚实标注等级：去重/倒序逻辑**内联在 index.js**（含 `require('wx-server-sdk')`，纯 node 加载不了），
//    故本套件对它们只能做**源码形状断言**（改写法会红，属预期），不做行为断言。行为面待页面级验收。

const fs = require('fs');
const path = require('path');
const { validateInput } = require('./validate');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 1. 入参面 =====');
check('合法入参放行', validateInput({ shop_id: 's1' }).error === null);
check('shop_id 回传', validateInput({ shop_id: 's1' }).shop_id === 's1');
check('shop_id 缺失 → 拒', validateInput({}).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 空串 → 拒', validateInput({ shop_id: '' }).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 非字符串 → 拒', validateInput({ shop_id: 123 }).error === ERROR_CODES.INVALID_PARAM);
check('event 为 null → 拒', validateInput(null).error === ERROR_CODES.INVALID_PARAM);
check('event 为数组 → 拒（数组也是 object，须显式拒）', validateInput([]).error !== null, '数组被当作 event 时 shop_id 缺失 → 拒');
check('month 不是本函数入参（月份列表不需要 month）', validateInput({ shop_id: 's1', month: '不合法串' }).error === null);
check('支持 { input: {...} } 包裹层', validateInput({ input: { shop_id: 's9' } }).shop_id === 's9');
check('错误码 = INVALID_PARAM（全局标准码）', ERROR_CODES.INVALID_PARAM === 'INVALID_PARAM');

console.log('===== 2. 源码形状守卫（去重 / 倒序 / 归档态）=====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const body = src.slice(src.indexOf('exports.main'));
const at = (s) => body.indexOf(s);
check('顺序：resolveAuth → assertShopOwner → validateInput', at('resolveAuth') < at('assertShopOwner') && at('assertShopOwner') < at('validateInput'));
check('读 shop_monthly_account 且按 shop_id 过滤', /da\.list\('shop_monthly_account',\s*\{\s*shop_id:\s*shopId\s*\}\)/.test(body));
check('🔴 按 month 去重（同一月 upsert 理论一条，防御性去重）', /byMonth/.test(body) && /!byMonth\.has\(r\.month\)/.test(body));
check('🔴 倒序（新在前）：`a.month < b.month ? 1 : -1`', /a\.month\s*<\s*b\.month\s*\?\s*1\s*:\s*-1/.test(body));
check('出参仅 month + is_archive（不泄漏金额/明细）', /month:\s*r\.month,\s*is_archive:\s*!!r\.is_archive/.test(body) && !/amount_fen/.test(body));
check('is_archive 强制布尔化（!!）', /\|\|r\.is_archive/.test(body) || /!!r\.is_archive/.test(body));
check('空 month 行被跳过（不产生 month:"" 条目）', /r\.month\s*&&/.test(body));

console.log(`\n==== getMonthList 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
