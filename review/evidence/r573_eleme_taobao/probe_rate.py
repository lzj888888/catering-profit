# -*- coding: utf-8 -*-
"""R573-D · 抽佣/配送真实费率 vs 规范文案所写区间"""
import warnings
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
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
goods = tot("商品金额"); tech = tot("技术服务费"); ship = tot("配送服务费")
p=lambda d: (abs(d)/goods*100).quantize(Decimal("0.01"), ROUND_HALF_UP)

print("[1] 账单内写的费率列分布")
print("    抽佣费率       =", dict(Counter(str(r[i["抽佣费率"]]) for r in data)))
print("    技术服务费折扣系数 =", dict(Counter(str(r[i["技术服务费折扣系数"]]) for r in data)))

print("\n[2] 实测占比（分母统一为 Σ商品金额 = %s）" % goods)
print("    佣金(技术服务费)          = %s  占 %s%%" % (tech, p(tech)))
print("    配送服务费                = %s  占 %s%%" % (ship, p(ship)))
print("    佣金+配送(即平台服务费)   = %s  占 %s%%" % (tech+ship, p(tech+ship)))
print("    商家承担补贴              = %s  占 %s%%" % (tot("商家活动补贴")+tot("商家代金券补贴")+tot("商家智能补贴")+tot("商家配送费活动补贴")+tot("商家配送费券补贴"), p(tot("商家活动补贴")+tot("商家代金券补贴")+tot("商家智能补贴")+tot("商家配送费活动补贴")+tot("商家配送费券补贴"))))
