# -*- coding: utf-8 -*-
"""R573-C · 到手链正解（修正符号）× 冗余列危害量化"""
import warnings
from decimal import Decimal
warnings.filterwarnings("ignore")
import openpyxl

SRC = r"C:/Users/lzj/Downloads/efd9ca3857d64c9791e84fded6166513.xlsx"
rows = list(openpyxl.load_workbook(SRC, read_only=True, data_only=True)["外卖账单明细"].iter_rows(values_only=True))
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

tot = lambda c: sum(n(r[i[c]]) for r in data)
mer = sum(tot(c) for c in hdr if c.startswith("商家") and ("补贴" in c or "券" in c))

print("[A] 到手链正解（表内费用列已带负号，直接相加）")
chain = tot("商品金额") + tot("打包费") + mer + tot("技术服务费") + tot("配送服务费")
print("    商品 %s + 打包 %s + 商家补贴 %s + 技术服务费 %s + 配送服务费 %s"
      % (tot("商品金额"), tot("打包费"), mer, tot("技术服务费"), tot("配送服务费")))
print("    = ", chain, "   Σ结算金额 =", tot("结算金额"), "   差 =", chain - tot("结算金额"))

print("\n[B] 若老板把「平台服务费」也当一笔费用抄进来（行业里最常见抄法）")
bad = chain + tot("平台服务费")
print("    误算净额 =", bad, "   比真值少 =", bad - tot("结算金额"))
base = tot("商品金额") + tot("打包费")
print("    少计占营收(商品+打包)比例 = %.2f%%   （营收基数 %s）" % (float((chains := (tot("结算金额") - bad) / base * 100)), base))
