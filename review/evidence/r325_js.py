# -*- coding: utf-8 -*-
"""R325：把 openCash 接到矩阵结果区（最后一道闸）。"""
import io

p = 'pages/sandbox/matrix.js'
s = io.open(p, encoding='utf-8').read()

# 1) require
a = "const { deliver } = require('../../utils/exportFile.js');"
assert s.count(a) == 1
s = s.replace(a, a + "\n// 🔴 R325：开店现金需求（装修/押金/预付/设备/货款）+ 周转金能撑几个月\nconst OpenCash = require('../../utils/openCash.js');", 1)

# 2) t 映射（挂在 cushionBreakEven 后）
a = "      cushionBreakEven: M.cushionBreakEven,"
assert s.count(a) == 1
s = s.replace(a, a + """
      cashTitle: M.cashTitle,
      cashLead: M.cashLead,
      cashRentLabel: M.cashRentLabel,
      cashBudgetLabel: M.cashBudgetLabel,
      cashEquipLabel: M.cashEquipLabel,
      cashStockLabel: M.cashStockLabel,
      cashDepositNote: M.cashDepositNote,""", 1)

# 3) data：输入 + 结果
a = """    advOpen: false,
    advNote: '',"""
assert s.count(a) == 1
s = s.replace(a, a + """
    // 🔴 R325：现金卡输入。租金默认跟透视表的固定租金走（老板已在页面上填过），只需再给一个「手上现金」
    cash: { rentYuan: 5000, budgetYuan: '', equipYuan: '', stockYuan: '' },
    cashRes: null,""", 1)

# 4) 生成结果后重算现金卡
a = """        result: { rows, view: 'detail', count: rows.length, pivot, insight, rejected },
      });"""
assert s.count(a) == 1
s = s.replace(a, """        result: { rows, view: 'detail', count: rows.length, pivot, insight, rejected },
      });
      // 🔴 R325：结果变了 ⇒ 反推的「每月固定支出」也变了，现金卡必须跟着重算（否则显示上一次的数）
      this.buildCash();""", 1)

# 5) 方法：插在 onGlobalInput 之后
a = """  onGlobalInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const global = this.data.global;
    global[key] = val;
    this.setData({ global });
  },
"""
assert s.count(a) == 1
METHODS = a + """
  // ===== 🔴 R325：钱够不够开 · 能撑几个月 =====
  //   定位：矩阵答「稳态能不能赚钱」（要卖多少才保本），这块答「有没有命等到稳态」。
  //   老板自己会算够不够，但他系统性漏算四笔：押金 / 预付租金 / 首批货款 / 开业前爬坡期。
  onCashInput(e) {
    const key = e.currentTarget.dataset.key;
    const cash = this.data.cash;
    cash[key] = e.detail.value;
    this.setData({ cash });
    this.buildCash();
  },

  // 从矩阵结果反推「每月固定支出」。
  //   🔴 引擎口径（cloudfunctions/calcSandbox/service.js:100）：保本营收 = 固定费用 ÷ 综合毛利率
  //      ⇒ 固定费用 = 保本营收 × 毛利率。
  //      这里用页面展示的毛利率（grossMarginPct）反推；若存在平台佣金，算出来的固定费用**略偏高**
  //      ⇒ 能撑月数偏少 ⇒ 结论偏保守（安全方向，宁可说紧不说松）。
  //   取「目标利润 = 0（保本行）」且租金最接近老板填的那一档。
  fixedMonthlyYuan(rentYuan) {
    const rows = (this.data.result && this.data.result.rows) || [];
    let best = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.invalid || r.breakMonthly == null || r.targetYuan !== 0) continue;
      if (!best || Math.abs(r.rent - rentYuan) < Math.abs(best.rent - rentYuan)) best = r;
    }
    if (!best) return null;
    return Math.round(best.breakMonthly * best.marginPct / 100);
  },

  buildCash() {
    const T = this.data.t;
    const c = this.data.cash;
    const area = Number(this.data.global.area) || 0;
    const rentYuan = Number(c.rentYuan) || 0;
    const budgetYuan = Number(c.budgetYuan) || 0;
    const y2f = (v) => Math.round((Number(v) || 0) * 100);

    // 金额显示：≥1 万用「万」，否则用「元」（单位都取自 terms，不硬写中文）
    const money = (fen) => {
      const yuan = fen / 100;
      if (Math.abs(yuan) >= 10000) return (yuan / 10000).toFixed(1) + T.cashWan;
      return Math.round(yuan) + T.yuan;
    };
    const fill = (tpl, map) => fmt(tpl, map);

    const fixedMonthly = this.fixedMonthlyYuan(rentYuan);
    const r = OpenCash.estimateOpenCash({
      areaM2: area,
      rentFen: y2f(rentYuan),
      budgetFen: y2f(budgetYuan),
      equipFen: y2f(c.equipYuan),
      stockFen: y2f(c.stockYuan),
      fixedMonthlyFen: y2f(fixedMonthly),
    });

    if (!r.ok) { this.setData({ cashRes: null }); return; }

    const partsText = fill(T.cashPartsText, {
      decor: money(r.decorFen),
      deposit: money(r.depositFen),
      prepay: money(r.prepayFen),
      equip: r.equipMissing ? T.cashEquipMissing : money(r.equipFen),
      stock: r.stockMissing ? T.cashStockMissing : money(r.stockFen),
    });

    let verdictText = '';
    let levelCls = '';
    if (!r.budgetFen) {
      verdictText = T.cashNeedBudget;
    } else if (r.level === 'short') {
      verdictText = fill(T.cashLevelShort, { gap: money(-r.remainFen) });
      levelCls = 'warn';
    } else if (r.level === 'danger') {
      verdictText = fill(T.cashLevelDanger, { remain: money(r.remainFen) });
      levelCls = 'warn';
    } else if (r.level === 'tight') {
      verdictText = fill(T.cashLevelTight, { m: String(r.runwayMonths) });
      levelCls = 'warn';
    } else if (r.level === 'safe') {
      verdictText = fill(T.cashLevelSafe, { m: String(r.runwayMonths) });
      levelCls = 'ok';
    } else {
      // 有剩余但算不出月固定支出（该档位无有效保本行）—— 只说剩多少，不编月数
      verdictText = r.remainFen >= 0
        ? fill(T.cashRemainText, { remain: money(r.remainFen) })
        : fill(T.cashLevelShort, { gap: money(-r.remainFen) });
      levelCls = r.remainFen >= 0 ? '' : 'warn';
    }

    this.setData({
      cashRes: {
        needText: fill(T.cashNeedText, { need: money(r.cashNeedFen) }),
        partsText,
        // 🔴 未填设备/货款 ⇒ 明确说「实际更多」，绝不让下限当成完整数（R324 的 equipMissing/stockMissing）
        noteText: (r.equipMissing || r.stockMissing) ? T.cashIncompleteNote : '',
        verdictText,
        levelCls,
      },
    });
  },
"""
s = s.replace(a, METHODS, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('matrix.js patched')
