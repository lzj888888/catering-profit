# -*- coding: utf-8 -*-
"""R573-B · 验证「平台服务费」是否 = 技术服务费 + 配送服务费 的冗余汇总列（逐行 + 合计双路）"""
import warnings
from decimal import Decimal
warnings.filterwarnings("ignore")
import openpyxl

SRC = r"C:/Users/lzj/Downloads/efd9ca3857d64c9791e84fded6166513.xlsx"
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
rows = list(wb["外卖账单明细"].iter_rows(values_only=True))
hdr = [("" if c is None else str(c).strip()) for c in rows[0]]
data = rows[1:]
i = {c: hdr.index(c) for c in hdr}

def n(v):
    if v is None: return Decimal(0)
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "--"): return Decimal(0)
    neg = s.startswith("(") and s.endswith(")")
    if neg: s = s[1:-1]
    try: x = Decimal(s)
    except Exception: return Decimal(0)
    return -x if neg else x

bad_rows, tested = [], 0
for k, r in enumerate(data):
    a = n(r[i["平台服务费"]]); b = n(r[i["技术服务费"]]) + n(r[i["配送服务费"]])
    tested += 1
    if abs(a - b) > Decimal("0.01"):
        bad_rows.append((k + 2, str(a), str(b)))
print("逐行比对：测试 %d 行，不相等行数 = %d" % (tested, len(bad_rows)))
if bad_rows:
    print("  反例前 5 条:", bad_rows[:5])

tot = lambda c: sum(n(r[i[c]]) for r in data)
print("\n合计侧：")
print("  Σ平台服务费            =", tot("平台服务费"))
print("  Σ技术服务费+Σ配送服务费 =", tot("技术服务费") + tot("配送服务费"))
print("  差额 =", tot("平台服务费") - (tot("技术服务费") + tot("配送服务费")))

print("\n到手链复核（不含平台服务费）：")
goods, pack, mer = tot("商品金额"), tot("打包费"), sum(tot(c) for c in hdr if c.startswith("商家") and ("补贴" in c or "券" in c))
chain = goods + pack + mer - tot("技术服务费") - tot("配送服务费")
print("  商品+打包+商家补贴-技术服务费-配送服务费 =", chain)
print("  Σ结算金额 =", tot("结算金额"), " 差 =", chain - tot("结算金额"))
