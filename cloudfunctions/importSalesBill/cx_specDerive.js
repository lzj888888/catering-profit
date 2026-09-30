// cloudfunctions/common/specDerive.js —— M3.14 组件分类 + M3.15 多规格（派生层**单源**）
//
// 依据：`specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.14 / §M3.15。
//
// 🔴 红线（三条，与规范同字）：
//   ① 本文件**不得被内联进任何一份 `service.js`** —— 只此一份 + 由 `tools/sync_common.js`
//      派生的扁平副本（`<func>/cx_specDerive.js`）。**5 份引擎副本一个都不碰。**
//   ② **规格成本不得写入 `total_cost`** —— `total_cost` 永远 = 派生系数全 1 时的值。
//      本文件**不返回**任何要落库的成本；派生只服务「试算 / 展示」。
//   ③ **恒等性由构造成立**：系数全 1 ⇒ 派生结果与入参**逐字节相同**（见 `deriveSpec` 的 `k === 1` 分支）。
//
// 为什么"多规格"唯一允许的实现形式是**入参变换**：
//   半份菜的**调料不减半**（否则没味）⇒ 半份成本 ≠ 全份成本 × 0.5。
//   行业里"半份定价 = 全份 **65%**"正是"固定成本不减半"的结果。
//   做法 = 按组件类型缩放 `quantity`（+ 按 `aux` 缩放辅料桶），再把结果喂**同一个** `calcCostCard`
//   ⇒ 成本口径零分歧、引擎零改动、不产生额外版本行。

// 组件类型（M3.14）：主料 / 辅料 / 调料 / 半成品 / 耗材包装。
// 🔴 这 5 个**机器键**是本文件的私产；前端 `terms.js::lineKind` 的键集必须与之一致
//   （守卫 `tools/check_spec_derive.js` L5 逐键比对 —— 键名不同 = 缩放静默失效）。
const LINE_KINDS = ['main', 'aux', 'season', 'semi', 'pack'];
const LINE_KIND_DEFAULT = 'main';

// 规格系数**预设**（老板可覆盖；此处数值只是**预填**，不参与任何金额计算）。
//   ⚠️ 系数合法域 = **[0, 1]**（规范 §M3.26 错误表：`INVALID_PARAM` = 「系数非 0~1 的数」）
//     ⇒ **「大份」（>1）在本版规格口径下不可表达**，属已登记的边界（要放大份须先改规范）。
//   半份：调料 ×1（不减半，否则没味）、耗材 ×1（包装不减）—— 这是 65% 定价的成因。
const SPEC_PRESETS = [
  { spec_key: 'half', name: '半份', coef: { main: 0.5, aux: 0.7, season: 1, semi: 0.5, pack: 1 } },
  { spec_key: 'small', name: '小份', coef: { main: 0.7, aux: 0.85, season: 1, semi: 0.7, pack: 1 } },
];

const MAX_COEF = 1;      // 系数上界（见上：规范定死 0~1）
const MAX_SPECS = 4;     // 单卡规格条数上界（防滥用）

function findPreset(specKey) {
  const k = String(specKey == null ? '' : specKey).trim();
  return SPEC_PRESETS.find((p) => p.spec_key === k) || null;
}

// 行的组件类型：缺字段 / 非法值一律按 `main` 兜底（**fail-soft**：存量行没有这个字段）。
//   ⚠️ 兜底只作用于**入参派生**，绝不回写存量数据（存量卡只 INSERT 不 UPDATE —— 红线）。
function kindOf(line) {
  const k = line && line.line_kind;
  return LINE_KINDS.indexOf(String(k)) >= 0 ? String(k) : LINE_KIND_DEFAULT;
}

// 取某组件类型在给定系数表里的系数；缺失/非法 ⇒ 1（**不是 0**：漏配一类不该让成本归零）
function coefOf(coef, kind) {
  const v = coef ? coef[String(kind)] : undefined;
  return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 1;
}

// 系数是否全 1（恒等）—— 只有**确定**全 1 才允许走"原样透传"分支
function isIdentityCoef(coef) {
  return LINE_KINDS.every((k) => coefOf(coef, k) === 1);
}

/**
 * 多规格派生（**唯一**允许的实现形式：入参变换）。
 * @param {Array<{quantity:number, net_unit_cost:number, line_kind?:string}>} lines 明细行
 * @param {number} auxFen 辅料桶（整数分；`aux` 类归此桶）
 * @param {object} coef 系数表 {main,aux,season,semi,pack}（缺失项按 1）
 * @returns {{ lines: Array, auxFen: number }} 可直接喂 `calcCostCard` 的入参
 *
 * 🔴 系数为 1 的那一类**原值透传**（不乘不除不 round）⇒ 「系数全 1 时结果 ≡ 原值」由构造保证，
 *   而不是靠"浮点乘法恰好不产生偏差"这种运气（0.7 × 1000 = 700.0000000000001 是真实存在的毛刺）。
 */
function deriveSpec(lines, auxFen, coef) {
  const src = Array.isArray(lines) ? lines : [];
  const out = src.map((l) => {
    const k = coefOf(coef, kindOf(l));
    const q = Number(l && l.quantity) || 0;
    // k === 1 ⇒ 不碰原值（恒等性的构造性保证）
    const qty = k === 1 ? q : Math.round(q * k * 1e6) / 1e6;
    return Object.assign({}, l, { quantity: qty });
  });
  const auxK = coefOf(coef, 'aux');
  const aux = Number(auxFen) || 0;
  const auxOut = auxK === 1 ? aux : Math.round(aux * auxK);
  return { lines: out, auxFen: auxOut };
}

// 各组件类型的**全 1** 系数表（恒等基准；供试算「原样」与规范化用）
function unitCoef() {
  const c = {};
  for (const k of LINE_KINDS) c[k] = 1;
  return c;
}

/**
 * 清洗一份系数表：只保留已知组件键、数值域 [0, MAX_COEF]。
 * @returns {{ok:boolean, value?:object, why?:string}}
 */
function sanitizeCoef(raw) {
  if (raw == null) return { ok: true, value: unitCoef() };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: '规格系数 coef 必须是对象' };
  const out = unitCoef();
  for (const k of Object.keys(raw)) {
    if (LINE_KINDS.indexOf(k) < 0) continue;          // 未知键**丢弃**（不报错：向前兼容）
    const v = raw[k];
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > MAX_COEF) {
      return { ok: false, why: `规格系数 ${k} 必须是 0~${MAX_COEF} 之间的数（当前：${JSON.stringify(v)}）` };
    }
    out[k] = v;
  }
  return { ok: true, value: out };
}

/**
 * 清洗 `specs_json`（落库前）。接受「数组」或「JSON 字符串」（库里是 TEXT）。
 * 系数与可读名缺省从 `SPEC_PRESETS` 补（单源）；**快照**落库（与成本卡快照哲学一致）。
 * @returns {{error:string|null, value:Array}}
 */
function sanitizeSpecs(raw) {
  if (raw == null || raw === '') return { error: null, value: [] };
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (e) { return { error: '规格 specs 必须是 JSON 数组' }; }
  }
  if (!Array.isArray(arr)) return { error: '规格 specs 必须是数组' };
  if (arr.length > MAX_SPECS) return { error: `规格条数不得超过 ${MAX_SPECS} 条` };
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: '规格条目必须是对象' };
    const key = String(s.spec_key == null ? '' : s.spec_key).trim();
    if (!key) return { error: '规格 spec_key 不能为空' };
    if (seen.has(key)) return { error: `规格 spec_key 重复：${key}` };
    seen.add(key);
    const price = Number(s.price_fen == null ? 0 : s.price_fen);
    if (!Number.isInteger(price) || price < 0) return { error: `规格 ${key} 的 price_fen 必须是非负整数分` };
    const preset = findPreset(key);
    const cs = sanitizeCoef(s.coef != null ? s.coef : (preset ? preset.coef : null));
    if (!cs.ok) return { error: `规格 ${key}：${cs.why}` };
    const name = String(s.name == null || s.name === '' ? (preset ? preset.name : key) : s.name).trim() || key;
    out.push({ spec_key: key, name, coef: cs.value, price_fen: price, enabled: s.enabled !== false });
  }
  return { error: null, value: out };
}

// 库里存 TEXT（规范 M3.15：`specs_json` TEXT，默认 '[]'）⇒ 落库/读出两侧都走这对函数
function specsToJson(specs) {
  const cs = sanitizeSpecs(specs);
  return JSON.stringify(cs.error ? [] : cs.value);
}
function specsFromJson(text) {
  const cs = sanitizeSpecs(text);
  return cs.error ? [] : cs.value;
}

module.exports = {
  LINE_KINDS,
  LINE_KIND_DEFAULT,
  SPEC_PRESETS,
  MAX_COEF,
  MAX_SPECS,
  findPreset,
  kindOf,
  coefOf,
  isIdentityCoef,
  unitCoef,
  deriveSpec,
  sanitizeCoef,
  sanitizeSpecs,
  specsToJson,
  specsFromJson,
};
