# -*- coding: utf-8 -*-
"""R245 · 从京东两份**真样例**抽取表头，落成 selftest 可零依赖引用的 JSON fixture。
🔴 只抽「表头行」，不抽数据 —— 真表是商户数据，fixture 只做「列名契约」用。
读法纪律（技能 waimai-bill-reconcile 坑 10）：openpyxl **不加 read_only**。
"""
import json, os, sys
import openpyxl

SRC = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r242_jd_bill'
OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r245_jd_profile'

jobs = [
    ('jd_order_header.json', 'jd_bill_20260930.xlsx', 1),   # 两级表头 ⇒ 真列名在 R2（0-based 1）
    ('jd_sku_header.json',   'jd_sku_bill_20260930.xlsx', 0),
]

for out_name, src_name, hdr_idx in jobs:
    p = os.path.join(SRC, src_name)
    wb = openpyxl.load_workbook(p, data_only=True)
    ws = wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    hdr = [('' if v is None else str(v).strip()) for v in rows[hdr_idx]]
    obj = {
        '_source': src_name,
        '_note': '仅表头（列名契约），无业务数据；来自 R242 京东真样例',
        'sheet': ws.title,
        'headerRow': hdr_idx,
        'header': hdr,
    }
    with open(os.path.join(OUT, out_name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print('%-22s sheet=%-38s cols=%d' % (out_name, ws.title, len(hdr)))
    print('   ', hdr[:12], '...')
