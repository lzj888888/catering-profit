# -*- coding: utf-8 -*-
"""盘点本地 Excel 实物：只读表头与前几行，不猜列名。"""
import openpyxl, os, sys

FILES = [
    r"C:\Users\lzj\WorkBuddy\Claw\catering-profit\_probe_tmp\jd_order.xlsx",
    r"C:\Users\lzj\WorkBuddy\Claw\catering-profit\_probe_tmp\jd_sku.xlsx",
    r"C:\Users\lzj\WorkBuddy\Claw\catering-profit\_probe_tmp\taobao_goods.xlsx",
    r"C:\Users\lzj\WorkBuddy\2026-09-08-22-08-11\京东外卖套餐毛利诊断_耙三样_20261015-1020.xlsx",
    r"C:\Users\lzj\Desktop\tangshi.xlsx",
    r"C:\Users\lzj\WorkBuddy\_import_demo\fixtures\meituan.xlsx",
    r"C:\Users\lzj\Desktop\02_经营财务\耙三样_耙牛肉2026-08-01_2026-08-31微信支付账单.xlsx",
    r"C:\Users\lzj\Desktop\02_经营财务\淘宝闪购.xlsx",
    r"C:\Users\lzj\Desktop\店算_形态C样例_外卖商品销量_0907至0913.xlsx",
]

def cell(v):
    if v is None:
        return ""
    s = str(v).replace("\n", " ").strip()
    return s[:22]

for f in FILES:
    print("=" * 100)
    print("FILE:", os.path.basename(f), "| exists=", os.path.exists(f))
    if not os.path.exists(f):
        continue
    try:
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
    except Exception as e:
        print("  !! 打开失败:", e)
        continue
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        head = []
        for i, r in enumerate(rows):
            head.append(r)
            if i >= 3:
                break
        print(f"  -- sheet: {ws.title}  维度={ws.max_row}行 x {ws.max_column}列")
        for j, r in enumerate(head):
            vals = [cell(v) for v in r][:14]
            print(f"     [{j}] " + " | ".join(vals))
    wb.close()
