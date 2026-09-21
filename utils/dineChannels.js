// utils/dineChannels.js —— 堂食渠道行「唯一装配口」
//
// 🔴 为什么要有这个文件（2026-09-21 李老师反馈「分渠道录入下挂账/团购等字段不见了」）：
//    改版前，渠道行是「后端存过什么就渲染什么」—— 用户没填过的预设渠道（挂账、团购、POS…）
//    压根不出现，于是「分项渠道录入」看着像缺字段。每条产出渠道行的路径各自拼一遍，
//    就是典型的「改一处、漏三处」。
//
// 🔒 单一数据源契约：
//    ① 渠道清单**只**来自 `miniprogram/i18n/terms.js` → `ledger.income[dine_in].items`；
//       本文件不写死任何渠道名，页面/云函数也不许写死（由 selftest G10h 守）。
//    ② 所有产出堂食行的路径（读后端 / 加行 / 删行 / 切模式 / 初始化）**必须**经本函数，
//       由 `decorateDineRows()` 统一转调（G10g 守），不允许任何地方自己 map/拼装。
//    ③ 幂等：normalize(normalize(x)) === normalize(x)（G10f 守），可重复调用不会越补越多。
//
// 语义（三条，缺一不可）：
//    · 预设渠道**全集常在**：清单里有的渠道一定出现（没填就是空行），顺序按 terms；
//    · 用户自定义渠道**保留在末尾**（「+ 添加渠道」加的），名称可编辑、可删除；
//    · 金额按渠道名**回填**，不按数组下标 —— 后端只回传部分行时也不会错位。
//
// ⚠️ empty 行取舍：预设已铺全集，无需空行占位 ⇒ 无名无额的行丢弃；
//    但「刚点添加、还没填」的空行必须留着（否则点了没反应）⇒ 用 custom:true 标记放行。

function normalizeDineRows(rows, items, notes) {
  const presets = Array.isArray(items) ? items : [];
  const notesMap = notes || {};
  const src = Array.isArray(rows) ? rows : [];

  // 金额按名回填（不按下标）：后端只回传部分渠道时也不会张冠李戴
  const amountOf = (name) => {
    for (let i = 0; i < src.length; i++) {
      const r = src[i];
      if (r && (r.subItem || '') === name) return r.amountYuan || '';
    }
    return '';
  };

  const out = presets.map((name) => ({
    subItem: name,
    amountYuan: amountOf(name),
    fixed: true,            // 预设渠道：名称不可编辑、不可删除（清单是单一数据源，删了下次还会回来）
    custom: false,
    note: notesMap[name] || '',
  }));

  // 自定义行：不在预设清单里的，原样保留在末尾（含「刚添加的空行」）
  for (let i = 0; i < src.length; i++) {
    const r = src[i];
    if (!r) continue;
    const n = r.subItem || '';
    const a = r.amountYuan || '';
    if (presets.indexOf(n) >= 0) continue;      // 预设已铺，去重
    if (!n && !a && !r.custom) continue;        // 无名无额且非新增行 → 丢弃（空行不占位）
    out.push({
      subItem: n,
      amountYuan: a,
      fixed: false,
      custom: true,
      note: notesMap[n] || '',
    });
  }
  return out;
}

module.exports = { normalizeDineRows };
