// 老板自制《营收日报表》解析器（纯函数，零依赖）
//
// 为什么单独写一条：这张表不是平台导出，是老板按「日期 × 班次」手记的，
//   18 列、含文本型「挂账人/金额」，任何现有形态（A/B/C/D/S）都不认。
//
// 🔴 最重要的一件事：**「营业收入」这一列不是随便加的**，是从 24 个班次穷举 4096 种组合
//   反推出来的唯一解（见 review/NOTE_2026-11-07_营收日报表口径反推.md）：
//       营业收入 = 现金 + 充值 + 扫码 + 挂账还款
//   含义：收付实现制——充值（预存）就算收入；会员消费不算（充值时已算过，避免双计）；
//   新赊出去的挂账不算，收回旧账（挂账还款）算。
//
// 🔴 所以本解析器**不假设这个公式永远成立**：每次解析都拿公式去校验每一行，
//   有任何一差就报 `caliber.pass = false` 并列出差异行。
//   老板哪天改了记账方式，我们会**看见**，而不是默默把错数导进去。

'use strict';

// 表头签名（这四列同时出现 ⇒ 认定是营收日报表）
const SIG = ['日期', '班次', '现金'];

// 列名 → 规范键
const COL_MAP = {
  日期: 'date', 班次: 'shift',
  现金: 'cash', 充值: 'recharge', 扫码: 'scan',
  美团团购: 'grouponMeituan', 抖音团购: 'grouponDouyin',
  美团外卖: 'waimaiMeituan', 京东外卖: 'waimaiJd', 淘宝闪购: 'waimaiTaobao',
  茶楼: 'teahouse', 会员消费: 'memberConsume',
  '挂账人/金额': 'ledgerNew', '挂账还款人/金额': 'ledgerRepay',
  营业收入: 'revenueDeclared', 合计: 'totalDeclared',
};

// 营业收入的反推公式（现金+充值+扫码+挂账还款）
const REVENUE_FORMULA = ['cash', 'recharge', 'scan', 'ledgerRepay'];
const REVENUE_FORMULA_TEXT = '现金 + 充值 + 扫码 + 挂账还款';

// 渠道列（供 M3 渠道对比直接用）
const CHANNEL_KEYS = ['grouponMeituan', 'grouponDouyin', 'waimaiMeituan', 'waimaiJd', 'waimaiTaobao'];

// 🔴 必须兼容字符串：`bufferToMatrix` 的 `fmtCell` 把所有单元格统一转成字符串
//   （`String(cell).trim()`），所以这里拿到的 "121" 不是 121。只认 typeof number 会全变 0。
const num = (v) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return 0;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '') return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
};
// 🔴 十进制安全形态（与 cloudfunctions/common/money.js 的 yuanToFen 同款）：
//   直接 Math.round(x * 100) 会被金额精度守卫判「不安全」—— 如 1.005*100 = 100.49999…，
//   先 toFixed(10) 消掉二进制浮点尾巴再取整。实测 20 万点零漂移。
const fen = (yuan) => Math.round(Number((yuan * 100).toFixed(10)));
// 元 → 保留 2 位小数（统一入口：原本四处各写一遍，既重复、又因 `a[b] * 100` 落不进
// 守卫的三形态桶而漏登记；抽成单源后只剩两处，均在规范包裹内）。
const round2 = (v) => Math.round(Number((v * 100).toFixed(10))) / 100;

// 「岳60」→ 60；「岳60/李30」→ 90；空 → 0
// 🔴 只取数字，不猜人名；多段用 / 分隔时求和。
function parseLedgerText(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const ds = String(v).match(/\d+(?:\.\d+)?/g);
  if (!ds) return 0;
  let s = 0;
  for (const d of ds) s += parseFloat(d);
  return round2(s);
}

// 「2026.9.1」/「2026-09-01」/「2026/9/1」→ 「2026-09-01」
function normDate(v) {
  if (v === null || v === undefined || v === '') return '';
  const m = String(v).trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (!m) return String(v).trim();
  const p = (n) => String(n).padStart(2, '0');
  return m[1] + '-' + p(m[2]) + '-' + p(m[3]);
}

/**
 * 表型识别：第 0~3 行内找到同时含「日期」「班次」「现金」的表头行即认定。
 * @returns {{hit:boolean, headerRow:number, cols:object}}
 */
function detectRevenueDaily(rows) {
  const list = rows || [];
  const limit = Math.min(list.length, 4);
  for (let i = 0; i < limit; i++) {
    const hdr = (list[i] || []).map((x) => (x == null ? '' : String(x).trim()));
    if (SIG.every((c) => hdr.indexOf(c) >= 0)) {
      const cols = {};
      for (let j = 0; j < hdr.length; j++) {
        const k = COL_MAP[hdr[j]];
        if (k && cols[k] === undefined) cols[k] = j;
      }
      return { hit: true, headerRow: i, cols };
    }
  }
  return { hit: false, headerRow: -1, cols: {} };
}

/**
 * 解析营收日报表。
 * @param {Array<Array>} rows bufferToMatrix 得到的二维行
 * @returns 结构化结果（金额同时给元与分；分供入库）
 */
function parseRevenueDaily(rows) {
  const det = detectRevenueDaily(rows);
  if (!det.hit) {
    return { ok: false, shape: 'revenue_daily', reason: 'not_revenue_daily' };
  }
  const { headerRow, cols } = det;
  const get = (r, k) => (cols[k] === undefined ? null : (r[cols[k]] === undefined ? null : r[cols[k]]));

  const shifts = [];
  let curDate = '';
  const mismatches = [];
  const unparsedLedger = [];
  const summaryOnlyRows = [];   // 业务列全空、只填了营收/合计的行（老板的填法，非错误）

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const rawDate = get(r, 'date');
    if (rawDate !== null && String(rawDate).trim() !== '') curDate = normDate(rawDate);
    const shift = get(r, 'shift') === null ? '' : String(get(r, 'shift') || '').trim();

    // 数值列
    const rec = { date: curDate, shift, rowIndex: i };
    let anyBiz = false;      // 🔴 只数业务列，不含「营业收入 / 合计」
    for (const k of Object.keys(COL_MAP)) {
      const key = COL_MAP[k];
      if (key === 'date' || key === 'shift') continue;
      if (key === 'ledgerNew' || key === 'ledgerRepay') {
        const raw = get(r, key);
        const v = parseLedgerText(raw);
        rec[key] = v;
        if (raw !== null && raw !== '' && typeof raw !== 'number' && v === 0) {
          unparsedLedger.push({ date: curDate, shift, raw: String(raw) });
        }
        if (v) anyBiz = true;
      } else {
        const v = num(get(r, key));
        rec[key] = v;
        // revenueDeclared / totalDeclared 是**派生列**（末尾另算），不算「这一班有业务」
        if (v && key !== 'revenueDeclared' && key !== 'totalDeclared') anyBiz = true;
      }
    }
    // 🔴 业务列全空 ⇒ 这不是一个真实班次。老板有时只把「当天合计」填在早班行
    //   （实测 9.7 / 9.10 早班：业务列全空、营业收入 "0"、合计 3628.9 / 4297）。
    //   若当成 0 元班次，会凭空多出两个 0 行、把「平均每班营收」拉低。
    //   记进 summaryOnlyRows 作为信息保留（不是错误，是老板的填法）。
    if (!anyBiz) {
      if (num(rec.revenueDeclared) !== 0 || num(rec.totalDeclared) !== 0) {
        summaryOnlyRows.push({
          date: curDate, shift, rowIndex: i,
          revenueDeclared: num(rec.revenueDeclared), totalDeclared: num(rec.totalDeclared),
        });
      }
      continue;
    }

    // 🔴 口径自检：每一行都验，不只看合计
    const computed = REVENUE_FORMULA.reduce((s, k) => s + num(rec[k]), 0);
    const declared = num(rec.revenueDeclared);
    rec.revenueComputed = round2(computed);
    if (Math.abs(rec.revenueComputed - declared) > 0.005) {
      mismatches.push({
        date: rec.date, shift: rec.shift,
        declared, computed: rec.revenueComputed,
        diff: round2(declared - rec.revenueComputed),
      });
    }
    shifts.push(rec);
  }

  // 汇总
  const SUM_KEYS = ['cash', 'recharge', 'scan', 'grouponMeituan', 'grouponDouyin',
    'waimaiMeituan', 'waimaiJd', 'waimaiTaobao', 'teahouse', 'memberConsume',
    'ledgerNew', 'ledgerRepay', 'revenueDeclared', 'revenueComputed'];
  const totalsYuan = {};
  for (const k of SUM_KEYS) totalsYuan[k] = 0;
  for (const s of shifts) for (const k of SUM_KEYS) totalsYuan[k] += num(s[k]);
  for (const k of SUM_KEYS) totalsYuan[k] = round2(totalsYuan[k]);

  const totalsFen = {};
  for (const k of SUM_KEYS) totalsFen[k] = fen(totalsYuan[k]);

  // 渠道合计（M3 用）
  const channelYuan = {};
  for (const k of CHANNEL_KEYS) channelYuan[k] = totalsYuan[k];

  // 按日聚合（合计 = 当天各班的营业收入之和）
  const byDate = {};
  for (const s of shifts) {
    if (!byDate[s.date]) byDate[s.date] = { date: s.date, shifts: [], revenueYuan: 0, revenueComputedYuan: 0 };
    byDate[s.date].shifts.push(s);
    byDate[s.date].revenueYuan = round2(byDate[s.date].revenueYuan + num(s.revenueDeclared));
    byDate[s.date].revenueComputedYuan = round2(byDate[s.date].revenueComputedYuan + num(s.revenueComputed));
  }
  const days = Object.keys(byDate).sort().map((d) => byDate[d]);

  return {
    ok: true,
    shape: 'revenue_daily',
    headerRow,
    cols,
    shifts,
    days,
    totalsYuan,
    totalsFen,
    channelYuan,
    caliber: {
      formula: REVENUE_FORMULA_TEXT,
      keys: REVENUE_FORMULA,
      pass: mismatches.length === 0,
      checkedShifts: shifts.length,
      mismatches,
    },
    unclassified: {
      // 茶楼固定 70/次，未进营业收入；含义未知，不猜
      teahouseYuan: totalsYuan.teahouse,
      note: '茶楼列未计入营业收入，含义未知（固定 70/次），按未归类项单独保留',
    },
    unparsedLedger,
    summaryOnlyRows,
    // 供上层判断「这份表是否可用」：没有一行业务数据就别导
    isEmpty: shifts.length === 0,
  };
}

module.exports = {
  SIG, COL_MAP, REVENUE_FORMULA, REVENUE_FORMULA_TEXT, CHANNEL_KEYS,
  detectRevenueDaily, parseRevenueDaily, parseLedgerText, normDate,
};
