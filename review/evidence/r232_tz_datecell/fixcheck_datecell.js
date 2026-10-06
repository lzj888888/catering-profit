const p = (n) => String(n).padStart(2, '0');

// ---- 现状实现（SheetJS basedate 用本地时区构造 ⇒ 历史时区偏移污染）----
const badBasedate = new Date(1899, 11, 30, 0, 0, 0);          // 本地 ⇒ 1899 年是 LMT(+0805)
function fmtNow(cellMS) {
  const d = new Date(); d.setTime(cellMS);
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

// ---- 修后实现：UTC 基准 + 序列号四舍五入 ----
const UTC_BASE = Date.UTC(1899, 11, 30);
function fmtFixed(dateObj) {
  const serial = Math.round((dateObj.getTime() - UTC_BASE) / 86400000);
  const d = new Date(UTC_BASE + serial * 86400000);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;
}

const cases = [[46278,'2026-09-13'], [46272,'2026-09-07'], [46296,'2026-10-01'], [46250,'2026-08-16']];
console.log('serial | 期望        | 现状(本地)   | 修后(UTC+round)');
let okNow=0, okFix=0;
for (const [s, want] of cases) {
  const d = new Date(); d.setTime(s * 86400000 + badBasedate.getTime());  // SheetJS 实际给出的 Date
  const now = fmtNow(d.getTime());
  const fix = fmtFixed(d);
  if (now===want) okNow++;
  if (fix===want) okFix++;
  console.log(`${s} | ${want} | ${now} ${now===want?'✅':'❌'}   | ${fix} ${fix===want?'✅':'❌'}`);
}
console.log();
console.log(`现状正确 ${okNow}/4     修后正确 ${okFix}/4`);
