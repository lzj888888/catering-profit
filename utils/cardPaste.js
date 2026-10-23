// utils/cardPaste.js —— 菜品卡「粘贴配料表 → 待确认行」纯函数（R443）
//
// 为什么单抽一层（与本仓既有定式同族：R150 specDerive / R151 units / round204 materialBatch）：
//   解析的**全部正确性**都在这里（分隔符、列序、单位池、名称匹配）；写进页面就只能靠真机点，
//   一次只能验一种粘贴形态。本模块无 wx 依赖，守卫直接 require 实跑判**行为**。
//
// 🔴 三条红线（都是"猜错比不猜更糟"）：
//   ① 名称对不上原料档案 ⇒ `no_match`，**绝不自动建原料**（自动建 = 往老板档案里塞垃圾，且成本全错）。
//   ② 单位不在 `utils/units.js` 的单位池 ⇒ `bad_unit`。**只认 g/kg 两个无歧义别名**：
//      `factorOf()` 对未知单位 fail-soft 返回 1（口径设计如此），若把 `kg` 原样喂进去
//      会当成 1 倍 ⇒ **1000 倍错账**，所以必须在这里改名而不是交给引擎。
//   ③ 数量非正数/读不成 ⇒ `bad_qty`。
//
// ⚠️ 唯一"默认值"：**没写单位 ⇒ 按克**（本仓基准单位恒为克，见 utils/units.js::BASE_UNIT）。
//   这是**定义**不是猜测，且预览行会把「克」显式写出来 ⇒ 老板看得见、能当场改。
//
// 返回：`{ rows, okCount }`
//   rows[i] = { raw, name, qtyText, unit, qtyBase, status, reason, material }
//   status ∈ 'ok' | 'no_match' | 'bad_unit' | 'bad_qty'
const units = require('./units.js');

function normName(s) {
  return String(s == null ? '' : s).replace(/[\s\u3000]/g, '').toLowerCase();
}

// 单位别名：**只有这两个**是无歧义定义（g=克、kg=千克）。其余一律交给单位池判定。
function normUnit(u) {
  const t = String(u == null ? '' : u).trim();
  if (!t) return units.BASE_UNIT;
  if (t === 'g' || t === 'G') return '克';
  if (/^kg$/i.test(t)) return '千克';
  return t;
}

// 一行 → 字段数组。分隔符优先级：Tab（Excel 复制）> 逗号 > 分号 > 两个以上空格 > 单空格速记。
//   ⚠️ 单空格**默认不拆**（原料名里本来就有空格，如「耙 牛肉」）；只有形如「名称 数字[单位]」时才拆。
function splitFields(line) {
  const s = String(line == null ? '' : line).trim();
  let parts = s.split(/\t+/);
  if (parts.length < 2) parts = s.split(/[,，;；]+/);
  if (parts.length < 2) parts = s.split(/\s{2,}/);
  if (parts.length >= 2) return parts;
  const mm = /^(.+?)\s+([0-9]+(?:\.[0-9]+)?)\s*([^\s0-9]*)$/.exec(s);
  if (mm) return [mm[1], mm[2], mm[3]];
  return [s];
}

/**
 * 解析粘贴文本 → 待确认行（**不做任何写入**，由页面逐行确认后导入）。
 * @param {string} text 多行文本（换行分隔；`#` 开头视作注释）
 * @param {Array<{id:string,name:string}>} materials 原料档案（只需要 id/name）
 * @returns {{rows: Array, okCount: number}}
 */
function parseCardPaste(text, materials) {
  const list = Array.isArray(materials) ? materials : [];
  const rows = [];
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  for (const rawLine of lines) {
    const raw = String(rawLine || '').trim();
    if (!raw || raw.charAt(0) === '#') continue;
    const f = splitFields(raw);
    const row = {
      raw: raw,
      name: String(f[0] == null ? '' : f[0]).trim(),
      qtyText: String(f[1] == null ? '' : f[1]).trim(),
      unit: normUnit(f[2]),
      qtyBase: 0,
      status: 'ok',
      reason: '',
      material: null,
    };
    if (!row.name) {
      row.status = 'bad_qty';
      row.reason = 'no_name';
      rows.push(row);
      continue;
    }
    // 「0.2kg」这种数量与单位**粘在同一个字段**里（Tab 两列 / 「名称 数量单位」速记）⇒ 拆开
    //   ⚠️ 只在第三列缺省时拆，且必须形如「数字+字母/汉字」，不拆「两斤」这类中文数量词（那是 bad_qty）
    if (!String(f[2] == null ? '' : f[2]).trim()) {
      const glued = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z一-龥]+)$/.exec(row.qtyText);
      if (glued) {
        row.qtyText = glued[1];
        row.unit = normUnit(glued[2]);
      }
    }
    const n = Number(row.qtyText);
    if (!row.qtyText || !isFinite(n) || n <= 0) {
      row.status = 'bad_qty';
      row.reason = 'qty';
    }
    // ⚠️ 只在「数量已合格」时再判单位：否则单位错会覆盖掉数量错，老板改完单位还以为好了
    if (row.status === 'ok' && (!units.QTY_UNITS || units.QTY_UNITS.indexOf(row.unit) < 0)) {
      row.status = 'bad_unit';
      row.reason = 'unit';
    }
    const key = normName(row.name);
    const hit = list.find((m) => normName(m && m.name) === key);
    if (hit) row.material = { id: hit.id, name: hit.name };
    if (row.status === 'ok' && !row.material) {
      row.status = 'no_match';
      row.reason = 'match';
    }
    if (row.status === 'ok') row.qtyBase = units.toBase(n, row.unit);
    rows.push(row);
  }
  const okCount = rows.filter((r) => r.status === 'ok').length;
  return { rows: rows, okCount: okCount };
}

module.exports = { parseCardPaste, splitFields, normName, normUnit };
