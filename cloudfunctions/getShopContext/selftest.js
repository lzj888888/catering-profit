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

console.log('===== 3. 跨函数常量守卫（读侧键集 ≡ 写侧，逐键逐值）=====');
// 🔴 R298X 扩面（根因）：修前这里只断言了 5 个键里的 **2 个**（inventory / amortize），
//   另外 3 个（takeawayParams / menuDishCount / buffetFoodCostTotal）**零判据**。
//   而写侧 `saveShopSetting/service.js` 的注释明写「与 getShopContext 同款开关键，**防漂移**」
//   —— 注释声称一致、机器只守 2/5 ⇒ 漂移**真的长在了盲区里**：读侧 SWITCH_KEYS 缺
//   `buffetFoodCostTotal`（写侧有、读侧无），而门禁全绿、无一条转红。
//   （同族于本仓「判据只守形态、不守行为」与「单源不扩散」两型：这里是有判据但只覆盖子集。）
//   ⇒ 判据从「两键硬编码」升为四条腿：
//     J1 同名键 ⇒ 值逐字相同（**全键集**）
//     J2 读侧缺的键 ⇒ 必须**显式登记 + why**（把"不对称"变成声明出来的东西，不许发生在盲区）
//     J3 全仓**生产**代码的 switch_key 字面量 ⇒ 必须 ∈ 注册表（新造的键无处藏身）
//     J4 每个注册键 ⇒ 必须真被某处引用（防"注册了却没人用"的死键）
const W = writeSide.SWITCH_KEYS;
const R = SWITCH_KEYS;
const r298xBase = pass;   // J5 以此算本段实跑条数（不写死字面量，删腿即跌破）

// ---- 前提：写侧键集非退化（防写侧被删空后 J1/J2 恒真）----
const wNames = Object.keys(W);
check('R298X-S1 前提：写侧 SWITCH_KEYS 键数 ≥ 5（删键即转红）', wNames.length >= 5,
  `实 ${wNames.length} 键：${wNames.join('/')}`);

// ---- J1 同名键 ⇒ 值逐字相同（全键集）----
const sameNameBad = wNames.filter((n) => R[n] !== undefined && R[n] !== W[n]).map((n) => `${n}: 读"${R[n]}" ≠ 写"${W[n]}"`);
check('R298X-J1 读侧每个**同名键**的值都 ≡ 写侧（全键集，不再只挑两键）', sameNameBad.length === 0,
  sameNameBad.join(' · ') || `逐键逐值一致（同名 ${wNames.filter((n) => R[n] !== undefined).length} 键）`);

// ---- J2 读侧缺的键必须显式登记 + why（fail-closed）----
const READ_ABSENT = {
  buffetFoodCostTotal: 'getShopContext 不读该键：消费方是 getDishReview（直读 shop_switch），读侧无需声明。',
};
const absent = wNames.filter((n) => R[n] === undefined);
const unregistered = absent.filter((n) => !READ_ABSENT[n]);
check('R298X-J2 读侧**缺**的键必须显式登记（新键只加在写侧 ⇒ 转红）', unregistered.length === 0,
  unregistered.length ? '未登记：' + unregistered.join('、') : `缺 ${absent.length} 键，均已登记`);
check('R298X-J2b 每条缺键登记都带 why（≥12 字，说明读侧为什么不需要）',
  absent.every((n) => String(READ_ABSENT[n] || '').length >= 12),
  absent.map((n) => `${n}:${String(READ_ABSENT[n] || '').length}字`).join(' · ') || '（无缺键）');
// 双向防腐：登记了却其实不缺 / 登记了写侧根本没这个键 ⇒ 红
const staleAbsent = Object.keys(READ_ABSENT).filter((n) => R[n] !== undefined || W[n] === undefined);
check('R298X-J2c 缺键登记表无陈旧键（读侧已补回 / 写侧无此键 ⇒ 红）', staleAbsent.length === 0,
  staleAbsent.length ? '陈旧：' + staleAbsent.join('、') : `${Object.keys(READ_ABSENT).length} 条登记均有效`);

// ---- J3 全仓 switch_key **词表**（repo-wide）不得有未登记的字面量 ----
//   🔴 为什么词表必须 repo-wide，而不能只看 SWITCH_KEYS：
//     `SWITCH_KEYS` 只是「**saveShopSetting 会写的那些键**」，**不是全仓词表**。
//     R298X 实扫发现第 6 个键 `m3_review_last` —— `importSalesBill` 写「上次堂食导入摘要」，
//     `core/开发规范v1.2` 明写登记为新增 switch_key，却**不在任何 SWITCH_KEYS 里**
//     ⇒ 只守 SWITCH_KEYS 的话，它永远在盲区里（与 `buffetFoodCostTotal` 同族的第二个实例）。
//   ⚠️ 同时登记「看着像键、其实不是键」的字面量，否则按命名约定扫描会误杀。
const REPO_SWITCH_KEYS = {
  inventory_switch: { writer: 'saveShopSetting', reader: 'getShopContext / getLedger / calcMonthlyProfit / saveLedger' },
  amortize_switch: { writer: 'saveShopSetting', reader: 'getShopContext / getLedger / getAmortSchedule / saveLedger' },
  'm3_takeaway_params': { writer: 'saveShopSetting', reader: 'getShopContext' },
  'm3_menu_dish_count': { writer: 'saveShopSetting', reader: 'getShopContext' },
  'm3_buffet_food_cost_total': { writer: 'saveShopSetting', reader: 'getDishReview' },
  'm3_review_last': { writer: 'importSalesBill', reader: '（暂无读方 —— 摘要落库但无人读回，已登记未闭环）' },
};
const NON_KEY_ALLOW = {
  'shop_switch': '集合名（collections.js 登记），不是 switch_key 取值',
  'm3_cards': 'exportData 的导出 scope 名，不是 switch_key 取值',
  'm3_combo': '付费能力键（common/entitlement.js::PAID_FEATURES）',
  'm3_takeaway': '付费能力键（common/entitlement.js::PAID_FEATURES）',
  'm3_dishreview': '付费能力键（common/entitlement.js::PAID_FEATURES）',
};
const registered = new Set(Object.keys(REPO_SWITCH_KEYS));
// 词表 ⊇ 写侧键值（fail-closed：写侧加了新键却没进词表 ⇒ 红）
const notInRepo = Object.values(W).filter((v) => !registered.has(v));
check('R298X-J3 词表 ⊇ 写侧 SWITCH_KEYS 全部键值（新键必须进词表）', notInRepo.length === 0,
  notInRepo.length ? '词表缺：' + notInRepo.join('、') : `词表 ${registered.size} 键 ⊇ 写侧 ${wNames.length} 键`);
check('R298X-J3b 词表每条都有归属（writer 与 reader 均非空）',
  Object.keys(REPO_SWITCH_KEYS).every((k) => REPO_SWITCH_KEYS[k].writer && REPO_SWITCH_KEYS[k].reader),
  Object.keys(REPO_SWITCH_KEYS).length + ' 条均带 writer/reader');

//   扫描面：cloudfunctions/ 下的 .js，**排除** cx_*（common 单源的派生副本，逐字跟随单源）、
//           selftest.js（测试自身要写字面量）、node_modules / __tests__。
const CF = path.join(__dirname, '..');
const prodFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.js')) continue;
    if (e.name.startsWith('cx_')) continue;         // 派生副本：逐字跟随 common 单源，不单独判
    if (e.name === 'selftest.js') continue;         // 测试自身会写字面量
    prodFiles.push(p);
  }
})(CF);

// J3c 直连形态：`switch_key === 'X'` / `switch_key: 'X'`
const KEY_LIT = /switch_key\s*(?:===|==|:)\s*'([^']+)'/g;
const badDirect = [];
let directHits = 0;
for (const f of prodFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  KEY_LIT.lastIndex = 0;
  while ((m = KEY_LIT.exec(src)) !== null) {
    directHits++;
    if (!registered.has(m[1])) badDirect.push(`${path.relative(CF, f)} → '${m[1]}'`);
  }
}
check('R298X-J3c 直连字面量（switch_key ===/: \'X\'）必须在词表内', badDirect.length === 0,
  badDirect.length ? '未登记：' + badDirect.join(' · ') : `${directHits} 处直连字面量全部在册`);

// J3d 命名约定形态：任何 `'m3_*'` / `'*_switch'` 字面量都必须在 词表 ∪ 非键白名单 内。
//   🔴 这一腿是为了堵 J3c 的绕过：把键存成变量再比较（`const k = 'm3_brand_new'`），
//     或把键当**位置参数**传给辅助函数（`upsertSwitch(db, shopId, 'm3_review_last', ...)`），
//     J3c 的正则都抓不到 —— 变异证明 B3 当场把它证出来过。
const NAME_LIT = /'(m3_[a-z0-9_]+|[a-z0-9]+(?:_[a-z0-9]+)*_switch)'/g;
const badName = [];
const seenName = new Set();
for (const f of prodFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  NAME_LIT.lastIndex = 0;
  while ((m = NAME_LIT.exec(src)) !== null) {
    seenName.add(m[1]);
    if (!registered.has(m[1]) && !NON_KEY_ALLOW[m[1]]) badName.push(`${path.relative(CF, f)} → '${m[1]}'`);
  }
}
check('R298X-J3d 命名约定字面量（m3_* / *_switch）必须在 词表 ∪ 非键白名单 内',
  badName.length === 0, badName.length ? '未登记：' + badName.join(' · ') : `实扫 ${seenName.size} 种字面量，全部有归属`);
check('R298X-J3e 前提：扫描面非退化（生产 .js ≥ 80）且两腿都有命中（直连 ≥2 / 命名 ≥5）',
  prodFiles.length >= 80 && directHits >= 2 && seenName.size >= 5,
  `扫描 ${prodFiles.length} 个 .js · 直连 ${directHits} · 命名 ${seenName.size}`);

// ---- J4 每个注册键必须真被引用（防死键：注册了却没人用）----
const deadKeys = wNames.filter((n) => {
  const re = new RegExp('SWITCH_KEYS\\s*\\.\\s*' + n + '\\b');
  return !prodFiles.some((f) => re.test(fs.readFileSync(f, 'utf8')));
});
check('R298X-J4 每个注册键都真被某处引用（防"注册了却没人用"的死键）', deadKeys.length === 0,
  deadKeys.length ? '死键：' + deadKeys.join('、') : `${wNames.length} 键均有引用点`);

// ---- J5 断言数下界（防后人删腿：本段实跑条数由 pass 差值算，不写死字面量）----
const r298xCount = pass - r298xBase;
check('R298X-J5 本段断言数 ≥ 10（删掉任一腿即跌破下界）', r298xCount >= 10, `本段实跑 ${r298xCount} 条`);

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
// 🔴 R208 判据修正：旧写法 `body.slice(body.indexOf('return ok'))` 隐含假设「**全文只有末尾一个**
//   return ok」。R208 加了「主动删空 ⇒ no_shop 早退」分支后文件里有**两个** return ok，
//   于是 slice 从早退那个一路切到文末，**把后面整段 autoProvision 代码划进"出参区"**
//   （那里当然有 `user_id:`）⇒ 假红（这一条正是本仓"守卫红先看自己"的典型）。
//   ⇒ 改为**逐个出参块**判：每个 `return ok(` 到其后第一个 `});` 之间才是出参区。
function outParamChunks(b) {
  const out = [];
  let i = 0;
  for (;;) {
    const j = b.indexOf('return ok(', i);
    if (j < 0) break;
    const k = b.indexOf('});', j);
    out.push(b.slice(j, k < 0 ? b.length : k));
    i = (k < 0 ? b.length : k) + 1;
  }
  return out.join('\n');
}
const outParams = outParamChunks(body);
// 前提：出参区确实被切出来了（否则下面的"零泄漏"是零命中假绿）
check('前提：出参区切片非空（─── ⇒ 零命中假绿）', outParams.length > 0, outParams.length + ' 字符');
check('出参不泄漏 user_id / openid', !/user_id\s*:/.test(outParams) && !/openid/.test(body),
  /user_id\s*:/.test(outParams) ? '出参里带了 user_id' : (/openid/.test(body) ? '正文出现 openid' : '零泄漏'));

console.log(`\n==== getShopContext 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
