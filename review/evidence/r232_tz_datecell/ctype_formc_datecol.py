# -*- coding: utf-8 -*-
import openpyxl, sys
p = r"C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r232_formc_sample/商品下载_20260907至20260913__5366951484_20261006213915236.xlsx"
wb = openpyxl.load_workbook(p, data_only=True)
ws = wb['data']
print("=== 表头 Python 类型 ===")
hdr = [c.value for c in ws[1]]
for i, h in enumerate(hdr, 1):
    print(f"  {i:2d} {h}")
print()
# 日期列 = 第 1 列
print("=== 日期列 Python 类型采样（前 12 行）===")
from datetime import datetime, date
types = {}
for r in range(2, 15):
    v = ws.cell(row=r, column=1).value
    print(f"  R{r}: {v!r}   type={type(v).__name__}")
print()
print("=== 全列类型统计 ===")
for r in range(2, ws.max_row + 1):
    v = ws.cell(row=r, column=1).value
    t = type(v).__name__
    types[t] = types.get(t, 0) + 1
print("  日期列:", types)
print()
# 看 cell 的 number_format —— 决定 openpyxl 是否当日期
print("=== number_format 采样 ===")
for r in range(2, 6):
    c = ws.cell(row=r, column=1)
    print(f"  R{r}: number_format={c.number_format!r}  is_date={c.is_date}")
