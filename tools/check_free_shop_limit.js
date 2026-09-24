// tools/check_free_shop_limit.js —— 【R117】免费店铺数口径穿透守卫
//   （代码侧「单源配置」≡「各消费者」；round121 按 `开发规范v1.1_ModuleM3增量_*.md` §M3.22 #9 改造）
// 运行：node tools/check_free_shop_limit.js
//
// ─────────────────────────────────────────────────────────────────────────────
// 【本守卫的两段历史】（第一段是 round88 立项，第二段是 round121 改造；两段都留证，别删）
//
// ▸ round88 立项（同族病第 21 例）：「M1 免费 1 个账套」是**收钱口径**，代码侧当时有
//   **两个互不引用的硬编码点**：
//     ① `cloudfunctions/checkQuota/service.js:17`  `const FREE_LIMIT = { shop: 1, cost_card: 3 }`
//     ② `cloudfunctions/getShopList/index.js:38`  `const FREE_SHOP_LIMIT = 1`
//        —— 直接产出 API 出参 `free_limit` / `hit_free_limit`（`core/10:171` 已登记的对外契约出参）
//     ③ 测试镜像 `cloudfunctions/getShopList/selftest.js:11` 又抄了一份
//   ⇒ 当时 A2/A4/A5 的三条腿全靠**解析这两个字面量**互相穿透。
//
// 🔴 ▸ round121 改造（M3.22 批次 A1 之后）：**原判据已失效，必须换**。
//   批次 A1 把额度**配置化**到 `feature_permissions.plan_free.limits` ⇒ 两个硬编码点都消失、
//   三处消费者改读同一配置键。此时旧判据（解析 `FREE_SHOP_LIMIT` 字面量）会**退化为恒真**
//   —— 字面量不存在时「解析失败」与「解析为空」混在一起，改坏任何一侧都不再转红
//   （与 round118 抓到的 R102 病灶「改对反而转红 / 改坏反而不红」同型）。
//   ⇒ 新判据 = **正反两面**：
//     ① **正面**：三处消费者必须**引用同一配置读取路径**（`feature_permissions` + `plan_free` + `limits`）；
//     ② **反面**：三处消费者**剥注释后必须零额度字面量**（`FREE_SHOP_LIMIT` / `FREE_LIMIT =` / `shop: <数字>`）
//        ⇒ 任何人把额度写回代码（硬编码复发）当场转红。
//
// ▸ **同时修正旧头注的两处事实错误**（M3.22 §一⑦ 登记）：旧头注称 checkQuota 是
//   "真正执行付费墙拦截的那一个" —— 实测**当时它是错的**：全仓 `checkQuota` 仅被前端调用一次，
//   **写侧零拦截**（`saveCostCard` 全文无配额代码）⇒ 付费墙"只提示、不拦截"。写侧拦截
//   由批次 A1 在 `saveCostCard/index.js` 新补（本守卫守其 M1 店铺侧同源口径）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 判据（全部 fail-closed；解析不到即判红，不许静默放行、不许 crash）：
//   A1 扫描面 fail-closed（逐份）：单源 + 3 处消费者存在且非空；前端面逐根达下界。
//   A2 单源可解析：`initDb/collections.js` 中 `plan_id:'plan_free'` 行的 `limits.shop`。
//   A3 正面·同源：两个**读配置的消费者**剥注释后必须同时引用 `feature_permissions` / `plan_free` / `limits`。
//   A3-b 正面·镜像：`getShopList/selftest.js` 明文须标注其口径来源（`plan_free.limits`）。
//   A4 反面·零字面量：3 处消费者**剥注释后**不得出现额度字面量（防硬编码复发）。
//   A5 出参契约完整性：`free_limit`（带左边界，防被 `hit_free_limit` 顶替）/ `hit_free_limit` / `hard_limit`。
//   A6 前端零硬编码（`pages/`+`utils/`+`miniprogram/` 不得复制该口径）。
//   A7 前提守卫（证明本守卫不是恒真）：四份目标文件在扫描面内 + 单源确含 `plan_free` 行 +
//     反向断言对象剥注释后长度达下界（防读空 ⇒ 零命中假绿）。
//   W  弱面：明示代码侧其它 `FREE_*` 常量（只打印不判红）。
//
// 🔴 **为什么只做代码侧、不重复 R102 的文档腿**（避免同族守卫互相打架）：
//    文档声明 ≡ 单源 已由 R102 `check_quota_limits.js` 承担；本守卫只补 R102 **覆盖不到的那一维**
//    ——「单源配置 ≡ 代码侧各消费者」，两者靠「声明≡单源」与「单源≡消费者」传递闭合，不重叠。
// ⚠️ 明写边界：本守卫**只守 `shop`（M1 账套）这一维**；`cost_card`（M3 成本卡）由 R102 覆盖。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 🔴 单源已由「Service 常量」迁到「配置集合种子」（M3 v1.1 批次 A1）
const SRC_REL = 'cloudfunctions/initDb/collections.js';
const READER_RELS = [
  'cloudfunctions/checkQuota/index.js',      // M3 侧读配置（店铺维度按 user_id；成本卡维度按 shop_id）
  'cloudfunctions/getShopList/index.js',     // M1 侧读配置（出参 free_limit / hit_free_limit）
];
const MIRROR_REL = 'cloudfunctions/getShopList/selftest.js';
const CONSUMER_RELS = READER_RELS.concat([MIRROR_REL]);
// 小程序根 = 仓根（round88 实读：`pages/` `utils/` `app.*` 在根，`miniprogram/` 只有 config/ 与 i18n/）
const FE_DIRS = ['pages', 'utils', 'miniprogram'];
const FE_ROOT_FILES = ['app.js', 'app.json', 'app.wxss'];

const MIN_BYTES = 200;
const MIN_CODE = 150;                 // 剥注释后的长度下界（防读空 ⇒ 零命中假绿）
const FE_FLOOR = { pages: 30, utils: 5, miniprogram: 2 };   // 坑㉛：逐根下界，取实测的保守值
const FE_APP_MIN = 3;

const LIMITS_RE = /plan_id:\s*['"]plan_free['"][\s\S]{0,400}?limits:\s*\{([^}]*)\}/;
const SRC_SHOP_RE = /(?:^|[^A-Za-z0-9_])shop\s*:\s*(\d+)/;
const FE_FORBID_RE = /FREE_SHOP_LIMIT|FREE_LIMIT\s*=/;
// 反面断言：额度字面量（剥注释后不得出现于消费者）
const LIT_PATTERNS = [
  { re: /const\s+FREE_SHOP_LIMIT\s*=/, tag: '`const FREE_SHOP_LIMIT =` 常量' },
  { re: /const\s+FREE_LIMIT\s*=/, tag: '`const FREE_LIMIT =` 常量' },
  { re: /(?:^|[^A-Za-z0-9_$])shop\s*:\s*\d/, tag: '`shop: <数字>` 字面量' },
  { re: /(?:^|[^A-Za-z0-9_$])hard_shop\s*:\s*\d/, tag: '`hard_shop: <数字>` 字面量' },
];

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}

function readRel(rel) {
  try {
    const p = path.join(ROOT, rel);
    const st = fs.statSync(p);
    return { text: fs.readFileSync(p, 'utf8'), bytes: st.size, ok: true };
  } catch (_) { return { text: '', bytes: 0, ok: false }; }
}
// 剥注释（带 `:` 前置判定，避免把 `http://` 之类当行注释；与本仓 R102 同款实现）
function stripComment(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
/** 工作树递归（坑⑱：不用 git ls-files，那只扫 index） */
function walk(dir, exts, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === 'miniprogram_npm' || e.name === '.git') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(abs);
  }
  return out;
}

const src = readRel(SRC_REL);
const readers = READER_RELS.map((r) => ({ rel: r, f: readRel(r) }));
const mirror = readRel(MIRROR_REL);
const consumers = readers.concat([{ rel: MIRROR_REL, f: mirror }]);
const feByDir = {};
const feFiles = [];
for (const d of FE_DIRS) {
  const got = walk(path.join(ROOT, d), ['.js', '.wxml', '.json'], []);
  feByDir[d] = got.length;
  feFiles.push(...got);
}
for (const f of FE_ROOT_FILES) {
  try { fs.statSync(path.join(ROOT, f)); feFiles.push(path.join(ROOT, f)); } catch (_) { /* 缺失由 A1 判 */ }
}

// ⚠️ banner **不能用 `=====`**：R66 的 `SECTION_HEAD` 会把 `===== x =====` 当成段标题并做「零断言即判红」，
//    而本守卫在 banner 后立刻开 A1 子段 ⇒ banner 段零断言 ⇒ 假红（round88 首跑实证）。
console.log(`单源(配置) ${SRC_REL}`);
console.log(`消费者 ${CONSUMER_RELS.join(' / ')}`);
console.log(`前端面 ${feFiles.length} 文件`);
console.log('R117 · 免费店铺数口径穿透守卫（单源配置 ≡ 各消费者；反向断言防硬编码复发）');

// —— A1 扫描面 fail-closed
console.log('\n===== A1 扫描面 fail-closed =====');
check('A1-① 单源（配置种子）存在且非空', src.ok && src.bytes >= MIN_BYTES, `${src.bytes}B`);
readers.forEach((r, i) => check(`A1-②-${i + 1} 消费者 ${r.rel} 存在且非空`, r.f.ok && r.f.bytes >= MIN_BYTES, `${r.f.bytes}B`));
check('A1-③ 测试镜像存在且非空', mirror.ok && mirror.bytes >= MIN_BYTES, `${mirror.bytes}B`);
const feAppN = FE_ROOT_FILES.filter((f) => { try { fs.statSync(path.join(ROOT, f)); return true; } catch (_) { return false; } }).length;
const badFeDir = FE_DIRS.filter((d) => (feByDir[d] || 0) < FE_FLOOR[d]);
check('A1-④ 前端扫描面逐根达下界（坑㉛：根路径写错即红）', badFeDir.length === 0,
  badFeDir.length ? badFeDir.map((d) => `${d}=${feByDir[d]}<${FE_FLOOR[d]}`).join(' | ')
    : FE_DIRS.map((d) => `${d}:${feByDir[d]}/${FE_FLOOR[d]}`).join(' '));
check(`A1-⑤ 根级 app 文件 ${feAppN}/${FE_APP_MIN} 在位`, feAppN >= FE_APP_MIN, `${feAppN} 个`);

// —— A2 单源解析（fail-closed，解析失败也不崩）
console.log('\n===== A2 单源（配置种子）可解析 =====');
const lm = src.text.match(LIMITS_RE);
const srcShop = lm ? (lm[1].match(SRC_SHOP_RE) || [])[1] : null;
check('A2 单源 plan_free.limits.shop 可解析（fail-closed）', srcShop !== undefined && srcShop !== null,
  srcShop !== null ? `shop=${srcShop}` : `解析失败（${SRC_REL} 未见 plan_id:'plan_free' + limits）`);

// —— A3 正面·同源（读配置的消费者必须引用同一配置键）
console.log('\n===== A3 正面：消费者引用同一配置读取路径 =====');
const readerCodes = readers.map((r) => ({ rel: r.rel, code: stripComment(r.f.text) }));
// ⚠️ 逐键用**语义级**匹配，不用裸 `includes`：round121 变异回灌 M8 实证
//    —— 裸 `includes('plan_free')` 会被 `'plan_freeX'` 这类改名**子串命中** ⇒ 改坏不转红（假绿）。
const KEY_MARKERS = [
  { k: 'feature_permissions', re: /['"]feature_permissions['"]/ },
  { k: 'plan_free', re: /['"]plan_free['"]/ },
  { k: 'limits', re: /(?:^|[^A-Za-z0-9_$])limits(?:[^A-Za-z0-9_$]|$)/ },
];
readers.forEach((r, i) => {
  const code = readerCodes[i].code;
  const miss = KEY_MARKERS.filter((m) => !m.re.test(code)).map((m) => m.k);
  check(`A3-①-${i + 1} ${r.rel} 剥注释后引用同一配置键（${KEY_MARKERS.map((m) => m.k).join(' / ')}）`, miss.length === 0,
    miss.length ? `缺 ${miss.join(' / ')}` : '三键齐（语义级匹配，非裸子串）');
});
check('A3-② 两个读配置的消费者**同源**（都读 feature_permissions.plan_free.limits，非各自常量）',
  readerCodes.length === 2 && readerCodes.every((x) => KEY_MARKERS.every((m) => m.re.test(x.code))),
  'checkQuota/index.js + getShopList/index.js');
check('A3-b 测试镜像明确标注口径来源（明文含 plan_free.limits）',
  /plan_free\s*\.\s*limits/.test(mirror.text), /plan_free\s*\.\s*limits/.test(mirror.text) ? '注释在场' : '未标注来源');

// —— A4 反面·零额度字面量（防硬编码复发）
console.log('\n===== A4 反面：消费者剥注释后零额度字面量 =====');
consumers.forEach((c) => {
  const code = stripComment(c.f.text);
  const hits = LIT_PATTERNS.filter((p) => p.re.test(code)).map((p) => p.tag);
  check(`A4 ${c.rel} 零额度字面量`, hits.length === 0, hits.length ? `命中 ${hits.join(' / ')}` : '零命中');
});

// —— A5 出参契约完整性（core/10:171 登记的对外契约出参）
console.log('\n===== A5 出参契约完整性（core/10:171）=====');
const dupText = readRel(READER_RELS[1]).text;
// ⚠️ 裸 `free_limit\s*:` 会被 `hit_free_limit:` 命中 ⇒ 删掉 `free_limit` 出参仍判绿（round88 M9 变异实证）。
//    必须加左边界（与 round70 B4「`.scope-head` 裸子串匹配兄弟类」同族）。
const HAS_FREE = /(?:^|[^A-Za-z0-9_$])free_limit\s*:/m.test(dupText);
const HAS_HIT = /(?:^|[^A-Za-z0-9_$])hit_free_limit\s*:/m.test(dupText);
const HAS_HARD = /(?:^|[^A-Za-z0-9_$])hard_limit\s*:/m.test(readRel(READER_RELS[0]).text);
check('A5-① getShopList 出参含 free_limit（左边界，防被 hit_free_limit 顶替）', HAS_FREE, HAS_FREE ? '在场' : '缺失');
check('A5-② getShopList 出参含 hit_free_limit', HAS_HIT, HAS_HIT ? '在场' : '缺失');
check('A5-③ checkQuota 出参含 hard_limit（硬上限与免费额分列）', HAS_HARD, HAS_HARD ? '在场' : '缺失');

// —— A6 前端零硬编码（设计意图：后端权威，前端不硬编码）
console.log('\n===== A6 前端零硬编码（设计意图：后端权威，前端不硬编码）=====');
const feHits = [];
for (const f of feFiles) {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  if (FE_FORBID_RE.test(t)) feHits.push(path.relative(ROOT, f).replace(/\\/g, '/'));
}
check('A6-① 小程序端零命中 FREE_SHOP_LIMIT / FREE_LIMIT =（前端不得复制该口径）',
  feHits.length === 0, feHits.length ? feHits.join(' | ') : `${feFiles.length} 个文件零命中`);
check('A6-② 前提：前端扫描面确含已知页面目录（扫描面没打错）',
  feFiles.some((f) => f.includes(`${path.sep}pages${path.sep}`)) &&
  feFiles.some((f) => f.includes(`${path.sep}utils${path.sep}`)), 'pages/ + utils/ 在内');

// —— A7 前提守卫（证明本守卫不是恒真）
console.log('\n===== A7 前提守卫（非恒真）=====');
check('A7-① 前提：四份目标文件都在扫描面内（路径没写错）',
  src.ok && readers.every((r) => r.f.ok) && mirror.ok,
  `${SRC_REL} / ${READER_RELS.join(' / ')} / ${MIRROR_REL}`);
check('A7-② 前提：单源确含 plan_id:\'plan_free\' 行（本守卫的立论依据仍在）',
  /plan_id:\s*['"]plan_free['"]/.test(src.text), /plan_id:\s*['"]plan_free['"]/.test(src.text) ? 'plan_free 行在场' : '行已消失，判据需重估');
const thin = consumers.filter((c) => stripComment(c.f.text).length < MIN_CODE).map((c) => `${c.rel}(${stripComment(c.f.text).length}<${MIN_CODE})`);
check('A7-③ 前提：反向断言对象剥注释后长度达下界（防读空 ⇒ 零命中假绿）', thin.length === 0,
  thin.length ? `过短 ${thin.join(', ')}` : consumers.map((c) => `${path.basename(path.dirname(c.rel))}=${stripComment(c.f.text).length}`).join(' '));

// —— W 弱面（只明示不判红）
console.log('\n===== W 弱面（只明示不判红）=====');
const otherFree = [];
for (const rel of CONSUMER_RELS.concat([SRC_REL])) {
  readRel(rel).text.split(/\r?\n/).forEach((l, i) => {
    const m = l.match(/const\s+(FREE_[A-Z_]+)/);
    if (m && m[1] !== 'FREE_SHOP_LIMIT') otherFree.push(`${rel}:${i + 1} ${m[1]}`);
  });
}
console.log('  ⚠️ 代码侧其它 FREE_* 常量（本守卫不判红，交由 R102 守）：');
console.log(`     ${otherFree.length ? otherFree.join(' | ') : '（无）'}`);
// ⚠️ 本段必须有**断言**（R66 `check_selftest_shape.js`：`===== x =====` 段标题下零断言即判红，
//    原版 R117 有 `W-①`，round121 重写时漏带 ⇒ 门禁当场抓到 `[free-shop-limit] ❌ FAIL`）。
//    断言内容取「扫描面非退化」而非「必须命中」—— 命中数天然可为 0（常量都已迁配置），
//    若断言 `otherFree.length >= 1` 就成了**恒红**。
const wScanned = CONSUMER_RELS.concat([SRC_REL]).filter((r) => readRel(r).ok).length;
check('W-① 弱面已打印且扫描面非退化（消费者 + 单源均读到）',
  wScanned === CONSUMER_RELS.length + 1, `${wScanned}/${CONSUMER_RELS.length + 1} 份已读；其它 FREE_* 常量 ${otherFree.length} 处`);

console.log(`\n===== 免费店铺数口径穿透守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
