// cloudfunctions/saveAsset/selftest.js —— 批次 4 · 摊销资产（**写操作**）自测（R57 补齐）
// 运行： node cloudfunctions/saveAsset/selftest.js
//
// 背景（round23 发现 R54 → 本侧登记为 R57）：本函数此前无 selftest，只被结构类检查覆盖
// （L 组扁平副本 / check_requires 静态路径 / 门禁 A–L），**行为无机器断言**；它是 batch4 的写操作，
// 风险高于只读函数。本套件补三类覆盖：
//   ① 入参面：金额单位=整数「分」（拒字符串/0/负/小数）、月份格式、时长、终止月可空
//   ② 归一化契约：asset_id 缺省空串（新增语义）、name trim、terminate_month 缺省空串
//   ③ 静态形状守卫：写路径的顺序（鉴权→越权判定→校验）与软删不可复活
// ⚠️ 只测纯函数层（validate）+ 源码形状；**不含** DB 行为（真云写入属"待人工"清单）。

const fs = require('fs');
const path = require('path');
const { validateInput } = require('./validate');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const S = { name: '装修', value_fen: 12000000, start_month: '2026-01', total_months: 36 };
const bad = (asset) => validateInput({ shop_id: 's1', asset });

console.log('===== 1. 合法入参 + 归一化契约 =====');
const r = validateInput({ shop_id: 's1', asset: { ...S, name: '  装修 ' }, client_request_id: 'c1' });
check('合法资产放行', r.error === null);
check('shop_id 回传', r.shop_id === 's1');
check('asset_id 缺省 → 空串（= 新增语义）', r.asset.asset_id === '');
check('name 已 trim', r.asset.name === '装修');
check('value_fen 整数分原样保留（12,000,000 分 = 12 万元）', r.asset.value_fen === 12000000);
check('terminate_month 缺省 → 空串（未终止）', r.asset.terminate_month === '');
check('client_request_id 回传', r.input.client_request_id === 'c1');
check('有 asset_id 时原样回传（= 编辑语义）', validateInput({ shop_id: 's1', asset: { ...S, asset_id: 'amort_x' } }).asset.asset_id === 'amort_x');

console.log('===== 2. 金额单位契约：整数「分」 =====');
check('value_fen 字符串 "100" → 拒（JSON number 契约）', bad({ ...S, value_fen: '100' }).error === ERROR_CODES.INVALID_PARAM);
check('value_fen 0 → 拒', bad({ ...S, value_fen: 0 }).error === ERROR_CODES.INVALID_PARAM);
check('value_fen 负数 → 拒', bad({ ...S, value_fen: -1 }).error === ERROR_CODES.INVALID_PARAM);
check('value_fen 小数 1.5 → 拒（金额必须是整数分）', bad({ ...S, value_fen: 1.5 }).error === ERROR_CODES.INVALID_PARAM);
check('value_fen 缺失 → 拒', bad({ name: '装修', start_month: '2026-01', total_months: 36 }).error === ERROR_CODES.INVALID_PARAM);
check('value_fen NaN → 拒', bad({ ...S, value_fen: NaN }).error === ERROR_CODES.INVALID_PARAM);

console.log('===== 3. 月份 / 时长 =====');
check('start_month "2026-13" → 拒', bad({ ...S, start_month: '2026-13' }).error === ERROR_CODES.INVALID_PARAM);
check('start_month "2026-1" → 拒（月份必须两位）', bad({ ...S, start_month: '2026-1' }).error === ERROR_CODES.INVALID_PARAM);
check('start_month "2026-00" → 拒', bad({ ...S, start_month: '2026-00' }).error === ERROR_CODES.INVALID_PARAM);
check('start_month "2026-09" → 放行', bad({ ...S, start_month: '2026-09' }).error === null);
check('total_months 0 → 拒', bad({ ...S, total_months: 0 }).error === ERROR_CODES.INVALID_PARAM);
check('total_months 1 → 放行（1 个月也合法）', bad({ ...S, total_months: 1 }).error === null);
check('total_months 1.5 → 拒', bad({ ...S, total_months: 1.5 }).error === ERROR_CODES.INVALID_PARAM);
check('total_months "12" → 拒', bad({ ...S, total_months: '12' }).error === ERROR_CODES.INVALID_PARAM);
check('terminate_month "2026-13" → 拒', bad({ ...S, terminate_month: '2026-13' }).error === ERROR_CODES.INVALID_PARAM);
check('terminate_month "2026-06" → 放行', bad({ ...S, terminate_month: '2026-06' }).error === null);
check('terminate_month "" → 归一空串（未终止）', bad({ ...S, terminate_month: '' }).asset.terminate_month === '');
check('terminate_month 非字符串（null/数字）→ 归一空串（宽松归一，不报错）', bad({ ...S, terminate_month: null }).asset.terminate_month === '' && bad({ ...S, terminate_month: 202606 }).asset.terminate_month === '');

console.log('===== 4. shop_id / 事件形态 =====');
check('shop_id 缺失 → 拒', validateInput({ asset: S }).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 空串 → 拒', validateInput({ shop_id: '', asset: S }).error === ERROR_CODES.INVALID_PARAM);
check('asset 缺失 → 拒', validateInput({ shop_id: 's1' }).error === ERROR_CODES.INVALID_PARAM);
check('asset 非对象 → 拒', validateInput({ shop_id: 's1', asset: 'x' }).error === ERROR_CODES.INVALID_PARAM);
check('event 为 null → 拒', validateInput(null).error === ERROR_CODES.INVALID_PARAM);
check('asset.name 纯空白 → 拒（trim 后非空才算）', bad({ ...S, name: '   ' }).error === ERROR_CODES.INVALID_PARAM);
const wrapped = validateInput({ input: { shop_id: 's9', asset: S } });
check('支持 { input: {...} } 包裹层', wrapped.error === null && wrapped.shop_id === 's9');
check('错误码 = INVALID_PARAM（全局标准码，非函数私有码）', ERROR_CODES.INVALID_PARAM === 'INVALID_PARAM');

console.log('===== 5. 静态形状守卫（写操作特有）=====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const body = src.slice(src.indexOf('exports.main')); // 只看函数体，避开顶部 import
const at = (s) => body.indexOf(s);
check('顺序：resolveAuth（鉴权）先于 assertShopOwner（越权）', at('resolveAuth') !== -1 && at('resolveAuth') < at('assertShopOwner'));
check('顺序：assertShopOwner 先于 validateInput（越权优先拒）', at('assertShopOwner') < at('validateInput'));
check('编辑分支读目标走 DataAdapter（软删已过滤，不可复活）', /da\.get\('shop_amortize'/.test(body));
check('编辑分支：目标不存在 → RESOURCE_NOT_FOUND', body.includes('RESOURCE_NOT_FOUND'));
check('编辑分支：update 显式写 is_deleted: false（保持未软删态）', /is_deleted:\s*false/.test(body));
check('新增分支：insert shop_amortize 且必落 shop_id / shop_id 取自 event', /da\.insert\('shop_amortize'/.test(body) && /shop_id:\s*shopId/.test(body));
check('新增分支：服务端 genId 生成 asset_id（不信任前端 id）', /genId\('amort_'\)/.test(body));
check('金额落库字段名 = value_fen（与 validate 输出一致，防字段漂移）', body.includes('value_fen: a.value_fen'));
check('当月摊销不在此算（口径：由 getAmortSchedule / saveLedger 引擎算）', !/amortizeTotalForMonth|calcAmortize/.test(body));

console.log(`\n==== saveAsset 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
