// utils/entryCompletion.js —— 月度录入完成度（R578 / 队列 #101）
//
// 🔴 为什么是"算"而不是"埋点"（这决定了它合不合规）：
//   #101 原意是"首月录入完成率"这个北极星指标。最直觉的做法是加埋点上报，
//   但那等于**新增数据收集** —— 而隐私政策正是上线硬阻塞项（还有 1 处待填），
//   不能为了一个指标去动它。两司（豆包/DeepSeek）也一致建议：
//   **优先用已有业务数据聚合，不新增任何采集**。
//   ⇒ 本文件只读页面上**已经存在**的录入数据，不写库、不上报、不碰身份标识。
//
// 🔴 它解决的是什么问题（不是"度量"，是"让老板知道还差什么"）：
//   完成率低的根因不是老板懒，是他**不知道还差几项** —— 填了一屏以为完事了。
//   给一句"还差 2 组：人工、运营"，比后台统计一张报表更能直接提升完成率。
//   （全局度量的那一半需要管理端聚合，本轮不做，见 NOTE。）
//
// 🔴 R591（李老师「还是要把问题简单了」）：核心项 = **4 组 + 1 个字段**。
//   第 5 项是「原料用掉多少」（页面字段 directConsumeYuan），它**不在 terms 的 core 组里**，
//   因为它是页面级字段、不是分组。但它才是利润的大头 —— 漏了它，利润会虚高 30% 以上。
//   实证（R591 探针）：老板填满 4 组、原料留空 ⇒ done=true、提示消失、**不报错**，
//   而利润 = 营业额 − 房租 − 人工（完全没扣食材）。这是本仓最典型的「静默错账」。
//
// 口径：核心组 = 4 个（堂食 / 外卖 / 运营费用 / 人工费用）+ 1 项原料消耗。
//   来源是 `TERMS.ledger.income|expense` 里 `core: true` 的组（单源，不在这里另立清单）。
//   组内**至少一行金额 > 0** 即算该组已填。
//   ⚠️ 金额 0 不算填 —— 0 的语义是"这项确实没有"，但与"还没填"在数据上无法区分，
//      所以宁可不催（少催一次不会错，多催一次会让老板以为系统在瞎报）。

/** 核心组清单（与 terms 的 core:true 对齐；改名时由守卫转红） */
const CORE_CATEGORIES = ['dine_in', 'takeaway', 'operation', 'labor'];

/** 该组是否至少填了一行有金额的 */
function groupFilled(group) {
  if (!group) return false;
  const rows = group.rows || [];
  for (let i = 0; i < rows.length; i++) {
    const v = Number(rows[i] && rows[i].amountYuan);
    if (Number.isFinite(v) && v > 0) return true;
  }
  return false;
}

/** 原料消耗是否填了（>0 才算；0 的语义模糊，宁可不催 ---> 与组的判定同口径） */
function consumeFilled(yuan) {
  const v = Number(yuan);
  return Number.isFinite(v) && v > 0;
}

/**
 * 算完成度（纯函数 · 零 IO · 可复算）
 * @param {Array} incomeGroups  页面 data.incomeGroups
 * @param {Array} expenseGroups 页面 data.expenseGroups
 * @param {Object} [labelMap]   category → 中文名（调用方从 terms 传，**不许**在界面露英文 key）
 * @param {Object} [opts]       第 5 项（原料消耗）的上下文：
 *   · consumeMode: 'direct' | 'inventory' —— **库存核算开着时由系统倒轧，不要求手填**
 *   · directConsumeYuan: 页面 data.directConsumeYuan
 *   · consumeLabel: 中文名（从 terms 传）
 *   ⚠️ 不传 opts ⇒ **默认按 direct 纳入**（fail-closed）。宁可多提示一项，
 *      也不要因为漏传参数而少提示一项 —— 后者正是本轮要修的那个静默错账。
 * @returns {{filled:number, total:number, missing:Array<{category:string,label:string}>,
 *            done:boolean, missingText:string}}
 */
function completionOf(incomeGroups, expenseGroups, labelMap, opts) {
  const all = (incomeGroups || []).concat(expenseGroups || []);
  const byCat = {};
  for (let i = 0; i < all.length; i++) {
    const g = all[i];
    if (g && g.category) byCat[g.category] = g;
  }
  const o = opts || {};
  // 库存核算开着 ⇒ 消耗由「月初 + 采购 − 月末」倒轧得出，不让老板再手填一遍
  const needConsume = o.consumeMode !== 'inventory';
  const missing = [];
  let filled = 0;
  for (let i = 0; i < CORE_CATEGORIES.length; i++) {
    const c = CORE_CATEGORIES[i];
    const g = byCat[c];
    if (groupFilled(g)) {
      filled++;
    } else {
      // 🔴 兜底顺序：页面组的 label → 调用方给的 labelMap → **空串**
      //   绝不回落到 category（那是 dine_in / takeaway 这种英文 key，给老板看是事故）。
      const label = (g && g.label) || (labelMap && labelMap[c]) || '';
      missing.push({ category: c, label });
    }
  }
  // 第 5 项放最后：老板的填写顺序就是「收入 → 费用 → 原料用掉多少」
  if (needConsume) {
    if (consumeFilled(o.directConsumeYuan)) {
      filled++;
    } else {
      // 兜底用中文：这条只在「调用方漏传 consumeLabel」时出现，但**绝不能是空串**
      // —— 空串会让界面显示「还差 1 项没填：」（数字有、名单空），比不提示更让人困惑。
      // 正常路径由页面传 TERMS.ledger.entryConsumeLabel；守卫 B-② 盯页面必须传。
      missing.push({ category: 'consume', label: o.consumeLabel || '原料消耗' });
    }
  }
  return {
    filled,
    total: CORE_CATEGORIES.length + (needConsume ? 1 : 0),
    missing,
    done: missing.length === 0,
    missingText: missing.map((x) => x.label).filter(Boolean).join('、'),
  };
}

module.exports = { CORE_CATEGORIES, groupFilled, consumeFilled, completionOf };
