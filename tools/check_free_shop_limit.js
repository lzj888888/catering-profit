// tools/check_free_shop_limit.js —— 【R117】免费店铺数口径穿透守卫（代码侧第二硬编码点 ≡ 单源 ≡ 测试镜像 ≡ 前端零硬编码）
// 运行：node tools/check_free_shop_limit.js
//
// 为什么需要它（**同族病第 21 例**，2026-09-22 round88 反向扫描发现）：
//   「M1 免费 1 个账套」是**收钱口径**（商业化方案 v1.4 唯一声明处；core/13 决策单；core/09 错误码表对外契约）。
//   代码侧却有**两个互不引用的硬编码点**：
//     ① 单源 `cloudfunctions/checkQuota/service.js:17`  `const FREE_LIMIT = { shop: 1, cost_card: 3 }`
//        —— 真正执行付费墙拦截的那一个，由 R102 `check_quota_limits.js` 守（其 `SRC_REL` 写死这一份）。
//     ② **第二硬编码点** `cloudfunctions/getShopList/index.js:38` `const FREE_SHOP_LIMIT = 1`
//        —— 直接产出 API 出参 `free_limit` / `hit_free_limit`（`core/10:171` 已登记的对外契约出参）。
//     ③ 测试镜像 `cloudfunctions/getShopList/selftest.js:11` 又抄了一份。
//
//   实扫证据（round88，回源实扫、不采信任何自述）：
//   ① `grep -rn "FREE_SHOP_LIMIT" tools/ specs/dev-specs/prototype/` ⇒ **零命中** ⇒ 第 ② 点**长期零守卫**；
//   ② R102 的 `SRC_REL = 'cloudfunctions/checkQuota/service.js'` 是**写死的单一路径** ⇒ 对第 ② 点**零覆盖**；
//   ③ `checkQuota/service.js:11` 注释明写「常量定义于 Service（后端权威，**前端不硬编码**）」
//      ⇒ 设计意图就是**单源**，第 ② 点是**违反该意图的平行实现**（不是副本，是独立常量）。
//
//   ⇒ 后果：李老师按唯一声明处把免费店铺数 1 → 2，R102 会跟着绿（它只解析 checkQuota），
//     而 `getShopList` 仍是 1 ⇒ **列表接口返回的 `hit_free_limit` 在第 2 家就 true，
//     可真正拦截的 checkQuota 却放行** ⇒ 展示与拦截分叉，门禁全绿无人报警。反向同理。
//   ⇒ 与 round66 第 10 例（商业化额度）同源但更隐蔽：那一例修的是「文档抄错数」，
//     这一例是「**代码侧单源被绕过**」—— R102 只把 checkQuota 钉住，没发现还有第二处。
//   ⇒ **「缺守卫」与「已违规」分开上报**（round55 纪律）：当前实扫三处同值 **1**、**零漂移**，
//     本守卫做的是**防复发**。
//
// 判据（穿透四条腿 + 两条前提，缺一不可）：
//   A1 扫描面 fail-closed：三份目标文件存在且非空（路径写错 = 扫空 ⇒ 红，不许 catch 静默跳过）。
//   A2 单源可解析：`FREE_LIMIT` 的 `shop` 字段（fail-closed）。
//   A3 第二硬编码点可解析：`getShopList/index.js` 的 `FREE_SHOP_LIMIT`（fail-closed，删掉即红）。
//   A4 **核心穿透**：单源 `shop` ≡ 第二点 `FREE_SHOP_LIMIT`（改任一侧 ⇒ 红）。
//   A5 测试镜像 ≡ 第二点（只改 selftest 造成本地漂移 ⇒ 红）。
//   A6 前端零硬编码（`miniprogram/` 下不得出现 `FREE_SHOP_LIMIT` / `FREE_LIMIT =`）
//      + 前提守卫：扫描面文件数 ≥ FE_MIN（扫空即红，坑⑱：用工作树递归，不用 git ls-files）。
//   A7 出参契约完整性：`getShopList` 的 `ok({...})` 必须带 `free_limit` 与 `hit_free_limit`（`core/10:171`）。
//   A8 前提：扫描面确含三份目标文件（排除面没打错，自指排除没误伤）。
//   W  弱面：明示代码侧其它 `FREE_*` 硬编码点（只打印不判红）。
//
// 🔴 **为什么只做代码侧、不重复 R102 的文档腿**（避免同族守卫互相打架）：
//    文档声明 ≡ 单源 已由 R102 `check_quota_limits.js` 承担；本守卫只补 R102 **覆盖不到的那一维**
//    ——「单源 ≡ 代码侧第二硬编码点」。两者靠「声明≡单源」与「单源≡第二点」传递闭合，不重叠。
// ⚠️ 明写边界：本守卫不校验 `cost_card`（M3 成本卡 3 张）—— 它只有 checkQuota 一处，由 R102 覆盖。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_REL = 'cloudfunctions/checkQuota/service.js';
const DUP_REL = 'cloudfunctions/getShopList/index.js';
const MIRROR_REL = 'cloudfunctions/getShopList/selftest.js';
// 小程序根 = 仓根（round88 实读：`pages/` `utils/` `app.*` 在根，`miniprogram/` 只有 config/ 与 i18n/）
const FE_DIRS = ['pages', 'utils', 'miniprogram'];
const FE_ROOT_FILES = ['app.js', 'app.json', 'app.wxss'];

const MIN_BYTES = 200;
// 坑㉛：总计下界不够，必须**逐根下界**（下界取实测的保守值；round88 实测 pages 42 / utils 11 / miniprogram 2 / app 3）
const FE_FLOOR = { pages: 30, utils: 5, miniprogram: 2 };
const FE_APP_MIN = 3;

const SRC_OBJ_RE = /const\s+FREE_LIMIT\s*=\s*\{([^}]*)\}/;
const SRC_SHOP_RE = /shop\s*:\s*(\d+)/;
const DUP_RE = /const\s+FREE_SHOP_LIMIT\s*=\s*(\d+)/;
const FE_FORBID_RE = /FREE_SHOP_LIMIT|FREE_LIMIT\s*=/;

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
  } catch (_) {
    return { text: '', bytes: 0, ok: false };
  }
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
const dup = readRel(DUP_REL);
const mirror = readRel(MIRROR_REL);
const feByDir = {};
const feFiles = [];
for (const d of FE_DIRS) {
  const got = walk(path.join(ROOT, d), ['.js', '.wxml', '.json'], []);
  feByDir[d] = got.length;
  feFiles.push(...got);
}
for (const f of FE_ROOT_FILES) {
  try { fs.statSync(path.join(ROOT, f)); feFiles.push(path.join(ROOT, f)); } catch (_) { /* 缺失由 A1-④ 判 */ }
}

// ⚠️ banner **不能用 `=====`**：R66 的 `SECTION_HEAD` 会把 `===== x =====` 当成段标题并做「零断言即判红」，
//    而本守卫在 banner 后立刻开 A1 子段 ⇒ banner 段零断言 ⇒ 假红（round88 首跑实证）。
//    ⇒ 改成纯文本（不带 `=` 围栏），让 A1…W 各自成为带 ✅ 的段。
console.log(`单源 ${SRC_REL} / 第二点 ${DUP_REL} / 镜像 ${MIRROR_REL} / 前端面 ${feFiles.length} 文件`);
console.log('R117 · 免费店铺数口径穿透守卫（代码侧第二硬编码点 ≡ 单源）');

// —— A1 扫描面 fail-closed
console.log('\n===== A1 扫描面 fail-closed =====');
check('A1-① 单源文件存在且非空', src.ok && src.bytes >= MIN_BYTES, `${src.bytes}B`);
check('A1-② 第二硬编码点文件存在且非空', dup.ok && dup.bytes >= MIN_BYTES, `${dup.bytes}B`);
check('A1-③ 测试镜像文件存在且非空', mirror.ok && mirror.bytes >= MIN_BYTES, `${mirror.bytes}B`);
const feAppN = FE_ROOT_FILES.filter((f) => { try { fs.statSync(path.join(ROOT, f)); return true; } catch (_) { return false; } }).length;
const badFeDir = FE_DIRS.filter((d) => (feByDir[d] || 0) < FE_FLOOR[d]);
check('A1-④ 前端扫描面逐根达下界（坑㉛：根路径写错即红）', badFeDir.length === 0,
  badFeDir.length ? badFeDir.map((d) => `${d}=${feByDir[d]}<${FE_FLOOR[d]}`).join(' | ')
    : FE_DIRS.map((d) => `${d}:${feByDir[d]}/${FE_FLOOR[d]}`).join(' '));
check(`A1-⑤ 根级 app 文件 ${feAppN}/${FE_APP_MIN} 在位`, feAppN >= FE_APP_MIN, `${feAppN} 个`);

// —— A2/A3 解析（fail-closed）
console.log('\n===== A2/A3 单源与第二点可解析（fail-closed）=====');
const srcObj = src.text.match(SRC_OBJ_RE);
const srcShop = srcObj ? (srcObj[1].match(SRC_SHOP_RE) || [])[1] : null;
check('A2 单源 FREE_LIMIT.shop 可解析', srcShop !== undefined && srcShop !== null, `shop=${srcShop}`);
const dupM = dup.text.match(DUP_RE);
const dupV = dupM ? dupM[1] : null;
check('A3 第二点 FREE_SHOP_LIMIT 可解析', dupV !== null, `FREE_SHOP_LIMIT=${dupV}`);
const mirM = mirror.text.match(DUP_RE);
const mirV = mirM ? mirM[1] : null;
check('A3-② 测试镜像 FREE_SHOP_LIMIT 可解析', mirV !== null, `selftest=${mirV}`);

// —— A4 核心穿透
console.log('\n===== A4 核心穿透：单源 ≡ 第二硬编码点 =====');
const N = srcShop;
check(`A4-① 单源 shop(${srcShop}) ≡ 第二点 FREE_SHOP_LIMIT(${dupV})`,
  srcShop !== null && dupV !== null && Number(srcShop) === Number(dupV),
  `${srcShop} vs ${dupV}`);
check(`A4-② 该值等于唯一声明处的 ${N}（口径穿透闭合）`, Number(dupV) === Number(N), `${dupV}`);

// —— A5 测试镜像
console.log('\n===== A5 测试镜像 ≡ 第二点 =====');
check(`A5 镜像(${mirV}) ≡ 第二点(${dupV})`, mirV !== null && dupV !== null && Number(mirV) === Number(dupV),
  `${mirV} vs ${dupV}`);

// —— A6 前端零硬编码（checkQuota/service.js:11 的设计意图）
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

// —— A7 出参契约完整性（core/10:171 登记的对外契约出参）
console.log('\n===== A7 出参契约完整性（core/10:171）=====');
// ⚠️ 裸 `free_limit\s*:` 会被 `hit_free_limit:` 命中 ⇒ 删掉 `free_limit` 出参仍判绿（round88 M9 变异实证）。
//    必须加左边界（与 round70 B4「`.scope-head` 裸子串匹配兄弟类」同族）。
const HAS_FREE = /(?:^|[^A-Za-z0-9_$])free_limit\s*:/m.test(dup.text);
const HAS_HIT = /(?:^|[^A-Za-z0-9_$])hit_free_limit\s*:/m.test(dup.text);
check('A7-① getShopList 出参含 free_limit（左边界，防被 hit_free_limit 顶替）', HAS_FREE, HAS_FREE ? '在场' : '缺失');
check('A7-② getShopList 出参含 hit_free_limit', HAS_HIT, HAS_HIT ? '在场' : '缺失');

// —— A8 前提守卫
console.log('\n===== A8 前提守卫 =====');
check('A8-① 前提：三份目标文件都在扫描面内（路径没写错）',
  src.ok && dup.ok && mirror.ok, `${SRC_REL} / ${DUP_REL} / ${MIRROR_REL}`);
check('A8-② 前提：单源确含「前端不硬编码」设计意图注释（本守卫 A6 的立论依据仍在）',
  /前端不硬编码/.test(src.text), /前端不硬编码/.test(src.text) ? '注释在场' : '注释已消失，A6 立论需重估');

// —— W 弱面（只明示不判红）
console.log('\n===== W 弱面（只明示不判红）=====');
const otherFree = [];
for (const rel of [SRC_REL, DUP_REL, MIRROR_REL]) {
  const t = readRel(rel).text;
  t.split(/\r?\n/).forEach((l, i) => {
    const m = l.match(/const\s+(FREE_[A-Z_]+)/);
    if (m && m[1] !== 'FREE_SHOP_LIMIT') otherFree.push(`${rel}:${i + 1} ${m[1]}`);
  });
}
console.log(`  ⚠️ 代码侧其它 FREE_* 常量（本守卫不判红，交由 R102 守）：`);
console.log(`     ${otherFree.length ? otherFree.join(' | ') : '（无）'}`);
check('W-① 弱面已打印（坑⑭：裸扫数字必误杀）', otherFree.length >= 1, `${otherFree.length} 处`);

console.log(`\n===== 免费店铺数口径穿透守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
