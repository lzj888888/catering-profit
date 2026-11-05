# -*- coding: utf-8 -*-
"""R573-E · 用美团原始账单裁定 platform_taobao_shangou.jpg 归属"""
import warnings
from decimal import Decimal
from collections import Counter
warnings.filterwarnings("ignore")
import openpyxl

SRC = r"C:/Users/lzj/Downloads/09bbd01042244a1fa98e0d0f1963211b.xlsx"
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
print("sheets =", wb.sheetnames)

for want in ["订单明细", "账单明细"]:
    if want not in wb.sheetnames:
        continue
    ws = wb[want]
    rows = list(ws.iter_rows(values_only=True))
    rows = [r for r in rows if any(c is not None and str(c).strip() != "" for c in r)]
    if not rows:
        print("[%s] 空" % want); continue
    hdr = [("" if c is None else str(c).strip()) for c in rows[0]]
    print("\n=== %s === 行数=%d 列数=%d" % (want, len(rows) - 1, len(hdr)))
    print("列名 =", [h for h in hdr if h])

    def n(v):
        if v is None: return Decimal(0)
        s = str(v).strip().replace(",", "")
        if s in ("", "-", "--"): return Decimal(0)
        neg = s.startswith("(") and s.endswith(")")
        if neg: s = s[1:-1]
        try: x = Decimal(s)
        except Exception: return Decimal(0)
        return -x if neg else n

    data = rows[1:]
    for key in ["商品总价", "商品金额", "打包费", "商家应收款", "账单金额", "订单类型", "交易类型"]:
        if key in hdr:
            j = hdr.index(key)
            vals = [r[j] for r in data]
            if key in ("订单类型", "交易类型"):
                print("  %s 分布 = %s" % (key, dict(Counter(str(v) for v in vals))))
            else:
                print("  Σ%s = %s" % (key, sum(n(v) for v in vals)))
