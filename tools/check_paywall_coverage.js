// tools/check_paywall_coverage.js —— R159 · 「付费能力清单 ≡ 付费墙落地面」守卫
//
// ===== 为什么立这条（真缺口，非纸面演练）=====
//   规范钉死一条铁律：「**付费墙必须先于付费功能落地**」。但在工程上**无人强制**：
//     · `cloudfunctions/common/entitlement.js` 的 `PAID_FEATURES` 登记了
//       `export / m3_combo(套餐) / m3_takeaway(外卖)`；
//     · 而全树**真实调用 `hasFeature(...)` 的只有 1 处**（`exportData/index.js:58`，且是 export）；
//     · 前端更狠：`utils/paywall.js` 只放行 `saveLimit / export` 两类，
//       **即便有人调 `openPaywall('combo')` 也会被静默 `return`** —— 表现是"点了没反应"。
//   ⇒ "登记能力"只是加一行数组，"接墙"要动三处文件；**没人拦就必然漏**（本仓已漏了两个）。
//   本守卫把这个缺口变成**机器判据**：登记即必须配套墙，否则转红。
//
// ===== 单源与派生（不写映射表，避免制造第二个单源）=====
//   能力键 → 弹窗键的派生规则：`m3_combo` → 去掉 `m3_` 前缀 → `combo`；`export` 原样。
//   （若改用一张手写映射表，表本身又会与两处清单漂移 —— 同族病。）
//
// ===== 判据（全部 fail-closed：解析不到即判红，不静默放行、不抛异常）=====
//   L1 三单源可解析   PAID_FEATURES / PAYWALL_TYPES / TERMS.paywall，各自带下界（防解析失效 ⇒ 零命中假绿）
//   L2 能力 ⊆ 放行    每个付费能力派生出的键都必须 ∈ PAYWALL_TYPES（否则**弹不出墙**）
//   L3 放行 ⊆ 文案    PAYWALL_TYPES 每个键都必须有 TERMS.paywall[键]（否则 `def` 为 undefined ⇒ 弹窗崩）
//   L4 文案四字段     title / content / primary / secondary 齐全且非空（showModal 缺位会 fail）
//   L5 反恒真         影子样本：虚构能力 `m3_foobar` 喂同一判据 ⇒ **必须判红**（证明有分辨力）
//   L6 云函数侧双向   ① 反向：代码里 `hasFeature(...,'X')` 的 X 必须 ∈ PAID_FEATURES（防"未登记就拦"）
//                     ② 正向（R213 修假绿）：非 export 能力必须**穷尽分类** ——
//                        a) 有同名云函数目录 ⇒ 该目录内必须出现 `hasFeature(`；
//                        b) 无同名目录 ⇒ 必须在 WALL_ANCHORS 显式登记落点；`at` 指向文件时必须
//                           **可验证**（该文件真含此能力的 `hasFeature(...,'key')` 调用）；
//                           `at:null` 表示「云侧确无可挂点」，必须写理由（显式设计边界，非遗漏）；
//                        c) 登记表不得含陈旧键（键必须都还在 PAID_FEATURES 里）；
//                        d) 分类不重不漏：非 export 能力 100% 落入「同名目录 ∪ 登记表」。
//      🔴 原判据按**目录名**匹配，而仓内**没有 combo / takeaway 目录** ⇒ 匹配面恒空 ⇒ 断言**恒绿**
//         （R212 §5-2 挖出；与 R182「上限类判据扫描面一空即恒绿」同族）。
//   L7 自失效护栏     扫描面文件数下界 + 派生集大小下界（≥3）
//
// 运行：node tools/check_paywall_coverage.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENT_REL = 'cloudfunctions/common/entitlement.js';
const PW_REL = 'utils/paywall.js';
const TERMS_REL = 'miniprogram/i18n/terms.js';
const CF_DIR = 'cloudfunctions';

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  ✅ ${name}${detail ? ` —— ${detail}` : ''}`); }
  else { fails.push(name); console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`); }
}
const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; }
};

// ---- 单源解析 ----
const entSrc = read(ENT_REL);
const mKeys = entSrc.match(/const\s+PAID_FEATURES\s*=\s*\[([\s\S]*?)\]/);
const PAID = mKeys ? (mKeys[1].match(/'([^']+)'|"([^"]+)"/g) || []).map((s) => s.slice(1, -1)) : [];

const pwSrc = read(PW_REL);
const mTypes = pwSrc.match(/const\s+PAYWALL_TYPES\s*=\s*\[([\s\S]*?)\]/);
const TYPES = mTypes ? (mTypes[1].match(/'([^']+)'|"([^"]+)"/g) || []).map((s) => s.slice(1, -1)) : [];

let TERMS = null;
try { const mod = require(path.join(ROOT, TERMS_REL)); TERMS = mod && mod.TERMS ? mod.TERMS : mod; } catch (_) { TERMS = null; }
const paywall = TERMS && TERMS.paywall;

/** 能力键 → 弹窗键（`m3_combo` → `combo`；无前缀原样返回） */
const deriveKey = (k) => (k.indexOf('m3_') === 0 ? k.slice(3) : k);

// ---- L1 单源可解析（fail-closed）----
check('L1-① 云端 PAID_FEATURES 可解析且 ≥ 3 项', PAID.length >= 3, `${PAID.length} 项：[${PAID.join(', ')}]`);
check('L1-② 前端 PAYWALL_TYPES 可解析且 ≥ 2 项', TYPES.length >= 2, `${TYPES.length} 项：[${TYPES.join(', ')}]`);
check('L1-③ TERMS.paywall 可解析', !!paywall && typeof paywall === 'object',
  paywall ? `顶层键：${Object.keys(paywall).join(', ')}` : '解析失败');

const derived = PAID.map(deriveKey);

// ---- L2 每个付费能力都弹得出墙 ----
const noWall = derived.filter((k) => TYPES.indexOf(k) < 0);
check('L2 每个付费能力派生键都 ∈ PAYWALL_TYPES（登记即必须能弹墙）', noWall.length === 0,
  noWall.length ? `弹不出墙：${noWall.join(', ')}（openPaywall 会静默 return）`
    : derived.map((k) => `${k}→${k}`).join(' / '));

// ---- L3 每个放行类型都有文案（否则 def undefined ⇒ 弹窗崩）----
const noTerms = TYPES.filter((t) => !paywall || !paywall[t]);
check('L3 PAYWALL_TYPES 每个键都有 TERMS.paywall[键]', noTerms.length === 0,
  noTerms.length ? `缺文案：${noTerms.join(', ')}` : `${TYPES.length} 个键全部有文案`);

// ---- L4 文案四字段齐全 ----
const FIELDS = ['title', 'content', 'primary', 'secondary'];
const badFields = [];
for (const t of TYPES) {
  const def = paywall && paywall[t];
  if (!def) continue;
  const miss = FIELDS.filter((f) => !def[f] || String(def[f]).trim() === '');
  if (miss.length) badFields.push(`${t} 缺 ${miss.join('/')}`);
}
check('L4 各触发键的 title/content/primary/secondary 均非空', badFields.length === 0,
  badFields.length ? badFields.join(' | ') : `${TYPES.length} 个键 × 4 字段全齐`);

// ---- L5 反恒真：影子样本必须判红 ----
const judgeMissing = (keys, types) => keys.map(deriveKey).filter((k) => types.indexOf(k) < 0);
const shadowBad = judgeMissing(PAID.concat(['m3_foobar']), TYPES);
check('L5-① 影子：把虚构能力 m3_foobar 塞进清单 ⇒ 判据必须判红（证明有分辨力）',
  shadowBad.length === 1 && shadowBad[0] === 'foobar', `判红 ${shadowBad.length} 项：[${shadowBad.join(', ')}]`);
check('L5-② 影子：真实清单必须判绿（正负互证用的是同一段逻辑）', judgeMissing(PAID, TYPES).length === 0,
  `判红 ${judgeMissing(PAID, TYPES).length} 项`);

// ---- L6 云函数侧双向 ----
// ① 反向：代码里出现 hasFeature(...,'X') 的 X 必须已登记
let cfFiles = [];
function walk(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
cfFiles = walk(path.join(ROOT, CF_DIR), []);
const HASFEAT_RE = /hasFeature\s*\(\s*[^,)]+\s*,\s*[^,)]+\s*,\s*['"]([A-Za-z0-9_]+)['"]/g;
const usedKeys = new Set();
let hasFeatCalls = 0;
for (const f of cfFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (/\/cx_[A-Za-z0-9_]+\.js$/.test(rel)) continue;   // 派生副本：聚合导出不算调用点
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  HASFEAT_RE.lastIndex = 0;
  let m;
  while ((m = HASFEAT_RE.exec(t)) !== null) { usedKeys.add(m[1]); hasFeatCalls += 1; }
}
const unregistered = Array.from(usedKeys).filter((k) => PAID.indexOf(k) < 0);
check('L6-① 反向：代码里 hasFeature(...,\'X\') 的 X 必须 ∈ PAID_FEATURES（防未登记就拦）',
  unregistered.length === 0,
  unregistered.length ? `未登记却已拦：${unregistered.join(', ')}` : `实调用 ${hasFeatCalls} 处 / 键 {${Array.from(usedKeys).join(', ')}}`);

// ② 正向（R213 修假绿）：非 export 能力必须**穷尽分类**。
//   🔴 原判据按「目录名含关键字」匹配，而仓内**根本没有 combo / takeaway 目录** ⇒ 匹配面恒空
//      ⇒ fnWallGaps 恒空 ⇒ 断言**恒绿**（R212 §5-2 挖出；与 R182「扫描面一空即恒绿」同族）。
//   `at: null` = 「云侧确无可挂点」——必须写理由；这是**显式登记的设计边界**，不是"忘了"。
const WALL_ANCHORS = [
  { key: 'm3_combo', at: 'cloudfunctions/saveCostCard/index.js',
    why: '套餐是 saveCostCard 的 card_type===3 分支（无独立云函数目录），墙接在该分支上（见 L6-① 实调用点）。' },
  { key: 'm3_takeaway', at: null,
    why: '外卖为纯前端试算（utils/takeawayDerive.js 纯计算、不落库、无服务端接口）⇒ 云侧无校验点可挂；'
       + '属已知设计边界（core/13 与 NOTE_round212 已留档），非遗漏。' },
];
const dirs = (() => { try { return fs.readdirSync(path.join(ROOT, CF_DIR), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { return []; } })();
const nonExport = PAID.filter((k) => deriveKey(k) !== 'export');

const fnWallGaps = [];
const coveredByDir = [];
for (const k of nonExport) {
  const kw = deriveKey(k).replace(/_/g, '').toLowerCase();     // combo / takeaway
  const hit = dirs.filter((d) => d.toLowerCase().indexOf(kw) >= 0);
  if (!hit.length) continue;
  coveredByDir.push(k);
  for (const fn of hit) {
    const src = walk(path.join(ROOT, CF_DIR, fn), []).map((f) => {
      try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; }
    }).join('\n');
    if (src.indexOf('hasFeature(') < 0) fnWallGaps.push(`${fn}(缺 ${k} 的墙)`);
  }
}
check('L6-②a 有同名云函数目录的能力，该目录内必须接墙', fnWallGaps.length === 0,
  fnWallGaps.length ? fnWallGaps.join(' | ')
    : (coveredByDir.length ? `已检目录：${coveredByDir.join(', ')}` : '本仓暂无「同名目录」能力（其余由 ②b/②e 承接）'));

const anchorByKey = new Map(WALL_ANCHORS.map((a) => [a.key, a]));
const hasKeyRe = (k) => new RegExp("hasFeature\\s*\\([^)]*['\"]" + k + "['\"]");
const anchorGaps = [];
const verifiedAnchors = [];
for (const k of nonExport) {
  if (coveredByDir.indexOf(k) >= 0) continue;
  const a = anchorByKey.get(k);
  if (!a) { anchorGaps.push(`${k}(无同名目录，且未登记落点)`); continue; }
  if (!a.why || String(a.why).trim().length < 10) { anchorGaps.push(`${k}(登记了落点但缺理由)`); continue; }
  if (a.at) {
    if (!hasKeyRe(k).test(read(a.at))) { anchorGaps.push(`${k}(落点 ${a.at} 内无 hasFeature(...,'${k}') 调用)`); continue; }
    verifiedAnchors.push(`${k}→${a.at}`);
  } else {
    verifiedAnchors.push(`${k}→前端（云侧无可挂点，已登记边界）`);
  }
}
check('L6-②b 无同名目录的能力必须显式登记落点（穷尽分类，防"扫不到就恒绿"）',
  anchorGaps.length === 0,
  anchorGaps.length ? anchorGaps.join(' | ') : verifiedAnchors.join(' / '));

const withAt = WALL_ANCHORS.filter((a) => a.at);
check('L6-②c 登记落点（at 非空）必须可验证：该文件真含此能力的 hasFeature 调用（防用豁免表掩盖漏接）',
  withAt.every((a) => hasKeyRe(a.key).test(read(a.at))),
  withAt.length ? withAt.map((a) => `${a.key}→${a.at}`).join(' / ') : '无 at 落点条目');

const staleAnchors = WALL_ANCHORS.filter((a) => PAID.indexOf(a.key) < 0);
check('L6-②d 落点登记无陈旧键（键必须仍在 PAID_FEATURES 内）', staleAnchors.length === 0,
  staleAnchors.length ? `陈旧/错键：${staleAnchors.map((a) => a.key).join(', ')}` : `${WALL_ANCHORS.length} 条登记，键全部有效`);

const classified = nonExport.filter((k) => coveredByDir.indexOf(k) >= 0 || anchorByKey.has(k));
check('L6-②e 分类穷尽：非 export 能力 100% 落入「同名目录 ∪ 落点登记」',
  nonExport.length > 0 && classified.length === nonExport.length,
  `非 export 能力 ${nonExport.length} 项 → 同名目录 ${coveredByDir.length} + 落点登记 ${nonExport.filter((k) => coveredByDir.indexOf(k) < 0).length}`);

// ---- L7 自失效护栏 ----
check('L7-① 扫描面下界：cloudfunctions 下 .js 文件 ≥ 200（防遍历失效 ⇒ 零命中假绿）',
  cfFiles.length >= 200, `${cfFiles.length} 个 .js`);
check('L7-② 派生集下界：付费能力 ≥ 3（导出/套餐/外卖）', derived.length >= 3, `${derived.length} 项`);
check('L7-③ 反恒真前提：影子判据确实能被触发（judge 非恒真）',
  judgeMissing(['m3_x'], []).length === 1 && judgeMissing([], TYPES).length === 0);

// ---- L8 页面级付费入口（R299 新增，R443 扩面到到店团购）----
//   为什么单立这一组（真缺口，R299 实测）：付费能力 `m3_takeaway`（以及 R443 的团购）在本仓
//   **没有云端校验点**（纯前端试算、不落库）⇒ 它唯一的墙就是**页面入口**。而 `subpkg/biz/takeaway/index.js` 里
//   两个计算入口的墙**不一致**：`onCalc` 过 `fetchEntitlement`，`onReverse`（挂牌价反算）**不过**
//   ⇒ 未开通用户可直接用反算拿到同一份付费价值。
//   判据（**语义级**，不钉字面量）：页面里**任何调用付费能力纯函数的方法体**，都必须在**同一方法体内**
//   出现 `fetchEntitlement`。⇒ 「同页面同能力的所有入口口径一致」成为机器可判的不变量。
// 🔴 R443 扩面：清单**必须按页面配**，不能共用一张全局函数表 —— 否则
//   ① 把团购的 pure fn 塞进全局表，会让外卖页"多认一个不属于它的入口"（判据被稀释）；
//   ② 外卖页的函数留在全局表里，又会让团购页的 L8-① 被别页函数喂成恒真。
//   故 `unpaidPaidCallers(bodies, fns)` 显式收函数清单；`floor` 取该页**真实**方法体数量的下界。
const PAGES = [
  { key: 'takeaway', label: '外卖单均', page: 'subpkg/biz/takeaway/index.js',
    fns: ['calcTakeawayOrder', 'reverseListedPrice'], floor: 15 },
  { key: 'groupon', label: '到店团购', page: 'subpkg/biz/groupon/index.js',
    fns: ['calcGrouponOrder'], floor: 8 },
];

/** 取出「Page({...}) 顶层方法」的方法体（花括号配平）；配平失败 ⇒ 返回 null（fail-closed）。 */
function pageMethodBodies(src) {
  const out = [];
  const re = /^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = src.indexOf('{', m.index);
    let depth = 0;
    let i = start;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) return null;
    out.push({ name: m[1], body: src.slice(start, i + 1) });
  }
  return out;
}

/** 判据本体：给定方法体列表 + **该页**的付费纯函数清单，返回「调了付费函数但没过墙」的方法名。 */
function unpaidPaidCallers(bodies, fns) {
  const list = fns || [];
  return (bodies || []).filter((b) => list.some((fn) => new RegExp('\\b' + fn + '\\(').test(b.body))
    && !/fetchEntitlement\s*\(/.test(b.body))
    .map((b) => b.name);
}

const pageState = {};
PAGES.forEach((p) => {
  let src = '';
  try { src = fs.readFileSync(path.join(ROOT, p.page), 'utf8'); } catch (_) { src = ''; }
  const bodies = pageMethodBodies(src);
  const unpaid = bodies ? unpaidPaidCallers(bodies, p.fns) : ['<抽取失败>'];
  pageState[p.key] = { bodies, unpaid };
  check(`L8-① 🔴 ${p.label}页内调用付费能力纯函数的方法，必须**在同一方法体内**过付费墙`
    + ' —— 否则同一付费能力出现"有的入口拦、有的不拦"（未开通用户绕道用）',
    bodies !== null && unpaid.length === 0,
    unpaid.length ? `未过墙：${unpaid.join(', ')}` : `方法体 ${bodies ? bodies.length : 0} 个`);
  check(`L8-② ${p.label}页扫描面下界：方法体解析到 ≥ ${p.floor} 个（防抽取失效 ⇒ L8-① 恒真）`,
    bodies !== null && bodies.length >= p.floor, bodies ? `${bodies.length} 个` : '抽取失败');
  // 反恒真：用**本页自己的**函数清单造两个样本 —— 「调了付费纯函数但没过墙」必须判红；「两者都有」必须判绿。
  const FIX_FAKE_BAD = [{ name: 'onNoWall', body: '{ const r = ' + p.fns[0] + '({}); this.setData({ r }); }' }];
  const FIX_FAKE_OK = [{ name: 'onWithWall', body: '{ const e = await fetchEntitlement(); const r = ' + p.fns[0] + '({}, f); }' }];
  check(`L8-③ ${p.label}页反恒真：无墙样本必须判红、有墙样本必须判绿（证明 L8-① 有分辨力，不是恒真）`,
    unpaidPaidCallers(FIX_FAKE_BAD, p.fns).length === 1 && unpaidPaidCallers(FIX_FAKE_OK, p.fns).length === 0,
    `bad=${unpaidPaidCallers(FIX_FAKE_BAD, p.fns).length} ok=${unpaidPaidCallers(FIX_FAKE_OK, p.fns).length}`);
});

// L8-④ 反算的**输入新鲜度**（R299 实测的真缺陷 T3，与付费墙无关但同一轮修的）：
//   原实现把 `dish_cost_fen` / `pack_cost_fen` 取自 `this.data.result`（只有点过「计算」才有）
//   ⇒ ① 未点计算就点反算 ⇒ 两个成本取 0 ⇒ 挂牌价里**完全没有食材与包装成本** ⇒ 严重偏低；
//      ② 点过后改了菜品/数量再反算 ⇒ 用的是**上一次的旧成本**。
//   判据：`onReverse` 必须**自己调 `calcTakeawayOrder`** 且**不得读 `this.data.result`**。
const onReverseBody = (() => {
  const b = ((pageState.takeaway || {}).bodies || []).find((x) => x.name === 'onReverse');
  return b ? b.body : '';
})();
const REVERSE_DEPENDS_OLD = /this\.data\.result/.test(onReverseBody);
check('L8-④ 🔴 反算必须按**当前录入**自算（调 calcTakeawayOrder），不得读 `this.data.result`'
  + ' —— 未点过「计算」时它为 null ⇒ 食材/包装成本取 0 ⇒ 反算挂牌价偏低，老板照它定价就亏',
  onReverseBody.length > 0 && !REVERSE_DEPENDS_OLD && /calcTakeawayOrder\s*\(/.test(onReverseBody),
  onReverseBody.length ? (REVERSE_DEPENDS_OLD ? '仍在读 this.data.result' : '已自算当前录入') : 'onReverse 未解析到');
check('L8-⑤ 反恒真：把「读 this.data.result 的旧实现」喂给 L8-④ ⇒ 必须判不通过',
  REVERSE_DEPENDS_OLD === false
  && /this\.data\.result/.test('{ const cf = this.data.result ? this.data.result.cash.dish_cost_fen : 0; }'));

// L8-⑥ 跨页隔离反恒真（R443 扩面的**核心理由**）：若共用一张全局函数表，别的页的付费函数
//   会被本页判据"认领" ⇒ 判据永远是非空集合在互相稀释。必须证明清单真的按页生效：
//   拿团购的 pure fn 喂外卖清单、拿外卖的 pure fn 喂团购清单，**都必须判绿**（不属于本页能力）。
const X_TAK = [{ name: 'onGrouponOnly', body: '{ const r = calcGrouponOrder({}); this.setData({ r }); }' }];
const X_GRP = [{ name: 'onTakeawayOnly', body: '{ const r = calcTakeawayOrder({}, f); this.setData({ r }); }' }];
check('L8-⑥ 跨页隔离反恒真：团购函数喂外卖清单、外卖函数喂团购清单都必须判绿（清单按页配，不串味）',
  unpaidPaidCallers(X_TAK, PAGES[0].fns).length === 0 && unpaidPaidCallers(X_GRP, PAGES[1].fns).length === 0,
  `外卖清单认领团购入口=${unpaidPaidCallers(X_TAK, PAGES[0].fns).length} 团购清单认领外卖入口=${unpaidPaidCallers(X_GRP, PAGES[1].fns).length}`);

// ⚠️ R69：本守卫的**最后一行必须**是「N 通过 / M 失败」收尾行 —— 收尾文案一律排在它**之前**。
if (fails.length) console.log('失败项：' + fails.join(' | '));
console.log(fails.length === 0
  ? `✅ 付费能力清单（${PAID.join('/')}）每一项都已配好墙：弹窗类型 + 文案四字段，且无一"登记了却弹不出"。`
  : '❌ 付费能力与墙的落地面已脱节 —— 见上方失败项。');
console.log(`\n===== R159 付费墙覆盖面守卫结果：${pass} 通过 / ${fails.length} 失败 =====`);
process.exit(fails.length === 0 ? 0 : 1);
