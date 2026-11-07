// 老板自制《营收日报表》解析器（纯函数，零依赖）
//
// 为什么单独写一条：这张表不是平台导出，是老板按「日期 × 班次」手记的，
//   18 列、含文本型「挂账人/金额」，任何现有形态（A/B/C/D/S）都不认。
//
// 🔴🔴 两套口径，绝不能混（2026-11-07 李老师裁决）：
//
//   【A 现金流入】老板表里「营业收入」那一列 = 现金 + 充值 + 扫码 + 挂账还款
//     —— 是从 24 个班次穷举 4096 种组合反推出来的唯一解（NOTE_2026-11-07_营收日报表口径反推）。
//     **它的用途只有一个：对现金账。** 钱有没有进抽屉、有没有进银行，用它核。
//     李老师原话：「充值的不能算作营业收入……写的就是纯粹为了对现金账有可能」。
//
//   【B 经营营收】M1 权责发生制 = 现金 + 扫码 + 储值卡消费 + 挂账消费 + 团购核销 + 外卖
//     —— 按「消费发生」确认，不看钱什么时候到。**这才是营收**，M3/M1 对外一律用这套。
//     依据 M1 既有定义（terms.js `income` 类目）：堂食七项 = 现金/微信/支付宝/POS/
//       「储值卡消费」「个人单位挂账消费」「团购代金券核销」三项；外卖按平台总额法。
//     且 M1 早就写死了红线（terms.js `fastHint`）：「首页那个『营业收入』别直接抄 ——
//       它把没结账的、顾客充值的钱也算进去了」「顾客充值的钱不算收入，只有用余额买单才算」。
//
//   ⇒ 两套口径的四组互换（这是差额的全部来源，无第五项）：
//        老板多算：充值（预存）、挂账还款（收回旧账）
//        M1  多算：储值卡消费、挂账消费（新赊出）、团购核销、外卖
//
// 🔴 本解析器**不假设任何公式永远成立**：每行都验，一差就 `pass=false` 并列出差异行。
//   老板哪天改了记账方式，我们会**看见**，而不是默默把错数导进去。
//   ⚠️ 而 `revenueDeclared`（表里那列）**永远不是营收**，只作对账校验用；守卫 D 组钉死。

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

// 🔴 与 M1 收入类目的**显式映射**（不是注释、是数据）——
//   依据 `TERMS.ledger.income`（M1 记账页的权威类目表），守卫同源校验两边必须一一对上。
//   为什么必须显式写出来：老板这张表把「微信/支付宝/POS」压成了一列「扫码」，
//   把美团团购/抖音团购拆成两列 —— 映射关系一旦漂移，营收就会静默算错。
const M1_DINEIN_MAP = [
  { m1: '现金收款', keys: ['cash'] },
  // 老板表只有「扫码」一列 ⇒ M1 的微信/支付宝/POS 三项都落在它上面
  { m1: '微信扫码收款', keys: ['scan'] },
  { m1: '支付宝收款', keys: ['scan'] },
  { m1: '银行卡/POS刷卡', keys: ['scan'] },
  { m1: '储值卡消费', keys: ['memberConsume'] },
  { m1: '个人/单位挂账消费', keys: ['ledgerNew'] },
  { m1: '团购/代金券核销', keys: ['grouponMeituan', 'grouponDouyin'] },
];
const M1_TAKEAWAY_MAP = [
  { m1: '美团外卖', keys: ['waimaiMeituan'] },
  { m1: '淘宝闪购', keys: ['waimaiTaobao'] },
  { m1: '京东外卖', keys: ['waimaiJd'] },
];
// 🔴 显式缺口：M1 外卖类目还有第四项「其他外卖」，本表没有对应列。
//   不假装覆盖、也不猜它落在哪列 —— 记下来，让上层知道这块数据是缺的。
const M1_TAKEAWAY_MISSING = ['其他外卖'];
// 🔴 同理：M1「其他业务收入」类目只有「废品变卖 / 预制菜零售」两项，
//   本表的「茶楼」不在其中 ⇒ 不计入营收（见 M1_OTHER_PENDING_KEYS）。

// ===== A 现金流入公式（老板对现金账用；含充值，**不是营收**）=====
const REVENUE_FORMULA = ['cash', 'recharge', 'scan', 'ledgerRepay'];
const REVENUE_FORMULA_TEXT = '现金 + 充值 + 扫码 + 挂账还款';

// ===== B M1 权责制营收公式（**这才是营收**）=====
//   堂食：现金 + 扫码 + 储值卡消费 + 挂账消费 + 团购核销
//   外卖：三平台合计（总额法，佣金另记营销费用 —— 与 M1 `incomeScope.takeaway` 一致）
// 🔴 keys 从映射表**派生**（单源）：改映射就改了公式，不会出现「注释改了代码没改」。
const uniqByMap = (map) => {
  const out = [];
  for (const x of map) for (const k of x.keys) if (out.indexOf(k) < 0) out.push(k);
  return out;
};
const M1_DINEIN_KEYS = uniqByMap(M1_DINEIN_MAP);
const M1_TAKEAWAY_KEYS = uniqByMap(M1_TAKEAWAY_MAP);
// 其他业务收入：M1 有这一类目（废品变卖/预制菜零售），但本表的「茶楼」含义未确认
//   ⇒ **不计入营收**，单列 pendingOther，并在页面上问清楚。不猜。
const M1_OTHER_PENDING_KEYS = ['teahouse'];
const M1_DINEIN_TEXT = '现金 + 扫码 + 储值卡消费 + 挂账消费 + 团购核销';
const M1_TAKEAWAY_TEXT = '美团外卖 + 京东外卖 + 淘宝闪购';
const M1_REVENUE_TEXT = M1_DINEIN_TEXT + ' + ' + M1_TAKEAWAY_TEXT;

// 差额桥的两侧（用于向老板解释「为什么两个数不一样」，无第五项）
const BRIDGE_BOSS_OVER = [
  { key: 'recharge', label: '充值（预存，钱到了但还没消费）' },
  { key: 'ledgerRepay', label: '挂账还款（收回的是旧账，早就确认过收入）' },
];
const BRIDGE_M1_OVER = [
  { key: 'memberConsume', label: '储值卡消费（钱充值时收过了，消费才算收入）' },
  { key: 'ledgerNew', label: '挂账消费（吃了没付钱，但已经发生）' },
  { key: 'groupon', label: '团购核销（平台结算，不走收银台）' },
  { key: 'waimai', label: '外卖（平台结算，不走收银台）' },
];

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

    // 🔴 口径自检 A：每一行都验「现金流入 == 表里营业收入」，不只看合计
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

    // 🔴 口径 B：M1 权责制营收（每班次各算一份，供 M1 直接取用）
    rec.revenueM1Yuan = round2(
      M1_DINEIN_KEYS.reduce((s, k) => s + num(rec[k]), 0)
      + M1_TAKEAWAY_KEYS.reduce((s, k) => s + num(rec[k]), 0)
    );
    // 现金流入（老板口径）也逐班留一份，方便对账
    rec.cashInflowYuan = rec.revenueComputed;

    shifts.push(rec);
  }

  // 汇总
  const SUM_KEYS = ['cash', 'recharge', 'scan', 'grouponMeituan', 'grouponDouyin',
    'waimaiMeituan', 'waimaiJd', 'waimaiTaobao', 'teahouse', 'memberConsume',
    'ledgerNew', 'ledgerRepay', 'revenueDeclared', 'revenueComputed',
    'revenueM1Yuan', 'cashInflowYuan'];
  const totalsYuan = {};
  for (const k of SUM_KEYS) totalsYuan[k] = 0;
  for (const s of shifts) for (const k of SUM_KEYS) totalsYuan[k] += num(s[k]);
  for (const k of SUM_KEYS) totalsYuan[k] = round2(totalsYuan[k]);

  const totalsFen = {};
  for (const k of SUM_KEYS) totalsFen[k] = fen(totalsYuan[k]);

  // 渠道合计（M3 用）
  const channelYuan = {};
  for (const k of CHANNEL_KEYS) channelYuan[k] = totalsYuan[k];

  // ===== A 现金流入（老板口径，仅供对现金账）=====
  const cashInflowYuan = totalsYuan.cashInflowYuan;
  const cashInflow = {
    formula: REVENUE_FORMULA_TEXT,
    totalYuan: cashInflowYuan,
    totalFen: fen(cashInflowYuan),
    // 表里「营业收入」列：只用来对账，**不是营收**
    declaredYuan: totalsYuan.revenueDeclared,
    declaredFen: fen(totalsYuan.revenueDeclared),
    // 自检结果：老板表里的数与我们反推的公式是否一致
    pass: mismatches.length === 0,
    checkedShifts: shifts.length,
    mismatches,
    // 🔴 用途标签，防止上层误当营收
    purpose: 'cash_reconciliation',
    note: '现金流入口径（含充值），只用于对现金账；不是经营收入',
  };

  // ===== B M1 权责制营收（**这才是营收**）=====
  const dineInYuan = round2(
    M1_DINEIN_KEYS.reduce((s, k) => s + num(totalsYuan[k]), 0)
  );
  const takeawayYuan = round2(
    M1_TAKEAWAY_KEYS.reduce((s, k) => s + num(totalsYuan[k]), 0)
  );
  const pendingOtherYuan = round2(
    M1_OTHER_PENDING_KEYS.reduce((s, k) => s + num(totalsYuan[k]), 0)
  );
  const revenueTotalYuan = round2(dineInYuan + takeawayYuan);
  const revenueM1 = {
    formula: M1_REVENUE_TEXT,
    basis: 'accrual',                 // 权责发生制
    dineInYuan, dineInFen: fen(dineInYuan),
    takeawayYuan, takeawayFen: fen(takeawayYuan),
    // 总收入：**不含**含义未确认的「茶楼」
    totalYuan: revenueTotalYuan,
    totalFen: fen(revenueTotalYuan),
    // 单列未确认项（茶楼），由上层决定是否计入其他业务收入
    pendingOtherYuan, pendingOtherFen: fen(pendingOtherYuan),
    pendingOtherKeys: M1_OTHER_PENDING_KEYS.slice(),
    note: '权责发生制：按消费确认，充值不计入；未确认含义的列单列、不混进营收',
  };

  // ===== C 差额桥（向老板解释两个数为什么不一样；无第五项）=====
  const bossOver = BRIDGE_BOSS_OVER.map((x) => ({
    key: x.key, label: x.label, yuan: round2(num(totalsYuan[x.key])),
  }));
  const m1Over = BRIDGE_M1_OVER.map((x) => {
    const yuan = x.key === 'groupon'
      ? round2(num(totalsYuan.grouponMeituan) + num(totalsYuan.grouponDouyin))
      : x.key === 'waimai'
        ? round2(M1_TAKEAWAY_KEYS.reduce((s, k) => s + num(totalsYuan[k]), 0))
        : round2(num(totalsYuan[x.key]));
    return { key: x.key, label: x.label, yuan };
  });
  const bossOverSum = round2(bossOver.reduce((s, x) => s + x.yuan, 0));
  const m1OverSum = round2(m1Over.reduce((s, x) => s + x.yuan, 0));
  const diffYuan = round2(revenueTotalYuan - cashInflowYuan);
  // 🔴 恒等式：(M1 多算 − 老板多算) == M1 营收 − 现金流入
  //   这是「差额没有第五个来源」的机器证明，守卫 C 组钉死。任一列算错立刻红。
  const identityDiffYuan = round2(m1OverSum - bossOverSum);
  const bridge = {
    cashInflowYuan,
    revenueM1Yuan: revenueTotalYuan,
    diffYuan,
    diffPct: cashInflowYuan > 0 ? round2(diffYuan / cashInflowYuan * 100) : null,
    bossOver, bossOverSum,
    m1Over, m1OverSum,
    identityDiffYuan,
    identityOk: Math.abs(identityDiffYuan - diffYuan) < 0.01,
  };

  // 按日聚合
  const byDate = {};
  for (const s of shifts) {
    if (!byDate[s.date]) {
      byDate[s.date] = {
        date: s.date, shifts: [], revenueYuan: 0, revenueComputedYuan: 0, revenueM1Yuan: 0,
      };
    }
    byDate[s.date].shifts.push(s);
    byDate[s.date].revenueYuan = round2(byDate[s.date].revenueYuan + num(s.revenueDeclared));
    byDate[s.date].revenueComputedYuan = round2(byDate[s.date].revenueComputedYuan + num(s.revenueComputed));
    byDate[s.date].revenueM1Yuan = round2(byDate[s.date].revenueM1Yuan + num(s.revenueM1Yuan));
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
    // 🔴 两套口径 + 差额桥（对外一律用 revenueM1.totalYuan 当营收）
    cashInflow,
    revenueM1,
    bridge,
    // ⚠️ 兼容旧字段：`caliber` 现在只描述 A 口径（现金流入）的自检，**不代表营收**
    caliber: cashInflow,
    unclassified: {
      // 茶楼固定 70/次，含义未知 ⇒ 不计入营收，单列
      teahouseYuan: totalsYuan.teahouse,
      note: '茶楼列含义未确认（固定 70/次），不计入营收，单列待确认',
    },
    unparsedLedger,
    summaryOnlyRows,
    // 供上层判断「这份表是否可用」：没有一行业务数据就别导
    isEmpty: shifts.length === 0,
  };
}

module.exports = {
  SIG, COL_MAP, REVENUE_FORMULA, REVENUE_FORMULA_TEXT, CHANNEL_KEYS,
  // 双口径常量也导出 —— 守卫要能直接断言「公式里有没有充值」，
  // 而不是靠正则去源码里猜（判行为不判字面）。
  M1_DINEIN_KEYS, M1_TAKEAWAY_KEYS, M1_OTHER_PENDING_KEYS,
  M1_DINEIN_MAP, M1_TAKEAWAY_MAP, M1_TAKEAWAY_MISSING,
  M1_DINEIN_TEXT, M1_TAKEAWAY_TEXT, M1_REVENUE_TEXT,
  BRIDGE_BOSS_OVER, BRIDGE_M1_OVER,
  detectRevenueDaily, parseRevenueDaily, parseLedgerText, normDate,
};
