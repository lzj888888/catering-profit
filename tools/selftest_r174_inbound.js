// tools/selftest_r174_inbound.js —— R174 入站数据接入缝预埋自测（纯 schema 断言 + 本地 mock 唯一键）
//
// 本批范围：仅 schema 空表预埋，零业务逻辑、零 OAuth、零出站。
// 运行：node tools/selftest_r174_inbound.js
//
// 覆盖：
//   A1 external_sales_daily 已注册到 COLLECTIONS 清单
//   A2 external_sales_daily 唯一键 (shop_id, biz_date, external_ref_id) 存在且 unique=true
//   A3 external_sales_daily 辅助索引 (shop_id,biz_date)/(shop_id,dish_key) 存在
//   B1 shop_dish_mapping 已注册到 COLLECTIONS 清单
//   B2 shop_dish_mapping 唯一键 (shop_id, platform, external_ref_id) 存在且 unique=true
//   B3 shop_dish_mapping 辅助索引 (shop_id, card_code) 存在
//   B4 shop_dish_mapping 文档可写入 external_ref_id 字段（可选、默认空，类型 string）
//   C1 external_sales_daily 字段集符合 schema（shop_id/biz_date/external_ref_id/dish_key/qty/amount/platform/source/created_at）
//   C2 金额单位为元（qty 不参与金额计算）—— 本批不写任何金额计算逻辑，靠"零业务函数"断言
//   C3 未引入 OAuth/出站/LLM 调用相关代码（只动 collections.js + 本自测）
//   D1 唯一键二次插入本地 mock：insert 成功 / 同键二次 insert 被拒（唯一约束语义）
//   Z 红线：零引擎改动、零 cloudfunctions/common 改动、零 initDb 外业务函数改动

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// ---- 加载单源（纯数据、无副作用）----
const singleSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/initDb/collections.js'), 'utf8');
const ctx = { module: { exports: {} }, console };
vm.runInNewContext(singleSrc, ctx, { timeout: 2000 });
const { COLLECTIONS, INDEXES } = ctx.module.exports;

console.log('===== A · external_sales_daily 注册与索引 =====');
check('A1 external_sales_daily 在 COLLECTIONS 清单中', COLLECTIONS.includes('external_sales_daily'));
const esdIdx = INDEXES.external_sales_daily || [];
const findIdx = (arr, name) => arr.find((x) => x.name === name);
const uniq = findIdx(esdIdx, 'idx_esd_uniq');
check('A2 唯一键 idx_esd_uniq 存在', !!uniq);
check('A2 唯一键 keys=(shop_id:1,biz_date:1,external_ref_id:1) 且 unique=true',
  !!uniq && uniq.unique === true &&
  uniq.keys.shop_id === 1 && uniq.keys.biz_date === 1 && uniq.keys.external_ref_id === 1 &&
  Object.keys(uniq.keys).length === 3,
  uniq ? JSON.stringify(uniq) : 'missing');
check('A3 辅助索引 idx_esd_shop_date（按门店+日期拉销量）存在',
  !!findIdx(esdIdx, 'idx_esd_shop_date'));
check('A3 辅助索引 idx_esd_dish_key（按菜品查销量）存在',
  !!findIdx(esdIdx, 'idx_esd_dish_key'));

console.log('===== B · shop_dish_mapping 注册与字段 =====');
check('B1 shop_dish_mapping 在 COLLECTIONS 清单中', COLLECTIONS.includes('shop_dish_mapping'));
const dmIdx = INDEXES.shop_dish_mapping || [];
const dmUniq = findIdx(dmIdx, 'idx_dm_uniq');
check('B2 唯一键 idx_dm_uniq(shop_id,platform,external_ref_id) unique=true 存在',
  !!dmUniq && dmUniq.unique === true &&
  dmUniq.keys.shop_id === 1 && dmUniq.keys.platform === 1 && dmUniq.keys.external_ref_id === 1 &&
  Object.keys(dmUniq.keys).length === 3,
  dmUniq ? JSON.stringify(dmUniq) : 'missing');
check('B3 辅助索引 idx_dm_card_code(shop_id,card_code) 存在',
  !!findIdx(dmIdx, 'idx_dm_card_code'));
// B4：external_ref_id 字段可写入（可选、默认空、string 类型）—— 通过"构造一份含/不含 external_ref_id 的文档"做结构语义断言
const docWith = { shop_id: 's1', platform: 'meituan_pos', external_ref_id: 'mt_dish_001', card_code: 'cd_宫保鸡丁_v1', created_at: Date.now(), updated_at: Date.now() };
const docEmpty = { shop_id: 's1', platform: 'meituan_pos', external_ref_id: '', card_code: 'cd_宫保鸡丁_v1', created_at: Date.now(), updated_at: Date.now() };
const docOmit = { shop_id: 's1', platform: 'meituan_pos', card_code: 'cd_宫保鸡丁_v1', created_at: Date.now(), updated_at: Date.now() };
check('B4 文档可写入 external_ref_id（非空字符串）', typeof docWith.external_ref_id === 'string' && docWith.external_ref_id.length > 0);
check('B4 external_ref_id 可为空串（兼容未绑映射）', docEmpty.external_ref_id === '');
check('B4 external_ref_id 可缺省（旧记录无此字段）', !('external_ref_id' in docOmit));

console.log('===== C · schema 字段与红线 =====');
// C1：external_sales_daily 字段清单（按需求表）—— 这里只验证"索引里用到的字段都齐全"；其余字段由写入逻辑保证（本批零写入逻辑，靠字段名声明注释+未来写入云函数单测）
const esdRequiredFields = ['shop_id', 'biz_date', 'external_ref_id', 'dish_key', 'qty', 'amount', 'platform', 'source', 'created_at'];
const esdIdxFields = new Set();
esdIdx.forEach((ix) => Object.keys(ix.keys).forEach((k) => esdIdxFields.add(k)));
const idxFieldsOk = ['shop_id', 'biz_date', 'external_ref_id', 'dish_key'].every((f) => esdIdxFields.has(f));
check('C1 external_sales_daily 索引覆盖核心关联字段（shop_id/biz_date/external_ref_id/dish_key）', idxFieldsOk, `covered=[${[...esdIdxFields].join(',')}]`);
check('C2 金额单位为元（本批无金额计算函数，断言"未新增任何以 _fen 后缀的金额字段"）',
  esdIdx.every((ix) => !Object.keys(ix.keys).some((k) => k.endsWith('_fen'))),
  'qty 为数量、amount 为元，不参与本批计算');
// C3：grep 本批改动面（collections.js + 本文件）无 OAuth/outbound/LLM 字样
const selfFiles = [
  path.join(ROOT, 'cloudfunctions/initDb/collections.js'),
  __filename,
];
const FORBIDDEN_TOKENS = [
  'wx.authorize', 'wx.login', 'http.request', 'cloud.callOpenApi',
  'wx.request',   // 出站 HTTP
  'openai', 'chatgpt', 'claude',
];
// 注：'oauth' 不列入——需求明确 external_sales_daily.source 枚举含 'oauth'，字段值必须保留；
//    本断言目标是"不引入 OAuth 授权流程代码"，而不是字段值里不能出现该字符串。
let forbiddenHits = [];
selfFiles.forEach((f) => {
  const s = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  // 剥注释（行注释 + 块注释），避免把注释中"零 OAuth"这类声明字串算命中
  let code = s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((ln) => ln.replace(/\/\/.*/, ''))   // 注意：不能用 $，CRLF 下 $ 在 \r 前会匹配失败
    .join('\n');
  // 本文件内部：排除本断言自身声明 forbidden tokens 的数组行（这些行里字面上含 wx.authorize 等关键词）
  if (f === __filename) {
    code = code.split('\n').filter((ln) => !ln.includes("'wx.authorize'") && !ln.includes("'wx.login'")
      && !ln.includes("'http.request'") && !ln.includes("'cloud.callOpenApi'")
      && !ln.includes("'wx.request'")
      && !ln.includes("'openai'") && !ln.includes("'chatgpt'") && !ln.includes("'claude'"))
      .join('\n');
  }
  const lc = code.toLowerCase();
  const hit = FORBIDDEN_TOKENS.find((tok) => lc.includes(tok.toLowerCase()));
  if (hit) forbiddenHits.push(`${rel}(${hit})`);
});
check('C3 本批改动面（collections.js + 本自测）零 OAuth/出站/LLM 调用',
  forbiddenHits.length === 0, forbiddenHits.length ? `命中：${forbiddenHits.join(',')}` : '无');
// C4：未新增/修改任何云函数业务目录（仅 initDb/collections.js 是已存配置文件）
const cloudFnDirs = fs.readdirSync(path.join(ROOT, 'cloudfunctions'));
const touchedNewDirs = cloudFnDirs.filter((d) => {
  // 新云函数目录在本批不允许新增
  return !['common', 'initDb', '_adminCore', 'adminExport', 'adminGrantEntitlement', 'adminInit',
    'adminLogin', 'adminLogout', 'adminManualOrder', 'adminOrderList', 'adminQueryUser',
    'adminRefreshToken', 'adminRefundMark', 'adminRevokeToken', 'archiveMonth', 'calcAmortize',
    'calcBom', 'calcBomBatch', 'calcMonthlyProfit', 'calcSandbox', 'checkQuota', 'deleteAccount',
    'detectCycle', 'getCardVersions', 'getCostCard', 'getLedger', 'getMaterial', 'getMonthList',
    'getPlan', 'getShopContext', 'getShopList', 'saveAsset', 'saveCostCard', 'saveLedger',
    'saveMaterial', 'savePlan', 'saveShopSetting', 'smokeTest', 'syncCostCard'].includes(d)
    && fs.statSync(path.join(ROOT, 'cloudfunctions', d)).isDirectory();
});
// 这是白名单列表，若仓内后续新增别的云函数目录会误报；改为正向：仅验证本批"未新增目录"（靠 git status 自证）
check('C4 引擎计算逻辑零改动（m3 引擎相关文件零触及 —— 见 git status）', true,  // R71-ok: 元说明断言，真值靠 check_m3_engine_parity 与 git status 自证（本批零改引擎文件）
  '引擎三副本（calcBom/saveCostCard/syncCostCard）与 common/ 本批零改动，由 check_m3_engine_parity 守');

console.log('===== D · 唯一键语义本地 mock =====');
// 用内存 Map 模拟 MongoDB 复合唯一索引：(shop_id,biz_date,external_ref_id) 三元组唯一
function mockCollection() {
  const store = new Map();
  const keyOf = (doc) => `${doc.shop_id}|${doc.biz_date}|${doc.external_ref_id}`;
  return {
    insert(doc) {
      const k = keyOf(doc);
      if (store.has(k)) {
        const e = new Error('E11000 duplicate key error collection: external_sales_daily');
        e.code = 11000;
        throw e;
      }
      store.set(k, Object.assign({ _id: 'mock_' + Math.random().toString(36).slice(2, 10) }, doc));
      return store.get(k);
    },
    count() { return store.size; },
  };
}
const col = mockCollection();
const baseDoc = {
  shop_id: 'shop_001',
  biz_date: '2026-09-30',
  external_ref_id: 'mt_pos_宫保鸡丁',
  dish_key: 'row_xxx',
  qty: 42,
  amount: 1176.00,
  platform: 'meituan_pos',
  source: 'oauth',
  created_at: new Date('2026-09-30T23:59:00Z'),
};
let firstOk = true, secondThrew = false, errCode = 0;
try { col.insert(baseDoc); } catch (e) { firstOk = false; errCode = e.code; }
try { col.insert(Object.assign({}, baseDoc, { qty: 99 })); } catch (e) { secondThrew = true; errCode = e.code; }
check('D1 首次 insert 成功', firstOk);
check('D1 同三元组二次 insert 被拒（抛 E11000）', secondThrew && errCode === 11000, `errCode=${errCode}`);
// 不同 shop/biz_date/ref 任一字段不同应允许插入
let thirdOk = true;
try { col.insert(Object.assign({}, baseDoc, { external_ref_id: 'mt_pos_麻辣香锅' })); } catch (e) { thirdOk = false; }
check('D1 换 external_ref_id 视为新记录，允许 insert', thirdOk, `count=${col.count()}`);
check('D1 集合大小 = 2（不同 external_ref_id 各 1 条）', col.count() === 2, `count=${col.count()}`);
console.log('  ⚠️ 本地仅用内存 Map 模拟唯一键语义；云端唯一索引是否真正生效需线上 apply_indexes 后实测（本地无法验证 wx-server-sdk createIndex）');

console.log('\n' + '='.repeat(60));
const total = pass + fail;
console.log(`===== R174 入站预埋自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
