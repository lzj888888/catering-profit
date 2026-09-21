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
// 语义（四条，缺一不可）：
//    · 预设渠道**全集常在**：清单里有的渠道一定出现（没填就是空行），顺序按 terms；
//    · **别名归并**（2026-09-21 新增）：`ledger.channelAliases` 里的口语叫法（如「现金」「美团」）
//      并入对应的正式渠道 ⇒ 不再另立一行看着跟上面的渠道重复（G11a/G11b 守）；
//    · 用户自定义渠道**保留在末尾**（「+ 添加渠道」加的），名称可编辑、可删除；
//    · 金额按渠道名**回填**，不按数组下标 —— 后端只回传部分行时也不会错位。
//
// ⚠️ empty 行取舍：预设已铺全集，无需空行占位 ⇒ 无名无额的行丢弃；
//    但「刚点添加、还没填」的空行必须留着（否则点了没反应）⇒ 用 custom:true 标记放行。
//
// ⚠️ 别名归并是**加法**：同一正式渠道上既有正式名的行、又有别名行时，金额相加（一分不丢）。
//    归并只发生在渲染层（本函数），保存时按正式渠道名写回 ⇒ 后端数据被自然收敛（自愈）。

function normalizeDineRows(rows, items, notes, aliases) {
  const presets = Array.isArray(items) ? items : [];
  const notesMap = notes || {};
  const aliasMap = aliases || {};
  const src = Array.isArray(rows) ? rows : [];

  // 渠道名 → 正式预设渠道（① 完全同名 ② 别名表命中；其余返回 ''）
  const presetOf = (name) => {
    const n = (name || '').trim();
    if (!n) return '';
    if (presets.indexOf(n) >= 0) return n;
    const t = aliasMap[n];
    return (t && presets.indexOf(t) >= 0) ? t : '';
  };

  // 金额按「正式渠道」累计：正式名行 + 别名行 相加（别名归并后不再各自占一行）
  // ⚠️ 只有**真的归并了（≥2 条来源）**才重新格式化成两位小数；单来源一律原样透传 ——
  //    否则「用户填 2000 → 回显 2000.00」属于无谓的口径漂移（老守卫 G10b/G10e 就是靠这条守住的）。
  const acc = {};
  for (let i = 0; i < src.length; i++) {
    const r = src[i];
    if (!r) continue;
    const target = presetOf(r.subItem);
    if (!target) continue;
    const raw = r.amountYuan === undefined || r.amountYuan === null ? '' : String(r.amountYuan).trim();
    const a = raw === '' ? NaN : Number(raw);
    if (isNaN(a) || a === 0) continue;
    const cur = acc[target] || { n: 0, sum: 0, raw: '' };
    cur.n += 1;
    cur.sum += a;
    cur.raw = raw;
    acc[target] = cur;
  }
  const amountOf = (name) => {
    const c = acc[name];
    if (!c) return '';
    return c.n === 1 ? c.raw : (Math.round(c.sum * 100) / 100).toFixed(2);
  };

  const out = presets.map((name) => ({
    subItem: name,
    amountYuan: amountOf(name),
    fixed: true,            // 预设渠道：名称不可编辑、不可删除（清单是单一数据源，删了下次还会回来）
    custom: false,
    note: notesMap[name] || '',
  }));

  // 自定义行：既不是预设名、也没有别名指向的，原样保留在末尾（含「刚添加的空行」）
  for (let i = 0; i < src.length; i++) {
    const r = src[i];
    if (!r) continue;
    const n = (r.subItem || '').trim();
    const a = r.amountYuan || '';
    if (presetOf(n)) continue;                  // 预设 / 别名已并入，去重
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

// 非堂食大类（外卖 / 其他业务收入 / 费用四大类）的行标记：
// 名字来自预设清单的 → fixed:true（WXML 据此不给删除键：清单是单一数据源，删了装配时还会补回来）；
// 用户自己加的 → fixed:false（可改名、可删）。
// ⚠️ 判据只看名字是否在该类预设清单里，不看顺序 ⇒ 后端只回传部分行也不会错标。
function markFixedRows(rows, items) {
  const presets = Array.isArray(items) ? items : [];
  return (Array.isArray(rows) ? rows : []).map((r) => Object.assign({}, r, {
    fixed: !!r && !!r.subItem && presets.indexOf((r.subItem || '').trim()) >= 0,
  }));
}

module.exports = { normalizeDineRows, markFixedRows };
