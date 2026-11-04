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
  { key: 'm3_combo', at: null,
    why: 'A10（2026-11-05 · 规范 v1.1 §1）：套餐专属付费墙**已按规范删除**，云侧确已无可挂点。'
       + '套餐是 card_type===3 的 shop_cost_card，保存时统一走 saveCostCard 第 8.5 步的**成本卡配额**'
       + '（按 card_code 去重计数：免费 5 张 / 付费按套餐表）⇒ 权益已经收到，不需要第二道墙。'
       + '能力键 `m3_combo` 仍留在 PAID_FEATURES（防旧客户端 / 回滚），但「键存在」不等于「有墙」。' },
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

// ---- L9 提审期交易闸门（R601 新增；主体=个人 ⇒ 普通商户号走不通，交易必须先关）----
//   为什么单立这一组：L1~L8 只保证「付费能力都配了墙」，**不保证墙后面在卖东西**。
//   而个人主体提审的红线是「不许出现虚拟商品售卖」—— 判据必须回答：
//     「开关关掉时，用户点付费入口 → 到底会不会建单 / 引导客服 / 看到价格」。
//   判据全部**锚到函数体内**（教训 R299：全文匹配会被同文件另一处同名模式喂成恒真）。
const FLAGS_REL = 'utils/featureFlags.js';
const ORDERS_REL = 'subpkg/tools/pay/orders.js';
const flagsSrc = read(FLAGS_REL);
const mFlag = flagsSrc.match(/const\s+PAYWALL_ENABLED\s*=\s*(true|false)\s*;/);
const flagVal = mFlag ? mFlag[1] : '';
check('L9-① PAYWALL_ENABLED 可解析为布尔字面量（fail-closed：解析不到即红，防开关被改名后静默失效）',
  !!flagVal, flagVal ? `PAYWALL_ENABLED = ${flagVal}` : '解析失败');

/** 取顶层 `function name(...) {...}` / `async function name(...) {...}` 的函数体；配平失败 ⇒ ''（fail-closed）。 */
function fnBody(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return '';
  const start = src.indexOf('{', m.index);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

// 判据本体（单独抽出来，才能拿影子样本反证它"真的会判红"）。
//   要求：① 函数体内出现 `if (!PAYWALL_ENABLED)`；
//        ② 该闸门**确实通向关闭态出口**（showNotOpen / showFreeLimit 之一）；
//        ③ 闸门必须**先于** `wx.showModal`（否则用户先看到报价、再被拦，等于已经展示了售卖信息）。
//   ⚠️ R603：原判据钉死单行写法 `if (!PAYWALL_ENABLED) return showNotOpen();`，
//      而本轮把关闭态拆成「配额类 → showFreeLimit / 其余 → showNotOpen」的块状写法，
//      钉字面量会把**正确实现**判红（R297 同族：断言要判语义、别钉字面量）。
const GATE_RE = /if\s*\(\s*!\s*PAYWALL_ENABLED\s*\)/;
function gateOk(body) {
  if (!body) return false;
  const g = body.search(GATE_RE);
  if (g < 0) return false;
  const hasExit = /showNotOpen|showFreeLimit/.test(body);
  if (!hasExit) return false;
  const m = body.indexOf('wx.showModal');
  return m < 0 || g < m;
}

const openBody = fnBody(pwSrc, 'openPaywall');
check('L9-② 🔴 openPaywall 函数体内必须有提审期闸门，且**先于**报价弹窗（关掉时用户看不到任何售卖信息）',
  gateOk(openBody), openBody ? (gateOk(openBody) ? '闸门在 wx.showModal 之前' : '缺闸门或闸门在弹窗之后') : 'openPaywall 未解析到');

// L9-③ 关闭态出口的**文案面**：不许出现价格、支付、开通、客服、续费。
//   🔴 这条必须判**文案的实际字符串值**，不能只判函数体 ——
//      函数体里只有 `TERMS.pay.notOpenBody` 这个**引用**，真正的字在 terms.js；
//      只扫函数体的话，把文案改成「请联系客服开通」判据照样绿（同族病：读到引用 ≠ 读到内容）。
const notOpenBody = fnBody(pwSrc, 'showNotOpen');
// 🔴 R603：关闭态现在有**两个**出口 —— showNotOpen（兜底）+ showFreeLimit（配额类）。
//   只扫前一个 ⇒ 配额弹窗里写「升级后可开 10 家店」照样判绿（同族病：只守一个分支）。
const freeLimitBody = fnBody(pwSrc, 'showFreeLimit');
const BAD_WORDS = ['联系客服', '客服', '开通', '购买', '续费', '支付', '付款', '元/', '¥', '价格', '订阅', '会员', '升级', '付费'];
const payT = (TERMS && TERMS.pay) || {};
const notOpenText = [
  payT.notOpenTitle, payT.notOpenBody,
  payT.freeLimitShopTitle, payT.freeLimitShopBody,
  payT.freeLimitCardTitle, payT.freeLimitCardBody, payT.freeLimitGeneric,
].filter(Boolean).join('');
const notOpenHits = BAD_WORDS.filter((w) => notOpenText.indexOf(w) >= 0);
// 同时要求两个函数体都**引用**单源文案（防绕开 terms 直接硬编码一句诱导话）
const usesTerms = /TERMS\.pay\.notOpenTitle/.test(notOpenBody) && /TERMS\.pay\.notOpenBody/.test(notOpenBody)
  && /TERMS\.pay\.freeLimit/.test(freeLimitBody);
check('L9-③ 🔴 关闭态两个出口（兜底/配额）都必须引用单源文案，且文案值不得含价格/支付/开通/客服/续费/升级类词 —— 闸门在但话诱导 = 白关',
  notOpenBody.length > 0 && freeLimitBody.length > 0 && usesTerms && notOpenHits.length === 0,
  notOpenHits.length ? `文案命中禁词：${notOpenHits.join('、')}`
    : (!usesTerms ? '函数体未引用 TERMS.pay.notOpen* / freeLimit*（疑似硬编码）'
      : `两个出口文案干净（合计 ${notOpenText.length} 字符）`));

// L9-④ 纵深：绕过弹窗直调下单函数时也必须被拦。
//   `onConfirm` 是 payCreateOrder 的唯一前端入口；`orders.onRenew` 是 payRenew 的唯一入口。
const confirmBody = fnBody(pwSrc, 'onConfirm');
check('L9-④a 🔴 onConfirm 函数体内有独立闸门（防 deep link / 改版绕过 openPaywall 直接建单）',
  GATE_RE.test(confirmBody), confirmBody ? (GATE_RE.test(confirmBody) ? '已拦' : '缺闸门') : 'onConfirm 未解析到');

let ordersSrc = '';
try { ordersSrc = fs.readFileSync(path.join(ROOT, ORDERS_REL), 'utf8'); } catch (_) { ordersSrc = ''; }
const ordersBodies = pageMethodBodies(ordersSrc) || [];
const renewBody = (ordersBodies.find((b) => b.name === 'onRenew') || {}).body || '';
// 🔴 必须锚到 `load()` 体内：同文件 `data.showRenew: false` 也命中 `showRenew:`，
//    全文匹配会抓到 data 那行（恒不带开关）⇒ 判据永久判红/或反过来被喂绿（R299 同族）。
const loadBody = (ordersBodies.find((b) => b.name === 'load') || {}).body || '';
const entryGated = /showRenew\s*:\s*PAYWALL_ENABLED\s*&&/.test(loadBody);
check('L9-④b 🔴 续费页 onRenew 有独立闸门，且 load() 里的 showRenew 入口受开关约束（否则订单页仍是一个"续费"按钮）',
  GATE_RE.test(renewBody) && entryGated,
  renewBody ? `onRenew ${GATE_RE.test(renewBody) ? '已拦' : '缺闸门'} / showRenew ${entryGated ? '受控' : '未受控'}`
    : 'onRenew 未解析到');

// L9-⑤ 单源：开关只允许在 featureFlags.js 定义（本仓反复踩「同一开关多处写死 ⇒ 半开半关」）。
const FRONT_ROOTS = ['pages', 'subpkg', 'utils'];
const frontFiles = FRONT_ROOTS.reduce((acc, r) => walk(path.join(ROOT, r), acc), []);
const dupDef = frontFiles
  .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
  .filter((rel) => rel !== FLAGS_REL)
  .filter((rel) => /(?:const|let|var)\s+PAYWALL_ENABLED\s*=/.test(read(rel)));
check('L9-⑤ 开关单源：PAYWALL_ENABLED 只允许在 utils/featureFlags.js 定义（防半开半关）',
  dupDef.length === 0 && frontFiles.length > 50,
  dupDef.length ? `重复定义：${dupDef.join(', ')}` : `扫描面 ${frontFiles.length} 个 .js，无重复定义`);

// L9-⑥ 反恒真：影子样本必须被判红（否则上面几条只是"恒绿装饰"）。
const SHADOW_NO_GATE = '{ const def = TERMS.paywall[type]; wx.showModal({ title: def.title }); }';
const SHADOW_GATE_AFTER = '{ wx.showModal({ title: x }); if (!PAYWALL_ENABLED) return showNotOpen(); }';
check('L9-⑥ 反恒真：无闸门样本必须判红、闸门在弹窗之后也必须判红（证明 L9-② 有分辨力）',
  gateOk(SHADOW_NO_GATE) === false && gateOk(SHADOW_GATE_AFTER) === false && gateOk(openBody) === true,
  `无闸门=${gateOk(SHADOW_NO_GATE)} 闸门后置=${gateOk(SHADOW_GATE_AFTER)} 真实=${gateOk(openBody)}`);

// L9-⑦ 🔴 反方向守卫：**关售卖 ≠ 关功能**（R603 修正 R602 的错）。
//   为什么必须有这一条：L9-①~⑥ 只回答「闸门在不在」，**没有一条**回答「关掉之后功能还能不能用」。
//   R602 把闸门挂在 openPaywall（它的 11 个调用点全是"付费域判定失败后的出口"）⇒
//   外卖算不了、套餐存不了、复盘 locked、导出点不动，而门禁 227 全绿。
//   ⇒ 同族病第九例：**守卫只守「分支在不在」，不守「分支到不到」**。
//   判据：关闭态下前后端都要有免费期短路，且短路必须**先于**取库（证明是短路、不是兜底）。
const feEntBody = fnBody(read('utils/entitlement.js'), 'fetchEntitlement');
const feFreeOk = (b) => !!b && /if\s*\(\s*FREE_ACCESS_MODE\s*\)/.test(b) && /is_active\s*:\s*true/.test(b);
const beEntBody = fnBody(read('cloudfunctions/common/entitlement.js'), 'hasFeature');
const beFreePos = beEntBody.indexOf('if (FREE_ACCESS)');
const beFreeOk = !!beEntBody && beFreePos >= 0
  && /if\s*\(\s*FREE_ACCESS\s*\)\s*return\s+true\s*;/.test(beEntBody)
  && (beEntBody.indexOf('loadExpireAt') < 0 || beFreePos < beEntBody.indexOf('loadExpireAt'));
const SHADOW_NO_FREE = '{ const d = await api.call(x); return { is_active: !!d.is_active }; }';
check('L9-⑦ 🔴 关闭态下付费域必须**仍可用**：前端 fetchEntitlement + 后端 hasFeature 都要有免费期短路（否则「不收费」被做成「不可用」）',
  feFreeOk(feEntBody) && beFreeOk && feFreeOk(SHADOW_NO_FREE) === false,
  `前端短路=${feFreeOk(feEntBody)} / 后端短路=${beFreeOk} / 无短路样本判红=${feFreeOk(SHADOW_NO_FREE) === false}`
    + (!beFreeOk ? ' ⇒ 后端缺短路：导出/套餐/复盘/映射仍返 FEATURE_LOCKED' : ''));

// L9-⑧ 🔴 前后端开关同源：只改一处 ⇒ 「前端放行、后端仍锁」半开半关，全程不报错（§26 老病）。
//   前端是派生（FREE_ACCESS_MODE = !PAYWALL_ENABLED），云端是独立字面量 ⇒ 必须逐值比对。
const mBack = read('cloudfunctions/common/payFlags.js').match(/const\s+FREE_ACCESS\s*=\s*(true|false)\s*;/);
const backVal = mBack ? mBack[1] : '';
const derivedOk = /const\s+FREE_ACCESS_MODE\s*=\s*!\s*PAYWALL_ENABLED\s*;/.test(flagsSrc);
const expectBack = flagVal === 'true' ? 'false' : 'true';
check('L9-⑧ 前后端开关同源：云端 FREE_ACCESS === !前端 PAYWALL_ENABLED，且前端必须由开关派生（防半开半关）',
  !!backVal && derivedOk && backVal === expectBack,
  `前端 PAYWALL_ENABLED=${flagVal || '解析失败'} / 派生=${derivedOk} / 云端 FREE_ACCESS=${backVal || '解析失败'}（期望 ${expectBack}）`);

// ⚠️ R69：本守卫的**最后一行必须**是「N 通过 / M 失败」收尾行 —— 收尾文案一律排在它**之前**。
if (fails.length) console.log('失败项：' + fails.join(' | '));
console.log(fails.length === 0
  ? `✅ 付费能力清单（${PAID.join('/')}）每一项都已配好墙：弹窗类型 + 文案四字段，且无一"登记了却弹不出"。`
  : '❌ 付费能力与墙的落地面已脱节 —— 见上方失败项。');
console.log(`\n===== R159 付费墙覆盖面守卫结果：${pass} 通过 / ${fails.length} 失败 =====`);
process.exit(fails.length === 0 ? 0 : 1);
