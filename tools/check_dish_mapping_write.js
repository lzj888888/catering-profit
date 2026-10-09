// tools/check_dish_mapping_write.js —— 【R255】菜名映射**写侧**守卫
// 运行：node tools/check_dish_mapping_write.js
//
// 为什么需要它（真实缺口，R254 真云只读探针坐实，非推断）：
//   R253 已把映射表**读侧**接好（getDishReview 会先查 shop_dish_mapping），但**没有任何入口写一行**
//   ⇒ 表恒空 ⇒ 那条读路径永远走不到。真云实证：taobao 平台块 **51 道菜 ¥1823.08**，
//   而 `ranked` **0 条**、`unmatchedCount` **51** ⇒ 单品毛利恒算不出来。
//   且客户端直读该集合返回 `DATABASE_PERMISSION_DENIED`（core/15：仅管理端可读写）
//   ⇒ 造映射记录只能走云函数，没有第二条路 ⇒ 本轮新增 `saveDishMapping`。
//
// 🔴 本守卫的**头号判据 = 写侧键 ≡ 读侧键**（双向）：
//   读侧查 `platform + '|' + dish_key`（且有「空 platform」兜底），写侧若先归一菜名、
//   或用了别的分隔符、或拿销量行的 external_ref_id（含日期）当键 ⇒ **写进去也永远读不到**。
//   这是比「填了算错」更坏的**死输入**（用户挂了映射、页面照旧 unmatched，还以为是没保存）。
//   ⇒ 单向守不够：只守写侧，读侧改了键写侧不知道 ⇒ 必须两边**同源比对**。
//
// 判据（四组，全部 fail-closed）：
//   S 扫描面       文件在位 + 云函数目录数下界 + 三处登记锚点在场（防「扫空 ⇒ 0 ≤ 预算 ⇒ 恒绿」）
//   A 正向         键三决定（原始 dish_key 不归一 / platform 可空 / 两端 trim）+ 五要素
//                  （鉴权 / 付费墙 / 限流 / 幂等+审计 / _id 主键）+ 卡存在性校验 + 前端接线
//   B 反向         不得归一、不得 doc(业务键)、不得物理删、picker range 不得硬编码
//   C 自检         真调生产纯函数，四态样本能红能绿；断言数下界
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const CF = 'cloudfunctions/saveDishMapping';
const REL_INDEX = CF + '/index.js';
const REL_SERVICE = CF + '/service.js';
const REL_VALIDATE = CF + '/validate.js';
const REL_READ = 'cloudfunctions/getDishReview/index.js';
const REL_WXML = 'pages/m3/dishreview/index.wxml';
const REL_PAGE = 'pages/m3/dishreview/index.js';
const REL_CORE10 = 'specs/dev-specs/core/10_云函数清单与接口契约.md';
const REL_R85 = 'tools/selftest_r85.js';

const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const srcIndex = rd(REL_INDEX);
const srcService = rd(REL_SERVICE);
const srcValidate = rd(REL_VALIDATE);
const srcRead = rd(REL_READ);
const srcWxml = rd(REL_WXML);
const srcPage = rd(REL_PAGE);
const srcCore10 = rd(REL_CORE10);
const srcR85 = rd(REL_R85);

// 真调生产纯函数（**不 mock** —— 键口径必须由真实实现给出，不是由守卫复述一遍）
const W = require(path.join(ROOT, REL_SERVICE));

let pass = 0;
let failN = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('✅ ' + name + (detail ? ' — ' + detail : ''));
  } else {
    failN++;
    console.log('❌ ' + name + (detail ? ' — ' + detail : ''));
  }
}

// 剥注释（否则「注释里写了特征串」会把判据喂成恒绿 —— 同族于 check_dish_key_single_source 的 V4 实证）
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const fnDirs = fs.readdirSync(path.join(ROOT, 'cloudfunctions'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);

// ===================== S 扫描面（fail-closed）=====================
console.log('===== S 扫描面（fail-closed · 防扫空恒绿）=====');
const needFiles = [REL_INDEX, REL_SERVICE, REL_VALIDATE, REL_READ, REL_WXML, REL_PAGE, REL_CORE10, REL_R85];
const missing = needFiles.filter((f) => !fs.existsSync(path.join(ROOT, f)));
check('S-① 八个被守文件全部在位', missing.length === 0, missing.length ? '缺 ' + missing.join(' , ') : '8/8 在位');
check('S-② 云函数目录数 ≥ 45（实测 ' + fnDirs.length + ' 的保守下沿）', fnDirs.length >= 45, '实际 ' + fnDirs.length);
check('S-③ 契约文档登记了 saveDishMapping（check_fn_inventory F2 的同源锚点）',
  /\|\s*`saveDishMapping`\s*\|/.test(srcCore10), 'core/10 已登记');
check('S-④ A15 白名单已登记 saveDishMapping 目录',
  srcR85.indexOf('/^cloudfunctions\\/saveDishMapping\\//') >= 0, 'selftest_r85.js 已登记');

// ===================== A 正向 · 键口径（本守卫的头号判据）=====================
console.log('===== A1 写侧键 ≡ 读侧键（双向同源比对）=====');

// 读侧键构造：`mapIndex.set(p + '<SEP>' + ref, cc)`
const mSet = /mapIndex\.set\(\s*[\w.]+\s*\+\s*'([^']*)'\s*\+\s*[\w.]+\s*,/.exec(srcRead);
// 读侧兜底：`mapIndex.get('<SEP>' + k)`
const mFallback = /mapIndex\.get\(\s*'([^']*)'\s*\+\s*k\s*\)/.exec(srcRead);

check('A-① 能解析出读侧的键分隔符（解析不到即红，不许静默放行）',
  !!(mSet && mFallback),
  mSet && mFallback ? 'set 分隔 ' + JSON.stringify(mSet[1]) + ' / 兜底分隔 ' + JSON.stringify(mFallback[1]) : '解析失败');
check('A-② 读侧 set 的分隔符 ≡ 写侧 MAP_KEY_SEP',
  !!(mSet && mSet[1] === W.MAP_KEY_SEP),
  mSet ? '读侧 ' + JSON.stringify(mSet[1]) + ' vs 写侧 ' + JSON.stringify(W.MAP_KEY_SEP) : '解析失败');
check('A-③ 读侧「空 platform」兜底的分隔符 ≡ 写侧 MAP_KEY_SEP（保证空平台一条能跨平台命中）',
  !!(mFallback && mFallback[1] === W.MAP_KEY_SEP),
  mFallback ? '读侧兜底 ' + JSON.stringify(mFallback[1]) : '解析失败');

// 行为面：**真按读侧的查法**去查写侧落的行 —— 读侧改键或写侧改键，这一条必红
const DEMO = '★发鱿鱼【招牌】';
const writeKey = W.buildMapKey('', DEMO);                 // 写侧：platform 留空
const mapIndex = new Map([[writeKey, 'cc_demo']]);
const readHit = mapIndex.get('taobao' + W.MAP_KEY_SEP + DEMO) || mapIndex.get(W.MAP_KEY_SEP + DEMO) || '';
check('A-④ 行为面：写侧落「空 platform」的行，读侧按 taobao 查也能命中（跨平台生效）',
  readHit === 'cc_demo', '命中 ' + JSON.stringify(readHit) + '（键 ' + JSON.stringify(writeKey) + '）');

const writeKeyP = W.buildMapKey('taobao', DEMO);
const mapIndex2 = new Map([[writeKeyP, 'cc_demo2']]);
const readHit2 = mapIndex2.get('taobao' + W.MAP_KEY_SEP + DEMO) || mapIndex2.get(W.MAP_KEY_SEP + DEMO) || '';
check('A-⑤ 行为面：写侧落「带 platform」的行，读侧按同平台查命中',
  readHit2 === 'cc_demo2', '命中 ' + JSON.stringify(readHit2));

// ===================== A2 正向 · 键三决定（源码面）=====================
console.log('===== A2 键三决定（原始 dish_key 不归一 / platform 可空 / 两端 trim）=====');
const bareIndex = stripComments(srcIndex);
const bareService = stripComments(srcService);
const bareValidate = stripComments(srcValidate);

check('A-⑥ 写侧**不归一** dish_key（源码不含 normalizeDishName —— 归一即永远失配）',
  bareIndex.indexOf('normalizeDishName') < 0 && bareService.indexOf('normalizeDishName') < 0,
  'index/service 均无归一调用');
check('A-⑦ external_ref_id 落的是**原始** dish_key（v.dish_key 原样，不经任何变换）',
  /external_ref_id:\s*v\.dish_key\b/.test(bareIndex), '源码命中 external_ref_id: v.dish_key');
check('A-⑧ platform 可空：validate 允许空串且**不报错**（空 ⇒ 跨所有平台生效）',
  /const platform = typeof src\.platform === 'string' \? src\.platform\.trim\(\) : ''/.test(bareValidate),
  'validate 对 platform 只 trim 不校验非空');
const RE_TRIM_KEY = /src\.dish_key\.trim\(\)/;
const RE_KEY_NONEMPTY = /if \(!dishKey\) return err/;
check('A-⑨ 写侧两端都 trim（dish_key 空 ⇒ INVALID_PARAM，绝不落空格键）',
  RE_TRIM_KEY.test(bareValidate) && RE_KEY_NONEMPTY.test(bareValidate),
  'trim=' + RE_TRIM_KEY.test(bareValidate) + ' / 判空=' + RE_KEY_NONEMPTY.test(bareValidate));
// ⚠️ 读侧是 `(m.external_ref_id == null ? '' : String(...)).trim()` —— 闭括号在 trim **之前**，
//    正则必须把那一对括号写全（首版漏写 ⇒ 假红，守卫生自己的判据要先证伪）。
const RE_READ_TRIM = /\(m\.external_ref_id == null \? '' : String\(m\.external_ref_id\)\)\.trim\(\)/;
check('A-⑩ 读侧也 trim（两侧口径一致，前后空格不会失配）',
  RE_READ_TRIM.test(srcRead), 'trim=' + RE_READ_TRIM.test(srcRead));

// ===================== A3 正向 · 五要素（鉴权/付费墙/限流/幂等/_id）=====================
console.log('===== A3 五要素（鉴权 / 付费墙 / 限流 / 幂等 / _id 主键）=====');
check('A-⑪ 鉴权：resolveAuth + assertShopOwner 均在场（A 类 ⇒ 无需登记 PUBLIC_FNS）',
  /resolveAuth\(ctx, db\)/.test(bareIndex) && /assertShopOwner\(db, shopId, userId\)/.test(bareIndex),
  '两者皆在场');
// 🔴 下面的判据一律取「**条件 → 拒绝**的完整形态」，**不**只查特征串存在：
//    只查 `hasFeature` 存在 ⇒ 把 `if (!unlocked) return fail(...)` 删掉仍然全绿
//    （M5 实证：卡存在性校验改 `if (false)` 时守卫**不转红** ⇒ 假绿）。
//    ⇒ 判「有没有真的拒绝」，不判「有没有写过这个词」。
check('A-⑫ 付费墙真的拦：hasFeature + `if (!unlocked) return fail`（缺后者 = 查了不用）',
  /common\.hasFeature\(db, userId, FEATURE\)/.test(bareIndex)
  && /FEATURE = 'm3_dishreview'/.test(bareIndex)
  && /if \(!unlocked\) return fail\(ERROR_CODES\.FEATURE_LOCKED\)/.test(bareIndex),
  'm3_dishreview 且真的 return fail');
// ⚠️ 只判「makeRateLimiter 出现过」不够：M11 把调用换成 `const rl = { limited: false }`
//    （限流器建了、接线也在、**但从不调用**）⇒ 判据全绿而限流实际恒不触发。
//    ⇒ 必须把「调用点」也钉死：建了 + 调了 + 拒了，三段缺一即红。
check('A-⑬ 写限流真的生效：模块级单例 store + 真的调用 + 真的拒绝',
  /const RATE_STORE = new Map\(\);/.test(bareIndex)
  && /makeRateLimiter\(RATE_STORE\)/.test(bareIndex)
  && /const rl = await rateLimitCheck\(userId\);/.test(bareIndex)
  && /if \(rl\.limited\) return fail\(rl\.code\)/.test(bareIndex),
  '建了 + 调了 + 拒了');
check('A-⑭ 幂等真的生效：`if (prior) return ok` + findPriorResult + writeAudit（契约标「+幂等」）',
  /idempotency\.findPriorResult\(db, shopId, clientRequestId\)/.test(bareIndex)
  && /if \(prior\) return ok\(prior\)/.test(bareIndex)
  && /audit\.writeAudit\(db/.test(bareIndex),
  '查重 + 早退 + 审计三者齐备');
check('A-⑮ 幂等键走单源 shopKey（两处各自拼字符串 ⇒ 登记了却查不到）',
  /idempotency_key: common\.idempotency\.shopKey\(shopId, clientRequestId\)/.test(bareIndex),
  'shopKey 单源');
// 🔴 写库主键必用 _id：`doc(业务键).update()` 真云**静默 0 行**
const docArgs = [...bareIndex.matchAll(/\.doc\(([^)]*)\)/g)].map((m) => m[1].trim());
check('A-⑯ 写库主键一律 _id（每个 .doc( 实参都必须含 _id）',
  docArgs.length > 0 && docArgs.every((a) => a.indexOf('_id') >= 0),
  docArgs.length ? '实参 ' + docArgs.join(' , ') : '未找到 .doc( 调用');

// ===================== A4 正向 · 卡存在性 + 解除 + 前端接线 =====================
console.log('===== A4 卡存在性校验 / 解除走软删 / 前端接线 ====');
// 🔴 同上：判**条件-返回**形态 + **位置**（校验必须在任何写库之前），
//    只查 `RESOURCE_NOT_FOUND` 这个串存在 ⇒ 改成 `if (false)` 就静默绕过（M5 实证）。
const RE_CARD_GUARD = /if \(!latest\) return fail\(ERROR_CODES\.RESOURCE_NOT_FOUND/;
const mCardGuard = RE_CARD_GUARD.exec(bareIndex);
check('A-⑰ 挂到本店不存在的卡 ⇒ **真的** return fail（判条件-返回形态，非"串存在"）',
  !!mCardGuard && /shop_cost_card/.test(bareIndex),
  mCardGuard ? '条件-返回形态在位' : '🔴 未找到 if (!latest) return fail(RESOURCE_NOT_FOUND');
const writePos = [
  bareIndex.indexOf('da.insert(COLL'),
  bareIndex.indexOf('db.collection(COLL).doc('),
  bareIndex.indexOf('da.softDelete(COLL'),
].filter((x) => x >= 0);
const firstWrite = writePos.length ? Math.min.apply(null, writePos) : -1;
check('A-⑰b 该校验位于**任何写库之前**（挪到写之后 ⇒ 脏数据已落库才报错）',
  !!mCardGuard && firstWrite >= 0 && mCardGuard.index < firstWrite,
  '校验位 ' + (mCardGuard ? mCardGuard.index : -1) + ' < 首个写库位 ' + firstWrite);
check('A-⑱ 解除映射走**软删**（da.softDelete，可逆），绝不物理删除',
  /da\.softDelete\(COLL, row\._id, userId\)/.test(bareIndex) && !/\.remove\(/.test(bareIndex),
  'softDelete 在场且无 .remove(');
check('A-⑲ 前端有「关联」入口（picker + onPickCard）且传原始 dish_key',
  /<picker[^>]*bindchange="onPickCard"/.test(srcWxml) && /dish_key: row\.dishKey/.test(stripComments(srcPage)),
  'wxml picker + 页面传 dish_key');
check('A-⑳ 前端有「解除」入口（saveDishMapping 传空 card_code）',
  /dish_key: m\.dishKey, card_code: ''/.test(stripComments(srcPage)),
  '空 card_code = 解除');
check('A-㉑ 未匹配行保留原始 dishKey（写侧拿得到键，不至于只能拿显示名）',
  /dishKey: x\.dish_key \|\| nm/.test(stripComments(srcPage)),
  '合并时保留 dish_key');
check('A-㉒ getDishReview 出参带 mapping（否则挂错卡后该菜变 ranked ⇒ 无入口可改可删）',
  /mapping: mappingList/.test(srcRead) && /mappings/.test(stripComments(srcPage)),
  '出参 + 前端均已接');

// ===================== B 反向（防残留 / 防僵尸）=====================
console.log('===== B 反向（不该有的必须没有）=====');
check('B-① 写侧不得出现 doc(业务键) 形态（防「静默 0 行」回归）',
  !docArgs.some((a) => a.indexOf('_id') < 0),
  '全部实参含 _id');
check('B-② 前端不得自己拼映射键（键只能由后端 service 单源产出）',
  stripComments(srcPage).indexOf("'|'") < 0,
  '页面无自建分隔符拼接');
check('B-③ picker 的 range 必须来自数据，不得硬编码卡名数组',
  /range="\{\{cardOptions\}\}"/.test(srcWxml) && !/range="\[/.test(srcWxml),
  'range = {{cardOptions}}');
check('B-④ 解除分支不得顺带清空其它字段（只软删，不改 platform/dish_key）',
  !/action === 'cleared'[\s\S]{0,200}\.update\(/.test(bareIndex),
  'cleared 分支不写 update');

// ===================== C 自检（判定函数有分辨力）=====================
console.log('===== C 自检（真调生产纯函数）=====');
const C_ROWS = [
  { platform: 'taobao', external_ref_id: DEMO, card_code: 'cc1' },
  { platform: '', external_ref_id: '耙牛肉', card_code: 'cc2' },
  { platform: '', external_ref_id: '已删', card_code: 'cc3', is_deleted: true },
];
let cOk = true;
const cGot = [];
const expect = [
  [W.pickMappingRow(C_ROWS, 'taobao', DEMO), C_ROWS[0]],
  [W.pickMappingRow(C_ROWS, '', '耙牛肉'), C_ROWS[1]],
  [W.pickMappingRow(C_ROWS, '', '已删'), null],
  [W.pickMappingRow(C_ROWS, 'jd_order', '不存在'), null],
];
for (const [got, want] of expect) {
  if (got !== want) { cOk = false; cGot.push('期望 ' + (want ? want.external_ref_id : 'null') + ' 实得 ' + (got ? got.external_ref_id : 'null')); }
}
check('C-① pickMappingRow 四样本（带平台 / 空平台 / 软删跳过 / 不存在）分辨力', cOk,
  cOk ? '4/4' : cGot.join(' ; '));

const judgeCases = [
  [null, 'cc1', 'created'], [C_ROWS[0], 'cc9', 'updated'],
  [C_ROWS[0], 'cc1', 'noop'], [C_ROWS[0], '', 'cleared'], [null, '', 'noop'],
];
let jOk = true;
const jGot = [];
for (const [row, cc, want] of judgeCases) {
  const got = W.judgeMappingAction(row, cc);
  if (got !== want) { jOk = false; jGot.push(want + '→' + got); }
}
check('C-② judgeMappingAction 五态（created/updated/noop/cleared/noop）分辨力', jOk,
  jOk ? '5/5' : jGot.join(' ; '));

check('C-③ trim 生效：前后空格的 dish_key 与干净键同命中',
  W.buildMapKey(' taobao ', '  ' + DEMO + '  ') === W.buildMapKey('taobao', DEMO),
  JSON.stringify(W.buildMapKey(' taobao ', '  ' + DEMO + '  ')));

check('C-④ 断言数下界 ≥ 24（防删断言；实测见末行）', (pass + failN) >= 24, '当前累计 ' + (pass + failN));

console.log('\n===== R255 菜名映射写侧守卫：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
