/**
 * R574-B · 粒度错配实证：堂食「区间汇总」落库成「单日」，与外卖逐日混合后失真多少
 *
 * 用真样例 + 真实生产解析器（`cloudfunctions/importSalesBill/service.js`）跑，不重写任何算法。
 * 只回答两个数：① 这张堂食表真实覆盖几天 ② 落库后下游会算成几天、差几倍。
 */
const Module = require('module');
const orig = Module._load;
Module._load = function (req) {
  if (req === 'xlsx') return { read: () => { throw new Error('stub'); }, utils: {} };
  return orig.apply(this, arguments);
};

const fs = require('fs');
const path = require('path');
const S = require(path.resolve(__dirname, '../../../cloudfunctions/importSalesBill/service.js'));
const MATRIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'matrix.json'), 'utf8'));

function intervalOf(sheetRows) {
  // 从 R2 参数自述串里抽「营业日期：【YYYY/MM/DD 至 YYYY/MM/DD】」
  const r2 = ((sheetRows || [])[1] || []).map((x) => (x == null ? '' : String(x))).join('');
  const m = r2.match(/营业日期：【\s*([^至]+?)\s*至\s*([^】]+?)\s*】/);
  if (!m) return null;
  const norm = (s) => {
    const d = String(s).trim().match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/);
    if (!d) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return d[1] + '-' + pad(d[2]) + '-' + pad(d[3]);
  };
  return { from: norm(m[1]), to: norm(m[2]), raw: m[0] };
}

function dayDiff(a, b) {
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return null;
  return Math.round((db - da) / 86400000) + 1; // 含首尾
}

console.log('='.repeat(74));
console.log('R574-B · 粒度错配实证（堂食区间汇总 vs 外卖逐日）');
console.log('='.repeat(74));

// ---------- 堂食 ----------
const tang = MATRIX['形态A候选'];
const shT = tang.sheets['菜品销售统计'];
const parsedA = S.parseDishSales(shT.rows, {});
const iv = intervalOf(shT.rows);
const daysReal = iv ? dayDiff(iv.from, iv.to) : null;

console.log('\n【堂食 · 形态A】《%s》', path.basename(tang.path));
console.log('   表头参数行原文片段：营业日期：【%s 至 %s】', iv ? iv.from : '?', iv ? iv.to : '?');
console.log('   真实覆盖天数          = %s 天', daysReal);
console.log('   extractBizDate 产出   = %s', parsedA.bizDate || '(空)');
console.log('   ↓ 落库后 external_ref_id 形态：');
console.log('     %s', 'DISH:pos:' + parsedA.bizDate + ':' + (parsedA.rows[0] || {}).dishKey);
console.log('   行数 = %d  Σ销量 = %s  Σ收入(分) = %s', parsedA.rows.length, parsedA.totals.qty, parsedA.totals.amountFen);
console.log('   ⚠️ 下游 countDataDays 只会数到 **1 天**（全部行共用同一个 biz_date）');

// ---------- 外卖 ----------
const wm = MATRIX['形态C候选1'];
const parsedC = S.parseDishSalesC(wm.sheets['data'].rows, {});
const datesC = unique((parsedC.rows || []).map((r) => r.bizDate).filter(Boolean));
console.log('\n【外卖 · 形态C】《%s》', path.basename(wm.path));
console.log('   逐行 biz_date 去重      = %s 天  %s', datesC.length, datesC.slice(0, 8).join(','));
console.log('   行数 = %d  Σ销量 = %s  Σ金额(分) = %s', parsedC.rows.length, parsedC.totals.qty, parsedC.totals.amountFen);

// ---------- 混合后失真 ----------
console.log('\n' + '='.repeat(74));
console.log('混合后果（同一家店同时导入以上两张表）');
console.log('='.repeat(74));
const allDates = unique([parsedA.bizDate].concat(datesC));
console.log('   真实数据天数          = %s 天（堂食 %s 天 ∪ 外卖 %s 天，同区间重叠）', Math.max(daysReal || 0, datesC.length), daysReal, datesC.length);
console.log('   下游 countDataDays    = %s 天（堂食被压成 1 天）', allDates.length);
if (daysReal) {
  console.log('   天数失真              = 少记 %s 天 ⇒ 任何「日均」口径虚高 %s 倍', daysReal - 1, (daysReal).toFixed(0));
  console.log('   例：堂食这份收入 %s 元被全部记在 %s 这一天',
    (parsedA.totals.amountFen / 100).toFixed(2), parsedA.bizDate);
  console.log('   ⇒ 该日「堂食收入」= 真实日均的 %s 倍', daysReal);
}
console.log('\n🔴 结论：external_sales_daily schema 只有单一 biz_date，无字段表达「区间/粒度」');
console.log('   ⇒ 区间汇总表与逐日表落进同一张表后**不可区分**，任何按日诊断（趋势/爆品/日均值）都会错。');
console.log('   ⇒ 这就是「接口要先做好」的位置：契约层必须先能表达 granularity，再谈上层诊断功能。');

function unique(a) { const s = new Set(a); return Array.from(s).sort(); }
