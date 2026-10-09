// cloudfunctions/saveAsset/service.js —— 归档锁的选择（纯函数层 · R256）
//
// 🔴 为什么要有这一层（缺口是注释自己点名的，不是推断）：
//   `index.js` 此前**只给「删除」加了归档锁**，编辑 / 新增摊销**没有**（见原 index.js:37 注释）。
//   后果不是文档瑕疵：摊销资产从 start_month 起**逐月**产生摊销 ⇒
//     ① 编辑（改金额 / 改起摊月 / 改月数）在语义上等于**改动它覆盖到的每一个月的账**；
//     ② 新增一笔 start_month 早于已归档月的摊销 ⇒ 在**已封账的月份里凭空产生**摊销。
//   两者都会让「已归档 = 只读」这条封账承诺失效 ⇒ M1 利润可被事后改动（数据可信度红线）。
//
// 🔴 语义（为什么是「区间」而不是「起摊月那一个点」）：
//   归档**不强制按时间顺序**（可以先归档 10 月、再回头归档 9 月）⇒ 只看 start_month 会漏掉
//   「start_month 未归档、但它后面某月已归档」这条例外路径 ⇒ 判据是「已归档月里存在 month >= start」。
//
// ⚠️ 编辑路径为什么取 **min(旧起摊月, 新起摊月)**：
//   改起摊月**向前** ⇒ 影响 [新start, ∞)；改**向后** ⇒ 旧区间 [旧start, ∞) 里的账已经被算过。
//   两侧并集 = [min(旧, 新), ∞) ⇒ 只取新值会漏掉「把 3 月起摊改成 8 月，而 5 月已归档」这条路径。

const LUMP = 'lump';

function isLump(mode) {
  return mode === LUMP;
}

function normMonth(m) {
  if (m === null || m === undefined) return '';
  return String(m).trim();
}

/**
 * 决定本次写库前要上哪些归档锁。
 * @param {string|null} existMode  既有资产的 mode（新增 ⇒ null/undefined）
 * @param {string|null} existStart 既有资产的 start_month（新增 ⇒ null/undefined）
 * @param {string} nextMode        本次提交的 mode（删除路径不调用本函数）
 * @param {string} nextStart       本次提交的 start_month
 * @returns {{lumpMonths: string[], amortStart: string}}
 *   lumpMonths —— 需要「单月锁」的月份（lump 语义：只影响挂着的那一个月）
 *   amortStart —— 需要「区间锁」的起点（YYYY-MM；空串 = 不需要区间锁）
 */
function decideArchiveLock(existMode, existStart, nextMode, nextStart) {
  const lumpMonths = [];
  const pushLump = (m) => {
    const x = normMonth(m);
    if (x && lumpMonths.indexOf(x) < 0) lumpMonths.push(x);
  };
  if (isLump(existMode)) pushLump(existStart);
  if (isLump(nextMode)) pushLump(nextStart);

  const cands = [];
  const pushAmort = (mode, start) => {
    const s = normMonth(start);
    if (s && !isLump(mode)) cands.push(s);
  };
  pushAmort(existMode, existStart);
  pushAmort(nextMode, nextStart);

  // YYYY-MM 字典序 ≡ 时间序 ⇒ 排序取首即最早的起摊月
  const amortStart = cands.length ? cands.slice().sort()[0] : '';
  return { lumpMonths, amortStart };
}

module.exports = { decideArchiveLock, isLump, normMonth, LUMP };
