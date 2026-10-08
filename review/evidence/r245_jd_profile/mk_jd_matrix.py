# -*- coding: utf-8 -*-
"""R245 · 把京东两形态转成 selftest 可零依赖读取的 matrix.json
（结构同 r181l fixture：{ sheets: { 表名: { rows: [[...]] } } }）。

- jd_order：来自 **真样例** jd_bill_20260930.xlsx（115 数据行 × 82 列，两级表头），锚点 555.96
- jd_sku  ：来自**豆包合成样例** jd_sku_sample_doubao.xlsx（13 行 × 27 列），锚点 237.00
🔴 读法纪律：openpyxl **不加 read_only**（技能 waimai-bill-reconcile 坑 10）。
"""
import json
import os
import openpyxl

BASE = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence'
SRC = os.path.join(BASE, 'r242_jd_bill')
OUT = os.path.join(BASE, 'r245_jd_profile')

jobs = [
    ('jd_order_2026-09.matrix.json', os.path.join(SRC, 'jd_bill_20260930.xlsx')),
    ('jd_sku_sample.matrix.json',    os.path.join(OUT, 'jd_sku_sample_doubao.xlsx')),
]

for out_name, path in jobs:
    wb = openpyxl.load_workbook(path, data_only=True)
    sheets = {}
    for ws in wb.worksheets:
        rows = [[('' if v is None else v) for v in r] for r in ws.iter_rows(values_only=True)]
        sheets[ws.title] = {'rows': rows}
    obj = {'sheets': sheets}
    p = os.path.join(OUT, out_name)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)
    n = os.path.getsize(p)
    first = list(sheets.keys())[0]
    print('%-32s sheet=%-38s rows=%d cols=%d  %.1f KB'
          % (out_name, first, len(sheets[first]['rows']),
             len(sheets[first]['rows'][0]) if sheets[first]['rows'] else 0, n / 1024.0))
