// utils/marginBand.js —— M3 毛利率「色阶 / 区间」阈值**唯一单源**（R298Y）
//
// 📐 规范依据：`specs/dev-specs/core/开发规范v1.0_ModuleM3_菜品成本卡.md` §M3.8
//   「毛利率（挂牌价），用颜色标识：≥60% 绿色 / 40%~60% 黄色 / <40% 红色 / 未定价 灰色」
//   同节还写：「色阶阈值建议也从**同一配置源**读取，保持全局一致。」
//
// 🔴 为什么必须单源（本轮修的真缺陷）：
//   改前同一个口径被抄了三份、且三份不一致 ——
//     · `pages/card/index.js` 筛选用 30（「中」= 30%~60%）
//     · `pages/card/index.wxml` 色带用 40（≥40 才黄）
//     · `miniprogram/i18n/terms.js` 文案写 30（「中（30%~60%）」）
//   ⇒ 一张毛利率 35% 的卡：色带判**红**（<40），筛选却把它归**中**（≥30）—— **用户可见的自相矛盾**。
//   同族病第 3 型：判据只守「形态/子集」，不守「行为/全集」。
//
// 🔴 为什么不放进 `miniprogram/i18n/terms.js`（本可"就近"）：
//   `terms.js` 有**双副本**（`miniprogram/i18n/terms.js` ≡ `specs/dev-specs/i18n/terms.js`，K11 守逐字节一致），
//   而两份副本目录深度不同（`../../` vs `../../../`）⇒ **无法 require 同一个相对路径**，
//   加了 require 双副本立刻不一致 ⇒ K11 转红。故数值单源只能落在**非副本**的本模块。
//
// 🤖 守卫：`tools/check_m3_margin_bands.js`（① 行为判据 ② 全仓无游离字面量 ③ 术语键不回流 ④ 扫描面下界）
//
// ⚠️ 改名/改值须知：阈值只在本文件出现一次；页面与 wxml **一律引用本模块**，不得再内联写 60/40。

// —— 阈值（改这里 = 全局改，含色带、筛选、下拉文案）——
const HIGH = 60;   // ≥60% ⇒ 高
const MID = 40;    // ≥40% 且 <60% ⇒ 中；<40% ⇒ 低

// 档位键（与页面 MARGIN_OPTIONS 的 value、色带、筛选用同一套字面量）
const KEYS = { high: 'high', mid: 'mid', low: 'low', none: 'none', all: 'all' };

// 色带（wxml 内联色的**唯一来源**；值取自改前 index.wxml 既有配色，不改视觉）
const COLOR = { high: '#22a06b', mid: '#b45309', low: '#e74c3c', none: '#999' };

// 下拉筛选文案（由阈值**拼出**，与数值天然同源；改阈值文案自动跟）
const LABEL = {
  all: '全部',
  high: '高（≥' + HIGH + '%）',
  mid: '中（' + MID + '%~' + HIGH + '%）',
  low: '低（<' + MID + '%）',
};

// 毛利率 → 档位键。未定价（null/undefined/非有限数）⇒ 'none'（灰）
function bandOf(margin) {
  if (margin === null || margin === undefined || margin === '') return KEYS.none;
  const m = Number(margin);
  if (!Number.isFinite(m)) return KEYS.none;
  if (m >= HIGH) return KEYS.high;
  if (m >= MID) return KEYS.mid;
  return KEYS.low;
}

// 毛利率 → 色值（未定价 ⇒ 灰）
function colorOf(margin) { return COLOR[bandOf(margin)]; }

// 筛选命中判定：key='all'/空 ⇒ 恒真；未定价 ⇒ 三档**永不命中**（与改前 `c.margin !== null` 语义一致）
function matchBand(key, margin) {
  if (!key || key === KEYS.all) return true;
  const b = bandOf(margin);
  if (b === KEYS.none) return false;
  return b === key;
}

module.exports = { HIGH, MID, KEYS, COLOR, LABEL, bandOf, colorOf, matchBand };
