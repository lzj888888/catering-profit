# -*- coding: utf-8 -*-
"""锚点独立复算（Python 侧）—— 读 fixture 矩阵，按已锁口径**自己求和**，产出对照值。

🔴 刻意不依赖 utils/billParse.js 的任何实现：口径直接来自
   review/PLAN_2026-10-01_...md §四 + review/NOTE_*（外卖接数六条）。
"""
import json, os

D = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(D, "fixtures")


def load(tag):
    with open(os.path.join(FIX, tag + ".matrix.json"), encoding="utf-8") as f:
        return json.load(f)


def num(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "--", "—"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


# ── 淘宝：sheet「外卖账单明细」，表头第 1 行；到手 = Σ「结算金额」──
tb = load("taobao_2026-08")
trs = tb["sheets"]["外卖账单明细"]["rows"]
thdr = trs[0]
i_settle = thdr.index("结算金额")
tdata = trs[1:]
settle = sum(num(r[i_settle]) for r in tdata)
print("淘宝 | 数据行 = %d | Σ结算金额 = %.2f 元 | = %d 分" % (len(tdata), settle, round(settle * 100)))

# ── 美团：sheet「订单明细」，表头第 1 行；筛「交易类型==外卖订单」，Σ「商家应收款」──
mt = load("meituan_2026-08")
mrs = mt["sheets"]["订单明细"]["rows"]
mhdr = mrs[0]
i_type = mhdr.index("交易类型")
i_net = mhdr.index("商家应收款")
mdata = mrs[1:]
wm = [r for r in mdata if str(r[i_type]).strip() == "外卖订单"]
allnet = sum(num(r[i_net]) for r in mdata)
wmnet = sum(num(r[i_net]) for r in wm)
print("美团 | 数据行 = %d | 其中「外卖订单」= %d 行" % (len(mdata), len(wm)))
print("      全表 Σ商家应收款 = %.2f 元（= 账单金额，**不是收入**）" % allnet)
print("      外卖订单 Σ商家应收款 = %.2f 元 | = %d 分" % (wmnet, round(wmnet * 100)))

# ── 对照 ──
print()
print("对照期望：淘宝 156 行 / 3779.65 元 ←→ 实算 %d 行 / %.2f 元 | %s"
      % (len(tdata), settle, "✅" if len(tdata) == 156 and abs(settle - 3779.65) < 0.005 else "❌"))
print("对照期望：美团 97 行 → 筛后 50 行 / 1826.64 元 ←→ 实算 %d → %d 行 / %.2f 元 | %s"
      % (len(mdata), len(wm), wmnet,
         "✅" if len(mdata) == 97 and len(wm) == 50 and abs(wmnet - 1826.64) < 0.005 else "❌"))
