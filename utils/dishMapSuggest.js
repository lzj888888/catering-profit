// utils/dishMapSuggest.js —— 菜名映射「建议卡」纯函数（R260 · 规范 v1.9 §0 D29/D32）
//
// 🔴🔴 本文件只做**建议**，输出的是"给用户预选哪一项"，**绝不落库、绝不自动提交**。
//   落库键始终是**原始 dish_key**（读侧 `mapIndex` 按原样查 —— R255 铁律）。
//   一旦让归一化结果写进 `external_ref_id`，就会出现「★发鱿鱼」被落成「发鱿鱼」
//   ⇒ 读侧永远查不到 ⇒ **挂了等于没挂**（静默失效，比报错更坏）。
//
// 为什么需要建议：外卖 SKU 真表 51 个商品名、堂食菜品表 270 行，逐行人工选卡太慢；
//   而平台侧名字带装饰（`★发鱿鱼`、`【耙牛筋】六荤六素单人餐+米饭`），与成本卡名并不同名。
//
// 匹配次序（保守优先，宁可给不出建议也不给错建议）：
//   ① 原名 trim 后**完全相等**（最可靠）
//   ② 归一后完全相等
//   ③ 归一后**双向包含**（取**最长的**那张卡 —— 卡名越长越具体，避免"牛肉"吃掉"耙牛肉"）
//   ④ 都不中 ⇒ -1（**不给建议**，用户自己选）
//
// 🔴 安全闸：**口味询问 / 备注类 SKU 一律不建议**（`?`/`？`/`吗`/`不要`）。
//   实测依据：外卖真表里存在 `来点辣椒?吗` 这类**口味询问 SKU**（`review/evidence/r232_formc_sample`），
//   它不对应任何菜品，若被"猜"中一张卡 ⇒ 用户会照单全收 ⇒ **把误判写进库**。
//
// ⚠️ 分块上限：单批上限的**硬约束在云端**（`cloudfunctions/saveDishMapping/service.js::MAX_BATCH`，
//   由"云端 timeout 默认 3s 且只能控制台改"决定）。前端这份是**UI 侧分块粒度**，
//   由 `tools/check_dish_mapping_write.js` D-② 断言 `BATCH_CHUNK <= MAX_BATCH` 钉住两者关系 ——
//   不能真单源（云函数不能 require 小程序侧 utils/，而页面侧 require 云函数目录会破坏小程序打包）。
const BATCH_CHUNK = 20;

// 归一：仅用于**建议**，绝不用于落库键。
//   去掉装饰符号与括号内容 —— 平台侧习惯给商品名套 `★`/`【】`/`（）`。
function normForSuggest(name) {
  let s = String(name == null ? '' : name);
  s = s.replace(/[\uFF08(][^\uFF09)]*[\uFF09)]/g, '');   // （…）与 (…)
  s = s.replace(/[\u3010][^\u3011]*[\u3011]/g, '');       // 【…】
  s = s.replace(/[\u300A\u300B[\]]/g, '');                // 《》与方括号
  s = s.replace(/[\u2605\u2606*※\u00B7\u2022\u2014_\/|+\-\s]/g, ''); // 装饰符与空白
  return s.trim();
}

// 口味询问 / 备注类：不建议（见头注"安全闸"）
function looksLikeQuestion(name) {
  const s = String(name == null ? '' : name);
  return /[?\uFF1F]/.test(s) || /不要|少放|多加/.test(s);
}

/**
 * 为一菜品名挑一张建议成本卡。
 * @param {string} dishName 平台侧原始菜名（**原样**，由调用方保证不预先归一）
 * @param {string[]} cardNames 成本卡名数组（与页面 cardCodes 同序）
 * @returns {{index:number, how:'exact'|'norm'|'contains'|'question'|'none'}}
 */
function suggestCardIndex(dishName, cardNames) {
  const list = Array.isArray(cardNames) ? cardNames : [];
  const raw = String(dishName == null ? '' : dishName).trim();
  if (!raw || !list.length) return { index: -1, how: 'none' };
  if (looksLikeQuestion(raw)) return { index: -1, how: 'question' };

  // ① 原名完全相等
  for (let i = 0; i < list.length; i++) {
    if (String(list[i] == null ? '' : list[i]).trim() === raw) return { index: i, how: 'exact' };
  }

  const nRaw = normForSuggest(raw);
  if (!nRaw) return { index: -1, how: 'none' };

  // ② 归一后完全相等
  const norms = list.map((n) => normForSuggest(n));
  for (let i = 0; i < norms.length; i++) {
    if (norms[i] && norms[i] === nRaw) return { index: i, how: 'norm' };
  }

  // ③ 双向包含：取**最长**的卡名（越具体越优先）
  let best = -1;
  for (let i = 0; i < norms.length; i++) {
    const c = norms[i];
    if (!c) continue;
    if (nRaw.indexOf(c) < 0 && c.indexOf(nRaw) < 0) continue;
    if (best < 0 || c.length > norms[best].length) best = i;
  }
  if (best >= 0) return { index: best, how: 'contains' };
  return { index: -1, how: 'none' };
}

module.exports = { suggestCardIndex, normForSuggest, looksLikeQuestion, BATCH_CHUNK };
