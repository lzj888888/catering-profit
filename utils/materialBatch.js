// utils/materialBatch.js —— 原料批量录入「粘贴 → 原料行」的**纯函数**层（round204）
//
// 为什么单独抽一层（而不写在页面里）：
//   ① 解析器是这次新能力的**全部正确性所在** —— 分隔符、表头、列序、缺列、非法单位、计数族换算
//      全在这里判对错；写进 `onLoad` 里就只能靠真机点（真机一次只能测一种粘贴形态）。
//   ② 本仓既有定式（R150 的 specDerive / R151 的 units / M3.17 的 takeawayDerive）：
//      计算逻辑下沉成**无 wx 依赖的纯函数**，守卫直接 `require` 实跑 ⇒ 判据是行为、不是 grep。
//
// ⚠️ 引擎红线：本文件**不算成本**。净料单位成本由云侧 `netUnitCostWan` 算，这里只负责把
//   「老板手抄的一行」整理成 `saveMaterial` 认得的入参（元→分、换算系数、出成率）。
// ⚠️ 单位口径一律取 `utils/units.js` 单源：本文件**不抄第二份**倍率表，也不自己造默认单位词
//   （默认采购单位由调用方从 `TERMS.card.matUnitDefault` 传入）。
// 🔴 与 edit.js 同一条纪律：计数族（个/只/条/瓶/包/份/箱/桶/件）**没有通用换算**，
//   `units.suggestConvert()` 对它们返回 null ⇒ 本文件**不许瞎猜**，直接判「需填换算系数」要求老板填。

const units = require('./units.js');

// 数字形态（允许负号与小数；不允许「12元」这种带单位的串 —— 那是另一回事，判错比猜对安全）
function isNumLike(s) {
  const v = String(s == null ? '' : s).trim();
  return /^-?\d+(\.\d+)?$/.test(v);
}

// 一行 → 列数组。分隔符优先级：**Tab（Excel 复制）> 逗号 > 分号 > 两个以上空格**。
//   ⚠️ 单空格**默认不拆**：原料名里本来就有空格（「耙 牛肉」）。只有当「首段之后的段全是数字」时
//      才按单空格拆 —— 那几乎只可能是手打的「炸鸡腿 18.5」这类速记。
function splitRow(line) {
  const s = String(line == null ? '' : line).replace(/\r/g, '');
  if (!s.trim()) return null;
  if (s.indexOf('\t') >= 0) return s.split('\t').map((x) => x.trim());
  if (/[,，]/.test(s)) return s.split(/[,，]/).map((x) => x.trim());
  if (/[;；]/.test(s)) return s.split(/[;；]/).map((x) => x.trim());
  const parts = s.trim().split(/\s+/);
  if (parts.length >= 2 && parts.slice(1).every(isNumLike)) return parts;
  const wide = s.trim().split(/\s{2,}/).map((x) => x.trim());
  return wide.length >= 2 ? wide : parts;
}

// 表头行识别：仅对**首行**判，且必须「名称类 + 价格类」同时在场。
//   （只认名称类会把「炸鸡腿 名称待定」误当表头 ⇒ 丢一条真数据，比不识别更坏）
const HEAD_NAME_RE = /名称|品名|原料名|材料名|原料|材料|商品/i;
const HEAD_PRICE_RE = /单价|价格|金额|进价|采购价|price/i;
function isHeaderRow(cells) {
  const joined = (cells || []).join(' ');
  return HEAD_NAME_RE.test(joined) && HEAD_PRICE_RE.test(joined);
}

// 列 → 字段。**两套列序**（都是老板真实会写出来的）：
//   ① 位置语义（Excel 标准 6 列）：名称 | 规格/品牌 | 采购单位 | 采购单价(元) | 换算系数 | 出成率(%)
//   ② 速记（2~3 列）：名称 | 采购单价(元) [| 采购单位]
//   判别：第 2 列是数字 **且**（总列数 ≤3 或 第 4 列为空）⇒ 走 ②。
//   否则一律走 ① —— 「箱装24」这种规格串不是数字，不会误判。
const FIELD = { NAME: 0, BRAND: 1, UNIT: 2, PRICE: 3, CONV: 4, YIELD: 5 };

function pickColumns(cells) {
  const c = (cells || []).map((x) => String(x == null ? '' : x).trim());
  const quick = c.length >= 2 && isNumLike(c[FIELD.BRAND]) && (c.length <= 3 || c[FIELD.PRICE] === '');
  if (quick) {
    return { name: c[0], brand_spec: '', purchase_unit: c[2] || '', priceYuan: c[1], convert: '', yieldRate: '' };
  }
  return {
    name: c[FIELD.NAME] || '',
    brand_spec: c[FIELD.BRAND] || '',
    purchase_unit: c[FIELD.UNIT] || '',
    priceYuan: c[FIELD.PRICE] || '',
    convert: c[FIELD.CONV] || '',
    yieldRate: c[FIELD.YIELD] || '',
  };
}

// 一行 → { ok, errors, row }。row 是**可直接喂 saveMaterial** 的入参形态（元→分在这一层做完）。
// ⚠️ 错误**不静默兜底**：缺啥报啥，让老板在预览页看见红字自己补 —— 与 edit.js「不许静默改掉老板敲的数」同律。
function buildRow(cells, defaultUnit) {
  const p = pickColumns(cells);
  const errors = [];
  const name = String(p.name || '').trim();
  if (!name) errors.push('缺名称');

  const rawUnit = String(p.purchase_unit || '').trim();
  let purchase_unit = rawUnit || String(defaultUnit || '');
  // 单位非法时**只报这一条**：再叠一条「换算系数必填」是噪音（根因是单位，不是系数）
  const unitInvalid = !!rawUnit && units.PURCHASE_UNITS.indexOf(rawUnit) < 0;
  if (unitInvalid) errors.push('单位不在可选池：' + rawUnit);

  let priceFen = 0;
  if (String(p.priceYuan || '').trim() !== '') {
    if (!isNumLike(p.priceYuan)) errors.push('单价不是数字：' + p.priceYuan);
    else priceFen = Math.round(Number(p.priceYuan) * 100);
  }

  let convert_factor = null;
  const rawConv = String(p.convert || '').trim();
  if (rawConv !== '') {
    if (!isNumLike(rawConv) || !(Number(rawConv) > 0)) errors.push('换算系数需为正数：' + rawConv);
    else convert_factor = Number(rawConv);
  } else {
    const sug = units.suggestConvert(purchase_unit);
    // 🔴 计数族（箱/桶/件…）没有通用换算 ⇒ 不许填建议值、更不许填 1 ⇒ 直接要求老板填
    if (sug == null && !unitInvalid) errors.push('换算系数必填（' + purchase_unit + ' 没有通用换算）');
    else convert_factor = sug;
  }

  let yield_rate = 100;
  const rawYield = String(p.yieldRate || '').trim();
  if (rawYield !== '') {
    if (!isNumLike(rawYield)) errors.push('出成率不是数字：' + rawYield);
    else {
      const y = Number(rawYield);
      if (!(y > 0 && y <= 100)) errors.push('出成率需在 0~100：' + rawYield);
      else yield_rate = y;
    }
  }

  const row = {
    name,
    brand_spec: String(p.brand_spec || ''),
    purchase_unit,
    purchase_price_fen: priceFen,
    convert_factor: convert_factor == null ? 0 : convert_factor,
    yield_rate,
    // 批量录入不碰虚拟原料 / 分类默认 other / 别名备注留空（与 edit.js 新增态一致）
    is_virtual: false,
    category: 'other',
    aliases: '[]',
    remark: '',
    std_key: '',
  };
  return { ok: errors.length === 0, errors, row };
}

// 入口：整段粘贴文本 → { rows, headerSkipped, blankLines }
//   rows: [{ index, ok, errors, row, cells }]（index 从 1 起，与界面行号一致）
function parsePaste(text, defaultUnit) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const rows = [];
  let headerSkipped = false;
  let blankLines = 0;
  let first = true;
  for (const line of lines) {
    const cells = splitRow(line);
    if (!cells) { blankLines += 1; continue; }
    if (first) {
      first = false;
      if (isHeaderRow(cells)) { headerSkipped = true; continue; }
    }
    const b = buildRow(cells, defaultUnit);
    rows.push({ index: rows.length + 1, ok: b.ok, errors: b.errors, row: b.row, cells });
  }
  return { rows, headerSkipped, blankLines };
}

module.exports = {
  parsePaste,
  splitRow,
  isHeaderRow,
  pickColumns,
  buildRow,
  isNumLike,
};
